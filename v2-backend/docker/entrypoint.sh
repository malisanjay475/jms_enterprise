#!/bin/sh
set -e
if [ "${SKIP_PRISMA_PUSH:-0}" != "1" ]; then
  npx prisma db push
fi
exec node dist/main.js
