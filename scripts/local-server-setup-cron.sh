#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — LOCAL Factory Server Cron Setup
# ============================================================
# Run ONCE on each LOCAL factory server to install:
#   • Keep-alive check every minute
#   • Local DB backup every 30 minutes
#   • Sync watchdog log every hour
#
# Usage:
#   sudo bash /opt/jms-enterprise/scripts/local-server-setup-cron.sh
# ============================================================

set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/jms-enterprise}"
BACKUP_DIR="${BACKUP_DIR:-/opt/jms-local-backups}"
LOG_KEEP_ALIVE="/var/log/jms-keep-alive.log"
LOG_BACKUP="/var/log/jms-local-backup.log"
APP_CONTAINER="${APP_CONTAINER:-jms-enterprise-v1-app-1}"
DB_CONTAINER="${DB_CONTAINER:-jms-enterprise-v1-db-1}"

echo "============================================================"
echo "  JMS Enterprise — LOCAL Server Cron Setup"
echo "============================================================"

# Create backup directory
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Make scripts executable
chmod +x "$DEPLOY_PATH/scripts/local-server-keep-alive.sh" 2>/dev/null || true
chmod +x "$DEPLOY_PATH/scripts/local-db-backup.sh" 2>/dev/null || true

TMP_CRON=$(mktemp)
crontab -l > "$TMP_CRON" 2>/dev/null || true

# Remove old JMS LOCAL entries to prevent duplicates
grep -v "jms-keep-alive\|jms-local-backup\|JMS LOCAL" "$TMP_CRON" > "${TMP_CRON}.clean" && mv "${TMP_CRON}.clean" "$TMP_CRON"

cat <<EOF >> "$TMP_CRON"

# === JMS ENTERPRISE LOCAL SERVER AUTO-RECOVERY & BACKUP ===
# 1. Keep-alive: check every minute, auto-restart if down
* * * * * DEPLOY_PATH=$DEPLOY_PATH APP_CONTAINER=$APP_CONTAINER LOG_FILE=$LOG_KEEP_ALIVE bash $DEPLOY_PATH/scripts/local-server-keep-alive.sh >> $LOG_KEEP_ALIVE 2>&1

# 2. Local DB backup every 30 minutes (keeps 48 snapshots = 24 hours)
*/30 * * * * DB_CONTAINER=$DB_CONTAINER BACKUP_DIR=$BACKUP_DIR MAX_BACKUPS=48 bash $DEPLOY_PATH/scripts/local-db-backup.sh >> $LOG_BACKUP 2>&1
# ==========================================================
EOF

crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "✅ Cron jobs installed:"
echo "   • Keep-alive: every 1 minute → $LOG_KEEP_ALIVE"
echo "   • DB backup : every 30 min  → $BACKUP_DIR"
echo ""
echo "View live keep-alive log:"
echo "   tail -f $LOG_KEEP_ALIVE"
