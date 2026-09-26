# Provide Reliable Multi-Subscription Event Delivery

## Context

Credit Service consumes `UserRegistered` and will consume additional,
independent event streams for reservations and errand outcomes. It publishes
`CreditAccountInitialised` and must not lose committed outgoing events.

RabbitMQ and service instances can restart, handlers can fail transiently,
messages can be malformed, and a slow or failing stream must not consume the
delivery capacity or dead-letter operations of unrelated streams. The service
therefore needs durable topology, bounded consumer retries, per-stream
isolation, publisher confirmation, and recovery of unpublished outbox events.
Critical events also need a durable destination before their consumer's first
startup; an exchange cannot retain a publication that has no matching queue.

## Decision

### Multi-subscription topology

One Credit Service process uses one recovering RabbitMQ consumer connection and
one shared confirm-publisher channel for retry and dead-letter publication. The
durable domain direct exchange and the service-owned retry, retry-return, and
dead-letter direct exchanges are shared.

Root infrastructure owns `foc.events`; both Credit Service connections use a
passive existence check and never declare or alter it. Root definitions also
seed the durable main queue and exact domain binding for each critical Credit
subscription before its producer is enabled. Credit Service remains the
semantic owner and idempotently reasserts that queue and binding at startup and
after recovery. It actively declares its `foc.credit.*` exchanges and all
`credit-service.*` main, retry, and dead-letter queues. Broker resource
permissions enforce the namespace boundary, while validated configuration and
explicit bindings restrict the current application keys.

The initial seeded subscription is `credit-service.user-registered.v1`, bound
to `foc.events` with `user.registered.v1`. Retry exchanges, retry queues, the
retry-return binding, and the DLQ are not predeclared because no retry can exist
before Credit Service has consumed an initial delivery.

Each subscription supplies a durable queue, one versioned routing key, and one
handler. The queue name identifies the subscription, and duplicate queues or
queue-name collisions are startup errors. Different queues may bind the same
routing key for intentional fan-out.

Each subscription receives its own consumer channel and configurable prefetch
window. For a subscription queue `<queue>`:

- retries use `<queue>.retry.1` through `<queue>.retry.5`;
- permanent failures use `<queue>.dlq` unless the subscription explicitly
  provides another DLQ;
- retry TTL expiry routes the original bytes through the retry-return exchange
  using the main queue name as the routing key.

The main queue has two bindings: its versioned domain key on `foc.events` for
new events, and its queue name on `foc.credit.back` for returned retries. The
transport accepts only those route-and-attempt combinations. Handlers always
receive the logical domain routing key and do not depend on the physical retry
route.

Subscriptions may be registered after the connection starts. Recovery
redeclares shared topology and recreates every registered subscription.
Unexpected consumer cancellation or channel failure recycles the connection so
all streams return in a consistent generation.

### Consumer acknowledgement and retries

Consumers use manual acknowledgement and persistent publications.

- A successful or idempotently completed delivery is acknowledged only after
  its handler's durable work commits.
- A transient failure is published to the next retry queue with an incremented
  `x-retry-count`. The initial attempt plus five retries are permitted.
- Failure after retry five, malformed JSON, invalid retry metadata, a routing
  mismatch, or a permanent handler rejection is published to the owning
  stream's DLQ.
- Retry and dead-letter publication must receive publisher confirmation before
  the original delivery is acknowledged. If publication cannot be confirmed,
  the original delivery is negatively acknowledged and requeued.

Republished messages preserve the original bytes and safe message properties.
Transport-owned retry and failure headers are replaced with sanitized values;
payload values and arbitrary exception messages are not included.

### Outbox publication

The outbox relay uses a separate recovering RabbitMQ connection and confirm
channel. It claims a configurable batch of unpublished rows, publishes each
stored envelope unchanged to the durable domain exchange, and sets
`published_at` only after broker confirmation and socket drainage.

