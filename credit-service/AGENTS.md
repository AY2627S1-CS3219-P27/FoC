# credit-service

Credit ledger built with NestJS and TypeScript, PostgreSQL with TypeORM, and
RabbitMQ. It currently consumes `UserRegistered`, initializes accounts through
an inbox-backed serializable transaction, and relays `CreditAccountInitialised`
through a transactional outbox.

Run npm commands from this directory. Run the normal development stack from the
repository root; service-local RabbitMQ and PostgreSQL profiles are isolated
test infrastructure. Database migrations are explicit and must run before the
application starts against a fresh schema.

See [README.md](README.md) for setup, migration, contract synchronization, and
the unit, integration, messaging, e2e, recovery, and permission test commands.
