# Delivery building: validated through supplier validation, snapshotted on the errand

## Context

The delivery location was free text. Nothing on the server confirmed it was a real campus building, so a direct API call could create an errand for any string, and the `deliveryBuilding` list filter only matched when the client happened to send a building short name. Buildings are owned by supplier-service.

## Decision

- **The request carries a building id and a detail.** `POST /v1/errands` takes `deliveryBuildingId` (UUID) and `deliveryDetail` (free text, e.g. `Level 3 04-02`) in place of `deliveryLocation`. Both are stored (`delivery_building_id`, `delivery_detail`) and neither changes afterwards.
- **Supplier-service validates the building in the existing round trip.** `order.supplier-validation-requested.v1` carries `deliveryBuildingId` (never the detail, and a resend carries the same id). `supplier.validation-completed.v1` has three outcomes:
  - `FOUND`: the supplier snapshot plus a `deliveryBuilding` (`id`, `shortName`, `canonicalName`).
  - `NOT_FOUND`: the supplier does not exist. It takes priority when the building is also unknown.
  - `BUILDING_NOT_FOUND`: the supplier exists but the building does not.
- **The short name is snapshotted.** The `Pending-Supplier` → `Reserving-Credit` edge also sets `delivery_location` to the building's short name, next to the pickup snapshot (ADR 0009). The column is null until validation.
- **A new cancellation reason.** `BUILDING_UNAVAILABLE` is valid only on the `Pending-Supplier` → `Cancelled` edge, system-only. The transition payload records `supplierOutcome: BUILDING_NOT_FOUND`. Nothing is reserved yet, so no release is sent.

## Rationale

Reusing the validation round trip adds no new event pair and no synchronous call, which would need service-to-service auth. Building data stays in supplier-service; no building list moves into `@foc/contracts`. A separate reason lets the requester see they should pick another building rather than blame the supplier. The snapshot keeps the errand stable if the building is renamed or retired, and keeps the `deliveryBuilding` filter on a validated short name.

## Consequences

- Changing the v1 contracts in place breaks supplier-service's build and specs until it adopts the new request field and the three outcomes.
- The create form still sends `deliveryLocation`; the API answers 400 until the frontend sends the new fields.
- A retired building is indistinguishable from an unknown one (`BUILDING_NOT_FOUND`).