Rows that fail publication record a bounded, sanitized error, release their
claim, and are retried indefinitely by later polling cycles. Multiple relay
instances coordinate through expiring PostgreSQL claims and
`FOR UPDATE SKIP LOCKED`. Events older than the configured warning threshold
are logged with operational metadata but without their envelope.

### Shutdown

On shutdown, Credit Service stops registering work and scheduling outbox polls,
cancels every consumer, and waits for in-flight handlers and publisher
confirmations. It then closes consumer channels, publisher channels, and their
recovering connections. Shutdown and close operations are idempotent.

### Topology and processing flow

The following D2 diagram uses the TALA layout engine.

```d2
# Credit Service - generic inbound/outbound event flow (namespaced)
direction: down

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
  module: {
    shape: square
  }
}

# --- External actors (outside Credit Service) ---
producer: "Producer services\n(user-service, order-service, ...)"
producer.class: svc
producer: {
  top: 0
  left: 0
}

consumer: "Consumer services"
consumer.class: svc
consumer: {
  near: top-left
}
# --- Shared broker topology (outside Credit Service) ---
"foc.events": "foc.events (shared durable direct)"
"foc.events".class: exchange
"foc.events": {
  top: 0
  left: 500
  # near: top-center
}
# --- Credit Service modules ---
Credit Service.MessagingModule: "MessagingModule\n(N-stream transport,\nretry/DLQ,\npublisher confirms)"
Credit Service.MessagingModule.class: module
Credit Service.OrchestrationModule: "OrchestrationModule\n(e.g. AccountInitialization,\nCreditReservation)"
Credit Service.OrchestrationModule.class: module
Credit Service.SharedDomainModule: "SharedDomainModule\n(allocation,\nreservations, etc)"
Credit Service.SharedDomainModule.class: module
Credit Service.OutboxModule: "OutboxModule\n(transactional outbox relay)"
Credit Service.OutboxModule.class: module

# --- Per-stream topology (consumer-owned; critical main queues also seeded) ---
Credit Service.event-queue: "credit-service.<event>.v1\n(predeclared when critical)"
Credit Service.event-queue.class: queue
Credit Service.retry-buckets: "credit-service.<event>.v1.retry.1..5 (TTL)"
Credit Service.retry-buckets.class: queue
Credit Service.event-dlq: "credit-service.<event>.v1.dlq"
Credit Service.event-dlq.class: queue
Credit Service."foc.<service>.retry": "foc.<service>.retry (direct)"
Credit Service."foc.<service>.retry".class: exchange
Credit Service."foc.<service>.back": "foc.<service>.back (direct)"
Credit Service."foc.<service>.back".class: exchange
Credit Service."foc.<service>.dlx": "foc.<service>.dlx (direct)"
Credit Service."foc.<service>.dlx".class: exchange

# --- Publish (in) ---
producer -> "foc.events": "<event>\n(e.g. user.registered.v1)"
"foc.events" -> Credit Service.event-queue: "bound on\n'<event>.v1'"

# --- Consume -> orchestrate ---
Credit Service.event-queue -> Credit Service.MessagingModule: "delivery"
Credit Service.MessagingModule -> Credit Service.OrchestrationModule: "decoded message\ntransport checks passed"
Credit Service.OrchestrationModule -> Credit Service.SharedDomainModule: "mutate in same\nDB transaction"
Credit Service.OrchestrationModule -> Credit Service.OutboxModule: "outcome row written in-transaction;\nrelay polls & publishes"

# --- Retry / dead-letter (per stream) ---
Credit Service.MessagingModule -> Credit Service."foc.<service>.retry": "transient failure"
Credit Service."foc.<service>.retry" -> Credit Service.retry-buckets: "x-retry-count 1..5"
Credit Service.retry-buckets -> Credit Service."foc.<service>.back": "TTL expiry"
Credit Service."foc.<service>.back" -> Credit Service.event-queue: "queue-identity route\nre-delivers unchanged"
Credit Service.MessagingModule -> Credit Service."foc.<service>.dlx": "malformed / retries exhausted"
Credit Service.OrchestrationModule -> Credit Service."foc.<service>.dlx": "validation error flagged"
Credit Service."foc.<service>.dlx" -> Credit Service.event-dlq: "bind + publish"

# --- Outbound relay ---
Credit Service.OutboxModule -> "foc.events": "publisher confirms, '<result>.v1'"
"foc.events" -> consumer: "<result> event\n(e.g. credit.account-initialised.v1)"
```

