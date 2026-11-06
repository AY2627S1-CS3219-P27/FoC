# Editing an Open errand: one transition per edit, supplier changes re-checked in flight

## Context

F2.1 (#268) lets a requester edit every field they set at creation, F2.1.1 (#269) re-runs the F1.1 checks on each edit, and F2.1.2 (#270) refuses an edit unless the errand is `Open`. Only the reward was editable (`Adjusting-Credit`, ADR 0006). The fields split by who must agree to a change:

- `description`, `deliveryDetail`, `collectionItems`, `expiryDurationMinutes`: order-service alone.
- `rewardCredits`: credit-service (the reservation must change).
- `supplierId`, `deliveryBuildingId`: supplier-service (the supplier must exist and be Active, the building must exist).

## Decision

- **`PATCH /v1/errands/:id`, one transition per request.** The body is any subset of the create fields, validated with the create rules. Routing looks at the body only, never at current values, so a retried request with the same Idempotency-Key always takes the same edge:
  - `supplierId` or `deliveryBuildingId` present: `Open` → `Revalidating-Supplier` (`SupplierRevalidationRequested`). The half not sent is re-checked as it stands.
  - otherwise `rewardCredits` present: `Open` → `Adjusting-Credit` (the existing edge; `POST /:id/adjust` stays).
  - otherwise: `Open` → `Open` (`ErrandEdited`).
  - A supplier/building change and a reward change in one request: `422 ONE_PENDING_CHANGE`. An errand holds one in-flight status at a time.
- **Local fields ride on whichever edge is taken.** An edge may list `optional` columns besides its required `sets`. The local changes commit with the transition, before credit or supplier-service answers, and stay if that answer is a refusal.
- **Expiry is measured from when the errand opened.** A new `expiryDurationMinutes` sets `expires_at` to the `occurred_at` of the `Reserving-Credit` → `Open` event plus the new duration (ADR 0007's bounds, 15 min to 168 h). An edit never restarts the clock, so a requester cannot keep an errand open past 168 h in total. A result at or before `now()` is refused (`422 EXPIRY_IN_PAST`). The computed `expiresAt` is recorded in the event, so a rebuild gives the same value.
- **Edits stop at expiry.** The three edit edges refuse an errand past `expires_at` (`EXPIRED`), even before the expiry sweep cancels it.
- **A new in-flight status, `Revalidating-Supplier`, shown as `Open`.** The requested ids wait in `pending_supplier_id` / `pending_delivery_building_id`; the errand keeps its current supplier, building and pickup snapshot (ADR 0009, 0011) meanwhile, and couriers still see it but cannot accept it. Two system exits back to `Open`:
  - `SupplierRevalidated` (reply `FOUND` + Active for the pending ids): supplier, building, `supplier_validated_at`, pickup snapshot and `delivery_location` replaced; pending ids cleared.
  - `SupplierRevalidationFailed` (`NOT_FOUND`, Inactive, `BUILDING_NOT_FOUND`, or no answer within `SUPPLIER_VALIDATION_HOLD_MS`: `TIMEOUT`): pending ids cleared, nothing else changed. Unlike the first validation, a failure never cancels: the old supplier is still valid.
- **A new question per edit.** The request reuses `order.supplier-validation-requested.v1` unchanged, under an event id derived from the errand, the edit's sequence number and the attempt. Supplier-service answers each event id once and rejects a reused id with a different payload, so each edit must be a new id. The resend sweep re-creates the id; `supplier_validation_retries.round` holds the edit's sequence number (0 for the first validation) so a later edit counts attempts from zero.
- **Replies are matched by status.** The supplier reply handler reads the errand first. `Pending-Supplier`: as before. `Revalidating-Supplier`: a reply for the pending ids takes one of the two exits; one naming another supplier, or a `FOUND` naming another building, is acked and logged as stale. Any other status: the reply is late and is acked.

## Rationale

One transition per request keeps the single write path (only `transition()` writes `errands`) and gives each edit one event, one idempotency outcome and at most one notice. Re-checking in flight, rather than sending the errand back through `Pending-Supplier`, avoids releasing and re-reserving credits and avoids cancelling a valid errand because the new choice was refused. Reusing the validation contract means supplier-service needs no change. Routing on the body rather than on the stored values is what keeps idempotent retries stable: after a successful reward edit the stored amount equals the requested one, so value-based routing would send the retry down a different edge and fail its key check.

## Consequences

- A client should send `rewardCredits`, `supplierId` and `deliveryBuildingId` only to change them. Sending the current reward still goes through credit; sending the current supplier still asks supplier-service.
- Local changes sent with a reward or supplier change apply even if credit or supplier-service then refuses.
- The reply contract carries no request id. A late `NOT_FOUND` / `BUILDING_NOT_FOUND` from an earlier re-check of the same supplier can settle the current one. This needs a requester to re-edit to the same supplier within the hold window.
- The requester is not told that a re-check failed; the event payload holds the outcome. That waits on notification-service, as S6 does.
- Amends ADR 0011: the delivery building can now change after creation, through this re-check.
