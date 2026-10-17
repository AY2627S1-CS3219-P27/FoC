# Storing refresh tokens

## Decision

As opposed to storing in redis like with access tokens and OTPs, refresh tokens
shall be stored in the relational store (postgres).

## Rationale

Redis is inherently volatile. Refresh tokens, while still ephemeral, are
longer-lasting (7 days). Access tokens are free to be lost, as clients may
easily renew them with refresh tokens. Losing refresh tokens is less convenient,
and requires direct intervention by the user.

## Consequences

- Slower refreshes
  - This is acceptable, as refreshes are a rarer occurrence
- Cleanup code required
  - Stale entries should periodically be cleaned up
