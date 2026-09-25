'use strict';

// Security round 3 (Sep-2026 audit follow-up).

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('Server error details are hidden from API clients', () => {
  const { hideServerErrorDetails } = require('../src/app/registerCoreMiddleware');

  function makeApp() {
    const app = express();
    app.use(hideServerErrorDetails);
    app.get('/api/boom', (req, res) => res.status(500).json({ ok: false, error: 'relation "secret_table" does not exist' }));
    app.get('/api/bad', (req, res) => res.status(400).json({ ok: false, error: 'Username required' }));
    app.get('/api/sync/boom', (req, res) => res.status(500).json({ ok: false, error: 'sync detail' }));
    app.get('/api/local-servers/boom', (req, res) => res.status(500).json({ ok: false, error: 'node detail' }));
    return app;
  }

  let errorSpy;
  beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => errorSpy.mockRestore());

  it('replaces a 5xx error with a generic message and a reference, and logs the detail', async () => {
    const res = await request(makeApp()).get('/api/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain('secret_table');
    expect(res.body.error).toContain(res.body.ref);
    expect(res.body.ref).toMatch(/^E[0-9A-Z]+$/);
    expect(errorSpy.mock.calls.join(' ')).toContain('secret_table');
  });

  it('leaves 4xx messages alone', async () => {
    const res = await request(makeApp()).get('/api/bad');
    expect(res.body.error).toBe('Username required');
  });

  it('keeps detailed errors on machine-to-machine endpoints', async () => {
    expect((await request(makeApp()).get('/api/sync/boom')).body.error).toBe('sync detail');
    expect((await request(makeApp()).get('/api/local-servers/boom')).body.error).toBe('node detail');
  });
});

