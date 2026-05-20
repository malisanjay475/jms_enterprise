#!/bin/sh
set -e
cd /app

# Fix ownership of any Docker-mounted volumes that may be owned by root.
# The named volume for uploads is created by Docker as root; the jms user needs write access.
chown -R jms:jms /app/PUBLIC/uploads 2>/dev/null || true

node scripts/wait-for-postgres.js
node scripts/auto-import-db-if-needed.js

# Drop from root to the non-root jms user for the actual server process.
exec su-exec jms "$@"
