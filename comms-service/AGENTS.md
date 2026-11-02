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

Package 1 currently provides infrastructure only. Do not add lifecycle
consumers, chat APIs, a Socket.IO namespace, or archive workers until their
roadmap packages are implemented.

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
