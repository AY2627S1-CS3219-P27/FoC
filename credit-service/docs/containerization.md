# Containerization for credit service

## Decision

The credit service shall use Docker with a multi-stage Node.js 22 Alpine image
and a service-local Docker Compose environment.

## Rationale

Node.js 22 keeps the runtime on a stable major version, while Alpine reduces
the image size. npm 11.18.0 is pinned to match the version used to generate
the lockfile and ensure reproducible dependency installation.

The dependency stage installs packages once and is reused by the development
and build stages. The build stage compiles the service and removes development
dependencies. The production stage copies only the compiled application and
runtime dependencies, then runs as a non-root user.

```
node:22-alpine
     │
dependencies
     ├──> development  (Isolated branch)
     │
     └──> build        (Isolated branch)
            │
            └──> production  (Copies artifacts from 'build')
```

Docker Compose provides the development service and PostgreSQL 18 with health
checks, secret-based password handling, and persistent database storage.
