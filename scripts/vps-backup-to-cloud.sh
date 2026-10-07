#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — VPS Backup to Cloud (Google Drive via rclone)
# ============================================================
# Runs on the VPS. Called by .github/workflows/scheduled-backup.yml over SSH.
#   bash scripts/vps-backup-to-cloud.sh
# Steps: pg_dump+gzip, tar uploads, rotate, rclone->Google Drive (if set), disk check.
# Exit 0 = DB backup created (and on Drive, if configured). Exit 1 = DB backup or its
# Drive upload FAILED (workflow alerts). Uploaded-files copies are best-effort.
# One-time VPS setup (docs/OPS-SETUP.md): install rclone, `rclone config` remote "gdrive".
# ============================================================
set -uo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/jms-backups}"
DB_CONTAINER="${DB_CONTAINER:-jms-enterprise-v1-db-1}"
APP_CONTAINER="${APP_CONTAINER:-jms-enterprise-v1-app-1}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_DEST="${RCLONE_DEST:-JMS-Backups}"
KEEP_DB_DUMPS="${KEEP_DB_DUMPS:-28}"   # 7 days at 4/day (Drive keeps 35 days)
KEEP_UPLOAD_TARS="${KEEP_UPLOAD_TARS:-4}"   # ~1.3 GB each; Drive keeps 35 days
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

DB_OFFSITE="skipped"
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:"; then
  M="$(date +%Y-%m)"
  # Drive upload order = priority: DB dump (must) -> daily full uploads archive
  # -> incremental uploaded-files mirror (nice to have). Every step is
  # time-boxed so the whole run always finishes inside the workflow's SSH
  # timeout; before this, a slow or rate-limited mirror sync (Drive 403
  # rateLimitExceeded) was killed at 60 min and the run failed even though the
  # DB copy was already on Drive.
  # --drive-chunk-size 64M: 8x fewer upload requests than the default 8M.
  # Fewer low-level retries: a rate-limited file fails fast and is retried
  # next run instead of backing off for many minutes.
  RC_FLAGS="--transfers 1 --tpslimit 4 --drive-chunk-size 64M --retries 3 --low-level-retries 4 --stats 0"
  [ "${RCLONE_BWLIMIT}" != "0" ] && RC_FLAGS="$RC_FLAGS --bwlimit ${RCLONE_BWLIMIT}"
  if rclone config show "$RCLONE_REMOTE" 2>/dev/null | grep -Eq '^client_id *= *[^ ]'; then :; else
    echo "[backup][WARN] rclone remote '${RCLONE_REMOTE}' uses rclone's SHARED Google client ID, which is rate-limited across all rclone users (403 rateLimitExceeded, very slow uploads). Set up your own client ID: docs/OPS-SETUP.md section 1b." >&2
  fi
  log "Uploading to Google Drive (${RCLONE_REMOTE}:${RCLONE_DEST}, bwlimit=${RCLONE_BWLIMIT})..."

  if $LOWPRIO timeout "${DB_UPLOAD_TIMEOUT:-20m}" rclone copy "$DB_FILE" "${RCLONE_REMOTE}:${RCLONE_DEST}/db/${M}/" --no-traverse $RC_FLAGS 2>&1; then
    DB_OFFSITE="ok"; log "Drive: DB uploaded."
  else
    DB_OFFSITE="failed"; log "WARN: Drive DB upload failed."
  fi

  if [ -f "$UP_FILE" ]; then
    # The full archive (~3.4 GB in Oct-2026) goes up once a day (re-sending it every 6h timed
    # out the job). If it fails or runs out of time it is retried next run.
    TODAY="$(date +%Y-%m-%d)"; FULL_MARK="$BACKUP_ROOT/.last-full-uploads-drive"
    if [ "$(cat "$FULL_MARK" 2>/dev/null)" != "$TODAY" ]; then
      if $LOWPRIO timeout "${FULL_UPLOAD_TIMEOUT:-25m}" rclone copy "$UP_FILE" "${RCLONE_REMOTE}:${RCLONE_DEST}/uploads/${M}/" --no-traverse $RC_FLAGS 2>&1; then
        echo "$TODAY" > "$FULL_MARK"; log "Drive: full uploads archive uploaded (daily)."
      else log "WARN: Drive full uploads archive failed or ran out of time (retries next run)."; fi
    else log "Drive: full uploads archive already sent today — skipped."; fi

    # Uploaded files are also mirrored one by one (only new/changed files) so a
    # single photo can be restored without the full archive. Thumbnail caches
    # are skipped: the app rebuilds them and they are thousands of tiny files
    # that burn Drive's request quota. --max-duration + soft cutoff stops
    # starting new files when time is up; the rest go up next run.
    MIRROR_DIR="$BACKUP_ROOT/uploads-mirror"
    mkdir -p "$MIRROR_DIR"
    if $LOWPRIO tar -xzf "$UP_FILE" -C "$MIRROR_DIR" 2>/dev/null; then
      MIRROR_MIN="${MIRROR_MAX_MIN:-15}"
      MIRROR_FLAGS="--fast-list --max-duration ${MIRROR_MIN}m --cutoff-mode soft --log-level ERROR"
      if $LOWPRIO timeout "$((MIRROR_MIN + 5))m" rclone copy "$MIRROR_DIR/uploads" "${RCLONE_REMOTE}:${RCLONE_DEST}/uploads-files/" \
           $RC_FLAGS $MIRROR_FLAGS --exclude "/thumbs/**" --exclude ".thumbs/**" 2>&1 | tail -n 20; then
        log "Drive: uploaded-files mirror synced (or partly, if time ran out — continues next run)."
      else log "WARN: Drive uploaded-files mirror sync incomplete (continues next run)."; fi
    else log "WARN: could not unpack uploads archive for incremental sync."; fi
  fi
  # Retention: delete for real instead of moving to Drive's trash (trash
  # counts against storage and had grown past 1 TiB).
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}/db"      --min-age 35d --drive-use-trash=false 2>/dev/null || true
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}/uploads" --min-age 35d --drive-use-trash=false 2>/dev/null || true   # daily archives only; uploads-files/ is kept
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
log "DONE. Latest: $(basename "$DB_FILE") | Drive DB copy: ${DB_OFFSITE} | Disk: ${DISK_PCT:-?}%"
# The DB dump is the backup that matters: if it did not reach Drive there is no
# fresh offsite copy, so fail the run (the workflow emails an alert). Uploaded
# files are best-effort and only warn.
[ "$DB_OFFSITE" = "failed" ] && fail "DB dump is saved on the VPS but did NOT reach Google Drive."
exit 0
