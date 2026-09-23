# Containerize Credit Service

## Context

Credit Service needs reproducible development and production environments for
its NestJS application, PostgreSQL database, and RabbitMQ broker. Its production
image should contain only runtime dependencies and compiled artifacts, while
local development must support source watching and service dependencies.

The build also needs access to canonical event schemas stored at the repository
root while producing a deployment artifact that has no runtime dependency on
the monorepo.

## Decision

Credit Service uses Docker with a multi-stage Node.js 22 Alpine Dockerfile and a
service-local Docker Compose configuration.

The Dockerfile provides separate dependency, development, build, and production
stages. npm 11.18.0 is pinned to match the package lockfile. The production
stage copies only the compiled application, production dependencies, and
service-owned runtime files, and runs as the non-root `node` user.

The repository root is the Docker build context so the build stage can copy the
canonical contracts selected by Credit Service. The final image contains only
the synchronized contract copies bundled into `dist`.

Docker Compose provides the development service and its PostgreSQL and
RabbitMQ dependencies, including health checks, secret-based database
credentials, persistent development data, and isolated test profiles.

## Rationale

Docker and Docker Compose are established industry tools for packaging services
and reproducing multi-container environments. They provide the same Node.js
major version and native runtime environment across developer machines and
deployment targets.

The multi-stage build follows common Node.js production practice: dependency
installation is cached, NestJS compilation occurs outside the runtime image,
development dependencies are removed, and the final process runs without root
privileges. Alpine reduces the base-image footprint while remaining compatible
with the service's JavaScript dependencies.

NestJS compiles cleanly into a standalone `dist` tree, which fits this image
model. A repository-root build context also works with the centralized contract
schema decision without turning those schemas into a shared runtime package.

## Consequences

- Production deployments receive a self-contained image with compiled code,
  runtime dependencies, and the schemas Credit Service uses.
- Local development can start the application, PostgreSQL, and RabbitMQ with a
  single Compose project.
- Docker builds must use the repository root as their context.
- Image builds depend on the pinned Node.js and npm versions and must be updated
  deliberately when those versions change.
- Alpine's smaller footprint may require compatibility review if a future
  dependency introduces native system-library requirements.
- Development and test Compose resources require explicit cleanup when they are
  no longer needed.
