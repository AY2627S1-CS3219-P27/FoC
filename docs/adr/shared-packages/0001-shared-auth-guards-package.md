# Shared access-token verification guards

## Decision

Access-token **authentication and authorization** shall be centralized in a
shared package, `@foc/auth`, living in `packages/auth` next to
`@foc/contracts`. Every NestJS service (user, order, credit, supplier)
consumes it instead of writing its own guards:

- `FocAuthModule` — a global module registering the verification public key,
  the `AccessTokenVerifier` and the guards. Services import it once in their
  `AppModule`.
- `JwtAuthGuard` — **authentication**: reads the `access_token` cookie first,
  then the `Authorization: Bearer` header, verifies the JWT (RS256, issuer
  `user-service` from the contract) and validates the claims against
  `validateAccessTokenPayload` from `@foc/contracts`, then attaches
  `AuthenticatedUser` to `request.user`. Throws 401.
- `RolesGuard` + `@Roles(...)` — **authorization** with ANY-of semantics: the
  user must hold at least one declared participant role (from the `Role`
  enum in the contract); routes without `@Roles` metadata are unrestricted.
  Throws 403.
- `AdminGuard` — requires `isAdmin`. Throws 403.

Guards are applied per route with Nest's standard `@UseGuards`, keeping
public routes (login, registration) implicitly open.

## Rationale

### One verifier instead of one per service

Token shape, issuer, algorithm, cookie name, and role values all already live
in `@foc/contracts`. Baking the verification into a single shared package
makes every service enforce exactly the same wire contract by construction,
and future claim or role changes stay in the two shared packages instead of
fanning out across services.

### AuthN separate from authZ, admin separate from participant roles

`JwtAuthGuard` only establishes identity. Role and admin checks are separate
guards, mirroring the admin/participation split recorded in
`docs/adr/user-service/005-user-roles-and-token-claims.md`. The participant
role endpoint (`PATCH /users/me/roles`) can therefore never affect admin
status, and `AdminGuard` sits on admin endpoints independently.

### Token sources: cookie with a Bearer fallback

Browsers receive the access token as an httpOnly cookie (`access_token`,
`secure` in production). The guard reads the cookie first, then falls back to
`Authorization: Bearer` so service-to-service calls and API clients work too.

### Packaging: packed install, not the contracts symlink

`@foc/contracts` is symlinked into service `node_modules` (its only runtime
dependency is `joi`). `@foc/auth` depends on `@nestjs/*`, and a symlinked
package would resolve its own _second copy_ of `@nestjs/common`/`@nestjs/core`
next to the service's copies. Two Nest copies in one process break Nest's
exception mapping: an `UnauthorizedException` thrown from the guard's copy is
not recognized by the app's exception filter and surfaces as an internal 500.

So consuming services install `@foc/auth` **as a packed copy** into their own
`node_modules` (`npm install --install-links ../packages/auth`), where npm
dedupes the `@nestjs/*` dependency ranges against the copies the service
already has — exactly one copy, verified by a guard test in user-service
(`test/auth-install-invariant.spec.ts`).

## Consequences

- Services must keep the `@nestjs/*` ranges in `@foc/auth` aligned with their
  own (a non-intersecting version forces a second copy and reintroduces the
  dual-copy bug).
- Every service needs the verification public key (`JWT_PUBLIC_KEY_FILE`)
  mounted; signing (the private key) stays exclusively in user-service.
- Tokens are stateless and may carry stale roles; sensitive endpoints that
  need current state must still check the database (as user-service's
  `GET /users/me` already does).
