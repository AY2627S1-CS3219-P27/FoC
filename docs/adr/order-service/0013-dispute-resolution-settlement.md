# Dispute resolution settles an `Incomplete` errand through credit, ending in `Resolved`

## Decision

Supersedes the "dispute handling, not built" parts of [ADR 0006](./0006-in-flight-credit-statuses.md). Credit's side is [credit ADR 0010](../credit-service/0010-credit-settlement.md).

An errand lands in `Incomplete` when the requester rejects a delivery or credit rejects the transfer. An admin now settles it:

- **Settlement model.** The admin picks the courier's share `S`, an integer with `0 <= S <= rewardCredits`. The requester gets `rewardCredits - S`. No penalty, no payout above the reserved amount, no platform fee. Credit moves both shares out of the single reservation in one atomic operation.
- **New statuses.** `Settling-Credit` (internal, shown as `Incomplete`) and `Resolved` (terminal, a distinct status rather than a reused `Completed`, so the API and filters can tell a settled dispute from a normal completion). `Incomplete` is no longer terminal.
- **Edges.** `Incomplete` → `Settling-Credit` (admin, writes `credit.settlement.v1` in the same transaction), `Settling-Credit` → `Resolved` (`credit.settlement-succeeded.v1`), `Settling-Credit` → `Incomplete` (`credit.settlement-rejected.v1`, settlement columns cleared so a party never sees an amount that did not move).
- **Retries.** A rejection returns the errand to `Incomplete` and the admin may settle again. `attempt` (the count of `SettlementRequested` events, not a column) is sent to credit, which is idempotent on `errandId + attempt`. Rejected settlements are rate-limited to 3 per rolling hour, counted from the event log.
- **A timeout never reverts.** Same rule as ADR 0006. The sweep re-sends the same `credit.settlement.v1` notice (same event id) once per window; after the cap it raises an admin alert and leaves the errand in `Settling-Credit`.
- **Replies need no attempt number.** Each attempt has one terminal outcome, and attempt 2 exists only after attempt 1's rejection was processed. A redelivery repeats the same event id, which the idempotency key drops, and a stale reply loses at the `WHERE status = expected` check.
- **Reports.** Requester and courier may each file one immutable text report while the errand is `Incomplete`. It locks at the first `SettlementRequested`. A report is not a lifecycle transition and writes no event.

## Consequences

- A user with an `Incomplete` or `Settling-Credit` errand cannot change role or archive (the requester's "ongoing" check counts both). The courier check is unchanged, since a settled payout lands in their balance whatever their role.
- The settlement success payload keeps both transaction ids; each is null when that share is 0.
- Idempotency keys are pruned after `IDEMPOTENCY_KEY_TTL_MS`, so a redelivery older than that, arriving while a later attempt is in flight, would not be dropped. Credit does not produce such redeliveries.
- Attachments to reports and an aging alert for stale disputes are not built.
