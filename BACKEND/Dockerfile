# Base Image
FROM node:20-alpine

# pg_restore / psql / dropdb for optional AUTO_IMPORT_DB_PATH (see scripts/auto-import-db-if-needed.js)
# tzdata: Alpine has no timezone database; without it Node's local-time methods
# (getHours/getDate/etc.) fall back to UTC, which makes "today"/shift-date logic
# show the previous day on a UTC host. The factory runs in IST (Asia/Kolkata).
RUN apk add --no-cache postgresql-client su-exec tzdata gzip

# Install PM2 globally so it is available on $PATH for all users
RUN npm install -g pm2@5

# Working Directory
WORKDIR /app

# Install Dependencies
COPY package*.json ./
RUN npm install --production

# Copy server.js first so edits invalidate cache (avoids stale COPY . . layers on rebuild)
COPY server.js ./server.js

# Copy remaining source (includes ecosystem.config.js)
COPY . .

# Pre-compress static JS/CSS to Brotli (.br) + Gzip (.gz) so the app serves them
# directly (see src/app/precompressedStatic.js) without re-compressing per request.
# Also keep .html gzipped for Nginx gzip_static on MAIN.
RUN node scripts/minify-assets.js PUBLIC/assets \
 && node scripts/precompress-assets.js PUBLIC \
 && find PUBLIC -type f -name "*.html" -exec gzip -9 -k {} \;

RUN chmod +x /app/docker-entrypoint.sh

# Create non-root user; entrypoint will drop privileges via su-exec after fixing volume ownership.
RUN addgroup -S jms && adduser -S jms -G jms && chown -R jms:jms /app

# Environment Variables (Defaults)
ENV PORT=3000
ENV NODE_ENV=production
# Default to India Standard Time so shift/date logic matches the factory floor
# (the LOCAL factory server already runs in IST). Can be overridden via compose.
ENV TZ=Asia/Kolkata

# Expose Port
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
# PM2 cluster: one worker per CPU core, logs to stdout so Docker captures them.
# Falls back gracefully — if ecosystem.config.js is missing it logs a warning and
# runs node server.js directly (useful for local dev without PM2).
CMD ["pm2-runtime", "ecosystem.config.js"]
