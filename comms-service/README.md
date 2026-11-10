# Communication Service

This directory contains the deployable NestJS Communication Service for Friend
on Campus private errand chat. It uses PostgreSQL with TypeORM, RabbitMQ, Redis,
the shared User Service JWT verifier, and the repository observability package.

The current HTTP surface exposes:

- `GET /health/live` for process liveness;
- `GET /health/ready` for PostgreSQL, RabbitMQ, the command Redis client, and
  both Socket.IO adapter Redis connections;
- `GET /v1/chats` for the authenticated participant's active/grace chats;
- `GET /v1/chats/:chatId` for one participant-owned active/grace chat (404
  `CHAT_NOT_FOUND` for absent, archived, or unauthorized IDs);
- `GET /v1/chats/:chatId/messages` for participant-only cursor-paginated
  history, with an optional `direction=forward|backward` query;
- `GET /v1/chats/archives` for the authenticated participant's immutable
  archives, newest first;
- `GET /v1/chats/archives/:archiveId` for one participant-owned archive
  snapshot;
- `/chat` as the authenticated Socket.IO namespace on `SOCKET_PATH` for
  participant-only `chat:join` admission;
- `/docs` and `/docs-json` for the implemented OpenAPI document; and
- `/metrics` for Prometheus metrics.

In the background, one RabbitMQ consumer reads the Order event stream and
dispatches four lifecycle notices for validation and deduplication. Accepted
notices create one private chat per event identity. Delivered and cancellation
notices apply monotonic grace deadlines transactionally, including terminal
facts received before acceptance. All chat routes verify the shared User
Service JWT, use opaque keyset cursors where paginated, and conceal absent
resources from non-participants. Socket.IO authentication, participant room
admission, expiry disconnects, transactional message sends, explicit read
receipts, cross-replica Redis fan-out, immutable archiving, and archive reads
are active.

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

Run commands from this directory. Build, lint, test, and run the dev server:

```powershell
npm install
npm run build
npm run lint
npm test
npm run test:watch
npm run test:cov
npm run format:check
npm run start:dev
```

Migrations (see "Compose and secrets" below for when to run them):

```powershell
npm run migration:show
npm run migration:run
npm run migration:revert
npm run migration:generate
npm run migration:create
```

The three `*:prod` variants (`migration:run:prod`, `migration:show:prod`,
`migration:revert:prod`) target the production-built `dist/` artifact and
connection; they are not a different migration behavior, only a different
build/runtime target.

Operational and fixture tooling, documented in full further down this file
and in the linked runbooks:

- `npm run dlq:operator` — DLQ inspect/redrive; see
  [`docs/runbooks/comms-service-lifecycle-operations.md`](../docs/runbooks/comms-service-lifecycle-operations.md).
- `npm run realtime:fixture` — realtime smoke fixture; see "Realtime smoke
  fixture" below.
- `npm run event:fixtures:list` and `npm run event:publish:*` — lifecycle
  fixture publishing; see "Publish lifecycle fixtures" below.

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
Service-specific database, queue-name, socket, archive-worker, and host-port
settings live in `env/comms-service.env`. Archive polling defaults to five
seconds with batches of 25 and 60-second claim leases. The claim TTL must be
greater than the poll interval. Shutdown stops new archive work and drains the
current operation for at most `ARCHIVE_SHUTDOWN_DRAIN_TIMEOUT_MS`, which
defaults to 10 seconds and must remain shorter than the claim TTL. Claims left
behind after that deadline are recovered through normal lease expiry.

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
access path, including the same-site Socket.IO route. The root Compose
dependency gates startup on healthy PostgreSQL, RabbitMQ, and Redis.
PostgreSQL remains authoritative; Redis provides transient realtime fan-out
only and stores no message, read-state, sequence, room-authority, or replay
truth.

The frontend exposes Communication Service through same-origin rewrites:

| Browser path            | Private destination                         |
| ----------------------- | ------------------------------------------- |
| `/api/chats/:path*`     | `${COMMS_SERVICE_URL}/v1/chats/:path*`      |
| `${SOCKET_PATH}/:path*` | `${COMMS_SERVICE_URL}${SOCKET_PATH}/:path*` |

The socket rewrite covers the base path and every Socket.IO subpath. Next.js
external rewrites retain the query string, cookies, and `Origin` header and
proxy the `Upgrade` and `Connection` handshake. Production ingress must provide
the same behavior if it terminates traffic before the frontend. The browser
must never connect directly to Communication Service, which remains only on the
private `internal` network. `SOCKET_ALLOWED_ORIGINS` must list the exact public
frontend origins, including `http://localhost:3001` for the root development
stack.

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
acceptance identity and archived chat row. The archive worker removes mutable
message rows only after an immutable JSONB archive is inserted in the same
transaction. Per-chat
sequence constraints provide stable message ordering; participant, errand,
due-chat, and archive-list indexes support the active API and worker queries.
The realtime forward migration adds the partial
`IDX_messages_chat_sender_unread_sequence` index for received-message read
updates and caller-relative unread lookup without modifying existing read
timestamps.

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

