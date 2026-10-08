# Reserve and Adjust Credits Atomically

## Context

Credit Service must consume `CreditReservation` and
`CreditReservationAdjustment` events from Order Service. A successful command
moves credits between a requester's spendable and reserved balances, records
the movement immutably, and publishes an authoritative outcome. A command that
cannot be applied must publish a business rejection without changing balances
or appending a ledger transaction.

RabbitMQ provides at-least-once delivery. Commands for the same errand or the
same requester can therefore be duplicated or processed concurrently. Credit
Service must prevent double reservation, lost adjustments, and overdrafts while
retaining the existing inbox, serializable transaction, transactional outbox,
confirmed publication, retry, and dead-letter guarantees.

The requirements call the adjustment success event
`CreditReservationAdjustedSuccess`, while the Sprint 1 roadmap resolves the
name as `CreditReservationAdjustmentSuccess`. The roadmap also lists
`INITIAL_ALLOCATION` as a possible credit transaction type, which conflicts
with ADR 0003's decision to keep issued platform credits in the separate,
immutable `credit_allocations` table.

## Decision

### Event contracts

The shared `@foc/contracts` registry owns these strict versioned contracts:

| Direction | Event type                            | Routing key                                 | Payload                                                              |
| --------- | ------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| Consume   | `CreditReservation`                   | `credit.reservation.v1`                     | `{ errandId, requesterUserId, amount }`                              |
| Consume   | `CreditReservationAdjustment`         | `credit.reservation-adjustment.v1`          | `{ errandId, oldAmount, newAmount }`                                 |
| Publish   | `CreditReservationSuccess`            | `credit.reservation-success.v1`             | `{ errandId, requesterUserId, reservedAmount, creditTransactionId }` |
| Publish   | `CreditReservationRejected`           | `credit.reservation-rejected.v1`            | `{ errandId, requesterUserId, requestedAmount, rejectionReason }`    |
| Publish   | `CreditReservationAdjustmentSuccess`  | `credit.reservation-adjustment-success.v1`  | `{ errandId, newReservedAmount, creditTransactionId }`               |
| Publish   | `CreditReservationAdjustmentRejected` | `credit.reservation-adjustment-rejected.v1` | `{ errandId, requestedAmount, rejectionReason }`                     |

Consumed events require publisher `order-service`; published events use
publisher `credit-service`. User, errand, event, reservation, and transaction
identifiers are UUIDs. Amounts are positive integers within JavaScript's safe
integer range. Contracts reject unknown envelope and payload fields and require
RFC 3339 timestamps ending in uppercase `Z`.

`CreditReservationAdjustmentSuccess` is the only accepted adjustment success
name. `CreditReservationAdjustedSuccess` is not an alias.

Reservation rejection reasons are:

- `MISSING_BALANCE`
- `INSUFFICIENT_CREDITS`
- `RESERVATION_CONFLICT`

Adjustment rejection reasons are:

- `RESERVATION_NOT_FOUND`
- `STALE_RESERVATION_AMOUNT`
- `INSUFFICIENT_CREDITS`

Malformed envelopes, invalid payloads, unsupported routes, and conflicting
reuse of an event ID are transport or contract failures. They are dead-lettered
and do not produce business-rejection events.

### Reservation and transaction persistence

`credit_reservations` contains:

- a UUID primary key;
- a unique UUID `errand_id`;
- `requester_user_id`, referencing `credit_accounts.user_id` with deletion
  restricted;
- a positive `reserved_amount`;
- a status constrained to `ACTIVE`, `TRANSFERRED`, or `RELEASED`;
- a reference to the latest successful credit transaction; and
- creation and update timestamps.

This feature creates and adjusts only `ACTIVE` reservations. The other statuses
are reserved for later transfer and release operations.

`credit_transactions` contains:

- a UUID primary key;
- a type constrained to `RESERVATION`, `RESERVATION_ADJUSTMENT`, `TRANSFER`,
  or `RELEASE`;
- a positive amount representing the absolute amount moved;
- origin and destination user UUIDs, each referencing a credit account;
- origin and destination balance types constrained to `CREDIT_BALANCE` and
  `RESERVED_BALANCE`, with different values;
- the errand UUID; and
- a UTC creation timestamp.

The transaction shape is shared by current and future movements:

