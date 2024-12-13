# Use an official Node.js runtime as a parent image
FROM node:16

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Copy FFmpeg binary to the correct path
ADD https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-i686-static.tar.xz /usr/src/app/
RUN tar -xvf ffmpeg-release-i686-static.tar.xz
RUN mv /usr/src/app/ffmpeg-*/ffmpeg /usr/src/app/ffmpeg.exe

# Expose ports for RTMP and HTTP
EXPOSE 1935 8000

# Start the Node Media Server
CMD [ "node", "app.js" ]
