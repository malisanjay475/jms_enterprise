'use strict';

// Chat kill switch / staged rollout rules (src/modules/chat/chatGate.js).

// One mock for the whole file; each test sets the server it pretends to be.
const runtime = { serverType: 'MAIN', factoryId: 1 };
jest.mock('../services/sync.service', () => ({
  getRuntime: () => ({ serverType: runtime.serverType, mainUrl: '', factoryId: runtime.factoryId, apiKey: 'k' }),
  syncKeyValid: () => false
}));

function loadGate({ serverType = 'MAIN', factoryId = 1, config = {}, mainSettings = null, userFactories = [] } = {}) {
  let gate;
  runtime.serverType = serverType;
  runtime.factoryId = factoryId;
  jest.isolateModules(() => {
    gate = require('../src/modules/chat/chatGate');
  });
  const pool = {
    query: async (sql, params) => {
      if (/FROM server_config/.test(sql)) return { rows: config[params[0]] != null ? [{ value: config[params[0]] }] : [] };
      if (/main_chat_settings/.test(sql)) return { rows: mainSettings ? [{ value: JSON.stringify(mainSettings) }] : [] };
      if (/user_factories/.test(sql)) return { rows: userFactories.map((f) => ({ f })) };
      return { rows: [] };
    }
  };
  return { gate, pool };
}

describe('chat settings values', () => {
  test('parse', () => {
    const { gate } = loadGate();
    expect(gate.parseEnabled('0')).toBe(false);
    expect(gate.parseEnabled('off')).toBe(false);
    expect(gate.parseEnabled('1')).toBe(true);
    expect(gate.parseEnabled('')).toBeNull();
    expect(gate.parseFactories('all')).toBe('all');
    expect(gate.parseFactories(' 3, 1,1 ')).toEqual([1, 3]);
    expect(gate.parseFactories('x')).toEqual([]);
  });
});

describe('who gets chat', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  const op = (username) => ({ username, role: 'operator' });

  test('on for everyone by default', async () => {
    const { gate, pool } = loadGate();
    expect(await gate.access(pool, op('bob'))).toEqual({ ok: true });
  });

  test('switched off: nobody, superadmins included', async () => {
    const { gate, pool } = loadGate({ config: { CHAT_ENABLED: '0' } });
    expect((await gate.access(pool, op('bob'))).ok).toBe(false);
    expect((await gate.access(pool, { username: 'root', role: 'superadmin' })).ok).toBe(false);
  });

  test('environment beats the Settings page', async () => {
    process.env.CHAT_ENABLED = '0';
    const { gate, pool } = loadGate({ config: { CHAT_ENABLED: '1' } });
    const s = await gate.settings(pool, { fresh: true });
    expect(s.enabled).toBe(false);
    expect(s.source.enabled).toBe('env');
  });

  test('MAIN rollout list: users of listed factories (home or assigned) and superadmins', async () => {
    let t = loadGate({ config: { CHAT_FACTORIES: '1' }, userFactories: [2, 1] });
    expect((await t.gate.access(t.pool, op('dave'))).ok).toBe(true);
    t = loadGate({ config: { CHAT_FACTORIES: '1' }, userFactories: [2] });
    expect(await t.gate.access(t.pool, op('carol'))).toEqual({ ok: false, reason: 'factory' });
    expect((await t.gate.access(t.pool, { username: 'root', role: 'superadmin' })).ok).toBe(true);
  });

  test('a LOCAL follows MAIN and checks its own factory', async () => {
    let t = loadGate({ serverType: 'LOCAL', factoryId: 2, mainSettings: { enabled: true, factories: [1] }, config: { CHAT_FACTORIES: 'all' } });
    expect((await t.gate.access(t.pool, op('carol'))).ok).toBe(false);
    expect((await t.gate.settings(t.pool, { fresh: true })).source.factories).toBe('main');
    t = loadGate({ serverType: 'LOCAL', factoryId: 2, mainSettings: { enabled: true, factories: [1, 2] } });
    expect((await t.gate.access(t.pool, op('carol'))).ok).toBe(true);
    t = loadGate({ serverType: 'LOCAL', factoryId: 2, mainSettings: { enabled: false, factories: 'all' } });
    expect((await t.gate.access(t.pool, op('carol'))).ok).toBe(false);
  });

  test('the middleware answers 404 CHAT_DISABLED', async () => {
    const { gate, pool } = loadGate({ config: { CHAT_ENABLED: 'off' } });
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let passed = false;
    await gate.middleware(pool)({ auth: op('bob') }, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.code).toBe(404);
    expect(res.body.code).toBe('CHAT_DISABLED');
  });
});
