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

// Machine master: lines B -L1 and C -L1; -10 must come after -2 (not text order).
const MASTER = [
  { machine: 'C-L1-M-3', line: 'C -L1', building: 'C' },
  { machine: 'B-L1-M-10', line: 'B -L1', building: 'B' },
  { machine: 'B-L1-M-1', line: 'B -L1', building: 'B' },
  { machine: 'B-L1-M-2', line: 'B -L1', building: 'B' }
];

// Two running jobs: P11 on B-L1-M-2 (produced 500, QC verified 300, shifted 100 → 200
// approved) and P12 on B-L1-M-10 (produced 100, nothing verified → 0 approved).
const PLANS = [
  { plan_id: 11, plan_code: 'P11', machine: 'B-L1-M-2', line: 'B -L1', order_no: 'OR-1', item_name: 'Bucket', mould_name: 'BKT', mould_code: 'BKT', plan_qty: 1000, status: 'Running', factory_id: null },
  { plan_id: 12, plan_code: 'P12', machine: 'B-L1-M-10', line: 'B -L1', order_no: 'OR-2', item_name: 'Lid', mould_name: 'LID', mould_code: 'LID', plan_qty: 500, status: 'Running', factory_id: null }
];

function createApp({ verified = true } = {}) {
  const handle = async (sql) => {
    const text = String(sql);
    if (/machine_process/.test(text) && /FROM machines/.test(text)) return { rows: MASTER };
    if (/SELECT TRIM\(machine\) AS machine, line, building FROM machines/.test(text)) return { rows: MASTER };
    if (/FROM plan_board pb/.test(text) && /pb\.mould_code/.test(text)) return { rows: PLANS };
    if (/SELECT 1 FROM qc_verifications/.test(text)) return { rows: verified ? [{ x: 1 }] : [] };
    if (/FROM dpr_hourly d/.test(text) && /LEFT JOIN LATERAL/.test(text)) {
      return {
        rows: [
          { ref: 'P11', colour: '', produced: 500, verified: verified ? 300 : 0, not_verified: verified ? 200 : 500 },
          { ref: 'P12', colour: '', produced: 100, verified: 0, not_verified: 100 }
        ]
      };
    }
    if (/SELECT CAST\(plan_id AS TEXT\) AS ref/.test(text)) return { rows: [{ ref: '11', colour: '', location: 'Packing', shifted: 100 }] };
    if (/MAX\(dpr_date\) AS last_dpr_date/.test(text)) {
      return { rows: [{ plan_id: 'P11', factory_id: null, qty: 500 }, { plan_id: 'P12', factory_id: null, qty: 100 }] };
    }
    if (/MAX\(created_at\) AS last_shifted_at/.test(text)) return { rows: [{ plan_id: 11, factory_id: null, qty: 100 }] };
    return { rows: [] };
  };
  const client = { query: jest.fn(handle), release: jest.fn() };
  const pool = { query: jest.fn(handle), connect: jest.fn().mockResolvedValue(client) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { id: 1, username: 'shifter', role: 'admin', permissions: {} }; next(); });
  registerLegacyRoutes({
    app,
    pool,
    config: { geminiApiKey: '' },
    services: { aiService: { init: jest.fn() }, syncService: { triggerSync: jest.fn() }, updaterService: {} }
  });
  return app;
}

describe('GET /api/shifting/machine-board', () => {
  it('lists every master machine in Line → machine-number order with its QC approved qty', async () => {
    const res = await request(createApp()).get('/api/shifting/machine-board?days=3');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.verification_enforced).toBe(true);
    expect(res.body.data.map(m => m.machine)).toEqual(['B-L1-M-1', 'B-L1-M-2', 'B-L1-M-10', 'C-L1-M-3']);

    const byMachine = Object.fromEntries(res.body.data.map(m => [m.machine, m]));
    expect(byMachine['B-L1-M-2']).toMatchObject({ approved_qty: 200, on_floor_qty: 400, jobs: 1, running_item: 'Bucket', best_plan_id: 11 });
    expect(byMachine['B-L1-M-2'].job_list[0]).toMatchObject({ plan_id: 11, produced: 500, verified: 300, shifted: 100, approved: 200 });
    expect(byMachine['B-L1-M-10']).toMatchObject({ approved_qty: 0, on_floor_qty: 100, jobs: 1 });
    // Machines without a job are still listed (toggle OFF shows all machines).
    expect(byMachine['B-L1-M-1']).toMatchObject({ approved_qty: 0, jobs: 0, best_plan_id: null, job_list: [] });
    expect(byMachine['C-L1-M-3'].line).toBe('C -L1');
  });

  it('keeps /api/shifting/jobs working after the shared helper refactor', async () => {
    const res = await request(createApp()).get('/api/shifting/jobs?days=3');
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(3);
    const p11 = res.body.data.find(r => r.plan_id === 11);
    expect(p11).toMatchObject({ total_produced: 500, total_shifted: 100, total_verified: 300, ready_qty: 200 });
  });
});
