# @foc/contracts

Versioned contracts shared between Friend on Campus services.

## Usage

Services depend on it locally via a `file:` dependency, so every service uses
the same contract versions.

```json
{ "dependencies": { "@foc/contracts": "file:../packages/contracts" } }
```

npm symlinks the directory into `node_modules`; rebuild it after edits with
`npm run build` from this folder (service `pre*` hooks should do this
automatically).

## Development

```sh
npm install   # install dev dependencies
npm test      # run the package's own specs
npm run build # compile dist/ (consumers read dist/)
```
