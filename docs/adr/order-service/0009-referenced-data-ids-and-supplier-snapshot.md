# Referenced data: user ids, and a supplier snapshot taken at validation

## Context

An errand refers to data that other services own. The requester and courier belong to user-service. The supplier, its building and its pickup location belong to supplier-service. All of these can change while an errand is in progress:

- a supplier is renamed, moves, goes `Inactive` or is hard-deleted
- a user changes their profile, opts out of a role, or is archived

We need one rule for what an existing errand sees when that happens.

## Decision

- **Users: ids only.** `requester_id` and `courier_id` hold the user's UUID (the token's `sub`). Order-service stores no names or profile data; clients look them up live from user-service. A profile change therefore never touches an errand.
- **Supplier: id plus a snapshot taken at validation.**
  - `supplier.validation-completed.v1` carries a supplier snapshot that includes its `version`. The `SupplierValidated` event payload keeps that snapshot verbatim.
  - The `Pending-Supplier` → `Reserving-Credit` edge sets three columns: `supplier_validated_at`, `pickup_location` (the building's `shortName`) and `pickup_description` (floor and `locationDescription`, e.g. `Floor 1 · Next to LT19`). The client no longer sends a pickup location; until validation it is null.
  - From then on the errand is fixed against that version. Later supplier edits do not rewrite existing errands: the courier goes where the errand says.
- **Supplier status is checked once, at validation.**
  - A supplier that goes `Inactive` afterwards blocks new errands only. An existing `Open` errand carries on, and its requester can still cancel it.
  - Supplier-service refuses a hard delete while any errand has ever referenced the supplier (F5.3.1). It asks order-service whether one has.
- **User status changes go through a check-and-lock (F10).** Before an archive or role removal, user-service asks order-service to confirm the user has no ongoing errands in that role, and to block new ones. If an archived courier still slips through, the transfer exposes it: credit-service rejects with `DESTINATION_ARCHIVED`, and the errand goes to `Incomplete` with its credits still held (ARCHITECTURE §6).

## Rationale

The snapshot means reads never call supplier-service, so the open list keeps working while supplier-service is down. It also stops an errand from changing under a courier who has already accepted it. The snapshot's `version` records exactly what was agreed.

Copying user data would duplicate personal data, and every rename would need an event fanned out to order-service. Ids avoid both.

## Consequences

- An errand's pickup text can differ from the supplier's current record. This is intended.
- Order-service needs no consumer for supplier or user update events.
- `GET /v1/errands?pickupBuilding=` filters on the snapshot's building, not on client free text.

## Not built yet

- The F10 check-and-lock endpoint (#355–#368), which user-service #121–#147 wait on.
- The supplier usage endpoint that supplier-service needs for hard delete (F5.3.1, #211).
- Admin resolution of `Incomplete` errands. See ARCHITECTURE §6.