npm run socket:test:up
npm run test:socket-integration
npm run socket:test:down
```

The disposable PostgreSQL service listens on loopback host port `5441`. The
isolated RabbitMQ service listens on loopback ports `5678` (AMQP) and `15678`
(management). The latter imports the same infrastructure-owned identity,
primary queues, permissions, and domain bindings as the root broker; starting
Communication Service against it provisions only the service-owned retry
topology.
The isolated Redis adapter service listens on loopback port `6381` and stores
no durable data.

`JWT_PUBLIC_KEY_FILE`, `DB_PASSWORD_FILE`, and `RABBITMQ_PASSWORD_FILE`
contain container file paths, never secret values. The corresponding secret
files are mounted read-only under `/run/secrets`.

## Environment variables

`env/comms-service.env.example` names Compose-level variables; `comms-service/compose.yml`
maps several of them onto the differently-named runtime variables validated
by `src/config/environment.ts`, the single source of truth for defaults and
bounds:

| Compose variable (`env/comms-service.env.example`) | Runtime variable  |
| ---------------------------------------------------- | ------------------ |
| `COMMS_SERVICE_PORT`                                 | `PORT`              |
| `COMMS_SERVICE_DB_HOST`                               | `DB_HOST`            |
| `COMMS_SERVICE_DB_PORT`                               | `DB_PORT`            |
| `COMMS_SERVICE_DB_USERNAME`                           | `DB_USERNAME`        |
| `COMMS_SERVICE_DB_DATABASE`                           | `DB_DATABASE`        |
| `COMMS_SERVICE_RABBITMQ_USER`                         | `RABBITMQ_USER`      |
| `COMMS_JWT_PUBLIC_KEY_PATH`                            | mounted file backing `JWT_PUBLIC_KEY_FILE` |

`COMMS_SERVICE_HOST_PORT` and `COMMS_SERVICE_DB_HOST_PORT` are consumed only
by the opt-in `compose.debug.yaml` overlay; the application never reads them.

The remaining runtime variables keep the same name on both sides:

| Variable                              | Default                        | Notes                                             |
| -------------------------------------- | ------------------------------- | -------------------------------------------------- |
| `RABBITMQ_PUBSUB_EXCHANGE`             | `foc.pubsub`                    | Fixed; must match the root broker identity.        |
| `RABBITMQ_EVENTS_QUEUE`                | `comms-service.events`          | Fixed; the service's primary queue name.           |
| `RABBITMQ_RETRY_EXCHANGE`              | `foc.comms.retry`                | Fixed.                                              |
| `RABBITMQ_RETRY_RETURN_EXCHANGE`       | `foc.comms.back`                 | Fixed.                                              |
| `RABBITMQ_DEAD_LETTER_EXCHANGE`        | `foc.comms.dlx`                  | Fixed.                                              |
| `RABBITMQ_RETRY_DELAYS_MS`             | `1000,2000,4000,8000,16000`      | Fixed; five canonical retry delays.                 |
| `SOCKET_PATH`                          | `/socket.io`                     | Shared with the frontend's `SOCKET_PATH`.           |
| `SOCKET_ALLOWED_ORIGINS`               | `http://localhost:3001`          | Comma-separated absolute origins; must be `https:` origins only when `NODE_ENV=production`. |
| `SOCKET_TRANSPORT`                     | `websocket`                      | Fixed; polling is not supported.                    |
| `ARCHIVE_POLL_INTERVAL_MS`             | `5000`                           | 250–60000ms.                                        |
| `ARCHIVE_BATCH_SIZE`                   | `25`                             | 1–100.                                              |
| `ARCHIVE_CLAIM_TTL_MS`                 | `60000`                          | 5000–600000ms; must exceed `ARCHIVE_POLL_INTERVAL_MS`. |
| `ARCHIVE_SHUTDOWN_DRAIN_TIMEOUT_MS`    | `10000`                          | 1000–60000ms; must be shorter than `ARCHIVE_CLAIM_TTL_MS`. |

