# order-service context

Service-level view of the errand lifecycle. Shared terms (Requester, Courier, Errand, Credits, Supplier, Errand event, Event log, Projection, Sub-state, Idempotency key, Notice) are defined in the root [`CONTEXT.md`](../CONTEXT.md); this file adds what is specific to order-service. Design decisions are in [`docs/adr/order-service/`](../docs/adr/order-service/); diagrams and build order are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What the service does

Owns every errand from creation to a terminal state: validates it, gets its supplier confirmed and its credits reserved, lets a courier claim and fulfil it, and expires or cancels it. It tells Credit Service when credits must be transferred or released.

## Client-facing states

`Pending` · `Open` · `Accepted` · `Picked Up` · `Delivered` · `Completed` · `Cancelled` · `Incomplete` · `Resolved`

`Pending` is internally `Pending-Supplier` (supplier not yet confirmed) then `Reserving-Credit` (reservation outstanding). Callers only ever see `Pending`.

In-flight credit statuses ([ADR 0006](../docs/adr/order-service/0006-in-flight-credit-statuses.md)): `Reserving-Credit` (the `Pending` sub-state above), `Transferring-Credit` (shown as `Completed`), `Adjusting-Credit` (shown as `Open`) and `Settling-Credit` (shown as `Incomplete`) are internal while credit-service confirms a step. Cancelling does not wait on credit.

Terminal: `Completed`, `Cancelled`, `Resolved`. `Incomplete` is not terminal: an admin settles it to `Resolved`. There is no `Expired` state: an `Open` errand whose deadline passes is `Cancelled` with reason `ERRAND_EXPIRED`. `Incomplete` is reached from `Delivered` when the requester rejects the delivery, or from `Transferring-Credit` when credit-service rejects the transfer. The full transition list is in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2.

## Terms specific to this service

- **Transition**: an accepted change of an errand's state. Each one appends exactly one errand event and updates the projection in the same transaction.
- **Sweep**: a scheduled job that finds errands whose deadline has passed or that are stuck, and transitions them. Runs on one instance at a time.
- **Hold window**: how long an errand may stay in `Pending-Supplier` (or an in-flight credit status) before it is cancelled or escalated.
- **In-flight status**: an internal status held while credit-service confirms a step. A reply moves the errand on; an explicit rejection reverts it. A timeout never reverts it.
- **Expiry deadline** (`expiresAt`): the time an `Open` errand lapses. The requester supplies a duration (15 minutes to 168 hours, default 60 minutes); `expiresAt` is the moment the errand becomes `Open` plus that duration, so time in `Pending` does not count ([ADR 0007](../docs/adr/order-service/0007-expiry-duration-autocomplete-and-supplier-validation.md); implemented 2026-10-11).
- **Single-assignment**: at most one courier is ever assigned to an errand; a concurrent second accept loses.
- **Cancellation reason**: a tag recorded on cancellation, one of a closed set (`SUPPLIER_UNAVAILABLE`, `SUPPLIER_VALIDATION_TIMEOUT`, `INSUFFICIENT_CREDITS`, `MISSING_BALANCE`, `CREDIT_TIMEOUT`, `ERRAND_EXPIRED`, `PICKUP_TIME_EXCEEDED`, `REQUESTER_CANCELLED`), each valid only on certain cancel edges.
- **Role block**: a short-lived bar on a user's new activity in one participant role (requester: create; courier: accept), placed by Order Service only after confirming they have no ongoing errands in that role. Used for role change and archival. It expires after the access-token lifetime plus skew, by which time a refreshed token no longer carries the role, and can be removed early ([ADR 0010](../docs/adr/order-service/0010-role-block-with-ttl.md)). Not the same as user-service's account lock (`isLocked`, after repeated failed logins), which acts on the whole account.
- **System actor**: the acting user recorded on transitions made by a sweep rather than a person (also credit and supplier replies); the explicit `SYSTEM` actor in code, stored as a null `actor_id`. Never a default for a missing actor.
- **Outbox**: the `outbox_events` table. A notice for another service is inserted there in the same transaction as the state change, and a relay publishes it to the broker afterwards, so a crash cannot lose it. Delivery is at least once ([ADR 0008](../docs/adr/order-service/0008-transactional-outbox-and-broker-access.md)).
- **Dispute**: an errand in `Incomplete` (including in-flight `Settling-Credit`), its credits still held, waiting for an admin.
- **Report**: one optional, immutable text account (max 2,000 characters) a party files on a dispute. The other party never sees it; the admin does. Locked for good once a settlement is first requested. Not a lifecycle transition: no event. No attachments yet.
- **Settlement**: the admin's decision on a dispute: the courier's share of the reward, an integer `0..rewardCredits` (the requester gets the rest), plus a required note. Moves the errand through `Settling-Credit` to `Resolved`; credit-service rejecting it returns it to `Incomplete` for a retry (3 rejections per rolling hour). The parties see the amount and note only once `Resolved`.
- **Resolved**: terminal client-facing status after a settlement succeeded. Distinct from `Completed`.
- **Courier lock**: a courier may hold only one Accepted or Picked Up Errand at a time.
