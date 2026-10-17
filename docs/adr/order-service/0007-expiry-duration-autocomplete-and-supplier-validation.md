# Expiry as a duration, 24h auto-complete, supplier validation timestamp

## Decision

Decided 2026-09-28 / 2026-09-29. Expiry duration implemented as of 2026-10-11; `supplier_validated_at` is not (intentional gap).

- **Expiry (F1.7).** The requester supplies a **duration** (15 minutes to 168
  hours, default 60 minutes), not an absolute time. `expiresAt` is the time of
  the `Reserving-Credit` → `Open` transition plus that duration (F1.7.3). Time
  spent in `Pending` does not count. The duration is stored at creation
  in the `ErrandCreated` payload (`expiryDurationMinutes`, no column); the
  `Reserving-Credit` → `Open` edge sets `expiresAt`. `expiresAt` is null until
  `Open`.
- **Auto-complete.** A `Delivered` errand the requester has not confirmed
  completes automatically 24 hours after `delivered_at`. (An earlier 7-day
  figure and a duplicate backlog item, #309, were mistakes.)
- **`Incomplete` has no credit outcome.** `Delivered` → `Incomplete` emits no
  notice; the reserved credits stay held. Left open for the dispute feature.
- **Supplier validation (F1.4.5).** `supplier_id` is already a column. The
  validation time is **not** recorded as a column (`supplier_validated_at` was
  dropped, see Consequences). **Intentional gap:** F1.4.5 asks for the
  validation datetime on the errand; today it is only the `occurred_at` of the
  `SupplierValidated` event, and the supplier flow is not built yet. Revisit
  when it is.

## Rationale

Counting `Pending` time against a requester's chosen lifetime would let a slow
supplier or credit reply eat into it. A single 24h window matches the
`Picked Up` timeout and the backlog. Leaving `Incomplete` without a credit
action avoids guessing an outcome the dispute feature will define.

## Consequences

No new `errands` column: the projection holds what is sorted and filtered on,
and nothing queries by the duration or the validation time. `expiry_duration`
lives in the `ErrandCreated` payload; the `Reserving-Credit` → `Open` edge reads
it from event 1 in the same transaction. `CONTEXT.md` ("Expiry deadline")
describes this behaviour.
