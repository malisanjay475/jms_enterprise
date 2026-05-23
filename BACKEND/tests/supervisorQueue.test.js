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

describe('Supervisor queue', () => {
  function createApp() {
    const app = express();
    app.use(express.json());
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] })
    };
    const services = {
      aiService: { init: jest.fn() },
      syncService: { triggerSync: jest.fn() },
      updaterService: {}
    };

    registerLegacyRoutes({
      app,
      pool,
      config: { geminiApiKey: '' },
      services
    });

    return { app, pool, services };
  }

  it('loads queue using OR/JR remarks columns instead of missing orders.remarks', async () => {
    const { app, pool } = createApp();

    const res = await request(app)
      .get('/api/queue')
      .query({ line: 'Line 1' })
      .set('x-factory-id', '1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: [] });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('COALESCE(NULLIF(r.or_remarks');
    expect(sql).toContain('as "Or Remarks"');
    expect(sql).not.toContain('o.remarks');
    expect(params).toEqual([['Line 1'], ['Line 1%'], 1]);
  });

  it('saves DPR setup with factory id so compliance summary can find it', async () => {
    const { app, pool, services } = createApp();

    const res = await request(app)
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
          ArticleActual: 1.2,
          RunnerActual: 0.1,
          CavityActual: 4,
          CycleActual: 30,
          PcsHrActual: 120,
          ManActual: 2,
          EnteredBy: 'supervisor',
          SfgQtyActual: 1,
          OperatorActivities: '{}'
        },
        geo: { lat: 20.1, lng: 72.9, accuracy: 15 }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('factory_id');
    expect(sql).toContain('factory_id          = COALESCE(EXCLUDED.factory_id, s.factory_id)');
    expect(params[19]).toBe(2);
    expect(services.syncService.triggerSync).toHaveBeenCalled();
  });
});
