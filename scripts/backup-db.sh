#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — Manual / Cron DB Backup Script
# ============================================================
# Usage:
#   ./scripts/backup-db.sh                  — backup now
#   ./scripts/backup-db.sh restore <file>   — restore from .sql.gz file
#   ./scripts/backup-db.sh list             — list available backups
#
# The app's backupService.js runs automatically every 5 minutes.
# Use this script for manual operations or cron scheduling.
# ============================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/jms-backups}"
MAX_BACKUPS="${MAX_BACKUPS:-288}"   # 288 × 5 min = 24 hours via cron
DB_CONTAINER="${DB_CONTAINER:-jms_db}"
APP_CONTAINER="${APP_CONTAINER:-jms_app}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-jms_v1}"
DB_NAME="${DB_NAME:-jms_v1}"
PGPASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"
export PGPASSWORD

mkdir -p "$BACKUP_DIR/wal"
mkdir -p "$BACKUP_DIR/dumps"

timestamp() { date +"%Y-%m-%d_%H-%M"; }

# ---- BACKUP ----
do_backup() {
  local ts
  ts=$(timestamp)
  local out="$BACKUP_DIR/dumps/backup_${ts}.sql.gz"

  echo "[Backup] Starting: $out"

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${DB_CONTAINER}$"; then
    # Prefer running inside the db container (no port exposure needed)
    docker exec "$DB_CONTAINER" \
      pg_dump -U "$DB_USER" --no-password --no-owner --no-acl "$DB_NAME" \
      | gzip -6 > "$out"
  else
    # Fallback: connect via TCP (requires pg_dump on host)
    pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --no-owner --no-acl "$DB_NAME" \
      | gzip -6 > "$out"
  fi

  local kb
  kb=$(du -k "$out" | cut -f1)
  echo "[Backup] Saved: $(basename "$out") (${kb} KB)"

  rotate_backups
}

# ---- ROTATE ----
rotate_backups() {
  local count
  count=$(find "$BACKUP_DIR/dumps" -name "backup_*.sql.gz" | wc -l)
  if [ "$count" -gt "$MAX_BACKUPS" ]; then
    local to_delete=$(( count - MAX_BACKUPS ))
    find "$BACKUP_DIR/dumps" -name "backup_*.sql.gz" \
      | sort \
      | head -n "$to_delete" \
      | while read -r f; do
          rm -f "$f"
          echo "[Backup] Rotated: $(basename "$f")"
        done
  fi
}

# ---- RESTORE ----
do_restore() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    echo "ERROR: Provide backup file path. e.g.: $0 restore /var/jms-backups/dumps/backup_2025-01-01_12-00.sql.gz"
    exit 1
  fi

  if [ ! -f "$file" ]; then
    echo "ERROR: File not found: $file"
    exit 1
  fi

  echo "============================================================"
  echo "  RESTORE from: $file"
  echo "  Database:      $DB_NAME"
  echo "  This will REPLACE all data in $DB_NAME."
  echo "============================================================"
  read -rp "  Type YES to confirm: " confirm
  if [ "$confirm" != "YES" ]; then echo "Aborted."; exit 0; fi

  echo "[Restore] Stopping app container..."
  docker stop "$APP_CONTAINER" 2>/dev/null || true

  echo "[Restore] Dropping and recreating database..."
  docker exec "$DB_CONTAINER" \
    psql -U "$DB_USER" postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
  docker exec "$DB_CONTAINER" \
    psql -U "$DB_USER" postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

  echo "[Restore] Loading backup..."
  gunzip -c "$file" | docker exec -i "$DB_CONTAINER" \
    psql -U "$DB_USER" "$DB_NAME"

  echo "[Restore] Starting app container..."
  docker start "$APP_CONTAINER" 2>/dev/null || true

  echo "[Restore] Done. Database restored from: $(basename "$file")"
}

# ---- LIST ----
do_list() {
  echo "Available backups in $BACKUP_DIR/dumps:"
  if [ -d "$BACKUP_DIR/dumps" ]; then
    find "$BACKUP_DIR/dumps" -name "backup_*.sql.gz" | sort -r | head -20 | while read -r f; do
      local kb
      kb=$(du -k "$f" | cut -f1)
      echo "  $(basename "$f")  (${kb} KB)"
    done
  else
    echo "  (no backups found)"
  fi
}

# ---- DISPATCH ----
case "${1:-backup}" in
  backup)  do_backup ;;
  restore) do_restore "${2:-}" ;;
  list)    do_list ;;
  *)
    echo "Usage: $0 [backup|restore <file>|list]"
    exit 1
    ;;
esac
