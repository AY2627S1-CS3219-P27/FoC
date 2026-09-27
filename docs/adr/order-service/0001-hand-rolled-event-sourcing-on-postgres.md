# Event-sourced errand lifecycle, hand-rolled on PostgreSQL

## Decision

The errand lifecycle is event-sourced: an append-only `errand_events` table is
the sole source of truth, with a `errands` projection table (one row per
errand) kept in sync in the same PostgreSQL transaction as every event
append. Both tables live in PostgreSQL — no separate event store product, and
no event-sourcing/CQRS framework (e.g. `@nestjs/cqrs`). All reads, filters and
listings query the projection; nothing reads the event log directly except
projection rebuilds.

## Rationale

The backlog's own requirements (F9.1, F5.3.1) already specify the shape:
event log + synchronously-updated projection, single-assignment enforced by a
conditional transition inside one transaction. PostgreSQL's ordinary ACID
transactions satisfy that directly — appending an event and updating the
projection row in the same transaction is a single `INSERT` + `UPDATE`
wrapped in a `BEGIN`/`COMMIT`, with the conditional `UPDATE ... WHERE
status = 'Open'` giving optimistic concurrency for free via the row's
affected-count.

A dedicated event store (e.g. EventStoreDB) or a CQRS framework would add a
second datastore or a new abstraction layer for a problem this narrow: one
aggregate type (the errand), a fixed set of transitions, no cross-aggregate
projections, no requirement for pluggable read models. The generic
machinery those tools provide (stream subscriptions, snapshotting
strategies, projection rebuild pipelines) would be built and never
exercised. Plain tables and hand-written append/apply logic are also easier
to review against the spec line-by-line, which matters for a
requirements-heavy backlog like this one.
