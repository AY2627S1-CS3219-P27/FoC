# syntax=docker/dockerfile:1
FROM node:22-alpine AS dependencies

WORKDIR /usr/src/app
ARG NPM_VERSION=11.18.0
RUN npm install --global "npm@${NPM_VERSION}"

COPY packages/contracts/package*.json /usr/src/packages/contracts/
COPY packages/auth/package*.json /usr/src/packages/auth/
COPY packages/observability/package*.json /usr/src/packages/observability/
COPY comms-service/package*.json ./
RUN npm ci

FROM dependencies AS development
COPY packages/contracts/src/ /usr/src/packages/contracts/src/
COPY packages/contracts/tsconfig*.json /usr/src/packages/contracts/
COPY packages/auth/src/ /usr/src/packages/auth/src/
COPY packages/auth/tsconfig*.json /usr/src/packages/auth/
COPY packages/observability/src/ /usr/src/packages/observability/src/
COPY packages/observability/tsconfig*.json /usr/src/packages/observability/
COPY comms-service/ ./
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM dependencies AS build
COPY packages/contracts/src/ /usr/src/packages/contracts/src/
COPY packages/contracts/tsconfig*.json /usr/src/packages/contracts/
COPY packages/auth/src/ /usr/src/packages/auth/src/
COPY packages/auth/tsconfig*.json /usr/src/packages/auth/
COPY packages/observability/src/ /usr/src/packages/observability/src/
COPY packages/observability/tsconfig*.json /usr/src/packages/observability/
COPY comms-service/ ./
RUN npm run build
RUN npm prune --omit=dev
RUN npm prune --omit=dev --prefix /usr/src/packages/contracts
# prune re-symlinks @foc/auth and @foc/observability; re-copy them so they share the app's @nestjs/core
RUN NPM_CONFIG_OMIT=dev npm run auth:link && NPM_CONFIG_OMIT=dev npm run obs:link

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=build --chown=node:node /usr/src/app/package*.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=build --chown=node:node /usr/src/packages/contracts/package*.json /usr/src/packages/contracts/
COPY --from=build --chown=node:node /usr/src/packages/contracts/node_modules /usr/src/packages/contracts/node_modules
COPY --from=build --chown=node:node /usr/src/packages/contracts/dist /usr/src/packages/contracts/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health/ready" || exit 1
# node as PID 1 receives SIGTERM directly, so shutdown hooks run
CMD ["node", "dist/main"]
