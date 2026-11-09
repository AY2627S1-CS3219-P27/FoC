# Delivery venue and map pin: coordinates and a label snapshotted on the errand

## Context

ADR 0011 gave the errand a validated building but no coordinates, so a courier got a short name and a note and could not navigate. Supplier-service already stores venues (code, name, floor, coordinates) and can validate one. Nothing let a requester say "none of these, here is a pin", and the server could not tell a campus point from any other.

## Decision

- **Request.** `POST /v1/errands` takes `deliveryBuildingId` plus at most one of `deliveryVenueId` or `deliveryPin { latitude, longitude }`; both is 400. `deliveryDetail` stays and is required unless a venue is given (then optional, stored as an empty string).
- **A pin means the placeholder building.** The frontend swaps `deliveryBuildingId` to "Other (map pin)" whenever a pin is dropped; order-service does not check it, and there is no `allowsPin` flag.
- **Pin check is local.** The pin must lie inside the polygon in `data/json/campus-boundary.geojson` (path from `CAMPUS_BOUNDARY_PATH`, loaded at boot, hand-written ray casting, no new dependency). Outside is 400. The same file feeds the frontend map.
- **Venue is validated in the existing round trip.** The request carries `deliveryVenueId` (stored, so a resend asks the same question). `deliveryBuilding` in `supplier.validation-completed.v1` gains `coordinates` (required, v1 edited in place). A pin never goes to supplier-service.
- **Four nullable columns, no `kind`:** `delivery_venue_id`, `delivery_latitude`, `delivery_longitude`, `delivery_venue`. At the `Pending-Supplier` to `Reserving-Credit` edge the coordinates are set (pin, else venue point, else building point) and the label is snapshotted: `COM1 · LT19 · Seminar Room · Level 3` for a venue, `Around COM1` for a building only, `Requester Delivery Location` for a pin (checked first). The case is read from which fields are present. The pin is read from the `ErrandCreated` event, because validation overwrites the row's coordinates.
- **New cancellation reason.** `VENUE_UNAVAILABLE`, system-only, valid only on `Pending-Supplier` to `Cancelled` when the reply is `VENUE_NOT_FOUND`. Nothing is reserved, so no release is sent. The DB check constraint is widened (migration 0019).
- **Reads** add `deliveryVenue`, `deliveryLatitude`, `deliveryLongitude`; the flat `deliveryLocation` and `deliveryDetail` and the `deliveryBuilding` filter are unchanged.

## Rationale

Reusing the validation round trip adds no event pair or synchronous call. Snapshotting a label and a point keeps the errand stable if a venue is renamed or retired. A single boundary file keeps the server check and the map in agreement. Deriving the case from present fields avoids a `kind` column that could drift from the data.

## Consequences

- `coordinates` is required at once, so supplier-service must ship in the same rollout; a `FOUND` reply queued across the deploy is rejected and the resend sweep re-asks.
- A direct API call that skips the pin-building swap, or sends a pin with a real building, is accepted and labelled as a pin.
- Old errands have null venue and coordinates (no backfill).
- Building-only is valid even when the building has venues; the mandatory note and the building point carry it.
