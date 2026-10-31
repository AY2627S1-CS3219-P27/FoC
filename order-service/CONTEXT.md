# order-service context

Service-level view of the errand lifecycle. Shared terms (Requester, Courier, Errand, Credits, Supplier, Errand event, Event log, Projection, Sub-state, Idempotency key, Notice) are defined in the root [`CONTEXT.md`](../CONTEXT.md); this file adds what is specific to order-service. Design decisions are in [`docs/adr/order-service/`](../docs/adr/order-service/); diagrams and build order are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What the service does

Owns every errand from creation to a terminal state: validates it, gets its supplier confirmed and its credits reserved, lets a courier claim and fulfil it, and expires or cancels it. It tells Credit Service when credits must be transferred or released.

## Client-facing states

`Pending` · `Open` · `Accepted` · `Picked Up` · `Delivered` · `Completed` · `Cancelled` · `Incomplete`

`Pending` is internally `Pending-Supplier` (supplier not yet confirmed) then `Reserving-Credit` (reservation outstanding). Callers only ever see `Pending`.

In-flight credit statuses ([ADR 0006](../docs/adr/order-service/0006-in-flight-credit-statuses.md)): `Reserving-Credit` (the `Pending` sub-state above), `Transferring-Credit` (shown as `Completed`) and `Adjusting-Credit` (shown as `Open`) are internal while credit-service confirms a step. Cancelling does not wait on credit.

Terminal: `Completed`, `Cancelled`, `Incomplete`. There is no `Expired` state: an `Open` errand whose deadline passes is `Cancelled` with reason `ERRAND_EXPIRED`. `Incomplete` is reached from `Delivered` when the requester rejects the delivery, or from `Transferring-Credit` when credit-service rejects the transfer. The full transition list is in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2.

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
- **Courier lock**: a courier may hold only one Accepted or Picked Up Errand at a time.
- **Tracking**: letting the Requester watch the Courier's position while the Errand is `Picked Up`, until it is `Delivered` or cancelled. Not a state: it never calls `transition()` or writes errand state, and the Courier can decline to share. Held only in Redis ([ADR 0011](../docs/adr/order-service/0011-courier-location-tracking.md)).
- **Last-known position**: the Courier's most recent reported position for an Errand (`lat`, `lng`, `accuracy`, `heading`, `speed`, `ts`), kept in Redis for `TRACKING_LOCATION_TTL_S` (120 s) and replaced by each accepted update. No history is kept, so after the TTL there is no position. Shared only with the Errand's Requester and Courier, and not logged.
- **Snapshot**: the current tracking view of one Errand as JSON: its status, whether tracking is on, the last-known position, the route and destination (each possibly `null`) and the server time. It is the first event on the tracking stream and is also served on its own.
- **Tracking route**: the walking route from the last-known position to the delivery point, computed server-side by OSRM, cached for `TRACKING_ROUTE_TTL_S` and recomputed when the Courier has moved more than `TRACKING_REROUTE_DISTANCE_M`. It is `null` when OSRM fails or when the delivery point is unknown, which is always the case in v1 because order-service has no delivery coordinates yet.
