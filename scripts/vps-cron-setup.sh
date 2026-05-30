#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — VPS Crontab Installer for 5-Min Backups
# ============================================================
# Usage:
#   Run this script on the VPS to set up 5-minute automated
#   backups and Google Drive rclone sync jobs:
#     bash /opt/jms-enterprise/scripts/vps-cron-setup.sh
# ============================================================

set -euo pipefail

DEPLOY_PATH="/opt/jms-enterprise"
BACKUP_DIR="/opt/jms-backups"
LOG_FILE="/var/log/jms-cron-backup.log"

echo "============================================================"
echo "  Setting up High-Frequency 5-Minute Backups on VPS"
echo "============================================================"

# Ensure backup directories exist
mkdir -p "$BACKUP_DIR"

# Write cron jobs to temporary file
TMP_CRON=$(mktemp)

# Retrieve current crontab to avoid overwriting existing rules
crontab -l > "$TMP_CRON" 2>/dev/null || true

# Check if rules already exist to prevent duplication
if grep -q "backup-db.sh" "$TMP_CRON"; then
    echo "[Cron] 5-Minute cron rules already exist in crontab."
else
    echo "[Cron] Appending backup and sync rules to crontab..."
    
    cat <<EOF >> "$TMP_CRON"

# === JMS ENTERPRISE AUTOMATED BACKUPS ===
# 1. Take database dump every 5 minutes (keeps last 288 files = 24 hours of history)
*/5 * * * * DB_CONTAINER=jms-enterprise-v1-db-1 APP_CONTAINER=jms-enterprise-v1-app-1 BACKUP_DIR=$BACKUP_DIR MAX_BACKUPS=288 bash $DEPLOY_PATH/scripts/backup-db.sh >> $LOG_FILE 2>&1

# 2. Archive uploads folder every 15 minutes
*/15 * * * * tar -czf $BACKUP_DIR/uploads_\$(date +\%Y-\%m-\%d_\%H-\%M).tar.gz -C $DEPLOY_PATH/BACKEND/PUBLIC/uploads . >> $LOG_FILE 2>&1

# 3. Offsite sync to Google Drive every 5 minutes (uploads new files instantly)
*/5 * * * * rclone sync "$BACKUP_DIR" "gdrive:JMS-Backups" --copy-links --log-file=/var/log/rclone-sync.log 2>&1
# ========================================
EOF

    # Apply new crontab
    crontab "$TMP_CRON"
    echo "[Cron] CRONTAB successfully configured!"
fi

rm -f "$TMP_CRON"

echo "============================================================"
echo "  Setup Complete!"
echo "  - DB dumps occur every 5 mins at: $BACKUP_DIR"
echo "  - GDrive offsite sync runs every 5 mins"
echo "============================================================"
