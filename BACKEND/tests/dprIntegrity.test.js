'use strict';

const express = require('express');
const request = require('supertest');

describe('validateDprQuantities', () => {
  const { validateDprQuantities } = require('../src/app/dprValidation');

  it.each([
    [{ shots: 120, good: 118, reject: 2, downtime: 0 }, null],
    [{ shots: '1,200', good: '1,180', reject: '20', downtime: '60' }, null], // formatted strings
    [{ shots: '', good: null, reject: undefined, downtime: '' }, null],      // blank fields allowed
    [{ good: 12.5 }, null],                                                   // decimals exist in real data
    [{ good: -5 }, 'Good quantity cannot be negative.'],
    [{ reject: -1 }, 'Reject quantity cannot be negative.'],
    [{ shots: -10 }, 'Shots cannot be negative.'],
    [{ downtime: -1 }, 'Downtime cannot be negative.'],
    [{ downtime: 61 }, 'Downtime cannot be more than 60 minutes in one hour slot.'],
    [{ good: 'abc' }, 'Good quantity must be a number.'],
    [{ good: Infinity }, 'Good quantity must be a number.']
  ])('%j -> %s', (input, expected) => {
    expect(validateDprQuantities(input)).toBe(expected);
  });
});

describe('verified session binds body session.username and guards DPR changes', () => {
  const USERS = {
    op: { id: 1, username: 'op', role_code: 'operator', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
    admin1: { id: 2, username: 'admin1', role_code: 'admin', permissions: {}, global_access: false, is_active: true, logout_all_after: null },
    root: { id: 3, username: 'root', role_code: 'superadmin', permissions: {}, global_access: false, is_active: true, logout_all_after: null }
  };
  const pool = {
    query: jest.fn(async (sql, params = []) => {
      if (String(sql).includes('FROM users')) {
        const u = USERS[params[0]];
        return { rows: u ? [{ ...u }] : [], rowCount: u ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    })
  };
  const originalSecret = process.env.JWT_SECRET;
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = 'dpr-test-secret';
    jest.resetModules();
    const auth = require('../src/app/auth');
    auth.__test.resetForTests();
    const { routeGuardMiddleware } = require('../src/app/routeGuards');
    app = express();
    app.use(express.json());
    app.use('/api', auth.createAuthMiddleware(pool));
    app.use(routeGuardMiddleware);
    app.post('/login-as/:user', async (req, res) => {
      await auth.issueSession(pool, req, res, USERS[req.params.user]);
      res.json({ ok: true });
    });
    // Echo what a legacy handler would see.
    app.post(/^\/api\/.*/, (req, res) => res.json({ ok: true, sessionUser: req.body?.session?.username ?? null }));
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  async function cookieFor(user) {
    const res = await request(app).post(`/login-as/${user}`);
    return res.headers['set-cookie'].find((c) => c.startsWith('jms_session=')).split(';')[0];
  }

  it('an operator claiming to be root in the body is seen as the operator', async () => {
    const res = await request(app).post('/api/dpr/submit')
      .set('Cookie', await cookieFor('op'))
      .send({ session: { username: 'root', line: 'B -L4' }, entry: {} });
    expect(res.body.sessionUser).toBe('op');
  });

  it('without a session the body is left as sent (soft rollout)', async () => {
    const res = await request(app).post('/api/dpr/submit').send({ session: { username: 'op' }, entry: {} });
    expect(res.body.sessionUser).toBe('op');
  });

  it.each([
    ['/api/dpr/superadmin-set-qty', null, 401],
    ['/api/dpr/superadmin-set-qty', 'admin1', 403],
    ['/api/dpr/superadmin-set-qty', 'root', 200],
    ['/api/dpr/edit', 'op', 403],
    ['/api/dpr/edit', 'admin1', 200],
    ['/api/dpr/setup/clear', 'op', 403],
    ['/api/dpr/delete', null, 401],
    ['/api/dpr/delete-entry', 'op', 200],   // handler then checks the (now verified) role
    ['/api/dpr/delete-quick', null, 401],
    ['/api/dpr/delete-setup', null, 401],
    ['/api/dpr/submit', null, 200]          // floor entry stays open in the soft rollout
  ])('POST %s as %s -> %i', async (path, user, expected) => {
    let req = request(app).post(path).send({ session: { username: 'root' }, callerRole: 'superadmin' });
    if (user) req = req.set('Cookie', await cookieFor(user));
    const res = await req;
    expect(res.status).toBe(expected);
  });
});