`NODE_ENV`, `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, and `REDIS_HOST`/`REDIS_PORT`/
`REDIS_USERNAME`/`REDIS_DB_INDEX` come from shared `env/shared.env` and are
not service-specific. `DB_PASSWORD_FILE`, `RABBITMQ_PASSWORD_FILE`, and
`JWT_PUBLIC_KEY_FILE` are fixed Compose secret-mount paths, not driven by an
environment file.

The host-side `comms-service/.env.example` additionally defines
`RABBITMQ_FIXTURE_URL` and the `RABBITMQ_OPERATOR_*` variables used only by
local CLI tooling (lifecycle fixtures, the DLQ operator) run outside the
container — see "Publish lifecycle fixtures" and
[`docs/runbooks/comms-service-lifecycle-operations.md`](../docs/runbooks/comms-service-lifecycle-operations.md)
for their dedicated-identity rationale.

## Realtime protocol

`SOCKET_PATH` is the HTTP/WebSocket transport path and defaults to
`/socket.io`; `/chat` is the Socket.IO namespace selected after connection.
They are separate concepts and neither replaces the other. Both server and
client must use WebSocket transport only. Polling and upgrade fallback are
disabled.

The handshake accepts the HTTP-only `access_token` cookie only from an exact
allowed origin. Tokens in query parameters, Socket.IO auth payloads, or events
are rejected. The gateway stores only the verified user ID, disconnects the
socket at the validated token expiry, and requires a new handshake after token
refresh. A socket may join one authorized chat; opening another chat requires a
separate connection or reconnect.

Every client event requires an acknowledgement callback with one response
shape: `{ ok: true, data }` or
`{ ok: false, error: { code, message } }`. Payloads reject unknown properties.
Errors expose only the sanitized codes `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `INVALID_REQUEST`, `INVALID_MESSAGE`, `CHAT_ARCHIVED`, `CONFLICT`,
and `INTERNAL_ERROR`. Unknown and unauthorized chat IDs remain
indistinguishable.

| Client event    | Payload                                | Committed behavior                                                                                                                                                   |
| --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat:join`     | `{ chatId }`                           | Authorizes membership, joins the caller's user-scoped room, and returns `latestSequence`.                                                                            |
| `message:send`  | `{ chatId, clientMessageId, content }` | Accepts non-blank content up to 4,000 Unicode code points, deduplicates sender retries, allocates the next sequence transactionally, then acknowledges.              |
| `messages:read` | `{ chatId, throughSequence }`          | Marks only unread messages from the other participant through the committed sequence using one database timestamp. Repeated and multi-tab reads are no-op successes. |

| Server event            | Delivery                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `message:new`           | Emitted after commit to the recipient's room and other sender tabs; idempotent retries emit nothing. |
| `messages:read-receipt` | Emitted after a changed read transaction commits, only to the affected sender's room.                |
| `chat:closing`          | Emitted to both participant rooms after a new or shorter grace deadline commits.                     |
| `chat:archived`         | Emitted to both participant rooms after the immutable archive transaction commits.                   |

Redis carries best-effort room fan-out between replicas through dedicated
publisher and subscriber connections. Both connections participate in startup,
shutdown, and `/health/ready`, but Redis stores no authoritative chat state. If
delivery is missed, reconnect, call `chat:join`, compare `latestSequence`, and
recover gaps through `GET /v1/chats/:chatId/messages`. A missed lifecycle
notification is recoverable through the live-chat and archive HTTP APIs.
Fetching history never marks messages read.

### Realtime smoke fixture

The local realtime fixture exercises the browser-facing frontend rewrite, the
authenticated `/chat` namespace, committed sends, idempotent retries, explicit
reads, receipts, and HTTP-history reconciliation. The root stack must already
be healthy, and the supplied chat must be live with the two cookies belonging
to its requester and courier. Create the chat separately through the normal
Order flow or lifecycle fixture.

Store each HTTP-only access-token cookie in its own ignored file. The file must
contain exactly `access_token=<JWT>` with no newline or cookie attributes:

```powershell
New-Item -ItemType Directory -Force .tmp
Set-Content -NoNewline -Path .tmp/sender.cookie `
  -Value 'access_token=<sender JWT>'
Set-Content -NoNewline -Path .tmp/recipient.cookie `
  -Value 'access_token=<recipient JWT>'

npm run realtime:fixture -- `
  --chat-id 00000000-0000-4000-8000-000000000000 `
  --sender-cookie-file .tmp/sender.cookie `
  --recipient-cookie-file .tmp/recipient.cookie
```

The command defaults to `http://localhost:3001`, `/socket.io`, and a five-second
operation timeout. Override them with `--url`, `--origin`, `--socket-path`, or
`--timeout-ms` when testing another local ingress. An optional
`--outsider-cookie-file` also proves that an authenticated non-participant and
an unknown chat receive the same `NOT_FOUND` acknowledgement. The fixture
checks missing-cookie, disallowed-origin, and polling rejection on every run.
It never prints credentials or message content and exits nonzero on a protocol,
delivery, persistence, or cleanup failure. Delete the temporary cookie files
after testing.

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
   and DLQ, then starts the unified lifecycle consumer and leased archive
   worker on every replica.
5. Enable Order Service lifecycle publication only after the Communication
   Service startup provisioner succeeds. Retained notices are consumed
   idempotently after service startup.

