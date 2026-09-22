# syntax=docker/dockerfile:1

# Shared dependency stage using the project's Node major version
FROM node:22-alpine AS dependencies

# Set the working directory inside the container
WORKDIR /usr/src/app

# Match the npm version used to generate package-lock.json
ARG NPM_VERSION=11.18.0
RUN npm install --global "npm@${NPM_VERSION}"

# The build context is the repository root so canonical contracts are
# available without relying on host-generated files.
COPY credit-service/package*.json ./

# Install the exact dependency versions from package-lock.json
RUN npm ci

# Development image with source code and watch mode
FROM dependencies AS development

COPY credit-service/ .
COPY contracts/schemas/ /usr/src/contracts/schemas/

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

# Build the application and remove development dependencies
FROM dependencies AS build

COPY credit-service/ .
COPY contracts/schemas/ /usr/src/contracts/schemas/

RUN npm run build
RUN npm prune --omit=dev

# Minimal production image
FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /usr/src/app

# Copy only runtime files and assign them to the non-root user
COPY --from=build --chown=node:node /usr/src/app/package.json ./
COPY --from=build --chown=node:node /usr/src/app/package-lock.json ./
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist

# Run the application without root permissions
USER node

# Expose the application port
EXPOSE 3000

# Check the temporary root endpoint until a dedicated health route is added
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/" || exit 1

CMD ["npm", "run", "start:prod"]