## Rationale

RabbitMQ durable exchanges and queues, manual acknowledgements, persistent
messages, and publisher confirms are established industry mechanisms for
at-least-once delivery. They make the point at which the broker accepts a
replacement message explicit, avoiding message loss between the main queue,
retry queues, and DLQ.

Predeclaring only critical main queues closes the first-start routing window
without moving service-internal retry topology into central infrastructure.
Retaining matching runtime declarations keeps topology recovery with the
consumer and makes incompatible broker state fail visibly during startup.

Broker-managed TTL retry queues keep retry delays durable across process
restarts and avoid sleeping application workers. Direct exchanges make domain,
retry, return, and dead-letter destinations explicit. The domain exchange uses
exact versioned bindings and can still fan out intentionally when multiple
queues bind the same key. Returning an expired retry by queue identity prevents
it from passing through the shared domain key and being delivered again to
sibling queues that already handled the original event.

One consumer channel and DLQ per stream isolates prefetch, failures, and
operations as the number of Credit Service handlers grows. Sharing the
connection and confirm publisher avoids unnecessary connection overhead.
NestJS lifecycle hooks provide clear startup and graceful-shutdown boundaries,
while the recovering AMQP client can rebuild topology without embedding
reconnection logic in domain handlers.

The transactional outbox is the standard complement to manual consumer
acknowledgement when a service coordinates PostgreSQL state with RabbitMQ. It
preserves committed outgoing events without requiring distributed
transactions, accepting possible duplicates instead of risking message loss.

## Consequences

- Broker or service restarts do not discard durable queued messages or
  committed outgoing events.
- A critical main queue can buffer events before Credit Service first starts.
- Adding a critical subscription requires deploying its root definition before
  enabling the producer, while Credit still owns and reasserts the topology.
- Streams have independent prefetch windows, retry chains, and DLQs, so a slow
  stream does not consume another stream's allowance.
- Effective process-wide prefetch grows with the number of subscriptions.
- Five retry queues per stream add broker topology and operational overhead but
  make the retry schedule explicit and durable.
- The retry-return exchange is service-wide, while its queue-name routing keys
  preserve per-stream isolation.
- A failed consumer channel briefly reconnects every stream because they share
  one recovering connection.
- Operators monitor and replay one DLQ per stream; replay tooling is outside
  this decision.
- Outbox publication can occur more than once after an uncertain confirmation
  or process failure, so consumers must be idempotent.
- Runtime and RabbitMQ channel limits remain the practical bound on the number
  of subscriptions.
- Deployments that used a custom legacy global DLQ must drain or migrate it
  before adopting derived per-stream DLQ names.
- Adopting the retry-return exchange requires stopping Credit Service, waiting
  at least the longest retry delay, confirming retry queues are empty, deleting
  only `<queue>.retry.1..5`, and restarting. RabbitMQ rejects the old queues'
  incompatible dead-letter arguments rather than changing them silently. See
  RabbitMQ's [dead-letter exchange documentation](https://www.rabbitmq.com/docs/dlx).

## Requirement Traceability

- N6.3-N6.3.2: durable messages, publisher confirmation, and acknowledgement
  after commit.
- N7.4: five exponential retries followed by dead-letter routing.
- N7.4.1: log dead-letter event IDs and reasons and preserve replayable
  messages.
- N7.6: retry the outbox until confirmation and warn about stale unpublished
  events.
- Issues #509 and #516: reliable consumption of `UserRegistered` and
  publication of `CreditAccountInitialised`.
