'use strict';

const {
  assertPlanCreator,
  assertMachinesInFactory,
  planVisibleToFactorySql,
  healPlansWithoutFactory,
  resolvePlanFactory,
  ensurePlanFactoryGuard
} = require('../src/modules/planning/planFactory');
const fs = require('fs');
const path = require('path');
const syncService = require('../services/sync.service');

const { reconcilePlanFactory, getChanges, setRuntimeForTests } = syncService.__test;

describe('creating a plan', () => {
  it('needs a logged-in user', () => {
    expect(() => assertPlanCreator({ username: null, factoryId: 4 })).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED', status: 401 }));
    expect(() => assertPlanCreator({ username: '  ', factoryId: 4 })).toThrow(/log in again/);
  });

  it.each([null, undefined, NaN, 0, -1])('needs one factory (%s)', (factoryId) => {
    expect(() => assertPlanCreator({ username: 'Suresh', factoryId })).toThrow(/Select one factory/);
  });

  it('returns the factory when both are known', () => {
    expect(assertPlanCreator({ username: 'Suresh', factoryId: 4 })).toBe(4);
  });

  const master = (rows) => jest.fn(async () => ({ rows }));
  const u1 = [{ machine: 'B -L1-HYD-350-1', factory_id: 1 }, { machine: 'B -L1>OM-150-2', factory_id: 1 }];

  it('refuses a machine of another factory', async () => {
    await expect(assertMachinesInFactory(master(u1), [{ machine: 'U2-L3-EXCEL-100-4' }], 1)).rejects.toThrow(/U2-L3-EXCEL-100-4/);
  });

  it('accepts own machines, ignoring case and the old prefix', async () => {
    await assertMachinesInFactory(master(u1), [{ machine: 'b -l1-hyd-350-1' }, { machine: 'OM-150-2' }, { machine: 'B -L1>OM-150-2' }], 1);
  });

  it('skips Labour Job plans and factories without a machine master', async () => {
    const query = master(u1);
    await assertMachinesInFactory(query, [{ machine: 'PARTY-1', planType: 'Labour Job' }], 1);
    expect(query).not.toHaveBeenCalled();
    await assertMachinesInFactory(master([{ machine: 'GLOBAL', factory_id: null }]), [{ machine: 'ANY' }], 3);
  });
});

describe('plans that have no factory', () => {
  it('are shown only where their machine is in the master', () => {
    const sql = planVisibleToFactorySql('$2');
    expect(sql).toContain('pb.factory_id = $2');
    expect(sql).toMatch(/pb\.factory_id IS NULL AND EXISTS/);
    expect(sql).toContain('own_m.factory_id = $2');
  });

  it('a failing heal never blocks startup', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const query = jest.fn().mockRejectedValue(new Error('boom'));
    await healPlansWithoutFactory(query);
    expect(query).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('are not sent to LOCAL servers, while other tables keep their shared rows', async () => {
    const query = jest.fn(async (sql) => (/information_schema|to_regclass/.test(sql)
      ? { rows: [{ exists: true, column_name: 'factory_id' }], rowCount: 1 }
      : { rows: [], rowCount: 0 }));
    setRuntimeForTests({ pool: { query } });
    await getChanges('plan_board', null, 1, null);
    await getChanges('machines', null, 1, null);
    const sqlOf = (t) => query.mock.calls.map((c) => c[0]).find((s) => s.startsWith(`SELECT * FROM ${t}`));
    expect(sqlOf('plan_board')).toContain('factory_id = $1');
    expect(sqlOf('plan_board')).not.toContain('IS NULL');
    expect(sqlOf('machines')).toContain('OR factory_id IS NULL');
  });
});

describe('reconcilePlanFactory', () => {
  const client = (rowCount = 0) => ({ query: jest.fn(async () => ({ rows: [], rowCount })) });
  const row = { plan_id: 'PLN-2627-8818', global_id: 'g1' };

  it('never saves a plan without a factory', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await reconcilePlanFactory(client(), { ...row, factory_id: null }, new Set())).toBe(false);
    expect(await reconcilePlanFactory(client(), { plan_id: 'P1' }, new Set())).toBe(false);
    warn.mockRestore();
  });

  it('gives the factory to the no-factory copy here instead of adding a second row', async () => {
    const c = client();
    expect(await reconcilePlanFactory(c, { ...row, factory_id: 4 }, new Set(['g1']))).toBe(true);
    const update = c.query.mock.calls.find(([sql]) => sql.includes('UPDATE plan_board SET factory_id'));
    expect(update[1]).toEqual([4, 'g1', 'PLN-2627-8818']);
  });

  it('runs no query for an ordinary plan', async () => {
    const c = client();
    expect(await reconcilePlanFactory(c, { ...row, factory_id: 1 }, new Set())).toBe(true);
    expect(c.query).not.toHaveBeenCalled();
  });
});

describe('a plan from ERP', () => {
  const db = (machines, orders = []) => jest.fn(async (sql) => ({ rows: /FROM machines/.test(sql) ? machines : orders }));

  it('takes the factory of its machine', async () => {
    expect(await resolvePlanFactory(db([{ machine: 'B -L1>OM-1', factory_id: 2 }]), { machine: 'OM-1' })).toBe(2);
  });

  it('falls back to its order when the machine name is in two factories', async () => {
    const two = [{ machine: 'OM-1', factory_id: 1 }, { machine: 'OM-1', factory_id: 2 }];
    expect(await resolvePlanFactory(db(two, [{ factory_id: 1 }]), { machine: 'OM-1', orderNo: 'JR/1' })).toBe(1);
    expect(await resolvePlanFactory(db(two, [{ factory_id: 1 }, { factory_id: 2 }]), { machine: 'OM-1', orderNo: 'JR/1' })).toBeNull();
  });
});

describe('database guard', () => {
  it('a failing install never blocks startup', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await ensurePlanFactoryGuard(jest.fn().mockRejectedValue(new Error('boom')));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// Stops the mistake at review time: every place that writes a plan must name the factory.
describe('code check', () => {
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) files.push(full);
  });
  ['src', 'services', 'routes', 'scripts', 'utils'].forEach((d) => walk(path.join(root, d)));

  it('every INSERT INTO plan_board includes factory_id', () => {
    const bad = [];
    let seen = 0;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/INSERT\s+INTO\s+plan_board\s*\(((?:\$\{[^}]*\}|[^)])*)\)/gi)) {
        seen += 1;
        // recover-deleted-plan builds its columns from the snapshot, after setting factory_id.
        const ok = m[1].includes('${')
          ? text.slice(0, m.index).includes('planSnap.factory_id = Number(snapFactoryId)')
          : /\bfactory_id\b/.test(m[1]);
        if (!ok) bad.push(path.relative(root, file));
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
    expect(bad).toEqual([]);
  });

  it('the planning board never shares a plan without a factory again', () => {
    const text = fs.readFileSync(path.join(root, 'src/legacy/registerLegacyRoutes.js'), 'utf8');
    // board, machine-wise, print-jc-plans and job-card-approvals
    expect(text.match(/planVisibleToFactorySql\(/g).length).toBeGreaterThanOrEqual(4);
  });
});
