# Development docker image

# Use node lts
FROM node:lts

# Set the working directory inside the container
WORKDIR /usr/src/app

# The build context is the repository root so the local @foc/contracts
# dependency is available without relying on host-generated files.
COPY packages/contracts/package*.json /usr/src/packages/contracts/

# Copy the application manifests and install dependencies. The file:
# dependency resolves to ../packages/contracts and postinstall installs the
# contract package's own dev-dependencies in place.
COPY user-service/package*.json ./
RUN npm install

# Copy the contract package sources and the rest of the application files
COPY packages/contracts/ /usr/src/packages/contracts/
COPY user-service/ .

# Build the NestJS application (prebuild rebuilds the contract package from
# its sources).
RUN npm run build

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/main.js"]