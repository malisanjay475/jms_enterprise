# Base Image
FROM node:18-alpine

# Working Directory
WORKDIR /app

# Install Dependencies
COPY package*.json ./
RUN npm install --production

# Copy Source Code
COPY . .

# Environment Variables (Defaults)
ENV PORT=3000
ENV NODE_ENV=production

# Expose Port
EXPOSE 3000

# Start Command (Use PM2 for process management inside container if preferred, or just node)
CMD ["node", "server.js"]
