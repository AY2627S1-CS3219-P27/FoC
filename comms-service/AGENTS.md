# comms-service

NestJS Communication Service foundation using PostgreSQL with TypeORM,
RabbitMQ, Redis, shared User Service JWT verification, and shared observability.
Architecture decisions live in `../docs/adr/comms-service/`.

Run npm commands from this directory. Schema synchronization is prohibited in
all environments: use explicit TypeORM migrations. PostgreSQL is authoritative;
Redis may only support future cross-replica Socket.IO delivery. The service
must never publish domain events to `foc.events`.

Root broker definitions own `foc.pubsub` and the event-forwarding bindings.
Communication Service owns `comms-service.events`, its `order.#` binding, one
retry chain, and one DLQ through its idempotent startup provisioner. It must
never configure or publish to either shared exchange.

Package 2 lifecycle ingestion and authenticated reads are active: one unified
Order-event consumer dispatches four lifecycle contracts, records
inbox/lifecycle evidence, and create one chat per accepted-event identity.
Participant-only chat listing and message history are exposed at `/v1/chats`.
Socket.IO, message/read mutations, grace transitions, and archive workers remain
deferred to their roadmap steps.

Package 2 metrics use bounded operational labels only; never add participant,
errand, chat, event, cursor, or token values as labels. DLQ inspection and
redrive follow `../docs/runbooks/comms-service-package-2.md`: corrected messages
return through `foc.events` with a dedicated operator identity and normal
contract validation, never through a primary queue or direct database edits.

The root stack keeps Communication Service and its PostgreSQL database on the
private `internal` network without host ports. Use the opt-in
`compose.debug.yaml` overlay for loopback-only direct access. Test-profile
PostgreSQL and RabbitMQ ports must also remain bound to `127.0.0.1`.

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
- `npm run test:rabbitmq-permissions`
