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

const basePlan = (status) => ({ id: 7, plan_id: 'PLN-7', machine: 'B -L1-HYD-350-1', status, factory_id: 1, line: 'B -L1',
  order_no: 'JR/1', item_name: 'Bucket 20L', mould_name: 'BUCKET 20L', plan_qty: 25000, colour_details: null });

// dpr: [{ colour, produced, verified, not_verified }]; shifts: [{ colour, location, shifted }]
function createApp({ dpr = [], shifts = [], enforced = true, status = 'Completed', role = 'shifting_supervisor' } = {}) {
  const plan = basePlan(status);
  const calls = [];
  const handle = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ text, params });
    if (/SELECT id, plan_id, status, factory_id FROM plan_board/.test(text)) return { rows: [plan] };
    if (/pb\.colour_details, pb\.factory_id/.test(text)) return { rows: [plan] };
    if (/FROM dpr_hourly d\s+LEFT JOIN LATERAL/.test(text)) return { rows: dpr.map(r => ({ ref: 'PLN-7', ...r })) };
    if (/AS location, COALESCE\(SUM\(quantity\), 0\) AS shifted/.test(text)) return { rows: shifts.map(r => ({ ref: '7', ...r })) };
    if (/FROM qc_verifications\s+WHERE dpr_date >= CURRENT_DATE - 3/.test(text)) return { rows: enforced ? [{ x: 1 }] : [] };
    return { rows: [] };
  };
  const client = { query: jest.fn(handle), release: jest.fn() };
  const pool = { query: jest.fn(handle), connect: jest.fn().mockResolvedValue(client) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { username: 'shifta', role, permissions: {} }; next(); });
  registerLegacyRoutes({
    app, pool, config: { geminiApiKey: '' },
    services: { aiService: { init: jest.fn() }, syncService: { triggerSync: jest.fn() }, updaterService: {} }
  });
  return { app, calls };
}

const avail = (app) => request(app).get('/api/shifting/availability?plan_id=7').set('x-factory-id', '1');
const close = (app, body) => request(app).post('/api/shifting/close').set('x-factory-id', '1').send({ planId: '7', ...body });

describe('Shifting: QC-ready state per colour', () => {
  it('a colour with every piece verified is READY, a half-verified one PARTLY', async () => {
    const { app } = createApp({ dpr: [
      { colour: 'Red', produced: 1000, verified: 1000, not_verified: 0 },
      { colour: 'Blue', produced: 800, verified: 300, not_verified: 500 }
    ] });
    const d = (await avail(app)).body.data;
    expect(d.colours.find(c => c.colour === 'Red').shift_state).toBe('READY');
    expect(d.colours.find(c => c.colour === 'Blue').shift_state).toBe('PARTLY');
    expect(d.shift_state).toBe('PARTLY');
    expect(d.ppc_completed).toBe(true);
  });

  it('nothing verified is WAITING_QC; everything shifted is SHIFTED', async () => {
    const { app } = createApp({
      dpr: [
        { colour: 'Red', produced: 1000, verified: 0, not_verified: 1000 },
        { colour: 'Blue', produced: 500, verified: 500, not_verified: 0 }
      ],
      shifts: [{ colour: 'Blue', location: 'Packing', shifted: 500 }]
    });
    const d = (await avail(app)).body.data;
    expect(d.colours.find(c => c.colour === 'Red').shift_state).toBe('WAITING_QC');
    expect(d.colours.find(c => c.colour === 'Blue').shift_state).toBe('SHIFTED');
    expect(d.shift_state).toBe('WAITING_QC');
  });

  it('without QC verification data the whole floor balance is READY', async () => {
    const { app } = createApp({ enforced: false, status: 'Running', dpr: [{ colour: 'Red', produced: 1000, verified: 0, not_verified: 1000 }] });
    const d = (await avail(app)).body.data;
    expect(d.colours[0].shift_state).toBe('READY');
    expect(d.ppc_completed).toBe(false);
  });
});

describe('Shifting: PPC-completed jobs stay listed', () => {
  it('job list asks for completed plans with unshifted production and skips closed ones', async () => {
    const { app, calls } = createApp();
    const res = await request(app).get('/api/shifting/jobs?days=7').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    const listQuery = calls.find(c => /FROM plan_board pb\s+WHERE \(/.test(c.text));
    expect(listQuery.text).toMatch(/shifting_closures/);
    expect(listQuery.text).toMatch(/SUM\(dh\.good_qty\)[\s\S]*> \(SELECT COALESCE\(SUM\(sr\.quantity\)/);
    expect(listQuery.params.slice(0, 2)).toEqual([7, 60]);
  });
});

describe('POST /api/shifting/close', () => {
  it('is refused for an operator', async () => {
    const { app } = createApp({ role: 'operator' });
    expect((await close(app, { reason: 'scrap' })).status).toBe(403);
  });

  it('needs a reason', async () => {
    const { app } = createApp();
    const res = await close(app, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });

  it('refuses a running job', async () => {
    const { app } = createApp({ status: 'Running' });
    const res = await close(app, { reason: 'scrap' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed by PPC/);
  });

  it('closes a completed job with its leftover qty', async () => {
    const { app, calls } = createApp({
      dpr: [{ colour: 'Red', produced: 1000, verified: 1000, not_verified: 0 }],
      shifts: [{ colour: 'Red', location: 'Packing', shifted: 990 }]
    });
    const res = await close(app, { reason: 'count mismatch' });
    expect(res.status).toBe(200);
    const ins = calls.find(c => /INSERT INTO shifting_closures/.test(c.text));
    expect(ins.params).toEqual([1, 'PLN-7', 10, 'count mismatch', 'shifta']);
  });

  it('re-opens without a reason', async () => {
    const { app, calls } = createApp();
    const res = await close(app, { reopen: true });
    expect(res.status).toBe(200);
    expect(res.body.closed).toBe(false);
    expect(calls.some(c => /UPDATE shifting_closures SET active = FALSE/.test(c.text))).toBe(true);
  });
});
