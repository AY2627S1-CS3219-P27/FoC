# @foc/contracts

Versioned wire contracts, types, and validators shared between Friend on Campus
services. This package is the canonical source for access-token and domain-event
contracts.

## Usage

Services depend on it locally via a `file:` dependency, so every service uses
the same contract versions.

```json
{ "dependencies": { "@foc/contracts": "file:../packages/contracts" } }
```

npm symlinks the directory into `node_modules`; rebuild it after edits with
`npm run build` from this folder (service `pre*` hooks should do this
automatically).

The package exports the common domain-event envelope, the `UserRegistered` and
`CreditAccountInitialised` event types, and the framework-neutral
`AccountEventContractValidator`. Its typed registry is the authoritative map
from a versioned routing key to the event type, publisher, payload type, and
JSON Schema. Call `validate(routingKey, input)` to receive the corresponding
`EventOf<typeof routingKey>` after validation.

Each event version keeps its descriptor, payload type, schema, and focused
tests under `src/domain-events/events/<event>/<version>`. The common envelope
schema and type remain at `src/domain-events`. Imported schemas are emitted into
`dist` during the TypeScript build, and schema `$id` values remain stable for
the life of a contract version.

Services must package this local dependency into their own deployment artifact;
deployed services must not depend on the repository checkout at runtime.

## Development

```sh
npm install   # install dev dependencies
npm test      # run the package's own specs
npm run build # compile dist/ (consumers read dist/)
npm run lint  # lint package sources
```
