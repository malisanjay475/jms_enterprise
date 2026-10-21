'use strict';

const chatExtras = require('../src/modules/chat/chatExtras');

function fakePool(rows) {
  return { query: jest.fn(async (sql) => (/FROM chat_reactions|FROM chat_stars/.test(sql) ? { rows } : { rows: [] })) };
}

describe('chat reactions', () => {
  test('grouped per emoji, most used first', async () => {
    const pool = fakePool([
      { message_sync_id: 'm1', emoji: '👍', username: 'Ravi' },
      { message_sync_id: 'm1', emoji: '❤️', username: 'Sita' },
      { message_sync_id: 'm1', emoji: '❤️', username: 'Amit' },
      { message_sync_id: 'm2', emoji: '😂', username: 'Ravi' }
    ]);
    const r = await chatExtras.reactionsFor(pool, ['m1', 'm2']);
    expect(r.get('m1')).toEqual([{ emoji: '❤️', users: ['Sita', 'Amit'] }, { emoji: '👍', users: ['Ravi'] }]);
    expect(r.get('m2')).toEqual([{ emoji: '😂', users: ['Ravi'] }]);
  });

  test('no messages, no query', async () => {
    const pool = fakePool([]);
    expect((await chatExtras.reactionsFor(pool, [])).size).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('chat stars', () => {
  test('only for a known user', async () => {
    const pool = fakePool([{ message_sync_id: 'm1' }]);
    expect([...(await chatExtras.starredAmong(pool, 'Ravi', ['m1', 'm2']))]).toEqual(['m1']);
    expect((await chatExtras.starredAmong(pool, null, ['m1'])).size).toBe(0);
  });
});
