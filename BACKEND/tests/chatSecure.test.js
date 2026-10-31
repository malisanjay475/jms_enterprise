'use strict';

const chatSecure = require('../src/modules/chat/chatSecure');

function poolWith(handler) {
  return { query: jest.fn(async (sql, params) => handler(String(sql), params || [])) };
}

beforeEach(() => chatSecure.__test.checkCache.clear());

describe('device sessions', () => {
  test('a device signed out after the token was issued is refused', async () => {
    const out = Date.now();
    const pool = poolWith((sql) => (/FROM chat_devices WHERE id/.test(sql)
      ? { rows: [{ approved: true, signed_out_at: new Date(out) }] } : { rows: [] }));
    expect(await chatSecure.tokenStillValid(pool, { sub: 'ravi', did: 'd1', sat: out - 1000 })).toBe(false);
    chatSecure.__test.checkCache.clear();
    expect(await chatSecure.tokenStillValid(pool, { sub: 'ravi', did: 'd1', sat: out + 1000 })).toBe(true);
  });

  test('blocked or unknown devices are refused', async () => {
    const blocked = poolWith((sql) => (/FROM chat_devices WHERE id/.test(sql) ? { rows: [{ approved: false, signed_out_at: null }] } : { rows: [] }));
    expect(await chatSecure.tokenStillValid(blocked, { sub: 'a', did: 'x', sat: Date.now() })).toBe(false);
    chatSecure.__test.checkCache.clear();
    const gone = poolWith(() => ({ rows: [] }));
    expect(await chatSecure.tokenStillValid(gone, { sub: 'a', did: 'y', sat: Date.now() })).toBe(false);
  });

  test('old app tokens without a device id follow "sign out others"', async () => {
    const cut = Date.now();
    const pool = poolWith((sql) => (/FROM chat_signout/.test(sql) ? { rows: [{ before_at: new Date(cut) }] } : { rows: [] }));
    expect(await chatSecure.tokenStillValid(pool, { sub: 'ravi', sat: cut - 5 })).toBe(false);
    chatSecure.__test.checkCache.clear();
    expect(await chatSecure.tokenStillValid(pool, { sub: 'ravi', sat: cut + 5 })).toBe(true);
  });

  test('platform from the user agent', () => {
    const { platformOf } = chatSecure.__test;
    expect(platformOf('okhttp/4.12.0')).toBe('android-app');
    expect(platformOf('JMSChatApp/2.6.0 (Android)')).toBe('android-app');
    expect(platformOf('JMSChatApp/1.0.0 (macOS)')).toBe('mac-app');
    expect(platformOf('Mozilla/5.0 (Linux; Android 14)')).toBe('android-web');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0)')).toBe('web');
  });
});

describe('disappearing options', () => {
  test('only the offered durations', () => {
    expect(Object.keys(chatSecure.DISAPPEAR).map(Number)).toEqual([0, 86400, 604800, 7776000]);
  });
});
