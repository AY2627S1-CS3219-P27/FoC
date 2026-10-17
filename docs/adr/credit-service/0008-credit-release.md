# Release Reserved Credits to the Requester Atomically

## Context

Order Service may cancel an errand after Credit Service has accepted, is still
processing, or has completed its credit reservation. Credit Service must react
to that lifecycle notice by returning an active reservation to the requester.
The cancellation may be delivered more than once, may arrive before Credit has
enough reservation context to act, and may race an `ErrandCompleted` notice
that attempts to transfer the same reserved credits to a courier.

Order Service owns the errand lifecycle and cancellation decision. Credit
Service owns accounts, reservations, settlement operations, and the immutable
credit ledger. Credit must therefore accept and recover release work without a
synchronous call to Order Service, and it must not acknowledge a cancellation
until the work is durable.

The cancellation payload contains only the errand ID. This is intentional:
requester identity and amount are Credit-owned facts established by the
reservation flow. Their absence at ingress is not evidence that no reservation
will exist, because cancellation and reservation messages can be observed in a
different order.

[ADR 0007](0007-credit-transfer.md) establishes the shared settlement rules
for completion transfers, including the per-errand lock, authoritative stored
reservation amount, conditional reservation transition, durable operations,
and transactional outbox. This decision retains ADR 0007 as the transfer
record and extends those rules for cancellation release rather than rewriting
them.

## Decision

### Ownership and event boundary

Credit Service consumes and publishes these strict, versioned events through
the shared event envelope:

| Direction | Event                   | Routing key                  | Payload                                                              |
| --------- | ----------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Input     | `ErrandCancelled`       | `order.errand-cancelled.v1`  | `{ errandId }`                                                       |
| Output    | `CreditReleaseSuccess`  | `credit.release-success.v1`  | `{ errandId, requesterUserId, releasedAmount, creditTransactionId }` |
| Output    | `CreditReleaseRejected` | `credit.release-rejected.v1` | `{ errandId, requesterUserId, rejectionReason }`                     |

Consumed cancellation events require publisher `order-service`; release
outcomes use publisher `credit-service`. Identifiers are UUIDs, amounts are
positive JavaScript-safe integers, timestamps are RFC 3339 values ending in
uppercase `Z`, and unknown envelope or payload fields are rejected.

Release has exactly two business rejection reasons:

- `RESERVATION_NOT_FOUND`
- `ALREADY_TRANSFERRED`

Missing accounts, contradictory persistence, and unsafe balance arithmetic
are technical failures, not additional business rejection reasons. Order
Service currently treats cancellation as fire-and-forget, but Credit still
publishes the authoritative success outcome. No subscriber queue is created
for `credit.release-success.v1` until a consumer requires one.

### Durable ingress and semantic identity

The cancellation handler validates the complete envelope and `{ errandId }`
payload before database work. Durable ingress then runs in a serializable
transaction:

1. Acquire an advisory transaction lock for the event ID.
2. Hash the canonical payload in stable field order.
3. Read the inbox row for the event ID.
4. Treat the same event ID, event type, and payload hash as transport
   redelivery and return its recorded result without creating new work or a
   new outcome.
5. Treat reuse of that event ID for different content as a permanent
   `INVALID_ENVELOPE` transport failure and dead-letter it.
6. Acquire the per-errand advisory transaction lock and find the semantic
   `RELEASE` operation for the errand.
7. Create one `PENDING/RELEASE` operation when none exists, even when the
   requester and amount are not yet known, and link the inbox row to it.
8. Enrich missing requester and amount context from Credit's reservation or
   established semantic `RESERVE` operation when available, without replacing
   values already established on the release operation.
9. Commit before acknowledging RabbitMQ.

Ingress never changes an account, reservation, or ledger row. The semantic
identity is `(errand_id, RELEASE)`, not the cancellation event ID. Distinct
cancellation notices for one errand therefore link to the same release
operation.

### Redelivery, semantic replay, and enrichment

For a distinct cancellation event associated with an existing semantic
release:

- A `PENDING` operation receives a new linked inbox row. Any missing requester
  or amount may be enriched from authoritative Credit persistence.
- A `SUCCEEDED` operation produces a fresh `CreditReleaseSuccess` outbox event
  that references the original release transaction without repeating the
  movement or ledger entry.
- A `REJECTED` operation produces a fresh `CreditReleaseRejected` outbox event
  with the established reason without re-evaluating the terminal decision.

A same-event redelivery returns the existing inbox result and creates no fresh
outcome. Terminal replay requires internally consistent terminal operation,
transaction, and outbox evidence. Missing or contradictory evidence is a
retryable invariant failure rather than permission to reconstruct or repeat a
financial movement.