To roll back, disable Order Service publication first, stop new archive claim
cycles, drain in-flight archive transactions, and stop Communication Service
without deleting its database, queues, retained messages, deadlines, or
archives. Do not reopen archived chats or restore deleted live messages. Revert
a migration only after confirming the schema contains no required retained
evidence and receiving explicit approval. Broker definitions removal is
non-destructive and is not a reason to delete queues during ordinary rollback.
The deployment stop-grace period must exceed the configured archive drain
timeout so the shutdown hook can finish before forced termination. The bundled
Compose service uses 75 seconds, exceeding the maximum accepted 60-second
archive drain deadline.

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

## Authenticated chat and archive reads

All `/v1/chats` routes accept the shared `access_token` cookie or supported
Bearer token. Live list responses contain only the caller's `ACTIVE` and `GRACE`
chats, including their latest message and caller-relative unread state. History
returns messages in ascending per-chat sequence order and derives `UNREAD` or
`READ` from the persisted read timestamp. The optional
`direction=forward|backward` query defaults to the existing forward behavior.
Backward paging without a cursor returns the latest bounded window; its opaque
continuation cursor retrieves older windows, which are also returned in
ascending sequence order. Message cursors are direction-scoped, while legacy
message cursors remain valid only for forward paging. Archive lists contain
only rows where the caller is the persisted requester or courier and are
ordered by `archivedAt DESC, archiveId DESC`. Archive detail returns schema
version 1 and ordered `{ role, content, timestamp }` messages. Paginated
endpoints accept an opaque `cursor` and a `limit` from 1 to 50 (default 20).
Cursors are endpoint-specific; modified, malformed, cross-endpoint, or
cross-direction values return 400. Unknown and unauthorized live-history
targets share one sanitized 404; unknown and unauthorized archive IDs share
another. Archives expose GET only and remain immutable at the database
boundary.

## Metrics and recovery operations

`/metrics` exposes delivery outcomes, handler latency, committed chat creation,
actual deadline changes, normalized HTTP latency, handshake results, active
sockets, join/send/read outcomes and latency, archive claim results and
latency, in-flight claims, archive results and latency, lifecycle notification
outcomes, archive-worker shutdown outcomes, and adapter errors. Labels are
limited to bounded operation, outcome, reason, role, stream, normalized route,
status class, and fixed source;
participant, errand, chat, message, archive, event, claim, cursor, and token
values are never labels.

Malformed or contract-invalid notices are confirmed into their stream DLQ.
Transient handler failures enter the five-stage retry chain and are confirmed
into the DLQ after exhaustion. Exact inbox duplicates are acknowledged without
another fact or chat, while event-ID conflicts preserve the established
evidence and are isolated in the DLQ.

The complete inspection, one-message corrected redrive, monitoring, rollout,
and rollback procedure is in
[`docs/runbooks/comms-service-lifecycle-operations.md`](../docs/runbooks/comms-service-lifecycle-operations.md).
The redrive tool publishes only through the normal `foc.events` route, validates
the corrected event with `@foc/contracts`, and acknowledges the DLQ copy only
after publisher confirmation. It must use a dedicated operator identity, never
the runtime Communication Service credentials.

Realtime readiness, Redis-outage recovery, cross-replica verification, rollout,
and rollback are documented in
[`docs/runbooks/comms-service-realtime-operations.md`](../docs/runbooks/comms-service-realtime-operations.md).

Grace-deadline reconciliation, the leased archive worker's claim/signal
behavior, abandoned-claim recovery, and archive evidence for manual
demonstration are documented in
[`docs/runbooks/comms-service-archive-operations.md`](../docs/runbooks/comms-service-archive-operations.md).

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

## Frontend boundary

The service owns committed grace state, deadline enforcement, leased immutable
archiving, archive reads, and best-effort lifecycle socket notifications. The
Package 5 frontend (`frontend/app/home/chats/**`, `frontend/app/home/archives/**`,
`frontend/lib/chat/**`) consumes this boundary end to end: it reaches the HTTP
surface above through the same-origin `/api/chats/*` rewrite for live-chat
list/history, archive list, and archive detail, and reaches the `/chat`
Socket.IO namespace through the same-origin `${SOCKET_PATH}` rewrite for
`chat:join`, `message:send`, `messages:read`, and the `message:new`/
`messages:read-receipt`/`chat:closing`/`chat:archived` events. Countdown
rendering, lifecycle-event handling, archive list/detail screens, and
navigation between live and archived conversations are implemented in the
frontend, not here; this service never renders them and never substitutes a
browser-side authority for the committed state above.

The governing decisions are recorded under
`docs/adr/comms-service/0001`–`0004`: PostgreSQL authority and message
ordering, lifecycle notice ingestion, authenticated WebSocket delivery, and
grace deadlines with immutable archives.
