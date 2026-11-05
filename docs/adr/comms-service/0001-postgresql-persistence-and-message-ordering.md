# PostgreSQL persistence and message ordering

## Context

Communication Service must retain lifecycle evidence, conversations, ordered
messages, per-recipient read state, and immutable archive snapshots. Message
delivery may span several application replicas, but reconnect recovery and
archive creation cannot depend on which replica handled a socket connection.

The data model also needs database-enforced participant, state, sequence,
archive-link, claim-lease, and immutability invariants. Automatic schema
creation would make those constraints difficult to review and unsafe to roll
back.

## Decision

PostgreSQL is the authoritative store for Communication Service. TypeORM is
used for application integration, with schema synchronization disabled in
every environment and all schema changes applied through explicit migrations.

Each chat has a monotonically allocated sequence number. Messages are unique
by `(chat_id, sequence)` and by the sender retry identity
`(chat_id, sender_id, client_message_id)`. Lifecycle facts and archive rows are
insert-only at the database boundary. An archive is a versioned JSONB snapshot;
the archive row is inserted before its identifier is linked from the retained
chat row in the same transaction.

Redis is not a database or recovery source. A later realtime package may use
it only for Socket.IO fan-out between replicas. History, deduplication, read
state, deadlines, and archives always recover from PostgreSQL.

## Consequences

- Production startup never creates or changes tables implicitly.
- Deployments run and verify migrations before enabling application traffic.
- PostgreSQL-specific constraints, partial indexes, row locks, and triggers are
  accepted where they enforce service invariants.
- Committed messages remain recoverable after a process, socket, or Redis
  failure.
- Migration rollback is exceptional once retained lifecycle or chat evidence
  exists; ordinary rollback preserves the database and broker queues.
