# Single ownership of Web Push endpoints

Status: Accepted

## Context

A Web Push subscription (`PushSubscription`) is created by, and belongs to, the
browser profile — not the signed-in account. The endpoint URL and its
encryption keys live in the browser's service worker registration and survive
sign-out, account switches, and page reloads.

The notification-service stores registrations as `(user_id, endpoint)` rows.
That natural key alone cannot express the browser's reality on a shared
machine:

1. User A enables push on a browser. Row `(A, endpoint)` is active.
2. User B signs in on the same browser. The card detects A's live subscription
   and posts it under B's token.
3. With only `(user_id, endpoint)` unique, B's insert succeeds — two active rows
   now point at one endpoint, so both accounts receive pushes there. With a
   conflict rejected outright, A's row stays active instead and A's
   notifications keep appearing while B uses the device.

Either outcome is wrong: a browser endpoint has exactly one live subscription,
so it can have exactly one owner at a time.

## Decision

At most one **active** row may reference an endpoint, enforced by the partial
unique index `UQ_subscriptions_active_endpoint` (`endpoint WHERE status =
'active'`). The existing `(user_id, endpoint)` unique index still prevents
duplicate history rows for one user.

Ownership follows the account that is signed in when the browser presents the
subscription:

- **POST** that violates the active-endpoint index deactivates the previous
  owner's row and inserts the caller's row in a single transaction. A POST for
  a pair the caller already has (active or soft-deleted) is still
  `409 Conflict`, and the client reconciles with PATCH.
- **PATCH** with `status: "active"` reactivates the caller's soft-deleted row
  and, in the same transaction, deactivates any other account's active row for
  that endpoint. This covers A → B → A: A's history row exists, so POST
  conflicts and PATCH takes the endpoint back.
- **DELETE** stays owner-scoped and idempotent.

A push service can re-issue an endpoint for an otherwise unchanged browser
subscription (`pushsubscriptionchange` — VAPID key rotation, or the previous
subscription answering `404`/`410`). That is a *rotation*, distinct from an
account takeover: it is the same user changing endpoints, not another account
claiming one.

- **POST** with `previousEndpoints` deactivates each `(user_id, previousEndpoint)`
  row and stores the new endpoint in one transaction, so no moment exists where
  the user has neither a live destination nor a stale one still receiving
  deliveries. The deactivations are idempotent attempts: a missing or
  already-inactive row is a no-op, and several stale endpoints can be retired
  at once (the browser may rotate repeatedly while no page is open). If the new
  endpoint is owned by another account on a shared browser, the takeover logic
  above runs inside the same transaction.
- The rotation is idempotent for the caller, too: a new endpoint this user
  already registered (active or soft-deleted) is reactivated with the fresh
  credentials instead of returning `409 Conflict`. A conflict would push the
  client onto PATCH, which cannot carry the stale endpoints, and leave them
  active — the one outcome rotation exists to prevent.
- A failed statement aborts a Postgres transaction, so a unique-violation race
  (concurrent registrations for the same new endpoint) cannot be recovered
  inside it. The transaction rolls back and the rotation is retried against the
  committed state, where the existing-row path resolves it; only after the
  retry budget is spent does the request surface as a conflict.
- A `previousEndpoints` entry equal to `endpoint` is not a rotation — it is a
  re-registration that reconciles with PATCH, so it is ignored and falls
  through to the normal create path (a `409` if the pair is already present).

The frontend re-subscribes in the service worker on `pushsubscriptionchange` —
reusing the user agent's own replacement (`newSubscription`) when it exists and
was made under the current VAPID key, and re-subscribing otherwise — and hands
the new subscription (plus the old endpoints) to the app. All subscription
syncs on the page share one queue, so a slower sync can never overwrite a
fresher rotation with an endpoint the browser no longer holds. The message only
reaches page clients that are open, so the worker also persists each old
endpoint in IndexedDB (one record per endpoint, so repeated rotations are not
lost); when the next page loads with no faster path having consumed them, the
sync sends them all as `previousEndpoints` and the rotation completes
atomically then. Until either happens, the push service's `404`/`410` answer to
a delivery deactivates the stale row. The persisted records are not scoped to
an account: if a different user signs in before they are consumed, the rotation
no-ops server-side and the delivery-time path above remains the backstop.

Rows remain soft-deleted, so each account's registration history is preserved.

## Consequences

- A shared browser stops delivering the previous account's notifications as
  soon as the next account registers the subscription.
- The frontend does not need a sign-out hook to be correct; the home page
  claims the endpoint it finds on load (`PushRegistrationSync`), and the server
  resolves ownership. A sign-out cleanup remains a worthwhile belt-and-braces
  addition when sign-out exists.
- Delivery must read active rows only. Fanning out to a former owner's
  deactivated row would put two accounts back on the same endpoint.
- A client that never presents its subscription again (for example an inactive
  browser profile) keeps ownership until another account claims it; there is no
  server-initiated takeover.
- The index ships as the `SingleActiveEndpoint1794086400000` migration. Because
  migrations run on startup, a development database that already contains
  duplicate active rows for one endpoint must have them cleaned before the
  service starts, or the migration fails rather than guessing an owner.
