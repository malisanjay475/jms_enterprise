'use strict';

const crypto = require('crypto');
const chatFcm = require('../src/modules/chat/chatFcm');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ACCOUNT = {
  project_id: 'jms-test',
  client_email: 'push@jms-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
};

function fakePool(devices) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/FROM chat_fcm_devices/.test(sql)) return { rows: devices };
      return { rows: [], rowCount: 1 };
    })
  };
}

describe('JMS Chat app push (FCM)', () => {
  const saved = { ...process.env };
  const savedFetch = global.fetch;
  beforeEach(() => chatFcm.__test.reset());
  afterEach(() => {
    process.env = { ...saved };
    global.fetch = savedFetch;
  });

  test('off without a service account', () => {
    delete process.env.FCM_SERVICE_ACCOUNT;
    delete process.env.FCM_SERVICE_ACCOUNT_FILE;
    expect(chatFcm.enabled()).toBe(false);
  });

  test('a broken key leaves push off instead of crashing', () => {
    process.env.FCM_SERVICE_ACCOUNT = '{"project_id":"x"}';
    expect(chatFcm.enabled()).toBe(false);
  });

  test('reads the key as JSON or base64', () => {
    process.env.SERVER_TYPE = 'MAIN';
    process.env.FCM_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(ACCOUNT)).toString('base64');
    expect(chatFcm.enabled()).toBe(true);
  });

  test('sends a high-priority data message to each device and drops dead tokens', async () => {
    process.env.SERVER_TYPE = 'MAIN';
    process.env.FCM_SERVICE_ACCOUNT = JSON.stringify(ACCOUNT);
    const sent = [];
    global.fetch = jest.fn(async (url, opts) => {
      if (String(url).includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      const body = JSON.parse(opts.body);
      sent.push(body.message);
      if (body.message.token === 'dead') return { ok: false, status: 404, text: async () => '{"error":{"status":"NOT_FOUND"}}' };
      return { ok: true, text: async () => '{}' };
    });
    const pool = fakePool([{ id: 1, token: 'good' }, { id: 2, token: 'dead' }]);

    const r = await chatFcm.sendToUsers(pool, ['Ravi'], { type: 'chat', title: 'Sita', body: 'hi', conversation_sync_id: 'c1' });

    expect(r.sent).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ token: 'good', data: { body: 'hi' }, android: { priority: 'HIGH' } });
    expect(sent[0].notification).toBeUndefined(); // data-only: the app builds the notification
    expect(pool.calls.some((c) => /DELETE FROM chat_fcm_devices/.test(c.sql) && c.params[0] === 2)).toBe(true);
  });
});
