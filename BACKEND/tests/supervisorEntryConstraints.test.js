'use strict';

/**
 * Server-side guards for the Supervisor entry constraints:
 *   - Cavity ACT may not exceed Cavity STD
 *   - Article weight ACT must be within +/-5% of STD
 *   - Cumulative colour production capped at 110% of the colour's plan qty
 *
 * These mirror browser-side checks; they exist so a stale cached PWA bundle
 * cannot bypass them, so the boundary behaviour is worth pinning down here.
 */

jest.mock('../src/modules/hrPerformance/registerHrPerformanceRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

jest.mock('../src/modules/interviewPanel/registerInterviewPanelRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

const express = require('express');
const request = require('supertest');
const registerLegacyRoutes = require('../src/legacy/registerLegacyRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const services = {
    aiService: { init: jest.fn() },
    syncService: { triggerSync: jest.fn() },
    updaterService: {}
  };
  registerLegacyRoutes({ app, pool, config: { geminiApiKey: '' }, services });
  return { app, pool, services };
}

function todayIso() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Cavity + weight — /api/std-actual/save                              */
/* ------------------------------------------------------------------ */

describe('Supervisor setup constraints (cavity + weight)', () => {
  // Mould master: 8 cavities, 25 g article weight (stored as kg).
  const STD_WT_KG = 0.025;
  const STD_CAV = 8;

  function mockMould(pool, mould = { std_wt_kg: STD_WT_KG, no_of_cav: STD_CAV }) {
    pool.query.mockImplementation((sql) => {
      if (String(sql).includes('FROM moulds WHERE mould_name')) {
        return Promise.resolve({ rows: [mould], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  function save(app, overrides) {
    return request(app)
      .post('/api/std-actual/save')
      .set('x-factory-id', '2')
      .send({
        session: { username: 'supervisor', line: 'Line 1' },
        payload: {
          PlanID: 'PLAN-1',
          Shift: 'Day',
          DprDate: '2026-05-23',
          Machine: 'Line 1>M-1',
          OrderNo: 'OR-1',
          MouldName: 'Mould A',
          ArticleActual: STD_WT_KG,
          RunnerActual: 0.1,
          CavityActual: STD_CAV,
          CycleActual: 30,
          PcsHrActual: 120,
          ManActual: 2,
          EnteredBy: 'supervisor',
          SfgQtyActual: 1,
          OperatorActivities: '{}',
          ...overrides
        },
        geo: { lat: 20.1, lng: 72.9, accuracy: 15 }
      });
  }

  function upsertRan(pool) {
    return pool.query.mock.calls.some(([sql]) => String(sql).includes('WITH updated AS'));
  }

  it('accepts cavity equal to STD', async () => {
    const { app, pool } = createApp();
    mockMould(pool);
    const res = await save(app, { CavityActual: STD_CAV });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(upsertRan(pool)).toBe(true);
  });

  it('rejects cavity above STD and does not write', async () => {
    const { app, pool } = createApp();
    mockMould(pool);
    const res = await save(app, { CavityActual: STD_CAV + 1 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Cavity Validation Failed/);
    expect(upsertRan(pool)).toBe(false);
  });

  it('accepts article weight at the +5% and -5% bounds', async () => {
    for (const factor of [1.05, 0.95]) {
      const { app, pool } = createApp();
      mockMould(pool);
      const res = await save(app, { ArticleActual: STD_WT_KG * factor });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }
  });

  it('rejects article weight outside +/-5%', async () => {
    for (const factor of [1.06, 0.94]) {
      const { app, pool } = createApp();
      mockMould(pool);
      const res = await save(app, { ArticleActual: STD_WT_KG * factor });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Weight Validation Failed/);
      expect(upsertRan(pool)).toBe(false);
    }
  });

  it('compares weight in a common unit when the master stores grams, not kg', async () => {
    // Same 25 g standard, but held as grams in the master. An in-tolerance
    // actual must still pass rather than looking 1000x off.
    const { app, pool } = createApp();
    mockMould(pool, { std_wt_kg: 25, no_of_cav: STD_CAV });
    const res = await save(app, { ArticleActual: 0.0255 }); // 25.5 g => +2%
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('fails open when the mould cannot be resolved', async () => {
    // Known mould_name granularity mismatches must not hard-block the floor.
    const { app, pool } = createApp();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await save(app, { CavityActual: STD_CAV + 99 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(upsertRan(pool)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Colour 110% cap — /api/dpr/submit                                   */
/* ------------------------------------------------------------------ */

describe('Supervisor colour over-production cap', () => {
  // Plan 1000 split across two colours, 500 each => cap of 550 per colour.
  const COLOUR_DETAILS = JSON.stringify([
    { colourName: 'Colour A', planQty: 500 },
    { colourName: 'Colour B', planQty: 500 }
  ]);

  function mockPlan(pool, { produced, colourDetails = COLOUR_DETAILS }) {
    pool.query.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('FROM users WHERE username')) {
        return Promise.resolve({ rows: [{ line: 'Line 1', global_access: false }], rowCount: 1 });
      }
      if (s.includes('colour_details FROM plan_board')) {
        return Promise.resolve({ rows: [{ colour_details: colourDetails }], rowCount: 1 });
      }
      if (s.includes('SUM(good_qty)') && s.includes('AS produced')) {
        return Promise.resolve({ rows: [{ produced }], rowCount: 1 });
      }
      if (s.includes('INSERT INTO dpr_hourly') && s.includes('RETURNING id')) {
        return Promise.resolve({ rows: [{ id: 123 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  function submit(app, { goodQty, colour = 'Colour A' }) {
    return request(app)
      .post('/api/dpr/submit')
      .set('x-factory-id', '2')
      .send({
        session: { username: 'supervisor', line: 'Line 1' },
        entry: {
          Date: todayIso(),
          Shift: 'Day',
          HourSlot: '08-09',
          Shots: goodQty,
          GoodQty: goodQty,
          RejectQty: 0,
          DowntimeMin: 0,
          Remarks: '',
          PlanID: 'PLAN-1',
          Machine: 'Line 1>M-1',
          OrderNo: 'OR-1',
          MouldNo: 'M-1',
          JobCardNo: 'JC-1',
          Colour: colour,
          RejectBreakup: {},
          DowntimeBreakup: {},
          EntryType: 'Main',
          Supervisor: 'Shift Lead'
        },
        geo: { lat: 20.1, lng: 72.9, accuracy: 15 }
      });
  }

  function inserted(pool) {
    return pool.query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO dpr_hourly') && String(sql).includes('RETURNING id')
    );
  }

  it('allows an entry landing exactly on the 110% cap', async () => {
    // 300 produced + 250 = 550 = cap
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 300 });
    const res = await submit(app, { goodQty: 250 });
    expect(res.body.ok).toBe(true);
    expect(inserted(pool)).toBe(true);
  });

  it('blocks an entry one over the cap and does not insert', async () => {
    // 300 produced + 251 = 551 > 550
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 300 });
    const res = await submit(app, { goodQty: 251 });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/over production/i);
    expect(res.body.error).toMatch(/Enter 250 or less/);
    expect(inserted(pool)).toBe(false);
  });

  it('counts production already recorded, not just this entry', async () => {
    // Nothing produced yet: a single 550 entry is at the cap and allowed.
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 0 });
    const res = await submit(app, { goodQty: 550 });
    expect(res.body.ok).toBe(true);
  });

  it('caps each colour independently', async () => {
    // Colour B has its own 500 plan, untouched by Colour A's production.
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 250 });
    const res = await submit(app, { goodQty: 300, colour: 'Colour B' });
    expect(res.body.ok).toBe(true);
  });

  it('does not cap a colour that is not in the plan', async () => {
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 0 });
    const res = await submit(app, { goodQty: 9999, colour: 'Unplanned Colour' });
    expect(res.body.ok).toBe(true);
    expect(inserted(pool)).toBe(true);
  });

  it('does not cap when the plan has no colour details', async () => {
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 0, colourDetails: null });
    const res = await submit(app, { goodQty: 9999 });
    expect(res.body.ok).toBe(true);
    expect(inserted(pool)).toBe(true);
  });

  it('matches plan colours named "A-B-COLOUR" on the trailing segment', async () => {
    const { app, pool } = createApp();
    mockPlan(pool, {
      produced: 300,
      colourDetails: JSON.stringify([{ colourName: 'OR1-JC1-Colour A', planQty: 500 }])
    });
    const res = await submit(app, { goodQty: 251 });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/over production/i);
  });

  it('leaves zero-qty downtime entries alone', async () => {
    const { app, pool } = createApp();
    mockPlan(pool, { produced: 550 }); // already at cap
    const res = await submit(app, { goodQty: 0 });
    expect(res.body.ok).toBe(true);
  });
});
