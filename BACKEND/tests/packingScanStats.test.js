'use strict';

const floor = require('../src/modules/packing/registerPackingFloorRoutes');

/* Registers the routes on a fake app and returns the scan-stats handler. */
function setup(handlers) {
  const routes = {};
  const add = (m) => (path, ...fns) => { routes[`${m} ${path}`] = fns[fns.length - 1]; };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use: () => {} };
  const pool = {
    query: async (sql) => {
      for (const [re, rows] of handlers) if (re.test(sql)) return { rows };
      return { rows: [] };
    }
  };
  floor.registerPackingFloorRoutes(app, pool);
  return routes['GET /api/packing/scan-stats'];
}

async function call(handler, auth) {
  const out = { code: 200, body: null };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; } };
  await handler({ auth, headers: {}, query: {}, get: () => undefined }, res);
  return out;
}

describe('packing scan stats', () => {
  test('puts counts, last scan and per-minute scans on each plan', async () => {
    const h = setup([
      [/AS start_local/, [{ id: 5, start_local: '2026-11-24T09:00:00', end_local: '2026-11-24T12:00:00' }, { id: 6, start_local: null, end_local: null }]],
      [/AS last_sec/, [{ plan_id: 5, today: 40, hour: 12, wrong_hour: 1, last_sec: -2 }]],
      [/GROUP BY 1, 2/, [{ plan_id: 5, m: 0, n: 4 }, { plan_id: 5, m: 3, n: 8 }]],
      [/FROM assembly_scans WHERE "timestamp" >=/, [{ today: 90, hour: 20, wrong_hour: 2 }]]
    ]);
    const { body } = await call(h, { username: 'tester' });
    expect(body.data.totals).toEqual({ today: 90, hour: 20, wrong_hour: 2 });
    expect(body.data.plans[5]).toEqual({ start_local: '2026-11-24T09:00:00', end_local: '2026-11-24T12:00:00', today: 40, hour: 12, wrong_hour: 1, last_sec: 0, per_min: { 0: 4, 3: 8 } });
    /* a plan with no scan today has no last scan, not an old one */
    expect(body.data.plans[6]).toMatchObject({ today: 0, last_sec: null, per_min: {} });
  });

  test('needs a login', async () => {
    expect((await call(setup([]), null)).code).toBe(401);
  });
});
