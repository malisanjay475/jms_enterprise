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
    expect(sql).toContain('WITH updated AS');
    expect(sql).toContain('factory_id');
    expect(sql).toContain('factory_id          = COALESCE($20, factory_id)');
    expect(sql).not.toContain('ON CONFLICT');
    expect(params[19]).toBe(2);
    expect(services.syncService.triggerSync).toHaveBeenCalled();
  });

  it('submits DPR entries with supervisor fields and triggers sync', async () => {
    const { app, pool, services } = createApp();
    pool.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT INTO dpr_hourly') && String(sql).includes('RETURNING id')) {
        return Promise.resolve({ rows: [{ id: 123 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .post('/api/dpr/submit')
      .set('x-factory-id', '2')
      .send({
        session: { username: 'supervisor', line: 'Line 1' },
        entry: {
          Date: '2026-05-23',
          Shift: 'Day',
          HourSlot: '08-09',
          Shots: 100,
          GoodQty: 95,
          RejectQty: 5,
          DowntimeMin: 0,
          Remarks: '',
          PlanID: 'PLAN-1',
          Machine: 'Line 1>M-1',
          OrderNo: 'OR-1',
          MouldNo: 'M-1',
          JobCardNo: 'JC-1',
          Colour: 'Blue',
          RejectBreakup: { A: 5 },
          DowntimeBreakup: {},
          EntryType: 'Main',
          Supervisor: 'Shift Lead'
        },
        geo: { lat: 20.1, lng: 72.9, accuracy: 15 }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 123 });

    const submitCall = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO dpr_hourly') && String(sql).includes('RETURNING id')
    );
    expect(submitCall).toBeDefined();
    expect(submitCall[0]).toContain('supervisor');
    expect(submitCall[0]).toContain('factory_id');
    expect(submitCall[1][22]).toBe('Shift Lead');
    expect(submitCall[1][23]).toBe(2);
    expect(services.syncService.triggerSync).toHaveBeenCalled();
  });

  it('filters recent DPR entries by job card, plan, and factory', async () => {
    const { app, pool } = createApp();

    const res = await request(app)
      .get('/api/dpr/recent')
      .query({
        machine: 'Line 1>M-1',
        jc_no: 'JC-1',
        planId: 'PLAN-1',
        date: '2026-05-23',
        shift: 'Day'
      })
      .set('x-factory-id', '2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { rows: [] } });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('jobcard_no =');
    expect(sql).toContain('plan_id =');
    expect(sql).toContain('factory_id =');
    expect(params).toEqual(['Line 1>M-1', 'PLAN-1', 'JC-1', '2026-05-23', 'Day', 2, 50]);
  });
});
