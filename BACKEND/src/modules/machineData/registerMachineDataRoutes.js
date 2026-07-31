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
    // One row per completed shot (machine PROC-1 style log). Keyed by
    // (machine_id, cycle_count) so repeated reads of the same shot don't dup.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS machine_cycles (
        id            BIGSERIAL PRIMARY KEY,
        machine_id    INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        cycle_count   BIGINT  NOT NULL,
        recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cycle_time_s  NUMERIC,
        fill_time_s   NUMERIC,
        refill_time_s NUMERIC,
        xfer_pos      NUMERIC,
        cushion_pos   NUMERIC,
        iu_fwd_s      NUMERIC,
        iu_ret_s      NUMERIC,
        raw_json      JSONB,
        UNIQUE (machine_id, cycle_count)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_machine_cycles_machine_count
        ON machine_cycles (machine_id, cycle_count DESC);
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

// Max plausible counter increase between two consecutive polls. Poll interval is
// a few seconds and cycles are 20s+, so a real gap is small; a jump larger than
// this means a counter reset or re-definition (not real production) and is
// ignored so it can't inflate an hour's total. Production per hour is computed
// as the SUM of plausible per-poll increments, which is robust to resets.
const MAX_SHOT_DELTA = 200;

// A real injection cycle is well under 10 minutes; anything above is a decode
// glitch (e.g. a bad TIME read) and is excluded from cycle-time stats.
const MAX_CYCLE_S = 600;

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

  // --- Per-shot cycle log (machine PROC-1 style) ----------------------------
  // Collector posts one record per completed shot (when cycle_count increments).
  router.post('/cycle-ingest', async (req, res) => {
    if (!ingestKey() || req.get('x-ingest-key') !== ingestKey()) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const b = req.body || {};
    const machineId = parseInt(b.machine_id, 10);
    const cycleCount = pickInt(b.cycle_count);
    const v = b.values || {};
    if (!Number.isInteger(machineId) || cycleCount == null) {
      return res.status(400).json({ ok: false, error: 'machine_id and cycle_count required' });
    }
    try {
      await pool.query(`
        INSERT INTO machine_cycles
          (machine_id, cycle_count, recorded_at, cycle_time_s, fill_time_s,
           refill_time_s, xfer_pos, cushion_pos, iu_fwd_s, iu_ret_s, raw_json)
        VALUES ($1,$2, COALESCE($3::timestamptz, NOW()), $4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (machine_id, cycle_count) DO NOTHING
      `, [
        machineId, cycleCount, b.recorded_at || null,
        pickNum(v.cycle_time_act), pickNum(v.injection_time), pickNum(v.refill_time),
        pickNum(v.vp_position), pickNum(v.cushion_position),
        pickNum(v.unit_fwd_time), pickNum(v.unit_ret_time),
        JSON.stringify(v),
      ]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Hourly production for a machine on a date (machine HR-PRC style):
  // pieces produced each clock hour (counter delta) + avg cycle. Local-time hours.
  router.get('/:machineId/hourly', async (req, res) => {
    const machineId = parseInt(req.params.machineId, 10);
    const date = String(req.query.date || '').trim();
    if (!Number.isInteger(machineId) || !date) {
      return res.status(400).json({ ok: false, error: 'machineId and date required' });
    }
    try {
      const base = new Date(date.split('T')[0] + 'T00:00:00');
      if (Number.isNaN(base.getTime())) return res.status(400).json({ ok: false, error: 'bad date' });
      const hours = [];
      for (let h = 0; h < 24; h++) {
        const start = new Date(base.getTime()); start.setHours(h, 0, 0, 0);
        const end = new Date(start.getTime() + 3600000);
        const { rows } = await pool.query(`
          WITH win AS (
            SELECT cycle_time_s,
                   good_shots - LAG(good_shots) OVER (ORDER BY recorded_at) AS delta,
                   bad_shots  - LAG(bad_shots)  OVER (ORDER BY recorded_at) AS bdelta
              FROM machine_readings
             WHERE machine_id=$1 AND recorded_at>=$2 AND recorded_at<$3
               AND good_shots IS NOT NULL AND good_shots > 0)
          SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0 AND delta <= ${MAX_SHOT_DELTA}), 0) AS produced,
                 COALESCE(SUM(bdelta) FILTER (WHERE bdelta > 0 AND bdelta <= ${MAX_SHOT_DELTA}), 0) AS rejected,
                 ROUND(AVG(cycle_time_s) FILTER (WHERE cycle_time_s > 0 AND cycle_time_s < ${MAX_CYCLE_S})::numeric, 1) AS avgcyc,
                 ROUND(MAX(cycle_time_s) FILTER (WHERE cycle_time_s > 0 AND cycle_time_s < ${MAX_CYCLE_S})::numeric, 1) AS maxcyc,
                 ROUND(MIN(cycle_time_s) FILTER (WHERE cycle_time_s > 0 AND cycle_time_s < ${MAX_CYCLE_S})::numeric, 1) AS mincyc
            FROM win
        `, [machineId, start.toISOString(), end.toISOString()]);
        const r = rows[0] || {};
        const produced = Number(r.produced || 0);
        hours.push({
          hour: h, produced, rejected: Number(r.rejected || 0),
          avg_cycle: r.avgcyc != null ? Number(r.avgcyc) : null,
          max_cycle: r.maxcyc != null ? Number(r.maxcyc) : null,
          min_cycle: r.mincyc != null ? Number(r.mincyc) : null,
        });
      }
      const total = hours.reduce((a, b) => a + b.produced, 0);
      const totalReject = hours.reduce((a, b) => a + b.rejected, 0);
      const active = hours.filter(x => x.produced > 0);
      const avgPerHour = active.length ? Math.round(total / active.length) : 0;
      const peak = hours.reduce((m, x) => x.produced > m.produced ? x : m, { produced: 0, hour: null });
      const worst = active.length ? active.reduce((m, x) => x.produced < m.produced ? x : m, active[0]) : { produced: null, hour: null };
      const idleHours = active.length ? (24 - active.length) : 24;
      const rejectRate = (total + totalReject) > 0 ? Math.round((totalReject / (total + totalReject)) * 1000) / 10 : 0;
      // consistency: % of active hours whose output is within 15% of the mean
      const withinBand = active.filter(x => avgPerHour > 0 && Math.abs(x.produced - avgPerHour) <= avgPerHour * 0.15).length;
      const consistency = active.length ? Math.round((withinBand / active.length) * 100) : null;
      // Cycle-time analysis across the day
      const cyHours = hours.filter(x => x.avg_cycle != null);
      const avgCycle = cyHours.length ? Math.round((cyHours.reduce((a, b) => a + b.avg_cycle, 0) / cyHours.length) * 10) / 10 : null;
      const peakCycleHour = hours.reduce((m, x) => (x.max_cycle != null && x.max_cycle > (m.max_cycle || 0)) ? x : m, { max_cycle: null, hour: null });
      const minCycle = cyHours.length ? Math.min.apply(null, cyHours.map(x => x.min_cycle).filter(v => v != null)) : null;
      res.json({
        ok: true, date, hours, total, avgPerHour,
        peakHour: peak.hour, peakQty: peak.produced,
        worstHour: worst.hour, worstQty: worst.produced,
        totalReject, rejectRate, idleHours, activeHours: active.length, consistency,
        avgCycle, peakCycle: peakCycleHour.max_cycle, peakCycleHour: peakCycleHour.hour, minCycle,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Efficiency / downtime / OEE analysis for a machine on a date.
  // Downtime is INFERRED from counter stalls (the run/stop register isn't
  // published by this gateway), so a stretch with no new shot for longer than
  // the idle threshold counts as downtime.
  router.get('/:machineId/analysis', async (req, res) => {
    const machineId = parseInt(req.params.machineId, 10);
    const date = String(req.query.date || '').trim();
    if (!Number.isInteger(machineId) || !date) {
      return res.status(400).json({ ok: false, error: 'machineId and date required' });
    }
    try {
      const base = new Date(date.split('T')[0] + 'T00:00:00');
      if (Number.isNaN(base.getTime())) return res.status(400).json({ ok: false, error: 'bad date' });
      const dayStart = new Date(base); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600000);
      const { rows } = await pool.query(`
        SELECT EXTRACT(EPOCH FROM recorded_at) AS t, good_shots, bad_shots, cycle_time_s
          FROM machine_readings
         WHERE machine_id=$1 AND recorded_at>=$2 AND recorded_at<$3 AND good_shots > 0
         ORDER BY recorded_at
      `, [machineId, dayStart.toISOString(), dayEnd.toISOString()]);

      if (rows.length < 2) {
        return res.json({ ok: true, date, hasData: false });
      }
      // production, reject, cycle stats (robust)
      let good = 0, bad = 0, cycSum = 0;
      const cycles = [];
      for (let i = 1; i < rows.length; i++) {
        const gd = Number(rows[i].good_shots) - Number(rows[i - 1].good_shots);
        if (gd > 0 && gd <= MAX_SHOT_DELTA) good += gd;
        const bd = Number(rows[i].bad_shots) - Number(rows[i - 1].bad_shots);
        if (bd > 0 && bd <= MAX_SHOT_DELTA) bad += bd;
      }
      for (const r of rows) {
        const c = Number(r.cycle_time_s);
        if (c > 0 && c < MAX_CYCLE_S) { cycSum += c; cycles.push(c); }
      }
      const avgCycle = cycles.length ? cycSum / cycles.length : null;
      // Ideal cycle = 10th-percentile cycle (a sustainable best), floored to 60%
      // of average so a single glitchy-fast reading can't tank Performance.
      let idealCycle = avgCycle;
      if (cycles.length) {
        const sorted = cycles.slice().sort((a, b) => a - b);
        const p10 = sorted[Math.floor(sorted.length * 0.1)];
        idealCycle = Math.max(p10, (avgCycle || p10) * 0.6);
      }

      // Downtime: flat-counter stretches longer than the idle threshold.
      const spanS = Number(rows[rows.length - 1].t) - Number(rows[0].t);
      const idleThresh = Math.max(120, (avgCycle || 40) * 3); // seconds
      let downtime = 0; const stops = [];
      let flatStart = Number(rows[0].t), prevGood = Number(rows[0].good_shots);
      const closeStop = (endT) => {
        const dur = endT - flatStart;
        if (dur > idleThresh) { downtime += dur; stops.push({ start: flatStart, end: endT, dur: Math.round(dur) }); }
      };
      for (let i = 1; i < rows.length; i++) {
        const g = Number(rows[i].good_shots), t = Number(rows[i].t);
        if (g > prevGood && g - prevGood <= MAX_SHOT_DELTA) { closeStop(t); flatStart = t; prevGood = g; }
        else if (g > prevGood) { prevGood = g; flatStart = t; } // counter jump/reset: reset baseline
      }
      closeStop(Number(rows[rows.length - 1].t)); // trailing stall
      const uptime = Math.max(0, spanS - downtime);

      // OEE = Availability × Performance × Quality
      const availability = spanS > 0 ? uptime / spanS : 0;
      const performance = (idealCycle && uptime > 0) ? Math.min(1, (idealCycle * good) / uptime) : 0;
      const quality = (good + bad) > 0 ? good / (good + bad) : 1;
      const oee = availability * performance * quality;
      const pct = (x) => Math.round(x * 1000) / 10;
      const longest = stops.reduce((m, s) => s.dur > m ? s.dur : m, 0);

      res.json({
        ok: true, date, hasData: true,
        good, bad,
        avgCycle: avgCycle != null ? Math.round(avgCycle * 10) / 10 : null,
        idealCycle: idealCycle != null ? Math.round(idealCycle * 10) / 10 : null,
        spanMin: Math.round(spanS / 60), uptimeMin: Math.round(uptime / 60), downtimeMin: Math.round(downtime / 60),
        stops: stops.length, longestStopMin: Math.round(longest / 60),
        availability: pct(availability), performance: pct(performance), quality: pct(quality), oee: pct(oee),
        events: stops.slice(-12).reverse().map(s => ({
          from: new Date(s.start * 1000).toISOString(),
          to: new Date(s.end * 1000).toISOString(),
          min: Math.round(s.dur / 60 * 10) / 10,
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Recent shots for the monitor table (newest first).
  router.get('/:machineId/cycles', async (req, res) => {
    const machineId = parseInt(req.params.machineId, 10);
    if (!Number.isInteger(machineId)) return res.status(400).json({ ok: false, error: 'invalid machineId' });
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 40));
    try {
      const { rows } = await pool.query(`
        SELECT cycle_count, recorded_at, cycle_time_s, fill_time_s, refill_time_s,
               xfer_pos, cushion_pos, iu_fwd_s, iu_ret_s
          FROM machine_cycles WHERE machine_id=$1
         ORDER BY cycle_count DESC LIMIT $2
      `, [machineId, limit]);
      res.json({ ok: true, cycles: rows });
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
            SELECT cycle_time_s,
                   good_shots - LAG(good_shots) OVER (ORDER BY recorded_at) AS gdelta,
                   bad_shots  - LAG(bad_shots)  OVER (ORDER BY recorded_at) AS bdelta
              FROM machine_readings
             WHERE machine_id = $1 AND recorded_at >= $2 AND recorded_at < $3
               AND good_shots IS NOT NULL AND good_shots > 0
          )
          SELECT
            SUM(gdelta) FILTER (WHERE gdelta > 0 AND gdelta <= ${MAX_SHOT_DELTA}) AS good_delta,
            SUM(bdelta) FILTER (WHERE bdelta > 0 AND bdelta <= ${MAX_SHOT_DELTA}) AS bad_delta,
            ROUND(AVG(cycle_time_s) FILTER (WHERE cycle_time_s > 0 AND cycle_time_s < ${MAX_CYCLE_S})::numeric, 2) AS cyc_avg,
            COUNT(*) AS n
          FROM win
        `, [machineId, s.startIso, s.endIso]);
        const r = rows[0] || {};
        const autoGood = r.good_delta != null ? Number(r.good_delta) : null;
        const autoRej = r.bad_delta != null ? Number(r.bad_delta) : null;

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
                 NULLIF(raw_json->>'shot_weight','')::numeric AS shot_weight,
                 good_shots - LAG(good_shots) OVER (ORDER BY recorded_at) AS delta
            FROM machine_readings
           WHERE machine_id=$1 AND recorded_at>=$2 AND recorded_at<$3
        )
        SELECT
          (SELECT good_shots  FROM win WHERE good_shots > 0 ORDER BY recorded_at DESC LIMIT 1) AS good_last,
          (SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0 AND delta <= ${MAX_SHOT_DELTA}), 0) FROM win) AS produced_delta,
          (SELECT cycle_time_s FROM win WHERE cycle_time_s > 0 AND cycle_time_s < ${MAX_CYCLE_S} ORDER BY recorded_at DESC LIMIT 1) AS cycle_last,
          (SELECT ROUND(AVG(cycle_time_s)::numeric, 2) FROM win WHERE cycle_time_s > 0 AND cycle_time_s < ${MAX_CYCLE_S}) AS cycle_avg,
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
      const produced = Number(r.produced_delta || 0);

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
              SELECT cycle_time_s,
                     good_shots - LAG(good_shots) OVER (ORDER BY recorded_at) AS delta
                FROM machine_readings
               WHERE machine_id=$1 AND recorded_at>=$2 AND recorded_at<$3
                 AND good_shots IS NOT NULL AND good_shots > 0)
            SELECT SUM(delta) FILTER (WHERE delta > 0 AND delta <= ${MAX_SHOT_DELTA}) AS good,
                   ROUND(AVG(cycle_time_s) FILTER (WHERE cycle_time_s>0 AND cycle_time_s<${MAX_CYCLE_S})::numeric,2) AS cyc
              FROM win
          `, [row.machine_id, s.startIso, s.endIso]);
          const r = rows[0] || {};
          const good = r.good != null ? Number(r.good) : null;
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
