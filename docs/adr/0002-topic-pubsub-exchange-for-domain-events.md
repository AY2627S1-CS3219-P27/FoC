# Publish Fact Events Through a Topic Exchange

## Context

[ADR 0001](0001-domain-event-contracts-and-routing.md) routes every message
through the durable direct exchange `foc.events`. A direct binding selects one
exact routing key, so a new consumer of an existing event requires a reviewed
topology change, and there is no way to observe the event stream without
knowing the publisher/consumer topology in advance.

Some messages on the bus are point-to-point requests (for example
`credit.reservation.v1` and `order.supplier-validation-requested.v1`), while
others are fact-shaped events that more than one service may legitimately want
to observe (for example `CreditReservationSuccess` or `ErrandAccepted`). Only
the latter benefit from publish/subscribe delivery.

## Decision

Introduce the durable topic exchange `foc.pubsub`.

Exchange-to-exchange bindings from `foc.events` to `foc.pubsub` forward exactly
the contracts whose registry entry has `kind: 'event'`. Message contracts
(`kind: 'message'`) are never forwarded and remain point-to-point.

Because exchange-to-exchange bindings duplicate rather than move a matched
message, publishers are unchanged: a publish to `foc.events` still reaches its
existing consumer queue, and additionally reaches `foc.pubsub` when the routing
key is forwarded.

Consumers bind their own queues to `foc.pubsub` with topic patterns
(`credit.*.v1`, `order.errand-*.v1`) or `#` for the whole stream. A shared
`DomainEventDispatcher` in `@foc/contracts` routes each received message to the
handler registered for its routing key, selecting and validating the contract
with `AccountEventContractValidator.validateReceived`. Registered events without
a handler, and unregistered routing keys, are skipped rather than dead-lettered
so that broad subscriptions do not fail on event types they do not implement.

The registry's `kind` field and the `foc.events -> foc.pubsub` bindings in
`rabbitmq/definitions.json` are kept in sync by a contract-package test.

## Rationale

A topic exchange gives server-side selection: a subscriber's binding decides
which event families enter its queue, so unwanted events consume no network,
queue, or consumer capacity. Fanout would deliver every event to every
subscriber and push the same filtering into application code.

Forwarding from the existing direct exchange preserves the current
point-to-point path, the transactional outbox, and every publisher and consumer
without coordinated change. It also keeps point-to-point messages off the
broadcast bus.

Classifying contracts in the registry, rather than maintaining a second list of
routing keys, keeps the wire contract and the bus topology from drifting.

## Consequences

- New fact-event subscribers need no change to the publisher or to
  `definitions.json`; they bind a queue to `foc.pubsub`.
- Consumers of multiple event types must handle unknown routing keys as skips,
  not failures, or use narrow bindings.
- Point-to-point messages continue to require an explicit queue binding on
  `foc.events`.
- Each forwarded message is duplicated: one copy for direct consumers, one for
  the topic exchange. Retry and dead-letter state is per queue and therefore
  independent.
- Consumer users need `write` permission on `foc.pubsub` and, for temporary
  auto-delete queues, `configure`/`read` permission on `amq.gen-*`.
- Message ordering is preserved per queue, not between different event types
  that a broad subscription multiplexes; consumers rely on the state machine
  and `eventId` idempotency as before.

## Requirement Traceability

- N3.2.1: route asynchronous events through a message broker.
