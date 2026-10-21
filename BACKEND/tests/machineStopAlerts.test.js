'use strict';

const { runOnce, __test: t } = require('../src/modules/machineStopAlerts');

describe('DPR date and shift (IST)', () => {
  test.each([
    ['2026-10-21T03:00:00Z', '2026-10-21', 'Day'], // 08:30 IST
    ['2026-10-21T14:00:00Z', '2026-10-21', 'Night'], // 19:30 IST
    ['2026-10-21T20:00:00Z', '2026-10-21', 'Night'], // 01:30 IST next day → still the 21st's night
    ['2026-10-22T01:00:00Z', '2026-10-21', 'Night'] // 06:30 IST
  ])('%s → %s %s', (iso, date, shift) => {
    expect(t.dprNow(new Date(iso))).toEqual({ date, shift });
  });
});

describe('closed plants', () => {
  const info = { machine: 'B -L1-HYD-350-1', line: 'B -L1', building: 'B' };
  test('All, building or line closes the machine', () => {
    expect(t.plantClosed([{ plant: 'All', factory_id: 1 }], info, 1)).toBe(true);
    expect(t.plantClosed([{ plant: 'b', factory_id: null }], info, 1)).toBe(true);
    expect(t.plantClosed([{ plant: 'B -L1', factory_id: 1 }], info, 1)).toBe(true);
  });
  test('another plant or factory does not', () => {
    expect(t.plantClosed([{ plant: 'C', factory_id: 1 }], info, 1)).toBe(false);
    expect(t.plantClosed([{ plant: 'All', factory_id: 2 }], info, 1)).toBe(false);
    expect(t.plantClosed([], info, 1)).toBe(false);
  });
});

test('alert message tags the group and carries the alert meta', () => {
  const { body, meta } = t.alertMessage({
    machine: 'B -L1-HYD-350-1', factoryId: 1, reason: 'Manpower Shortage', mould: 'CAP 20',
    stoppedSince: '2026-10-21T04:00:00Z'
  }, 3, 'Factory 1');
  expect(body).toBe('@all ⛔ B -L1-HYD-350-1 (Factory 1) stopped for 3 h+ · Reason: Manpower Shortage');
  expect(meta.url).toBe('/dpr.html?view=summary');
  expect(meta.alert).toMatchObject({ type: 'machine_stop', machine: 'B -L1-HYD-350-1', hours: 3 });
  expect(meta.excerpt).toBe('Since 21 Oct, 09:30 · Reason: Manpower Shortage · Mould: CAP 20');
});

describe('runOnce', () => {
  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

  function fakePool({ group = true, seen = new Set(), closures = [] } = {}) {
    const inserted = [];
    const tasks = [];
    const client = {
      async query(sql, params) {
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
        if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ ok: true }] };
        if (sql.includes('to_regclass')) return { rows: [{ tasks: 'chat_tasks', convs: 'chat_conversations' }] };
        if (sql.includes('FROM chat_conversations')) return { rows: group ? [{ sync_id: 'conv-1' }] : [] };
        if (sql.includes('INSERT INTO chat_messages')) {
          if (seen.has(params[0])) return { rows: [] };
          seen.add(params[0]);
          inserted.push({ key: params[0], body: params[3], meta: JSON.parse(params[4]) });
          return { rows: [{ sync_id: `msg-${inserted.length}`, server_ts: new Date() }] };
        }
        if (sql.includes('INSERT INTO chat_tasks')) { tasks.push(params[0]); return { rows: [] }; }
        return { rows: [] };
      },
      release() {}
    };
    const q = async (sql) => {
      if (sql.includes('closed_plants')) return closures;
      if (sql.includes('FROM machines')) return [{ machine: 'B -L1-HYD-350-2', line: 'B -L1', building: 'B', factory_id: 1 }];
      if (sql.includes('FROM factories')) return [{ id: 1, name: 'Factory 1' }];
      return [];
    };
    return { pool: { connect: async () => client }, q, inserted, tasks, seen };
  }

  const stopped = () => [
    { machine: 'B -L1-HYD-350-1', factoryId: 1, stoppedSince: hoursAgo(3.5), reason: 'Mould Problem', powerCut: false },
    { machine: 'B -L1-HYD-350-2', factoryId: 1, stoppedSince: hoursAgo(4), reason: 'No entry / unknown', powerCut: false },
    { machine: 'B -L1-HYD-350-3', factoryId: 1, stoppedSince: hoursAgo(5), reason: 'Power Failure/Pre Heating', powerCut: true },
    { machine: 'B -L1-HYD-350-4', factoryId: 1, stoppedSince: hoursAgo(30), reason: 'No Plan', powerCut: false },
    { machine: 'B -L1-HYD-350-5', factoryId: 1, stoppedSince: null, reason: 'No production recorded', powerCut: false }
  ];

  test('posts one alert per stoppage, without power cuts, old or never-run machines', async () => {
    const f = fakePool();
    const calls = [];
    const list = stopped(); // stop times come from the DB, so they are the same each tick
    const computeStoppedMachines = async (...args) => { calls.push(args); return list.map((s) => ({ ...s })); };
    const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines });
    expect(calls[0]).toEqual([null, 180, 2]);
    expect(r.posted).toBe(2);
    expect(f.inserted.map((m) => m.meta.alert.machine)).toEqual(['B -L1-HYD-350-1', 'B -L1-HYD-350-2']);
    expect(f.tasks).toEqual(['msg-1', 'msg-2']);

    // the next tick finds the same stoppages: nothing new is posted
    const again = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines });
    expect(again.posted).toBe(0);
  });

  test('a closed plant gets no alert', async () => {
    const f = fakePool({ closures: [{ plant: 'B -L1', factory_id: 1 }] });
    const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines: async () => stopped() });
    // machine -1 is not in the machine master, so only -2 is matched to the closed line
    expect(f.inserted.map((m) => m.meta.alert.machine)).toEqual(['B -L1-HYD-350-1']);
    expect(r.posted).toBe(1);
  });

  test('does nothing when the "Moulding Alerts" group does not exist', async () => {
    const f = fakePool({ group: false });
    const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines: async () => stopped() });
    expect(r).toEqual({ posted: 0, skipped: 'no group' });
  });
});
