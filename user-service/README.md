# user-service

Module M.1 of Friend on Campus: registration with NUS email OTP verification,
login and session tokens, participant roles, profile reads and updates, admin
account management, and password reset.

Built with NestJS and TypeScript, PostgreSQL with TypeORM, Redis (OTP and
registration tokens), and RabbitMQ (publishes `UserRegistered` through the
shared `@foc/outbox` package). Authentication is RS256 JWT access tokens in an
httpOnly `access_token` cookie, accepted as `Authorization: Bearer <token>` by
other services; long-lived sessions use the httpOnly `refresh_token` cookie.

## Run npm commands from this directory

Run the normal development stack from the repository root with
`docker compose up -d --wait`; the service and its database are only on the
`internal` network and publish no host ports. For direct access while
debugging, add `-f compose.debug.yaml`, which publishes this service on
`127.0.0.1:${USER_SERVICE_HOST_PORT:-3000}`.

```bash
npm install
npm run start:dev
```

Every environment variable this service reads is listed in
`env/user-service.env.example` (shared ones in `env/shared.env.example`).
Secrets (database, server secret, RabbitMQ password, JWT keys) are mounted as
files under `/run/secrets`, never placed in the environment.

## API docs

Swagger UI is served at `/docs` and the generated OpenAPI document at
`/docs-json`. With `compose.debug.yaml` running, both are reachable at
`http://localhost:3000/docs` and `http://localhost:3000/docs-json`. The
browser reaches this service only through the frontend proxy (`/api/auth/*`,
`/api/otp/*`, `/api/users/*`, `/api/password-reset/*`), which does not expose
the doc endpoints.

The document groups the API into five tags:

| Tag              | Routes                                                              |
| ---------------- | ------------------------------------------------------------------- |
| `auth`           | Registration, login, access-token refresh, logout (one/all devices) |
| `otp`            | NUS email OTP request and validation (issues registration token)     |
| `users`          | Profile reads/updates, role set-replace, self-archive, admin user management |
| `password-reset` | Reset link request and confirmation                                 |
| `health`         | Database-backed liveness probe (Dockerfile `HEALTHCHECK` target)    |

Both cookie (`access_token`, `refresh_token`, `registration_token`) and bearer
inputs are documented as alternative security schemes, along with request,
success, and error examples for every route.

## Errors

Errors use Nest's default exception shape: `statusCode`, `message`, and for
most HTTP exceptions an `error` name. `ValidationPipe` failures return
`400` with the constraint messages as a `message` array, and unknown body
fields are stripped rather than rejected. Guard rejections are `401`;
admin-only endpoints respond `403` to non-admin callers.

## Testing

```bash
npm run test        # unit tests
npm run test:watch  # watch mode
npm run test:cov    # coverage
npm run test:e2e    # e2e tests
```

The shared `@foc/*` packages are built and linked automatically by the
`pre*` npm hooks (`shared:prepare`).
