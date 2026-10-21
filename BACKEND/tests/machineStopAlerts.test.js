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
      if (sql.includes('FROM machines')) {
        return [
          { machine: 'B -L1-HYD-350-2', line: 'B -L1', building: 'B', factory_id: 1 },
          { machine: 'S-HYD-180-1', line: 'S -L1', building: 'S', factory_id: 2 }
        ];
      }
      if (sql.includes('FROM factories')) return [{ id: 1, name: 'Unit-I' }, { id: 2, name: 'Shivani' }, { id: 4, name: 'Unit-II' }];
      return [];
    };
    return { pool: { connect: async () => client }, q, inserted, tasks, seen };
  }

  const stopped = () => [
    { machine: 'B -L1-HYD-350-1', factoryId: 1, stoppedSince: hoursAgo(3.5), reason: 'Mould Problem', powerCut: false },
    { machine: 'B -L1-HYD-350-2', factoryId: 1, stoppedSince: hoursAgo(4), reason: 'No entry / unknown', powerCut: false },
    { machine: 'B -L1-HYD-350-3', factoryId: 1, stoppedSince: hoursAgo(5), reason: 'Power Failure/Pre Heating', powerCut: true },
    { machine: 'B -L1-HYD-350-4', factoryId: 1, stoppedSince: hoursAgo(30), reason: 'No Plan', powerCut: false },
    { machine: 'B -L1-HYD-350-5', factoryId: 1, stoppedSince: null, reason: 'No production recorded', powerCut: false },
    // a Shivani machine that turns up in Unit-I's result (plan with no factory) → dropped
    { machine: 'S-HYD-180-1', factoryId: null, stoppedSince: hoursAgo(4), reason: 'No entry / unknown', powerCut: false }
  ];
  const unit2 = () => [{ machine: 'F-L1-HAI-250-1', factoryId: 4, stoppedSince: hoursAgo(3.2), reason: 'Material Shortage', powerCut: false }];
  const shivani = () => [{ machine: 'S-HYD-180-2', factoryId: 2, stoppedSince: hoursAgo(6), reason: 'Mould Problem', powerCut: false }];
  const byFactory = (fid) => (fid === 1 ? stopped() : fid === 4 ? unit2() : fid === 2 ? shivani() : []);

  test('posts one alert per stoppage, without power cuts, old or never-run machines', async () => {
    const f = fakePool();
    const calls = [];
    const lists = { 1: stopped(), 4: unit2(), 2: shivani() }; // stop times come from the DB: same each tick
    const computeStoppedMachines = async (...args) => { calls.push(args); return (lists[args[0]] || []).map((s) => ({ ...s })); };
    const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines });
    // only Dungra Unit-I (1) and Unit-II (4) are looked at, each on its own
    expect(calls).toEqual([[1, 180, 2], [4, 180, 2]]);
    expect(r.posted).toBe(3);
    expect(f.inserted.map((m) => m.meta.alert.machine)).toEqual(['B -L1-HYD-350-1', 'B -L1-HYD-350-2', 'F-L1-HAI-250-1']);
    expect(f.inserted.map((m) => m.meta.factory_id)).toEqual([1, 1, 4]);
    expect(f.inserted[2].body).toContain('(Unit-II)');
    expect(f.tasks).toEqual(['msg-1', 'msg-2', 'msg-3']);

    // the next tick finds the same stoppages: nothing new is posted
    const again = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines });
    expect(again.posted).toBe(0);
  });

  test('a closed plant gets no alert', async () => {
    const f = fakePool({ closures: [{ plant: 'B -L1', factory_id: 1 }] });
    const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines: async (fid) => (fid === 1 ? stopped() : []) });
    // machine -1 is not in the machine master, so only -2 is matched to the closed line
    expect(f.inserted.map((m) => m.meta.alert.machine)).toEqual(['B -L1-HYD-350-1']);
    expect(r.posted).toBe(1);
  });

  test('MACHINE_STOP_ALERT_FACTORIES picks other factories', async () => {
    process.env.MACHINE_STOP_ALERT_FACTORIES = '2';
    try {
      const f = fakePool();
      const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines: async (fid) => byFactory(fid) });
      expect(f.inserted.map((m) => m.meta.alert.machine)).toEqual(['S-HYD-180-2']);
      expect(r.posted).toBe(1);
    } finally { delete process.env.MACHINE_STOP_ALERT_FACTORIES; }
  });

  test('does nothing when the "Moulding Alerts" group does not exist', async () => {
    const f = fakePool({ group: false });
    const r = await runOnce({ pool: f.pool, q: f.q, computeStoppedMachines: async () => stopped() });
    expect(r).toEqual({ posted: 0, skipped: 'no group' });
  });
});
