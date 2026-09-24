'use strict';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Users the fake DB knows about.
const USERS = {
  alice: { id: 1, username: 'alice', role_code: 'operator', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
  admin1: { id: 2, username: 'admin1', role_code: 'admin', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
  root: { id: 3, username: 'root', role_code: 'superadmin', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
  hr: { id: 4, username: 'hr', role_code: 'hr_manager', permissions: { __apps: { users: true } }, global_access: false, is_active: true, logout_all_after: null },
  wiper: { id: 5, username: 'wiper', role_code: 'planner', permissions: { critical_ops: { data_wipe: true } }, global_access: false, is_active: true, logout_all_after: null },
  gone: { id: 6, username: 'gone', role_code: 'admin', permissions: {}, global_access: false, is_active: false, logout_all_after: null }
};

function makePool() {
  const serverConfig = {};
  return {
    serverConfig,
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM users')) {
        const u = USERS[params[0]];
        return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
      }
      if (text.includes("INSERT INTO server_config") && text.includes('AUTH_SESSION_SECRET')) {
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

function loadModules() {
  jest.resetModules();
  const auth = require('../src/app/auth');
  const guards = require('../src/app/routeGuards');
  auth.__test.resetForTests();
  return { auth, guards };
}

// App mirroring registerRoutes: auth middleware on /api, then the route guards, then
// probe handlers that echo what they saw.
function buildApp(pool, { auth, guards }) {
  const app = express();
  app.use(express.json());
  app.use('/api', auth.createAuthMiddleware(pool));
  app.use(guards.routeGuardMiddleware);
  app.post('/api/login-as/:user', async (req, res) => {
    await auth.issueSession(pool, req, res, USERS[req.params.user]);
    res.json({ ok: true });
  });
  app.all(/^\/api\/.*/, (req, res) => res.json({ ok: true, who: req.headers['x-user-name'] || null, auth: req.auth }));
  return app;
}

async function sessionCookieFor(app, user) {
  const res = await request(app).post(`/api/login-as/${user}`);
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('jms_session='));
  return cookie.split(';')[0];
}

const originalSecret = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = 'unit-test-secret'; });
afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax, and Secure only behind HTTPS', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);

    const plain = await request(app).post('/api/login-as/alice');
    const cookie = plain.headers['set-cookie'].find((c) => c.startsWith('jms_session='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);

    const https = await request(app).post('/api/login-as/alice').set('X-Forwarded-Proto', 'https');
    expect(https.headers['set-cookie'].find((c) => c.startsWith('jms_session='))).toMatch(/Secure/i);
  });

  it('replaces a spoofed X-User-Name with the verified user', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);
    const cookie = await sessionCookieFor(app, 'alice');

    const res = await request(app).get('/api/whoami').set('Cookie', cookie).set('X-User-Name', 'root');

    expect(res.body.who).toBe('alice');
    expect(res.body.auth).toMatchObject({ username: 'alice', role: 'operator' });
  });

  it('accepts the same token as a Bearer header (native clients)', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);
    const token = (await sessionCookieFor(app, 'admin1')).split('=')[1];

    const res = await request(app).get('/api/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.body.auth).toMatchObject({ username: 'admin1', role: 'admin' });
  });

  it('without a session keeps the legacy header (soft rollout) but sets no req.auth', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);

    const res = await request(app).get('/api/whoami').set('X-User-Name', 'alice');

    expect(res.body.who).toBe('alice');
    expect(res.body.auth).toBeNull();
  });

  it('ignores the old "dummy-token-for-now" placeholder', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);
    const res = await request(app).get('/api/whoami').set('Authorization', 'Bearer dummy-token-for-now');
    expect(res.body.auth).toBeNull();
  });

  it('rejects a tampered token and tells the browser to drop it', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);
    const cookie = await sessionCookieFor(app, 'alice');
    const forged = jwt.sign({ typ: 'session', sub: 'root', sat: Date.now() }, 'wrong-key');

    const res = await request(app).get('/api/whoami').set('Cookie', `jms_session=${forged}`);

    expect(res.body.auth).toBeNull();
    expect((res.headers['set-cookie'] || []).some((c) => /^jms_session=;/.test(c))).toBe(true);
    expect(cookie).toBeTruthy();
  });

  it('does not accept a vendor-portal JWT signed with the same JWT_SECRET', async () => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);
    const vendorToken = jwt.sign({ id: 9, vendorId: 9, role: 'vendor', sub: 'root', typ: 'session' }, 'unit-test-secret');

    const res = await request(app).get('/api/whoami').set('Authorization', `Bearer ${vendorToken}`);

    expect(res.body.auth).toBeNull();
  });

  it('rejects the session of a deactivated user', async () => {
    const mods = loadModules();
    const pool = makePool();
    const app = buildApp(pool, mods);
    const token = await mods.auth.signSession(pool, USERS.gone);

    const res = await request(app).get('/api/whoami').set('Cookie', `jms_session=${token}`);

    expect(res.body.auth).toBeNull();
  });

  it('revokes sessions issued before "log out other devices", keeps newer ones', async () => {
    const mods = loadModules();
    const pool = makePool();
    const app = buildApp(pool, mods);
    const cutoff = Date.now();
    USERS.alice.logout_all_after = new Date(cutoff).toISOString();
    try {
      const oldToken = await mods.auth.signSession(pool, USERS.alice, cutoff - 5000);
      const newToken = await mods.auth.signSession(pool, USERS.alice, cutoff + 1);

      const oldRes = await request(app).get('/api/whoami').set('Cookie', `jms_session=${oldToken}`);
      const newRes = await request(app).get('/api/whoami').set('Cookie', `jms_session=${newToken}`);

      expect(oldRes.body.auth).toBeNull();
      expect(newRes.body.auth).toMatchObject({ username: 'alice' });
    } finally {
      USERS.alice.logout_all_after = null;
    }
  });

  it('without JWT_SECRET creates one random key in server_config instead of a built-in default', async () => {
    delete process.env.JWT_SECRET;
    const mods = loadModules();
    const pool = makePool();
    const app = buildApp(pool, mods);

    const cookie = await sessionCookieFor(app, 'alice');
    const res = await request(app).get('/api/whoami').set('Cookie', cookie);

    expect(pool.serverConfig.AUTH_SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.auth).toMatchObject({ username: 'alice' });
  });
});

