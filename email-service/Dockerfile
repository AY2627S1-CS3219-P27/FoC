# Development docker image

# Use node lts
FROM node:lts

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy the rest of the application files
COPY . .

# Install the application dependencies
RUN npm install

# Command to run the application
CMD ["node", "app.ts"]
