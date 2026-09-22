# Shared contracts

This directory is the canonical source for contracts shared between Friend on
Campus services. Versioned JSON Schemas live under `schemas/`.

Services must explicitly select the contracts they publish or consume and copy
those schemas into their own build artifacts. A deployed service must remain
self-contained and must not read contracts from the repository root at
runtime.

Schema filenames and routing keys carry the contract version. An incompatible
wire-format change requires a new schema and routing-key version; an existing
version must not be changed incompatibly after adoption.
