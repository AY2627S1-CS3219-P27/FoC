# Development docker image

# Use node lts
FROM node:lts

# Set the working directory inside the container
WORKDIR /usr/src/app

# The build context is the repository root so the local @foc/contracts and
# @foc/auth dependencies are available without relying on host-generated
# files.
COPY packages/contracts/package*.json /usr/src/packages/contracts/
COPY packages/auth/package*.json /usr/src/packages/auth/

# Copy the application manifests and install dependencies. The file:
# dependencies resolve to ../packages/* and postinstall installs each shared
# package's own dev-dependencies in place.
COPY user-service/package*.json ./
RUN npm install

# Copy the shared package sources and the rest of the application files.
# prebuild rebuilds the packages from their sources (and repacks @foc/auth
# into this service's node_modules so Nest resolves a single copy).
COPY packages/contracts/ /usr/src/packages/contracts/
COPY packages/auth/ /usr/src/packages/auth/
COPY user-service/ .

# Build the NestJS application
RUN npm run build

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/main.js"]