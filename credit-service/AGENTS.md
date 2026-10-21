# credit-service

Credit ledger built with NestJS and TypeScript, PostgreSQL with TypeORM, and
RabbitMQ. It currently consumes `UserRegistered`, initializes accounts through
an inbox-backed serializable transaction, and relays `CreditAccountInitialised`
through a transactional outbox (the shared `@foc/outbox` package).

Run npm commands from this directory. Run the normal development stack from the
repository root; service-local RabbitMQ and PostgreSQL profiles are isolated
test infrastructure. The service applies pending migrations on startup unless
`DB_MIGRATIONS_RUN=false`; with it off, run `npm run migration:run` before
starting against a fresh schema.

See [README.md](README.md) for setup, migration, shared-contract package usage,
and the unit, integration, messaging, e2e, recovery, and permission test
commands.
