'use strict';

// Mock legacy routes — 469 lines of business routes, tested separately
jest.mock('../src/legacy/registerLegacyRoutes', () =>
  jest.fn(() => ({
    initializeLegacyRuntime: jest.fn().mockResolvedValue({})
  }))
);

const request = require('supertest');
const { createTestApp } = require('./helpers/createTestApp');

describe('Health endpoints', () => {
  let app, restoreEnv;

  beforeAll(() => {
    ({ app, restoreEnv } = createTestApp());
  });

  afterAll(() => restoreEnv());

  describe('GET /health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('returns ok: true', async () => {
      const res = await request(app).get('/health');
      expect(res.body.ok).toBe(true);
    });

    it('returns service name', async () => {
      const res = await request(app).get('/health');
      expect(res.body.service).toBe('jms-backend');
    });

    it('returns status: healthy', async () => {
      const res = await request(app).get('/health');
      expect(res.body.status).toBe('healthy');
    });

    it('returns JSON content-type', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('GET /api/health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('returns ok: true', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.ok).toBe(true);
    });

    it('checks the database and does not reveal where it is', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.db.ok).toBe(true);
      expect(res.body.db.host).toBeUndefined();
      expect(res.body.db.database).toBeUndefined();
      expect(res.body.db.port).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('is also served at /health/ready', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });
});

describe('Readiness check', () => {
  const { createReadinessCheck } = require('../src/app/healthCheck');
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warnSpy.mockRestore());

  it('reports the database as unreachable without leaking the error text', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 172.18.0.2:5432')) };
    const result = await createReadinessCheck(pool, { cacheMs: 0 })();
    expect(result.ok).toBe(false);
    expect(result.db.error).toBe('unreachable');
    expect(JSON.stringify(result)).not.toContain('172.18.0.2');
    expect(warnSpy.mock.calls.join(' ')).toContain('ECONNREFUSED');
  });

  it('times out when the database hangs', async () => {
    const pool = { query: jest.fn(() => new Promise(() => {})) };
    const result = await createReadinessCheck(pool, { timeoutMs: 50, cacheMs: 0 })();
    expect(result.ok).toBe(false);
    expect(result.db.error).toBe('timeout');
  });

  it('caches the answer so frequent polling does not load the database', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }), totalCount: 3, idleCount: 2, waitingCount: 0 };
    const check = createReadinessCheck(pool, { cacheMs: 60000 });
    const [a, b] = await Promise.all([check(), check()]);
    await check();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.pool).toEqual({ total: 3, idle: 2, waiting: 0 });
  });
});
