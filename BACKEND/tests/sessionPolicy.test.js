'use strict';

jest.mock('../src/legacy/registerLegacyRoutes', () =>
  jest.fn(() => ({ initializeLegacyRuntime: jest.fn().mockResolvedValue({}) }))
);

const express = require('express');
const request = require('supertest');
const { isPublicApi, sessionRequired, requireSessionMiddleware } = require('../src/app/sessionPolicy');

describe('Public API list', () => {
  it('keeps the login flow and self-authenticated endpoints open', () => {
    for (const p of [
      '/api/login', '/api/logout', '/api/session', '/api/version', '/api/health',
      '/api/sync/pull', '/api/sync-alert', '/api/local-servers/4/file-manifest', '/api/update/download',
      '/api/machine-data/ingest', '/api/machine-data/cycle-ingest', '/api/machine-data/config/enabled',
      '/api/assembly/device-scan', '/api/vendor/auth/login', '/api/vendor/data/orders', '/api/vendor/action/dispatch',
      '/api/qc-app/publish'
    ]) expect(isPublicApi(p)).toBe(true);
  });

  it('protects everything else, including look-alike paths', () => {
    for (const p of [
      '/api/orders', '/api/planning/board', '/api/qc/verify/submit', '/api/machine-data/latest',
      '/api/machine-data/config', '/api/vendor/admin/list', '/api/loginx', '/api/syncx', '/api/admin/backup'
    ]) expect(isPublicApi(p)).toBe(false);
  });
});

describe('AUTH_REQUIRE_SESSION switch', () => {
  const saved = process.env.AUTH_REQUIRE_SESSION;
  afterEach(() => { if (saved === undefined) delete process.env.AUTH_REQUIRE_SESSION; else process.env.AUTH_REQUIRE_SESSION = saved; });

  function app(auth) {
    const a = express();
    a.use((req, res, next) => { req.auth = auth; next(); });
    a.use('/api', requireSessionMiddleware);
    a.all(/^\/api\/.*/, (req, res) => res.json({ ok: true }));
    return a;
  }

  it('is off by default (legacy fallback keeps working)', async () => {
    delete process.env.AUTH_REQUIRE_SESSION;
    expect(sessionRequired()).toBe(false);
    expect((await request(app(null)).get('/api/orders')).status).toBe(200);
  });

  it('when on: 401 for protected calls without a session, open for sessions and public endpoints', async () => {
    process.env.AUTH_REQUIRE_SESSION = '1';
    const res = await request(app(null)).get('/api/orders');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    expect((await request(app({ username: 'ravi' })).get('/api/orders')).status).toBe(200);
    expect((await request(app(null)).post('/api/login')).status).toBe(200);
    expect((await request(app(null)).post('/api/sync/push')).status).toBe(200);
  });

  it('is wired into the real app before the routes', async () => {
    process.env.AUTH_REQUIRE_SESSION = '1';
    const { createTestApp } = require('./helpers/createTestApp');
    const { app: real, restoreEnv } = createTestApp();
    try {
      const blocked = await request(real).get('/api/reports/jms-plan').set('X-User-Name', 'admin');
      expect(blocked.status).toBe(401);
      const open = await request(real).get('/api/version');
      expect(open.status).toBe(200);
    } finally {
      restoreEnv();
    }
  });
});
