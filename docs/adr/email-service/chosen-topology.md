# OTP email delivery topology

## Decision

The email service consumes `otp.email` events from RabbitMQ and submits them to
SMTP. Its delivery topology, retry policy and idempotency model are:

**Transport.** The producer (`user-service`) publishes one `otp.email` event per
OTP request, carrying a stable `messageId` (UUID), to the `foc.events` exchange,
bound to the `otp_emails` queue. The email service is a bare RabbitMQ consumer
on that queue — not an HTTP endpoint.

**Idempotency.** The consumer marks a `messageId` in a shared Redis store
(`email:seen:<messageId>`, `SET ... NX EX 900`) _before_ sending; a redelivered
message (e.g. consumer crash between send and ack) is acked and skipped. The
mark is deleted when a send fails so the retried copy is not suppressed. The
store is shared, so the guarantee holds across multiple consumer instances and
restarts. If Redis is unreachable the store is fail-open: the email is sent
anyway (availability over strict dedup).

**Retry.** A message gets at most 5 delivery attempts. A failed send is
republished into `foc.retry` with the next attempt stamped in the
`x-foc-attempt` header and the per-message TTL for this hop:

| Attempts | Backoff (per-message TTL)       |
| -------- | ------------------------------- |
| 1 → 2    | 60s                             |
| 2 → 3    | 120s                            |
| 3 → 4    | 240s                            |
| 4 → 5    | 480s                            |
| 5 fails  | dead-letter to `otp_emails.dlq` |

Malformed/poison messages are dropped immediately and never retried.

**Topology.** RabbitMQ resources (all on vhost `/foc`):

- `foc.events` (producer-owned direct exchange) — binding `otp.email` →
  `otp_emails`
- `otp_emails` — the consumer queue
- `foc.retry` (direct) — binding `otp.email` → `otp_emails.retry`
- `otp_emails.retry` — TTL parking lot; `x-message-ttl: 480000` safety cap,
  `x-dead-letter-exchange: foc.back`
- `foc.back` (dedicated direct exchange) — binding `otp.email` → `otp_emails`
- `foc.dlq` (direct) — binding `otp.email` → `otp_emails.dlq`
- `otp_emails.dlq` — inspectable sink, no consumer

The email service asserts every resource at startup (matching
`rabbitmq/definitions.json`, which seeds the same topology plus users and
permissions), so a misconfigured broker fails fast instead of silently losing
retries. The `email-service` AMQP user is scoped to exactly these resources.

### Diagram (d2)

```d2
# Distinct shapes per node kind: services, exchanges, queues.
classes: {
  svc: {
    shape: rectangle
  }
  exchange: {
    shape: hexagon
  }
  queue: {
    shape: queue
  }
}

# Producer publishes a new OTP email job.
"user-service".class: svc
"foc.events".class: exchange
"otp_emails".class: queue

"user-service" -> "foc.events": "otp.email"
"foc.events" -> "otp_emails": "otp.email"

# One consumer handles every attempt through the same pipeline.
"email-service".class: svc
SMTP.class: svc

"otp_emails" -> "email-service": "deliver (attempt N)"
"email-service" -> SMTP: "sendMail (every attempt)"

# Send failure before attempt 5: republish with the next attempt number and
# this hop's TTL; the retry queue parks the copy, then dead-letters it back
# through foc.back into the main queue for the next attempt.
"foc.retry".class: exchange
"otp_emails.retry".class: queue
"foc.back".class: exchange
"foc.dlq".class: exchange
"otp_emails.dlq".class: queue

"email-service" -> "foc.retry": "republish (attempt+1, TTL)"
"foc.retry" -> "otp_emails.retry": "otp.email"
"otp_emails.retry" -> "foc.back": "expiry -> dead-letter"
"foc.back" -> "otp_emails": "otp.email"

# Attempt 5 failure is terminal: dead-letter for inspection, out of the loop.
"email-service" -> "foc.dlq": "attempt 5 fails"
"foc.dlq" -> "otp_emails.dlq": "otp.email"
```

## Rationale

**One consumer, one pipeline.** The retry queue has no consumer; it is a timer
that parks a message for its per-message TTL and dead-letters it back to
`otp_emails`. Retried attempts therefore run through the same parse → dedup →
render → send → ack path as the first attempt, distinguished only by the
`x-foc-attempt` header. A second consumer on the retry queue would duplicate
this pipeline and let the two paths drift.

**Dedicated `foc.back` return exchange.** Routing retries through the producer's
`foc.events` (as the original design did) would couple the retry loop to a
binding owned by another service; a change to that binding would silently break
retries. `foc.back` is bound only to `otp_emails`, keeping delivery routing and
retry routing independent.

**Service-owned topology.** Asserting the full topology at startup converts a
silent-loss failure (e.g. retry exchange missing) into a loud startup error, and
lets the service run against a broker provisioned from scratch. The scope is
enforced by the AMQP user's configure/write/read permissions.

**Shared Redis dedup.** An in-process cache is per instance and per process; it
cannot suppress a crash-redelivery that lands on a different instance or after a
restart. Redis is a single atomic `SET NX EX` round trip and is already part of
the platform. Fail-open is deliberate: an OTP email is worth an occasional
duplicate, never worth being lost.

**Per-message expiration for progressive backoff.** Dead-lettering alone only
supports a fixed per-queue TTL. Setting `expiration` on each republished copy
gives per-hop growth (60s → 480s) with a single retry queue.

**Known tradeoffs.** (a) At-least-once territory: an SMTP timeout that actually
delivered will produce a duplicate on the next attempt — dedup only covers
crash-redelivery. (b) The cumulative retry horizon (~15m) can outlive the OTP
record TTL (10m); a late copy carries a revoked code and the user re-requests.
(c) Redis outage degrades dedup to occasional duplicates (fail-open).

