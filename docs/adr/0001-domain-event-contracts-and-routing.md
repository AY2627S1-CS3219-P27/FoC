# Define Domain Event Contracts and Routing

## Context

Friend on Campus services communicate state changes asynchronously. Publishers
and consumers need a shared wire format, routing convention, and contract source
so they can evolve independently without maintaining divergent schema copies.

Services must remain independently buildable and deployable while using the
same contract definitions and validation behavior.

## Decision

### Exchange and routing

Domain events use the durable RabbitMQ direct exchange `foc.events`.

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

### Canonical package and deployment

Shared event contracts use JSON Schema draft 2020-12. Versioned schemas under
[`packages/contracts/src/domain-events/schemas`](../../packages/contracts/src/domain-events/schemas/)
are canonical. Their filenames and `$id` values remain stable for the life of
that contract version.

The `@foc/contracts` package owns the schemas, TypeScript wire types, strict AJV
validation, standardized failure codes, and sanitized violation format.
Services consume it through the repository-local `file:` dependency and rebuild
it before compilation, startup, and tests. This keeps publishers and consumers
on one implementation instead of maintaining service-local schema copies or
validators.

Each service packages the built contract package and its runtime dependencies
into its deployment artifact. Production processes therefore remain
self-contained and do not read from a repository checkout at runtime. A clean
package build must fail when a canonical schema is missing or invalid.

The currently established contracts are:

| Event | Publisher | Routing key | Canonical schema |
| --- | --- | --- | --- |
| `UserRegistered` | User Service | `user.registered.v1` | [`user-registered.v1.schema.json`](../../packages/contracts/src/domain-events/schemas/user-registered.v1.schema.json) |
| `CreditAccountInitialised` | Credit Service | `credit.account-initialised.v1` | [`credit-account-initialised.v1.schema.json`](../../packages/contracts/src/domain-events/schemas/credit-account-initialised.v1.schema.json) |

The canonical schemas, including
[`event-envelope.v1.schema.json`](../../packages/contracts/src/domain-events/schemas/event-envelope.v1.schema.json),
are authoritative for exact fields and validation constraints.

## Rationale

RabbitMQ direct exchanges are an established mechanism for routing messages by
an exact key. Every currently planned integration has an enumerated contract
and recipient, so exact bindings express the required topology without exposing
unused wildcard subscriptions. More than one queue may deliberately use the
same exact binding; direct routing does not itself guarantee one subscriber.

A uniform envelope supplies the metadata required for validation, ownership,
tracing, and idempotency without coupling consumers to publisher source code.
Versioned routing keys allow incompatible contracts to coexist during a staged
rollout.

JSON Schema is an industry-standard, language-neutral contract format with
mature validation tooling. Packaging those schemas with their TypeScript types
and AJV validator prevents publisher and consumer definitions or validation
behavior from drifting. A repository-local package avoids a separate release
process while still giving every service an explicit dependency boundary.

Bundling the built package in each service image preserves independent
deployment. Services coordinate contract changes in the repository but do not
need the monorepo filesystem after an artifact is built.

## Consequences

- Publishers and consumers coordinate changes through one reviewable package.
- Services subscribe through explicit, versioned routing-key bindings.
- Adding another consumer requires another reviewed exact binding.
- Every consuming service must build and package `@foc/contracts` and its
  runtime dependencies.
- Docker builds using the local `file:` dependency require the repository root
  in their build context.
- Contract validation changes affect every consumer after it updates to the
  corresponding repository revision.
- Breaking changes create another schema and routing-key version, increasing
  the number of versions supported during migration.
- At-least-once delivery may repeat an envelope, so consumers must deduplicate
  using `eventId` and their domain invariants.
- Wildcard bindings must be reviewed carefully to avoid sending unnecessary
  traffic to broadly subscribed queues.

## Requirement Traceability

- N3.2.1: route asynchronous events through a message broker.
