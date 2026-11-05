# Notification Service

Owns the push destinations a user has registered and delivers platform events
to them. The service exposes **subscription management** (authenticated users
register and unregister Web Push endpoints) and an **event consumer** that
records every validated fact event in a transactional inbox and pushes it to
the recipients' active subscriptions.

Built with NestJS and TypeScript, PostgreSQL with TypeORM migrations, RabbitMQ,
Joi environment validation, and Vitest.

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

The schema is migration-owned (see [Persistence](#persistence)); the unique
active-endpoint index ships in its own migration. A development database that
already holds duplicate active rows for one endpoint must have them removed
before that migration can create the index.

## Notification delivery

The consumer binds one durable queue, `notification-service.inbox`, to the
shared `foc.pubsub` topic exchange with routing key `#` (topology is owned by
`rabbitmq/definitions.json`). Retry, return, and dead-letter topology on
`foc.retry`, `foc.back`, and `foc.dlq` is provisioned idempotently at startup;
the service fails fast if the primary queue or exchange is missing.

Each message is validated against `@foc/contracts` before persistence:

- a new `eventId` inserts an `inbox_events` row;
- a redelivery with the same payload hash is acknowledged without a second
  record;
- an event id reused with different evidence, an invalid envelope/payload, or
  malformed JSON is dead-lettered;
- an unregistered routing key is skipped and acknowledged, because the `#`
  binding is intentionally broader than this service's contracts.

The inbox only records facts. Dispatch is a separate module: each pushable
contract has one typed handler in `src/dispatch/dispatchers/`, wired through
`DomainEventDispatcher` in `src/dispatch/dispatch-handlers.ts`. Because the
handler key is the contract's routing-key constant, its payload type comes from
`EventOf<TKey>` — renaming a contract field breaks compilation instead of
silently pushing to nobody. A handler decides the recipients and message, then
`DispatchService.enqueue` writes one `notification_deliveries` row per active
subscription (idempotent on `(event_id, subscription_id)`); the consumer then
calls `deliverPending` to send whatever is still pending.

Contracts without a dispatcher (for example credit events) are recorded and
acknowledged without a push. `ErrandCancelled` is in that group today: its
payload carries only `errandId`, so there is no recipient to address.

Sends use the VAPID private key and mark each delivery `sent`; a push service
answering `404`/`410` soft-deletes the subscription and abandons that delivery.
Transient failures leave the delivery pending and let the transport retry the
event with backoff.

### Persistence

Three tables, created by the initial TypeORM migration (synchronize is
disabled; migrations run on startup unless `DB_MIGRATIONS_RUN=false`):

- `subscriptions` — one row per `(user_id, endpoint)`, soft-deleted.
- `inbox_events` — deduplication identity (`event_id`) plus payload hash.
- `notification_deliveries` — one row per `(event_id, subscription_id)` with
  the dispatcher-built `message` (jsonb), `pending | sent | abandoned`,
  attempt count, and last error.

Because development stacks created before this slice used `synchronize`, the
initial migration creates its tables idempotently; existing rows are kept.

## Configuration

Copy `../env/notification-service.env.example` to `../env/notification-service.env`.
Database and RabbitMQ passwords are Docker secrets in `secrets/` (copy the
`.example` files). The token verification key is mounted read-only from
`../user-service/secrets/jwt_public_key.secret` as
`/run/secrets/jwt_public_key_notification_service`.

Web Push uses one VAPID keypair for the whole deployment: `VAPID_PUBLIC_KEY`
(env, served to browsers by the endpoint above) and the matching private key in
`secrets/vapid_private_key.secret`, used by the sender. `VAPID_SUBJECT` is the
contact identity sent to push services. Generate the pair once with
`npx web-push generate-vapid-keys`; never rotate it while browsers hold
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
npm run migration:show   # list applied / pending migrations
npm run migration:run    # apply pending migrations explicitly
```

Swagger UI is at `/docs` and the generated document at `/docs-json` (internal
port, or via the opt-in `compose.debug.yaml`).
