'use strict';

const crypto = require('crypto');
const chatCalls = require('../src/modules/chat/chatCalls');

describe('chat call ICE servers', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('STUN only without TURN settings', () => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_SECRET;
    const ice = chatCalls.iceServers('ravi');
    expect(ice).toHaveLength(1);
    expect(ice[0].urls[0]).toMatch(/^stun:/);
  });

  test('TURN gets coturn REST credentials: user "<expiry>:<name>", HMAC-SHA1 of it', () => {
    process.env.TURN_URLS = 'turn:jmsocean.cloud:3478, turn:jmsocean.cloud:3478?transport=tcp';
    process.env.TURN_SECRET = 's3cret';
    const ice = chatCalls.iceServers('ravi kumar');
    const turn = ice[1];
    expect(turn.urls).toEqual(['turn:jmsocean.cloud:3478', 'turn:jmsocean.cloud:3478?transport=tcp']);
    expect(turn.username).toMatch(/^\d+:ravikumar$/);
    expect(Number(turn.username.split(':')[0])).toBeGreaterThan(Date.now() / 1000);
    expect(turn.credential).toBe(crypto.createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
  });
});

describe('call length', () => {
  test('m:ss', () => {
    expect(chatCalls.fmtDuration(0)).toBe('0:00');
    expect(chatCalls.fmtDuration(201000)).toBe('3:21');
  });
});
