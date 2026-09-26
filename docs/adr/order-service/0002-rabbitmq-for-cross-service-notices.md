# RabbitMQ for Supplier/Credit notices

## Decision

Order-service exchanges notices with Supplier Service and Credit Service
(supplier validation, `CreditReservation`/`Adjustment`/`Release` and their
outcomes, `ErrandCompleted`/`ErrandCancelled`) over the existing RabbitMQ
broker, not synchronous HTTP and not Kafka.

## Rationale

The backlog requires these exchanges to be non-blocking (F1.4.2: "shall not
block the creation request on its outcome"), which is a natural fit for a
message broker and a poor fit for synchronous HTTP. RabbitMQ is already
running in this repo with a working topology (`foc.events` exchange,
per-service users, a documented retry/DLQ pattern) that a new service can
join by adding a user and bindings.

Kafka was considered and rejected: its strengths (partitioned, retained,
independently-replayable topic logs for high-throughput streaming or
multiple unrelated consumer groups) don't match this workload, which is
moderate-volume correlated request/reply with two specific counterpart
services. Adopting it would mean operating a second broker technology
alongside RabbitMQ for capabilities this service doesn't use.

## Request/reply mechanics

Correlation uses the errand id itself, not a separately-generated request id:
the state machine only ever has one reservation/validation outstanding per
errand at a time, so the errand id is a sufficient and simpler correlation
key.

Order-service owns a durable, order-service-consumed reply queue per
counterpart (e.g. `order_service.credit_replies`), bound to that service's
outcome routing keys — the same dedicated-queue-per-consumer shape
email-service's topology (docs/adr/email-service/002) already uses, rather
than AMQP's built-in direct-reply-to pseudo-queue. Direct-reply-to is scoped
to the connection/channel that made the request, which suits synchronous
RPC where the caller blocks on that same connection; here the outcome can
arrive an arbitrary time later (counterpart processing time, retries) and
may be picked up by a different order-service replica than the one that made
the request. A durable, order-service-owned queue survives restarts and
doesn't depend on which instance's consumer eventually drains it.
