'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const chatNotify = require('../src/modules/chat/chatNotify');

describe('chat mute values sent to the browser', () => {
  test('"always" (PostgreSQL infinity) is a far-future date, never null', () => {
    expect(chatNotify.muteOut(Infinity)).toBe('9999-12-31T23:59:59.000Z');
    expect(chatNotify.muteOut('infinity')).toBe('9999-12-31T23:59:59.000Z');
  });

  test('a mute in the past or none reads as not muted', () => {
    expect(chatNotify.muteOut(null)).toBeNull();
    expect(chatNotify.muteOut(new Date(Date.now() - 1000))).toBeNull();
    const later = new Date(Date.now() + 3600e3);
    expect(chatNotify.muteOut(later)).toBe(later.toISOString());
  });
});

describe('web push is MAIN-only and needs VAPID keys from the environment', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('off without keys', () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    process.env.SERVER_TYPE = 'MAIN';
    expect(chatNotify.pushEnabled()).toBe(false);
  });

  test('off on a factory LOCAL even with keys', () => {
    jest.isolateModules(() => {
      jest.doMock('../services/sync.service', () => ({
        getRuntime: () => ({ serverType: 'LOCAL', mainUrl: 'http://main', factoryId: 2, apiKey: 'k' }),
        syncKeyValid: () => false
      }));
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      expect(require('../src/modules/chat/chatNotify').pushEnabled()).toBe(false);
    });
  });

  test('on for MAIN with keys', () => {
    jest.isolateModules(() => {
      jest.doMock('../services/sync.service', () => ({
        getRuntime: () => ({ serverType: 'MAIN', mainUrl: '', factoryId: 1, apiKey: 'k' }),
        syncKeyValid: () => false
      }));
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      expect(require('../src/modules/chat/chatNotify').pushEnabled()).toBe(true);
    });
  });
});

describe('sw-chat.js', () => {
  function load() {
    const handlers = {};
    const shown = [];
    const posted = [];
    const opened = [];
    const ctx = {
      clientsList: [],
      self: {
        addEventListener: (t, fn) => { handlers[t] = fn; },
        registration: { showNotification: async (title, opts) => { shown.push({ title, opts }); } },
        clients: {
          matchAll: async () => ctx.clientsList,
          openWindow: async (u) => { opened.push(u); }
        }
      }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../PUBLIC/sw-chat.js'), 'utf8'), ctx);
    const fire = async (type, ev) => {
      let p = Promise.resolve();
      handlers[type]({ ...ev, waitUntil: (x) => { p = x; } });
      await p;
    };
    return { fire, shown, posted, opened, ctx };
  }
  const chat = '5a716e9e-012c-5917-6b73-cc6d50dc91cd';
  const pushEv = (data) => ({ data: { json: () => data } });

  test('shows a chat push when no JMS tab is in front', async () => {
    const t = load();
    await t.fire('push', pushEv({ type: 'chat', title: 'carol', body: 'hi', conversation_sync_id: chat }));
    expect(t.shown).toHaveLength(1);
    expect(t.shown[0].opts.tag).toBe(`jms-chat-${chat}`);
  });

  test('stays quiet while a JMS tab is visible and focused', async () => {
    const t = load();
    t.ctx.clientsList = [{ visibilityState: 'visible', focused: true }];
    await t.fire('push', pushEv({ type: 'chat', title: 'carol', body: 'hi', conversation_sync_id: chat }));
    expect(t.shown).toHaveLength(0);
  });

  test('click opens the chat in a new tab when none is open', async () => {
    const t = load();
    await t.fire('notificationclick', { notification: { data: { chat }, close() {} } });
    expect(t.opened).toEqual([`/index.html?chat=${chat}`]);
  });

  test('on iPhone the click opens the chat app (home-screen web app)', async () => {
    const t = load();
    t.ctx.self.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' };
    await t.fire('notificationclick', { notification: { data: { chat }, close() {} } });
    expect(t.opened).toEqual([`/chat_app.html?chat=${chat}`]);
  });

  test('ignores other pushes and notifications', async () => {
    const t = load();
    await t.fire('push', pushEv({ type: 'other' }));
    await t.fire('notificationclick', { notification: { data: {}, close() {} } });
    expect(t.shown).toHaveLength(0);
    expect(t.opened).toHaveLength(0);
  });
});
