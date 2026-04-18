#!/bin/sh
set -e
cd /app

node scripts/wait-for-postgres.js
node scripts/auto-import-db-if-needed.js

exec "$@"
