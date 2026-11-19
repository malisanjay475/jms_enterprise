'use strict';

const reports = require('../src/modules/packing/registerPackingReportRoutes');

/* Collects the routes the module registers so a handler can be called directly. */
function fakeApp() {
  const routes = {};
  return { routes, get: (path, fn) => { routes[path] = fn; } };
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader() {}, send(b) { this.body = b; return this; }
  };
}

function poolFor(dailyRows) {
  return {
    query: async (sql) => {
      if (/to_regclass/.test(sql)) return { rows: [{ jr: 'or_jr_report', locks: 'packing_lock_events', scans: 'assembly_scans', std: 'packing_item_standards' }] };
      if (/WITH s AS/.test(sql)) return { rows: dailyRows };
      return { rows: [] };
    }
  };
}

describe('packing reports - filters', () => {
  test('defaults to the last 7 days and swaps a reversed range', () => {
    const f = reports.readFilters({ from: '2026-11-19', to: '2026-11-13' });
    expect(f).toMatchObject({ from: '2026-11-13', to: '2026-11-13', days: 1 });
    const d = reports.readFilters({ to: '2026-11-19' });
    expect(d).toMatchObject({ from: '2026-11-13', to: '2026-11-19', days: 7 });
  });

  test('refuses more than 92 days', () => {
    expect(() => reports.readFilters({ from: '2026-01-01', to: '2026-11-19' })).toThrow(/92 days/);
  });

  test('ignores bad dates and trims station / party', () => {
    const f = reports.readFilters({ from: "2026-11-01'; DROP", to: '2026-11-05', station: '  B1 ', party: ' ' });
    expect(f.from).toBe('2026-10-30');
    expect(f.station).toBe('B1');
    expect(f.party).toBeNull();
  });

  test('minutes read as hours and minutes', () => {
    expect(reports.minText(45)).toBe('45 m');
    expect(reports.minText(435)).toBe('7 h 15 m');
    expect(reports.minText(null)).toBe('');
  });
});

describe('packing reports - daily summary maths', () => {
  test('working time excludes idle, efficiency = earned / working', async () => {
    const app = fakeApp();
    /* 09:00-17:00 = 480 min span, 45 min idle -> 435 min working; 2,900 pcs at 7.5 s = 21,750 s earned */
    reports.registerPackingReportRoutes(app, poolFor([{
      day: '2026-11-18', table_id: 'Assembly Station B1', planned: 4800, packed: 2900, jobs: 1, first_t: '09:00', last_t: '17:00',
      span_s: 480 * 60, idle_s: 45 * 60, idle_n: 1, earned_s: 2900 * 7.5, std_pcs: 2900, wrong: 1
    }]));
    const res = fakeRes();
    await app.routes['/api/packing/reports/:type']({ params: { type: 'daily' }, query: { from: '2026-11-18', to: '2026-11-18' }, auth: { username: 't' } }, res);
    expect(res.body.ok).toBe(true);
    const row = res.body.data.rows[0];
    expect(row).toMatchObject({ work_min: 435, idle_min: 45, rate: 400, std_rate: 480, eff: 83, done_pct: 60, wrong: 1 });
    const eff = res.body.data.summary.find(s => s.label === 'Efficiency');
    expect(eff.value).toBe(83);
  });

  test('a planned day with nothing packed is flagged, not divided by zero', async () => {
    const app = fakeApp();
    reports.registerPackingReportRoutes(app, poolFor([{ day: '2026-11-19', table_id: 'B1', planned: 1200, packed: null, span_s: null, idle_s: null, earned_s: null, std_pcs: null, wrong: 0 }]));
    const res = fakeRes();
    await app.routes['/api/packing/reports/:type']({ params: { type: 'daily' }, query: {}, auth: { username: 't' } }, res);
    expect(res.body.data.rows[0]).toMatchObject({ packed: 0, eff: null, rate: null, note: 'not packed' });
  });

  test('unknown report and missing login are refused', async () => {
    const app = fakeApp();
    reports.registerPackingReportRoutes(app, poolFor([]));
    const res = fakeRes();
    await app.routes['/api/packing/reports/:type']({ params: { type: 'nope' }, query: {}, auth: { username: 't' } }, res);
    expect(res.statusCode).toBe(404);
    const res2 = fakeRes();
    await app.routes['/api/packing/reports/:type']({ params: { type: 'daily' }, query: {}, headers: {} }, res2);
    expect(res2.statusCode).toBe(401);
  });
});
