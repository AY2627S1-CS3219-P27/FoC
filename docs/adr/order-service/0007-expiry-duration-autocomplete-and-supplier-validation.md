# Expiry as a duration, 24h auto-complete, supplier validation timestamp

## Decision

Decided 2026-09-28 / 2026-09-29. Not yet implemented.

- **Expiry (F1.7).** The requester supplies a **duration** (15 minutes to 168
  hours, default 60 minutes), not an absolute time. `expiresAt` is the time of
  the `Pending-Credit` → `Open` transition plus that duration (F1.7.3). Time
  spent in `Pending` does not count. The duration is stored at creation
  (`expiry_duration`, and in the `ErrandCreated` payload); the
  `Pending-Credit` → `Open` edge sets `expiresAt`. `expiresAt` is null until
  `Open`.
- **Auto-complete.** A `Delivered` errand the requester has not confirmed
  completes automatically 24 hours after `delivered_at`. (An earlier 7-day
  figure and a duplicate backlog item, #309, were mistakes.)
- **`Incomplete` has no credit outcome.** `Delivered` → `Incomplete` emits no
  notice; the reserved credits stay held. Left open for the dispute feature.
- **Supplier validation (F1.4.5).** On supplier validation the errand records
  `supplier_id` and `supplier_validated_at`, set by the `Pending-Supplier` →
  `Pending-Credit` edge and written into the event payload.

## Rationale

Counting `Pending` time against a requester's chosen lifetime would let a slow
supplier or credit reply eat into it. A single 24h window matches the
`Picked Up` timeout and the backlog. Leaving `Incomplete` without a credit
action avoids guessing an outcome the dispute feature will define.

## Consequences

Each new projection column (`expiry_duration`, `supplier_validated_at`) must be
added to `COLUMNS` in `rebuild.ts` and to the rebuild e2e, or replay silently
drops it. `CONTEXT.md` ("Expiry deadline") describes this behaviour.
