# Use Quorum Queues for Credit Event Durability

## Context

Credit Service consumes `UserRegistered` and will consume additional, independent
event streams for reservations, errand outcomes, and credit transfers. These are
payment-adjacent events: the initial allocation, reservation holds, adjustments,
and transfers must not be silently lost. ADR 0004 established a durable,
at-least-once contract — classic `credit-service.*` queues bound to the shared
`foc.events` exchange, manual acknowledgement, persistent messages, and
publisher confirmation — so that no committed delivery is lost between the main
queue, the retry buckets, and the dead-letter queue.

That contract still holds a gap at the broker. On a classic queue the broker
acknowledges a persistent message once it has been stored, and an in-flight or
acknowledged-but-unacknowledged delivery can be lost if the broker process dies
or its storage is damaged between storage and consumer delivery. On the current
broker, which is a single node, there is no replica to fall back to. The queue is
durable, but the single copy is a single point of failure for the credit event
stream.

## Decision

Credit Service's `foc.events` event queues are declared as `x-queue-type: quorum`
rather than `classic`. A quorum queue stores and replicates each message across a
Raft-controlled group of servers, and a message is never acknowledged to a
publisher until a majority of that group has persisted it.

The decision is applied in the two places the queue type is declared, in
lockstep:

- `rabbitmq/definitions.json` seeds the five critical `credit-service.*` event
  queues as quorum, so a matching destination exists before the service first
  starts.
- `credit-service`'s `RabbitMqConsumerTransport` reasserts each stream's main
  queue, its retry buckets, and its dead-letter queue as quorum at startup and
  after recovery, mirroring the seeded definitions.

Both the seeded definitions and the runtime reassertion carry the same
`x-queue-type: quorum` argument. A mismatch is a `PRECONDITION_FAILED` at
startup, which is intentional: an incompatible broker state must fail visibly
rather than silently downgrade the queue's durability. A unit test asserts the
transport declares the quorum argument, so the lockstep is enforced in code.

The decision is scoped by queue, not by exchange or by service. The shared
`foc.events` exchange and the service-owned `foc.credit.*` retry, retry-return,
and dead-letter exchanges are unchanged. Only Credit Service's own
`credit-service.*` event queues become quorum; the retry and DLQ queues derived
from each stream inherit it, while every other queue in the `foc` vhost — the
`order-service.*` credit outcome and supplier queues, the `email_*` and OTP
queues, and the `supplier-service.*` queue — stays classic.

## Rationale

Quorum queues implement the same at-least-once contract as durable classic
queues — manual acknowledgement, publisher confirmation, retry-by-TTL dead-letter,
and DLQ dead-letter all behave identically — and add Raft-backed replication on
top. Every message is written to a quorum queue only after a majority of the
group has stored it, so an acknowledged delivery survives a broker-node loss
instead of depending on one disk.

RabbitMQ 4.x supports per-queue message TTL and dead-lettering on quorum queues,
so the existing `foc.credit.*` retry buckets and DLQ machinery work unchanged; no
rework of the retry or dead-letter topology is required.

The same quorum declaration is what a multi-node production broker would use, so
the topology already has the shape required for replication. On the current
single-node dev broker the Raft group has one server and the replication factor
is one, so this change does not yet buy crash redundancy. Its value is topology
parity: nothing about the declaration, the transport, or the tests changes when
the queue type is later replicated across three nodes.

This differs deliberately from the email-service OTP broker-topology ADR, which
keeps OTP and password-reset queues classic. Those queues carry short-lived,
best-effort codes with a bounded retry horizon; a lost or duplicate delivery
there is tolerable, and classic queues are lighter. Credit event queues carry
account-creation, reservation, and transfer outcomes that must not be lost, so
they take the replication cost.

## Consequences

- Quorum queues are transparent to the AMQP API: consumers, confirm publishers,
  retry, and dead-letter code are unchanged.
- Queue type is immutable once created; migrating an existing queue requires
  recreating it. In development this means resetting the broker volume, which is
  acceptable on ephemeral infrastructure.
- The queue type must match between `definitions.json` and the transport's
  runtime reassertion; otherwise startup fails with `PRECONDITION_FAILED`. The
  unit test enforces this match.
- Quorum queues add overhead versus classic queues — a leader, a Raft log, and
  coordination on every publish and acknowledge — which is justified only for the
  payment-critical event queues.
- On the current single-node broker the replication factor is one, so the change
  provides durability-by-definition and topology parity, not redundancy. Real
  crash resilience requires later deploying the broker as a three-node cluster,
  after which these same declarations replicate with a majority-consensus write
  requirement.

## Requirement Traceability

- Issues #509 and #516: reliable consumption of `UserRegistered` and
  publication of `CreditAccountInitialised`.
- Issues #510-#515: durable initial allocation and reservation events.
- N6.3: durable messages, publisher confirmation, and acknowledgement after
  commit — strengthened here at the broker by requiring a majority of a Raft
  group to persist a message before it is acknowledged.
- N7.4 and N7.4.1: reliable processing, bounded retries, and dead-letter routing
  preserved on the new queue type.
