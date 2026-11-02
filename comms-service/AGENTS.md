# comms-service

NestJS Communication Service foundation using PostgreSQL with TypeORM,
RabbitMQ, Redis, shared User Service JWT verification, and shared observability.

Run npm commands from this directory. Schema synchronization is prohibited in
all environments: use explicit TypeORM migrations. PostgreSQL is authoritative;
Redis may only support future cross-replica Socket.IO delivery. The service
must never publish domain events to `foc.events`.

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
