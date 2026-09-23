# Storing Redis Lua scripts as raw Lua files

## Decision

The user service shall store its Redis Lua scripts as raw `.lua` files on disk
rather than as TypeScript template literals, and load them at runtime.

## Rationale

Lua scripts used for redis should be treated as first-class code-citizens.
Putting them in a script gives devs editor & language support, signaling that
this is an artifact that needs consideration too. We also get richer diffs and
reviews.

This is in comparison to the (previous) method of keeping lua scripts as raw
strings within code. This impacted readability, as devs don't get syntax
highlighting/IDE features, as well as ballooning the length of the file that
held the script.

## Consequences

- Scripts are read once at module load; a missing or miscopied asset fails fast
  at startup rather than at request time.
- Editing a script during `start:dev` requires Nest's asset watcher
  (`watchAssets`) to re-copy it into `dist`.
- The Lua files (and the `.luarc.json` config) are committed alongside the
  service, so the tooling setup is shared by every developer.
