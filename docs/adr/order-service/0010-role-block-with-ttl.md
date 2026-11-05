# Role block with a TTL, serialized by a per-user advisory lock

## Context

When a user loses the requester or courier role (or their account is
archived), user-service needs order-service to confirm they have no ongoing
errands for that role (F10) and to stop new ones starting. Only order-service
can do both atomically, since it owns errands.

Removing the role in user-service is not enough on its own. Access tokens last
15 minutes and carry `roles`, so a device holding a stale token still passes
the role guard and can keep creating or accepting errands until it refreshes.

## Decision

- **Check and block in one call.** `POST v1/role-blocks` takes `{ userId, roles[] }`
  and, in one transaction, checks each role has no ongoing work and upserts a
  row per role into `role_blocks (user_id, role, expires_at)`. All or nothing:
  if any role is in use it returns `409 ROLE_IN_USE` and blocks nothing.
  `DELETE v1/role-blocks` removes blocks early (role re-added, or the role
  change failed). Caller is an admin or the user themselves.
- **In use** means: requester on any errand not `Completed`, `Cancelled` or
  `Incomplete`; courier on an `Accepted` or `Picked Up` errand.
- **TTL, not permanent.** `expires_at = now + ROLE_BLOCK_TTL_MS` (default
  960000: the 15-minute access token plus 1 minute skew). By then any token the
  user can hold has been refreshed and no longer carries the role, so the role
  guard takes over. A repeat block refreshes the expiry.
- **One read rule.** `isRoleBlocked` (a row with `expires_at > now()`) is the only
  check. `createErrand` (requester) and every transition edge that sets
  `courierId` (accept) call it and refuse with `ROLE_BLOCKED` (HTTP 403). Like
  `COURIER_BUSY`, the refusal is never stored under an idempotency key, so a
  retry after expiry or unblock runs fresh.
- **Per-user advisory lock.** Block, unblock, create and accept each take
  `pg_advisory_xact_lock(hashtextextended(lower(userId), 0))` first and hold it
  to commit. A block and a concurrent create or accept for the same user
  therefore serialize: one sees the other's write, and they never both
  succeed. The id is lowercased because the key hashes text while `uuid`
  columns compare case-insensitively.

## Consequences

- This is a second use of advisory locks, next to sweep scheduling (ADR 0003).
  It differs in kind: transaction-scoped and blocking (`pg_advisory_xact_lock`),
  per user, rather than session-scoped and non-blocking per tick. Nothing takes
  a row lock and then waits on a user lock, so there is no deadlock cycle.
- The block writes only `role_blocks`; the Lifecycle module stays the only
  writer of errands.
- The TTL must be at least user-service's access-token lifetime. This cannot be
  validated across services; it is an operator setting.
- Expired rows are never deleted. They are bounded at two per user and every
  read filters on expiry. A cleanup sweep can be added if the table ever
  matters.
- A repeat of an already-successful create under the same key is refused while
  the requester is blocked, because the check runs before the insert. A stored
  successful accept still replays as success, because the key is claimed
  before the check. Both are accepted.

## Alternatives rejected

- **Permanent block until unblocked.** It relies on user-service always
  calling unblock, including after crashes or failed role changes. A missed call
  locks the user out of a role indefinitely. The TTL bounds that failure to the
  token lifetime.
- **Check only, no block.** A new errand could start between the check and the
  role change taking effect, or later from a stale token.
- **Revoke tokens instead.** Access tokens are stateless JWTs verified locally
  by each service; revocation would need a shared denylist on every request.
