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
`AccountEventContractValidator`. Their versioned JSON Schemas live beside the
validator under `src/domain-events/schemas` and are emitted into `dist` during
the TypeScript build. Schema filenames and `$id` values are stable for the life
of a contract version.

Services must package this local dependency into their own deployment artifact;
deployed services must not depend on the repository checkout at runtime.

## Development

```sh
npm install   # install dev dependencies
npm test      # run the package's own specs
npm run build # compile dist/ (consumers read dist/)
npm run lint  # lint package sources
```
