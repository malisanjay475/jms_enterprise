# MACHINE_COLLECTOR — Modbus TCP machine data

Collects live data from injection-moulding machine controllers (KEBA SAM 4.0)
over **Modbus TCP** and feeds it into JMS.

## How it fits together

```
Machine (KEBA, Modbus TCP slave)        LOCAL factory server (backend :3001)
   192.168.1.91:502  ──poll (read)──▶   collector.js  ──POST /ingest──▶  Postgres
                                          (decodes registers)             machine_readings
                                                                                │
                                          machine_data.html  ◀── /api/machine-data/latest
```

- The collector runs on the **LOCAL** server because only it can reach the
  machines' private `192.168.x.x` IPs.
- It **only reads** holding registers — it never writes to a machine.
- The register map lives in `BACKEND/src/modules/machineData/kebaProfile.js`
  (shared by the backend and the collector).

## 1. Configure machines

Open **`/machine_data.html`** in the app. For each machine set:
IP address, port (`502`), unit id (`1`), profile (`KEBA_SAM_4_0`), and tick
*Enabled*. Word order defaults to `ABCD` — if decoded floats/counters look wrong
at commissioning, switch to `CDAB`.

## 2. Run the collector (on the LOCAL server)

```bash
cd MACHINE_COLLECTOR
npm install
MACHINE_INGEST_KEY=<same-as-backend> BACKEND_URL=http://localhost:3001 node collector.js
```

Set `MACHINE_INGEST_KEY` in the backend `.env` to the same value. The collector
pulls the enabled-machine list from the backend every 30 s and polls each on its
own interval.

## Probing an unknown machine

If you don't yet know which register holds what, use the probe to watch values
change as the machine runs a shot:

```bash
node probe.js --host 192.168.1.91 --watch
```

`--fn 3` = holding registers (default), `--fn 4` = input registers.

## KEBA SAM 4.0 register map (summary)

Holding registers, each variable a 2-register (32-bit) slot, unit id 1:

| Address | Field | Type |
|--------|-------|------|
| 40002 | Ideal cycle time | TIME |
| 40014 | Cycle time act | TIME |
| 40016 | Shot counter set | DINT |
| 40018 | **Good shot act** | DINT |
| 40022 | **Bad shot act** | DINT |
| 40036–40046 | Actual temp zones 1–6 | REAL |
| 40078 | Oil temperature | REAL |
| 40120 | Down time reason | INT |
| 40122 | **Machine running** (auto cycle) | BOOL |
| 40130 | Machine mode | INT |

Full list in `kebaProfile.js`.
