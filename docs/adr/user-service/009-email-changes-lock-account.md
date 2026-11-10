# Email changes lock the account until re-verified

## Decision

When an administrator changes a user's email through the admin user-update
endpoint (F11.1), the account is locked in the same transaction. The user
regains access by completing the password-reset flow (F8), whose link is sent
to the new address. Completing the reset proves ownership of that inbox,
unlocks the account, and revokes the old refresh tokens.

Admin-submitted emails are not restricted to NUS domains, mirroring
admin-created accounts (F15.1.3). Only the format is validated, and the
uniqueness constraint on `users.email` still applies.

## Rationale

An email change moves account recovery and login identity to a new inbox. With
no verification, a typo silently locks the user out, and a mistyped or
malicious address hands account recovery to whoever owns that inbox.

The lock-then-reset flow is the lifecycle already used for admin-provisioned
accounts (F14.2, F15.1): provisioned locked with a discarded password, then
reclaimed through password reset. Reusing it keeps one recovery path, and it
comes with the properties the reset flow already guarantees.

## Consequences

- The admin update and the lock are recorded as separate audit fields
  (`email`, and `isLocked` when it was not already set), so the reason for the
  lock is visible.
- The user must complete a password reset after an email change; they cannot
  log in with the old password until they do.
- A mistyped address is recoverable: the admin can change the email again
  while the account remains locked.
- Locked accounts can still request a reset (`findActiveUserByEmail` excludes
  only archived accounts), so the flow has no dead end.
- Other particulars (display name, profile picture, roles, admin status) do
  not lock the account.
