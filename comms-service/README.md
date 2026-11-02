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
