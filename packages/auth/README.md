# @foc/auth

Shared access-token **authentication and authorization** for Friend on Campus
services. Consuming services verify user-service access tokens and enforce
roles/admin claims uniformly, instead of each service rolling its own guard.

Everything here builds on `@foc/contracts`: the token shape, the strict claim
validation, the `Role` enum, the cookie name, and the fixed issuer all come
from the shared contract, so verifier and signer can never drift apart.

## What it provides

| Export                                       | Purpose                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FocAuthModule`                              | Global module: registers the verifier (RS256 + issuer from the contract) and the guards with the service's public key.                                                                                  |
| `JwtAuthGuard`                               | **Authentication.** Reads the `access_token` cookie (first) or `Authorization: Bearer` header, verifies the JWT and the contract, attaches `AuthenticatedUser` to `request.user`, throws 401 otherwise. |
| `RolesGuard` + `@Roles(...)`                 | **Authorization.** ANY-of participant-role check; 403 when the user holds none of the declared roles. Routes without `@Roles` are unrestricted.                                                         |
| `AdminGuard`                                 | **Authorization.** Requires `isAdmin` (the account axis, separate from participant roles).                                                                                                              |
| `AuthenticatedUser` / `AuthenticatedRequest` | The identity claims attached to `request.user`, and the typed request for controllers.                                                                                                                  |

## Adding @foc/auth to a service

### 1. Depend on it

This package is shared between services the same way `@foc/contracts` is, with
one crucial difference. Do **not** rely on the `file:` symlink for runtime:
`@foc/auth` depends on `@nestjs/*` and must resolve the **same copies** the
service already has, or Nest breaks (thrown 401s surface as 500s). So:

```json
{
  "dependencies": {
    "@foc/auth": "file:../packages/auth"
  },
  "scripts": {
    "auth:deps": "npm install --no-audit --no-fund --prefix ../packages/auth",
    "auth:build": "npm run build --prefix ../packages/auth",
    "auth:link": "npm install --install-links --no-audit --no-fund ../packages/auth",
    "postinstall": "npm run contracts:install && npm run auth:deps",
    "prebuild": "npm run contracts:build && npm run auth:build && npm run auth:link"
  }
}
```

`auth:link` packs the package and installs it **into the service's own
`node_modules`**, where npm dedupes `@nestjs/common`, `@nestjs/core`, and
`@nestjs/jwt` against the copies the service already has. Every build/start/
test flow must run the three `auth:*` steps (order matters: `contracts:build`
before `auth:build`, then `auth:link`). The Dockerfile already copies
`packages/contracts/`; mirror those lines for `packages/auth/`.

> Keep the `@nestjs/*` ranges in `@foc/auth` in lockstep with the services'
> ranges. A version bump that no longer intersects forces npm to install a
> second Nest copy and reintroduces the dual-copy bug.

### 2. Register the module once (in AppModule)

```ts
FocAuthModule.registerAsync({
  inject: [SecretService],
  useFactory: (secretService: SecretService) => ({
    publicKey: secretService.getJwtPublicKey(),
  }),
}),
```

Only the **verification** public key belongs here — never a signing secret.
The module is global, so no other module needs to import it.

### 3. Protect routes

```ts
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get('me')
  async getMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.getUserById(request.user.sub);
  }

  @Get('deliveries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Courier)
  async myDeliveries(@Req() request: AuthenticatedRequest) {
    // only couriers reach this
  }

  @Get('admin/audit')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async audit() {
    // only admins reach this
  }
}
```

Guard ordering: `JwtAuthGuard` first (establishes `request.user`), then the
authorization guard.

## Development

```sh
npm install   # install dev dependencies
npm test      # run the package's own specs (mirrors router-level 401/403/200 flow)
npm run build # compile dist/ (consumers read dist/)
npm run lint  # oxlint
```
