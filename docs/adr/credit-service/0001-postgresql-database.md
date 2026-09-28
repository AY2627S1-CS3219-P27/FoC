# Choose PostgreSQL for Credit Service

## Context

Credit Service owns credit balances, reservations, allocations, and future
transactions. These records are relational and must remain consistent when
several requests or event deliveries affect the same account concurrently.

The service therefore needs a database that supports atomic multi-record
operations, durable constraints, explicit transaction isolation, and reliable
schema migrations.

## Decision

Credit Service uses PostgreSQL as its database. TypeORM provides the NestJS
integration and maps application entities to the PostgreSQL schema. Schema
changes are applied through committed migrations; automatic schema
synchronization is disabled.

PostgreSQL-specific concurrency features may be used when they protect domain
invariants or coordinate workers. Current examples include `SERIALIZABLE`
transactions, transaction-scoped advisory locks, and `FOR UPDATE SKIP LOCKED`.

## Rationale

PostgreSQL is a widely adopted, production-grade relational database with
strong ACID transaction guarantees, mature concurrency control, foreign keys,
checks, indexes, and triggers. These capabilities allow the database to serve
as the final line of defense for non-negative balances, unique allocations,
immutable records, and atomic inbox/outbox processing.

NestJS has established TypeORM integration, and TypeORM provides supported
PostgreSQL drivers, migrations, entity mapping, and transaction management.
This keeps ordinary persistence code aligned with the service framework while
still allowing targeted SQL for PostgreSQL features that an ORM cannot express
clearly.

PostgreSQL is preferable to an eventually consistent or document-oriented
store for this service because credit operations require relationships and
cross-record invariants to be committed as one unit.

## Consequences

- Credit Service must operate and monitor a PostgreSQL instance in every
  deployed environment.
- Schema changes require reviewed, forward and backward migrations.
- PostgreSQL constraints and transactions prevent invalid state even when a
  write bypasses TypeORM.
- Use of advisory locks, `SKIP LOCKED`, triggers, and PostgreSQL error codes
  makes parts of the persistence layer database-specific.
- Application code must explicitly convert PostgreSQL `BIGINT` values and
  reject values outside JavaScript's safe-integer range.
