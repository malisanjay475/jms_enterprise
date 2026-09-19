#!/bin/sh
set -e
cd /app

# Fix ownership of any Docker-mounted volumes that may be owned by root.
# The named volumes are created by Docker as root; the jms user needs write access.
chown -R jms:jms /app/PUBLIC/uploads 2>/dev/null || true
# qc-app holds the published Android APK + version.json (CI auto-publish writes here).
# Without this the jms user can't write to the root-owned volume → publish 500s.
mkdir -p /app/PUBLIC/qc-app 2>/dev/null || true
chown -R jms:jms /app/PUBLIC/qc-app 2>/dev/null || true

node scripts/wait-for-postgres.js
node scripts/auto-import-db-if-needed.js

# Drop from root to the non-root jms user for the actual server process.
exec su-exec jms "$@"
