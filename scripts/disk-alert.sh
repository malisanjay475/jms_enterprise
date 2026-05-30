#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — VPS Disk Space Alert Script
# ============================================================
# Recommended cron setup (runs every hour):
#   0 * * * * bash /opt/jms-enterprise/scripts/disk-alert.sh
# ============================================================

set -euo pipefail

ALERT_EMAIL="joyo44064@gmail.com"
THRESHOLD=85

# Find disk usage percentage for root partition
USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')

echo "[Disk Monitor] Current usage: ${USAGE}%"

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "[Disk Monitor] WARNING: Disk usage is above ${THRESHOLD}%!"
    
    # Check if mail or sendmail is installed, or fallback to log warning
    if command -v mail &>/dev/null; then
        echo "JMS Main Server VPS is low on disk space! Current usage: ${USAGE}%." \
        | mail -s "[WARNING] JMS VPS Disk Alert: ${USAGE}% Full!" "$ALERT_EMAIL"
        echo "[Disk Monitor] Alert email dispatched to $ALERT_EMAIL"
    else
        echo "[Disk Monitor] 'mail' command not installed on VPS. Please log in and clean up backups/logs."
    fi
fi
