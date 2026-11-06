# Lifecycle notices and inbox processing

## Context

Communication Service reacts to Order Service lifecycle changes. Order Service
publishes through its transactional outbox, so delivery is at least once and a
consumer can see duplicates or independently published events in a different
arrival order. A broker outage or an offline Communication Service must not
lose the notice that will eventually create or close a chat.

The shared `foc.events` and `foc.pubsub` exchanges are platform infrastructure.
Giving a consumer permission to reconfigure or publish to them would blur
service ownership and allow Communication Service to impersonate a publisher.

## Decision

The authoritative v1 contracts are:

| Event              | Routing key                  | Payload                                        |
| ------------------ | ---------------------------- | ---------------------------------------------- |
| `ErrandAccepted`   | `order.errand-accepted.v1`   | `errandId`, `requesterUserId`, `courierUserId` |
| `ErrandDelivered`  | `order.errand-delivered.v1`  | `errandId`, `requesterUserId`, `courierUserId` |
| `CourierCancelled` | `order.courier-cancelled.v1` | `errandId`, `requesterUserId`, `courierUserId` |
| `ErrandCancelled`  | `order.errand-cancelled.v1`  | `errandId`                                     |

Infrastructure forwards registered fact events from `foc.events` to
`foc.pubsub`. Communication Service owns one durable `comms-service.events`
queue bound to `foc.pubsub` with `order.#`, plus `foc.comms.retry`,
`foc.comms.back`, `foc.comms.dlx`, one five-stage retry family, and one DLQ.
The runtime identity may read `foc.pubsub` to create its binding but cannot
configure or publish to either shared exchange. Other Order routes are
acknowledged as skipped until a handler is deliberately added.

Lifecycle consumers validate the envelope, routing key, publisher, and
strict payload before persisting. The envelope `eventId` is the inbox
deduplication identity. Repeated identical delivery is acknowledged safely;
reuse of an event ID with different canonical evidence is rejected to the
unified DLQ. Lifecycle facts are retained so independently arriving terminal
events can be reconciled. A terminal event without a matching chat is still
recorded and acknowledged.

## Consequences

- Notices published after the service-owned queue is provisioned remain there
  while Communication Service is offline.
- Consumers must be idempotent and cannot infer lifecycle order from broker
  arrival order.
- Root broker definitions and Communication Service topology provisioning must
  complete before Order Service publication starts.
- Communication Service startup provisions its queue, pub/sub binding, retry
  family, and DLQ and fails if `foc.pubsub` is unavailable.
- Topology provisioning and consumer activation remain separate startup
  responsibilities.
