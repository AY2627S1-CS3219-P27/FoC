# Transactional outbox and broker access

## Context

Order-service must tell credit-service (and later supplier-service) about
state changes: reservation requests, `ErrandCompleted`, `ErrandCancelled`
(ADR 0002, ADR 0006). The errand state lives in Postgres and the notice goes to
RabbitMQ, and the two cannot commit together. Publishing after the commit
(the original sketch in `ARCHITECTURE.md` §3) loses the notice if the process
dies in between, which strands an errand in `Reserving-Credit` or means credits
are never transferred.

## Decision

Follow credit-service ADR 0003/0004 and copy its design (copy, do not extract
a shared package yet; revisit when supplier-service becomes the third user).

- **Outbox table.** `outbox_events` (Drizzle, migration `0006`) holds one row per
  notice: `event_id` (PK), `event_type`, `routing_key`, the full `envelope`
  (jsonb), and delivery bookkeeping (`created_at`, `published_at`,
  `attempt_count`, `last_error`, `next_attempt_at`, `claimed_by`,
  `claimed_until`). A partial index covers unpublished rows only.
- **Same-transaction insert.** `enqueueOutbox(tx, event)` inserts a row using the
  caller's transaction, so the notice commits or rolls back with the state
  change. It is **not yet called** from `transition()` / `createErrand()`: that
  waits for the event contracts (see Not decided).
- **Relay.** `OutboxRelay` polls every `OUTBOX_POLL_INTERVAL_MS`.
  `OutboxStore.claim` selects due rows with `FOR UPDATE SKIP LOCKED` and sets a
  lease (`claimed_by`, `claimed_until`), so several instances never take the same
  row and a crashed worker's rows become claimable again once the lease expires.
  `markPublished` / `markFailed` only act while `claimed_by` still matches, so a
  worker that lost its lease cannot finalise someone else's row. Failures back
  off exponentially (`OUTBOX_RETRY_BASE_DELAY_MS` doubling up to
  `OUTBOX_RETRY_MAX_DELAY_MS`). Timestamps use `clock_timestamp()` because
  `now()` is frozen at transaction start.
- **Publisher.** `RabbitMqOutboxPublisher` publishes the stored envelope unchanged
  on a confirm channel to `RABBITMQ_EXCHANGE` (`foc.events`), persistent, with
  `messageId` = event id. `published_at` is set only after the broker confirms.
  The exchange is checked passively; the root broker owns it.
- **Delivery guarantee.** At least once. A confirm that arrives after the lease
  expired, or a crash between confirm and `markPublished`, produces a duplicate.
  Consumers must deduplicate on the envelope `eventId`. The confirm means the
  exchange accepted the message, not that a queue received it: a direct exchange
  drops a message with no bound queue, so the consuming service's queue must be
  seeded before order publishes that routing key (P3 in
  `order-messaging-feature-docs.md`).
- **Config.** `OUTBOX_CLAIM_LEASE_MS` must exceed `OUTBOX_CONFIRM_TIMEOUT_MS` by at
  least 5 s (validated at startup), otherwise a slow successful publish could
  lose its claim and be sent twice.
- **Broker access.** Order-service has its own `order-service` user in
  `rabbitmq/definitions.json`: configure/write on
  `^(foc\.order\.(retry|back|dlx)|order-service\..+)$`, read on the same plus
  `foc.events`. Its password is the Docker secret
  `order-service/secrets/rabbitmq_password.secret`; the committed hash must match
  it. Connection uses amqplib with recovery (`AMQP_CONNECT` token, replaceable in
  tests).
- **Startup.** The relay starts in `OnApplicationBootstrap` and fails startup if
  the broker is unreachable or `foc.events` does not exist. Shutdown stops the
  timer, waits for the poll in flight and outstanding confirms, then closes the
  channel and connection. Migrations are not run on startup, so the table must
  exist (`npm run db:migrate`) or the first poll crashes the app.

## Not decided / not built

- **Event contracts.** Which notices exist, their routing keys and payloads are
  to be agreed with the credit owner and put in `@foc/contracts`. Until then
  nothing writes to `outbox_events` and no event types are defined.
- **Consumer side.** The consumer transport (`foc.order.{retry,back,dlx}`, retry
  queues, DLQs) and the reply handlers are not built. The plan is to reuse
  `idempotency_keys` as the inbox, with `transition()`'s `idempotencyKey` set to
  the envelope `eventId`.
- **Queue naming.** ADR 0002's `order_service.credit_replies` breaks the
  `<service>.<event>.vN` convention and falls outside the `order-service\..+`
  permission pattern, and its "one queue per counterpart" conflicts with the
  transport's one routing key per subscription. Queues will be named
  `order-service.<event>.vN`; ADR 0002 carries a note pointing here.
- **Retention.** Published rows are never deleted. A cleanup job is not needed
  until volume warrants it.
