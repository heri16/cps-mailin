FROM node:slim

RUN apt-get update && apt-get install -qy \
 curl \
 git

# Run `npm install` BEFORE adding the application directory structure
# to /app on the container's filesystem.
COPY package.json /app/package.json

WORKDIR /app
RUN ["/bin/bash", "-l", "-c", "npm install"]

# Add the application directory structure to /app on the container's filesystem
ADD . /app

# Open port 3000 on the container
EXPOSE 3000

# Overridable startup commands
CMD ["npm", "start"]
