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
`x-foc-attempt` header and the hop's delay in the `foc-delay` header.
`foc.retry` is a headers exchange: per-delay header bindings route the copy
into the matching parking-lot queue, whose queue-level TTL parks it for
exactly that delay before dead-lettering it back:

| Attempts | Backoff (parking-lot queue TTL) |
| -------- | ------------------------------- |
| 1 → 2    | `email_retry_60s`  — 60s        |
| 2 → 3    | `email_retry_120s` — 120s       |
| 3 → 4    | `email_retry_240s` — 240s       |
| 4 → 5    | `email_retry_480s` — 480s       |
| 5 fails  | dead-letter to `otp_emails.dlq` |

Malformed/poison messages are dropped immediately and never retried.

**Topology.** RabbitMQ resources (all on vhost `/foc`):

- `foc.events` (producer-owned direct exchange) — binding `otp.email` →
  `otp_emails`
- `otp_emails` — the consumer queue
- `foc.retry` (headers exchange) — per-delay bindings (header `foc-delay`)
  → `email_retry_60s` / `email_retry_120s` / `email_retry_240s` /
  `email_retry_480s`
- `email_retry_<delay>s` — one generic parking-lot queue per backoff hop;
  `x-message-ttl: <delay>`, `x-dead-letter-exchange: foc.back`
- `foc.back` (direct) — binding `otp.email` → `otp_emails`
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

# Send failure before attempt 5: republish with the next attempt number and the
# hop's delay header; foc.retry routes it into the matching parking-lot queue,
# which parks it for exactly the queue TTL and dead-letters it back through
# foc.back into the main queue for the next attempt.
"foc.retry".class: exchange
"email_retry_60s".class: queue
"email_retry_120s".class: queue
"email_retry_240s".class: queue
"email_retry_480s".class: queue
"foc.back".class: exchange
"foc.dlq".class: exchange
"otp_emails.dlq".class: queue

"email-service" -> "foc.retry": "republish (attempt+1, foc-delay)"
"foc.retry" -> "email_retry_60s": "foc-delay=60000"
"foc.retry" -> "email_retry_120s": "foc-delay=120000"
"foc.retry" -> "email_retry_240s": "foc-delay=240000"
"foc.retry" -> "email_retry_480s": "foc-delay=480000"
"email_retry_60s" -> "foc.back": "TTL expiry -> dead-letter"
"email_retry_120s" -> "foc.back": "TTL expiry -> dead-letter"
"email_retry_240s" -> "foc.back": "TTL expiry -> dead-letter"
"email_retry_480s" -> "foc.back": "TTL expiry -> dead-letter"
"foc.back" -> "otp_emails": "otp.email (preserved key)"

# Attempt 5 failure is terminal: dead-letter for inspection, out of the loop.
"email-service" -> "foc.dlq": "attempt 5 fails"
"foc.dlq" -> "otp_emails.dlq": "otp.email"
```

## Rationale

**One consumer, one pipeline.** The parking-lot queues have no consumer; they
are timers that park a message for their queue-level TTL and dead-letter it
back to `otp_emails`. Retried attempts therefore run through the same parse →
dedup → render → send → ack path as the first attempt, distinguished only by
the `x-foc-attempt` header. A consumer on the retry queues would duplicate this
pipeline and let the two paths drift.

**Dedicated `foc.back` return exchange.** Routing retries through the producer's
`foc.events` (as the original design did) would couple the retry loop to a
binding owned by another service; a change to that binding would silently break
retries. `foc.back` is bound only to `otp_emails`, keeping delivery routing and
retry routing independent.

**Service-owned topology.** Asserting the full topology at startup converts a
silent-loss failure (e.g. retry exchange missing) into a loud startup error, and
lets the service run against a broker provisioned from scratch. The scope is
enforced by the AMQP user's configure/write/read permissions.

RabbitMQ classifies a binding as a `write` on the destination queue plus a
`read` on the source exchange (not `configure`), so the `email-service` ACL
grants write over `otp_emails`, the `email_retry_*` parking-lot queues and
`otp_emails.dlq` to allow the startup binds, even though the service never
publishes to those queues directly. Declaring each `email_retry_*` queue with
its `foc.back` DLX also requires write on `foc.back` and read on the queue when
the queue is newly created, so `foc.back` (and the retry queues) are included in
the regex too. `foc.events` stays outside the ACL.

**Shared Redis dedup.** An in-process cache is per instance and per process; it
cannot suppress a crash-redelivery that lands on a different instance or after a
restart. Redis is a single atomic `SET NX EX` round trip and is already part of
the platform. Fail-open is deliberate: an OTP email is worth an occasional
duplicate, never worth being lost.

**Per-hop parking-lot queues for exact backoff.** Queue-level TTL is uniform for
every message in a queue, so a message parked in `email_retry_60s` is delayed
60s, one in `email_retry_480s` is delayed 480s — regardless of what else is
parked. A single retry queue with per-message `expiration` cannot make this
guarantee: RabbitMQ only expires per-message TTLs at the head of the queue, so a
long-TTL message in front blocks shorter-TTL messages behind it and backoff
timing silently drifts under concurrent retries. The retry queues and the
`foc.retry` header bindings are generic (owned by the email service, keyed by
delay, not by message type), so additional email types only add their own
`foc.back` binding — the same parking-lot queues serve every type.

**Headless-matching trap.** RabbitMQ's headers exchange ignores binding-argument
keys that start with `x-` when `x-match` is `all`/`any` (only `all-with-x` /
`any-with-x` match them). A delay header named `x-foc-delay` therefore matches
every binding and fans a retry out to all four parking-lot queues. The header is
deliberately named `foc-delay` (no `x-` prefix); the startup topology asserts
cannot catch this class of bug because it verifies resource existence, not
routing semantics.

**Known tradeoffs.** (a) At-least-once territory: an SMTP timeout that actually
delivered will produce a duplicate on the next attempt — dedup only covers
crash-redelivery. (b) The cumulative retry horizon (~15m) can outlive the OTP
record TTL (10m); a late copy carries a revoked code and the user re-requests.
(c) Redis outage degrades dedup to occasional duplicates (fail-open).