### Unresolved context and reserve interpretation

The release worker treats the reservation and semantic reserve operation as a
combined evidence set. Absence is not immediately authoritative because the
cancellation may have arrived before reservation ingress.

| Reservation evidence | Semantic `RESERVE` evidence              | Release decision                                                                  |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Missing              | Missing                                  | Remain `PENDING`; retry for later context.                                        |
| Missing              | `PENDING`                                | Remain `PENDING`; the reserve outcome is not yet authoritative.                   |
| Missing              | `REJECTED`                               | Reject with `RESERVATION_NOT_FOUND`, using the reserve context.                   |
| Missing              | `SUCCEEDED`                              | Retryable invariant failure because a successful reserve must have a reservation. |
| `CONSUMED`           | Any consistent terminal evidence         | Reject with `ALREADY_TRANSFERRED`.                                                |
| `RELEASED`           | Established terminal release evidence    | Replay the existing release success.                                              |
| `RELEASED`           | Pending or inconsistent release evidence | Retryable invariant failure.                                                      |
| `ACTIVE`             | Consistent context                       | Execute release using the reservation's requester and amount.                     |

The locked reservation is authoritative whenever it exists. Context found on
the reserve operation may fill null release fields, but it must agree with the
reservation and may never overwrite established, conflicting release context.
A context conflict is a technical invariant failure and remains retryable for
operator investigation.

### Leased execution and lock order

The existing operation worker claims `RELEASE` together with `RESERVE`,
`ADJUST`, and `TRANSFER`. Release uses the same claim lease, capped exponential
backoff, overdue warning, non-overlapping polling, stale-claim protection, and
graceful-shutdown behavior. It does not introduce a second scheduler.

The release processor runs in a serializable transaction and proceeds in this
order:

1. Lock the claimed release operation and verify type `RELEASE`, status
   `PENDING`, claimant ownership, and an unexpired lease.
2. Acquire the same per-errand advisory transaction lock used by reservation
   and transfer processing.
3. Lock the reservation row for the errand when one exists.
4. Inspect semantic `RESERVE` state when the reservation is absent or release
   context still needs enrichment.
5. Lock the requester account for an active reservation, then revalidate the
   reservation, account, and operation context before mutation.

The reserve-operation inspection in step 4 deliberately does not take a
conflicting pessimistic row lock. A reserve worker locks its operation row
before waiting for the same per-errand advisory lock. If a release worker held
the errand lock while waiting for that reserve row, the two workers could form
a lock cycle. A pending reserve is deferred, while terminal reserve state is
immutable and can be inspected within the serializable transaction.

### Atomic release success

For an active reservation owned by requester `U` with stored amount `R`, one
transaction:

1. Requires operation context to agree with the reservation and requires the
   requester's reserved balance to be at least `R`.
2. Requires current and computed balances to be JavaScript-safe non-negative
   integers.
3. Reduces `U.reserved_balance` by `R`.
4. Increases `U.credit_balance` by `R`.
5. Appends exactly one immutable `RELEASE` ledger row from `U`'s
   `RESERVED_BALANCE` bucket to `U`'s `CREDIT_BALANCE` bucket, carrying the
   errand ID, amount, unique transaction ID, and creation timestamp.
6. Conditionally changes the reservation from `ACTIVE` to `RELEASED` and
   records the release as its latest transaction.
7. Marks the release operation `SUCCEEDED`, records the transaction and
   outcome references, and clears claim and error state.
8. Completes every inbox row linked to the operation with the same transaction
   and outcome references.
9. Inserts `CreditReleaseSuccess` in the transactional outbox with `R` as
   `releasedAmount` and the ledger creation time as the event timestamp.

Any failure before commit rolls back every change. Publication is not part of
this transaction and cannot cause the release to execute again.

### Business rejection boundary

A business rejection atomically enriches and retains the release context,
marks the operation `REJECTED` with the authoritative reason, clears claim and
error state, completes all linked inbox rows, and inserts
`CreditReleaseRejected` in the outbox.

It does not change an account balance, change the reservation, or append a
credit transaction. A missing reservation without a rejected reserve is
unresolved technical state and must not be converted prematurely into
`RESERVATION_NOT_FOUND`.

### Reserve, transfer, and release serialization

`RESERVE`, `TRANSFER`, and `RELEASE` remain separate semantic operations
because their commands and outcomes require independent durable evidence.
They use the same per-errand advisory lock. Transfer and release also lock and
conditionally transition the same reservation, so only one settlement can win:

- Cancellation before reservation creates a durable pending release. A later
  successful reserve creates the active reservation that release returns; a
  later rejected reserve permits `RESERVATION_NOT_FOUND`.
- Transfer first changes the reservation from `ACTIVE` to `CONSUMED`; release
  then rejects with `ALREADY_TRANSFERRED`.
- Release first changes the reservation from `ACTIVE` to `RELEASED`; transfer
  then follows ADR 0007 and rejects with `RESERVATION_RELEASED`.

No interleaving may debit reserved credit twice, credit both requester and
courier, append two successful settlement ledger rows, or publish two
successful settlement outcomes for one reservation.

### Recovery and publication

Contract, transport-identity, and pre-ingress persistence failures remain on
the cancellation queue's bounded broker retry and DLQ path. Once ingress
commits, the cancellation is acknowledged and the operation worker owns
recovery. Technical and integrity failures leave the release `PENDING`, store
only sanitized diagnostics, release or expire the claim, and schedule capped
backoff without a terminal attempt limit. An overdue warning is operational
telemetry; it does not change operation status.

Expired claims can be recovered by another worker, and a stale claimant cannot
commit. A process restart after ingress or during execution therefore retains
the accepted release and resumes it when the lease permits.

Success and rejection envelopes are stored in the same transaction as their
authoritative outcome. The transactional outbox relay publishes them with
RabbitMQ confirmation and marks them published only after confirmation. A
broker outage after financial commit leaves a pending outbox row for retry; it
does not repeat balance movement. Publishing release success is valid even
with no bound subscriber queue.

### Conservation and reconciliation

Release moves `R` within one requester's account, from held credit back to
available credit. It preserves the closed-economy invariant:

```text
SUM(credit_accounts.credit_balance + credit_accounts.reserved_balance)
  = SUM(credit_allocations.amount)
```

It also preserves active-reservation reconciliation:

```text
credit_accounts.reserved_balance
  = SUM(credit_reservations.reserved_amount WHERE status = 'ACTIVE')
```

The equality is evaluated per requester. Success, business rejection,
rollback, replay, restart, and transfer-versus-release concurrency must all
preserve both invariants.

### Requirement traceability

| Issues    | Requirements | Decision coverage                                                                                       |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| #563      | F5           | Consume `ErrandCancelled`, durably establish one semantic release, and release the active reservation.  |
| #564-#565 | F5.1-F5.2    | Move the stored amount from requester reserved balance to requester available balance.                  |
| #566-#571 | F5.3-F5.3.5  | Append one immutable `RELEASE` row with a unique ID, ISO 8601 timestamp, requester, errand, and amount. |
| #572-#574 | F5.4-F5.4.2  | Publish the exact rejection outcome only from authoritative evidence and make no financial mutation.    |
| #575-#576 | F5.5-F5.5.1  | Publish success after commit with errand, requester, released amount, and transaction ID.               |

## Rationale

Separating durable ingress from financial execution permits prompt RabbitMQ
acknowledgement without losing valid work or holding a delivery open while
waiting for reservation context. Treating absence as unresolved avoids a
false rejection when independent event streams arrive out of order.

Event-ID deduplication protects transport identity, while one release operation
per errand protects business identity across distinct cancellation notices.
Using Credit's locked reservation for requester and amount keeps financial
authority inside the owning service. Reusing ADR 0007's errand lock and
conditional reservation transition gives transfer and release a single winner.
The transactional outbox makes the financial decision and its published
evidence atomic from Credit Service's perspective.

## Consequences

- Credit can accept, execute, and recover release work without synchronously
  contacting Order Service.
- A cancellation may remain pending for an unbounded time while reservation
  evidence is unresolved; capped retry and overdue warnings make that state
  observable without inventing a terminal outcome.
- Pending release operations may temporarily lack requester and amount, so
  persistence must permit null context only for `PENDING/RELEASE` rows and
  require complete context for terminal release rows.
- Distinct equivalent cancellations may publish replay outcomes, but cannot
  repeat the balance movement or ledger entry.
- Successful release coordinates an account update, immutable ledger append,
  reservation transition, operation and inbox completion, and outbox insert in
  one serializable transaction.
- Transfer and release share locking and reservation-state rules; changes to
  either processor must retain the mutual-exclusion invariant.
- A non-locking read of reserve-operation state is an intentional exception to
  pessimistic operation-row locking and must remain covered by deadlock and
  concurrency tests.
- Release success has no subscriber queue today, but remains an authoritative
  published domain outcome.
- Transaction-history APIs, archived-account behavior, downstream Order
  Service changes, and new HTTP endpoints remain outside this decision.
