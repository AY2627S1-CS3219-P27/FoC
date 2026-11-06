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

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=build --chown=node:node /usr/src/app/package*.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=build --chown=node:node /usr/src/packages/contracts/package*.json /usr/src/packages/contracts/
COPY --from=build --chown=node:node /usr/src/packages/contracts/node_modules /usr/src/packages/contracts/node_modules
COPY --from=build --chown=node:node /usr/src/packages/contracts/dist /usr/src/packages/contracts/dist
COPY --from=build --chown=node:node /usr/src/packages/auth/package*.json /usr/src/packages/auth/
COPY --from=build --chown=node:node /usr/src/packages/auth/node_modules /usr/src/packages/auth/node_modules
COPY --from=build --chown=node:node /usr/src/packages/auth/dist /usr/src/packages/auth/dist
COPY --from=build --chown=node:node /usr/src/packages/observability/package*.json /usr/src/packages/observability/
COPY --from=build --chown=node:node /usr/src/packages/observability/node_modules /usr/src/packages/observability/node_modules
COPY --from=build --chown=node:node /usr/src/packages/observability/dist /usr/src/packages/observability/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/health/ready" || exit 1
CMD ["npm", "run", "start:prod"]
