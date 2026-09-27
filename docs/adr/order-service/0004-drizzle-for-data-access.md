# Drizzle for data access

## Decision

Order-service uses Drizzle (`drizzle-orm` + `drizzle-kit`) against PostgreSQL,
rather than raw `pg`, a heavier ORM (TypeORM/Prisma), or a different query
builder (Knex).

## Rationale

The event-sourced write path (0001) needs precise, hand-written transactional
SQL: an `INSERT` into `errand_events` and a conditional `UPDATE ... WHERE
status = 'Open'` in the same transaction, with the affected-row count as the
optimistic-concurrency signal. Drizzle's `db.transaction()` exposes exactly
that level of control — it has no unit-of-work/change-tracking layer to fight
it, unlike TypeORM or Prisma's data-mapper/ActiveRecord models. What it adds
over raw `pg`: compile-time type safety on every column across a
state-machine-heavy schema (8 states, 2 internal sub-states, JSONB event
payloads), and `drizzle-kit` generates migrations from the TypeScript schema
instead of hand-maintained SQL migration files.

Neither sibling service had committed to a data-access library at the time of
this decision, so there was no existing repo convention to match or break.