describe('General API rate limit bucket', () => {
  it('cannot be escaped by changing the X-User-Name header', async () => {
    const { apiLimiter } = require('../src/app/registerCoreMiddleware');
    const app = express();
    app.use('/api/', apiLimiter);
    app.get('/api/ping', (req, res) => res.json({ ok: true }));

    let limited = false;
    for (let i = 0; i < 605 && !limited; i += 1) {
      const res = await request(app).get('/api/ping').set('X-User-Name', `fake-user-${i}`);
      if (res.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  }, 60000);

  it('gives each verified user their own bucket', async () => {
    let apiLimiter;
    jest.isolateModules(() => { ({ apiLimiter } = require('../src/app/registerCoreMiddleware')); });
    const app = express();
    app.use((req, res, next) => { req.auth = { username: req.get('x-test-user') }; next(); });
    app.use('/api/', apiLimiter);
    app.get('/api/ping', (req, res) => res.json({ ok: true }));

    for (let i = 0; i < 600; i += 1) await request(app).get('/api/ping').set('x-test-user', 'alice');
    expect((await request(app).get('/api/ping').set('x-test-user', 'alice')).status).toBe(429);
    expect((await request(app).get('/api/ping').set('x-test-user', 'bob')).status).toBe(200);
  }, 60000);
});

describe('HSTS header', () => {
  function appFor(serverType) {
    let registerCoreMiddleware;
    withEnv({ SERVER_TYPE: serverType }, () => {
      jest.isolateModules(() => { registerCoreMiddleware = require('../src/app/registerCoreMiddleware'); });
    });
    const app = express();
    withEnv({ SERVER_TYPE: serverType }, () => registerCoreMiddleware(app));
    app.get('/x', (req, res) => res.json({ ok: true }));
    return app;
  }

  it('is sent on MAIN', async () => {
    const res = await request(appFor('MAIN')).get('/x');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=15552000/);
    expect(res.headers['strict-transport-security']).not.toMatch(/includeSubDomains/);
  });

  it('is not sent on a LOCAL factory server', async () => {
    const res = await request(appFor('LOCAL')).get('/x');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('New route guards', () => {
  const { findGuard } = require('../src/app/routeGuards');

  it('locks the desktop installer download to admins', () => {
    expect(findGuard('GET', '/api/local-servers/desktop-installer/download')).toMatchObject({ need: 'admin' });
  });

  it('needs a login to trigger an update check', () => {
    expect(findGuard('POST', '/api/update/force-check')).toMatchObject({ need: 'session' });
  });
});

describe('Login lockout', () => {
  const lockout = require('../src/app/loginLockout');
  beforeEach(() => lockout._resetForTests());

  let warnSpy;
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => warnSpy.mockRestore());

  it('locks a user on the machine that guessed, not on every machine', () => {
    for (let i = 0; i < lockout.LOGIN_MAX_ATTEMPTS; i += 1) lockout.recordLoginFailure('Ravi', '10.0.0.9');
    expect(lockout.checkBruteForce('ravi', '10.0.0.9')).toMatch(/Too many failed attempts/);
    expect(lockout.checkBruteForce('ravi', '10.0.0.20')).toBeNull();
  });

  it('locks the username everywhere once guesses from many addresses add up', () => {
    for (let i = 0; i < lockout.LOGIN_MAX_USER_ATTEMPTS; i += 1) lockout.recordLoginFailure('ravi', `10.1.${i}.1`);
    expect(lockout.checkBruteForce('ravi', '192.168.1.50')).toMatch(/Too many failed attempts/);
  });

  it('a correct login clears only that machine\'s count', () => {
    for (let i = 0; i < lockout.LOGIN_MAX_ATTEMPTS - 1; i += 1) lockout.recordLoginFailure('ravi', '10.0.0.9');
    lockout.clearLoginFailures('ravi', '10.0.0.9');
    lockout.recordLoginFailure('ravi', '10.0.0.9');
    expect(lockout.checkBruteForce('ravi', '10.0.0.9')).toBeNull();
  });
});

describe('Password minimum length', () => {
  const { passwordLengthError } = require('../src/app/passwordPolicy');

  it('defaults to 8 characters', () => {
    withEnv({ PASSWORD_MIN_LENGTH: undefined }, () => {
      expect(passwordLengthError('1234567')).toMatch(/at least 8/);
      expect(passwordLengthError('12345678')).toBeNull();
    });
  });

  it('can be changed in .env but never below 4', () => {
    withEnv({ PASSWORD_MIN_LENGTH: '6' }, () => expect(passwordLengthError('123456')).toBeNull());
    withEnv({ PASSWORD_MIN_LENGTH: '1' }, () => expect(passwordLengthError('123')).toMatch(/at least 4/));
  });
});

describe('Sync alert endpoint', () => {
  function appWithKey(key) {
    let createSyncAlertRoute;
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const app = express();
    withEnv({ SYNC_API_KEY: key }, () => {
      jest.isolateModules(() => { ({ createSyncAlertRoute } = require('../src/local-servers/syncAlertRoute')); });
      app.use('/api/sync-alert', createSyncAlertRoute(pool));
    });
    return app;
  }

  it('has no built-in default key', async () => {
    const res = await request(appWithKey(undefined)).get('/api/sync-alert?key=jms-secret-key-2024');
    expect(res.status).toBe(401);
  });

  it('rejects everything when SYNC_API_KEY is not set', async () => {
    const res = await request(appWithKey(undefined)).get('/api/sync-alert');
    expect(res.status).toBe(401);
  });

  it('accepts the configured key in the query or the header', async () => {
    const app = appWithKey('configured-key');
    expect((await request(app).get('/api/sync-alert?key=configured-key')).status).toBe(200);
    expect((await request(app).get('/api/sync-alert').set('x-sync-key', 'configured-key')).status).toBe(200);
    expect((await request(app).get('/api/sync-alert?key=wrong')).status).toBe(401);
  });
});

describe('Updater package download', () => {
  it('needs node authentication before anything is built', async () => {
    const { router } = require('../services/updater.service');
    const app = express();
    app.use('/api/update', router);
    const res = await request(app).get('/api/update/download');
    expect(res.status).toBe(401);
  });
});

describe('Local-server file download', () => {
  const NODE_KEY = 'node-secret';
  let app;

  beforeAll(async () => {
    const nodeRow = {
      id: 1, factory_id: 1, node_code: 'n1', node_name: 'n1', target_version: null, is_active: true,
      node_secret_hash: crypto.createHash('sha256').update(NODE_KEY).digest('hex')
    };
    const pool = {
      query: jest.fn(async (sql) => (/FROM local_servers/i.test(String(sql)) && /node_secret_hash/i.test(String(sql))
        ? { rows: [nodeRow], rowCount: 1 }
        : { rows: [], rowCount: 0 })),
      connect: jest.fn(async () => ({ query: pool.query, release: () => {} }))
    };
    const service = require('../src/local-servers/localServerService');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await service.init(pool);
    } finally {
      logSpy.mockRestore();
    }
    app = express();
    app.use('/api/local-servers', service.router);
  });

  it('serves a file that is in the update manifest', async () => {
    const res = await request(app).get('/api/local-servers/1/file?p=package.json').set('x-node-key', NODE_KEY);
    expect(res.status).toBe(200);
  });

  it('refuses files outside the manifest', async () => {
    for (const p of ['tests/securityRound3.test.js', '.env', 'logs/access.log', 'jest.config.js']) {
      const res = await request(app).get(`/api/local-servers/1/file?p=${encodeURIComponent(p)}`).set('x-node-key', NODE_KEY);
      expect(res.status).toBe(404);
    }
  });

  it('still needs the node key', async () => {
    const res = await request(app).get('/api/local-servers/1/file?p=package.json');
    expect(res.status).toBe(401);
  });
});
