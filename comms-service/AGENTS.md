# comms-service

NestJS Communication Service foundation using PostgreSQL with TypeORM,
RabbitMQ, Redis, shared User Service JWT verification, and shared observability.
Architecture decisions live in `../docs/adr/comms-service/`.

Run npm commands from this directory. Schema synchronization is prohibited in
all environments: use explicit TypeORM migrations. PostgreSQL is authoritative;
Redis may only support future cross-replica Socket.IO delivery. The service
must never publish domain events to `foc.events`.

Root broker definitions own the four lifecycle primary queues and their
`foc.events` bindings. Communication Service must not declare those queues or
touch the shared exchange; it owns only `foc.comms.*`, retry queues, return
bindings, and DLQs through its idempotent startup provisioner.

Package 2 lifecycle ingestion is active: four independently retried consumers
validate shared contracts, record inbox/lifecycle evidence, and create one chat
per accepted-event identity. Authenticated chat APIs, Socket.IO, message/read
handling, grace transitions, and archive workers remain deferred to their
roadmap steps.

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
