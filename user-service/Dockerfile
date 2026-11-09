# syntax=docker/dockerfile:1

# Shared dependency stage using the project's Node major version (>= 26, per
# package.json engines; user-service relies on the Node 26 crypto.argon2 builtin).
FROM node:26-alpine AS dependencies

# Set the working directory inside the container
WORKDIR /usr/src/app

# The build context is the repository root so the local shared packages are
# available without relying on host-generated files.
COPY packages/contracts/package*.json /usr/src/packages/contracts/
COPY packages/auth/package*.json /usr/src/packages/auth/
COPY packages/outbox/package*.json /usr/src/packages/outbox/
COPY packages/observability/package*.json /usr/src/packages/observability/
COPY user-service/package*.json ./

# Install the exact dependency versions. user-service's postinstall also
# installs the shared packages' build dependencies in their own directories.
RUN npm ci

# Development image with source code and watch mode
FROM dependencies AS development

COPY packages/contracts/src/ /usr/src/packages/contracts/src/
COPY packages/contracts/tsconfig*.json /usr/src/packages/contracts/
COPY packages/auth/src/ /usr/src/packages/auth/src/
COPY packages/auth/tsconfig*.json /usr/src/packages/auth/
COPY packages/outbox/src/ /usr/src/packages/outbox/src/
COPY packages/observability/src/ /usr/src/packages/observability/src/
COPY packages/outbox/tsconfig*.json /usr/src/packages/outbox/
COPY packages/observability/tsconfig*.json /usr/src/packages/observability/
COPY user-service/ .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

# Build the application and remove development dependencies
FROM dependencies AS build

COPY packages/contracts/src/ /usr/src/packages/contracts/src/
COPY packages/contracts/tsconfig*.json /usr/src/packages/contracts/
COPY packages/auth/src/ /usr/src/packages/auth/src/
COPY packages/auth/tsconfig*.json /usr/src/packages/auth/
COPY packages/outbox/src/ /usr/src/packages/outbox/src/
COPY packages/observability/src/ /usr/src/packages/observability/src/
COPY packages/outbox/tsconfig*.json /usr/src/packages/outbox/
COPY packages/observability/tsconfig*.json /usr/src/packages/observability/
COPY user-service/ .

RUN npm run build
RUN npm prune --omit=dev
RUN npm prune --omit=dev --prefix /usr/src/packages/contracts

# prune re-symlinks @foc/auth, @foc/outbox and @foc/observability; re-copy them so they share
# the app's @nestjs/core and their own runtime deps (e.g. OpenTelemetry) are hoisted in too
RUN NPM_CONFIG_OMIT=dev npm run auth:link && NPM_CONFIG_OMIT=dev npm run outbox:link && NPM_CONFIG_OMIT=dev npm run obs:link

# Minimal production image
FROM node:26-alpine AS production

ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy only runtime files and assign them to the non-root user
COPY --from=build --chown=node:node /usr/src/app/package.json ./
COPY --from=build --chown=node:node /usr/src/app/package-lock.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=build --chown=node:node /usr/src/packages/contracts/package*.json /usr/src/packages/contracts/
COPY --from=build --chown=node:node /usr/src/packages/contracts/node_modules /usr/src/packages/contracts/node_modules
COPY --from=build --chown=node:node /usr/src/packages/contracts/dist /usr/src/packages/contracts/dist

# Run the application without root permissions
USER node

# Expose the application port
EXPOSE 3000

# Healthy only while the database answers: without it every request, OTP and
# audit write fails.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# node as PID 1 receives SIGTERM directly, so shutdown hooks run
CMD ["node", "dist/main"]
