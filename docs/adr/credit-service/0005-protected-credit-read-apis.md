# Protect Credit Read APIs with Shared RS256 Authentication

## Context

Credit Service must expose the authenticated user's available and reserved
credit balances and an advisory answer indicating whether the available balance
is sufficient for a proposed reservation. These APIs expose user-specific
financial information and therefore require authentication and self-only
authorization.

The sufficiency result is necessarily a point-in-time observation. Another
operation can change the available balance after the response is returned, so
the read API cannot authorize a later reservation. The future reservation
consumer must make its own authoritative decision while applying the balance
mutation atomically.

The repository now provides `@foc/contracts` as the authoritative token-claim
contract and `@foc/auth` as the shared Nest authentication and authorization
boundary. The latter verifies User Service's RS256 tokens with a public key,
enforces the fixed issuer and contract claims, and extracts credentials from a
secure cookie or bearer header. Credit Service must consume this package rather
than maintain a separate verifier that can drift from the issuer.

## Decision

### HTTP interfaces

Credit Service exposes two versioned, read-only endpoints.

`GET /v1/credits/balance` derives the account identity exclusively from the
verified token's `sub` claim and returns exactly:

```json
{
  "userId": 7,
  "creditBalance": 100,
  "reservedBalance": 0
}
```

`creditBalance` maps to `credit_accounts.credit_balance` and
`reservedBalance` maps to `credit_accounts.reserved_balance`.

`POST /v1/credits/sufficiency` accepts exactly:

```json
{
  "userId": 7,
  "amount": 50
}
```

`amount` must be a positive integer within JavaScript's safe-integer range.
`userId` must be a positive 32-bit PostgreSQL integer and equal the verified
token's `sub` claim. The response contains exactly:

```json
{
  "userId": 7,
  "amount": 50,
  "sufficient": true
}
```

The result is `true` when `credit_balance >= amount`, including when the values
are equal. Both endpoints use an ordinary primary-key lookup without a row lock
or balance-changing transaction. They do not update an account, increment its
version, reserve credits, create a credit transaction, or write inbox or outbox
records.

The endpoint contracts, validation constraints, security schemes, success
responses, and error responses are published through the service's generated
OpenAPI document.

### Authentication

Credit Service verifies access tokens locally and does not synchronously call
User Service. A token may be supplied through either:

- `Authorization: Bearer <token>`; or
- the `access_token` cookie.

The shared extractor gives the cookie precedence and falls back to the bearer
header only when the cookie is absent.

Credit Service reads `JWT_PUBLIC_KEY_FILE` through validated configuration and
loads the PEM public key from that mounted secret file, following its existing
file-backed credential pattern. It then registers `FocAuthModule` with the
public key. The private signing key never enters Credit Service. Both endpoints
use the shared `JwtAuthGuard`; they do not use `RolesGuard` or `AdminGuard`
because possession of a valid identity plus the self-only subject rule is the
complete authorization policy for these routes.

Only the `RS256` algorithm and fixed `user-service` issuer are accepted. A
valid principal requires:

- an unexpired token;
- `sub` containing a positive PostgreSQL-integer user ID;
- the required email, display-name, and boolean `isAdmin` identity claims; and
- a `roles` array containing only the canonical participant roles `requester`
  and `courier`; the array may be empty.

No participant role is required because authorization remains self-only; admin
classification is a separate claim and does not bypass the subject check.
Credit Service reads but never creates, refreshes, clears, or persists the
access-token cookie. Raw tokens, signatures, keys, and claim values are not
written to logs.

The shared contract defines the issuer. It does not yet define an audience, so
audience validation remains deferred until a coordinated contract change.

### Authorization, validation, and errors

Missing credentials and malformed, expired, incorrectly signed, or
invalid-claim tokens all return the same `401 INVALID_ACCESS_TOKEN` response.
The shared guard raises `UnauthorizedException`; Credit Service's HTTP error
mapper converts it to this stable envelope without exposing which verification
step failed. The shared package remains responsible for token verification and
does not gain Credit-specific response formatting.

An authenticated sufficiency request whose `userId` differs from `sub` returns
`403 SUBJECT_MISMATCH`. A valid request for a user without a Credit account
returns `404 CREDIT_ACCOUNT_NOT_FOUND`.

Malformed request data and unknown fields return `400 VALIDATION_ERROR`.
Errors use this stable shape, with `reasons` omitted when there are no safe
field-level details:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "reasons": [
    {
      "field": "amount",
      "reason": "amount must not be less than 1"
    }
  ]
}
```

Validation reasons identify fields and rules but never echo rejected values.

### Authoritative reservation behavior

The sufficiency response is advisory only. Callers must not use it as proof
that a later reservation will succeed, and Order Service must not make the
response a correctness precondition for publishing a reservation command.

The future Credit reservation handler must reload and lock the account inside
its balance-changing database transaction, re-evaluate the available balance,
and publish the authoritative success or rejection outcome. An intervening
balance change may therefore make a reservation fail after a successful
sufficiency response without violating this API contract.

## Rationale

Deriving the balance-query identity from `sub` prevents a caller from selecting
another user's account. Retaining `userId` in the sufficiency request satisfies
the functional contract while an explicit equality check preserves the same
self-only boundary.

Local signature verification keeps the read path independent of User Service
availability and avoids adding a synchronous service dependency. Supporting
both bearer and cookie transport accommodates the secure browser storage
requirement and direct API clients without maintaining two authentication
implementations. Reusing the shared extractor preserves the platform's defined
cookie-first behavior.

Non-locking reads keep the API inexpensive and avoid misleading callers into
believing that a sufficiency result reserves capacity. Rechecking the balance
inside the future reservation transaction is the only point at which Credit
Service can make an authoritative concurrency-safe decision.

## Consequences

- Every protected read requires a valid locally verifiable access token.
- Rotating User Service's signing key requires distributing the corresponding
  public verification key; a multi-key rotation scheme is outside this
  decision.
- A role-less token may use these self-only endpoints; unknown or duplicate
  participant roles violate the shared token contract.
- Browser requests must forward the `access_token` cookie to Credit Service,
  normally through the API gateway, while bearer clients remain supported.
- When both credential forms are present, the shared extractor uses the cookie;
  a stale or invalid cookie is not bypassed by a valid bearer token.
- The sufficiency request repeats the authenticated user ID and can return
  `403`, but the redundancy provides explicit traceability to the functional
  requirement.
- Responses can become stale immediately and must not be cached as reservation
  authority.
- The existing `credit_accounts` primary key supports both lookups. Separately,
  aligning that key with User Service's integer identity amends the
  pre-production initial migration and requires an explicit Credit database
  reset for installations created from the earlier UUID schema.
- Formal certification of the p95 50 ms read target remains scheduled for the
  later performance-testing sprint.

## Requirement Traceability

- Issues #518-#521 / M5.F2-F2.2.1: advisory sufficiency endpoint, input, result,
  and non-mutating behavior.
- Issues #577-#579 / M5.F6-F6.2: protected self-only available and reserved
  balance endpoint.
- N5.2-N5.3.1: validate access tokens and allowed roles and reject invalid
  tokens on protected endpoints.
- N10.3.4.1: design the balance and sufficiency lookups for the future p95
  performance target.
