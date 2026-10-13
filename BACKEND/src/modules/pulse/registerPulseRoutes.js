'use strict';

/**
 * Pulse module - the machine-wise live job tracker behind PUBLIC/pulse.html.
 *
 * One endpoint, GET /api/machines/live-tracker, answering the question the
 * existing dashboards do not: for the shift running right now, what is each
 * machine making, how far along is it, and is it ahead or behind?
 *
 * It deliberately reuses the sources the rest of the system already trusts
 * rather than inventing its own numbers:
 *   - dpr_hourly        hourly good/reject/downtime + entry_type (the stop reasons)
 *   - plan_board        which job card is on the machine, and its job quantity
 *   - moulds            pcs_per_hour (the standard rate) and manpower (std)
 *   - std_actual        man_act, the manpower actually on the machine this shift
 *   - machines          the active machine list and its line, for ordering
 *
 * Two progress bases are returned per machine, because they answer different
 * questions and supervisors and planners each want one:
 *   shift  - output against the standard rate for the hours elapsed this shift.
 *            This drives the state label, the variance % and the curve.
 *   job    - cumulative output on the running plan against its job quantity,
 *            which spans shifts. Secondary, shown on the detail card.
 *
 * Everything is read-only; five queries, then the per-machine arithmetic in JS
 * so the SQL stays legible and no LATERAL fan-out can multiply quantities.
 */

const { getFactoryId } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');

/* Shift slot labels, matching the arrays the DPR pages and the legacy routes
   use. Both shifts run 12 hours: Day 08:00-20:00, Night 20:00-08:00. */
