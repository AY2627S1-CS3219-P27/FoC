# Transfer Reserved Credits to the Courier Atomically

## Context

When Order Service completes an errand, Credit Service must settle the
requester's reservation by moving the reserved credits to the courier. The
completion notice can be delivered more than once, arrive concurrently with a
cancellation, or be accepted shortly before either Credit Service or RabbitMQ
becomes unavailable.

Order Service owns the errand lifecycle and selects the requester and courier.
Credit Service owns credit accounts, reservations, settlement operations, and
the immutable credit ledger. Settlement therefore cannot depend on a
synchronous call to another service, and acknowledging a notice must not lose
the work needed to complete its financial effects.

The reservation amount can differ from the amount carried by a later
completion notice because adjustments may have changed the reservation. Credit
Service must also distinguish transport redelivery from a distinct lifecycle
notice for the same errand and must serialize transfer with the release flow
introduced by the subsequent implementation package.

## Decision

### Ownership and event boundary

Credit Service consumes and publishes the following canonical versioned
events through the shared event envelope:

| Direction | Event | Routing key | Payload |
| --- | --- | --- | --- |
| Input | `ErrandCompleted` | `order.errand-completed.v1` | `{ errandId, requesterUserId, courierUserId, amount }` |
| Output | `CreditTransferSucceeded` | `credit.transfer-succeeded.v1` | `{ errandId, requesterUserId, courierUserId, transferredAmount, creditTransactionId }` |
| Output | `CreditTransferRejected` | `credit.transfer-rejected.v1` | `{ errandId, requesterUserId, courierUserId, rejectionReason }` |

`ErrandCompleted`, rather than `ErrandCompletion`, and
`CreditTransferSucceeded`, rather than `CreditTransferSuccess`, are the
canonical names. Shared contracts and Credit-owned broker boundaries are part
of this decision. Changes to User Service, Order Service, or Frontend Service
and cross-service integration tests are deferred.

The transfer rejection contract contains:

- `RESERVATION_NOT_FOUND`
- `RESERVATION_RELEASED`
- `RESERVATION_USER_MISMATCH`
- `DESTINATION_ARCHIVED`

`DESTINATION_ARCHIVED` remains available for the deferred archived-destination
capability but is not emitted by this implementation. There is no
`STALE_RESERVATION_AMOUNT` rejection: the completion notice amount is not a
financial precondition.

### Authoritative amount and participants

The `credit_reservations.reserved_amount` value read under lock is the sole
authority for the transfer amount. The incoming amount remains validated,
hashed, and retained as audit evidence, but a difference does not reject or
alter the transfer.

Credit validates the completion requester against the reservation requester.
The first validated courier supplied by Order Service is trusted and stored on
the semantic transfer operation. A courier is not added to the reservation.
A later completion that supplies a different requester or courier is rejected
as `RESERVATION_USER_MISMATCH` without replacing the established participants.

### Durable ingress and semantic identity

The completion consumer validates the envelope and payload before beginning
database work. Durable ingress then runs in a serializable transaction:

1. Acquire an advisory transaction lock for the event ID.
2. Hash the canonical payload in stable field order.
3. Read the inbox row for the event ID.
4. Treat the same event ID, event type, and payload hash as transport
   redelivery and return its recorded result without creating new work.
5. Treat reuse of the event ID for different content as a permanent
   `INVALID_ENVELOPE` transport failure and dead-letter it.
6. Acquire the per-errand advisory transaction lock and lock the established
   semantic `TRANSFER` operation, if one exists.
7. For the first completion, create one `PENDING` operation containing the
   errand, requester, courier, incoming amount, payload hash, and retry
   metadata, and link the inbox row to it.
8. Commit before acknowledging RabbitMQ.

Ingress does not change an account, reservation, or ledger row. The semantic
identity is `(errand_id, TRANSFER)`, not the event ID.

### Redelivery, replay, and conflicts

The following rules apply to a distinct completion event for an established
semantic transfer:

- Matching requester and courier identifies an equivalent notice, even if its
  notice amount differs.
- If the operation is `PENDING`, the new inbox row links to it and receives the
  eventual authoritative outcome.
- If the operation is `SUCCEEDED`, Credit inserts a fresh success outbox event
  that references the original ledger transaction without repeating any
  financial movement.
- If the operation is `REJECTED`, Credit inserts a fresh rejection outbox event
  with the established reason without re-evaluating the terminal operation.
- A requester or courier conflict inserts a
  `CreditTransferRejected(RESERVATION_USER_MISMATCH)` outcome for that inbox
  row without changing the established operation.

Same-event redelivery returns the already recorded inbox outcome and does not
create a fresh replay event.

### Leased execution and lock order

The existing operation worker claims due `TRANSFER` operations with the same
lease, capped exponential backoff, overdue warning, non-overlapping polling,
and graceful-shutdown rules used by reservation operations. A stale claimant
cannot commit after its lease has expired or ownership has changed.

