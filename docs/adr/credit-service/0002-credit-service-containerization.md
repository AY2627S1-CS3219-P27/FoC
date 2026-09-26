# Containerize Credit Service

## Context

Credit Service needs reproducible development and production environments for
its NestJS application, PostgreSQL database, and RabbitMQ connectivity. Its production
image should contain only runtime dependencies and compiled artifacts, while
local development must support source watching and service dependencies.

The build also needs access to the repository-local `@foc/contracts` package
while producing a deployment artifact that has no runtime dependency on the
monorepo checkout.

## Decision

Credit Service uses Docker with a multi-stage Node.js 22 Alpine Dockerfile and
participates in the root Docker Compose stack.

The Dockerfile provides separate dependency, development, build, and production
stages. npm 11.18.0 is pinned to match the package lockfile. The production
stage copies only the compiled application, production dependencies, and
service-owned runtime files, and runs as the non-root `node` user.

The repository root is the Docker build context so the image can install and
build `@foc/contracts`. The final image preserves the local dependency's path
and contains its compiled output and production dependencies alongside the
Credit Service application.

Docker Compose provides the development service and PostgreSQL dependency. The
normal runtime uses the root `/foc` RabbitMQ broker with a service-specific
password secret. Service-local RabbitMQ containers exist only in isolated test
and recovery profiles.

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
model. A repository-root build context allows the service to build the shared
contract package from source while still producing a self-contained image.

## Consequences

- Production deployments receive a self-contained image with compiled service
  code and the built contract package's schemas, validator, and runtime
  dependencies.
- Local development starts the application, PostgreSQL, and shared RabbitMQ
  broker from the root Compose project.
- Docker builds must use the repository root as their context.
- Image builds depend on the pinned Node.js and npm versions and must be updated
  deliberately when those versions change.
- Alpine's smaller footprint may require compatibility review if a future
  dependency introduces native system-library requirements.
- Test-only RabbitMQ resources remain isolated from the shared development
  broker and require explicit cleanup.
