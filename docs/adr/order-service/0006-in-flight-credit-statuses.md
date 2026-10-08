# In-flight statuses for credit-dependent transitions; release is fire-and-forget

## Decision

Decided 2026-10-08. Status names below are working names; the final choice is
still open (see Naming).

A transition whose outcome depends on credit-service goes through an internal
in-flight status, the way `Pending-Credit` already does for the reservation.
The credit reply is just another `transition()`. On success the errand moves
forward; on an **explicit rejection** it reverts and the user is notified that
a credit-related step failed. The read side collapses each in-flight status
into a visible one, so users never see a "pending" state appear.

| Credit activity | In-flight status | Success | Explicit rejection | Shown as |
| --- | --- | --- | --- | --- |
| Reserve | `Reserving-Credit` (today's `Pending-Credit`) | `Open` | `Cancelled`, with the credit reason (nothing earlier to revert to) | `Pending` |
| Transfer (`Delivered` → `Completed`) | `Transferring-Credit` | `Completed` | back to `Delivered`, then an admin | `Completed` |
| Adjust (edit an `Open` errand, F2) | `Adjusting-Credit` | `Open` with the new `rewardCredits` | `Open`, amount unchanged | `Open` |

**Release is fire-and-forget.** Every cancellation (requester cancel, expiry,
`PICKUP_TIME_EXCEEDED`, cancel of an `Accepted` errand) goes straight to
`Cancelled` and writes an `ErrandCancelled` notice for credit-service. There is
no in-flight status and no revert. A `CreditReleaseRejected` reply cannot
undo anything; order logs it and raises an admin alert.

**A timeout never reverts.** Silence is not proof that credit did nothing. On a
reply timeout order re-sends the same notice (credit dedups on
`errandId`/`eventId`), and after a retry cap leaves the errand in its in-flight
status and raises an admin alert.

**A rejected transfer is not retried by the sweep.** The auto-complete sweep
skips an errand whose latest event is the `Transferring-Credit` → `Delivered`
revert (read from the log; no new column), and the errand goes to an admin. A
requester confirming again still works.

`Reserving-Credit` → `Cancelled` has two cases. An explicit rejection
(`INSUFFICIENT_CREDITS`, `MISSING_BALANCE`) cancels with that reason and sends
no release, since nothing was held. A timeout also cancels, because the
requester cannot wait forever, and sends a defensive release; a
`CreditReservationSuccess` that later arrives for the `Cancelled` errand
triggers another release.

`Delivered` → `Incomplete` has no credit outcome; the reserved credits stay
held until dispute handling is designed.

**Edges: 13 become 18.** `Delivered` → `Completed` is replaced by `Delivered` →
`Transferring-Credit`, `Transferring-Credit` → `Completed` and
`Transferring-Credit` → `Delivered`. Adjust adds `Open` → `Adjusting-Credit`
and two exits back to `Open` (success, rejected). `ALLOWED`, `EDGES`,
`status.spec.ts` and `ARCHITECTURE.md` §2 change together when this is built.

## Rationale

The previous model committed the terminal state first and treated the credit
notice as fire-and-forget, so it could not express "`Completed` only once the
transfer is confirmed" (#584) or "stay `Open` if the adjustment is refused"
(F2). Real in-flight rows reuse the one write path: each step is one
conditional `UPDATE` plus one event, and a late or duplicate reply loses
safely at the `WHERE status = expected` check.

Release does not wait because the reserved credits already belong to the
requester and are only being handed back. A failure is almost always
credit-service being down, and the transactional notice (queued until the
broker confirms) delivers the release when it recovers. Waiting would also
freeze a courier mid-errand and force a revert target for each of three
origin statuses. The cost: the requester's balance returns shortly after
cancel, not at the moment of cancel, and backlog F3.1.4 / #278 (cancel waits
for `CreditReleaseSuccess`) no longer holds.

Reverting on a timeout would risk the two services disagreeing: a
`CreditTransferSucceeded` arriving after the errand returned to `Delivered`
means funds moved for an errand that is not `Completed`.

The reason for a failure goes in the revert event's private payload
([ADR 0005](./0005-errand-event-record-shape.md)), not a projection column:
the `errands` row holds current state that is sorted and filtered, and "last
credit failure" is history that nothing queries by. A column would need a
migration, an entry in `COLUMNS` (`rebuild.ts`) and clearing on the next
success, and would duplicate the log.

## Naming

`Pending-Supplier` and `Pending-Credit` collapse to `Pending` on the read
side, so `Pending-*` names for the new statuses would be mistaken for that
family. Recommended: `Reserving-Credit`, `Transferring-Credit`,
`Adjusting-Credit`. Alternatives: `Pending-Reservation/Transfer/Adjustment`
(needs a read-side special case) or `Awaiting-*`. Renaming `Pending-Credit` is
an `ALTER TYPE errand_status RENAME VALUE` migration; adding the new values is
`ADD VALUE`, which cannot be used in the transaction that adds it.

## Consequences

- Courier lock (one active errand per courier) stays on `Accepted` and
  `Picked Up`: release does not hold a courier.
- While `Transferring-Credit` or `Adjusting-Credit`, other transitions on the
  errand are refused (they expect another status). The reply timeout and
  retry cap bound this.
- `EDGES` is keyed `[from][to]`; the two `Adjusting-Credit` → `Open` exits need
  a discriminator, and `rewardCredits` must become a settable column.
- Delivering "a credit step failed" to the user is a new notice through the
  outbox to a notification consumer that does not exist yet; its queue must be
  bound before it is published.
