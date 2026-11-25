'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resolveSaveFactory } = require('../src/app/saveFactory');

const ROOT = path.join(__dirname, '..');
const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const dbDescribe = hasDb ? describe : describe.skip;

// Rows that used to fall back to the column default (factory 1).
const TABLES = ['dpr_hourly', 'jc_details', 'jc_summaries', 'machine_status_logs', 'operator_history',
  'orders', 'planning_drops', 'qc_deviations', 'qc_issue_memos', 'qc_online_reports', 'qc_training_sheets',
  'shift_teams', 'shifting_records', 'std_actual', 'wip_inventory', 'assembly_plans', 'machines',
  'or_jr_report', 'mould_planning_summary', 'moulds', 'users'];

function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) sources(f, out);
    else if (f.endsWith('.js')) out.push(f);
  }
  return out;
}

describe('saved records name their factory', () => {
  it('every insert into a factory table lists factory_id', () => {
    const missing = [];
    for (const f of [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'services')), ...sources(path.join(ROOT, 'routes'))]) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
        // ${...} lists are built in code; the first-boot superadmin belongs to every factory.
        if (!TABLES.includes(m[1].toLowerCase()) || /factory_id|\$\{/.test(m[2])) continue;
        if (s.slice(m.index, m.index + 250).includes("'superadmin'")) continue;
        missing.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no save in the legacy routes falls back to factory 1', () => {
    const s = fs.readFileSync(path.join(ROOT, 'src/legacy/registerLegacyRoutes.js'), 'utf8');
    expect(s.match(/(getFactoryId\(req\)|\b\w*factoryId)\s*(\|\||\?\?)\s*1\b/gi)).toBeNull();
  });

  it('prefers the selected factory and asks the database nothing', async () => {
    const q = jest.fn();
    expect(await resolveSaveFactory(q, { factoryId: 3, machine: 'M-1' })).toBe(3);
    expect(q).not.toHaveBeenCalled();
  });

  it('returns null, never 1, when nothing is certain', async () => {
    const q = jest.fn().mockResolvedValue([]);
    expect(await resolveSaveFactory(q, { factoryId: NaN, planId: 'P', orderNo: 'O', machine: 'M' })).toBeNull();
    expect(await resolveSaveFactory(q, { factoryId: null })).toBeNull();
  });
});

dbDescribe('on PostgreSQL', () => {
  let pool;
  let client;
  beforeAll(async () => {
    pool = new Pool({
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME, max: 1
    });
    client = await pool.connect();
    await client.query('BEGIN'); // everything below is rolled back
  });
  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  it('uses the plan, machine or order only when one factory has it', async () => {
    await client.query(`
      CREATE TEMP TABLE plan_board (plan_id VARCHAR, order_no VARCHAR, factory_id INT) ON COMMIT DROP;
      CREATE TEMP TABLE machines (machine TEXT, factory_id INT) ON COMMIT DROP;
      CREATE TEMP TABLE orders (order_no TEXT, factory_id INT) ON COMMIT DROP;
      INSERT INTO plan_board VALUES ('P1', 'O1', 2), ('P1', 'O2', 3);
      INSERT INTO machines VALUES ('M1', 1), ('M1', 2), ('M2', 4);
      INSERT INTO orders VALUES ('O9', 5), ('O8', 1), ('O8', 2)`);
    const q = async (sql, params) => (await client.query(sql, params)).rows;
    expect(await resolveSaveFactory(q, { planId: 'P1', orderNo: 'O2', machine: 'M2' })).toBe(3);
    expect(await resolveSaveFactory(q, { planId: 'P1', machine: 'M2' })).toBe(4);
    expect(await resolveSaveFactory(q, { machine: 'M1', orderNo: 'O9' })).toBe(5);
    expect(await resolveSaveFactory(q, { planId: 'P1', orderNo: 'O8', machine: 'M1' })).toBeNull();
  });

  it('migration 018 drops only a default of 1, and can run twice', async () => {
    await client.query(`
      CREATE TABLE public.zz_factory_one (id INT, factory_id INT DEFAULT 1);
      CREATE TABLE public.zz_factory_other (id INT, factory_id INT DEFAULT 7);
      INSERT INTO public.zz_factory_one (id) VALUES (1)`);
    const sql = fs.readFileSync(path.join(ROOT, 'migrations/018_drop_factory_default_one.sql'), 'utf8');
    await client.query(sql);
    await client.query(sql);
    await client.query('INSERT INTO public.zz_factory_one (id) VALUES (2); INSERT INTO public.zz_factory_other (id) VALUES (1)');
    const one = await client.query('SELECT factory_id FROM public.zz_factory_one ORDER BY id');
    const other = await client.query('SELECT factory_id FROM public.zz_factory_other');
    expect(one.rows.map((r) => r.factory_id)).toEqual([1, null]);
    expect(other.rows[0].factory_id).toBe(7);
  });
});
