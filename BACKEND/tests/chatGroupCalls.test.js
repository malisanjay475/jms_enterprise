'use strict';

const chatGroupCalls = require('../src/modules/chat/chatGroupCalls');

function poolWith(handler) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => { calls.push([String(sql), params || []]); return handler(String(sql), params || []); })
  };
}

describe('group call sweep', () => {
  test('an empty room ends and posts the call line in the group', async () => {
    const started = new Date('2026-10-26T10:00:00Z');
    const ended = new Date('2026-10-26T10:12:30Z');
    const pool = poolWith((sql) => {
      if (/UPDATE chat_rooms r SET ended_at/.test(sql)) {
        return { rows: [{ id: 'r1', conversation_sync_id: 'c1', started_by: 'ravi', started_at: started, ended_at: ended, peak: 4 }] };
      }
      if (/COUNT\(\*\)::int AS n FROM chat_room_members/.test(sql)) return { rows: [{ n: 3 }] };
      if (/INSERT INTO chat_messages/.test(sql)) return { rows: [{ server_ts: ended }] };
      return { rows: [] };
    });
    await chatGroupCalls.__test.sweep(pool);
    const line = pool.calls.find(([sql]) => /INSERT INTO chat_messages/.test(sql));
    expect(line[1]).toEqual(['c1', 'ravi', '📞 Group call · 4 people · 12:30']);
  });

  test('a call nobody joined says so', async () => {
    const t = new Date();
    const pool = poolWith((sql) => {
      if (/UPDATE chat_rooms r SET ended_at/.test(sql)) {
        return { rows: [{ id: 'r2', conversation_sync_id: 'c2', started_by: 'asha', started_at: t, ended_at: t, peak: 1 }] };
      }
      if (/COUNT\(\*\)::int AS n/.test(sql)) return { rows: [{ n: 1 }] };
      if (/INSERT INTO chat_messages/.test(sql)) return { rows: [{ server_ts: t }] };
      return { rows: [] };
    });
    await chatGroupCalls.__test.sweep(pool);
    const line = pool.calls.find(([sql]) => /INSERT INTO chat_messages/.test(sql));
    expect(line[1][2]).toBe('📞 Group call by asha · nobody joined');
  });

  test('stale people are taken out before rooms are ended', async () => {
    const pool = poolWith(() => ({ rows: [] }));
    await chatGroupCalls.__test.sweep(pool);
    expect(pool.calls[0][0]).toMatch(/UPDATE chat_room_members m SET left_at/);
    expect(pool.calls[0][1]).toEqual([chatGroupCalls.STALE_SECONDS]);
    expect(pool.calls[1][0]).toMatch(/UPDATE chat_rooms r SET ended_at/);
  });
});

test('a call holds at most 8 people', () => {
  expect(chatGroupCalls.MAX_PEOPLE).toBe(8);
});