| Type                     | User relationship                      | Direction                                  |
| ------------------------ | -------------------------------------- | ------------------------------------------ |
| `RESERVATION`            | Same origin and destination user       | `CREDIT_BALANCE` to `RESERVED_BALANCE`     |
| `RESERVATION_ADJUSTMENT` | Same origin and destination user       | Either direction between the balance types |
| `TRANSFER`               | Different origin and destination users | `RESERVED_BALANCE` to `CREDIT_BALANCE`     |
| `RELEASE`                | Same origin and destination user       | `RESERVED_BALANCE` to `CREDIT_BALANCE`     |

Database checks enforce these relationships and directions. Accepting
`TRANSFER` and `RELEASE` as ledger types prepares the persistence contract; it
does not implement their handlers or event contracts in this feature.

A database trigger rejects updates and deletions of credit transactions. An
initial allocation is not a credit transaction: ADR 0003 remains authoritative,
and initial allocations stay in `credit_allocations`.

The existing inbox is generalized so an event can reference its durable
allocation, transaction, and/or outbox outcome. The allocation reference
becomes nullable; nullable transaction and outbox references are added; and a
check requires every processed inbox row to reference at least one durable
outcome. Reservation successes reference their established transaction and
outbox event. Business rejections reference only their outbox event. Existing
account-initialization rows continue to reference their allocation.

### Transaction boundary and lock order

Contract validation completes before opening a database transaction. Every
valid command then runs through the existing retryable PostgreSQL
`SERIALIZABLE` transaction runner.

Locks are acquired in this order:

1. transaction-scoped advisory lock derived from the incoming event ID;
2. inspect the inbox and verify the canonical payload hash;
3. transaction-scoped advisory lock derived from the errand ID;
4. lock the reservation row when one exists; and
5. lock the requester account row with `FOR UPDATE` when balance state is
   required.

All reservation and later lifecycle operations must preserve the errand,
reservation, then account ordering. The account row serializes commands for
different errands owned by the same requester, while the errand lock also
protects the no-row-yet reservation case.

Within the same transaction, Credit Service records the inbox outcome, applies
all balance and reservation changes, appends any ledger transaction, and adds
the success or rejection event to the outbox. The RabbitMQ delivery is
acknowledged only after commit. Serialization failures and deadlocks use the
existing bounded database retry policy and then flow into the broker's
transient retry policy.

### Reservation behavior

For a new errand, Credit Service locks the requester account and applies these
rules:

- no account produces `MISSING_BALANCE`;
- spendable credit below the requested amount produces
  `INSUFFICIENT_CREDITS`;
- equality is sufficient; and
- success subtracts the amount from `credit_balance`, adds it to
  `reserved_balance`, creates one active reservation, and appends one
  `RESERVATION` transaction whose origin and destination user are both the
  requester and whose movement is from `CREDIT_BALANCE` to
  `RESERVED_BALANCE`.

If the errand already has an active reservation for the same requester and
amount, the command is a semantic replay. Credit Service leaves all persisted
balance, reservation, and ledger state unchanged and publishes a new success
outcome containing the original transaction ID. A different requester, amount,
or non-active status produces `RESERVATION_CONFLICT`.

### Adjustment behavior

Credit Service first locates and locks the active reservation. A missing or
non-active reservation produces `RESERVATION_NOT_FOUND`. The event's
`oldAmount` is a concurrency precondition, not an alternative source of truth;
if it differs from the stored amount, Credit Service produces
`STALE_RESERVATION_AMOUNT` before considering a no-op.

When `newAmount`, `oldAmount`, and the stored amount are equal, Credit Service
does not change balances, update the reservation, or append a transaction. It
publishes success with the reservation's latest transaction ID.

For an effective adjustment:

- an increase moves the positive difference from `credit_balance` to
  `reserved_balance`; insufficient spendable credit produces
  `INSUFFICIENT_CREDITS`;
- a decrease moves the positive difference from `reserved_balance` to
  `credit_balance`; and
- success updates the reservation amount and latest transaction reference and
  appends one `RESERVATION_ADJUSTMENT` transaction for the absolute difference
  with the requester as both users and balance types reflecting the direction.

Business rejections commit inbox and outbox evidence but never modify account
or reservation state and never create a credit transaction.

### Idempotency and durable outcomes

