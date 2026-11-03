# Development docker image

# Use node lts
FROM node:lts

# Set the working directory inside the container
WORKDIR /usr/src/app

# The build context is the repository root so the local @foc/observability
# dependency is available without relying on host-generated files.
COPY notification-service/package*.json ./
COPY packages/observability/ /usr/src/packages/observability/

# Install the application dependencies; the postinstall hook also installs the
# shared package's build dependencies in its own directory.
RUN npm install

# Copy the rest of the application files
COPY notification-service/ ./

# Build the shared observability package and link it into node_modules. The
# app itself has no build step: node runs its TypeScript directly.
RUN npm run obs:build && npm run obs:link

# Command to run the application
CMD ["node", "app.ts"]
