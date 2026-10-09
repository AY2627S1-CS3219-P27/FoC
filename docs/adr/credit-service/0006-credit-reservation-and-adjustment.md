# Reserve and Adjust Credits Atomically

## Context

Credit Service must consume `CreditReservation` and
`CreditReservationAdjustment` events from Order Service. A successful command
moves credits between a requester's spendable and reserved balances, records
the movement immutably, and publishes an authoritative outcome. A command that
cannot be applied must publish a business rejection without changing balances
or appending a ledger transaction.

RabbitMQ provides at-least-once delivery, but its bounded transport retry must
not be the durable scheduler for valid financial work. Commands for the same
errand or requester can be duplicated or processed concurrently, and transient
execution failures can outlive one broker delivery. Credit Service must persist
accepted reservation work before acknowledgement, execute it through
recoverable leases, and still prevent double reservation, lost adjustments,
and overdrafts.

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
- a status constrained to `ACTIVE`, `CONSUMED`, or `RELEASED`;
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

`credit_operations` separates durable processing state from financial
reservation state. Lifecycle operations use a semantic `RESERVE`, `TRANSFER`,
or `RELEASE` identity per errand and type. Each `ADJUST` row instead represents
one repeatable command and is uniquely identified by its incoming event ID.
Operations have `PENDING`, `SUCCEEDED`, or `REJECTED` status; amount and
canonical request hash; retry scheduling and lease metadata; sanitized failure
information; and optional completion transaction and outcome-event references.
`ADJUST` additionally stores the expected old amount and uses `amount` as its
target. Its requester is nullable at ingress and is populated when execution
resolves an active reservation. Operation participants are not foreign-keyed
to accounts so valid commands can remain durable before business evaluation.

The existing inbox is generalized so an event can reference its durable
allocation, credit operation, transaction, and/or outbox outcome. A check
requires every processed inbox row to reference at least one such outcome.
Accepted reservation and adjustment ingress reference their operations.
Completed successes also reference their transaction and outcome event, while
business rejections reference their outcome event. Existing
account-initialization rows continue to reference their allocation.

`PENDING` is processing state and does not imply that funds have moved. A
`credit_reservations` row is created only when the worker successfully reserves
funds. `REJECTED` is a permanent domain result; technical failures leave the
operation `PENDING`.

### Durable ingress, execution boundary, and lock order

Contract validation completes before opening a database transaction. Valid
reservation and adjustment ingress use the existing retryable PostgreSQL
`SERIALIZABLE` runner to persist an inbox row and operation before RabbitMQ
acknowledgement. Both lock the incoming event ID and verify the inbox payload
hash. Reservation ingress then locks the errand and applies semantic identity;
adjustment ingress creates one `PENDING/ADJUST` operation for each distinct
event ID without reading or changing financial state.

A polling worker claims due pending operations with `FOR UPDATE SKIP LOCKED`, a
unique claimant ID, and an expiring lease. The claim commits before execution.
Execution then acquires locks in this order:

1. the claimed operation row;
2. transaction-scoped advisory lock derived from the errand ID;
3. the requester account row with `FOR UPDATE`, when it exists; and
4. the reservation row with `FOR UPDATE`, when it exists.

For adjustments, the errand lock permits an initial unlocked reservation read
to discover the requester; execution then locks the requester account before
locking and revalidating the reservation. The account row serializes operations
for different errands owned by one requester, while the errand lock protects
the no-row-yet reservation case. The
financial transaction atomically applies balances, reservation state, the
ledger entry, terminal operation state, linked inbox outcomes, and the outbox
event.

If execution fails before commit, the worker leaves the operation `PENDING`,
records sanitized attempt metadata when the database is available, clears or
allows expiry of the lease, and schedules capped exponential backoff. Attempts
have no terminal limit. Operations older than the configured threshold produce
an operational warning but remain retryable. If publication fails after the
financial commit, the operation remains terminal and the existing outbox relay
owns publication recovery.

### Reservation behavior

Ingress for a new errand creates a due `PENDING/RESERVE` operation without
reading or changing balances. The worker later locks current financial state
and applies these rules:

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

