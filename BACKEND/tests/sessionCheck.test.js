'use strict';

jest.mock('../src/legacy/registerLegacyRoutes', () =>
  jest.fn(() => ({ initializeLegacyRuntime: jest.fn().mockResolvedValue({}) }))
);

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const { createTestApp } = require('./helpers/createTestApp');

describe('GET /api/session', () => {
  let app, restoreEnv;
  beforeAll(() => { ({ app, restoreEnv } = createTestApp()); });
  afterAll(() => restoreEnv());

  it('reports no session for a browser without the login cookie, even with a username header', async () => {
    const res = await request(app).get('/api/session').set('X-User-Name', 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, authenticated: false, username: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// Runs the real session-check snippet from PUBLIC/assets/app.js with a fake browser.
const APP_JS = fs.readFileSync(path.join(__dirname, '../PUBLIC/assets/app.js'), 'utf8');
const SNIPPET = APP_JS.slice(APP_JS.indexOf('// ── Login session check'));

function storage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

async function runCheck({ pathname = '/planning.html', user = { username: 'Ravi' }, response, fetchFails = false, fresh = false }) {
  const localStorage = storage(user ? { user: JSON.stringify(user), jpsms_user: 'x' } : {});
  const sessionStorage = storage(fresh ? { jms_session_ok_at: String(Date.now()) } : {});
  const logout = jest.fn();
  const fetch = jest.fn(() => (fetchFails
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(response) })));
  const window = { location: { pathname, href: pathname }, JPSMS: { auth: { logout } } };
  vm.runInNewContext(SNIPPET, { window, localStorage, sessionStorage, fetch, Date, Number, String, JSON });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return { fetch, logout, localStorage, sessionStorage };
}

describe('Page session check (app.js)', () => {
  it('does nothing more when the browser has a valid session for the same user', async () => {
    const r = await runCheck({ response: { ok: true, authenticated: true, username: 'ravi' } });
    expect(r.logout).not.toHaveBeenCalled();
    expect(r.sessionStorage.data.jms_session_ok_at).toBeDefined();
  });

  it('sends a remembered user without a session to log in once', async () => {
    const r = await runCheck({ response: { ok: true, authenticated: false, username: null } });
    expect(r.logout).toHaveBeenCalledTimes(1);
    expect(r.sessionStorage.data.jms_login_reason).toBe('session');
    expect(r.localStorage.data.jpsms_user).toBeUndefined(); // no bounce from login.html
  });

  it('treats a session for a different user as stale', async () => {
    const r = await runCheck({ response: { ok: true, authenticated: true, username: 'someone-else' } });
    expect(r.logout).toHaveBeenCalledTimes(1);
  });

  it('never logs out on a network error or an unexpected answer', async () => {
    expect((await runCheck({ fetchFails: true })).logout).not.toHaveBeenCalled();
    expect((await runCheck({ response: { error: 'x' } })).logout).not.toHaveBeenCalled();
  });

  it('skips the login page, vendor pages, anonymous visitors and recently checked tabs', async () => {
    expect((await runCheck({ pathname: '/login.html', response: {} })).fetch).not.toHaveBeenCalled();
    expect((await runCheck({ pathname: '/vendor/dashboard.html', response: {} })).fetch).not.toHaveBeenCalled();
    expect((await runCheck({ user: null, response: {} })).fetch).not.toHaveBeenCalled();
    expect((await runCheck({ fresh: true, response: {} })).fetch).not.toHaveBeenCalled();
  });
});