const DAY_SLOTS = ['08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
const NIGHT_SLOTS = ['20-21', '21-22', '22-23', '23-00', '00-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
const DAY_BASES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const NIGHT_BASES = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];

/* entry_type values that mean the machine was not producing. Same set the
   legacy /api/machines/live-status uses. */
const STOP_STATES = {
  Maintenance: 'DOWN',
  MouldMaintenance: 'DOWN',
  MouldTrial: 'DOWN',
  MouldChangeover: 'CHANGEOVER',
  ManPowerShortage: 'STARVED',
  NoPlan: 'NOPLAN'
};
const STOP_LABELS = {
  Maintenance: 'Maintenance',
  MouldMaintenance: 'Mould Maintenance',
  MouldTrial: 'Mould Trial',
  MouldChangeover: 'Mould Changeover',
  ManPowerShortage: 'Man Power Shortage',
  NoPlan: 'No Plan'
};

const REJECT_LIMIT_PCT = 4;   /* reject % at or above this is a REJECT SPIKE */
const SLOW_RATE_FRAC = 0.9;   /* running below this fraction of std is SLIPPING */
const FAST_RATE_FRAC = 1.02;  /* above this while behind on qty is CATCHING UP */
const AHEAD_VARIANCE = 2;     /* variance % at or above this is AHEAD */

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * The DPR date and shift in progress right now, by the same rule the legacy
 * live-status route uses: the night shift that starts at 20:00 keeps the
 * previous day's DPR date through to 08:00.
 */
function currentShiftWindow(now) {
  const hr = now.getHours();
  const isNight = hr >= 20 || hr < 8;
  let d = now;
  if (isNight && hr < 8) {
    d = new Date(now);
    d.setDate(d.getDate() - 1);
  }
  const slots = isNight ? NIGHT_SLOTS : DAY_SLOTS;
  const bases = isNight ? NIGHT_BASES : DAY_BASES;
  const idx = bases.indexOf(hr);
  return {
    dprDate: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    shift: isNight ? 'Night' : 'Day',
    slots,
    /* slots that have fully or partly run; at least 1 so the first hour of a
       shift still produces a curve point instead of dividing by zero */
    elapsed: Math.max(1, (idx === -1 ? slots.length : idx) + 1)
  };
}

/* Line, then machine number - the standard DPR Compliance order. */
function machineSort(a, b) {
  const line = String(a.line || '').localeCompare(String(b.line || ''), undefined, { numeric: true });
  if (line) return line;
  return String(a.machine || '').localeCompare(String(b.machine || ''), undefined, { numeric: true });
}

const key = (s) => String(s || '').trim().toUpperCase();
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

const MACHINES_SQL = `
  SELECT machine, line
    FROM machines
   WHERE COALESCE(is_active, TRUE) = TRUE
     AND COALESCE(NULLIF(TRIM(machine_process), ''), 'Moulding') = 'Moulding'
     AND ($1::int IS NULL OR factory_id = $1)`;

const HOURLY_SQL = `
  SELECT TRIM(machine) AS machine, hour_slot, entry_type, plan_id,
         TRIM(COALESCE(mould_no, '')) AS mould_no,
         COALESCE(good_qty, 0)     AS good_qty,
         COALESCE(reject_qty, 0)   AS reject_qty,
         COALESCE(downtime_min, 0) AS downtime_min,
         remarks, id
    FROM dpr_hourly
   WHERE dpr_date = $1::date AND shift = $2 AND is_deleted = false
     AND ($3::int IS NULL OR factory_id = $3 OR factory_id IS NULL)
   ORDER BY machine, id ASC`;

/* The plan currently on each machine: RUNNING first, then plan order. The
   produced total is the whole job card's output to date, across shifts. */
const PLAN_SQL = `
  SELECT DISTINCT ON (TRIM(UPPER(pb.machine)))
         TRIM(UPPER(pb.machine))                                   AS machine_key,
         pb.plan_id, pb.order_no, pb.status,
         COALESCE(NULLIF(TRIM(pb.job_card_no), ''), '')            AS job_card_no,
         COALESCE(NULLIF(TRIM(pb.mould_name), ''), pb.mould_code, '') AS mould_name,
         TRIM(COALESCE(pb.mould_code, ''))                         AS mould_code,
         COALESCE(pb.plan_qty, 0)::int                             AS plan_qty,
         COALESCE(o.client_name, '')                               AS client_name,
         COALESCE(tot.produced, 0)::int                            AS job_done
    FROM plan_board pb
    LEFT JOIN orders o ON TRIM(o.order_no) = TRIM(pb.order_no)
    LEFT JOIN LATERAL (
      SELECT SUM(good_qty) AS produced
        FROM dpr_hourly dh
       WHERE (dh.plan_id = pb.plan_id OR CAST(dh.plan_id AS TEXT) = CAST(pb.id AS TEXT))
         AND (dh.factory_id = pb.factory_id OR dh.factory_id IS NULL OR pb.factory_id IS NULL)
         AND dh.is_deleted = false
    ) tot ON true
   WHERE pb.status NOT IN ('REJECTED', 'COMPLETED')
     AND ($1::int IS NULL OR pb.factory_id = $1)
   ORDER BY TRIM(UPPER(pb.machine)),
            CASE pb.status WHEN 'RUNNING' THEN 0 ELSE 1 END,
            pb.seq ASC NULLS LAST,
            pb.created_at DESC NULLS LAST`;

/* Standard rate and manpower come from the mould master, keyed either by the
   mould number stamped on the hourly rows or by the plan's mould code/name. */
const MOULDS_SQL = `
  SELECT TRIM(COALESCE(mould_number, '')) AS mould_number,
         TRIM(COALESCE(mould_name, ''))   AS mould_name,
         COALESCE(pcs_per_hour, 0)        AS pcs_per_hour,
         manpower
    FROM moulds`;

/* Manpower actually on the machine this shift: the latest setup, with a setup
   that has manpower entered beating a newer one that does not. Same rule as
   the DPR Compliance / Manpower reports. */
const MANPOWER_SQL = `
  SELECT DISTINCT ON (TRIM(UPPER(machine))) TRIM(UPPER(machine)) AS machine_key,
         man_act, mould_name, plan_id
    FROM std_actual
   WHERE dpr_date = $1::date AND shift = $2
     AND COALESCE(is_deleted, false) = false
     AND machine IS NOT NULL AND TRIM(machine) <> ''
     AND ($3::int IS NULL OR factory_id = $3 OR factory_id IS NULL)
   ORDER BY TRIM(UPPER(machine)), (man_act IS NULL), id DESC`;

/**
 * Decide the state label for one machine. Order matters: a stopped machine is
 * described by why it stopped, and only a running machine is judged on rate.
 */
function deriveState(m) {
  if (m.stop_state) return m.stop_state;
  if (!m.job_card_no && !m.plan_id && m.done === 0) return 'NOPLAN';
  if (!m.std_rate) return m.done > 0 ? 'ONTRACK' : 'NOPLAN';

  if (m.reject_pct >= REJECT_LIMIT_PCT) return 'REJECT';
  if (m.std_manpower && m.act_manpower && m.act_manpower < m.std_manpower) return 'STARVED';
  if (m.rate < m.std_rate * SLOW_RATE_FRAC) return 'SLIPPING';
  if (m.variance < 0 && m.rate > m.std_rate * FAST_RATE_FRAC) return 'CATCHING';
  if (m.variance >= AHEAD_VARIANCE) return 'AHEAD';
  return 'ONTRACK';
}

function buildTracker(rows, win) {
  const { machines, hourly, plans, moulds, manpower } = rows;
  const slotIndex = new Map(win.slots.map((s, i) => [s, i]));

  const mouldByNumber = new Map();
  const mouldByName = new Map();
  for (const md of moulds) {
    if (md.mould_number) mouldByNumber.set(key(md.mould_number), md);
    if (md.mould_name && !mouldByName.has(key(md.mould_name))) mouldByName.set(key(md.mould_name), md);
  }
  const planByMachine = new Map(plans.map((p) => [p.machine_key, p]));
  const manByMachine = new Map(manpower.map((p) => [p.machine_key, p]));

  /* Group the shift's hourly rows per machine. A machine can have several rows
     for one slot (split entries); they add up. */
  const hourlyByMachine = new Map();
  for (const h of hourly) {
    const k = key(h.machine);
    if (!k) continue;
    let a = hourlyByMachine.get(k);
    if (!a) { a = []; hourlyByMachine.set(k, a); }
    a.push(h);
  }

  /* A machine with production but no row in `machines` (renamed, or another
     process) still deserves a tile, so seed the list from both sides. */
  const seen = new Set(machines.map((r) => key(r.machine)));
  const list = machines.slice();
  for (const k of hourlyByMachine.keys()) {
    if (!seen.has(k)) { list.push({ machine: k, line: '' }); seen.add(k); }
  }

  const out = list.sort(machineSort).map((row) => {
    const k = key(row.machine);
    const hrs = hourlyByMachine.get(k) || [];
    const plan = planByMachine.get(k) || null;
    const man = manByMachine.get(k) || null;

    /* per-slot good quantity for the shift's 12 slots */
    const perSlot = new Array(win.slots.length).fill(null);
    let good = 0, reject = 0, downtime = 0, lastRow = null, lastMould = '';
    for (const h of hrs) {
      const i = slotIndex.has(h.hour_slot) ? slotIndex.get(h.hour_slot) : -1;
      if (i >= 0) perSlot[i] = (perSlot[i] || 0) + num(h.good_qty);
      good += num(h.good_qty);
      reject += num(h.reject_qty);
      downtime += num(h.downtime_min);
      lastRow = h;
      if (h.mould_no) lastMould = h.mould_no;
    }

    const mould = mouldByNumber.get(key(lastMould))
      || (plan && (mouldByNumber.get(key(plan.mould_code)) || mouldByName.get(key(plan.mould_name))))
      || (man && mouldByName.get(key(man.mould_name)))
      || null;
    const stdRate = mould ? num(mould.pcs_per_hour) : 0;

    /* cumulative output as a % of what the standard rate should have produced
       by the end of each elapsed hour; 100 = exactly on plan */
    const cum = [];
    let run = 0;
    for (let i = 0; i < win.elapsed; i++) {
      run += perSlot[i] || 0;
      cum.push(stdRate > 0 ? +(run / (stdRate * (i + 1)) * 100).toFixed(1) : null);
    }

    /* current rate: the mean of the last two slots that carry a figure, so one
       part-finished hour does not read as a collapse */
    const recent = [];
    for (let i = win.elapsed - 1; i >= 0 && recent.length < 2; i--) {
      if (perSlot[i] !== null) recent.push(perSlot[i]);
    }
    const rate = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;

    const stopState = lastRow && STOP_STATES[lastRow.entry_type] ? STOP_STATES[lastRow.entry_type] : null;
    const lastCum = cum.length ? cum[cum.length - 1] : null;
    const gross = good + reject;

    const m = {
      machine: row.machine,
      line: row.line || '',
      /* shift basis - drives the state, the variance and the curve */
      std_rate: stdRate,
      shift_plan_qty: stdRate > 0 ? stdRate * win.slots.length : 0,
      done: good,
      reject,
      reject_pct: gross > 0 ? +(reject / gross * 100).toFixed(1) : 0,
      downtime_min: Math.round(downtime),
      rate,
      cum,
      variance: lastCum === null ? null : +(lastCum - 100).toFixed(1),
      /* job basis - secondary, spans shifts */
      plan_id: plan ? plan.plan_id : null,
      job_card_no: plan ? (plan.job_card_no || null) : null,
      order_no: plan ? plan.order_no : null,
      client_name: plan ? plan.client_name : null,
      product: plan ? plan.mould_name : null,
      job_qty: plan ? plan.plan_qty : 0,
      job_done: plan ? plan.job_done : 0,
      job_pct: plan && plan.plan_qty > 0 ? Math.round(plan.job_done / plan.plan_qty * 100) : null,
      /* manpower */
      act_manpower: man && man.man_act !== null && man.man_act !== undefined ? Number(man.man_act) : null,
      std_manpower: mould && mould.manpower !== null && mould.manpower !== undefined ? Number(mould.manpower) : null,
      /* stop reason, straight from the last hourly entry */
      stop_state: stopState,
      stop_reason: lastRow && STOP_LABELS[lastRow.entry_type] ? STOP_LABELS[lastRow.entry_type] : null,
      remarks: lastRow ? lastRow.remarks || null : null,
      last_slot: lastRow ? lastRow.hour_slot : null
    };

    m.state = deriveState(m);
    /* eta for the shift's remaining quantity at the current rate */
    const remaining = m.shift_plan_qty - m.done;
    m.eta_min = m.rate > 0 && remaining > 0 ? Math.round(remaining / m.rate * 60) : null;
    return m;
  });

  return out;
}

function registerPulseRoutes(app, pool) {
  app.get('/api/machines/live-tracker', async (req, res) => {
    try {
      const factoryId = getFactoryId(req) || null;
      const win = currentShiftWindow(new Date());

      const [machines, hourly, plans, moulds, manpower] = await Promise.all([
        pool.query(MACHINES_SQL, [factoryId]),
        pool.query(HOURLY_SQL, [win.dprDate, win.shift, factoryId]),
        pool.query(PLAN_SQL, [factoryId]),
        pool.query(MOULDS_SQL),
        pool.query(MANPOWER_SQL, [win.dprDate, win.shift, factoryId])
      ]);

      const data = buildTracker({
        machines: machines.rows,
        hourly: hourly.rows,
        plans: plans.rows,
        moulds: moulds.rows,
        manpower: manpower.rows
      }, win);

      res.json({
        ok: true,
        date: win.dprDate,
        shift: win.shift,
        slots: win.slots,
        elapsed: win.elapsed,
        server_time: new Date().toISOString(),
        data
      });
    } catch (e) {
      console.error('[live-tracker]', e);
      sendServerError(res, e);
    }
  });
}

module.exports = {
  registerPulseRoutes,
  /* exported for tests */
  buildTracker,
  currentShiftWindow,
  deriveState,
  MACHINES_SQL,
  HOURLY_SQL,
  PLAN_SQL,
  MOULDS_SQL,
  MANPOWER_SQL
};