Ingress creates a repeatable `PENDING/ADJUST` operation containing the event
ID, expected `oldAmount`, target `newAmount`, and canonical hash, then commits
before RabbitMQ acknowledgement. The worker later locates the active
reservation. A missing or
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

Business rejections atomically mark the operation `REJECTED` and commit inbox
and outbox evidence, but never modify account or reservation state or create a
credit transaction. Technical failures keep the operation `PENDING` and use
the same lease recovery and indefinite capped-backoff retry as reservations.

Adjustment commands are identified by event ID. Redelivery of the same event ID
and canonical payload returns its stored outcome without another outbox event or
movement. Reusing that event ID with different content is a permanent transport
failure. A different event ID is always a fresh command evaluated against the
current locked reservation and account state, even when its payload matches an
earlier command. Consequently, repeating a successful effective transition
normally produces `STALE_RESERVATION_AMOUNT`, while repeating an earlier
business rejection may succeed if the relevant state has since changed. A
fresh no-op command publishes its own success outcome with the reservation's
latest transaction ID but creates no ledger movement.

### Idempotency and durable outcomes

A repeated event ID with the same event type and canonical payload hash is
acknowledged without applying state or publishing another outcome. Reusing an
event ID with different content is a permanent failure and is dead-lettered.

Reservation operations additionally have semantic identity. While one is
pending, a distinct equivalent reservation event links another inbox row to the
same operation. When the worker completes, all linked inbox rows receive the
canonical completion references.

A different event ID received after terminal operation completion publishes a
fresh outcome referencing the established result, without creating another
operation, reservation movement, or ledger entry. Every newly created outbox
event has its own stable event ID, which remains unchanged across relay retries.
This cross-event semantic replay applies only to reservation lifecycle
operations. A distinct adjustment event ID is a new command and receives a
freshly evaluated outcome.

### Balance reconciliation and invariant failures

For every account, `reserved_balance` must equal the sum of `reserved_amount`
across its active reservations. Each effective operation maintains both sides
by the same delta inside one transaction. Database constraints prevent
negative account balances and non-positive reservation or transaction amounts;
integration and reconciliation tests verify the cross-row aggregate invariant.

An observed mismatch is an internal integrity failure. Credit Service rolls
back and leaves the operation pending for worker retry and alerting; it does not
silently repair data or publish a business rejection.

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

Each main queue owns five retry queues and a `<queue>.dlq`. These bounded
transport retries protect validation and durable ingress only. Once valid
reservation or adjustment ingress commits, the message is acknowledged and
continuing execution retry belongs to the operation worker. Retry,
retry-return, and
dead-letter exchanges remain shared Credit Service infrastructure created at
runtime, as established by ADR 0004. Persistent publication, publisher
confirmation, per-stream isolation, transactional outbox, and graceful
shutdown rules remain unchanged.

Order Service implementation is outside this decision. The shared contracts,
durable destinations, and fixtures allow its producers and outcome consumers
to be integrated later.

## Rationale

Durable ingress prevents broker retry exhaustion or a process restart from
discarding valid financial work. Expiring claims recover work after worker
death without permitting a stale claimant to finalize a reclaimed operation.
Serializing execution on both the errand and account addresses the remaining
races: two workers can encounter the same errand before a reservation exists,
and different errands can compete for one requester's available credits.

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
- RabbitMQ delivery ends after durable ingress; financial execution continues
  independently until a permanent business result exists.
- `PENDING` operations survive process failure, expired claims are recoverable,
  and technical failures never become business rejections.
- Successful effective movements create exactly one immutable transaction;
  duplicate event IDs, reservation semantic replays, no-op adjustments, and
  business rejections create none.
- A distinct reservation replay event produces a distinct outgoing event ID
  while retaining the established credit transaction ID.
- The stored reservation is authoritative, so stale adjustment commands are
  rejected even when their requested target equals the current amount.
- Distinct adjustment event IDs represent fresh intent; business rejections are
  reevaluated rather than permanently cached by payload.
- Business rejection events are reliable transactional outcomes; malformed
  contracts and conflicting event-ID reuse remain DLQ concerns, while accepted
  operations continue worker retries without a terminal attempt limit.
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
