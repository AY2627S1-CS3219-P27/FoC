# Communication Service

This directory contains the deployable NestJS foundation for Friend on
Campus private errand chat. It uses PostgreSQL with TypeORM, RabbitMQ, Redis,
the shared User Service JWT verifier, and the repository observability package.

The current foundation intentionally exposes only:

- `GET /health/live` for process liveness;
- `GET /health/ready` for PostgreSQL, RabbitMQ, and Redis readiness;
- `/docs` and `/docs-json` for the health-only OpenAPI document; and
- `/metrics` for Prometheus metrics.

Lifecycle consumers, chat APIs, Socket.IO connections, messages, grace-period
handling, and archives are deferred to later roadmap packages.

## Lifecycle contracts and publication

All lifecycle notices use strict v1 contracts from `@foc/contracts` and are
published by Order Service through its transactional outbox. The notice row is
inserted in the same PostgreSQL transaction as the successful lifecycle
transition; a confirm-channel relay later publishes it persistently to
`foc.events`. Delivery is therefore at least once, and future consumers must
deduplicate by envelope `eventId`.

| Order lifecycle transition   | External notice    | Routing key                  | Payload identity                            |
| ---------------------------- | ------------------ | ---------------------------- | ------------------------------------------- |
| `ErrandAccepted`             | `ErrandAccepted`   | `order.errand-accepted.v1`   | Errand, requester, persisted courier        |
| `ErrandDelivered`            | `ErrandDelivered`  | `order.errand-delivered.v1`  | Errand, requester, persisted courier        |
| `CourierWithdrew`            | `CourierCancelled` | `order.courier-cancelled.v1` | Errand, requester, authorized courier actor |
| Terminal errand cancellation | `ErrandCancelled`  | `order.errand-cancelled.v1`  | Errand only                                 |

Courier withdrawal clears the Order projection's `courierId`. The external
notice therefore uses the already-authorized transition `actorUserId`, which
Order Service proved was the current courier before applying the update. The
existing minimal `ErrandCancelled` payload remains unchanged for Credit Service
compatibility; Communication Service later correlates it by `errandId`.

## Local commands

Run commands from this directory:

```powershell
npm install
npm run build
npm run lint
npm test
npm run start:dev
```

## Compose and secrets

Create the local secret files before starting the service:

```powershell
Copy-Item secrets/comms_db_password.secret.example secrets/comms_db_password.secret
Copy-Item secrets/rabbitmq_password.secret.example secrets/rabbitmq_password.secret
Copy-Item .env.example .env
Copy-Item ../env/comms-service.env.example ../env/comms-service.env
```

User Service owns the JWT signing key pair. Communication Service mounts only
`user-service/secrets/jwt_public_key.secret`; generate the User Service keys
using its documented setup before starting the root stack. Shared Redis,
RabbitMQ, observability, and logging settings remain in `env/shared.env`.
Service-specific database, queue-name, socket, and host-port settings live in
`env/comms-service.env`.

Apply the schema explicitly before starting the application. From the
repository root:

```powershell
docker compose -f comms-service/compose.yml up -d --wait comms-db
docker compose -f comms-service/compose.yml run --rm comms-service npm run migration:run
```

Then start the versioned stack with:

```powershell
./scripts/build-images.sh up -d --wait
```

Plain `docker compose up -d --wait` uses the `dev` image tag. Communication
Service is published on host port `3006`; its PostgreSQL database is published
on `5437`. The root Compose dependency gates startup on healthy PostgreSQL,
RabbitMQ, and Redis. PostgreSQL remains authoritative; Redis is only shared
delivery infrastructure for a later realtime package.

TypeORM never synchronizes the schema. Migrations are always explicit:

```powershell
npm run migration:show
npm run migration:run
npm run migration:revert
```

The initial migration owns five tables: `inbox_events`,
`chat_lifecycle_events`, `chats`, `messages`, and `chat_archives`. Lifecycle
facts and archives are immutable at the PostgreSQL boundary. Chats retain the
acceptance identity and archived chat row, while mutable message rows can later
be removed only after an immutable JSONB archive is committed. Per-chat
sequence constraints provide stable message ordering; participant, errand,
due-chat, and archive-list indexes support the later API and worker queries.

Run the PostgreSQL migration suite only against the disposable database
documented in `.env.example`:

```powershell
npm run test:integration
```

The suite refuses to reset a database whose name does not end in `_test`.

The isolated test services are opt-in and do not use persistent volumes:

```powershell
npm run db:test:up
npm run test:integration
npm run db:test:down

npm run rabbitmq:test:up
npm run test:rabbitmq-permissions
npm run rabbitmq:test:down
```

The disposable PostgreSQL service listens on host port `5440`. The isolated
RabbitMQ service listens on `5678` (AMQP) and `15678` (management). The latter
imports the same infrastructure-owned identity, primary queues, permissions,
and domain bindings as the root broker; starting Communication Service against
it provisions only the service-owned retry topology.

