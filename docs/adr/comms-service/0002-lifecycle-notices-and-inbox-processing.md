# Lifecycle notices and inbox processing

## Context

Communication Service reacts to Order Service lifecycle changes. Order Service
publishes through its transactional outbox, so delivery is at least once and a
consumer can see duplicates or events from independent queues in a different
arrival order. A broker outage or an offline Communication Service must not
lose the notice that will eventually create or close a chat.

The shared `foc.events` exchange is platform infrastructure. Giving a consumer
permission to reconfigure or publish to it would blur service ownership and
allow Communication Service to impersonate a domain-event publisher.

## Decision

The authoritative v1 contracts are:

| Event              | Routing key                  | Payload                                        |
| ------------------ | ---------------------------- | ---------------------------------------------- |
| `ErrandAccepted`   | `order.errand-accepted.v1`   | `errandId`, `requesterUserId`, `courierUserId` |
| `ErrandDelivered`  | `order.errand-delivered.v1`  | `errandId`, `requesterUserId`, `courierUserId` |
| `CourierCancelled` | `order.courier-cancelled.v1` | `errandId`, `requesterUserId`, `courierUserId` |
| `ErrandCancelled`  | `order.errand-cancelled.v1`  | `errandId`                                     |

Infrastructure owns one durable primary queue and exact `foc.events` binding
per routing key. Communication Service cannot configure or publish to
`foc.events`; it owns only `foc.comms.retry`, `foc.comms.back`,
`foc.comms.dlx`, five retry queues per stream, and one DLQ per stream.

Package 2 consumers will validate the envelope, routing key, publisher, and
strict payload before persisting. The envelope `eventId` is the inbox
deduplication identity. Repeated identical delivery is acknowledged safely;
reuse of an event ID with different canonical evidence is rejected to the
stream DLQ. Lifecycle facts are retained so independently arriving terminal
events can be reconciled. A terminal event without a matching chat is still
recorded and acknowledged.

## Consequences

- Notices published while Communication Service is offline remain in durable
  infrastructure-owned queues.
- Consumers must be idempotent and cannot infer lifecycle order from broker
  arrival order.
- Root broker definitions must exist before Order Service publication starts.
- Communication Service startup may provision only its retry topology and
  fails if an expected primary queue is absent.
- Package 1 provisions and verifies topology but intentionally has no lifecycle
  consumer.
