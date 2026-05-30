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
