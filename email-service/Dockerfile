FROM node:lts-alpine AS dependencies

WORKDIR /usr/src/app

COPY package*.json ./

# Development image with all dependencies and source code
FROM dependencies AS development

RUN npm ci

COPY . .

CMD ["node", "app.ts"]

# Minimal production image: runtime dependencies and source only (Node runs the .ts directly)
FROM dependencies AS production

ENV NODE_ENV=production

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node app.ts ./
COPY --chown=node:node handlers/ ./handlers/
COPY --chown=node:node utils/ ./utils/
RUN find . -path ./node_modules -prune -o -name '*.spec.ts' -exec rm {} +

USER node

# A queue worker with no HTTP port: no HEALTHCHECK; the restart policy handles crashes.
CMD ["node", "app.ts"]
