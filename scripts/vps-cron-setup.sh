#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — VPS backup crontab installer
# ============================================================
# Usage (on the VPS, as root):
#     bash /opt/jms-enterprise/scripts/vps-cron-setup.sh
#
# Safe to re-run: it removes the previous JMS backup block (between the
# markers below, plus the legacy 5-minute lines) and writes the current one.
# The old crontab is saved to /root/crontab.bak.<timestamp> first.
#
# Rollback: crontab /root/crontab.bak.<timestamp>
#
# Schedule
#   - DB dump every 30 min, keep 48 (= 24 h)           -> $BACKUP_DIR/dumps
#   - Uploads archive every hour, keep 2 days           -> $BACKUP_DIR/uploads_*.tar.gz
#     (taken from inside the app container: uploads live in the jms_v1_uploads
#      volume, not in $DEPLOY_PATH/BACKEND/PUBLIC/uploads, which is empty — the
#      old job archived that empty folder every 15 min)
#   - Google Drive sync every 30 min, offset 10 min after the dump
# ============================================================

set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/jms-enterprise}"
BACKUP_DIR="${BACKUP_DIR:-/opt/jms-backups}"
LOG_FILE="/var/log/jms-cron-backup.log"
DB_CONTAINER="${DB_CONTAINER:-jms-enterprise-v1-db-1}"
APP_CONTAINER="${APP_CONTAINER:-jms-enterprise-v1-app-1}"
BEGIN_MARK="# === JMS ENTERPRISE AUTOMATED BACKUPS ==="
END_MARK="# ========================================"

mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d_%H%M%S)
OLD_CRON=$(mktemp)
NEW_CRON=$(mktemp)
trap 'rm -f "$OLD_CRON" "$NEW_CRON"' EXIT

crontab -l > "$OLD_CRON" 2>/dev/null || true
CRON_BAK_DIR="${CRON_BAK_DIR:-/root}"
cp "$OLD_CRON" "$CRON_BAK_DIR/crontab.bak.$TS"
echo "[Cron] Saved current crontab to $CRON_BAK_DIR/crontab.bak.$TS"

# Drop the old JMS block and any stray legacy JMS backup lines, keep everything else.
awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
  $0 == b { skip = 1; next }
  skip && $0 == e { skip = 0; next }
  skip { next }
  /backup-db\.sh|jms-backups\/uploads_|gdrive:JMS-Backups/ { next }
  { print }
' "$OLD_CRON" > "$NEW_CRON"

cat >> "$NEW_CRON" <<CRON
$BEGIN_MARK
# 1. DB dump every 30 minutes (keeps last 48 = 24 hours)
*/30 * * * * DB_CONTAINER=$DB_CONTAINER APP_CONTAINER=$APP_CONTAINER BACKUP_DIR=$BACKUP_DIR MAX_BACKUPS=48 bash $DEPLOY_PATH/scripts/backup-db.sh >> $LOG_FILE 2>&1
# 2. Uploads archive every hour from the app container's uploads volume; keep 2 days
5 * * * * docker exec $APP_CONTAINER sh -c 'cd /app/PUBLIC && tar -czf - uploads' > $BACKUP_DIR/uploads_\$(date +\%Y-\%m-\%d_\%H).tar.gz 2>> $LOG_FILE; find $BACKUP_DIR -maxdepth 1 -name 'uploads_*.tar.gz' -mtime +2 -delete
# 3. Offsite sync to Google Drive every 30 minutes (10 min after the dump)
10,40 * * * * rclone sync "$BACKUP_DIR" "gdrive:JMS-Backups" --copy-links --log-file=/var/log/rclone-sync.log 2>&1
$END_MARK
CRON

crontab "$NEW_CRON"
echo "[Cron] Installed:"
crontab -l | sed -n "/^$BEGIN_MARK\$/,/^$END_MARK\$/p"

# One-time cleanup: the old job left thousands of empty (20-byte) upload archives.
REMOVED=$(find "$BACKUP_DIR" -maxdepth 1 -name 'uploads_*.tar.gz' -size -100c -print -delete | wc -l)
echo "[Cron] Removed $REMOVED empty uploads_*.tar.gz files."
