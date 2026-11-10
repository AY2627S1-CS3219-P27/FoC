# Consume Fact Events From One Pub/Sub Queue

## Context

Credit Service had one quorum queue per consumed contract, each bound to the
direct exchange `foc.events` ([ADR 0004](0004-reliable-event-delivery.md),
[ADR 0009](0009-quorum-queues-for-credit-event-durability.md)).
[ADR 0002](../0002-topic-pubsub-exchange-for-domain-events.md) later added
`foc.pubsub`, which receives every contract whose registry entry has
`kind: 'event'`; message contracts stay point-to-point.

Credit Service consumes two kinds of contract:

- **Messages** addressed to it: `credit.reservation.v1`,
  `credit.reservation-adjustment.v1`, and `credit.settlement.v1`.
- **Fact events** published by others: `user.registered.v1`,
  `order.errand-completed.v1`, and `order.errand-cancelled.v1`.

The fact events were still consumed point-to-point from `foc.events`, with three
queues, three retry chains, and three dead-letter queues.

## Decision

Credit Service consumes its fact events from a single quorum queue,
`credit-service.events`, bound to `foc.pubsub` with exactly the three routing
keys above. The messages keep their dedicated queues on `foc.events`.

The consumer transport accepts a subscription with several routing keys and an
optional source exchange. One handler, `CreditEventsMessageHandler`, routes each
delivery by its routing key to the existing use case, which still validates its
own contract and acknowledges only after its durable work commits.

Bindings use the explicit keys rather than a wildcard so the queue holds only
events Credit Service handles. Adding an event is a binding change plus a
handler registration.

A returned retry arrives on the queue-named route, so the transport carries the
delivered routing key in the `x-original-routing-key` header on retry and
dead-letter publications. A retry without the header is accepted only for a
single-key subscription.

Root definitions own the queue and its bindings, and the `credit-service` user
gains `read` on `foc.pubsub`. The three previous event queues and their
`foc.events` bindings are removed.

## Consequences

- One queue, retry chain, and DLQ replace three for events, matching
  comms-service's `comms-service.events`.
- Events now share ordering and head-of-line blocking. A slow or failing event
  delays its siblings until it retries or dead-letters. Handlers are idempotent
  by `eventId`, so ordering across event types is not relied on, and account
  initialisation arriving before a completion is the common case anyway.
- Retry and dead-letter capacity is no longer isolated per event type.
- Unprocessed messages in the removed queues are not migrated. Drain them
  before deploying to an environment that holds real traffic.
- Exchange-to-exchange routing preserves the original exchange name on delivery,
  so the transport accepts the domain or the bound exchange for initial
  deliveries; the queue's own bindings enforce the pub/sub hop.
- ADR 0004's seeded `credit-service.user-registered.v1` subscription is
  superseded for events; its delivery guarantees are unchanged.

## Requirement Traceability

- N3.2.1: route asynchronous events through a message broker.
