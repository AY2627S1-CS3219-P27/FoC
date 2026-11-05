# Notification Service

Owns the push destinations a user has registered, so the platform can reach
them when an errand event happens. This slice implements **subscription
management**: authenticated users register and unregister Web Push endpoints.

Built with NestJS and TypeScript, PostgreSQL with TypeORM, RabbitMQ (scaffolded
for the future notification fan-out), Joi environment validation, and Vitest.

## Subscription API

The subscription routes require a user-service access token (httpOnly
`access_token` cookie first, then `Authorization: Bearer`) and always operate on
the token subject: the request body cannot choose a user. The VAPID public key
is public information and needs no token.

| Method | Path                                     | Result                                                                                                                       |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/v1/subscriptions/vapid-public-key`     | Returns `{ publicKey }` for `pushManager.subscribe`. No token required.                                                     |
| `POST` | `/v1/subscriptions/web`                  | Creates the subscription for a new `(user, endpoint)` pair: `201` + `Location`. An existing pair is `409 Conflict` — reconcile it with PATCH instead. An endpoint held by another account is taken over atomically: the previous row is deactivated. |
| `PATCH` | `/v1/subscriptions/web?endpoint=<url>`  | Partial update of an existing row: `status: "active"` reactivates a soft-deleted row (and deactivates another account's row for the same endpoint), `keys`/`expirationTime` refresh credentials. `200`; `404` if the pair is unknown. The endpoint itself is immutable. |
| `DELETE` | `/v1/subscriptions/web?endpoint=<url>` | Soft-deletes the `(user, endpoint)` row: `204`, idempotently, even when it was already inactive.                              |

Clients should POST the fresh subscription and, on `409`, PATCH the same payload
with `status: "active"`. The browser only ever presents live subscriptions, so
that reconciliation is the truthful representation of the browser's state.

The public path through the frontend proxy is `/api/notifications/...`
(e.g. `POST /api/notifications/subscriptions/web`).

### Data model

One `subscriptions` row per `(user_id, endpoint)`, and at most one *active* row
per endpoint:

- `channel` — `web_push` today; the discriminator keeps the table open to
  other push channels (e.g. direct-to-Android) later.
- `endpoint` — the channel's natural address (Web Push endpoint URL). A Web Push
  endpoint belongs to the browser profile, not the account, so
  `UQ_subscriptions_active_endpoint` (a partial unique index over active rows)
  enforces single ownership at any moment.
- `credentials` — channel-specific payload (`{ p256dh, auth }` for Web Push).
- `status` / `deactivated_at` — subscriptions are soft-deleted, never removed,
  so a re-presented live subscription for the same endpoint is reactivated by
  PATCH. A new endpoint is a new subscription (new row); the old inactive row is
  history.

Ownership follows whoever is signed in on the browser. When another account
registers an endpoint that is still active, the previous owner's row is
deactivated and the caller's row created in one transaction; reactivating a
row does the same in reverse. See
[`docs/adr/notification-service/001-single-owner-push-endpoints.md`](../docs/adr/notification-service/001-single-owner-push-endpoints.md).

The schema is currently created by TypeORM `synchronize` in development
(`DB_SYNCHRONIZE`, default `true` in `compose.yml`). The entity and unique
indexes are written so an explicit initial migration can be generated when the
service adopts the migration discipline used by credit-service. Because the
active-endpoint index is unique, a development database created before it
existed must have duplicate active rows for one endpoint removed (or the
`notification-db-data` volume recreated) before the service will start.

## Configuration

Copy `../env/notification-service.env.example` to `../env/notification-service.env`.
Database and RabbitMQ passwords are Docker secrets in `secrets/` (copy the
`.example` files). The token verification key is mounted read-only from
`../user-service/secrets/jwt_public_key.secret` as
`/run/secrets/jwt_public_key_notification_service`.

Web Push uses one VAPID keypair for the whole deployment: `VAPID_PUBLIC_KEY`
(env, served to browsers by the endpoint above) and the matching private key in
`secrets/vapid_private_key.secret`, which the sending side will consume. Generate
once with `npx web-push generate-vapid-keys`; never rotate it while browsers hold
subscriptions, or every stored subscription stops decrypting.

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
