# Notification Service

Owns the push destinations a user has registered, so the platform can reach
them when an errand event happens. This slice implements **subscription
management**: authenticated users register and unregister Web Push endpoints.

Built with NestJS and TypeScript, PostgreSQL with TypeORM, RabbitMQ (scaffolded
for the future notification fan-out), Joi environment validation, and Vitest.

## Subscription API

Both routes require a user-service access token (httpOnly `access_token`
cookie first, then `Authorization: Bearer`) and always operate on the token
subject: the request body cannot choose a user.

| Method | Path                                     | Result                                                                                                                       |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/subscriptions/web`                  | Registers the browser `PushSubscription` JSON. `201` for a new `(user, endpoint)` pair, `200` when an existing row is refreshed/reactivated. |
| `DELETE` | `/v1/subscriptions/web?endpoint=<url>` | Soft-deletes the `(user, endpoint)` row: `204`, idempotently, even when it was already inactive.                              |

The public path through the frontend proxy is `/api/notifications/...`
(e.g. `POST /api/notifications/subscriptions/web`).

### Data model

One `subscriptions` row per `(user_id, endpoint)`:

- `channel` — `web_push` today; the discriminator keeps the table open to
  other push channels (e.g. direct-to-Android) later.
- `endpoint` — the channel's natural address (Web Push endpoint URL).
- `credentials` — channel-specific payload (`{ p256dh, auth }` for Web Push).
- `status` / `deactivated_at` — subscriptions are soft-deleted, never removed,
  so an endpoint can be reactivated by posting it again.

The schema is currently created by TypeORM `synchronize` in development
(`DB_SYNCHRONIZE`, default `true` in `compose.yml`). The entity and unique
index are written so an explicit initial migration can be generated when the
service adopts the migration discipline used by credit-service.

## Configuration

Copy `../env/notification-service.env.example` to `../env/notification-service.env`.
Database and RabbitMQ passwords are Docker secrets in `secrets/` (copy the
`.example` files). The token verification key is mounted read-only from
`../user-service/secrets/jwt_public_key.secret` as
`/run/secrets/jwt_public_key_notification_service`.

Every environment variable the service reads is validated in
`src/config/environment.schema.ts` and documented in the env example file.

## Running

From the repository root:

```sh
docker compose up -d --wait notification-db rabbitmq
docker compose up -d notification-service
```

From this directory:

```sh
npm run start:dev   # watch mode
npm run build       # nest build
npm run lint        # oxlint --type-aware
npm test            # vitest unit specs
```

Swagger UI is at `/docs` and the generated document at `/docs-json` (internal
port, or via the opt-in `compose.debug.yaml`).
