#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — LOCAL Server Database Backup
# ============================================================
# Takes a compressed pg_dump of the jms_v1 database inside the
# running Docker container and stores it locally.
# Run via cron every 30 minutes (installed by local-server-setup-cron.sh).
# ============================================================

set -uo pipefail

DB_CONTAINER="${DB_CONTAINER:-jms-enterprise-v1-db-1}"
DB_NAME="${DB_NAME:-jms_v1}"
DB_USER="${DB_USER:-jms_v1}"
BACKUP_DIR="${BACKUP_DIR:-/opt/jms-local-backups}"
MAX_BACKUPS="${MAX_BACKUPS:-48}"   # 48 × 30 min = 24 hours of history

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
BACKUP_FILE="$BACKUP_DIR/jms_v1_${TIMESTAMP}.sql.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$BACKUP_DIR"

# ── Take snapshot ─────────────────────────────────────────────
log "Starting local DB backup → $BACKUP_FILE"
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" 2>/dev/null | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -sh "$BACKUP_FILE" 2>/dev/null | cut -f1 || echo "?")
  log "✅ Backup complete: $BACKUP_FILE ($SIZE)"
else
  log "❌ Backup FAILED for container=$DB_CONTAINER"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# ── Rotate old backups ────────────────────────────────────────
COUNT=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l || echo 0)
if [ "$COUNT" -gt "$MAX_BACKUPS" ]; then
  TO_DELETE=$((COUNT - MAX_BACKUPS))
  log "Rotating: removing $TO_DELETE old backup(s) (keeping $MAX_BACKUPS)..."
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n "$TO_DELETE" | xargs rm -f
fi

# ── Disk warning ──────────────────────────────────────────────
DISK_USED=$(df "$BACKUP_DIR" | awk 'NR==2{print $5}' | tr -d '%' || echo 0)
if [ "$DISK_USED" -gt 85 ]; then
  log "⚠️  DISK WARNING: $DISK_USED% used on backup partition!"
fi

log "Backup dir stats: $(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l) files, disk ${DISK_USED}% used"
