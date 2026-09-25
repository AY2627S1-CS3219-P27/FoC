# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies

WORKDIR /usr/src/app

ARG NPM_VERSION=11.18.0
RUN npm install --global "npm@${NPM_VERSION}"

COPY package*.json ./

RUN npm ci

FROM dependencies AS development

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

FROM dependencies AS build

COPY . .

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/package.json ./
COPY --from=build --chown=node:node /usr/src/app/package-lock.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/" || exit 1

CMD ["npm", "run", "start:prod"]
