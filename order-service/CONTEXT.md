# order-service context

Service-level view of the errand lifecycle. Shared terms (Requester, Courier, Errand, Credits, Supplier, Errand event, Event log, Projection, Sub-state, Idempotency key, Notice) are defined in the root [`CONTEXT.md`](../CONTEXT.md); this file adds what is specific to order-service. Design decisions are in [`docs/adr/order-service/`](../docs/adr/order-service/); diagrams and build order are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What the service does

Owns every errand from creation to a terminal state: validates it, gets its supplier confirmed and its credits reserved, lets a courier claim and fulfil it, and expires or cancels it. It tells Credit Service when credits must be transferred or released.

## Client-facing states

`Pending` · `Open` · `Accepted` · `Picked Up` · `Delivered` · `Completed` · `Cancelled` · `Expired`

`Pending` is internally `Pending-Supplier` (supplier not yet confirmed) then `Pending-Credit` (reservation outstanding). Callers only ever see `Pending`.

Terminal: `Completed`, `Cancelled`, `Expired`. (`Incomplete`, used by requester rejection of a delivery in backlog F6.4, is not in the F9.2 list; see open backlog conflicts in ARCHITECTURE.md.)

## Terms specific to this service

- **Transition**: an accepted change of an errand's state. Each one appends exactly one errand event and updates the projection in the same transaction.
- **Sweep**: a scheduled job that finds errands whose deadline has passed or that are stuck, and transitions them. Runs on one instance at a time.
- **Hold window**: how long an errand may stay in `Pending-Supplier` before it is cancelled.
- **Expiry deadline**: the absolute time an `Open` errand lapses, set when it becomes `Open`, not when it is created.
- **Single-assignment**: at most one courier is ever assigned to an errand; a concurrent second accept loses.
- **Cancellation reason**: a tag recorded on cancellation, e.g. `SUPPLIER_UNAVAILABLE`, `SUPPLIER_VALIDATION_TIMEOUT`, `ERRAND_EXPIRED`, `PICKUP_TIME_EXCEEDED`.
- **Role block**: a lock on a user's new requester or courier activity, set while Order Service confirms they have no ongoing errands (used for role change and archival).
- **System actor**: the acting user recorded on transitions made by a sweep rather than a person.
