# Credit Service

Credit Service owns credit accounts and their persistent balance history. It
currently consumes `UserRegistered`, creates the user's account and immutable
initial allocation, and eventually publishes `CreditAccountInitialised`.

The service is built with NestJS and TypeScript, PostgreSQL with TypeORM, and
RabbitMQ. Event payloads are validated with versioned JSON Schemas and AJV.

## How account initialization works

1. RabbitMQ delivers `UserRegistered` from the shared `foc.events` topic
   exchange to the Credit Service subscription.
2. The transport validates the JSON transport metadata, and the handler
   validates the event envelope and payload contract.
3. A PostgreSQL `SERIALIZABLE` transaction deduplicates the event, creates or
   locates the account and allocation, records the inbox outcome, and stores a
   pending `CreditAccountInitialised` envelope in the outbox when the account is
   new.
4. The incoming delivery is acknowledged only after the database transaction
   commits.
5. The outbox relay publishes the stored envelope and marks it published only
   after RabbitMQ confirms it.

This produces at-least-once delivery. A message may be published again after an
uncertain failure, so event consumers must be idempotent. See the
[Credit Service ADRs](../docs/adr/credit-service/README.md) for the persistence,
containerization, and messaging decisions and the complete topology diagram.

## Prerequisites

- Node.js 22
- npm 11.18.0
- Docker with Docker Compose

Run npm and Compose commands in the `credit-service` directory unless a command
says otherwise.

## Local setup

Create the service-local environment and database secret files:

```powershell
Copy-Item .env.example .env
Copy-Item secrets/credit_db_password.secret.example secrets/credit_db_password.secret
```

Replace the example database password and `RABBITMQ_PASSWORD` in `.env`. The
secret file and `.env` are ignored by Git. Every variable read by the service is
documented in [.env.example](./.env.example).

Install the locked dependencies:

```powershell
npm ci
```

## Run with Docker Compose

Start the dependencies, build Credit Service, apply its migrations, and then
start the application:

```powershell
docker compose up -d --wait credit-db credit-rabbitmq
docker compose build credit-service
docker compose run --rm credit-service npm run migration:run
docker compose up -d credit-service
```

Applying migrations before starting the application prevents consumers and the
outbox relay from accessing an empty schema. TypeORM schema synchronization is
intentionally disabled.

The temporary HTTP root endpoint is available at
`http://localhost:3003/` by default. Follow the service logs or stop the stack
with:

```powershell
docker compose logs -f credit-service
docker compose down
```

Credit Service Docker builds use the repository root as their build context so
canonical event schemas are available during compilation. The service-local
Compose file configures this automatically.

## Testing

The test commands deliberately separate fast source-level checks from tests
that exercise real infrastructure.

| Test type | Command | Infrastructure | What it verifies |
| --- | --- | --- | --- |
| Unit | `npm test` | None | Services, validators, configuration, transaction retry logic, lifecycle wiring, and RabbitMQ/outbox behavior through fakes |
| Unit coverage | `npm run test:cov` | None | The same `src/**/*.spec.ts` unit suite with V8 coverage |
| PostgreSQL integration | `npm run test:integration` | Isolated PostgreSQL on port `5436` | Migrations, constraints, immutable allocations, repositories, account initialization, inbox/outbox atomicity, concurrency, and relay claims |
| HTTP end-to-end | `npm run test:e2e` | Isolated PostgreSQL on port `5436`; no RabbitMQ | The real NestJS `AppModule` and HTTP endpoint; broker components are replaced with no-op test providers |
| RabbitMQ messaging integration | `npm run test:messaging` | RabbitMQ on port `5675` | Real queue topology, multiple stream isolation, retries, DLQs, manual acknowledgements, confirmed publication, and shutdown |
| Messaging recovery | `npm run test:recovery` | Disposable PostgreSQL and RabbitMQ on ports `5437`, `5676`, and `15676` by default | The complete broker-to-database-to-outbox pipeline, idempotency, acknowledgement ordering, application restart, and live infrastructure recovery |

All test commands synchronize the source-time contract cache before Vitest
runs. Integration suites that share infrastructure run sequentially.

### Unit tests

Unit tests include only `src/**/*.spec.ts` and do not require Docker:

```powershell
npm test
```

For local iteration and diagnostics:

```powershell
npm run test:watch
npm run test:cov
npm run test:debug
```

These tests use mocks and in-memory fakes. They verify application behavior but
do not prove PostgreSQL constraints or RabbitMQ delivery semantics.

### PostgreSQL integration tests

The database integration suite uses the `credit-db-test` Compose service. Its
data directory is a `tmpfs`, so it neither shares nor persists development data:

```powershell
npm run db:test:up
npm run test:integration
npm run db:test:down
```

The suite starts from an empty database, applies the committed migration,
tests the real PostgreSQL schema and concurrent use cases, and verifies that the
migration reverts cleanly. Keep `credit-db-test` running if the HTTP end-to-end
suite will run next.

### HTTP end-to-end tests

The HTTP suite boots the real `AppModule` and tests the temporary root endpoint:

```powershell
npm run db:test:up
npm run test:e2e
npm run db:test:down
```

It intentionally overrides the RabbitMQ consumer transport and outbox relay.
This keeps the HTTP smoke test deterministic and broker-independent; use the
messaging and recovery suites for broker behavior and the complete event flow.

### RabbitMQ messaging integration tests

Start the service-local broker, then run the real-AMQP transport and publisher
tests:

```powershell
docker compose up -d --wait credit-rabbitmq
npm run test:messaging
```

Each run creates uniquely named exchanges and queues and removes them afterward.
The tests cover two subscriptions to prove handler, retry-chain, and DLQ
isolation. They do not use PostgreSQL or start the complete NestJS application.

