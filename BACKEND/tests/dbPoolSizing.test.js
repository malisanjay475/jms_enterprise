'use strict';

const { computePoolMax, detectWorkerCount } = require('../src/db/poolSizing');

describe('Database pool sizing', () => {
  it('keeps 50 for a single process (factory LOCAL server)', () => {
    expect(computePoolMax({}, 16)).toMatchObject({ max: 50, workers: 1 });
  });

  it('splits the budget across PM2 cluster workers (VPS: instances max, 4 CPUs)', () => {
    // PM2 turns instances: 'max' into 0 and exec_mode 'cluster' into 'cluster_mode'.
    const env = { exec_mode: 'cluster_mode', instances: '0' };
    expect(detectWorkerCount(env, 4)).toBe(4);
    const { max, workers } = computePoolMax(env, 4);
    expect(workers).toBe(4);
    expect(max * workers).toBeLessThanOrEqual(80);
    expect(max).toBe(20);
  });

  it('uses an explicit instance count', () => {
    expect(computePoolMax({ exec_mode: 'cluster_mode', instances: '2' }, 16).max).toBe(40);
  });

  it('never exceeds 50 or drops below 5 per process', () => {
    expect(computePoolMax({ DB_CONNECTION_BUDGET: '500' }, 1).max).toBe(50);
    expect(computePoolMax({ exec_mode: 'cluster_mode', instances: '0' }, 64).max).toBe(5);
  });

  it('honours DB_POOL_MAX, DB_CONNECTION_BUDGET and DB_POOL_WORKERS', () => {
    expect(computePoolMax({ DB_POOL_MAX: '12', exec_mode: 'cluster_mode' }, 4)).toMatchObject({ max: 12, source: 'DB_POOL_MAX' });
    expect(computePoolMax({ DB_CONNECTION_BUDGET: '40', DB_POOL_WORKERS: '4' }, 1).max).toBe(10);
  });

  it('ignores junk values', () => {
    expect(computePoolMax({ DB_POOL_MAX: 'abc', DB_CONNECTION_BUDGET: '-3', DB_POOL_WORKERS: '0' }, 4).max).toBe(50);
  });
});

describe('Shared pool', () => {
  it('routes vendor/ERP queries to the app pool once it is set', async () => {
    let shared;
    jest.isolateModules(() => { shared = require('../src/db/sharedPool'); });
    const appPool = { query: jest.fn().mockResolvedValue({ rows: [{ ok: 1 }] }), connect: jest.fn() };
    shared.setSharedPool(appPool);
    const r = await shared.pool.query('SELECT 1', []);
    expect(appPool.query).toHaveBeenCalledWith('SELECT 1', []);
    expect(r.rows[0].ok).toBe(1);
  });

  it('createDbPool registers itself as the shared pool with the computed size', () => {
    jest.isolateModules(() => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const saved = { ...process.env };
      Object.assign(process.env, { exec_mode: 'cluster_mode', instances: '4' });
      try {
        const createDbPool = require('../src/db/createDbPool');
        const shared = require('../src/db/sharedPool');
        const pool = createDbPool({ db: { host: '127.0.0.1', port: 5432, user: 'x', password: 'x', database: 'x' } });
        expect(shared.getPool()).toBe(pool);
        expect(pool.options.max).toBe(20);
        pool.end();
      } finally {
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
        logSpy.mockRestore();
      }
    });
  });
});
