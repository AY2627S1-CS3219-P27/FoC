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

Realtime message sends use one PostgreSQL transaction. The command locks the
chat row, proves that the authenticated user is a participant, validates that
the chat is writable, and checks the sender retry identity before allocating
the current `next_sequence`. Reusing a retry identity with identical content
returns the stored message without advancing the sequence or changing chat
ordering; reusing it with different content is a conflict. A new send inserts
the unread message, advances `next_sequence`, and updates the chat's
`updated_at` in the same transaction. Rollback therefore exposes neither a
message nor a consumed sequence. Acknowledgements and socket emissions happen
only after commit, and an idempotent retry never emits the message again.

Message content is non-blank and no longer than 4,000 Unicode code points. The
database-assigned message timestamp is persistence evidence; it is not
described as the exact physical commit instant. A new message is `UNREAD`.
When an idempotent retry returns a message that has since been read, its status
is derived from the stored `read_at` value rather than forced back to
`UNREAD`.

Read acknowledgements are explicit through-sequence commands. In one transaction,
the service locks and authorizes the chat, rejects a sequence beyond the
latest committed message, and updates only unread messages sent by the other
participant whose sequence is at or below the requested value. Every row
changed by one command receives the same database timestamp. Repeated and
overlapping reads are successful no-ops and preserve earlier timestamps; they
do not reorder the chat. Fetching history, joining a socket room, and reading
the caller's own messages never mutate read state. A forward migration adds a
partial `(chat_id, sender_id, sequence) WHERE read_at IS NULL` index without
editing the initial migration.

Redis is not a database or recovery source. The realtime gateway uses it only
for Socket.IO fan-out between replicas. History, deduplication, read
state, deadlines, and archives always recover from PostgreSQL.

Socket acknowledgement and emission are post-commit best effort, not part of
the database transaction. A crash after commit can lose either signal without
losing the command. The sender retries with the same `client_message_id`, and
all clients reconcile a missing acknowledgement, emission, or sequence through
the authenticated PostgreSQL-backed history API.

## Consequences

- Production startup never creates or changes tables implicitly.
- Deployments run and verify migrations before enabling application traffic.
- PostgreSQL-specific constraints, partial indexes, row locks, and triggers are
  accepted where they enforce service invariants.
- Committed messages remain recoverable after a process, socket, or Redis
  failure.
- Concurrent sends serialize on the chat row and produce unique, gap-free
  committed sequences.
- Only a genuinely new message changes `updated_at`; retries and read commands
  do not move a conversation in the chat list.
- Read state is caller-relative and derived from message rows rather than a
  second mutable chat-level flag.
- A successful acknowledgement proves database commit, not delivery to
  another socket.
- Migration rollback is exceptional once retained lifecycle or chat evidence
  exists; ordinary rollback preserves the database and broker queues.
