'use strict';

// Two factories, both with a machine called M-1 and a plan called P-RUN. Nothing done in
// factory 1 may change a factory 2 plan. Runs the real routes on a real PostgreSQL, in a
// throwaway schema. CI always has one (DB_HOST is set); without it the tests are skipped.

jest.mock('../src/modules/hrPerformance/registerHrPerformanceRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);
jest.mock('../src/modules/interviewPanel/registerInterviewPanelRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const dbDescribe = hasDb ? describe : describe.skip;

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const registerLegacyRoutes = require('../src/legacy/registerLegacyRoutes');
const { findPlanByCode, planFactoryScope } = require('../src/modules/planning/planFactory');

const SCHEMA = `plan_scope_test_${process.pid}`;

dbDescribe('same machine name in two factories', () => {
  let admin;
  let pool;
  let app;

  beforeAll(async () => {
    const db = {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };
    admin = new Pool({ ...db, max: 1 });
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    pool = new Pool({ ...db, max: 3, options: `-c search_path=${SCHEMA}` });
    await pool.query(`
      CREATE TABLE plan_board (
        id SERIAL PRIMARY KEY, plan_id TEXT, machine TEXT, factory_id INT, status TEXT, seq INT,
        order_no TEXT, mould_name TEXT, item_name TEXT, plan_type TEXT, machine_priority TEXT,
        jc_approval_status TEXT DEFAULT 'APPROVED', plan_qty NUMERIC, bal_qty NUMERIC, remarks TEXT,
        start_date TIMESTAMPTZ, end_date TIMESTAMPTZ, completed_by TEXT, completed_at TIMESTAMPTZ,
        last_updated_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE machines (machine TEXT, factory_id INT);
      CREATE TABLE orders (order_no TEXT, factory_id INT);
      CREATE TABLE dpr_hourly (plan_id TEXT, factory_id INT);
      CREATE TABLE moulds (mould_name TEXT, mould_number TEXT);
      CREATE TABLE mould_planning_summary (or_jr_no TEXT, mould_name TEXT, mould_no TEXT);
      CREATE TABLE or_jr_report (or_jr_no TEXT, job_card_no TEXT, is_closed BOOLEAN, created_date TIMESTAMPTZ);
      CREATE TABLE plan_audit_logs (plan_id INT, action TEXT, details JSONB, user_name TEXT, factory_id INT);`);
    app = express();
    app.use(express.json());
    registerLegacyRoutes({
      app,
      pool,
      config: { geminiApiKey: '' },
      services: { aiService: { init: jest.fn() }, syncService: { triggerSync: jest.fn() }, updaterService: {} }
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await admin.end();
  });

  // ids: 1x = factory 1, 2x = factory 2, 90 = old plan without a factory
  beforeEach(async () => {
    await pool.query(`
      TRUNCATE plan_board, machines, orders, dpr_hourly, or_jr_report, plan_audit_logs;
      INSERT INTO machines VALUES ('M-1', 1), ('M-2', 1), ('M-1', 2), ('M-2', 2), ('ONLY-1', 1);
      INSERT INTO or_jr_report VALUES ('O1', 'JC1', false, NOW());
      INSERT INTO dpr_hourly VALUES ('P-RUN', 1);
      INSERT INTO plan_board (id, plan_id, machine, factory_id, status, seq, order_no, machine_priority) VALUES
        (11, 'P-RUN',  'M-1', 1, 'Running', 7, 'O1', NULL),
        (12, 'P-NEXT', 'M-1', 1, 'Planned', 8, 'O1', NULL),
        (13, 'P-M2',   'M-2', 1, 'Planned', 9, 'O1', NULL),
        (21, 'P-RUN',  'M-1', 2, 'Running', 1, 'O2', 'P2'),
        (22, 'P-NEXT', 'M-1', 2, 'Planned', 2, 'O2', 'P3'),
        (23, 'P-M2',   'M-2', 2, 'Planned', 3, 'O2', 'P2');`);
  });

  const rows = async (where) => (await pool.query(`SELECT * FROM plan_board WHERE ${where} ORDER BY id`)).rows;
  const status = async (id) => (await rows(`id = ${id}`))[0].status;
  const post = (url, body, factory = '1') => request(app).post(url).set('x-factory-id', factory).send(body);

  it.each([
    ['run', '/api/planning/run', { rowId: 12, force: true }, { 11: 'Stopped', 12: 'Running' }],
    ['start', '/api/planning/start', { rowId: 12, force: true }, { 11: 'Stopped', 12: 'Running' }],
    ['update', '/api/planning/update', { rowId: 12, status: 'RUNNING' }, { 11: 'Stopped', 12: 'RUNNING' }],
    ['stop', '/api/planning/stop', { rowId: 11 }, { 11: 'Stopped', 12: 'Planned' }],
    ['complete', '/api/planning/complete', { id: 11, remarks: 'x' }, { 11: 'COMPLETED', 12: 'Planned' }],
    ['move', '/api/planning/move', { rowId: 11, targetMachine: 'M-2' }, { 11: 'Stopped', 12: 'Planned' }],
    ['reseq', '/api/planning/reseq', { machine: 'M-1', orderedIds: [12, 21, 11] }, { 11: 'Running', 12: 'Planned' }],
    ['job/complete', '/api/job/complete', { planId: 'P-RUN' }, { 11: 'Stopped', 12: 'Running' }],
    ['supervisor-complete', '/api/job/supervisor-complete', { planId: 'P-RUN' }, { 11: 'Stopped', 12: 'Running' }]
  ])('%s in factory 1 leaves factory 2 untouched', async (_name, url, body, expected) => {
    const before = await rows('factory_id = 2');
    const res = await post(url, body);
    expect(res.body).toEqual(expect.objectContaining({ ok: true }));
    expect(await rows('factory_id = 2')).toEqual(before);
    for (const [id, st] of Object.entries(expected)) expect(await status(id)).toBe(st);
  });

  it.each(['/api/job/complete', '/api/job/supervisor-complete'])('%s never starts the next job of factory 2', async (url) => {
    await pool.query(`UPDATE plan_board SET status = 'COMPLETED' WHERE id = 12;
      UPDATE plan_board SET seq = 0 WHERE id = 22`);
    const before = await rows('factory_id = 2');
    expect((await post(url, { planId: 'P-RUN' })).body.ok).toBe(true);
    expect(await rows('factory_id = 2')).toEqual(before);
  });

  it.each(['/api/job/complete', '/api/job/supervisor-complete'])('%s refuses a repeated Plan ID in the All Factories view', async (url) => {
    const before = await rows('true');
    expect((await post(url, { planId: 'P-RUN' }, 'all')).status).toBe(409);
    expect(await rows('true')).toEqual(before);
  });

  it.each(['/api/job/complete', '/api/job/supervisor-complete'])('%s refuses a plan of another factory', async (url) => {
    await pool.query("UPDATE plan_board SET plan_id = 'F2-ONLY' WHERE id = 21");
    const before = await rows('true');
    expect((await post(url, { planId: 'F2-ONLY' })).status).toBe(404);
    expect(await rows('true')).toEqual(before);
  });

  it('job/complete: the new place in the queue comes from the own factory', async () => {
    await pool.query('UPDATE plan_board SET seq = 500 WHERE id = 22');
    await post('/api/job/complete', { planId: 'P-RUN' });
    expect((await rows('id = 11'))[0].seq).toBe(18);
  });

  it('move renumbers both machines of the own factory', async () => {
    await post('/api/planning/move', { rowId: 11, targetMachine: 'M-2', dropBeforeId: 13 });
    expect((await rows('factory_id = 1')).map((p) => [p.id, p.machine, p.seq]))
      .toEqual([[11, 'M-2', 10], [12, 'M-1', 10], [13, 'M-2', 20]]);
  });

  it('reseq of plans that left the machine changes nothing', async () => {
    const before = await rows('true');
    expect((await post('/api/planning/reseq', { machine: 'M-1', orderedIds: [13] })).body.ok).toBe(false);
    expect(await rows('true')).toEqual(before);
  });

  describe('old plans without a factory', () => {
    const addOld = (machine) => pool.query(
      "INSERT INTO plan_board (id, plan_id, machine, status, seq, order_no) VALUES (90, 'OLD', $1, 'Running', 1, 'O9')", [machine]);

    it('are left alone when the machine exists in two factories', async () => {
      await addOld('M-1');
      await post('/api/planning/run', { rowId: 12, force: true });
      expect(await status(90)).toBe('Running');
    });

    it('are stopped when the machine belongs to this factory alone', async () => {
      await addOld('ONLY-1');
      await pool.query("UPDATE plan_board SET machine = 'ONLY-1' WHERE id = 12");
      await post('/api/planning/run', { rowId: 12, force: true });
      expect(await status(90)).toBe('Stopped');
    });

    it('starting one cannot stop any plan of a factory when its own is unknown', async () => {
      await addOld('M-1');
      await post('/api/planning/start', { rowId: 90, force: true });
      expect([await status(11), await status(21), await status(90)]).toEqual(['Running', 'Running', 'Running']);
    });

    it('starting one whose order decides the factory stops only that factory', async () => {
      await addOld('M-1');
      await pool.query("INSERT INTO orders VALUES ('O9', 1)");
      await post('/api/planning/start', { rowId: 90, force: true });
      expect([await status(11), await status(21)]).toEqual(['Stopped', 'Running']);
    });
  });
});

// These need no database.
describe('planFactoryScope and findPlanByCode', () => {
  const db = (machines, plans = []) => jest.fn(async (sql) => ({
    rows: /FROM machines/.test(sql) ? machines : /FROM plan_board/.test(sql) ? plans : []
  }));
  const shared = [{ machine: 'M-1', factory_id: 1 }, { machine: 'M-1', factory_id: 2 }];

  it('covers the own factory only when the machine name is shared', async () => {
    const scope = await planFactoryScope(db(shared), { machine: 'M-1', factory_id: 1 });
    expect(scope.params).toEqual([1, false]);
    expect(scope.sql('$3', '$4', 'pb')).toBe('(pb.factory_id = $3::int OR ($4::boolean AND pb.factory_id IS NULL))');
  });

  it('a plan with no certain factory covers only plans without one', async () => {
    expect((await planFactoryScope(db(shared), { machine: 'M-1', factory_id: null })).params).toEqual([null, true]);
  });

  it('picks the plan of the selected factory, and never guesses', async () => {
    const plans = [{ id: 21, factory_id: 2 }, { id: 11, factory_id: 1 }];
    expect((await findPlanByCode(db(shared, plans), 'P', 1)).plan.id).toBe(11);
    expect(await findPlanByCode(db(shared, plans), 'P', null)).toEqual({ plan: null, ambiguous: true });
    expect((await findPlanByCode(db(shared, plans), 'P', 3)).plan).toBeNull();
  });

  it('an old plan without a factory is not given to a factory that does not own its machine', async () => {
    const query = db([{ machine: 'M-9', factory_id: 2 }], [{ id: 90, factory_id: null, machine: 'M-9' }]);
    expect((await findPlanByCode(query, 'P', 1)).plan).toBeNull();
    expect((await findPlanByCode(query, 'P', 2)).plan.id).toBe(90);
  });
});
