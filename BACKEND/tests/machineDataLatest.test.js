'use strict';

const express = require('express');
const request = require('supertest');

// /latest and /all-latest used DISTINCT ON over every stored reading, which sorted
// the whole machine_readings table (1.5M rows, ~1 s and ~12 s on factory-1). They now
// fetch one row per machine through the (machine_id, recorded_at DESC) index.

function buildApp(queryImpl) {
  jest.resetModules();
  const mod = require('../src/modules/machineData/registerMachineDataRoutes');
  const pool = { query: jest.fn(queryImpl) };
  const app = express();
  app.use(express.json());
  mod.registerMachineDataRoutes(app, pool);
  return { app, pool, mod };
}

describe('machine-data latest readings', () => {
  it('uses a per-machine LATERAL lookup, never a whole-table DISTINCT ON', () => {
    const mod = require('../src/modules/machineData/registerMachineDataRoutes');
    for (const sql of [mod.LATEST_READINGS_SQL, mod.ALL_LATEST_READINGS_SQL]) {
      expect(sql).not.toMatch(/DISTINCT\s+ON/i);
      expect(sql).toMatch(/CROSS JOIN LATERAL/);
      expect(sql).toMatch(/ORDER BY x\.recorded_at DESC\s+LIMIT 1/);
    }
    expect(mod.ALL_LATEST_READINGS_SQL).toMatch(/c\.enabled = true/);
  });

  it('GET /api/machine-data/latest returns the rows from the fast query', async () => {
    const reading = { machine_id: 7, machine_name: 'E -L2-WIND-250-6', recorded_at: '2026-09-18T10:16:16.809Z', good_shots: 10 };
    const { app, pool, mod } = buildApp(async (sql) => (sql === require('../src/modules/machineData/registerMachineDataRoutes').LATEST_READINGS_SQL
      ? { rows: [reading], rowCount: 1 }
      : { rows: [], rowCount: 0 }));

    const res = await request(app).get('/api/machine-data/latest');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, readings: [reading] });
    expect(pool.query.mock.calls.some(([sql]) => sql === mod.LATEST_READINGS_SQL)).toBe(true);
  });

  it('GET /api/machine-data/all-latest maps rows to machines with register values', async () => {
    const row = { machine_id: 7, machine_name: 'E -L2-WIND-250-6', recorded_at: '2026-09-18T10:16:16.809Z', raw_json: { good_shots: 10 } };
    const { app } = buildApp(async (sql) => (sql === require('../src/modules/machineData/registerMachineDataRoutes').ALL_LATEST_READINGS_SQL
      ? { rows: [row], rowCount: 1 }
      : { rows: [], rowCount: 0 }));

    const res = await request(app).get('/api/machine-data/all-latest');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.registers)).toBe(true);
    expect(res.body.machines).toEqual([
      { machine_id: 7, machine_name: 'E -L2-WIND-250-6', recorded_at: '2026-09-18T10:16:16.809Z', values: { good_shots: 10 } }
    ]);
  });
});
