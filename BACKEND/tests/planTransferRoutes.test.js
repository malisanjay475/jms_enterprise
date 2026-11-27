'use strict';

// Factory Transfers end to end on a real PostgreSQL (throwaway schema): factory 1 owns
// order OR-1, its mould M-1 is also in factory 3's Mould Master. Factory 1 sends 400,
// factory 3 accepts and assigns machine C-1, the plan lands on factory 3 tagged with
// factory 1, and factory 1's balance holds the qty while waiting. CI has a DB (DB_HOST);
// without one the tests are skipped.

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

const SCHEMA = `plan_transfer_test_${process.pid}`;

dbDescribe('factory transfers', () => {
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
    pool = new Pool({ ...db, max: 4, options: `-c search_path=${SCHEMA}` });
    await pool.query(`
      CREATE TABLE factories (id INT PRIMARY KEY, name TEXT, code TEXT, location TEXT, is_active BOOLEAN DEFAULT true);
      CREATE TABLE roles (code TEXT PRIMARY KEY, label TEXT);
      CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT, role_code TEXT, global_access BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true);
      CREATE TABLE user_factories (user_id INT, factory_id INT);
      CREATE TABLE machines (id SERIAL PRIMARY KEY, machine TEXT, line TEXT, building TEXT, tonnage NUMERIC,
        is_active BOOLEAN DEFAULT true, factory_id INT, machine_process TEXT DEFAULT 'Moulding', labour_party_id INT);
      CREATE TABLE labour_parties (id SERIAL PRIMARY KEY, party_name TEXT);
      CREATE TABLE or_jr_report (id SERIAL PRIMARY KEY, or_jr_no TEXT, or_jr_date DATE, job_card_no TEXT, job_card_date DATE,
        remarks_all TEXT, is_closed BOOLEAN DEFAULT false, created_date TIMESTAMPTZ);
      CREATE TABLE moulds (id SERIAL PRIMARY KEY, mould_number TEXT, mould_name TEXT, tonnage NUMERIC, no_of_cav NUMERIC,
        cycle_time NUMERIC, std_wt_kg NUMERIC, primary_machine TEXT, secondary_machine TEXT, moulding_sqn TEXT,
        consumption_ratio_qty NUMERIC, is_active BOOLEAN DEFAULT true, factory_id INT, code TEXT, pcs_per_hour NUMERIC, updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE mould_planning_summary (id SERIAL PRIMARY KEY, or_jr_no TEXT, or_jr_date DATE, item_code TEXT, mould_no TEXT,
        mould_name TEXT, mould_item_qty NUMERIC, product_name TEXT, tonnage NUMERIC, cycle_time NUMERIC, cavity NUMERIC,
        machine_name TEXT, factory_id INT, plan_date DATE);
      CREATE TABLE orders (id SERIAL PRIMARY KEY, order_no TEXT, item_name TEXT, client_name TEXT, factory_id INT, status TEXT, priority TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE planning_drops (id SERIAL PRIMARY KEY, order_no TEXT, mould_name TEXT, mould_no TEXT, item_code TEXT);
      CREATE TABLE dpr_hourly (id SERIAL PRIMARY KEY, plan_id TEXT, factory_id INT, good_qty NUMERIC, is_deleted BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
        jobcard_no TEXT, order_no TEXT, dpr_date DATE);
      CREATE TABLE plan_board (id SERIAL PRIMARY KEY, plan_id TEXT, plant TEXT, building TEXT, line TEXT, machine TEXT, seq INT,
        order_no TEXT, item_code TEXT, item_name TEXT, mould_name TEXT, mould_code TEXT, plan_qty NUMERIC, bal_qty NUMERIC,
        our_code TEXT, batch_no INT, batch_qty NUMERIC, mould_item_qty NUMERIC, consumption_ratio_qty NUMERIC,
        colour_details JSONB, created_by TEXT, created_at TIMESTAMPTZ, start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
        status TEXT, updated_at TIMESTAMPTZ, factory_id INT, job_no INT, job_qty NUMERIC, plan_type TEXT,
        source_factory_id INT, transfer_id INT, jc_approval_status TEXT, job_card_given BOOLEAN DEFAULT false,
        job_card_no TEXT, machine_priority TEXT);
      CREATE TABLE plan_transfers (
        id SERIAL PRIMARY KEY, order_no TEXT NOT NULL, mould_no TEXT NOT NULL, mould_name TEXT, item_code TEXT,
        item_name TEXT, client_name TEXT, qty NUMERIC NOT NULL, colour_details JSONB DEFAULT '[]'::jsonb,
        from_factory_id INT NOT NULL, to_factory_id INT NOT NULL, status TEXT NOT NULL DEFAULT 'WAITING', note TEXT,
        reject_reason TEXT, requested_by TEXT, requested_at TIMESTAMPTZ DEFAULT NOW(), decided_by TEXT,
        decided_at TIMESTAMPTZ, plan_id TEXT, plan_row_id INT, planned_machine TEXT, planned_by TEXT,
        planned_at TIMESTAMPTZ, cancelled_by TEXT, cancelled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW());`);
    app = express();
    app.use(express.json());
    // Stands in for the session middleware: a verified login.
    app.use((req, _res, next) => {
      const u = req.headers['x-test-user'];
      if (u) { req.auth = { username: u }; req.headers['x-user-name'] = u; }
      next();
    });
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

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE labour_parties, or_jr_report, factories, roles, users, user_factories, machines, moulds, mould_planning_summary, orders,
               planning_drops, dpr_hourly, plan_board, plan_transfers RESTART IDENTITY;
      INSERT INTO factories (id, name) VALUES (1, 'Unit 1'), (2, 'Shivani'), (3, 'Premier');
      INSERT INTO roles VALUES ('ppc_manager', 'PPC Manager'), ('operator', 'Operator');
      INSERT INTO users (username, role_code) VALUES ('ppc1', 'ppc_manager'), ('ppc3', 'ppc_manager'), ('op1', 'operator');
      INSERT INTO user_factories VALUES (1, 1), (2, 3), (3, 1);
      INSERT INTO machines (machine, line, factory_id) VALUES ('A-1', '1', 1), ('C-2', '1', 3), ('C-1', '1', 3);
      INSERT INTO moulds (mould_number, mould_name, primary_machine, factory_id) VALUES
        ('M-1', 'Cap', 'A-1', 1), ('M-1', 'Cap', 'C-1', 3), ('M-1', 'Cap', 'X-9', 2), ('M-2', 'Lid', 'C-2', 3);
      INSERT INTO mould_planning_summary (or_jr_no, item_code, mould_no, mould_name, mould_item_qty, product_name, factory_id) VALUES
        ('OR-1', 'IC-1', 'M-1', 'Cap', 1000, 'Bottle', 1);
      INSERT INTO orders (order_no, item_name, client_name, factory_id) VALUES ('OR-1', 'Bottle', 'Acme', 1);`);
  });

  const as = (method, url, user, factory) => {
    const r = request(app)[method](url);
    if (user) r.set('x-test-user', user);
    if (factory) r.set('x-factory-id', String(factory));
    return r;
  };
  const balance = async () => {
    const res = await as('get', '/api/planning/orders/OR-1/details', 'ppc1', 1);
    return res.body.data.find((m) => m.mould_no === 'M-1').remainingQty;
  };
  const send = (qty, to = 3, user = 'ppc1') =>
    as('post', '/api/plan-transfers', user, 1).send({ orderNo: 'OR-1', mouldNo: 'M-1', toFactoryId: to, qty });

  it('shows the other factories that have the mould', async () => {
    const res = await as('get', '/api/plan-transfers/order/OR-1', 'ppc1', 1);
    expect(res.body.ok).toBe(true);
    expect(res.body.can_send).toBe(true);
    expect(res.body.locations['M-1'].map((f) => f.factoryName).sort()).toEqual(['Premier', 'Shivani']);
  });

  it('send -> accept -> assign machine creates a tagged plan on the receiving factory', async () => {
    expect(await balance()).toBe(1000);
    const sent = await send(400);
    expect(sent.body).toEqual(expect.objectContaining({ ok: true, toFactoryName: 'Premier' }));
    expect(await balance()).toBe(600); // held back while waiting

    const incoming = await as('get', '/api/plan-transfers?box=incoming', 'ppc3', 3);
    expect(incoming.body.waiting_incoming).toBe(1);
    const id = incoming.body.data[0].id;
    expect(incoming.body.data[0].from_factory_name).toBe('Unit 1');

    // the sending factory cannot accept its own transfer
    expect((await as('post', `/api/plan-transfers/${id}/accept`, 'ppc1', 1)).status).toBe(403);
    expect((await as('post', `/api/plan-transfers/${id}/accept`, 'ppc3', 3)).body.ok).toBe(true);

    const machines = await as('get', `/api/plan-transfers/${id}/machines`, 'ppc3', 3);
    expect(machines.body.machines.map((m) => m.machine)).toEqual(['C-1', 'C-2']);
    expect(machines.body.mould.primary_machine).toBe('C-1');

    const created = await as('post', '/api/planning/create', 'ppc3', 3).send([{
      transferId: id, plant: 'PREMIER', machine: 'C-1', orderNo: 'OR-1', itemCode: 'IC-1', mouldName: 'Cap',
      mouldCode: 'M-1', planQty: 400, startDate: new Date().toISOString()
    }]);
    expect(created.body).toEqual(expect.objectContaining({ ok: true, count: 1 }));

    const plan = (await pool.query('SELECT * FROM plan_board')).rows[0];
    expect(plan).toEqual(expect.objectContaining({ factory_id: 3, source_factory_id: 1, transfer_id: id, machine: 'C-1' }));
    const t = (await pool.query('SELECT * FROM plan_transfers WHERE id = $1', [id])).rows[0];
    expect(t).toEqual(expect.objectContaining({ status: 'PLANNED', plan_id: plan.plan_id, planned_machine: 'C-1' }));
    expect(await balance()).toBe(600); // now the plan counts, not the reservation

    const board = await as('get', '/api/planning/board', 'ppc3', 3);
    expect(board.body.ok).toBe(true);
    const card = board.body.data.plans.find((p) => p.planId === plan.plan_id);
    expect(card.transferFromFactory).toBe('Unit 1');

    // a second machine cannot be assigned to the same transfer
    const again = await as('post', '/api/planning/create', 'ppc3', 3).send([{
      transferId: id, plant: 'PREMIER', machine: 'C-2', orderNo: 'OR-1', mouldName: 'Cap', mouldCode: 'M-1', planQty: 10
    }]);
    expect(again.body.ok).toBe(false);
  });

  it('cannot send more than the balance, to a factory without the mould, or as a non-planner', async () => {
    expect((await send(1001)).body.error).toMatch(/more than the balance/);
    await pool.query("DELETE FROM moulds WHERE factory_id = 3");
    expect((await send(10)).body.error).toMatch(/does not have this mould/);
    expect((await send(10, 2, 'op1')).status).toBe(403);
    expect((await as('post', '/api/plan-transfers', null, 1).send({})).status).toBe(401);
  });

  it('two sends share one balance', async () => {
    expect((await send(700)).body.ok).toBe(true);
    expect((await send(400, 2)).body.error).toMatch(/balance 300/);
    expect((await send(300, 2)).body.ok).toBe(true);
    expect(await balance()).toBe(0);
  });

  it('reject needs a reason and frees the qty; cancel frees it too', async () => {
    const a = (await send(300)).body.id;
    const b = (await send(200)).body.id;
    expect(await balance()).toBe(500);
    expect((await as('post', `/api/plan-transfers/${a}/reject`, 'ppc3', 3).send({})).body.error).toMatch(/reason/);
    expect((await as('post', `/api/plan-transfers/${a}/reject`, 'ppc3', 3).send({ reason: 'No machine free' })).body.ok).toBe(true);
    expect((await as('post', `/api/plan-transfers/${b}/cancel`, 'ppc3', 3)).status).toBe(403);
    expect((await as('post', `/api/plan-transfers/${b}/cancel`, 'ppc1', 1)).body.ok).toBe(true);
    expect(await balance()).toBe(1000);
    const sent = await as('get', '/api/plan-transfers?box=sent', 'ppc1', 1);
    expect(sent.body.data.find((t) => t.id === a).reject_reason).toBe('No machine free');
  });

  it('assigning before accepting is refused', async () => {
    const id = (await send(100)).body.id;
    const res = await as('post', '/api/planning/create', 'ppc3', 3).send([{
      transferId: id, plant: 'PREMIER', machine: 'C-1', orderNo: 'OR-1', mouldName: 'Cap', mouldCode: 'M-1', planQty: 100
    }]);
    expect(res.body.error).toMatch(/Accept the transfer/);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM plan_board')).rows[0].n).toBe(0);
  });
});
