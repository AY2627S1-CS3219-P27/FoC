# Grace deadlines and immutable archive snapshots

## Context

Chats remain writable for three hours after delivery and thirty minutes after
courier or errand cancellation. Broker notices can be delayed, duplicated, or
arrive out of order. Archiving can also race with a final send across several
service replicas.

Archived chats must remain participant-only, newest-first, and read-only. A
view assembled dynamically from mutable message rows would not be an immutable
record of what was archived.

## Decision

Communication Service derives `closesAt` from the lifecycle envelope timestamp: three hours
for `ErrandDelivered`, and thirty minutes for `CourierCancelled` or
`ErrandCancelled`. A later or duplicate terminal notice never extends an
earlier deadline. If a delayed notice is already past its derived deadline,
the matching chat is immediately due for archive.

A leased worker claims due chats using PostgreSQL row locking. Sending and
archiving lock the same chat row and recheck state and deadline, preventing a
message from committing after `closesAt`.

Archiving is one transaction: create one versioned JSONB snapshot in stable
message-sequence order, set the chat to `ARCHIVED` and link its unique archive
identifier, then remove mutable live-message rows. The retained chat and
insert-only archive preserve identity. Archive updates and deletions are
prohibited at the database boundary.

## Consequences

- Original event time, not consumer receipt time, controls grace duration.
- Duplicate and reordered terminal events cannot reopen a chat or lengthen its
  writable period.
- Exactly one archive exists per chat and remains readable only by its
  requester and courier.
- Archive JSON is versioned so later readers can support schema evolution.
- Communication Service applies grace deadlines, enforces them across live
  operations, runs the leased archive worker, exposes participant-only archive
  reads, and emits best-effort lifecycle socket notifications.
- Countdown rendering, lifecycle-event handling, archive screens, and
  live-to-archive navigation remain frontend responsibilities.
