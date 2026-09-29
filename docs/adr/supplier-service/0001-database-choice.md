# PostgreSQL for the supplier service

Status: Proposed

## Decision

The supplier service shall store its data in its own **PostgreSQL** database
(`supplier-db`), accessed through TypeORM, with the schema changed only by
versioned migrations. Records use **UUID** identifiers.

## Rationale

### The data is structured and relational

Every supplier has the same fixed fields: name, kind, building, floor,
location description, coordinates, status and version (FR F1.2, F1.3). There
is no free-form content. Suppliers reference a controlled list of buildings
(F4) and one or more categories (F11) by identifier, and those references
must always point at a real record. This is a relational model: tables with
foreign keys and a join table for the many-to-many supplier ↔ category link.

### The database must enforce the rules, not only the code

- **No duplicate suppliers, even under concurrency (F1.5.2).** Two admins
  submitting the same supplier at the same moment must not both succeed. A
  unique constraint on (normalised name, building, floor) guarantees this;
  a check in application code alone cannot.
- **No two buildings share a name, short name or alias (F4.2).** Enforced by a
  primary key on one row per normalised name (`building_name_keys`), which
  also makes resolving a building from any spelling a single lookup (F4.5).
- **Valid values and references.** CHECK constraints (floor format, coordinate
  ranges, non-blank names) and foreign keys reject bad data even if a code
  path is wrong.
- **All-or-nothing writes (F14.1)** and **safe edits (F14.3)** rely on
  transactions and row locks: an edit locks the supplier, checks the version
  it was based on, and applies the change in one transaction.

### The queries are filter, sort and paginate

The listing (F5) filters by name, building, category, kind and status,
combines filters with AND, sorts by display name or a chosen field with the
id as tie-breaker, and pages with offset/limit (N3.1). SQL with indexes on
the filter columns handles this directly.

### The scale is small

A campus has hundreds of suppliers, and reads dominate. One PostgreSQL
instance is ample, and extra service replicas can share it; the service
itself stays stateless (N3.3).

### The team already runs it

user-service, order-service and credit-service also use PostgreSQL 18, so the
same image, tooling and knowledge apply. Following credit-service, the schema
is created only by hand-written TypeORM migrations with named constraints;
`synchronize` is always off. An integration test fails if the entities and
the migrations ever describe different schemas.

## Alternatives considered

- **A document database (e.g. MongoDB).** Suited to flexible, nested content,
  which supplier data does not have. The key guarantees above (a uniqueness
  rule across three fields that holds under concurrency, references that must
  exist, multi-row transactions) would have to be rebuilt in application
  code, less reliably.
- **Sharing another service's database.** Rejected: each service owns its
  data (database per service). Other services use the supplier API, and
  later the message broker (F15.7), instead of reading these tables.

## Identifiers: UUIDs rather than auto-increment

- F1.1 requires a system-generated, immutable UUID that is never reused and
  not derived from the name or location.
- Other services store supplier ids: order-service's `errands.supplier_id` is
  a `uuid`. credit-service also uses UUIDs.
- UUIDs can be created independently, by the service before inserting or by
  any replica, with no shared counter to coordinate.
- Sequential ids would reveal record counts and be easy to enumerate in URLs.
  This matters little here, since supplier data is essentially public.

## Consequences

- Every schema change needs a migration, reviewed like code.
- Random (v4) UUIDs scatter inserts across indexes, which costs performance
  at large scale. At this service's size the cost is negligible;
  time-ordered UUIDs (v7) would remove it if ever needed.
- Rules the database cannot express are enforced in the service, inside the
  same transaction: at least one category per supplier (F1.2.3), coordinates
  within the configured campus box (F1.2.7), and only non-retired buildings
  and categories for newly supplied values (F1.8).
- Listing order uses the database's collation (English, `en_US.utf8`), so
  names sort in case- and punctuation-aware dictionary order.
