#!/usr/bin/env bash
# Restore a database dump into the JMS v1 Docker Postgres service (same compose as VPS upload bundle).
#
# Usage (on the VPS, from repo root — folder that contains docker-compose.vps-v1-upload-only.yml and .env):
#   chmod +x scripts/restore-vps-docker-db.sh
#   ./scripts/restore-vps-docker-db.sh /path/to/backup.dump          # custom format (from export-local-postgres.ps1)
#   ./scripts/restore-vps-docker-db.sh /path/to/backup.sql             # plain SQL
#
# Optional env:
#   COMPOSE_PROJECT=jms-enterprise-v1   (default)
#   COMPOSE_FILE=docker-compose.vps-v1-upload-only.yml
#
set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 /path/to/backup.dump   OR   $0 /path/to/backup.sql"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

COMPOSE_PROJECT="${COMPOSE_PROJECT:-jms-enterprise-v1}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps-v1-upload-only.yml}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

DB_USER="${DB_USER:-jms_v1}"
DB_NAME="${DB_NAME:-jms_v1}"
DB_PASSWORD="${DB_PASSWORD:-}"

compose() {
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

echo "[restore] Stopping app (releases DB connections)..."
compose stop app 2>/dev/null || true

echo "[restore] Recreating database $DB_NAME ..."
compose exec -T \
  -e "PGPASSWORD=$DB_PASSWORD" \
  db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$DB_NAME";
CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
SQL

# Custom-format dumps from pg_dump -Fc use extension .dump; plain SQL otherwise.
if [[ "$DUMP" == *.dump ]]; then
  echo "[restore] pg_restore (custom format)..."
  compose exec -T -e "PGPASSWORD=$DB_PASSWORD" db pg_restore \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-acl \
    --verbose \
    < "$DUMP"
else
  echo "[restore] psql (plain SQL)..."
  compose exec -T -e "PGPASSWORD=$DB_PASSWORD" db psql \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 \
    < "$DUMP"
fi

echo "[restore] Starting app..."
compose start app

echo "[restore] Done. If the app was using a different compose project name, set COMPOSE_PROJECT when running this script."
