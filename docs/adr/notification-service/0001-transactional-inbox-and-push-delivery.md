# Transactional Inbox and Push Delivery

## Context

Notification Service must deliver the platform's fact events to the Web Push
subscriptions a user has registered. Order Service publishes through a
transactional outbox, so delivery is at least once: a consumer can see the same
envelope more than once, and a broker outage must not lose a notification.
Web Push has no server-side idempotency — sending the same event twice shows
the notification twice.

The shared `foc.pubsub` topic exchange (ADR 0002) is broker infrastructure. A
consumer binds its own queue; it must not declare or publish to `foc.events`.

## Decision

1. Root `rabbitmq/definitions.json` owns one durable queue,
   `notification-service.inbox`, bound to `foc.pubsub` with routing key
   `order.#`. The filter admits the whole order lifecycle — including contracts
   this service does not push yet — without consuming the credit, supplier, and
   user traffic on the same exchange. Unregistered routing keys are skipped and
   acknowledged, as ADR 0002 requires.
2. The service owns only its retry chain on the shared headers exchange
   `foc.retry` (`foc-delay` selects one of five delay buckets), its return
   binding on `foc.back`, and its dead-letter queue on `foc.dlq`.
3. Consumers validate the envelope, publisher, and payload with
   `AccountEventContractValidator.validateReceived` before any persistence.
   Invalid messages are dead-lettered; unregistered contracts are skipped.
4. `inbox_events` records `event_id` as its primary key plus a canonical
   payload hash. A redelivery with the same evidence is acknowledged; reuse of
   an event id with different evidence is dead-lettered.
5. Dispatch is a handler registry, not a routing-key lookup table. Each
   pushable contract has one typed dispatcher in `src/dispatch/dispatchers/`,
   keyed by the contract's routing-key constant and wired through the shared
   `DomainEventDispatcher`. Payload fields therefore come from
   `EventOf<TKey>` rather than string maps. A dispatcher decides the recipients
   and the push message; `DispatchService.enqueue` writes one
   `notification_deliveries` row per active subscription, idempotently on
   `(event_id, subscription_id)`, and stores the message on the row.
6. Ingest and enqueue are separate transactions. This is safe because enqueue
   is idempotent and a broker redelivery re-runs the dispatcher: a crash
   between the two leaves an inbox row that the next delivery completes, and a
   crash after enqueue leaves pending rows that `deliverPending` resumes. A
   delivery moves `pending → sent` or `pending → abandoned`, so an endpoint
   that already received a push is never pushed again.
7. A push service answering 404 or 410 marks the delivery abandoned and
   soft-deletes the subscription. Other failures throw, so the transport
   retries the event with backoff before dead-lettering it.

## Consequences

- A notification is delivered at least once to each active subscription that
  existed when the event was dispatched; subscriptions created later do not
  receive historical events.
- The schema is migration-owned (`DB_MIGRATIONS_RUN`); synchronize is disabled.
- Adding a user-facing order event needs one dispatcher file and one entry in
  `dispatch-handlers.ts`, not a new queue or a string-keyed map; a non-order
  event also needs its routing key added to the queue's `foc.pubsub` binding.
- A dead-lettered event leaves its still-pending deliveries visible in the
  table for inspection; they are not retried automatically.
