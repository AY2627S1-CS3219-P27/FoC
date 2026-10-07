# Development docker image

# Use node lts
FROM node:lts

# Set the working directory inside the container
WORKDIR /usr/src/app

COPY package*.json ./

# Install the application dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Command to run the application
CMD ["node", "app.ts"]
