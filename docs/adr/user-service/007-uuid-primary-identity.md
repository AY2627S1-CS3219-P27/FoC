# UUID as the user's primary identity

## Decision

Users shall have their primary identified column to be a UUID

## Rationale

UUIDs do not expose signup order or enable account enumeration the way
sequential integers do.

UUIDs additionally facilitate scalability - numbered UIDs must be synchronized
when creating new items. UUIDs are universally unique, meaning they may be
generated in isolation from other instanced.

## Consequences

- UUIDs take more space as compared to numbered UIDs.
- Performance of UUIDs are generally worse due to cache locality and indexing.
