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

const PLAN = { id: 7, plan_id: 'PLN-7', machine: 'B -L1-HYD-350-1', status: 'Running', factory_id: 1, line: 'B -L1',
  order_no: 'JR/1', item_name: 'Bucket 20L', mould_name: 'BUCKET 20L', plan_qty: 25000, colour_details: null };

// dpr: [{ colour, produced, verified, not_verified }]; shifts: [{ colour, location, shifted }]
function createApp({ dpr = [], shifts = [], enforced = false, sfg = true } = {}) {
  const inserts = [];
  const handle = async (sql, params = []) => {
    const text = String(sql);
    if (/FROM moulds/.test(text) && /sfg_std_packing/.test(text)) {
      return { rows: sfg ? [{ n: 'bucket 20l', c: '', sfg_std_packing: '50 PCS', bag_type: 'LD bag', bag_size: '27 X 48' }] : [] };
    }
    if (/SELECT id, plan_id, machine, status, factory_id[\s\S]*FROM plan_board/.test(text)) return { rows: [PLAN] };
    if (/pb\.colour_details, pb\.factory_id/.test(text)) return { rows: [PLAN] };
    if (/FROM dpr_hourly d\s+LEFT JOIN LATERAL/.test(text)) {
      return { rows: dpr.map(r => ({ ref: 'PLN-7', ...r })) };
    }
    if (/AS location, COALESCE\(SUM\(quantity\), 0\) AS shifted/.test(text)) {
      return { rows: shifts.map(r => ({ ref: '7', ...r })) };
    }
    if (/FROM qc_verifications\s+WHERE dpr_date >= CURRENT_DATE - 3/.test(text)) return { rows: enforced ? [{ x: 1 }] : [] };
    if (/AS produced,/.test(text) && /FROM shifting_records/.test(text)) {
      const produced = dpr.reduce((s, r) => s + r.produced, 0);
      const shifted = shifts.reduce((s, r) => s + r.shifted, 0);
      return { rows: [{ produced, shifted }] };
    }
    if (/INSERT INTO shifting_records/.test(text)) {
      inserts.push(params);
      return { rows: [{ id: 99 }] };
    }
    return { rows: [] };
  };
  const client = { query: jest.fn(handle), release: jest.fn() };
  const pool = { query: jest.fn(handle), connect: jest.fn().mockResolvedValue(client) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { username: 'shifta', role: 'operator', permissions: {} }; next(); });
  registerLegacyRoutes({
    app, pool, config: { geminiApiKey: '' },
    services: { aiService: { init: jest.fn() }, syncService: { triggerSync: jest.fn() }, updaterService: {} }
  });
  return { app, inserts };
}

const TWO_COLOURS = [
  { colour: 'Royal Light Brown', produced: 12548, verified: 7960, not_verified: 4588 },
  { colour: 'Sky Light Grey', produced: 10933, verified: 6568, not_verified: 4365 }
];

const post = (app, body) => request(app).post('/api/shifting/entry').set('x-factory-id', '1')
  .send({ planId: '7', toLocation: 'Packing', ...body });

describe('Manual shift colour', () => {
  const originalType = process.env.SERVER_TYPE;
  beforeAll(() => { process.env.SERVER_TYPE = 'LOCAL'; }); // built-in locations, no seeding
  afterAll(() => {
    if (originalType === undefined) delete process.env.SERVER_TYPE;
    else process.env.SERVER_TYPE = originalType;
  });

  // INSERT params: [..., weight_kg (8), colour (9)]
  const savedColour = (inserts) => inserts[0][9];

  it('saves the picked colour with the DPR spelling', async () => {
    const { app, inserts } = createApp({ dpr: TWO_COLOURS });
    const res = await post(app, { quantity: 20, colour: '  royal light brown ' });
    expect(res.status).toBe(200);
    expect(savedColour(inserts)).toBe('Royal Light Brown');
  });

  it('fills in the colour when the job has produced only one colour', async () => {
    const { app, inserts } = createApp({ dpr: [TWO_COLOURS[0]] });
    const res = await post(app, { quantity: 20 });
    expect(res.status).toBe(200);
    expect(savedColour(inserts)).toBe('Royal Light Brown');
  });

  it('keeps old clients working: no colour on a two-colour job is saved without one', async () => {
    const { app, inserts } = createApp({ dpr: TWO_COLOURS });
    const res = await post(app, { quantity: 20 });
    expect(res.status).toBe(200);
    expect(savedColour(inserts)).toBeNull();
  });

  it('rejects a colour that has no production on the job', async () => {
    const { app, inserts } = createApp({ dpr: TWO_COLOURS });
    const res = await post(app, { quantity: 20, colour: 'Red' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Red.*no production/);
    expect(inserts).toHaveLength(0);
  });

  it('checks QC-verified stock of the picked colour', async () => {
    const { app } = createApp({ dpr: TWO_COLOURS, enforced: true });
    const res = await post(app, { quantity: 7000, colour: 'Sky Light Grey' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only 6568 QC-verified pcs of colour Sky Light Grey/);
  });

  it('job panel: colour-less shifts get their own bucket and colour Ready never exceeds job Ready', async () => {
    const { app } = createApp({
      dpr: TWO_COLOURS,
      enforced: true,
      shifts: [{ colour: '', location: 'Packing', shifted: 720 }, { colour: 'Sky Light Grey', location: 'Printing', shifted: 6000 }]
    });
    const res = await request(app).get('/api/shifting/availability?plan_id=7').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totals.shifted).toBe(6720);
    expect(d.totals.ready).toBe(14528 - 6720);
    expect(d.unassigned).toEqual({ shifted: 720, by_location: [{ location: 'Packing', qty: 720 }] });
    const brown = d.colours.find(c => c.colour === 'Royal Light Brown');
    const grey = d.colours.find(c => c.colour === 'Sky Light Grey');
    expect(grey.shifted).toBe(6000);
    expect(grey.ready).toBe(568);
    expect(brown.ready).toBe(7808); // 7960 own, capped at the job's 7808
  });

  it('blocks a manual shift when the mould has no SFG std', async () => {
    const { app, inserts } = createApp({ dpr: TWO_COLOURS, sfg: false });
    const res = await post(app, { quantity: 50, colour: 'Sky Light Grey' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_SFG_STD');
    expect(res.body.error).toMatch(/SFG STD NOT SET.*BUCKET 20L/);
    expect(inserts).toHaveLength(0);
  });

  it('job panel returns the SFG std and pack type from Mould Master', async () => {
    const { app } = createApp({ dpr: TWO_COLOURS });
    const res = await request(app).get('/api/shifting/availability?plan_id=7').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ sfg_std: 50, sfg_pack_type: 'LD bag', sfg_bag_size: '27 X 48' });
  });

  it('job panel: a mould without SFG std reads as 0', async () => {
    const { app } = createApp({ dpr: TWO_COLOURS, sfg: false });
    const res = await request(app).get('/api/shifting/availability?plan_id=7').set('x-factory-id', '1');
    expect(res.body.data.sfg_std).toBe(0);
  });
});