The transfer processor uses a serializable transaction and locks in this
order:

1. The claimed operation, while verifying `TRANSFER`, `PENDING`, claim
   ownership, and the unexpired lease.
2. The per-errand advisory transaction lock.
3. The reservation row for the errand.
4. Both participant account rows in ascending user UUID order, independent of
   transfer direction.

The reservation and accounts are revalidated after locking. The per-errand
lock and conditional transition from `ACTIVE` ensure that the later release
processor cannot settle the same reservation concurrently. Deterministic
account ordering prevents deadlocks when concurrent transfers share accounts.

### Business and technical outcomes

The locked reservation determines the business outcome:

| State | Outcome |
| --- | --- |
| No reservation | Reject with `RESERVATION_NOT_FOUND`. |
| `RELEASED` | Reject with `RESERVATION_RELEASED`. |
| Requester differs from the reservation | Reject with `RESERVATION_USER_MISMATCH`. |
| `ACTIVE` with valid participants and accounts | Complete the transfer. |
| `CONSUMED` while the semantic transfer is still pending | Retryable invariant failure. |

Missing participant accounts, identical requester and courier IDs, unsafe
balance arithmetic, reservation/account disagreement, and broken persistence
references are technical invariant failures. They do not invent a business
rejection. The operation remains durable and retryable, with sanitized error
evidence and overdue alerts.

### Atomic success and rejection

For an active reservation with locked amount `R`, one transaction:

1. Requires the requester reserved balance to be at least `R` and all computed
   balances to remain JavaScript-safe non-negative integers.
2. Reduces the requester's `reserved_balance` by `R`.
3. Increases the courier's `credit_balance` by `R`.
4. Appends exactly one immutable `TRANSFER` ledger row from the requester's
   `RESERVED_BALANCE` bucket to the courier's `CREDIT_BALANCE` bucket, carrying
   the errand ID, amount, transaction ID, and creation timestamp.
5. Changes the reservation from `ACTIVE` to `CONSUMED` and records the transfer
   as its latest transaction.
6. Marks the operation `SUCCEEDED`, clears claim and error state, completes all
   linked inbox rows, and records their outcome references.
7. Inserts `CreditTransferSucceeded` into the transactional outbox with `R`,
   the ledger transaction ID, and the ledger creation time.

A business rejection commits only the terminal operation, linked inbox
outcomes, and `CreditTransferRejected` outbox row. It never changes balances,
the reservation, or the ledger. Any failure before either transaction commits
rolls back all of its changes.

### Recovery and publication

Pre-ingress failures remain unacknowledged and use the broker's retry and DLQ
policy. Once ingress commits, the operation remains durable and is retried by
the leased worker until it reaches an authoritative terminal outcome. Expired
claims can be recovered by another worker.

Outcome events are written in the same database transaction as their outcome.
RabbitMQ publication happens only through the transactional outbox. A broker
failure after financial commit therefore leaves a pending outbox row; the
existing relay retries until publisher confirmation without executing the
transfer again.

### Conservation and reconciliation

`credit_balance` is available credit and `reserved_balance` is held credit.
An account's total is their sum. Transfer moves `R` from the requester's held
credit to the courier's available credit and must preserve the closed-economy
invariant:

```text
SUM(credit_accounts.credit_balance + credit_accounts.reserved_balance)
  = SUM(credit_allocations.amount)
```

Transfer also preserves active-reservation reconciliation: each requester's
reserved balance must equal the sum of their active reservation amounts.
Success, rejection, rollback, replay, restart, and concurrency tests must
verify these invariants.

## Rationale

Separating ingress from execution allows RabbitMQ acknowledgement after the
command is durable without holding a broker delivery open for financial work.
Event-ID identity protects transport semantics, while the operation's
per-errand identity protects business semantics across distinct notices.

Using the locked reservation amount prevents a stale completion notice from
overriding Credit Service's authoritative state. Serializing by errand and
transitioning the reservation conditionally provides a single settlement
winner across transfer and release. The transactional outbox makes the
financial outcome and its published evidence atomic from Credit Service's
perspective.

## Consequences

- Credit Service can settle a completion without synchronously contacting
  another service.
- At-least-once delivery may produce replay outcome events for distinct
  equivalent notices, but it cannot repeat the financial movement.
- The first validated completion fixes the semantic transfer participants;
  later participant conflicts are explicit rejections.
- Technical corruption or missing account state remains visible and retryable
  instead of being misclassified as a business decision.
- Successful settlement requires coordinated changes to two accounts, one
  reservation, one ledger row, the operation and inbox records, and the
  outbox, increasing transaction and integration-test scope.
- Release must use the same per-errand lock and reservation transition rules
  to preserve mutual exclusion.
- Archived-destination enforcement remains a compatible but intentionally
  deferred behavior.
