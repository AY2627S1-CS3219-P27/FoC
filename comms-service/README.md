# Communication Service

This directory contains the deployable NestJS Communication Service for Friend
on Campus private errand chat. It uses PostgreSQL with TypeORM, RabbitMQ, Redis,
the shared User Service JWT verifier, and the repository observability package.

The current HTTP surface exposes:

- `GET /health/live` for process liveness;
- `GET /health/ready` for PostgreSQL, RabbitMQ, and Redis readiness;
- `GET /v1/chats` for the authenticated participant's active/grace chats;
- `GET /v1/chats/:chatId/messages` for participant-only cursor-paginated
  history;
- `/chat` as the authenticated Socket.IO namespace on `SOCKET_PATH` for
  participant-only `chat:join` admission;
- `/docs` and `/docs-json` for the implemented OpenAPI document; and
- `/metrics` for Prometheus metrics.

In the background, one RabbitMQ consumer reads the Order event stream and
dispatches four lifecycle notices for validation and deduplication. Accepted notices create one private chat
per event identity; delivered and cancellation notices are retained as
immutable facts for later deadline reconciliation. Both chat routes verify the
shared User Service JWT, use opaque keyset cursors, and conceal absent chats
from non-participants. Socket.IO authentication, participant room admission,
expiry disconnects, and transactional message sends are active; read
mutations, Redis fan-out, grace-period transitions, and archives remain
deferred.

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
Service and its PostgreSQL database remain private on the root stack's
`internal` network. The frontend or deployment ingress is the application
access path, including the future same-site Socket.IO route. The root Compose
dependency gates startup on healthy PostgreSQL, RabbitMQ, and Redis.
PostgreSQL remains authoritative; Redis is only shared delivery infrastructure
for a later realtime package.

For loopback-only direct access to health/OpenAPI on port `3006` and PostgreSQL
on port `5437`, opt into the repository debug overlay:

```powershell
docker compose -f compose.yaml -f compose.debug.yaml up -d --wait
```

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

The disposable PostgreSQL service listens on loopback host port `5441`. The
isolated RabbitMQ service listens on loopback ports `5678` (AMQP) and `15678`
(management). The latter imports the same infrastructure-owned identity,
permissions, exchanges, and event-forwarding bindings as the root broker;
starting Communication Service against it provisions the service-owned queue,
`order.#` binding, retry topology, and DLQ.

`JWT_PUBLIC_KEY_FILE`, `DB_PASSWORD_FILE`, and `RABBITMQ_PASSWORD_FILE`
contain container file paths, never secret values. The corresponding secret
files are mounted read-only under `/run/secrets`.

`SOCKET_PATH`, `SOCKET_ALLOWED_ORIGINS`, and the fixed WebSocket-only transport
configure the authenticated `/chat` namespace. The handshake accepts the
HTTP-only `access_token` cookie from an exact allowed origin, disconnects at
the token's validated expiry, and admits a participant to one user-scoped chat
room. `message:send` validates content, locks and reauthorizes the chat,
deduplicates client retries, commits the next sequence, and only then
acknowledges and emits `message:new`. Read mutations are not registered yet.

## RabbitMQ topology

Root `rabbitmq/definitions.json` owns the non-administrator identity,
`foc.pubsub`, and the event-forwarding bindings from `foc.events`.
Communication Service declares durable `comms-service.events` and binds it to
`foc.pubsub` with `order.#`. It handles the four lifecycle routes listed above
and acknowledges other Order events as skipped.

The unified retry queues are `comms-service.events.retry.1` through
`.retry.5`, and the dead-letter queue is `comms-service.events.dlq`. The five TTLs are
`1000`, `2000`, `4000`, `8000`, and `16000` milliseconds. Expired retries
return through `foc.comms.back` using the primary queue name; exhausted
deliveries are published to `foc.comms.dlx` and routed to the unified DLQ.
All queues and exchanges are durable, publications are persistent, and no
maximum-length or silent-overflow policy is configured.

On startup, Communication Service creates `foc.comms.retry`,
`foc.comms.back`, and `foc.comms.dlx`; the primary queue and pub/sub binding;
five durable retry queues using 1, 2, 4, 8, and 16 second delays; the
retry-return binding; and one durable DLQ. Provisioning is idempotent and fails
startup when `foc.pubsub` is missing or inaccessible. The service never
accesses `foc.events`.

The broker user can configure only service exchanges and its unified queue
family. It can read `foc.pubsub` and write its own queue as required to create
the binding, but cannot configure or publish to `foc.pubsub`, cannot configure,
read, or write `foc.events`, and cannot access another service's resources.
RabbitMQ queue-write permission also permits default-exchange
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
2. Import root RabbitMQ definitions so the service identity, permissions,
   `foc.pubsub`, and event-forwarding bindings exist.
3. Create environment and secret files, start PostgreSQL and Redis, and apply
   the Communication Service migration explicitly.
4. Start Communication Service. Its startup provisioner creates or adopts the
   compatible primary queue, `order.#` binding, retry chain, return binding,
   and DLQ, then starts the unified lifecycle consumer.
5. Enable Order Service lifecycle publication only after the Communication
   Service startup provisioner succeeds. Retained notices are consumed
   idempotently after service startup.

