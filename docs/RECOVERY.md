# Disaster Recovery Runbook — JMS Enterprise

This document provides step-by-step procedures to recover the JMS Enterprise system from various failure scenarios.

---

## 1. Node.js App or container Crash
**Symptoms**: HTTP 502 Bad Gateway from Nginx, or connection refused.
**Target Recovery Time**: < 1 minute

1. Log in to the Hostinger VPS via SSH.
2. Navigate to the deployment folder:
   ```bash
   cd /opt/jms-enterprise
   ```
3. Check the status of the containers:
   ```bash
   docker compose ps
   ```
4. Restart the backend app container:
   ```bash
   docker compose restart app
   ```
5. If still down, restart the entire stack:
   ```bash
   docker compose down && docker compose up -d
   ```

---

## 2. PostgreSQL Database Corruption
**Symptoms**: Node logs show fatal database connection or syntax errors, queries fail, or tables are inaccessible.
**Target Recovery Time**: 5 minutes

We can recover the database cleanly using the latest automated 5-minute offsite backup or local VPS snapshot.

1. Log in to the VPS via SSH.
2. Navigate to the `/opt/jms-backups/dumps/` directory to see available backups:
   ```bash
   ls -la /opt/jms-backups/dumps/
   ```
3. Run the automated restore script (which drops, recreates, and reloads the SQL file cleanly):
   ```bash
   # Syntax: DB_CONTAINER=jms-enterprise-v1-db-1 APP_CONTAINER=jms-enterprise-v1-app-1 DB_PASSWORD=<password> bash /opt/jms-enterprise/scripts/backup-db.sh restore <backup_file_path>
   
   DB_CONTAINER=jms-enterprise-v1-db-1 APP_CONTAINER=jms-enterprise-v1-app-1 bash /opt/jms-enterprise/scripts/backup-db.sh restore /opt/jms-backups/dumps/backup_2026-05-30_12-00.sql.gz
   ```
4. Confirm with `YES` when prompted. The script will automatically stop the app container, recreate the database, inject the schema, and start the app container.

---

## 3. Total VPS Hardware or Hostinger Failure
**Symptoms**: VPS is completely unreachable, Hostinger network is down, or VPS disk is destroyed.
**Target Recovery Time**: 15–20 minutes

We will reconstruct the server on a new VPS instance and restore the latest Google Drive offsite snapshot.

1. **Provision New VPS**:
   - Create a fresh Debian 12 / Ubuntu 22.04 LTS instance on Hostinger (or any alternative cloud provider).
   - Assign the public IP: `72.62.228.195` (or update DNS mapping for `jmsocean.cloud` if the IP changes).

2. **Run One-Command Installer**:
   - Log in to the new VPS via SSH.
   - Run the bootstrap setup script to install Docker, Nginx, Let's Encrypt, and repository configurations:
     ```bash
     curl -sSL https://raw.githubusercontent.com/malisanjay475/jms_enterprise/main/scripts/vps-one-command-install.sh | bash
     ```

3. **Retrieve Backup from Google Drive**:
   - Download the latest `db_backup_*.sql.gz` and `uploads_*.tar.gz` files from your offsite **Google Drive** folder: `JMS-Backups/`.
   - Transfer these backup files to the new VPS at `/opt/jms-backups/`.

4. **Restore Database & Assets**:
   - Reconstruct the database:
     ```bash
     gunzip -c /opt/jms-backups/db_backup_latest.sql.gz | docker exec -i jms-enterprise-v1-db-1 psql -U jms_v1 jms_v1
     ```
   - Reconstruct the uploads folder (operator photos, machine icons):
     ```bash
     tar -xzf /opt/jms-backups/uploads_latest.tar.gz -C /opt/jms-enterprise/BACKEND/PUBLIC/uploads/
     ```

5. **Verify Stack Service**:
   - Test response endpoint:
     ```bash
     curl -I http://localhost:3000/health
     ```

---

## 4. Sync Lag or Disconnect
**Symptoms**: Sync health alert email is received, or `/api/sync/health` returns `ok: false`.
**Target Recovery Time**: 5 minutes

1. Log in to the **Factory Local Server** dashboard.
2. In the sync control center, trigger a **Force Full Push**:
   ```bash
   curl -X POST http://localhost:3000/api/sync/admin/full-push-reset
   ```
3. This resets the local watermark metadata, forcing the local agent to re-scan all database transactions and synchronize them up to the main server.
4. Verify the new state returns healthy:
   ```bash
   curl http://jmsocean.cloud:9091/api/sync/health
   ```
