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

TypeORM never synchronizes the schema. Migrations are always explicit:

```powershell
npm run migration:show
npm run migration:run
npm run migration:revert
```

Create local secret files from the templates introduced with platform wiring,
then combine `env/shared.env` and `env/comms-service.env` when starting the
service. `JWT_PUBLIC_KEY_FILE`, `DB_PASSWORD_FILE`, and
`RABBITMQ_PASSWORD_FILE` contain file paths, never secret values.

`SOCKET_PATH`, `SOCKET_ALLOWED_ORIGINS`, and the fixed WebSocket-only transport
are validated now so deployment configuration remains stable. No socket server
is registered in this package.
