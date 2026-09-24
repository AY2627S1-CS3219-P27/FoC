# Define Domain Event Contracts and Routing

## Context

Friend on Campus services communicate state changes asynchronously. Publishers
and consumers need a shared wire format, routing convention, and contract source
so they can evolve independently without maintaining divergent schema copies.

Services must remain independently buildable and deployable. A deployed service
cannot depend on the monorepo or a shared runtime package to validate events.

## Decision

### Exchange and routing

Domain events use the durable RabbitMQ topic exchange `foc.events`.

Routing keys identify an event and its contract version using dot-separated
names such as:

- `user.registered.v1`
- `credit.account-initialised.v1`

Canonical event names do not contain version suffixes. An incompatible contract
change requires a new routing-key version and schema file; an adopted version
must not change incompatibly.

### Event envelope

Every domain event contains exactly:

- `eventId`: a publisher-generated UUID that remains stable across retries;
- `eventType`: the canonical, case-sensitive event name;
- `timestamp`: an RFC 3339 UTC date-time ending in uppercase `Z`;
- `publisher`: the publishing service name; and
- `payload`: the event-specific object.

The routing key, event type, publisher, and payload schema must agree. Unknown
envelope and payload properties are rejected.

### Canonical schemas and deployment

Shared event contracts use JSON Schema draft 2020-12. Versioned schemas under
[`contracts/schemas`](../../contracts/schemas/) are the repository's canonical
source of truth. Their filenames and `$id` values remain stable for the life of
that contract version.

Each service explicitly selects only the schemas it publishes or consumes. Its
build tooling validates and copies those schemas into its compiled artifact. A
service may generate an ignored source-time cache for local development and
tests, but generated copies are never edited or committed.

Production processes load schemas only from their own deployment artifacts.
They do not read the repository root or import a shared runtime package. A clean
build must fail when a required canonical schema is missing or invalid.

The currently established contracts are:

| Event | Publisher | Routing key | Canonical schema |
| --- | --- | --- | --- |
| `UserRegistered` | User Service | `user.registered.v1` | [`user-registered.v1.schema.json`](../../contracts/schemas/user-registered.v1.schema.json) |
| `CreditAccountInitialised` | Credit Service | `credit.account-initialised.v1` | [`credit-account-initialised.v1.schema.json`](../../contracts/schemas/credit-account-initialised.v1.schema.json) |

The canonical schemas, including
[`event-envelope.v1.schema.json`](../../contracts/schemas/event-envelope.v1.schema.json),
are authoritative for exact fields and validation constraints.

## Rationale

RabbitMQ topic exchanges are an established publish/subscribe mechanism for
event-driven microservices. Exact bindings remain available for narrowly scoped
consumers, while wildcard bindings allow future audit, notification, or
integration consumers to subscribe to an intentional event family without
changing its publishers.

A uniform envelope supplies the metadata required for validation, ownership,
tracing, and idempotency without coupling consumers to publisher source code.
Versioned routing keys allow incompatible contracts to coexist during a staged
rollout.

JSON Schema is an industry-standard, language-neutral contract format with
mature validation tooling, including AJV for NestJS and TypeScript services. A
single repository source prevents publisher and consumer definitions from
drifting.

Build-time copying preserves independent deployments. Each service ships only
the contracts it uses and remains self-contained without coordinating releases
through a shared runtime library.

## Consequences

- Publishers and consumers coordinate changes through one reviewable schema
  source.
- Services can subscribe exactly or by deliberate topic pattern without
  publisher changes.
- Every service build must select, validate, and package its required schemas.
- Docker builds that synchronize schemas require the repository root in their
  build context.
- Generated schema caches are disposable and must remain untracked.
- Breaking changes create another schema and routing-key version, increasing
  the number of versions supported during migration.
- At-least-once delivery may repeat an envelope, so consumers must deduplicate
  using `eventId` and their domain invariants.
- Wildcard bindings must be reviewed carefully to avoid sending unnecessary
  traffic to broadly subscribed queues.

## Requirement Traceability

- N3.2.1: route asynchronous events through a message broker.
