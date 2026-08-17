#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — VPS Backup to Cloud (Google Drive via rclone)
# ============================================================
# Runs on the VPS. Called by .github/workflows/scheduled-backup.yml over SSH.
#   bash scripts/vps-backup-to-cloud.sh
# Steps: pg_dump+gzip, tar uploads, rotate, rclone->Google Drive (if set), disk check.
# Exit 0 = DB backup created locally. Exit 1 = DB backup FAILED (workflow alerts).
# One-time VPS setup (docs/OPS-SETUP.md): install rclone, `rclone config` remote "gdrive".
# ============================================================
set -uo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/jms-backups}"
DB_CONTAINER="${DB_CONTAINER:-jms-enterprise-v1-db-1}"
APP_CONTAINER="${APP_CONTAINER:-jms-enterprise-v1-app-1}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_DEST="${RCLONE_DEST:-JMS-Backups}"
KEEP_DB_DUMPS="${KEEP_DB_DUMPS:-120}"
KEEP_UPLOAD_TARS="${KEEP_UPLOAD_TARS:-30}"
DISK_WARN_PCT="${DISK_WARN_PCT:-85}"

# --- Throttling: keep the backup from starving the live site --------------
# The dump/gzip/tar/rclone steps compete with the app for CPU, disk I/O, and
# uplink bandwidth, which shows up as site-wide slowness during backup windows.
# Run the heavy host-side work at the lowest CPU + idle I/O priority, and cap
# rclone's upload bandwidth so the VPS uplink stays available for users.
LOWPRIO=""
command -v nice   >/dev/null 2>&1 && LOWPRIO="nice -n 19"
command -v ionice >/dev/null 2>&1 && LOWPRIO="ionice -c3 ${LOWPRIO}"
RCLONE_BWLIMIT="${RCLONE_BWLIMIT:-8M}"   # cap Drive upload (e.g. 8M = 8 MByte/s); set 0 to disable

DUMP_DIR="$BACKUP_ROOT/dumps"; UPLOAD_DIR="$BACKUP_ROOT/uploads"
mkdir -p "$DUMP_DIR" "$UPLOAD_DIR"
TS="$(date +%Y-%m-%d_%H-%M)"
DB_FILE="$DUMP_DIR/jms_db_${TS}.sql.gz"
UP_FILE="$UPLOAD_DIR/jms_uploads_${TS}.tar.gz"

log()  { echo "[backup] $*"; }
fail() { echo "[backup][ERROR] $*" >&2; exit 1; }

log "Dumping database from '$DB_CONTAINER'..."
docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$" || fail "DB container '$DB_CONTAINER' not running."
if docker exec "$DB_CONTAINER" sh -eu -c '
       export PGPASSWORD="$POSTGRES_PASSWORD"
       exec pg_dump -U "$POSTGRES_USER" --no-owner --no-acl "${POSTGRES_DB:-$POSTGRES_USER}"
     ' | $LOWPRIO gzip -6 > "$DB_FILE"; then
  SIZE_KB="$(du -k "$DB_FILE" | cut -f1)"
  [ "${SIZE_KB:-0}" -lt 5 ] && { rm -f "$DB_FILE"; fail "DB dump <5 KB."; }
  log "DB backup OK: $(basename "$DB_FILE") (${SIZE_KB} KB)"
else
  rm -f "$DB_FILE"; fail "pg_dump failed."
fi

log "Archiving uploaded files..."
if docker ps --format '{{.Names}}' | grep -q "^${APP_CONTAINER}$"; then
  if $LOWPRIO docker exec "$APP_CONTAINER" sh -c 'cd /app/PUBLIC && tar -czf - uploads 2>/dev/null' > "$UP_FILE" 2>/dev/null; then
    log "Uploads backup OK: $(basename "$UP_FILE") ($(du -k "$UP_FILE" | cut -f1) KB)"
  else log "WARN: uploads archive failed."; rm -f "$UP_FILE"; fi
else log "WARN: app container not running — skipping uploads."; fi

rotate() {
  local dir="$1" pat="$2" keep="$3" n
  n="$(find "$dir" -name "$pat" -type f 2>/dev/null | wc -l)"
  if [ "$n" -gt "$keep" ]; then
    find "$dir" -name "$pat" -type f | sort | head -n "$((n - keep))" | while read -r f; do rm -f "$f" && log "Rotated: $(basename "$f")"; done
  fi
}
rotate "$DUMP_DIR" "jms_db_*.sql.gz" "$KEEP_DB_DUMPS"
rotate "$UPLOAD_DIR" "jms_uploads_*.tar.gz" "$KEEP_UPLOAD_TARS"

if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  M="$(date +%Y-%m)"
  # Cap bandwidth + single transfer so the upload doesn't saturate the VPS
  # uplink and slow the live site. RCLONE_BWLIMIT=0 disables the cap.
  RC_FLAGS="--no-traverse --transfers 1 --tpslimit 4"
  [ "${RCLONE_BWLIMIT}" != "0" ] && RC_FLAGS="$RC_FLAGS --bwlimit ${RCLONE_BWLIMIT}"
  log "Uploading to Google Drive (${RCLONE_REMOTE}:${RCLONE_DEST}, bwlimit=${RCLONE_BWLIMIT})..."
  $LOWPRIO rclone copy "$DB_FILE" "${RCLONE_REMOTE}:${RCLONE_DEST}/db/${M}/" $RC_FLAGS 2>&1 && log "Drive: DB uploaded." || log "WARN: Drive DB upload failed."
  [ -f "$UP_FILE" ] && { $LOWPRIO rclone copy "$UP_FILE" "${RCLONE_REMOTE}:${RCLONE_DEST}/uploads/${M}/" $RC_FLAGS 2>&1 && log "Drive: uploads uploaded." || log "WARN: Drive uploads failed."; }
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}/db"      --min-age 35d 2>/dev/null || true
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}/uploads" --min-age 35d 2>/dev/null || true
else
  echo "[backup][OFFSITE-WARNING] rclone remote '${RCLONE_REMOTE}' is NOT configured — the ONLY backup copy lives on this VPS. A disk/VPS loss would lose all backups. Set up the 'gdrive' remote (docs/OPS-SETUP.md)." >&2
  if [ "${STRICT_OFFSITE:-0}" = "1" ]; then
    fail "STRICT_OFFSITE=1 and no offsite remote configured — refusing to report success without an offsite copy."
  fi
  log "NOTE: Google Drive skipped. Local copy only: $DB_FILE"
fi

DISK_PCT="$(df --output=pcent "$BACKUP_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')"
if [ -n "${DISK_PCT:-}" ] && [ "$DISK_PCT" -ge "$DISK_WARN_PCT" ]; then
  echo "[backup][DISK-ALERT] Disk at ${DISK_PCT}% (>= ${DISK_WARN_PCT}%) on $(hostname)" >&2
fi
log "DONE. Latest: $(basename "$DB_FILE") | Disk: ${DISK_PCT:-?}%"
exit 0
