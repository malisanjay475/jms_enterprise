'use strict';

const express = require('express');
const request = require('supertest');

const USERS = {
  alice: { id: 1, username: 'alice', role_code: 'operator', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
  admin1: { id: 2, username: 'admin1', role_code: 'admin', permissions: {}, global_access: false, is_active: true, logout_all_after: null }
};

function makePool() {
  const serverConfig = {};
  const upserts = [];
  return {
    upserts,
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('INSERT INTO legacy_auth_usage')) { upserts.push(params); return { rows: [], rowCount: params[0].length }; }
      if (text.includes('FROM legacy_auth_usage')) {
        return { rows: [{ method: 'GET', path: '/api/orders', username: 'alice', client: 'browser', hits: 3, last_seen: new Date() }] };
      }
      if (text.includes('FROM users')) {
        const u = USERS[params[0]];
        return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
      }
      if (text.includes('INSERT INTO server_config') && text.includes('AUTH_SESSION_SECRET')) {
        if (!serverConfig.AUTH_SESSION_SECRET) serverConfig.AUTH_SESSION_SECRET = params[0];
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("key = 'AUTH_SESSION_SECRET'")) {
        return { rows: serverConfig.AUTH_SESSION_SECRET ? [{ value: serverConfig.AUTH_SESSION_SECRET }] : [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    })
  };
}

function setup() {
  jest.resetModules();
  const auth = require('../src/app/auth');
  const guards = require('../src/app/routeGuards');
  const usage = require('../src/app/legacyAuthUsage');
  auth.__test.resetForTests();
  usage._resetForTests();
  const pool = makePool();
  const app = express();
  app.use(express.json());
  app.use('/api', auth.createAuthMiddleware(pool));
  app.use(guards.routeGuardMiddleware);
  app.post('/api/login-as/:user', async (req, res) => {
    await auth.issueSession(pool, req, res, USERS[req.params.user]);
    res.json({ ok: true });
  });
  app.get('/api/admin/legacy-auth-usage', async (req, res) => {
    await usage.flush();
    res.json({ ok: true, ...(await usage.getReport(pool, { days: req.query.days })) });
  });
  app.all(/^\/api\/.*/, (req, res) => res.json({ ok: true, who: req.headers['x-user-name'] || null }));
  return { app, pool, usage };
}

describe('Legacy identity usage report', () => {
  afterEach(() => require('../src/app/legacyAuthUsage')._resetForTests());

  it('counts a request that names a user only in the header, and still serves it unchanged', async () => {
    const { app, usage } = setup();
    const res = await request(app).get('/api/planning/orders/JR-2026-114/details')
      .set('X-User-Name', 'Alice').set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0)');
    expect(res.status).toBe(200);
    expect(res.body.who).toBe('Alice'); // behaviour unchanged: legacy fallback still works
    const [row] = usage._pendingForTests();
    expect(row).toMatchObject({ method: 'GET', path: '/api/planning/orders/:x/details', username: 'alice', client: 'browser', hits: 1 });
  });

  it('counts body session.username too, and groups repeats', async () => {
    const { app, usage } = setup();
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/dpr/save').set('User-Agent', 'okhttp/4.12').send({ session: { username: 'bob' } });
    }
    const rows = usage._pendingForTests();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: 'bob', client: 'android-app', hits: 3 });
  });

  it('does not count logged-in requests or public endpoints; anonymous calls count as "(none)"', async () => {
    const { app, usage } = setup();
    const agent = request.agent(app);
    await agent.post('/api/login-as/alice');
    usage._resetForTests(); // the test-only login route itself is not under test
    usage.setPool({ query: jest.fn() });
    await agent.get('/api/orders').set('X-User-Name', 'someone-else'); // logged in
    await request(app).post('/api/login').set('X-User-Name', 'alice').send({ username: 'alice' }); // public
    await request(app).post('/api/sync/push').send({}); // public (own key)
    await request(app).get('/api/machines'); // anonymous, protected
    const rows = usage._pendingForTests();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: '/api/machines', username: '(none)' });
  });

  it('writes the counts in one upsert and the report is admin-only', async () => {
    const { app, pool } = setup();
    await request(app).get('/api/orders').set('X-User-Name', 'alice');
    await request(app).get('/api/orders').set('X-User-Name', 'alice');

    expect((await request(app).get('/api/admin/legacy-auth-usage')).status).toBe(401);
    const op = request.agent(app);
    await op.post('/api/login-as/alice');
    expect((await op.get('/api/admin/legacy-auth-usage')).status).toBe(403);

    const admin = request.agent(app);
    await admin.post('/api/login-as/admin1');
    const res = await admin.get('/api/admin/legacy-auth-usage?days=7');
    expect(res.status).toBe(200);
    expect(res.body.totalHits).toBe(3);
    expect(res.body.byClient[0]).toEqual({ client: 'browser', hits: 3 });
    expect(pool.upserts).toHaveLength(1);
    const [, , paths, users, , hits] = pool.upserts[0];
    const aliceRow = users.findIndex((u, i) => u === 'alice' && paths[i] === '/api/orders');
    expect(hits[aliceRow]).toBe(2); // two alice requests → one row, hits 2
  });

  it('never breaks a request when saving fails', async () => {
    const usage = require('../src/app/legacyAuthUsage');
    usage._resetForTests();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    usage.setPool({ query: jest.fn().mockRejectedValue(new Error('relation "legacy_auth_usage" does not exist')) });
    usage.recordLegacyUse({ auth: null, baseUrl: '/api', path: '/orders', method: 'GET', headers: { 'x-user-name': 'a' } });
    await expect(usage.flush()).resolves.toBe(0);
    warn.mockRestore();
  });

  it('classifies clients and collapses ids in paths', () => {
    const { normalizePath, classifyClient } = require('../src/app/legacyAuthUsage');
    expect(normalizePath('/api/machines/12/status')).toBe('/api/machines/:x/status');
    expect(classifyClient('Mozilla/5.0 (Linux; Android 14) Mobile')).toBe('mobile-browser');
    expect(classifyClient('Dart/3.4 (dart:io)')).toBe('android-app');
    expect(classifyClient('node-fetch/1.0')).toBe('node-script');
    expect(classifyClient('')).toBe('no-user-agent');
  });
});
