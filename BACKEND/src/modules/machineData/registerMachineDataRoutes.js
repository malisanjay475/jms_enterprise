'use strict';

/**
 * Machine Data (Modbus TCP) module.
 *
 * Lets each machine in Masters be linked to a Modbus TCP source (IP / port /
 * unit id / register profile). A separate collector process (MACHINE_COLLECTOR/)
 * polls each enabled machine, decodes the registers, and POSTs readings to the
 * ingest endpoint here, which stores them in machine_readings.
 *
 * Storage is intentionally decoupled from the fragile machines CRUD: config
 * lives in its own machine_modbus_config table, linked by machine_id.
 *
 * Endpoints (all under /api/machine-data):
 *   GET  /profiles                 register profiles known to the server
 *   GET  /config                   per-machine modbus config (joined to machines)
 *   PUT  /config/:machineId        upsert modbus config for a machine
 *   POST /ingest                   collector posts decoded readings (key-guarded)
 *   GET  /latest                   latest reading per enabled machine
 *   GET  /:machineId/history       recent readings for one machine
 */

const keba = require('./kebaProfile');

const PROFILES = {
  [keba.PROFILE_ID]: keba,
};

let _schemaPromise = null;
async function ensureSchema(pool) {
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_modbus_config (
        machine_id    INTEGER PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
        enabled       BOOLEAN NOT NULL DEFAULT false,
        ip            TEXT,
        port          INTEGER NOT NULL DEFAULT 502,
        unit_id       INTEGER NOT NULL DEFAULT 1,
        profile_id    TEXT NOT NULL DEFAULT 'KEBA_SAM_4_0',
        word_order    TEXT NOT NULL DEFAULT 'ABCD',
        poll_ms       INTEGER NOT NULL DEFAULT 5000,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_readings (
        id                 BIGSERIAL PRIMARY KEY,
        machine_id         INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        good_shots         BIGINT,
        bad_shots          BIGINT,
        shot_counter_set   BIGINT,
        cycle_time_s       NUMERIC,
        ideal_cycle_time_s NUMERIC,
        product_code       INTEGER,
        machine_running    BOOLEAN,
        machine_mode       INTEGER,
        oil_temp           NUMERIC,
        down_time_reason   INTEGER,
        raw_json           JSONB
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_machine_readings_machine_time
        ON machine_readings (machine_id, recorded_at DESC);
    `);
  })();
  return _schemaPromise;
}

// The collector authenticates with a shared key (same pattern as sync-alert).
function ingestKey() {
  return process.env.MACHINE_INGEST_KEY || process.env.SYNC_ALERT_KEY || '';
}

function pickNum(v) {
  return (v === undefined || v === null || v === '') ? null : Number(v);
}

// Counters are stored in BIGINT columns; the KEBA gateway serves them as floats
// (e.g. 205.0), so round to a whole number before insert.
function pickInt(v) {
  const n = pickNum(v);
  return n === null || !Number.isFinite(n) ? null : Math.round(n);
}

function registerMachineDataRoutes(app, pool) {
  const router = require('express').Router();

  router.use(async (req, res, next) => {
    try { await ensureSchema(pool); next(); }
    catch (e) { res.status(500).json({ ok: false, error: 'schema: ' + String(e.message || e) }); }
  });

  // --- Register profiles (map is server-authoritative; collector fetches it) --
  router.get('/profiles', (req, res) => {
    const list = Object.values(PROFILES).map(p => ({
      id: p.PROFILE_ID,
      span: p.span(),
      registers: p.REGISTERS,
    }));
    res.json({ ok: true, profiles: list });
  });

  // --- Per-machine config, joined to the machine list -----------------------
  router.get('/config', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT m.id AS machine_id, m.machine AS machine_name, m.factory_id,
               c.enabled, c.ip, c.port, c.unit_id, c.profile_id, c.word_order, c.poll_ms,
               c.updated_at
          FROM machines m
          LEFT JOIN machine_modbus_config c ON c.machine_id = m.id
         WHERE m.is_active = true
         ORDER BY m.machine ASC
      `);
      res.json({ ok: true, config: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Config for the collector: only enabled machines with an IP.
  router.get('/config/enabled', async (req, res) => {
    if (!ingestKey() || req.get('x-ingest-key') !== ingestKey()) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const { rows } = await pool.query(`
        SELECT m.id AS machine_id, m.machine AS machine_name,
               c.ip, c.port, c.unit_id, c.profile_id, c.word_order, c.poll_ms
          FROM machine_modbus_config c
          JOIN machines m ON m.id = c.machine_id
         WHERE c.enabled = true AND COALESCE(c.ip, '') <> ''
         ORDER BY m.machine ASC
      `);
      res.json({ ok: true, machines: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.put('/config/:machineId', async (req, res) => {
    const machineId = parseInt(req.params.machineId, 10);
    if (!Number.isInteger(machineId)) {
      return res.status(400).json({ ok: false, error: 'invalid machineId' });
    }
    const b = req.body || {};
    const profileId = String(b.profile_id || keba.PROFILE_ID);
    if (!PROFILES[profileId]) {
      return res.status(400).json({ ok: false, error: 'unknown profile_id' });
    }
    const wordOrder = ['ABCD', 'CDAB', 'BADC', 'DCBA'].includes(b.word_order) ? b.word_order : 'ABCD';
    try {
      const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [machineId]);
      if (!exists.rowCount) return res.status(404).json({ ok: false, error: 'machine not found' });

      await pool.query(`
        INSERT INTO machine_modbus_config
          (machine_id, enabled, ip, port, unit_id, profile_id, word_order, poll_ms, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (machine_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          ip = EXCLUDED.ip,
          port = EXCLUDED.port,
          unit_id = EXCLUDED.unit_id,
          profile_id = EXCLUDED.profile_id,
          word_order = EXCLUDED.word_order,
          poll_ms = EXCLUDED.poll_ms,
          updated_at = NOW()
      `, [
        machineId,
        b.enabled === true || b.enabled === 'true',
        (b.ip || '').trim() || null,
        parseInt(b.port, 10) || 502,
        parseInt(b.unit_id, 10) || 1,
        profileId,
        wordOrder,
        Math.max(1000, parseInt(b.poll_ms, 10) || 5000),
      ]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // --- Ingest (collector -> server) -----------------------------------------
  // Body: { machine_id, recorded_at?, values: { key: value, ... } }
  router.post('/ingest', async (req, res) => {
    if (!ingestKey() || req.get('x-ingest-key') !== ingestKey()) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const b = req.body || {};
    const machineId = parseInt(b.machine_id, 10);
    const v = b.values || {};
    if (!Number.isInteger(machineId)) {
      return res.status(400).json({ ok: false, error: 'machine_id required' });
    }
    try {
      await pool.query(`
        INSERT INTO machine_readings
          (machine_id, recorded_at, good_shots, bad_shots, shot_counter_set,
           cycle_time_s, ideal_cycle_time_s, product_code, machine_running,
           machine_mode, oil_temp, down_time_reason, raw_json)
        VALUES ($1, COALESCE($2::timestamptz, NOW()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        machineId,
        b.recorded_at || null,
        pickInt(v.good_shots),
        pickInt(v.bad_shots),
        pickInt(v.shot_counter_set),
        // Cycle time act is at 40002 in the corrected map; fall back to ideal.
        pickNum(v.cycle_time_act != null ? v.cycle_time_act : v.ideal_cycle_time),
        pickNum(v.ideal_cycle_time),
        pickNum(v.product_code),
        // null when the controller didn't expose 40122 (unread) — so the UI can
        // show "unknown" instead of a misleading "stopped".
        (v.machine_running == null ? null : (v.machine_running === true || v.machine_running === 'true')),
        pickNum(v.machine_mode),
        pickNum(v.oil_temp),
        pickNum(v.down_time_reason),
        JSON.stringify(v),
      ]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // --- Reads for UI ----------------------------------------------------------
  router.get('/latest', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT DISTINCT ON (r.machine_id)
               r.machine_id, m.machine AS machine_name,
               r.recorded_at, r.good_shots, r.bad_shots, r.shot_counter_set,
               r.cycle_time_s, r.ideal_cycle_time_s, r.product_code,
               r.machine_running, r.machine_mode, r.oil_temp, r.down_time_reason
          FROM machine_readings r
          JOIN machines m ON m.id = r.machine_id
         ORDER BY r.machine_id, r.recorded_at DESC
      `);
      res.json({ ok: true, readings: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Full latest snapshot (all decoded registers) per enabled machine — powers
  // the live "All Machine Data" page.
  router.get('/all-latest', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT DISTINCT ON (r.machine_id)
               r.machine_id, m.machine AS machine_name, r.recorded_at, r.raw_json
          FROM machine_readings r
          JOIN machines m ON m.id = r.machine_id
          JOIN machine_modbus_config c ON c.machine_id = r.machine_id AND c.enabled = true
         ORDER BY r.machine_id, r.recorded_at DESC
      `);
      const registers = keba.REGISTERS.map(x => ({ address: x.address, key: x.key, label: x.label }));
      res.json({
        ok: true,
        registers,
        machines: rows.map(r => ({
          machine_id: r.machine_id,
          machine_name: r.machine_name,
          recorded_at: r.recorded_at,
          values: r.raw_json || {},
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.get('/:machineId/history', async (req, res) => {
    const machineId = parseInt(req.params.machineId, 10);
    if (!Number.isInteger(machineId)) {
      return res.status(400).json({ ok: false, error: 'invalid machineId' });
    }
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 200));
    try {
      const { rows } = await pool.query(`
        SELECT recorded_at, good_shots, bad_shots, cycle_time_s, machine_running,
               machine_mode, oil_temp, down_time_reason, raw_json
          FROM machine_readings
         WHERE machine_id = $1
         ORDER BY recorded_at DESC
         LIMIT $2
      `, [machineId, limit]);
      res.json({ ok: true, readings: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // --- DPR accuracy comparison: machine counter vs manual dpr_hourly --------
  // For each hour slot of a shift, compute the machine-derived good/reject/shots
  // (counter delta over the slot window) and the average cycle time, alongside
  // the manually entered dpr_hourly totals. Read-only; writes nothing to DPR.
  router.get('/dpr-auto', async (req, res) => {
    const machine = String(req.query.machine || '').trim();
    const date = String(req.query.date || '').trim();          // YYYY-MM-DD
    const shift = String(req.query.shift || 'Day').trim();     // Day | Night
    if (!machine || !date) {
      return res.status(400).json({ ok: false, error: 'machine and date required' });
    }
    try {
      const mrow = await pool.query('SELECT id FROM machines WHERE LOWER(machine)=LOWER($1) LIMIT 1', [machine]);
      if (!mrow.rowCount) return res.status(404).json({ ok: false, error: 'machine not found' });
      const machineId = mrow.rows[0].id;

      const slots = slotWindows(date, shift); // [{slot, startIso, endIso}]
      const out = [];
      for (const s of slots) {
        // Counter delta = last reading in window − first reading in window (>=0).
        const { rows } = await pool.query(`
          WITH win AS (
            SELECT good_shots, bad_shots, cycle_time_s, recorded_at
              FROM machine_readings
             WHERE machine_id = $1 AND recorded_at >= $2 AND recorded_at < $3
             ORDER BY recorded_at
          )
          SELECT
            (SELECT good_shots FROM win ORDER BY recorded_at DESC LIMIT 1) AS good_last,
            (SELECT good_shots FROM win ORDER BY recorded_at ASC  LIMIT 1) AS good_first,
            (SELECT bad_shots  FROM win ORDER BY recorded_at DESC LIMIT 1) AS bad_last,
            (SELECT bad_shots  FROM win ORDER BY recorded_at ASC  LIMIT 1) AS bad_first,
            (SELECT ROUND(AVG(cycle_time_s)::numeric, 2) FROM win WHERE cycle_time_s > 0) AS cyc_avg,
            (SELECT COUNT(*) FROM win) AS n
        `, [machineId, s.startIso, s.endIso]);
        const r = rows[0] || {};
        const autoGood = (r.good_last != null && r.good_first != null) ? Math.max(0, Number(r.good_last) - Number(r.good_first)) : null;
        const autoRej = (r.bad_last != null && r.bad_first != null) ? Math.max(0, Number(r.bad_last) - Number(r.bad_first)) : null;

        const man = await pool.query(`
          SELECT COALESCE(SUM(good_qty),0) AS good, COALESCE(SUM(reject_qty),0) AS rej, COALESCE(SUM(shots),0) AS shots
            FROM dpr_hourly
           WHERE machine=$1 AND dpr_date=$2 AND shift=$3 AND hour_slot=$4 AND is_deleted = false
        `, [machine, date, shift, s.slot]);
        const m = man.rows[0] || {};

        out.push({
          slot: s.slot,
          auto_good: autoGood,
          auto_reject: autoRej,
          auto_shots: (autoGood != null || autoRej != null) ? (Number(autoGood || 0) + Number(autoRej || 0)) : null,
          auto_cycle_s: r.cyc_avg != null ? Number(r.cyc_avg) : null,
          samples: Number(r.n || 0),
          manual_good: Number(m.good || 0),
          manual_reject: Number(m.rej || 0),
          manual_shots: Number(m.shots || 0),
        });
      }
      res.json({ ok: true, machine, date, shift, slots: out });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Detail for one machine + one DPR hour slot: the LAST reading taken in that
  // hour (with the requested register values) + when it was taken + how many
  // readings fell in the hour. Used by the DPR cell popup.
  router.get('/slot-detail', async (req, res) => {
    const machine = String(req.query.machine || '').trim();
    const date = String(req.query.date || '').trim();
    const shift = String(req.query.shift || 'Day').trim();
    const slot = String(req.query.slot || '').trim();
    if (!machine || !date || !slot) {
      return res.status(400).json({ ok: false, error: 'machine, date, slot required' });
    }
    try {
      const mrow = await pool.query('SELECT id FROM machines WHERE LOWER(machine)=LOWER($1) LIMIT 1', [machine]);
      if (!mrow.rowCount) return res.status(404).json({ ok: false, error: 'machine not found' });
      const machineId = mrow.rows[0].id;
      const win = slotWindows(date, shift).find(s => s.slot === slot);
      if (!win) return res.status(400).json({ ok: false, error: 'unknown slot' });

      // Compute clean per-hour stats. Glitch reads (a failed Modbus chunk)
      // store NULL now, so filtering IS NOT NULL / > 0 keeps averages honest.
      // Production = (counter at end) - (counter at start). Weight = 40008,
      // cycle = 40002 (the registers verified accurate on this controller).
      const { rows } = await pool.query(`
        WITH win AS (
          SELECT recorded_at, good_shots, cycle_time_s,
                 NULLIF(raw_json->>'shot_weight','')::numeric AS shot_weight
            FROM machine_readings
           WHERE machine_id=$1 AND recorded_at>=$2 AND recorded_at<$3
        )
        SELECT
          (SELECT good_shots  FROM win WHERE good_shots > 0 ORDER BY recorded_at DESC LIMIT 1) AS good_last,
          (SELECT good_shots  FROM win WHERE good_shots > 0 ORDER BY recorded_at ASC  LIMIT 1) AS good_first,
          (SELECT cycle_time_s FROM win WHERE cycle_time_s > 0 ORDER BY recorded_at DESC LIMIT 1) AS cycle_last,
          (SELECT ROUND(AVG(cycle_time_s)::numeric, 2) FROM win WHERE cycle_time_s > 0) AS cycle_avg,
          (SELECT shot_weight  FROM win WHERE shot_weight > 0 ORDER BY recorded_at DESC LIMIT 1) AS weight_last,
          (SELECT ROUND(AVG(shot_weight)::numeric, 1) FROM win WHERE shot_weight > 0) AS weight_avg,
          (SELECT MAX(recorded_at) FROM win) AS last_at,
          (SELECT MIN(recorded_at) FROM win WHERE good_shots > 0) AS first_at,
          (SELECT COUNT(*) FROM win) AS samples
      `, [machineId, win.startIso, win.endIso]);

      const r = rows[0] || {};
      if (!r.samples || Number(r.samples) === 0) {
        return res.json({ ok: true, machine, slot, found: false });
      }
      const num = (x) => (x == null ? null : Number(x));
      const produced = (r.good_last != null && r.good_first != null)
        ? Math.max(0, Number(r.good_last) - Number(r.good_first)) : null;

      // Verified-accurate fields only. cavity + cycle-set (40004/40012/40014)
      // are intentionally omitted — those registers don't match this gateway.
      const fields = [
        { key: 'produced',     label: 'Pcs produced this hour', value: produced,               primary: true },
        { key: 'counter_now',  label: 'Counter now',            value: num(r.good_last) },
        { key: 'weight_now',   label: 'Actual weight',          value: num(r.weight_last), unit: 'g' },
        { key: 'weight_avg',   label: 'Average weight',         value: num(r.weight_avg),  unit: 'g' },
        { key: 'cycle_now',    label: 'Cycle time (now)',       value: num(r.cycle_last),  unit: 's' },
        { key: 'cycle_avg',    label: 'Average cycle time',     value: num(r.cycle_avg),   unit: 's' },
      ];

      res.json({
        ok: true, machine, slot, found: true,
        produced,
        last_at: r.last_at, first_at: r.first_at, samples: Number(r.samples || 0),
        fields,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Bulk auto figures for the DPR grid: every enabled machine, all slots, in
  // one call. Shape: { machines: { "<machine name>": { "<slot>": {good,cycle} } } }
  router.get('/dpr-auto-bulk', async (req, res) => {
    const date = String(req.query.date || '').trim();
    const shift = String(req.query.shift || 'Day').trim();
    if (!date) return res.status(400).json({ ok: false, error: 'date required' });
    try {
      const cfg = await pool.query(`
        SELECT m.id AS machine_id, m.machine AS machine_name
          FROM machine_modbus_config c JOIN machines m ON m.id = c.machine_id
         WHERE c.enabled = true
      `);
      const slots = slotWindows(date, shift);
      const machines = {};
      for (const row of cfg.rows) {
        const bySlot = {};
        for (const s of slots) {
          const { rows } = await pool.query(`
            WITH win AS (
              SELECT good_shots, cycle_time_s, recorded_at FROM machine_readings
               WHERE machine_id=$1 AND recorded_at>=$2 AND recorded_at<$3 ORDER BY recorded_at)
            SELECT (SELECT good_shots FROM win WHERE good_shots > 0 ORDER BY recorded_at DESC LIMIT 1) AS glast,
                   (SELECT good_shots FROM win WHERE good_shots > 0 ORDER BY recorded_at ASC  LIMIT 1) AS gfirst,
                   (SELECT ROUND(AVG(cycle_time_s)::numeric,2) FROM win WHERE cycle_time_s>0) AS cyc
          `, [row.machine_id, s.startIso, s.endIso]);
          const r = rows[0] || {};
          const good = (r.glast != null && r.gfirst != null) ? Math.max(0, Number(r.glast) - Number(r.gfirst)) : null;
          if (good != null || r.cyc != null) bySlot[s.slot] = { good, cycle: r.cyc != null ? Number(r.cyc) : null };
        }
        machines[row.machine_name] = bySlot;
      }
      res.json({ ok: true, date, shift, machines });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.use('/api/machine-data', router);
}

// Mirror of the DPR hour-slot -> clock-time mapping used in dpr-script-2.js.
// Each slot is a 1-hour window ending at the mapped hour.
const DAY_END_HOUR = {
  '07-08': 8, '08-09': 9, '09-10': 10, '10-11': 11, '11-12': 12, '12-01': 13,
  '01-02': 14, '02-03': 15, '03-04': 16, '04-05': 17, '05-06': 18, '06-07': 19,
};
const NIGHT_MAP = {
  '07-08': [20, 0], '08-09': [21, 0], '09-10': [22, 0], '10-11': [23, 0],
  '11-12': [0, 1], '12-01': [1, 1], '01-02': [2, 1], '02-03': [3, 1],
  '03-04': [4, 1], '04-05': [5, 1], '05-06': [6, 1], '06-07': [7, 1],
};
function slotWindows(dateStr, shift) {
  const order = ['07-08','08-09','09-10','10-11','11-12','12-01','01-02','02-03','03-04','04-05','05-06','06-07'];
  return order.map((slot) => {
    const base = new Date(String(dateStr).split('T')[0] + 'T00:00:00');
    if (String(shift) === 'Night') {
      const [h, addDay] = NIGHT_MAP[slot] || [0, 0];
      base.setDate(base.getDate() + addDay);
      base.setHours(h, 0, 0, 0);
    } else {
      base.setHours(DAY_END_HOUR[slot] || 0, 0, 0, 0);
    }
    const end = base;
    const start = new Date(end.getTime() - 3600000);
    return { slot, startIso: start.toISOString(), endIso: end.toISOString() };
  });
}

module.exports = { registerMachineDataRoutes, ensureSchema, PROFILES };
