#!/bin/sh
set -e
if [ "${SKIP_PRISMA_PUSH:-0}" != "1" ]; then
  echo "Applying Prisma schema (retries until Postgres accepts connections)..."
  i=0
  until npx prisma db push; do
    i=$((i + 1))
    if [ "$i" -ge 90 ]; then
      echo "prisma db push failed after $i attempts"
      exit 1
    fi
    sleep 2
  done
fi
exec node dist/main.js
