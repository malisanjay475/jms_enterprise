# JMS Ops Setup — one-time steps to turn ON backups & alerts

Code is deployed. Do these once to activate it. Each is independent.

## 1. Google Drive backups (rclone on VPS) — 10 min
```bash
ssh <vps-user>@<vps-host>
curl https://rclone.org/install.sh | sudo bash
rclone config        # New remote, name EXACTLY: gdrive, type: drive,
                     # accept defaults, browser auth, paste token, quit
rclone listremotes   # should show: gdrive:
rclone mkdir gdrive:JMS-Backups
```
Backups already save locally on the VPS before this; this adds the offsite copy.

## 2. Alert emails (Gmail app password) — 5 min
1. On a Gmail account, enable 2-Step Verification.
2. Create an App Password (Google Account → Security → App passwords → Mail).
3. Add GitHub repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `MAIL_USERNAME` | Gmail address to send FROM |
| `MAIL_PASSWORD` | the 16-char app password (no spaces) |

## 3. Sync-stuck alerts — 2 min
Add GitHub repo secrets:

| Secret | Value |
|--------|-------|
| `MAIN_PUBLIC_URL` | `http://<your-vps-ip>:9091` (no trailing `/`) |
| `SYNC_API_KEY` | the same key the app uses |

Test: Actions → "Sync Health Check" → Run workflow → should report `healthy`.

## 4. Uptime monitoring (UptimeRobot, free) — 5 min
1. Sign up at https://uptimerobot.com
2. New Monitor → HTTP(s) → `http://<your-vps-ip>:9091/health` → every 5 min
3. Add email + (optional) SMS contact.

## Verify (all green = industry-standard safety)
| Check | How |
|-------|-----|
| Backup runs | Actions → "Scheduled DB Backup" → Run → green |
| On Drive | Drive → `JMS-Backups/db/<month>/` has a file |
| Sync alert | Actions → "Sync Health Check" → reports healthy |
| Uptime | UptimeRobot shows "Up" |

Result: max data loss ≈ **6 hours**; recovery from offsite ≈ **15 min**; broken backup / stuck sync alerts you in **hours, not days**.

---

## Monthly restore test (a backup you never restored is only a hope)

The **"Backup Restore Test"** workflow runs on the 1st of each month (09:00 IST)
and can be triggered manually. It restores the newest dump into a throwaway
Postgres container on the VPS, asserts table/row counts, then tears it down —
never touching production. If it fails you get an email: the backup is unusable
and must be fixed *before* you ever need it.

Run manually: **Actions → "Backup Restore Test" → Run workflow**.
On the VPS directly: `BACKUP_ROOT=/opt/jms-backups bash scripts/verify-backup-restore.sh`

## Enforce offsite (no silent local-only backups)

`vps-backup-to-cloud.sh` now prints a loud `OFFSITE-WARNING` to stderr when the
`gdrive` rclone remote is missing. To make a missing offsite copy a hard
failure (recommended once Drive is set up), run the backup with
`STRICT_OFFSITE=1` — the job then fails (and emails you) rather than reporting
success with backups that only exist on the VPS.

## Point-In-Time Recovery (PITR) — shrink 6h loss to seconds

The 6-hour dump cadence means up to 6h of data loss in a disaster. For an ERP
this is the next upgrade. Enable WAL archiving on the production Postgres:

1. In `postgresql.conf` (or compose command flags):
   `wal_level = replica`, `archive_mode = on`,
   `archive_command = 'rclone copy %p gdrive:JMS-Backups/wal/'` (or copy to a
   local archive dir that the backup script tars/uploads).
2. Keep one weekly **base backup** (`pg_basebackup`) alongside the WAL stream.
3. Recovery = restore the base backup, then replay WAL up to the exact second
   before the incident (`recovery_target_time`).

With PITR in place, worst-case data loss drops from ~6 hours to **the last
archived WAL segment (seconds–minutes)**.
