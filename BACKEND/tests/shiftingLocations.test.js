'use strict';

jest.mock('../src/modules/hrPerformance/registerHrPerformanceRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

jest.mock('../src/modules/interviewPanel/registerInterviewPanelRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

const express = require('express');
const request = require('supertest');
const registerLegacyRoutes = require('../src/legacy/registerLegacyRoutes');

const DEFAULTS = ['Moulding Itself', 'Shifting Wip', 'Shopfloor Wip', 'Printing', 'Tuffting', 'Packing'];

// In-memory shifting_locations table behind a pool mock that answers only the
// statements the locations routes run; everything else returns no rows.
function createApp({ auth = null, rows = [], plan = null } = {}) {
  const table = rows.map((r, i) => ({ id: i + 1, sort_order: (i + 1) * 10, is_active: true, factory_id: 1, ...r }));
  let nextId = table.length + 1;
  const inserts = [];

  const handle = async (sql, params = []) => {
    const text = String(sql);
    if (/FROM shifting_locations\s+WHERE \(\$1::int IS NULL OR factory_id = \$1\)/.test(text)) {
      const [fid, includeInactive] = params;
      return {
        rows: table
          .filter(r => (fid == null || r.factory_id === fid) && (includeInactive || r.is_active !== false))
          .sort((a, b) => a.sort_order - b.sort_order)
      };
    }
    if (/SELECT 1 FROM shifting_locations WHERE factory_id = \$1 LIMIT 1/.test(text)) {
      return { rows: table.filter(r => r.factory_id === params[0]).slice(0, 1).map(() => ({ '?column?': 1 })) };
    }
    if (plan && /SELECT id, plan_id, machine, status, factory_id\s+FROM plan_board/.test(text)) {
      return { rows: [plan] };
    }
    if (/INSERT INTO shifting_records/.test(text)) {
      return { rows: [{ id: 99, to_location: params[3] }] };
    }
    if (/INSERT INTO shifting_locations/.test(text)) {
      const row = { id: nextId++, name: params[0], sort_order: params[1], is_active: true, factory_id: params[2] };
      table.push(row);
      inserts.push(row);
      return { rows: [row] };
    }
    if (/LOWER\(TRIM\(name\)\) = LOWER\(\$2\)/.test(text)) {
      const [fid, name, exceptId] = params;
      return {
        rows: table.filter(r => r.factory_id === fid && r.name.trim().toLowerCase() === String(name).toLowerCase()
          && (exceptId == null || r.id !== exceptId))
      };
    }
    if (/MAX\(sort_order\)/.test(text)) {
      const own = table.filter(r => r.factory_id === params[0]);
      return { rows: [{ m: own.reduce((m, r) => Math.max(m, r.sort_order), 0) }] };
    }
    return { rows: [] };
  };

  const client = { query: jest.fn(handle), release: jest.fn() };
  const pool = { query: jest.fn(handle), connect: jest.fn().mockResolvedValue(client) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = auth; next(); });
  registerLegacyRoutes({
    app,
    pool,
    config: { geminiApiKey: '' },
    services: { aiService: { init: jest.fn() }, syncService: { triggerSync: jest.fn() }, updaterService: {} }
  });
  return { app, table, inserts };
}

const ADMIN = { id: 1, username: 'admin1', role: 'admin', permissions: {} };
const OPERATOR = { id: 2, username: 'op1', role: 'operator', permissions: { masters_edit: false } };

describe('Shifting locations master', () => {
  const originalType = process.env.SERVER_TYPE;
  afterEach(() => {
    if (originalType === undefined) delete process.env.SERVER_TYPE;
    else process.env.SERVER_TYPE = originalType;
  });

  it('on a LOCAL server with no rows yet, returns the built-in list and never writes', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    const { app, inserts } = createApp();
    const res = await request(app).get('/api/shifting/locations').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(DEFAULTS);
    expect(res.body.source).toBe('default');
    expect(res.body.editable).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('on MAIN, seeds the built-in list for a factory the first time it is read', async () => {
    process.env.SERVER_TYPE = 'MAIN';
    const { app, inserts } = createApp();
    const res = await request(app).get('/api/shifting/locations').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('master');
    expect(res.body.data).toEqual(DEFAULTS);
    expect(inserts.map(r => r.factory_id)).toEqual(DEFAULTS.map(() => 1));

    // Second read does not seed again.
    await request(app).get('/api/shifting/locations').set('x-factory-id', '1');
    expect(inserts).toHaveLength(DEFAULTS.length);
  });

  it('hides inactive locations from the shifting pages but lists them with ?all=1', async () => {
    process.env.SERVER_TYPE = 'MAIN';
    const { app } = createApp({ rows: [{ name: 'Packing' }, { name: 'Old Store', is_active: false }] });
    const active = await request(app).get('/api/shifting/locations').set('x-factory-id', '1');
    expect(active.body.data).toEqual(['Packing']);
    const all = await request(app).get('/api/shifting/locations?all=1').set('x-factory-id', '1');
    expect(all.body.items.map(r => r.name)).toEqual(['Packing', 'Old Store']);
    expect(all.body.data).toEqual(['Packing']);
  });

  it('refuses writes on a LOCAL server', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    const { app } = createApp({ auth: ADMIN });
    const res = await request(app).post('/api/shifting/locations').set('x-factory-id', '1').send({ name: 'Dock' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/MAIN server/);
  });

  it('needs a verified login with Masters edit access and one selected factory', async () => {
    process.env.SERVER_TYPE = 'MAIN';
    const anon = await request(createApp().app).post('/api/shifting/locations').set('x-factory-id', '1').send({ name: 'Dock' });
    expect(anon.status).toBe(401);

    const op = await request(createApp({ auth: OPERATOR }).app).post('/api/shifting/locations').set('x-factory-id', '1').send({ name: 'Dock' });
    expect(op.status).toBe(403);

    const all = await request(createApp({ auth: ADMIN }).app).post('/api/shifting/locations').set('x-factory-id', 'all').send({ name: 'Dock' });
    expect(all.status).toBe(400);
  });

  it('adds a location at the end of the list and rejects a duplicate name', async () => {
    process.env.SERVER_TYPE = 'MAIN';
    const { app, table } = createApp({ auth: ADMIN, rows: [{ name: 'Packing' }] });
    const ok = await request(app).post('/api/shifting/locations').set('x-factory-id', '1').send({ name: '  Dock   Area ' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'Dock Area', sort_order: 20 });
    expect(table.find(r => r.name === 'Dock Area')).toBeTruthy();

    const dup = await request(app).post('/api/shifting/locations').set('x-factory-id', '1').send({ name: 'packing' });
    expect(dup.status).toBe(409);
  });

  it('manual shift accepts only an active location, saved under its master spelling', async () => {
    process.env.SERVER_TYPE = 'LOCAL';
    const plan = { id: 7, plan_id: 'PLN-7', machine: 'B -L1-HYD-350-1', status: 'Running', factory_id: 1 };
    const { app } = createApp({ plan });

    const bad = await request(app)
      .post('/api/shifting/entry')
      .set('x-factory-id', '1')
      .send({ planId: '7', quantity: 5, toLocation: 'Moon Base' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/not an active shifting location/);

    // Case/spacing differences resolve to the master name; the mock reports 0 produced,
    // so the request then stops at the shop-floor balance check (still a 400, but a
    // different, later error), proving the location passed.
    const good = await request(app)
      .post('/api/shifting/entry')
      .set('x-factory-id', '1')
      .send({ planId: '7', quantity: 5, toLocation: '  packing ' });
    expect(good.status).toBe(400);
    expect(good.body.error).toMatch(/left on the shop floor/);
  });
});
