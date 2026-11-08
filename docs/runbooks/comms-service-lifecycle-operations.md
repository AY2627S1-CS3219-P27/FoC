# Communication Service Lifecycle Operations

This runbook covers lifecycle ingestion and participant-only chat reads. It
does not authorize direct database changes, queue purges, or bypassing shared
event validation.

## Signals and safe labels

Prometheus scrapes `/metrics`. Communication Service emits:

| Metric                                         | Labels                  | Meaning                                                                                  |
| ---------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `foc_comms_lifecycle_deliveries_total`         | `stream`, `outcome`     | Confirmed processing, skip, duplicate, retry, dead-letter, or identity-conflict outcome. |
| `foc_comms_lifecycle_handler_duration_seconds` | `stream`, `outcome`     | Contract/domain handler latency.                                                         |
| `foc_comms_chats_created_total`                | `source`                | Accepted-event chats committed to PostgreSQL.                                            |
| `foc_comms_http_requests_total`                | `route`, `status_class` | Chat API responses, including guard and validation failures.                             |
| `foc_comms_http_request_duration_seconds`      | `route`, `status_class` | End-to-end chat API latency.                                                             |

Labels are bounded enums or normalized routes. Event IDs, chat IDs, user IDs,
errand IDs, cursors, and tokens must never become metric labels.

Investigate sustained retries, any dead-letter/conflict increase, chat creation
without corresponding accepted-event success, elevated `5xx`, or latency
regression. A duplicate increase can be normal after reconnect or replay, but
should correlate with stable inbox/chat counts.

If a lifecycle consumer is cancelled or its channel closes, Communication
Service closes that channel so unacknowledged deliveries return to RabbitMQ,
then restores the unified stream. Installation is retried immediately
and then after 1, 2, 4, 8, and at most 16 seconds until it succeeds. During
recovery `/health/ready` returns 503 even when the broker itself is reachable;
investigate `comms-service.events`, its service-owned binding, and `foc.pubsub`.
The process remains live, and operators must not purge or manually acknowledge
retained messages to make readiness pass.

## Inspecting a lifecycle DLQ

Use a dedicated, short-lived operator identity allowed to read only
`comms-service.events.dlq` and publish to the existing `foc.events` exchange.
The runtime `comms-service` identity is intentionally unable to publish there.
Set the `RABBITMQ_OPERATOR_*` variables documented in
`comms-service/.env.example`; keep its password in an untracked secret file.

From `comms-service/`, select one exact queue:

```powershell
npm run dlq:operator -- inspect --queue comms-service.events.dlq
```

Inspection uses a manual acknowledgement, prints one delivery's failure
metadata and UTF-8 body, and requeues it unchanged. Run it only in an approved
terminal because lifecycle payloads contain user identifiers. Save evidence in
the incident record, determine whether the producer, contract, configuration,
or a transient dependency caused the failure, and correct that cause first.

Do not redrive `IDENTITY_CONFLICT`. The inbox already contains different
evidence for that event ID; investigate the publisher and retained database
evidence. Never delete or edit the inbox row to force acceptance.
If inspection cannot establish a trustworthy event ID, do not use the redrive
command; repair the producer and publish a new valid event through its
transactional outbox instead.

## Redriving one corrected delivery

Prepare one corrected JSON document that satisfies the shared contract and
retains the inspected event ID. Redrive only after the cause is fixed and the
normal primary queue is healthy:

```powershell
npm run dlq:operator -- redrive `
  --queue comms-service.events.dlq `
  --corrected-file C:\secure\corrected-event.json `
  --confirm-event-id 11111111-1111-4111-8111-111111111111
```

The tool reserves one DLQ delivery and refuses to proceed unless its event ID
matches the explicit confirmation. It requires the protected original routing
key recorded by the transport, validates the corrected document with
`@foc/contracts`, publishes it persistently to `foc.events` using that route,
rejects unroutable publication, waits for publisher
confirmation, and only then acknowledges the DLQ copy. On any error it
requeues the original DLQ delivery. It never publishes directly to a primary
queue, a retry queue, or `foc.comms.back`.

After redrive, verify the primary and retry queues drain, the DLQ decreases by
one, the appropriate delivery metric advances, and the inbox/lifecycle/chat
result is correct. Exact duplicate evidence is safely acknowledged; do not
redrive repeatedly merely because the result was a duplicate.

## Rollout

1. Build and test shared contracts, authentication, and observability packages.
2. Import the root RabbitMQ definitions before enabling Order publication.
   Confirm `foc.pubsub` and the fact-event forwarding bindings exist.
3. Configure secrets, start PostgreSQL/Redis/RabbitMQ, and apply Communication
   Service migrations explicitly. Never enable schema synchronization.
4. Deploy Communication Service. Confirm `/health/live`, `/health/ready`,
   `/metrics`, `/docs-json`, and the retry topology provisioner.
5. Verify the unified consumer is active, its primary queue drains, and retry/DLQ
   counts remain stable. Compare accepted successes with chat creation.
6. Exercise both chat endpoints through the supported ingress with valid,
   expired, participant, and non-participant credentials.
7. Observe delivery/API counters, latency histograms, PostgreSQL errors, and
   broker queue depths through the deployment soak period.

## Rollback and recovery

Disable Order lifecycle publication before stopping lifecycle consumers when
the rollback affects the contract or publisher. Stop application instances
gracefully so in-flight handlers and confirms drain. Preserve PostgreSQL,
primary queues, retry queues, DLQs, inbox rows, lifecycle facts, and chats;
retained evidence is the recovery path when the fixed version starts.

Communication Service allows RabbitMQ consumers, handlers, and publisher
confirms up to 10 seconds to drain. If RabbitMQ is unavailable or recovery is
still waiting at that deadline, the service stops connection recovery and
continues shutdown. Closing the connection returns every unacknowledged
delivery to RabbitMQ; after the broker and service restart, normal inbox
idempotency safely converges deliveries whose PostgreSQL transaction had
already committed. Treat the forced-drain warning as an operational signal to
verify broker health and retained queue depth, not as permission to purge or
manually acknowledge messages.

Do not purge queues, delete chats, edit inbox identity, or revert a populated
migration as an ordinary rollback. Migration reversal requires explicit
approval and proof that no retained evidence is required. If only chat reads
are unhealthy, remove the route at ingress or roll back the application while
leaving lifecycle evidence intact. Restore the dependency or code, redeploy,
verify readiness, and allow normal idempotent consumption to resume.