describe('route guards', () => {
  const cases = [
    // [method, path, user-or-null, expected status]
    ['get', '/api/admin/backup', null, 401],
    ['get', '/api/admin/backup', 'alice', 403],
    ['get', '/api/admin/backup', 'admin1', 200],
    ['post', '/api/admin/restore', 'admin1', 403],
    ['post', '/api/admin/restore', 'root', 200],
    ['post', '/api/admin/clear-data', 'alice', 403],
    ['post', '/api/admin/clear-data', 'wiper', 200],
    ['post', '/api/admin/clear-std-actual', 'wiper', 200],
    ['post', '/api/dpr/hourly/clear', 'wiper', 403],
    ['post', '/api/dpr/hourly/clear', 'admin1', 200],
    ['post', '/api/admin/users/create', 'hr', 403],
    ['get', '/api/admin/users', 'admin1', 200],
    ['post', '/api/users/save', null, 401],
    ['post', '/api/users/save', 'alice', 403],
    ['post', '/api/users/save', 'hr', 200],
    ['post', '/api/users/password', 'admin1', 200],
    ['post', '/api/logout-all', null, 401],
    ['post', '/api/logout-all', 'alice', 200],
    ['post', '/api/ai/ask', null, 401],
    ['post', '/api/ai/ask', 'alice', 200],
    ['put', '/api/machine-data/config/12', 'alice', 403],
    ['put', '/api/machine-data/config/12', 'admin1', 200],
    // Not guarded: normal traffic still works without a session during the soft rollout.
    ['get', '/api/dpr/recent', null, 200],
    ['post', '/api/dpr/submit', null, 200],
    ['get', '/api/machine-data/latest', null, 200]
  ];

  it.each(cases)('%s %s as %s -> %i', async (method, path, user, expected) => {
    const mods = loadModules();
    const app = buildApp(makePool(), mods);
    let req = request(app)[method](path).set('X-User-Name', 'root'); // spoof attempt on every call
    if (user) req = req.set('Cookie', await sessionCookieFor(app, user));

    const res = await req;

    expect(res.status).toBe(expected);
    if (expected === 401) expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('the guard list covers every endpoint the audit found open', () => {
    const { guards } = loadModules();
    for (const [method, path] of [
      ['GET', '/api/admin/backup'], ['POST', '/api/admin/restore'], ['POST', '/api/admin/clear-data'],
      ['POST', '/api/admin/clear-std-actual'], ['POST', '/api/dpr/hourly/clear'], ['POST', '/api/admin/users/create'],
      ['POST', '/api/admin/users/password'], ['POST', '/api/users/delete'], ['POST', '/api/logout-all'],
      ['POST', '/api/ai/ask'], ['PUT', '/api/machine-data/config/5'],
      ['GET', '/api/vendor/admin/list'], ['POST', '/api/vendor/admin/save'], ['POST', '/api/vendor/admin/delete'],
      ['POST', '/api/vendor/admin/po/save']
    ]) {
      expect(guards.findGuard(method, path)).not.toBeNull();
    }
  });
});

describe('User Management permission (server side)', () => {
  it('does not default to allowed when no permission is set', () => {
    const { auth } = loadModules();
    expect(auth.canManageUsers({ role: 'operator', permissions: {} })).toBe(false);
    expect(auth.canManageUsers({ role: 'operator', permissions: { users_edit: true } })).toBe(true);
    expect(auth.canManageUsers({ role: 'operator', permissions: { users: { delete: true } } })).toBe(true);
    expect(auth.canManageUsers({ role: 'operator', permissions: { __apps: { users: true } } })).toBe(true);
    expect(auth.canManageUsers({ role: 'admin', permissions: {} })).toBe(true);
  });
});
