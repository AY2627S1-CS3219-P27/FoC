# Notification intake and retry pipeline

## Decision

The notification service consumes one intake queue and owns the retry
topology that re-enters it. Delivery is stubbed until NS2 lands; the pipeline,
persistence, guards and broker mechanics are final.

**Intake.** `notification.notify.v1` (canonical fan-out event:
`{ notificationGuid, userId, content }`) is bound from `foc.events` to
`notification-service.notify.v1`. The service fans the event out to the user's
active push subscriptions and performs attempt 1 immediately.

**Retry topology** (mirrors email-service, ADR 002):

- `foc.retry` (headers exchange) routes a retry copy into the parking lot whose
  `foc-delay` header matches its binding (`notify_retry_60s` / `120s` / `240s` /
  `480s`).
- Each parking lot has `x-message-ttl` equal to its delay and dead-letters back
  through `foc.back`, which is bound to the intake queue for both
  `notification.notify.v1` and the per-pair retry key.
- Attempt 5 failing dead-letters the pair to `notification-service.notify.v1.dlq`
  through `foc.dlq`.
- All resources are asserted at startup and mirrored in
  `rabbitmq/definitions.json`; a misconfigured broker fails fast.

**Per-pair jobs.** A fan-out event carries no subscription id. When one pair
fails, the service publishes a self-addressed retry copy
`notification.notify-retry.v1` with body `{ notificationGuid, subscriptionId }`
and the next attempt in the `x-foc-attempt` header. The routing key distinguishes
per-pair work from fan-out work, so the consumer never discriminates by body
shape.

**Persistence and guards.** One `notifications` row per `(guid, subscription_id)`
(unique), holding `attempt_count`, `status` (`pending`/`delivered`/`failed`) and
the rendered `content`.

- **NS3.1.1** — a retry whose pair is absent is acknowledged and dropped.
- **NS3.1.2** — a retry is delivered only when its attempt header equals the
  stored `attempt_count`; any other value is a stale duplicate (redelivery after
  a crash, duplicate publish) and is dropped without sending.
- Delivered/failed rows never send again, and fan-out skips any pair that
  already exists — so a given endpoint receives a given notification at most
  once per attempt step.
- The row's attempt counter advances only **after** the next retry copy is
  durably published. A publish failure requeues the original message, which
  re-runs the same attempt rather than losing the notification.

**Coercion seam.** Producing services' events have their own shapes. A
routing-key → transformer registry coerces a registered event into the canonical
`{ notificationGuid, userId, content }` before fan-out (guid derived from the
upstream envelope's stable id keeps fan-out idempotent). The registry ships
empty: tapping a new event is one binding plus one transformer, with no change
to the pipeline. Unknown events are poison and are never retried.

**Honest guarantees.** Delivery is at-least-once across crash windows where the
send succeeded but the row update/ack did not land; the attempt guard prevents
duplicates introduced by *retries*, not by that unavoidable window. A stale
endpoint (push service 404/410) will be pruned when NS2 implements the sender.

## Consequences

- `notifications` rows are the delivery ledger: retries are traceable and
  exhausted deliveries are inspectable on the DLQ.
- The service must be able to `configure` `notification-service.*` and
  `notify_retry_\d+s` resources (already granted in `rabbitmq/definitions.json`).
- NS2 only needs to implement `NotificationSender.send(subscription, content)`;
  no broker or persistence change is required.
