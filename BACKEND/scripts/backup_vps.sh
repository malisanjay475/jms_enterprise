#!/bin/bash

# Configuration
BACKUP_DIR="/root/backups"
DB_Container="jpsms-db"
DB_USER="postgres"
DB_NAME="jpsms"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"
RETENTION_DAYS=7

# Ensure Directory
mkdir -p $BACKUP_DIR

# Dump & Compress
echo "[Backup] Starting backup for $TIMESTAMP..."
docker exec $DB_Container pg_dump -U $DB_USER $DB_NAME | gzip > $FILENAME

# Check Status
if [ $? -eq 0 ]; then
  echo "[Backup] Success: $FILENAME"
  # S3 Sync (Optional - Uncomment and configure awscli)
  # aws s3 cp $FILENAME s3://my-jpsms-backups/
else
  echo "[Backup] FAILED!"
  exit 1
fi

# Cleanup Old Backups
echo "[Backup] Cleaning up backups older than $RETENTION_DAYS days..."
find $BACKUP_DIR -type f -name "*.sql.gz" -mtime +$RETENTION_DAYS -exec rm {} \;

echo "[Backup] Done."
