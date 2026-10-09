# Order-service messaging feature: working doc

Branch: `features/order-service/Messaging-capabilities`. Written 2026-09-28 against `main` @ `a826b0a`. **Updated 2026-10-08** after PR #617 (`fe4e4f3`, closes #352 / L2) merged and the dev settled D1/D4. No messaging code on the branch yet; the only code change since the snapshot is #617.
Audience: an agent starting in a fresh context to work on ONE item below. Read this whole file, then the docs listed in §1, then take one item.

This doc is an analysis snapshot, not a decision record. Anything marked **DECISION** is unresolved and needs the dev. Once a decision is made, record it in an ADR under `../docs/adr/order-service/` (never inside a service folder) and tick/edit the item here.

Nothing here was executed or tested apart from #617, which was reviewed (unit tests, `tsc` and `oxlint` clean; its e2e suite needs the compose Postgres and was not run); everything is from reading docs, code and the GitHub backlog (issue titles only; most issue bodies are empty, the title is the spec).

## 0. Goal and scope

Goal: give order-service its RabbitMQ messaging (publish notices to credit/supplier, consume their replies) so the errand lifecycle can drive credit reservation and settlement.

Out of scope for now (dev's instruction): implementing the create / view / delete order HTTP functionality. Messaging work must not depend on any HTTP endpoint. `createErrand()` and `transition()` already exist as plain functions and are the integration points.

Rules from `AGENTS.md` that apply to every item:
- Only `src/lifecycle/` writes errand state, and every write goes through the one `transition()` function (conditional `UPDATE ... WHERE status = expected` + `INSERT errand_events`, one transaction).
- Allowed transitions live in `src/lifecycle/status.ts` (`ALLOWED`) and must mirror `src/lifecycle/edges.ts` (`EDGES`) and `ARCHITECTURE.md` §2. Change them together.
- New env vars go in three places in this folder: `src/config/environment.schema.ts`, `compose.yml`, `.env.example`.
- ADRs only in top-level `docs/adr/<service>/`.
- Use glossary terms from `../CONTEXT.md` (Requester, Courier, Errand, Credits, Supplier).

## 1. Read first

| Doc | Why |
| --- | --- |
| `order-service/AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md` (README.md is empty) | State model, write path, terms. Note: AGENTS.md mentions `tracking.md`; it does not exist. |
| `docs/adr/order-service/0001`–`0005` | Event sourcing, RabbitMQ notices (0002), advisory-lock sweeps (0003), Drizzle (0004), event record shape + idempotency keys (0005) |
| `docs/adr/0001-domain-event-contracts-and-routing.md` | Cross-service contract: exchange `foc.events` (durable direct), envelope, routing keys, `@foc/contracts` |
| `docs/adr/credit-service/0003`, `0004` | The reference implementation for inbox/outbox and reliable delivery. Order-service should follow this. |
| `packages/contracts/README.md` and `src/domain-events/` | The shared contract package and its registry/validator |
| `credit-service/src/messaging/`, `src/outbox/`, `src/account-initialization/` | Code to copy/adapt |
| `rabbitmq/definitions.json` (repo root) | Broker users, permissions, seeded queues |

## 2. Current state of order-service (facts)

- Stack: NestJS 12 (ESM, `.js` import suffixes), Postgres 18, Drizzle, Joi env validation, Vitest, oxlint.
- Modules: `DbModule` (global `DB` token), `LifecycleModule` (`LifecycleService` wraps `createErrand`, `transition` and, since #617, `rebuild`). No controllers, no messaging, no scheduler, no outbox.
- Schema (`src/db/schema.ts`): `errands` (projection, `last_sequence_number`, `idempotency_key`, `courier_id`, `supplier_id`, `reward_credits int`, `expires_at`, `picked_up_at`, `delivered_at`, `cancellation_reason`), `errand_events` (PK `(errand_id, sequence_number)`, `type`, `from_status`, `to_status`, `schema_version`, `payload jsonb`, `actor_id`, `occurred_at`), `idempotency_keys` (PK `(errand_id, key)`, `fingerprint`, `outcome`). Migrations 0000–0002 in `drizzle/` (#617 added none).
- State model: 11 internal statuses, 18 edges (17 status pairs; `Adjusting-Credit` → `Open` has two exits, picked by `TransitionInput.type` via `findEdge`). Built 2026-10-08 (S0b). `EDGES` maps each edge to an event type plus which projection columns it `sets`/`clears`. `status.spec.ts` asserts `EDGES` mirrors `ALLOWED`.
- `transition()`: optional idempotency key claim, validates `set` columns per edge, conditional update, event insert (payload is now `{...caller payload, ...set, ...cleared}`, so the log records every column the edge changed), results `ok | ILLEGAL_TRANSITION | INVALID_FIELDS | NOT_FOUND | IDEMPOTENCY_KEY_REUSED | STATE_MISMATCH(currentStatus)`; keyless-repeat returns `ok, replayed`. Null actor = system.
- `createErrand()`: inserts errand in `Pending-Supplier` + `ErrandCreated` event 1, whose payload now carries `requesterId`, `supplierId`, `deliveryLocation`, `rewardCredits`, `pickupLocation`, `description`, `expiresAt`; requester-scoped idempotency key.
- `rebuildProjection(db, errandId)` / `foldEvents` (`src/lifecycle/rebuild.ts`, #617): read-only full replay in sequence order, throws on a sequence gap. Folds payload keys named in its `COLUMNS` list into the row; omits `idempotencyKey`, `createdAt`, `updatedAt`. **Any new projection column must be added to `COLUMNS`**, or rebuild silently drops it (applies to `expiry_duration`, `supplier_validated_at`). Strategy recorded in ADR 0005 (section "Projection rebuild: full replay, no snapshots"; that edit was still uncommitted when this was written).
- Tests: unit `src/**/*.spec.ts`; e2e `**/*.e2e-spec.ts` use `test/db.ts` `createTestDb()` (throwaway DB on the compose Postgres, host port 5436, needs the DB secret).
- Docker: `Dockerfile` and `compose.yml` build with the repo root as context so `packages/contracts` is available (same as credit-service). Production `HEALTHCHECK` GETs `/`, but there is no controller so it 404s.
- Root `compose.yaml` has rabbitmq `depends_on` stubs for email, user, credit but NOT order-service.
- Broker (`rabbitmq/definitions.json`): users `guest`, `email-service`, `user-service`, `credit-service` only. No `order-service` user. Seeded queue: `credit-service.user-registered.v1`. Exchanges: `foc.events` (direct) plus email-era `foc.retry|dlq|back`.
- `@foc/contracts` registry contains only `user.registered.v1` and `credit.account-initialised.v1`. Validator class `AccountEventContractValidator` is generic despite its name.
- Counterparts:
  - credit-service consumes only `user.registered.v1` today; reservation/transfer/release handling is open backlog (#522–#576, #583–#584).
  - supplier-service is unscaffolded (`AGENTS.md` says stack undecided; README empty; no code, no RabbitMQ user).
- Untracked `env/` dir at repo root (from the `features/env-migration` work) uses `ORDER_SERVICE_*` var names, unlike `order-service/.env.example` (`ORDER_DB_*`). Root AGENTS.md says there is no root env example. Do not add vars to `env/` until that branch lands.

## 3. Direction assessment

The direction (add RabbitMQ messaging next, per ADR 0002) is right. Three flags:

1. **"Publish after commit" loses messages.** `ARCHITECTURE.md` §3 says publish a notice after commit. A crash between commit and publish strands an errand in `Reserving-Credit`, or drops `ErrandCompleted` so credits never transfer. Credit ADR 0003/0004 solve this with a transactional outbox. Order-service needs the same, with the outbox row written inside the transition transaction.
2. **Counterparts don't exist yet.** Order-side messaging can only be verified with fixtures and fake counterparts (credit does this with `scripts/publish-event-fixture.mjs`). Do not build the supplier path yet.
3. **Backlog rules contradict the "final" state model.** Resolved by D1/D4 (§5): in-flight credit statuses for reserve, transfer and adjust (release is fire-and-forget). The 13-edge model becomes 18 edges, so `status.ts`, `edges.ts`, `status.spec.ts` and `ARCHITECTURE.md` §2 change before more lifecycle code is written.

## 4. Lifecycle gaps

Each item has an ID so a separate context can take it. Group A is required for correctness. Group B (sweeps) is best done after the outbox exists.

### A. Required

- **L1. Notices are not emitted from transitions.** Add an optional notice builder to `Edge` in `src/lifecycle/edges.ts`. `transition()` and `createErrand()` insert the outbox row in the same transaction after the event insert. `replayed` results write nothing (already true, they return early). Edge and status names below are from D1/D4 (§5); the in-flight statuses are `Reserving-Credit` (was `Pending-Credit`), `Transferring-Credit` and `Adjusting-Credit` (option A, built).

  | Edge | Notice |
  | --- | --- |
  | create | supplier validation request (F1.4.2) |
  | `Pending-Supplier` → `Reserving-Credit` | `CreditReservation`, once per errand (F1.6.1) |
  | `Open` / `Accepted` / `Picked Up` → `Cancelled` | `ErrandCancelled` (release), fire-and-forget. Includes requester cancel (`Open` / `Accepted` only), expiry and `PICKUP_TIME_EXCEEDED`; the requester cannot cancel once `Picked Up`. |
  | `Reserving-Credit` → `Cancelled` on timeout | `ErrandCancelled` (release), because a reservation may be in flight (L8). Not on a reservation failure reply (nothing reserved). |
  | `Pending-Supplier` → `Cancelled` | none (nothing reserved) |
  | `Delivered` → `Transferring-Credit` | `ErrandCompleted` (errandId, requesterId, courierId, amount) (F9.11.1). Covers requester confirm and 24h auto-complete. |
  | `Open` → `Adjusting-Credit` | `CreditReservationAdjustment` (F2, #542/#544) |
  | `Transferring-Credit` / `Adjusting-Credit` revert edges | none to credit (the reply already said the step did not happen). A user-facing failure notice is emitted (S6). |
  | `Delivered` → `Incomplete` | none (D5: credits stay held, dispute handling later) |
  | `Accepted` → `Open` | none (F7.5) |

- **L2. Event log can't rebuild the projection** (F9.1, F9.10.3, ADR 0001). **Mostly DONE in #617 (`fe4e4f3`, 2026-10-08, closes #352).** `ErrandCreated` stores the creation fields; `transition()` merges `set` and cleared columns into every event payload; `rebuildProjection` / `foldEvents` replay the stream and e2e tests assert the rebuilt row equals the live row after a full lifecycle and after a cancel. Strategy (full replay, no snapshots) is recorded in ADR 0005. Remaining:
  - Keep `COLUMNS` in `rebuild.ts` in step with the schema: add `expiryDuration`, `supplierValidatedAt` and any other new projection column when they land (P6), and extend the rebuild e2e to cover them. The new in-flight statuses need no `COLUMNS` change (status comes from the last event's `to_status`).
  - `ErrandCreated` still stores an absolute `expiresAt`; D2 replaces it with the requester's duration.
  - Known convention gap: a caller `payload` holding a projection column name on an edge that does not own it would reach the log but not the row, and rebuild would disagree with the live row. Documented in ADR 0005; enforced by L3. No current caller breaks it.
  - F9.6 also lists an "event id" that `errand_events` lacks; add `event_id uuid` if taken literally.
- **L3. Per-type payload validation (ADR 0005) is not implemented.** Validate payloads with Joi per `(type, schema_version)` before insert. Needed e.g. for the courier's required withdraw reason (F7.4). Also the enforcement point for the ADR 0005 rule that payloads must not use projection column names (see L2).
- **L4. No actor authorization inside transitions.** `transition()` guards on status only. Add allowed actors per edge, enforced in the conditional `UPDATE` so it is race-safe:

  | Rule | Backlog | Guard |
  | --- | --- | --- |
  | Requester cannot accept own errand | F5.1 | `requester_id <> courier` |
  | Pickup, deliver, courier-withdraw | F6.1, F6.2, F7 | `courier_id = actor` |
  | Confirm, mark incomplete, requester-cancel | F6.3, F6.4, F3 | `requester_id = actor` |
  | Sweeps and replies | | actor null (system) |

  Cancelled edges have several legitimate actors (requester, system); model allowed actors as a set per edge. `Accepted` → `Cancelled` is "if permitted" (F9.4 item 10), rule unspecified.
- **L5. One active errand per courier (F5.6, F5.6.1) is not enforced.** This is the "courier lock": add a partial unique index on `errands(courier_id) WHERE status IN ('Accepted','Picked Up')` and map the unique violation to a `COURIER_BUSY` result. Release is fire-and-forget (D1/D4), so no in-flight status holds a courier and the list does not change.
- **L6. `Open` → `Accepted` ignores expiry (F5.5, F8.1.2).** Add `expires_at > now()` (or null) to that `UPDATE`. This is only a backstop for the gap between `expires_at` and the next expiry sweep (L9): it rejects the accept with `EXPIRED` and does not cancel. Moving the errand to `Cancelled` (`ERRAND_EXPIRED`) is the sweep's job, by design, not a lazy cancel in the accept path.
- **L7. `cancellation_reason` is free text.** Make it a closed set: `SUPPLIER_UNAVAILABLE`, `SUPPLIER_VALIDATION_TIMEOUT`, `ERRAND_EXPIRED`, `PICKUP_TIME_EXCEEDED`, the credit reasons (`INSUFFICIENT_CREDITS`, `MISSING_BALANCE`, credit timeout) and requester-cancel. Validate per edge. F1.2.2/F1.6.4 require the credit rejection reason to be surfaced to the requester.
- **L8. Stale/duplicate reply policy.** A `CreditReservationSuccess` arriving for an errand already `Cancelled` must enqueue a release (`ErrandCancelled` again), otherwise credit holds the funds forever. Other stale replies are acked and dropped, with one exception to design deliberately: a *success* reply that arrives after a timeout-driven revert (S2 in §5) means credit really did act, so dropping it leaves the two services disagreeing. See M5 and S2.

### B. Sweeps (ADR 0003), after M3

- **L9. Sweeps.**
  - expiry `Open` → `Cancelled` (`ERRAND_EXPIRED`), 1-minute interval (F8.1.1). This is the only thing that cancels an expired errand; until it runs, L6 keeps couriers from accepting it.
  - `Pending-Supplier`: retry validation with exponential backoff + jitter, cancel after hold window with `SUPPLIER_VALIDATION_TIMEOUT` (F1.5.2, F1.5.3)
  - `Reserving-Credit` timeout (F1.6.4; hold window not defined in backlog)
  - `Transferring-Credit` and `Adjusting-Credit` reply timeouts. **Do not revert on timeout** (S2 in §5): re-send the notice, and after a retry cap leave the errand in the in-flight status and raise an admin alert.
  - Auto-complete skips an errand whose latest event is the `Transferring-Credit` → `Delivered` revert (S3).
  - `Picked Up` → `Cancelled` `PICKUP_TIME_EXCEEDED`, 24h from `picked_up_at` (F6.5)
  - `Delivered` → `Completed` auto-complete from `delivered_at` (window: see D3)
- Needs: an in-flight entry timestamp for the three credit statuses (`updated_at` only works while nothing else touches the row), supplier retry attempt count + `next_retry_at`, indexes for the scans, hold-window env vars.
- ADR 0003 says `pg_try_advisory_lock`, which is session-scoped. With a `pg.Pool`, take and release it on one dedicated `pool.connect()` client, not through the pool.
- A plain `setInterval` in a lifecycle hook is enough; no `@nestjs/schedule` dependency needed. Sweeps use the null actor, and the keyless-repeat rule already makes duplicate ticks safe (tested).

### Verified OK (no action)

18 edges match `ALLOWED`/`EDGES`/`ARCHITECTURE.md` §2; sequence numbering has no gaps; concurrent accepts single-winner; keyed and keyless idempotency; create idempotency (all covered by existing e2e specs).

## 5. Decisions needed (D-items)

These change the state model or contracts. A context taking any L/M item that touches one of these should stop and get the dev's decision first.

Dev answers recorded 2026-09-28; D1/D4 settled 2026-10-08. D1/D4, D2, D3, D5, D7 are decided; record them in an ADR (see §7 P1) and fix the drift listed in P7. The remaining open points are the S-items under D1/D4.

- **D1 + D4. Waiting on credit-service before the errand changes state.** DECIDED 2026-10-08, refined same day. A credit activity whose outcome the errand depends on goes through an in-flight status that works like `Pending-Credit` does today: the credit reply moves the errand forward on success; on an explicit rejection the errand reverts and the user is notified that a credit-related step failed. In-flight statuses are real rows in `ALLOWED`/`EDGES`, so every change is still one `transition()` and the reply is just another transition. Dev constraint stays: users must not see a "pending" state appear, so the read side collapses each in-flight status into a visible one.

  **Cancellation is the exception: release is fire-and-forget (dev, 2026-10-08).** The reserved credits already belong to the requester and are only being handed back, so the errand does not wait on credit. Any cancel (requester cancel, expiry, `PICKUP_TIME_EXCEEDED`, `Accepted` cancel) goes straight to `Cancelled` and writes an `ErrandCancelled` notice to the outbox in the same transaction. The outbox gives at-least-once delivery, so "fire and forget" means "do not wait for the outcome", not "may be lost". If credit is down the notice queues and the credits reach the requester when it recovers. Consequences:
  - No `Releasing-Credit` status; the direct `Open`/`Accepted`/`Picked Up` → `Cancelled` edges stay as they are today.
  - No revert, so no reply timeout and no sweep loop for release. S1, S4 and S7 below no longer apply to release (kept for the record).
  - A `CreditReleaseRejected` reply (#573) can no longer revert anything. Order logs it and raises an admin alert; it does not need to subscribe to `CreditReleaseSuccess` at all.
  - Contradicts F3.1.4 / #278 ("`Cancelled` only after `CreditReleaseSuccess`, stays `Open` on `CreditReleaseRejected`"). Update those backlog items (as with #309) or this decision will look like a bug.
  - Requesters see their balance come back "eventually", not at the moment of cancel.

  The credit activities and their in-flight statuses (names are proposals, see "Naming" below):

  | Credit activity | Replaces edge(s) | In-flight status | On success | On failure |
  | --- | --- | --- | --- | --- |
  | Reserve | `Pending-Supplier` → `Reserving-Credit` (rename only) | `Reserving-Credit` (was `Pending-Credit`) | → `Open` | → `Cancelled` with a credit reason. Nothing earlier to revert to; the reservation never held. |
  | Transfer | `Delivered` → `Completed` | `Transferring-Credit` | → `Completed` | explicit rejection → back to `Delivered`, then the admin path (S3) |
  | Adjust (edit, D6) | new: `Open` → `Open` with a new amount | `Adjusting-Credit` | → `Open` with the new `rewardCredits` | explicit rejection → `Open`, amount unchanged |
  | Release | `Open` / `Accepted` / `Picked Up` → `Cancelled` | none (fire-and-forget) | | |

  Visible as: `Reserving-Credit` → `Pending` (as `Pending-Credit` was); `Transferring-Credit` → `Completed` (decided 2026-09-29); `Adjusting-Credit` → `Open`.

  **Edge count: 13 → 18.** `Delivered` → `Completed` is replaced by `Delivered` → `Transferring-Credit`, `Transferring-Credit` → `Completed`, `Transferring-Credit` → `Delivered` (net +2). Adjust adds `Open` → `Adjusting-Credit`, `Adjusting-Credit` → `Open` (success) and `Adjusting-Credit` → `Open` (rejected) (+3). Update `ALLOWED`, `EDGES`, `status.spec.ts` and `ARCHITECTURE.md` §2 together (P7). Two engine notes for the adjust edges: `EDGES` is keyed `[from][to]`, so two edges between the same pair (success vs rejected) need a discriminator (key by event type, or make the reply handler choose between two edge entries); and `rewardCredits` must join `Col` so the success edge can `set` it. Adjust is not needed for messaging init and can follow the transfer path.

  **Naming.** The existing `Pending-Supplier` / `Pending-Credit` pair collapses to `Pending` on the read side, so a `Pending-*` name for the new statuses would read as the same family and wrongly collapse to `Pending`. Options:

  | Option | Reserve / Transfer / Adjust | Note |
  | --- | --- | --- |
  | A (recommended) | `Reserving-Credit` / `Transferring-Credit` / `Adjusting-Credit` | Gerund + object; names the credit action in flight, keeps the `Title-Case-Hyphenated` style, no clash with the `Pending-*` read-side rule. |
  | B | `Pending-Reservation` / `Pending-Transfer` / `Pending-Adjustment` | Closest to today's name, but the read side must special-case which `Pending-*` collapse to `Pending`. |
  | C | `Awaiting-Reservation` / `Awaiting-Transfer` / `Awaiting-Adjustment` | Says "waiting on credit-service"; also clear of `Pending-*`. |

  Renaming `Pending-Credit` is a one-line `ALTER TYPE errand_status RENAME VALUE` migration (ADR 0005); existing event rows follow because they store the enum. Event type names (`SupplierValidated`, `CreditReserved`) are unaffected. Adding the other values is `ALTER TYPE ... ADD VALUE`, and a new value cannot be used in the same transaction that adds it, so keep the migration and any seed data separate.

  **Decided on the points surfaced (dev, 2026-10-08):**
  - **S1. Revert target.** Derive it from the latest event's `from_status`. Only needed if a blocking release is ever reintroduced; today no status has more than one revert target, so it is moot.
  - **S2. A reply timeout must not revert.** DECIDED: revert only on an explicit rejection reply. On a timeout order does not know whether credit acted: a revert followed by a late `CreditTransferSucceeded` would leave funds moved while the errand is back in `Delivered`. On timeout, re-send the same notice (credit dedups on `errandId`/`eventId`), and after a retry cap leave the errand in the in-flight status and raise an admin alert. Applies to `Transferring-Credit` and `Adjusting-Credit`.
  - **S3. Transfer rejection must not loop.** DECIDED, scoped to transfer only (release no longer blocks). A "credit revert" here means the revert edge `Transferring-Credit` → `Delivered`, taken on an explicit `CreditTransferRejected`; its event is the errand's latest event until something else happens. The auto-complete sweep skips an errand whose latest event is that edge (read from the log, no new column), so the rejected transfer is not retried every tick. Such an event is expected to be very rare, since the amount is already reserved and a rejection means something is wrong on credit's side (e.g. `DESTINATION_ARCHIVED`, #584), so the errand goes to an admin rather than a retry loop. Still to design: how an admin sees these (a query over "`Delivered` with a revert latest event" is enough; a dedicated status is not needed) and how the admin re-triggers or resolves. A requester pressing confirm again still works, since the skip only applies to the sweep.
  - **S4. Courier lock.** The "courier lock" is L5: the partial unique index that stops a courier holding two active errands at once. It only needed `Releasing-Credit` while release blocked. With release fire-and-forget the index stays `status IN ('Accepted','Picked Up')`.
  - **S5. Other credit-touching places.** (a) Edit becomes `Adjusting-Credit` (table above). (b) `Delivered` → `Incomplete` has no credit outcome (D5): ignored for now. (c) `Reserving-Credit` → `Cancelled` has two cases. *Explicit rejection* (`INSUFFICIENT_CREDITS`, `MISSING_BALANCE`): credit never held anything, so cancel with that reason and send no release. *Timeout*: order cannot know whether credit will still reserve later, and the requester must not wait forever, so order cancels (cancelling is the only exit, there is no earlier state to revert to) and sends a defensive release notice. If a `CreditReservationSuccess` then arrives for the `Cancelled` errand, L8 sends another release. Both rely on credit treating a release for a missing or not-yet-processed reservation as a safe no-op, and on not applying a reservation after its release. That is a contract point to agree with the credit owner (P2).
  - **S6. Notifying the user.** The revert edge writes an event (e.g. `CreditTransferFailed`) whose payload, the private JSON on that `errand_events` row (ADR 0005), carries the reason from credit's reply (`DESTINATION_ARCHIVED`) and the credit event id. It is not a projection column because the `errands` row holds current state that is sorted and filtered on, and "last credit failure" is history that nothing queries by: a column would need a migration, a `COLUMNS` entry in `rebuild.ts`, clearing on the next success, and would duplicate the log. The log keeps it permanently and the read side can read the latest event if it ever needs to show it. Delivery: the dev's idea is to push the revert event to a notification (popup) service. That fits: emit it through the outbox as a notice (new `@foc/contracts` event, e.g. `order.credit-step-failed.v1`), so it commits with the revert. No such consumer exists yet, and a direct exchange drops a message with no bound queue (P3), so the notification service has to seed its queue before this is published. Keep two cases distinct in the message: an explicit rejection (reason known, errand reverted) versus credit being unreachable (timeout, retry cap hit, errand left in flight and escalated), since the user-facing wording differs. Note `Transferring-Credit` shows as `Completed`, so a rejected transfer visibly flips back to `Delivered`; the notification has to explain that.
  - **S7. Blocking.** Settled by the fire-and-forget release decision above. `Transferring-Credit` and `Adjusting-Credit` still block: while in flight the errand rejects other transitions (all expect another status), which is intended, and keeping the reply timeout and retry cap (L9) short enough bounds it.
- **D2. Expiry deadline.** DECIDED. The requester supplies a **duration** (range 15 minutes to 168 hours, default 60 minutes per F1.7.2), not an absolute time. `expiresAt` = the timestamp of the `Pending-Credit` → `Open` transition + duration (F1.7.3). Time in `Pending` no longer counts against it. Work: `createErrand()` takes `expiryDuration` and stores it (new column `expiry_duration`, or in the `ErrandCreated` payload plus a column); the `Pending-Credit` → `Open` edge `sets` `expiresAt`; `Cancelling` → `Open` (D1) leaves it unchanged; validate the range at create. Amends `CONTEXT.md` ("Expiry deadline"), `ARCHITECTURE.md` §4 and the `schema.ts` `expiresAt` comment. `expires_at` stays null until `Open`; the `(status, expires_at)` index and the L9 expiry sweep are unaffected.
- **D3. Auto-complete window.** DECIDED: 24 hours from `delivered_at`. #309 (F6.3.1) was an accidental duplicate and will be closed; #317 (F6.6) and F6.6.1 will be updated to 24h. Fix the `schema.ts` `deliveredAt` comment (says 7d).
- **D5. `Incomplete` has no credit outcome.** DECIDED: left indeterminate for now, for future dispute handling. `Delivered` → `Incomplete` emits no notice; the reserved credits stay held. Do not add a release or transfer here. Revisit with the dispute feature.
- **D6. Edit (F2, #267–#273).** `Open` → `Open` with the new amount applied only after `CreditReservationAdjustmentSuccess`. No edge exists, and it conflicts with "only Lifecycle writes, through one transition function". Not required for messaging init, but the design must leave room. Same wait-on-credit shape as D1/D4, so the in-flight-status approach covers it (`Adjusting-Credit`, visible as `Open`); see S5.
- **D7. F1.4.5 (#253)** DECIDED: on supplier validation, record the `supplier_id` and the validation datetime on the errand. `supplier_id` already exists; add `supplier_validated_at timestamptz` (set by the `Pending-Supplier` → `Reserving-Credit` edge). Both go in the event payload too (L2). Add the column in the next migration (`0004` or later, P6).
- **D8. Shared messaging code.** Copy credit's transport into order-service now (recommended), or extract a shared package first. Extraction touches credit's in-flight code; revisit when supplier-service becomes the third user.

## 6. Messaging design (how it should work)

Follow credit ADR 0004 and 0003. Concretely:

- **M1. Contracts first.** Add versioned events to `packages/contracts/src/domain-events/events/<event>/v1/` (contract.ts, schema.json, contract.spec.ts), register in `event-registry.ts`, export from `index.ts`, update `event-registry.types.ts`. Envelope is fixed: `eventId`, `eventType`, `timestamp`, `publisher`, `payload`; unknown fields rejected. Routing key style suggestion: `order.errand-completed.v1`, `order.credit-reservation-requested.v1`, `credit.reservation-succeeded.v1`, etc.

  Payloads known from backlog:
  - `CreditReservationSuccess` (#530): errandId, requesterId, reservedAmount, creditTransactionId
  - `CreditReservationRejected` (#526): errandId, requesterId, requestedAmount, reason (`INSUFFICIENT_CREDITS` | `MISSING_BALANCE`)
  - `ErrandCompleted` (#354): errandId, requesterId, courierId, amount
  - `CreditReleaseSuccess` (#576): errandId, requesterId, releasedAmount, creditTransactionId
  - `CreditReleaseRejected` (#573): errandId, requesterId, reason
  - `CreditTransferSucceeded` (#557): errandId, requesterId, courierId, transferredAmount, creditTransactionId
  - `CreditTransferRejected` (#559): errandId, requesterId, courierId, reason
  - `CreditReservationAdjusted*` (#542, #544)
  - `ErrandCancelled` fields (F11.1, #370): body empty, must be agreed with the credit owner
  - Supplier request/reply: no spec yet.

  Order-service errand event payloads (the `errand_events.payload`) are private and NOT part of contracts (ADR 0005). Only inter-service notices go in `@foc/contracts`. Coordinate every payload with the credit-service owner.
- **M2. Transport.** Copy `credit-service/src/messaging/*` (`rabbitmq-consumer.transport.ts` 927 lines, `amqp-connection.provider.ts`, `rabbitmq-connection-url.provider.ts`, `rabbitmq-message.types.ts`, plus specs). Rename exchanges to `foc.order.retry`, `foc.order.back`, `foc.order.dlx`. It gives per-subscription channel + prefetch, retry queues `<queue>.retry.1..5`, `<queue>.dlq`, manual ack after durable work, confirmed republish, recovery. It is ORM-independent. One subscription per routing key (the transport supports one key per subscription).
- **M3. Outbox.** Drizzle `outbox_events` table with credit's columns: `event_id` PK, `event_type`, `routing_key`, `envelope jsonb`, `created_at`, `published_at`, `attempt_count`, `last_error`, `next_attempt_at`, `claimed_by`, `claimed_until`; partial index on unpublished rows. Copy `outbox.relay.ts`, `rabbitmq-outbox.publisher.ts`, `outbox-relay.lifecycle.ts` unchanged; rewrite `outbox.store.ts` (TypeORM, 106 lines) in Drizzle with `FOR UPDATE SKIP LOCKED`. Migration via `npm run db:generate`. Publish stored envelope unchanged; set `published_at` only after broker confirm.
- **M4. Emit from transitions.** L1. Also update `ARCHITECTURE.md` §3 (replace "publish notice after commit" with outbox).
- **M5. Reply consumers.** Per reply key: validate with contracts, then
  `lifecycle.transition({ errandId, expected, to, actorId: null, idempotencyKey: <envelope eventId> })`.
  This reuses `idempotency_keys` as the inbox (no second inbox table). Result handling:

  | Result | Action |
  | --- | --- |
  | ok or `replayed` | ack |
  | `STATE_MISMATCH` / `NOT_FOUND` | ack; if it was a reservation success for a `Cancelled` errand, also enqueue a release (L8). Timeouts do not revert (S2), so a late success after a timeout still finds the errand in its in-flight status. |
  | `IDEMPOTENCY_KEY_REUSED` | dead-letter |
  | thrown DB error | transient, broker retry |

  Idempotency keys need a retention policy (ADR 0005).
- **M6. Bootstrap.** Subscribe in `OnApplicationBootstrap` (as `user-registered-consumer.lifecycle.ts` does). `main.ts` already calls `enableShutdownHooks()`; shutdown must stop consumers, drain in-flight handlers and confirms, then close.
- **M7. Tests.** Unit with fakes (transport, handlers); DB e2e proving outbox row commits or rolls back with the event (`createTestDb`); a messaging test against a real broker mirroring credit's `test:messaging` (`credit-service/vitest.config.messaging.ts`, compose `test` profile).

## 7. Prerequisites (P-items)

- **P1. ADR.** (D-decisions are in ADR 0006/0007; this one is still to write.) New ADR in `docs/adr/order-service/` for the outbox and topology. It must amend ADR 0002's queue name `order_service.credit_replies`, which breaks the `<service>.<event>.vN` convention and would sit outside an `order-service\..+` permission pattern. ADR 0002's "one queue per counterpart with several outcome keys" also conflicts with the transport's one-key-per-subscription.
- **P2. Contracts PR** (M1), agreed with credit. Supplier contracts can wait.
- **P3. Broker definitions** (`rabbitmq/definitions.json`):
  - Add an `order-service` user + password hash (`rabbitmqctl hash_password`); password lives in an ignored `order-service/secrets/rabbitmq_password.secret` (add a `.example`).
  - Permissions mirroring credit: configure/write `^(foc\.order\.(retry|back|dlx)|order-service\..+)$`, read the same plus `foc\.events`.
  - Seed durable main queues + exact `foc.events` bindings for the reply keys, before credit enables its producer.
  - **Rollout order matters.** A direct exchange silently drops a message with no bound queue, and the publisher confirm still succeeds. Credit's `credit-service.*` queues for the reservation/completion/cancellation keys must be seeded before order publishes them, otherwise reservations vanish and errands stall in `Reserving-Credit`. That is the credit owner's work; coordinate.
- **P4. Packaging.**
  - `package.json`: add `@foc/contracts` (`file:../packages/contracts`), `amqplib`, `@types/amqplib`; add credit's `contracts:build|install` scripts, `postinstall`, and `pre*` hooks.
  - `Dockerfile` + `compose.yml`: build context to repo root (`context: ..`, `dockerfile: order-service/Dockerfile`), copy `packages/contracts` (see `credit-service/Dockerfile`), add contracts `develop.watch` entries, an allowlist `order-service/Dockerfile.dockerignore` (see `credit-service/Dockerfile.dockerignore`), the rabbitmq password secret.
  - Root `compose.yaml`: add order-service `depends_on: rabbitmq: condition: service_healthy` stub.
  - Fix or add a route for the production `HEALTHCHECK`.
- **P5. Config.** Add credit's `RABBITMQ_*` and `OUTBOX_*` sets (see `credit-service/.env.example`, `src/config/environment.ts`) plus sweep hold-window vars to the three places listed in §0. RabbitMQ password via `RABBITMQ_PASSWORD_FILE`, never in the environment.
- **P6. Schema migration** (next after `0003`, which already did the enum changes): outbox table, plus lifecycle columns/indexes from L5, L9, `expiry_duration` (D2) and `supplier_validated_at` (D7), and the matching `COLUMNS` additions in `rebuild.ts` (L2).
- **P7. Doc drift.** DONE 2026-10-08: decisions recorded in ADR 0006 (D1/D4) and ADR 0007 (D2, D3, D5, D7); `CONTEXT.md` expiry/in-flight terms, `ARCHITECTURE.md` (planned-statuses section, §4 expiry), `order-service/AGENTS.md` (`tracking.md` reference), ADR 0005 (Joi vs AJV) and the `credit-service/README.md` link updated. Still to do when the code lands: replace `ARCHITECTURE.md` §2 and the diagram with the 18-edge model together with `status.ts` / `edges.ts` / `status.spec.ts`; ADR 0002's `order_service.credit_replies` queue name (P1); backlog F3.1.4 / #278 (cancel waits for `CreditReleaseSuccess`) and #309/#317/F6.6.1 (24h), which are GitHub issues and were not touched.

## 8. Suggested slices (order of work)

| Slice | Contents | Blocked by |
| --- | --- | --- |
| S0 | Decisions: D1/D4, D2, D3, D5, D7 taken; dev still to confirm the D1/D4 naming option, the admin path in S3 and the notification delivery in S6. P1 ADR, P2 contracts, P3 broker, P4 packaging, P5 config | dev, credit owner |
| S0b | D1/D4 state-model change: rename + add in-flight statuses, 18 edges, `status.ts` / `edges.ts` / `status.spec.ts` / `ARCHITECTURE.md` in one change (no messaging needed) | naming choice |
| S1 | M2 transport + M3 outbox/relay + M6 bootstrap, no business events; M7 tests | S0 packaging/config/broker |
| S2 | L1/M4 outbound notices from edges; L3 as the payloads need them | S0b, S1 |
| S3 | M5 credit reply consumers + L8 | S2, credit-service reservation handling (or fixtures) |
| S4 | Supplier path | supplier-service existing |
| S5 | L9 sweeps, L4/L5/L6/L7 guards can go any time after S0 | S1 for sweeps that emit |

L4–L7 and L2/L3 are independent of messaging and can be done in parallel contexts.

## 9. Progress log

Update as items complete: item ID, PR/commit, date, any decision taken.

| Item | Status | Notes |
| --- | --- | --- |
| L2 | Done except the items listed under L2 | PR #617, `fe4e4f3`, 2026-10-08. Full-replay rebuild, closes #352. ADR 0005 section written, not yet committed. |
| D1–D7 docs | Done | 2026-10-08. ADR 0006, 0007; CONTEXT/ARCHITECTURE/AGENTS updated. Uncommitted. |
| D1/D4 | Decided | 2026-10-08. In-flight statuses for reserve, transfer, adjust; release fire-and-forget; 13 → 18 edges. Open: S3 admin path, S6 delivery. |
| S0b | Done | 2026-10-08. Option A names built: `Pending-Credit` → `Reserving-Credit`, added `Transferring-Credit`, `Adjusting-Credit`; 18 edges; migration `0003` (enum only; the outbox and other P6 columns will need a later migration number); `rewardCredits` settable; `findEdge` + `TransitionInput.type` for the two adjust exits. Event types: `ErrandConfirmed`, `ErrandCompleted`, `CreditTransferFailed`, `AdjustmentRequested`, `CreditAdjusted`, `CreditAdjustmentFailed`. e2e not run (no Docker). |
| L4 | Done (uncommitted) | 2026-10-09. `Edge.who` roles (requester / courier / other / system) enforced in the conditional UPDATE; new result `FORBIDDEN`. Actor is a required tagged value (`SYSTEM`, `user(id)`; ids must be UUIDs, lowercased); a missing or malformed actor is `INVALID_FIELDS`, never the system; accept requires `set.courierId` = actor. Assumptions to confirm: `Accepted` and `Picked Up` cancel = requester or system; `Pending-Supplier` and credit-wait edges system only; `Delivered` → `Transferring-Credit` = requester or system (auto-complete). |
| L5 | Done (uncommitted) | Migration `0004`: partial unique index. Accept runs in a savepoint, 23505 → `COURIER_BUSY`. Migration fails if existing rows already hold two active errands per courier. |
| L6 | Done (uncommitted) | `Edge.unexpiredOnly` on `Open` → `Accepted`; new result `EXPIRED`. Rejects, does not lazy-cancel. |
| L7 | Done (uncommitted) | `CANCELLATION_REASONS` plus a per-edge subset in `edges.ts`, validated before the transaction (`INVALID_FIELDS`). Added `CREDIT_TIMEOUT` and `REQUESTER_CANCELLED`. Column stays `text` (no enum migration). |
