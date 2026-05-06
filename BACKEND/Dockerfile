# Base Image
FROM node:20-alpine

# pg_restore / psql / dropdb for optional AUTO_IMPORT_DB_PATH (see scripts/auto-import-db-if-needed.js)
RUN apk add --no-cache postgresql-client

# Working Directory
WORKDIR /app

# Install Dependencies
COPY package*.json ./
RUN npm install --production

# Copy server.js first so edits invalidate cache (avoids stale COPY . . layers on rebuild)
COPY server.js ./server.js

# Copy remaining source
COPY . .

RUN chmod +x /app/docker-entrypoint.sh

# Run as non-root user for security
RUN addgroup -S jms && adduser -S jms -G jms && chown -R jms:jms /app
USER jms

# Environment Variables (Defaults)
ENV PORT=3000
ENV NODE_ENV=production

# Expose Port
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
