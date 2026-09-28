# syntax=docker/dockerfile:1

# Built from the repository root (see compose.yml), as in user-service, so the
# shared @foc/contracts and @foc/auth packages in packages/ are available. The
# root .dockerignore keeps node_modules, secrets, .env files and data out.

FROM node:22-alpine AS dependencies

WORKDIR /usr/src/app

ARG NPM_VERSION=11.18.0
RUN npm install --global "npm@${NPM_VERSION}"

# The file: dependencies resolve to ../packages/*, and postinstall installs
# each shared package's own dependencies in place. `npm install`, not
# `npm ci`, as in user-service: auth:link records @foc/auth in the lockfile as
# a packed copy, which `npm ci` rejects as out of sync.
COPY packages/contracts/package*.json /usr/src/packages/contracts/
COPY packages/auth/package*.json /usr/src/packages/auth/
COPY supplier-service/package*.json ./

RUN npm install --no-audit --no-fund

COPY packages/contracts/ /usr/src/packages/contracts/
COPY packages/auth/ /usr/src/packages/auth/

FROM dependencies AS development

COPY supplier-service/ .

EXPOSE 3000

# prestart:dev rebuilds the shared packages and repacks @foc/auth.
CMD ["npm", "run", "start:dev"]

FROM dependencies AS build

COPY supplier-service/ .

# prebuild rebuilds the shared packages and repacks @foc/auth into this
# service's node_modules, so Nest resolves a single copy of itself.
RUN npm run build
# Pruning turns @foc/auth back into a symlink to packages/auth (a second copy
# of Nest), so repack it afterwards, production dependencies only.
RUN npm prune --omit=dev \
  && rm -rf node_modules/@foc/auth \
  && npm install --install-links --omit=dev --no-audit --no-fund ../packages/auth

FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/package.json ./
COPY --from=build --chown=node:node /usr/src/app/package-lock.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist

USER node

EXPOSE 3000

# /health is the only route that does not require an access token.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["npm", "run", "start:prod"]
