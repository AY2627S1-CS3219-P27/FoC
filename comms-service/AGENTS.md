# comms-service

NestJS Communication Service foundation using PostgreSQL with TypeORM,
RabbitMQ, Redis, shared User Service JWT verification, and shared observability.
Architecture decisions live in `../docs/adr/comms-service/`. Operational
runbooks live in `../docs/runbooks/`: lifecycle ingestion and DLQ redrive
(`comms-service-lifecycle-operations.md`), realtime socket/Redis operations
(`comms-service-realtime-operations.md`), and grace-deadline/archive-worker
operations (`comms-service-archive-operations.md`).

Run npm commands from this directory. Schema synchronization is prohibited in
all environments: use explicit TypeORM migrations. PostgreSQL is authoritative;
Redis supports transient cross-replica Socket.IO delivery only. It must never
store message, read-state, sequence, room-authority, or recovery truth. The
service must never publish domain events to `foc.events`.

Root broker definitions own `foc.pubsub` and the event-forwarding bindings.
Communication Service owns `comms-service.events`, its `order.#` binding, one
retry chain, and one DLQ through its idempotent startup provisioner. It must
never configure or publish to either shared exchange.

Lifecycle ingestion and authenticated reads are active: one unified
Order-event consumer dispatches four lifecycle contracts, records
inbox/lifecycle evidence, and creates one chat per accepted-event identity.
Terminal facts transactionally apply monotonic delivery or cancellation grace
deadlines, including reconciliation when terminal evidence predates acceptance.
Participant-only live chat, message history, archive list, and immutable archive
detail reads are exposed at `/v1/chats`.
The authenticated `/chat` Socket.IO namespace and participant-only
`chat:join` admission are active with WebSocket-only transport. Transactional
`message:send` commands allocate ordered sequences, deduplicate sender retries,
and emit only committed messages. Explicit `messages:read` commands update only
received unread messages and emit committed receipts. Dedicated Redis publisher
and subscriber connections fan out room events across replicas and participate
in readiness and shutdown. Every replica runs a bounded leased archive worker;
PostgreSQL locking and expiring claim tokens coordinate concurrent replicas.
The worker inserts a versioned immutable snapshot, deletes live messages, marks
the retained chat archived, and emits `chat:archived` only after commit.
Shutdown stops after the current archive operation and uses the configured
bounded drain deadline; abandoned claims recover only through lease expiry.

The backend realtime boundary includes committed message/read events and the
best-effort `chat:closing` and `chat:archived` notifications. Do not add browser
socket lifecycle, countdown rendering, archive screens, navigation, refresh,
or visible receipt rendering here; those remain frontend responsibilities. The
Package 5 frontend now implements exactly this boundary end to end
(`frontend/app/home/chats/**`, `frontend/app/home/archives/**`,
`frontend/lib/chat/**`); this service's role is to keep serving the committed
HTTP and socket contracts those routes consume, never to grow a browser-side
implementation of them.

Metrics use bounded operational labels only; never add participant, errand,
chat, message, archive, event, claim, cursor, or token values as labels. Grace
and archive worker/notification logs must remain sanitized and include only
operation, bounded outcome, and error class—never content, snapshots, cookies,
tokens, identifiers, or participant payloads.
DLQ inspection and redrive follow
`../docs/runbooks/comms-service-lifecycle-operations.md`: corrected messages
return through `foc.events` with a dedicated operator identity and normal
contract validation, never through a primary queue or direct database edits.

The root stack keeps Communication Service and its PostgreSQL database on the
private `internal` network without host ports. Use the opt-in
`compose.debug.yaml` overlay for loopback-only direct access. Test-profile
PostgreSQL, RabbitMQ, and Redis test ports must remain bound to
`127.0.0.1`.

Useful commands:

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run format:check`
- `npm run migration:show`
- `npm run migration:run`
- `npm run migration:revert`
- `npm run db:test:up` / `npm run db:test:down`
- `npm run rabbitmq:test:up` / `npm run rabbitmq:test:down`
- `npm run test:integration`
- `npm run socket:test:up` / `npm run socket:test:down`
- `npm run test:socket-integration`
- `npm run test:rabbitmq-permissions`
- `npm run test:fixtures`
- `npm run dlq:operator`
- `npm run realtime:fixture`
- the `event:fixtures:list` / `event:publish:*` fixture-publishing family
- `npm run migration:generate` / `npm run migration:create`
- `npm run migration:run:prod` / `npm run migration:show:prod` / `npm run migration:revert:prod`
