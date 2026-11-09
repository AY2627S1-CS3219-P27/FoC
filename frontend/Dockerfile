FROM node:lts-alpine AS dependencies

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

# Development image with source code and hot reload
FROM dependencies AS development

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM dependencies AS build

# next.config.ts rewrites are resolved at build time, so set the service URLs here
ARG USER_SERVICE_URL=http://user-service:3000
ARG SUPPLIER_SERVICE_URL=http://supplier-service:3000
ARG CREDIT_SERVICE_URL=http://credit-service:3000
ARG ORDER_SERVICE_URL=http://order-service:3000
ARG NOTIFICATION_SERVICE_URL=http://notification-service:3000
ARG COMMS_SERVICE_URL=http://comms-service:3000
ARG SOCKET_PATH=/socket.io

COPY . .
RUN npm run build

# Minimal production image running the standalone server
FROM node:lts-alpine AS production

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/.next/standalone ./
COPY --from=build --chown=node:node /usr/src/app/.next/static ./.next/static
COPY --from=build --chown=node:node /usr/src/app/public ./public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