A repeated event ID with the same event type and canonical payload hash is
acknowledged without applying state or publishing another outcome. The
original outbox row remains responsible for eventual delivery. Reusing an
event ID with different content is a permanent failure and is dead-lettered.

A different event ID carrying an equivalent command is processed as a new
request for an outcome. An already-established reservation or a no-op
adjustment publishes a new success event that references the established
transaction ID, without creating another ledger entry. Every newly created
outbox event has its own stable event ID, which remains unchanged across relay
retries.

### Balance reconciliation and invariant failures

For every account, `reserved_balance` must equal the sum of `reserved_amount`
across its active reservations. Each effective operation maintains both sides
by the same delta inside one transaction. Database constraints prevent
negative account balances and non-positive reservation or transaction amounts;
integration and reconciliation tests verify the cross-row aggregate invariant.

An observed mismatch is an internal integrity failure. Credit Service rolls
back and reports an operational failure for retry and eventual DLQ handling; it
does not silently repair data or publish a business rejection.

### RabbitMQ topology ownership

Credit Service owns two independent durable subscriptions:

- `credit-service.credit-reservation.v1`, bound to `credit.reservation.v1`;
- `credit-service.credit-reservation-adjustment.v1`, bound to
  `credit.reservation-adjustment.v1`.

Root RabbitMQ definitions predeclare both main queues and their exact bindings
on the shared durable `foc.events` direct exchange before Order Service enables
the corresponding producers. Credit Service passively checks the shared
exchange and idempotently reasserts its main queues and bindings at startup and
after recovery.

Each main queue owns five retry queues and a `<queue>.dlq`. Retry, retry-return,
and dead-letter exchanges remain shared Credit Service infrastructure created
at runtime, as established by ADR 0004. The existing manual acknowledgement,
persistent publication, publisher confirmation, per-stream isolation,
transactional outbox, and graceful shutdown rules remain unchanged.

Order Service implementation is outside this decision. The shared contracts,
durable destinations, and fixtures allow its producers and outcome consumers
to be integrated later.

## Rationale

Serializing on both the errand and account addresses two distinct races: two
deliveries can try to establish the same reservation before a row exists, and
different errands can compete for one requester's available credits. Keeping
all state and outcome writes in one serializable transaction ensures that an
observer cannot see a partial movement or an outcome for a rolled-back change.

Recording only effective movements keeps the immutable ledger factual. Inbox
and outbox rows retain evidence of replays and business rejections without
inventing zero-value or failed financial transactions. Using the latest
successful transaction for no-op adjustment responses also gives Order Service
a stable correlation result without mutating Credit state.

Representing both participating users and both balance types makes the ledger
uniform across same-user reservation movements, future requester-to-courier
transfers, and same-user releases. Type-specific checks prevent the general
shape from accepting movements that contradict the domain operation.

Predeclaring the two critical queues prevents commands from being lost when
Order Service publishes before Credit Service's first startup. Reusing the
existing multi-subscription transport preserves independent retry capacity and
DLQs for reservation and adjustment streams.

## Consequences

- Concurrent reservations cannot overdraw an account or create two
  reservations for one errand.
- Successful effective movements create exactly one immutable transaction;
  duplicate event IDs, semantic replays, no-op adjustments, and business
  rejections create none.
- A distinct replay event produces a distinct outgoing event ID while retaining
  the established credit transaction ID.
- The stored reservation is authoritative, so stale adjustment commands are
  rejected even when their requested target equals the current amount.
- Business rejection events are reliable transactional outcomes; malformed or
  operationally exhausted messages remain DLQ concerns.
- The protected balance and sufficiency HTTP endpoints remain read-only and
  advisory.
- Transfer, release, completion/cancellation handling, and transaction-history
  APIs remain future work.

## Requirement Traceability

- Issues #522-#530: reserve credits and publish success or rejection outcomes.
- Issues #531-#537: immutable reservation transaction details.
- Issues #538-#544: adjust active reservations and publish success or rejection
  outcomes.
- ADR 0003: account balances, serializable processing, inbox/outbox atomicity,
  and separate immutable initial allocations.
- ADR 0004: durable multi-subscription topology, retries, DLQs, publisher
  confirmations, and outbox recovery.
- ADR 0005: reservation decisions recheck and lock balances independently of
  advisory sufficiency reads.
