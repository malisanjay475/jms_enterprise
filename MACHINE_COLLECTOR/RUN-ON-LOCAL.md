# Running the machine-data collector on the LOCAL factory server

The collector polls the moulding machines (Modbus TCP) and feeds JMS. It **must**
run on the **LOCAL factory server** — that's the only box on the factory LAN that
can reach the machines' `192.168.1.x` IPs. The VPS/MAIN server cannot.

Environment on the LOCAL box: Windows, cmd.exe, JMS backend on **port 3001**, PM2
for process management.

---

## 0. Prerequisites (one-time)

- Node.js installed (same one the backend uses).
- The machines are reachable from this box. Quick check in cmd.exe:
  ```
  ping 192.168.1.90
  ping 192.168.1.91
  ```
  Both should reply. If not, this is a network/cabling issue — fix before continuing.

---

## 1. Set the shared ingest key (one-time)

The collector authenticates to the backend with a shared secret. Add the SAME
value to the backend `.env` and use it when starting the collector.

Edit `BACKEND\.env` and add a line (pick your own long random string):
```
MACHINE_INGEST_KEY=change-me-to-a-long-random-secret
```
Then restart the backend so it loads the key (PM2 example — use your real app name):
```
pm2 restart jms-backend
```

> If `MACHINE_INGEST_KEY` is not set on the backend, the collector's `/ingest`
> and `/config/enabled` calls return 401 and no data is stored.

---

## 2. Link the machines' IPs (one-time, in the UI)

Open the app and set each machine's controller IP. Either place works:

- **Masters** → edit machine → "Collect live data (Modbus TCP)" section, or
- `/machine_data.html` → the machine's row.

| Machine | IP | Port | Unit ID | Profile | Enabled |
|---------|----|----|---------|---------|---------|
| E-L2-WIND-250-6 | 192.168.1.90 | 502 | 1 | KEBA SAM 4.0 | ✓ |
| E-L2-WIND-250-7 | 192.168.1.91 | 502 | 1 | KEBA SAM 4.0 | ✓ |

Word order: leave **ABCD**. (Change to **CDAB** only if values decode wrong — see Troubleshooting.)

---

## 3. Install the collector (one-time)

In cmd.exe, from the repo folder on the LOCAL box:
```
cd MACHINE_COLLECTOR
npm install
```

---

## 4. First run — foreground, to verify (do this before PM2)

Run it attached so you can watch the output. Replace the key with your real one:
```
set MACHINE_INGEST_KEY=change-me-to-a-long-random-secret
set BACKEND_URL=http://localhost:3001
node collector.js
```

You should see one line per machine every few seconds, e.g.:
```
E-L2-WIND-250-6 (192.168.1.90) good=1234 bad=5 cyc=12.5s run=true
E-L2-WIND-250-7 (192.168.1.91) good=987  bad=2 cyc=13.1s run=true
```

Confirm:
- `good=` increases by 1 each shot,
- `cyc=` matches the machine's own cycle-time display,
- `run=` is `true` while the machine is cycling.

Then check `/machine_data.html` → Live readings, the DPR grid ⚙ badges, and the
supervisor live strip. Stop the foreground run with `Ctrl+C` once happy.

---

## 5. Run it permanently under PM2

```
cd MACHINE_COLLECTOR
set MACHINE_INGEST_KEY=change-me-to-a-long-random-secret
set BACKEND_URL=http://localhost:3001
pm2 start collector.js --name machine-collector
pm2 save
```

`pm2 save` makes it survive a server reboot (assuming PM2 startup is already
configured on this box, which it is for the backend).

Useful PM2 commands:
```
pm2 logs machine-collector      REM  watch live output
pm2 status                      REM  see if it's running
pm2 restart machine-collector   REM  after changing config/env
pm2 stop machine-collector      REM  pause collection
pm2 delete machine-collector    REM  remove it entirely
```

> Note: PM2 captures the `MACHINE_INGEST_KEY`/`BACKEND_URL` env values at
> `pm2 start` time. If you change them later, `pm2 delete` then `pm2 start` again
> (a plain restart keeps the old env).

---

## 6. How to stop / remove everything

- **Pause one machine:** untick *Enabled* in Masters / `machine_data.html`. The
  collector stops polling it within ~30 s. No data is deleted.
- **Stop all collection:** `pm2 stop machine-collector`.
- **Remove completely:** `pm2 delete machine-collector`. Nothing was ever written
  into DPR (`dpr_hourly`), so there is no cleanup and no double-counting.

---

## Troubleshooting

| Symptom | Cause / fix |
|--------|-------------|
| `[config] ... 401` in logs | `MACHINE_INGEST_KEY` mismatch between `.env` and the collector's env. Make them identical; restart both. |
| `[poll] E-L2-... ECONNREFUSED` / timeout | Machine unreachable. `ping` the IP; check the machine's Modbus/AXISGATE is on and port 502 open. |
| Values are wild/garbage numbers | Word order. Set that machine to **CDAB** in Masters and save (KEBA gateways sometimes swap words). |
| Counter looks right but hourly ⚙ badge is 0 | Counter reset (shift/day rollover) or few samples in that hour — expected around resets. |
| Nothing in Live readings | Collector not running (`pm2 status`), or machine not *Enabled*, or backend not restarted after adding the key. |
| Badges/popup say "No machine reading recorded" | No readings stored yet for that hour — collector wasn't running then. |

---

## What good looks like day-to-day

- `pm2 status` shows `machine-collector` = **online**.
- `/machine_data.html` → Live readings updates every ~10 s with both machines.
- DPR grid shows a blue `⚙ N` under each hour cell; clicking it shows the register
  detail + last-reading timestamp.
- The **Accuracy check** table (on `/machine_data.html`) shows Auto vs Manual per
  hour — watch the Δ column while you run manual + auto in parallel.
