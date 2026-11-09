# user-service

Module M.1: registration, OTP, login/tokens, roles, admin accounts.

NestJS and TypeScript, PostgreSQL with TypeORM, Redis, and RabbitMQ. It
publishes `UserRegistered` through a transactional outbox (the shared
`@foc/outbox` package) and issues RS256 access tokens for every other
service.

Run npm commands from this directory. Run the normal development stack from
the repository root; the service and its database publish no host ports
unless you add `-f compose.debug.yaml`. See [README.md](README.md) for
setup, API docs (`/docs`, `/docs-json`), and the unit, e2e, and coverage
test commands.