### Messaging recovery tests

The recovery command orchestrates its own isolated infrastructure:

```powershell
npm run test:recovery
```

It builds and starts recovery-only PostgreSQL and RabbitMQ containers, migrates
an empty database, starts the real application modules, and exercises the full
consumer, validation, transaction, inbox, allocation, outbox, relay, and
confirmed-publication path. It also restarts the application and both
infrastructure containers to verify reconnection and pending-outbox recovery.

The command always attempts to remove the recovery containers and their
anonymous volumes on success, failure, or interruption. It requires Docker,
the service-local database secret, and `RABBITMQ_PASSWORD` in `.env`, but does
not use the development database or RabbitMQ volumes.

### Build and static checks

```powershell
npm run build
npm run lint
npm run format
```

`npm run format` rewrites matching TypeScript files with Prettier. Build, lint,
and unit tests do not replace the PostgreSQL, RabbitMQ, or recovery suites.

## RabbitMQ subscriptions and retries

Credit Service uses one recovering consumer connection while giving every
incoming event stream its own durable queue, handler, and consumer channel. A
stream queue named `<queue>` owns:

- retry queues `<queue>.retry.1` through `<queue>.retry.5`;
- a dead-letter queue `<queue>.dlq`, unless explicitly overridden;
- an independent `RABBITMQ_PREFETCH` allowance.

The domain exchange, direct retry exchange, direct dead-letter exchange, and
confirm-publisher channel are shared. Retry queues use increasing TTLs and
return expired messages to the originating stream. Malformed messages,
permanent contract failures, and exhausted retries go only to that stream's
DLQ. Retry and dead-letter publications are confirmed before the original
delivery is acknowledged.

Because prefetch applies per subscription, the effective process-wide delivery
allowance is the subscription count multiplied by `RABBITMQ_PREFETCH`. The
former global `RABBITMQ_DEAD_LETTER_QUEUE` variable is no longer read. Before
deploying this topology, drain or migrate any custom legacy DLQ whose name does
not match `<queue>.dlq`.

## Persistence guarantees

- `credit_balance` is the credit available to spend.
- `reserved_balance` is credit held for future transactions; reservation
  behavior is not implemented yet.
- PostgreSQL `BIGINT` stores balances and allocation amounts. Values outside
  JavaScript's safe-integer range are rejected at the application boundary.
- Database checks enforce non-negative balances and positive allocations.
- Initial allocations are separate from future credit transactions and are
  immutable at the database level.
- Account allocation is idempotent and never reapplies the configured amount
  to an existing account.
- Allocation use cases require a caller-owned transaction so account, inbox,
  and outbox writes share one atomic boundary.
- Inbox rows deduplicate event IDs using the event type and a canonical payload
  hash. Conflicting reuse of an event ID is dead-lettered.
- Different registration event IDs for one user link to the original
  allocation without creating another account, allocation, or initialization
  event.
- The shared `SERIALIZABLE` transaction runner retries PostgreSQL serialization
  failures and deadlocks up to three times.
- Relay workers claim disjoint outbox batches with expiring PostgreSQL leases.
  Failed publications are released and retried indefinitely.
- Outbox rows are marked published only after RabbitMQ confirmation. Stale rows
  are logged by event ID and operational diagnostics without logging their
  envelope.

## Event contracts

Versioned JSON Schemas under the repository-root `contracts/schemas` directory
define the common envelope, `UserRegistered`, and
`CreditAccountInitialised`. This directory is the canonical source of truth.
Credit Service copies only the contracts it consumes or publishes.

The npm lifecycle hooks synchronize schemas into the ignored
`src/contracts/schemas` cache before source-mode commands and into
`dist/contracts/schemas` after a build:

```powershell
npm run contracts:sync:source
npm run contracts:sync:dist
```

Production loads only the bundled `dist` copies and never depends on the
repository root at runtime. Restart a host-based `npm run start:dev` process
after changing a canonical schema. Docker Compose watches the canonical schema
directory and restarts the development container automatically.

Contracts reject unknown envelope and payload properties. IDs must be UUIDs,
timestamps must be RFC 3339 date-times ending in uppercase `Z`, and validation
errors expose sanitized violations without payload values.

## Publish a registration fixture

With PostgreSQL migrated and Credit Service and RabbitMQ running, publish the
committed valid `UserRegistered` fixture and wait for broker confirmation:

```powershell
npm run event:publish:user-registered
```

The script publishes the exact bytes from
`test/fixtures/user-registered.v1.json` using `RABBITMQ_URL`,
`RABBITMQ_EXCHANGE`, and `RABBITMQ_USER_REGISTERED_ROUTING_KEY`. Publishing the
same fixture again demonstrates event-ID idempotency.

To initialize another account, copy the fixture and replace both `eventId` and
`payload.userId`, then provide its path:

```powershell
node scripts/publish-event-fixture.mjs test/fixtures/my-registration.json
```

## Migrations

TypeORM uses [data-source.ts](./src/database/data-source.ts) for CLI commands.
The CLI reads `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_DATABASE`, and
`DB_PASSWORD_FILE` from the environment or service-local `.env` file.

```powershell
npm run migration:show
npm run migration:run
npm run migration:revert
npm run migration:generate -- src/database/migrations/DescribeChange
npm run migration:create -- src/database/migrations/DescribeChange
```

For host-side CLI commands, use `DB_HOST=127.0.0.1`, the published port (`5435`
for development or `5436` for database tests), and
`DB_PASSWORD_FILE=./secrets/credit_db_password.secret`. Inside Compose, use
`DB_HOST=credit-db`, `DB_PORT=5432`, and the container secret path.

Production images provide `migration:run:prod`, `migration:show:prod`, and
`migration:revert:prod`, which use the compiled data source in `dist`.
