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

    return { app, pool };
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
});
