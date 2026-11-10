# Editing an Open errand: one transition per edit, supplier changes re-checked in flight

## Context

F2.1 (#268) lets a requester edit every field they set at creation, F2.1.1 (#269) re-runs the F1.1 checks on each edit, and F2.1.2 (#270) refuses an edit unless the errand is `Open`. Only the reward was editable (`Adjusting-Credit`, ADR 0006). The fields split by who must agree to a change:

- `description`, `deliveryDetail`, `collectionItems`, `expiryDurationMinutes`: order-service alone.
- `rewardCredits`: credit-service (the reservation must change).
- `supplierId`, `deliveryBuildingId`: supplier-service (the supplier must exist and be Active, the building must exist).

## Decision

- **`PATCH /v1/errands/:id`, one transition per request.** The body is any subset of the create fields except `deliveryVenueId` and `deliveryPin` (ADR 0012), validated with the create rules. Routing looks at the body only, never at current values, so a retried request with the same Idempotency-Key always takes the same edge:
  - `supplierId` or `deliveryBuildingId` present: `Open` → `Revalidating-Supplier` (`SupplierRevalidationRequested`). The half not sent is re-checked as it stands.
  - otherwise `rewardCredits` present: `Open` → `Adjusting-Credit` (the existing edge; `POST /:id/adjust` stays).
  - otherwise: `Open` → `Open` (`ErrandEdited`).
  - A supplier/building change and a reward change in one request: `422 ONE_PENDING_CHANGE`. An errand holds one in-flight status at a time.
- **Local fields ride on whichever edge is taken.** An edge may list `optional` columns besides its required `sets`. The local changes commit with the transition, before credit or supplier-service answers, and stay if that answer is a refusal.
- **Expiry is measured from when the errand opened.** A new `expiryDurationMinutes` sets `expires_at` to the `occurred_at` of the `Reserving-Credit` → `Open` event plus the new duration (ADR 0007's bounds, 15 min to 168 h). An edit never restarts the clock, so a requester cannot keep an errand open past 168 h in total. A result at or before `now()` is refused (`422 EXPIRY_IN_PAST`). The computed `expiresAt` is recorded in the event, so a rebuild gives the same value.
- **Edits stop at expiry.** The three edit edges refuse an errand past `expires_at` (`EXPIRED`), even before the expiry sweep cancels it.
- **A new in-flight status, `Revalidating-Supplier`, shown as `Open`.** The requested ids wait in `pending_supplier_id` / `pending_delivery_building_id`; the errand keeps its current supplier, building and pickup snapshot (ADR 0009, 0011) meanwhile, and couriers still see it but cannot accept it. Two system exits back to `Open`:
  - `SupplierRevalidated` (reply `FOUND` + Active for the pending ids): supplier, building, `supplier_validated_at`, pickup snapshot and `delivery_location` replaced; pending ids cleared. A changed building also drops any venue or pin: `delivery_venue_id` is cleared, and `delivery_venue` and the coordinates become the new building's (`Around <building>`). A supplier-only change leaves them as they are.
  - `SupplierRevalidationFailed` (`NOT_FOUND`, Inactive, `BUILDING_NOT_FOUND`, a late `VENUE_NOT_FOUND`, or no answer within `SUPPLIER_VALIDATION_HOLD_MS`: `TIMEOUT`): pending ids cleared, nothing else changed. Unlike the first validation, a failure never cancels: the old supplier is still valid.
- **A new question per edit.** The request reuses `order.supplier-validation-requested.v1` without `deliveryVenueId`, under an event id derived from the errand, the edit's sequence number and the attempt. Supplier-service answers each event id once and rejects a reused id with a different payload, so each edit must be a new id. The resend sweep re-creates the id; `supplier_validation_retries.round` holds the edit's sequence number (0 for the first validation) so a later edit counts attempts from zero.
- **Replies are matched by status.** The supplier reply handler reads the errand first. `Pending-Supplier`: as before. `Revalidating-Supplier`: a reply for the pending ids takes one of the two exits; one naming another supplier, or a `FOUND` naming another building, is acked and logged as stale. Any other status: the reply is late and is acked.

## Rationale

One transition per request keeps the single write path (only `transition()` writes `errands`) and gives each edit one event, one idempotency outcome and at most one notice. Re-checking in flight, rather than sending the errand back through `Pending-Supplier`, avoids releasing and re-reserving credits and avoids cancelling a valid errand because the new choice was refused. Reusing the validation contract means supplier-service needs no change. Routing on the body rather than on the stored values is what keeps idempotent retries stable: after a successful reward edit the stored amount equals the requested one, so value-based routing would send the retry down a different edge and fail its key check.

## Consequences

- A client should send `rewardCredits`, `supplierId` and `deliveryBuildingId` only to change them. Sending the current reward still goes through credit; sending the current supplier still asks supplier-service.
- Local changes sent with a reward or supplier change apply even if credit or supplier-service then refuses.
- The reply contract carries no request id. A late `NOT_FOUND` / `BUILDING_NOT_FOUND` from an earlier re-check of the same supplier can settle the current one. This needs a requester to re-edit to the same supplier within the hold window.
- The requester is not told that a re-check failed; the event payload holds the outcome. That waits on notification-service, as S6 does.
- A venue or pin cannot be chosen by an edit, only dropped by a building change. A building change on an errand with a blank `deliveryDetail` (allowed with a venue) must bring a note, or it is 400 `INVALID_FIELDS`.
- Amends ADR 0011: the delivery building can now change after creation, through this re-check.

## Follow-up: reward and supplier in one edit (design agreed, NOT built)

Today a reward change together with a supplier/building change is `422 ONE_PENDING_CHANGE` (the frontend's `editProblem` in `edit-errand.ts` blocks it first). Agreed design for allowing both in one PATCH:

**Rejected**
- Sync edit (calling credit/supplier inside the request): credit is money; a timeout or a failed local write after credit applied leaves the services disagreeing, which the outbox and in-flight statuses (ADR 0006, 0008) exist to avoid.
- True parallel in-flight (both at once): needs sub-state flags instead of one status enum; touches every transition, rebuild and sweep.

**Decided**
- **One edit, two steps in sequence**, like creation: a new internal in-flight status (working name `Editing`) chains the credit and supplier steps. Either step failing rolls the whole edit back and tells the requester.
- **No new columns.** The tables are already wide, so pending values and previous values live in the event log, not on `errands`:
  - The edit-request event payload carries the new values (reward, supplier, building) and a snapshot of the previous local-field values (`description`, `deliveryDetail`, `collectionItems`, expiry).
  - Rollback reads that payload and restores the previous values in the failure transition. Rebuild stays deterministic because the values are in the events.
  - This also means local fields follow "applied now, restored on failure" (not "held until success") for the combined edit.
- **Client-facing status `Updating`** for the in-flight edit statuses. This also fixes the visibility gap where `Adjusting-Credit` and `Revalidating-Supplier` both read as `Open`, so a separate `pendingChange` field is not needed.
- **Failure message is derived, not stored.** The errand detail query reads the latest event; if it is an edit-failure event it returns a computed `lastEditResult` (e.g. `{ step: 'supplier', outcome: 'INACTIVE' }`), else null. It clears itself on the next event (new edit, accept, cancel). Cost: one indexed `ORDER BY seq DESC LIMIT 1` on the detail read. A new `EditFailed` event carries `{ step: 'supplier' | 'credit', outcome }`; existing `CreditAdjustmentFailed` (`reason`, `requestedAmount`) and `SupplierRevalidationFailed` (`supplierOutcome`) already carry what single-service failures need.

**Still open (decide before building)**
1. **Order of the steps.** Stated preference: credit first, then supplier (as creation was described). Recommendation: supplier first. Credit-first means a supplier refusal must reverse an already-applied credit adjustment with a second credit call, which can itself fail or time out and strand the errand. Supplier-first moves no money until the supplier is confirmed, so neither failure needs compensation. With pending values in the event log, supplier-first no longer needs a `pending_reward_credits` column, so the earlier objection to it is gone.
2. **Do single-service edits also adopt "restore local fields on refusal"?** Today (above) local fields stay even if credit or supplier refuses. Changing this amends the decision above.
3. **Courier list.** Check how `GET /v1/errands` filters `Open`; errands in `Updating` must not vanish from couriers without explanation (they cannot be accepted meanwhile anyway).
4. **Push/in-app notice to the requester** through the outbox to notification-service, modelled on `requesterCancelled` in `edges.ts`. Not checked against notification-service's contract. The derived `lastEditResult` is the source of truth; the notice is only a nudge, so it can come later.

**Touches if built:** `edges.ts` and `status.ts` `ALLOWED` (new status and edges), `payloads.ts` (edit-request payload with previous values, `EditFailed`), the credit and supplier reply handlers (route by whether the edit is chained), sweeps (hold window for the new status) and rebuild, the controller's `ONE_PENDING_CHANGE` branch, `api-status.ts` (`Updating`), `errands.query.ts` (`lastEditResult`), frontend `edit-errand.ts` / `types.ts` / `ui.tsx` / the detail sheet, ARCHITECTURE §2 and CONTEXT.md, and specs.
