# Split an Active Reservation Through a Durable Settlement Attempt

## Context

A future dispute service needs a Credit-owned command that can divide one
active reservation between its requester and courier when the normal errand
lifecycle did not settle the reservation successfully. The split can be a full
refund, a full courier payout, or a positive amount for each participant. The
command may be delivered more than once, retried under a later attempt number,
or race the existing completion-transfer and cancellation-release paths.

Credit Service owns the reservation, participant credit accounts, immutable
ledger, and financial outcome. It must not accept an incoming split whose total
differs from the amount it actually holds. It must also avoid acknowledging a
broker delivery before the requested work is durable or publishing an outcome
that can become separated from the corresponding balance movement.

[ADR 0007](0007-credit-transfer.md) defines the normal completion transfer,
[ADR 0008](0008-credit-release.md) defines cancellation release, and
[ADR 0009](0009-quorum-queues-for-credit-event-durability.md) requires critical
Credit ingress queues to be predeclared quorum queues. This decision extends
those rules for an explicit settlement command. It does not replace the normal
transfer or release flows.

## Decision

### Event boundary and topology

Credit Service consumes and publishes these strict, versioned contracts:

| Direction | Event | Routing key | Payload |
| --- | --- | --- | --- |
| Input | `CreditSettlementRequested` | `credit.settlement.v1` | `{ errandId, requesterUserId, courierUserId, courierAmount, requesterAmount, attempt }` |
| Output | `CreditSettlementSucceeded` | `credit.settlement-succeeded.v1` | `{ errandId, requesterUserId, courierUserId, courierAmount, requesterAmount, courierCreditTransactionId, requesterCreditTransactionId }` |
| Output | `CreditSettlementRejected` | `credit.settlement-rejected.v1` | `{ errandId, requesterUserId, courierUserId, rejectionReason }` |

The input queue is the predeclared durable quorum queue
`credit-service.credit-settlement.v1`, bound to `credit.settlement.v1` on the
direct `foc.events` exchange. Credit validates the complete shared contract
before durable ingress. Unknown fields, invalid envelopes, unsafe amounts or
attempts, and conflicting transport identities use the broker retry or DLQ
boundary rather than becoming financial outcomes.

The success contract pairs each amount with its role-specific transaction ID:
a zero share requires a null ID and a positive share requires a UUID. At least
one share must be positive. `DESTINATION_ARCHIVED` remains in the rejection
contract for compatibility but is not emitted. Credit does not inspect account
archival state or call User Service synchronously.

### Attempt identity and durable ingress

A settlement operation has semantic identity `(errand_id, attempt)`. The
positive JavaScript-safe `attempt` supplied by the command is persisted with
the canonical payload hash, both participant IDs, both shares, and their sum.
Different attempt numbers represent fresh work; they do not overwrite an
earlier operation.

Ingress runs in a serializable transaction:

1. Acquire an advisory transaction lock for the event ID.
2. Hash the canonical payload in stable field order.
3. Treat the same event ID, event type, and payload hash as transport
   redelivery and reuse the inbox result without creating work or an outcome.
4. Dead-letter reuse of an event ID with different content as
   `INVALID_ENVELOPE`.
5. Acquire the per-errand advisory transaction lock and find the operation for
   the requested attempt.
6. Create one `PENDING/SETTLEMENT` operation and linked inbox row when the
   attempt is new.
7. Link a distinct, identical event for a pending attempt to the established
   operation.
8. Dead-letter different content that reuses an established attempt as
   `INVALID_PAYLOAD`.
9. Commit before acknowledging RabbitMQ.

Ingress never changes an account, reservation, or ledger row. A distinct,
identical event for a terminal attempt publishes a fresh copy of the
established success or rejection through the outbox without repeating the
financial movement. Terminal replay requires internally consistent operation
and role-specific transaction references; broken evidence is a retryable
technical failure.

### Authoritative reservation and participant context

The sum `requesterAmount + courierAmount` is the requested total. The locked
`credit_reservations.reserved_amount` remains authoritative. Credit rejects an
active reservation with `AMOUNT_MISMATCH` when the two values differ; it never
partially consumes or silently adjusts the split.

An established normal `TRANSFER` operation affects settlement participant
validation:

- While the transfer is `PENDING`, settlement remains pending and retries
  later so it cannot decide against an unfinished normal lifecycle action.
- When the transfer is terminal, its established requester and courier must
  match the settlement command. A disagreement is
  `RESERVATION_USER_MISMATCH`.
- Without a transfer operation, the reservation establishes the requester and
  the settlement command establishes the courier.

The transfer row is inspected without a second pessimistic row lock. Transfer
locks its own operation before waiting for the errand advisory lock; taking
that row lock in the reverse order would create a deadlock cycle. The errand
lock makes the relevant transfer state stable for the settlement decision.

### Leased execution and lock order

`SETTLEMENT` uses the existing credit-operation worker, claim lease, capped
technical backoff, overdue warning, non-overlapping polling, and graceful
shutdown behavior. A stale claimant cannot commit after its lease expires or
ownership changes.

The processor executes in one serializable transaction and proceeds in this
order:

