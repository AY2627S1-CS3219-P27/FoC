# Persist Account Initialization Atomically

## Context

Credit Service must create one credit account when it consumes
`UserRegistered`, grant the configured initial credits, retain an immutable
record of that allocation, and arrange publication of
`CreditAccountInitialised`.

RabbitMQ provides at-least-once delivery. The service can receive the same
event more than once, receive equivalent registrations under different event
IDs, or stop after committing database changes but before acknowledging the
message. Account, allocation, inbox, and outgoing-event state must remain
consistent in every case.

## Decision

### Numeric representation

Credit balances and allocation amounts use PostgreSQL `BIGINT`. Application
inputs and loaded values must remain positive or non-negative integers, as
applicable, within JavaScript's safe-integer range. The TypeORM boundary
converts validated `BIGINT` values to application numbers and rejects values
outside that range.

`credit_balance` means credits available to spend. `reserved_balance` means
credits held for a future transaction.

### Tables and constraints

`credit_accounts` contains:

- `user_id UUID PRIMARY KEY`
- `credit_balance BIGINT NOT NULL CHECK (credit_balance >= 0)`
- `reserved_balance BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0)`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `version INTEGER NOT NULL`

`credit_allocations` contains:

- `id UUID PRIMARY KEY`
- `user_id UUID NOT NULL` referencing `credit_accounts(user_id)` with deletion
  restricted
- `amount BIGINT NOT NULL CHECK (amount > 0)`
- `created_at TIMESTAMPTZ NOT NULL`

A unique index on `user_id` enforces one initial allocation per account. A
database trigger rejects every update or deletion of a `credit_allocations`
row. Initial allocations remain separate from future credit transactions
because they issue platform credits rather than transfer credits between
balances or users.

`inbox_events` contains:

- `event_id UUID PRIMARY KEY`
- `event_type TEXT NOT NULL`
- `payload_hash CHAR(64) NOT NULL`, containing a SHA-256 hash of the canonical
  validated payload
- `received_at TIMESTAMPTZ NOT NULL`
- `processed_at TIMESTAMPTZ NOT NULL`
- `outcome_allocation_id UUID NOT NULL` referencing the established allocation

`outbox_events` contains:

- `event_id UUID PRIMARY KEY`
- `event_type TEXT NOT NULL`
- `routing_key TEXT NOT NULL`
- `envelope JSONB NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `published_at TIMESTAMPTZ NULL`
- `attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`
- `last_error TEXT NULL`
- `claimed_by TEXT NULL`
- `claimed_until TIMESTAMPTZ NULL`

A partial index ordered by `created_at` covers unpublished outbox rows.

### Transaction and duplicate handling

Each valid `UserRegistered` delivery is handled in one PostgreSQL
`SERIALIZABLE` transaction:

1. Acquire a transaction-scoped advisory lock derived from the event ID.
2. Hash the exact validated payload in a fixed property order and inspect the
   inbox for that event ID.
3. Return the established result without writes when the event type and hash
   match, or reject conflicting reuse of the event ID.
4. Create or locate the user's account and immutable allocation.
5. Insert a validated `CreditAccountInitialised` envelope into the outbox only
   when a new allocation was created.
6. Insert the inbox row linked to the established allocation.
7. Commit before the RabbitMQ delivery is acknowledged.

The application retries PostgreSQL serialization failures (`40001`) and
deadlocks (`40P01`) up to three times with short jittered delays. Exhaustion is
returned to the RabbitMQ retry policy as a transient processing failure.

A different event ID for an initialized user creates another inbox row linked
to the original allocation, but does not change either balance or create
another allocation or outbox event.

### Outbox claiming

Relay workers atomically claim unpublished rows with `FOR UPDATE SKIP LOCKED`,
set `claimed_by` and an expiring `claimed_until` lease, and commit before
contacting RabbitMQ. Confirmed publication sets `published_at` and clears the
claim. A failed attempt records a sanitized error and releases the claim. An
expired claim can be recovered by another worker.

The event ID and stored envelope never change between attempts. A worker that
stops after RabbitMQ confirms publication but before it records `published_at`
can cause the same event to be published again.

## Rationale

A relational schema with database constraints makes PostgreSQL the authority
for balance validity, allocation uniqueness, and allocation immutability. This
is an established approach for financial-style ledgers because application
checks alone cannot prevent concurrent or out-of-band writes from violating
invariants.

The transactional inbox and outbox patterns are common industry solutions for
coordinating database state with at-least-once messaging without relying on a
distributed transaction between PostgreSQL and RabbitMQ. NestJS and TypeORM
allow all participating repositories to share one caller-owned
`EntityManager`, so the complete business outcome has one transaction boundary.

`SERIALIZABLE` isolation, advisory locking by event ID, and uniqueness
constraints address different concurrency scopes: duplicate deliveries of one
event, concurrent events for one user, and final database integrity. Keeping
the initial allocation in its own table also preserves strict domain
terminology and leaves future user-to-user or balance-to-reserve movements for
a separate transaction model.

## Consequences

- Account creation, initial allocation, inbox evidence, and the optional
  outgoing event either commit together or roll back together.
- Repeated and concurrent registrations cannot grant the initial credits more
  than once.
- Email and display name are validated but are represented in Credit Service
  only by the canonical payload hash.
- Allocation history cannot be corrected in place; a future correction would
  require an explicit compensating domain operation.
- Outbox publication is at least once rather than exactly once, so downstream
  consumers must remain idempotent.
- PostgreSQL-specific locks, isolation behavior, triggers, and claim SQL must be
  covered by database integration tests.

## Requirement Traceability

- Issues #510-#515: configurable initial allocation and immutable allocation
  record.
- N3.2 and N3.2.2-N3.2.2.1: transactional outbox and consumer deduplication.
- N3.3-N3.3.1: reconstructable persistent state.
- N7.6: retry unpublished outbox entries until confirmation.
- N8.1-N8.1.2.1: atomic credit changes and non-negative balances.