To roll back, disable Order Service publication first and stop Communication
Service without deleting its database, queues, or retained messages. Revert a
migration only after confirming the schema contains no required retained
evidence and receiving explicit approval. Broker definitions removal is
non-destructive and is not a reason to delete queues during ordinary rollback.

## Verification

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

## Authenticated chat reads

Both `/v1/chats` routes accept the shared `access_token` cookie or supported
Bearer token. List responses contain only the caller's `ACTIVE` and `GRACE`
chats, including their latest message and caller-relative unread state. History
returns messages in ascending per-chat sequence order and derives `UNREAD` or
`READ` from the persisted read timestamp. Both endpoints accept an opaque
`cursor` and a `limit` from 1 to 50 (default 20). Cursors are endpoint-specific
and modified, malformed, or cross-endpoint values return 400. An unknown,
archived, or unauthorized history target always returns the same sanitized 404.

## Metrics and recovery operations

`/metrics` exposes Package 2 delivery outcomes, handler latency, committed chat
creation, normalized chat API latency, and HTTP status classes. Labels are
limited to stream, outcome, normalized route, status class, and fixed source;
participant, errand, chat, event, cursor, and token values are never labels.

Malformed or contract-invalid notices are confirmed into their stream DLQ.
Transient handler failures enter the five-stage retry chain and are confirmed
into the DLQ after exhaustion. Exact inbox duplicates are acknowledged without
another fact or chat, while event-ID conflicts preserve the established
evidence and are isolated in the DLQ.

The complete inspection, one-message corrected redrive, monitoring, rollout,
and rollback procedure is in
[`docs/runbooks/comms-service-package-2.md`](../docs/runbooks/comms-service-package-2.md).
The redrive tool publishes only through the normal `foc.events` route, validates
the corrected event with `@foc/contracts`, and acknowledges the DLQ copy only
after publisher confirmation. It must use a dedicated operator identity, never
the runtime Communication Service credentials.

## Publish lifecycle fixtures

The committed fixtures exercise Communication Service's upstream RabbitMQ
boundary without inserting database rows or starting Order Service. This is a
local smoke-test facility, not a replacement for testing Order's transactional
outbox through the complete stack.

Copy the local configuration and example secrets, then start fresh disposable
PostgreSQL and RabbitMQ containers:

```powershell
Copy-Item .env.example .env
Copy-Item secrets/comms_db_password.secret.example secrets/comms_db_password.secret
Copy-Item secrets/rabbitmq_password.secret.example secrets/rabbitmq_password.secret
npm run fixtures:test:up
```

`RABBITMQ_FIXTURE_URL` uses the disposable broker's loopback-only test
administrator. It is deliberately separate from the Communication Service
connection: the runtime `comms-service` identity remains unable to publish to
`foc.events`. Never use the example fixture URL in deployment. When manually
targeting another broker, supply an approved test/operator or producer identity
that may publish the four Order routes; never commit the resulting `.env` or
secret files.

Run the automated real-broker/real-database workflow with:

```powershell
npm run test:fixtures
```

It proves buffered delivery before consumer startup, atomic chat creation,
exact duplicate convergence, reacceptance, terminal evidence, invalid-contract
DLQs, and event-ID conflict preservation. The suite resets only a database
whose name ends in `_test`; always recreate the test broker so its queues start
empty.

For manual testing, run Communication Service against a broker and database,
then list or publish the fixed samples:

```powershell
npm run event:fixtures:list
npm run event:publish:errand-accepted
npm run event:publish:errand-reaccepted
npm run event:publish:errand-delivered
```

Inspect the resulting state with read-only SQL:

```sql
SELECT * FROM inbox_events ORDER BY received_at DESC;
SELECT * FROM chat_lifecycle_events ORDER BY occurred_at DESC;
SELECT id, acceptance_event_id, errand_id, requester_user_id,
       courier_user_id, state, next_sequence, created_at
FROM chats ORDER BY created_at DESC;
```

Publishing `errand-accepted` twice is the duplicate test. The conflict and
invalid selectors intentionally enter the unified event DLQ:

```powershell
npm run event:publish:errand-accepted-conflict
npm run event:publish:errand-accepted-unknown-field
npm run event:publish:errand-accepted-wrong-publisher
```

Custom fixture files require an explicit allowlisted route:

```powershell
node scripts/publish-lifecycle-fixture.mjs C:\secure\event.json `
  --routing-key order.errand-accepted.v1
```

The publisher checks but never declares `foc.events`, publishes exact bytes
persistently with mandatory routing and confirms, and rejects unroutable
messages. Never publish fixtures directly to a primary queue, retry exchange,
or retry-return exchange. Tear down the disposable services after testing:

```powershell
npm run fixtures:test:down
```

## Deferred roadmap behavior

The current Package 2 slice consumes lifecycle messages, creates accepted
chats, and exposes participant-only live chat reads. Package 3 has activated
the authenticated Socket.IO namespace, participant room admission, and ordered
idempotent message sending. It does not yet change read state or activate Redis
adapter fan-out. Archive APIs, grace transitions, and the archive worker also
remain deferred. Later roadmap steps add those behaviors in dependency order.

The governing decisions are recorded under
`docs/adr/comms-service/0001`–`0004`: PostgreSQL authority and message
ordering, lifecycle notice ingestion, authenticated WebSocket delivery, and
grace deadlines with immutable archives.