1. Lock the claimed settlement operation and verify its type, pending state,
   claim owner, unexpired lease, participants, attempt, and shares.
2. Acquire the per-errand advisory transaction lock.
3. Inspect the established transfer operation without a row lock.
4. Lock the reservation row for the errand.
5. Lock requester and courier accounts in ascending user UUID order.
6. Revalidate every invariant before mutation.

The same errand lock serializes settlement against transfer and release. The
locked reservation status ensures that exactly one path can move the held
credits.

### Atomic split and ledger representation

For an active reservation with authoritative amount `R`, one database
transaction:

1. Requires both participant accounts and safe, non-negative account state.
2. Subtracts `R` once from the requester's reserved balance.
3. Adds a positive requester share to the requester's available credit.
4. Adds a positive courier share to the courier's available credit.
5. Appends a same-user `RELEASE` ledger row for a positive requester share.
6. Appends a requester-to-courier `TRANSFER` ledger row for a positive courier
   share.
7. Marks the reservation `CONSUMED`, using the courier transaction as
   `latestTransactionId` when it exists and otherwise the requester
   transaction.
8. Marks the operation `SUCCEEDED`, stores the requester and courier
   transaction references separately, completes every linked inbox row, and
   inserts `CreditSettlementSucceeded` into the outbox.

A split with two positive shares creates exactly two immutable ledger rows. A
full refund or full courier payout creates exactly one. Settlement introduces
no new public transaction type: existing `RELEASE` and `TRANSFER` types retain
their bucket and participant meaning. Because a settlement can have two
transactions, its operation uses role-specific transaction columns and leaves
the singular completion-transaction and inbox transaction references null.

The movement conserves total credit. A full refund still consumes the
reservation because settlement, rather than cancellation, made the terminal
decision.

### Rejection and technical-failure semantics

The locked evidence produces these business rejections:

| Condition | Rejection reason |
| --- | --- |
| Reservation is missing | `RESERVATION_NOT_FOUND` |
| Reservation is `RELEASED` | `RESERVATION_RELEASED` |
| Reservation is `CONSUMED` | `ALREADY_TRANSFERRED` |
| Requester or established courier conflicts | `RESERVATION_USER_MISMATCH` |
| Requested shares do not sum to the stored amount | `AMOUNT_MISMATCH` |

A business rejection atomically completes the operation and linked inbox rows
and inserts `CreditSettlementRejected` into the outbox. It changes no balance,
reservation, or ledger row.

Missing participant accounts, unsafe balances, contradictory or broken
references, database failures, and outbox-write failures are technical
failures. They roll back the transaction and leave the operation pending for
the existing worker retry path. They are not converted into dispute outcomes.

### Transfer, release, and later attempts

If normal transfer consumes the reservation first, settlement rejects with
`ALREADY_TRANSFERRED` after participant validation. If cancellation release
wins first, settlement rejects with `RESERVATION_RELEASED`. If settlement wins,
it marks the reservation `CONSUMED`; a concurrent transfer or release observes
that terminal state under the shared errand lock and cannot move the credits
again.

A higher settlement attempt is accepted as fresh durable work, but it is still
evaluated against current Credit-owned state. After an earlier successful
settlement, a later attempt therefore rejects with `ALREADY_TRANSFERRED`.
Attempt identity permits a future dispute service to issue a corrected command
without weakening replay protection for the earlier attempt.

### Recovery and publication

Before ingress commits, failures use the broker's bounded retry queues and DLQ.
After ingress commits, RabbitMQ is acknowledged and the leased worker retries
the durable operation without a terminal attempt limit. Expired claims are
recoverable by another worker.

Financial state, ledger rows, reservation state, operation and inbox outcomes,
and the outbox row commit together. A failure at any point rolls everything
back. If RabbitMQ is unavailable after the database commit, the pending outbox
row is retried until publisher confirmation; the settlement operation is not
executed again. Outcome delivery remains at least once, so downstream
consumers must deduplicate by event ID.

## Rationale

An explicit attempt number gives dispute resolution a stable business identity
while retaining event-ID deduplication for transport delivery. Using the
Credit-owned reservation amount prevents an external command from creating or
destroying credits. Role-specific ledger rows preserve the existing meaning of
`RELEASE` and `TRANSFER` and make a split auditable without inventing a third
movement type.

Reusing the operation worker, errand lock, deterministic account order, and
transactional outbox keeps settlement consistent with existing recovery and
concurrency behavior. Separating business rejections from technical failures
ensures that infrastructure or corrupted persistence cannot be mistaken for a
dispute decision.

## Consequences

- Credit Service can durably execute full refunds, full payouts, and split
  settlements without synchronous dependencies.
- A successful split produces two ledger rows and two role-specific references;
  one-sided settlement produces exactly one.
- Distinct identical terminal notices can publish additional outcome events,
  but no replay can repeat the balance movement.
- A later attempt is fresh work but cannot reopen a reservation that is already
  consumed or released.
- Settlement, transfer, and release share one serialization boundary, so only
  one path can settle an active reservation.
- Technical invariant failures remain pending and may require operator
  investigation; they never fabricate a business rejection.
- Archived-account handling and `DESTINATION_ARCHIVED` emission remain
  intentionally out of scope.