`JWT_PUBLIC_KEY_FILE`, `DB_PASSWORD_FILE`, and `RABBITMQ_PASSWORD_FILE`
contain container file paths, never secret values. The corresponding secret
files are mounted read-only under `/run/secrets`.

`SOCKET_PATH`, `SOCKET_ALLOWED_ORIGINS`, and the fixed WebSocket-only transport
are validated now so deployment configuration remains stable. No socket server
is registered in this package.

## RabbitMQ topology

Root `rabbitmq/definitions.json` owns only the non-administrator identity,
four durable primary lifecycle queues, and their four `foc.events` bindings.
Those queues exist before Order Service publishes, so notices remain retained
while Communication Service is offline.

| Primary queue                              | Domain routing key           | Retry queues            | Dead-letter queue |
| ------------------------------------------ | ---------------------------- | ----------------------- | ----------------- |
| `comms-service.order-errand-accepted.v1`   | `order.errand-accepted.v1`   | `.retry.1` … `.retry.5` | `.dlq`            |
| `comms-service.order-errand-delivered.v1`  | `order.errand-delivered.v1`  | `.retry.1` … `.retry.5` | `.dlq`            |
| `comms-service.order-courier-cancelled.v1` | `order.courier-cancelled.v1` | `.retry.1` … `.retry.5` | `.dlq`            |
| `comms-service.order-errand-cancelled.v1`  | `order.errand-cancelled.v1`  | `.retry.1` … `.retry.5` | `.dlq`            |

Retry suffixes are appended to the full primary queue name. The five TTLs are
`1000`, `2000`, `4000`, `8000`, and `16000` milliseconds. Expired retries
return through `foc.comms.back` using the primary queue name; exhausted
deliveries are published to `foc.comms.dlx` and routed to the stream's `.dlq`.
All queues and exchanges are durable, publications are persistent, and no
maximum-length or silent-overflow policy is configured.

On startup, Communication Service creates `foc.comms.retry`,
`foc.comms.back`, and `foc.comms.dlx`; five durable retry queues per stream
using 1, 2, 4, 8, and 16 second delays; the retry-return bindings; and one
durable DLQ per stream. Provisioning is idempotent and fails startup when an
infrastructure-owned primary queue is missing. The service never declares a
primary queue or accesses `foc.events`.

The broker user can configure only service exchanges and retry/DLQ queues. It
can read the four queue families and write them as required to create bindings,
but cannot configure, read, or write `foc.events` or another service's
resources. RabbitMQ queue-write permission also permits default-exchange
publication to those queue names; Communication Service code must publish only
through `foc.comms.retry`, `foc.comms.back`, and `foc.comms.dlx`.

The committed RabbitMQ password hash matches
`secrets/rabbitmq_password.secret.example`. Replace the example password for a
real deployment and regenerate the definitions hash with
`rabbitmqctl hash_password` at the same time. Never commit the resulting live
secret.

With the isolated broker running and `.env` configured, verify the effective
allow/deny boundary with:

```powershell
npm run test:rabbitmq-permissions
```

## Deployment and rollback

Deploy the foundation in this order:

1. Build and verify `@foc/contracts` with all current consumers.
2. Import root RabbitMQ definitions so the service identity, four primary
   queues, permissions, and four domain bindings exist.
3. Create environment and secret files, start PostgreSQL and Redis, and apply
   the Communication Service migration explicitly.
4. Start Communication Service. Its startup provisioner creates or adopts the
   compatible retry exchanges, retry chains, return bindings, and DLQs.
5. Enable Order Service lifecycle publication only after the primary queues
   exist. Until Package 2, published notices accumulate durably.

To roll back, disable Order Service publication first and stop Communication
Service without deleting its database, queues, or retained messages. Revert a
migration only after confirming the schema contains no required retained
evidence and receiving explicit approval. Broker definitions removal is
non-destructive and is not a reason to delete queues during ordinary rollback.

## Foundation verification

Run the non-container quality gates from this directory:

```powershell
npm run build
npm run lint
npm test
npm run format:check
```

Run contract and Order Service suites from their respective directories. With
Docker available, additionally run the disposable migration suite, isolated
RabbitMQ permission verifier, development and production image builds, and the
root stack health check. From the repository root,
`./scripts/build-images.sh --print-tags` must include
`COMMS_SERVICE_IMAGE_TAG`; `docker compose up -d --wait` must report the
service, PostgreSQL, RabbitMQ, Redis, and observability dependencies healthy.

## Deferred roadmap behavior

Package 1 does not consume or acknowledge lifecycle messages, create chats,
expose chat or archive APIs, open a Socket.IO namespace, send or read messages,
apply grace periods, or run an archive worker. Packages 2–5 add those behaviors
in dependency order. The reserved socket configuration is not evidence of an
available realtime endpoint.

The governing decisions are recorded under
`docs/adr/comms-service/0001`–`0004`: PostgreSQL authority and message
ordering, lifecycle notice ingestion, authenticated WebSocket delivery, and
grace deadlines with immutable archives.
