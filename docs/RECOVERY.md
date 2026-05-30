# JMS Enterprise — Disaster Recovery Runbook

| Situation | Section | Recovery time |
|-----------|---------|---------------|
| App down, VPS up | A | ~2 min |
| Entire VPS dead | B | ~15–20 min |
| DB corrupted / data deleted | C | ~5–10 min |
| LOCAL↔MAIN sync stuck | D | ~5 min |
| Disk full on VPS | E | ~5 min |

## A. App down, VPS reachable
```bash
ssh <vps-user>@<vps-host>
cd <VPS_DEPLOY_PATH>
docker compose -p jms-enterprise-v1 -f docker-compose.vps-v1-isolated.yml up -d
```
`restart: unless-stopped` usually auto-recovers within ~30s.

## B. Entire VPS dead
1. New Ubuntu VPS → `curl -fsSL https://get.docker.com | sh`
2. `git clone https://github.com/malisanjay475/jms_enterprise.git && cd jms_enterprise`
3. Create `.env` from your password manager.
4. `docker compose -p jms-enterprise-v1 -f docker-compose.vps-v1-isolated.yml up -d`
5. Restore latest DB from Google Drive (Section C).
6. Re-point app URLs to the new IP.

## C. DB corruption / accidental deletion
```bash
# get latest from Drive:
rclone copy gdrive:JMS-Backups/db/$(date +%Y-%m)/ /var/jms-backups/restore/ --max-age 12h
FILE=/var/jms-backups/dumps/jms_db_<ts>.sql.gz   # set this
docker stop jms-enterprise-v1-app-1
docker exec jms-enterprise-v1-db-1 psql -U jms_v1 postgres -c "DROP DATABASE IF EXISTS jms_v1;"
docker exec jms-enterprise-v1-db-1 psql -U jms_v1 postgres -c "CREATE DATABASE jms_v1 OWNER jms_v1;"
gunzip -c "$FILE" | docker exec -i jms-enterprise-v1-db-1 psql -U jms_v1 jms_v1
docker start jms-enterprise-v1-app-1
```
Loses data entered after the chosen backup (≤6h with 6-hourly backups).

## D. Sync stuck
On the LOCAL server browser console (F12):
```js
fetch('/api/sync/health').then(r=>r.json()).then(console.log)
fetch('/api/sync/force-full-push',{method:'POST'}).then(r=>r.json()).then(console.log)
```
Wait 2–5 min, re-check. If a table errors, restart LOCAL app to re-run migrations.

## E. Disk full
```bash
df -h /; docker system df; docker image prune -af
ls -t /var/jms-backups/dumps/*.sql.gz | tail -n +60 | xargs -r rm -f
```

## Backups
- `scheduled-backup.yml` every 6h + manual. DB dump + uploads archive.
- Stored on VPS `/var/jms-backups/` AND Google Drive `JMS-Backups/` (after rclone setup).
- ~30 day retention. Failure emails joyo44064@gmail.com.
- Manual: Actions → "Scheduled DB Backup" → Run, or `bash scripts/vps-backup-to-cloud.sh`.
- **Test-restore monthly** into a throwaway DB. A backup you've never restored is not a backup.
