'use strict';

const chatSync = require('../src/modules/chat/chatSync');

describe('chat sync merge rules', () => {
  const { upsertSql } = chatSync.__test;

  test('ordinary columns: newer updated_at wins', () => {
    const sql = upsertSql('chat_messages', ['sync_id', 'body', 'updated_at']);
    expect(sql).toMatch(/ON CONFLICT \(sync_id\)/);
    expect(sql).toMatch(/body = CASE WHEN EXCLUDED\.updated_at > t\.updated_at THEN EXCLUDED\.body ELSE t\.body END/);
    expect(sql).toMatch(/updated_at = GREATEST\(t\.updated_at, EXCLUDED\.updated_at\)/);
    expect(sql).not.toMatch(/sync_id = /);
  });

  test('read position and last message only move forward', () => {
    expect(upsertSql('chat_members', ['sync_id', 'last_read_at', 'updated_at']))
      .toMatch(/last_read_at = GREATEST\(t\.last_read_at, EXCLUDED\.last_read_at\)/);
    expect(upsertSql('chat_conversations', ['sync_id', 'last_message_at', 'updated_at']))
      .toMatch(/last_message_at = GREATEST/);
  });

  test('receipts keep the first delivered / read time and are never undone', () => {
    const sql = upsertSql('chat_receipts', ['sync_id', 'delivered_at', 'read_at', 'updated_at']);
    expect(sql).toMatch(/read_at = COALESCE\(t\.read_at, EXCLUDED\.read_at\)/);
    expect(sql).toMatch(/\(t\.read_at IS NULL AND EXCLUDED\.read_at IS NOT NULL\)/);
  });

  test('shared ids come from the natural key', () => {
    expect(chatSync.deterministicIdSql('chat-dm', 'dm_key')).toBe("md5(concat_ws('|', 'chat-dm', dm_key))::uuid");
  });

  test('tables sync parents first', () => {
    expect(chatSync.TABLES).toEqual(['chat_conversations', 'chat_members', 'chat_messages', 'chat_tasks', 'chat_attachments', 'chat_receipts']);
  });
});

describe('chat sync cursor', () => {
  test('stays behind for the overlap window, then catches up', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const writes = [];
    const pool = {
      query: async (sql, params) => {
        if (/^SELECT value/.test(sql)) return { rows: [{ value: '5' }] };
        writes.push(params[1]);
        return { rows: [] };
      }
    };
    const cur = chatSync.__test.makeCursor(pool, 'push:chat_messages');
    expect(await cur.since()).toBe('5');
    await cur.advance('9');
    expect(await cur.since()).toBe('5'); // a late commit below 9 is still re-read
    expect(cur.latest()).toBe('9');
    jest.setSystemTime(1_000_000 + 10_001);
    expect(await cur.since()).toBe('9');
    expect(writes).toEqual(['9']); // persisted once, after the overlap
    jest.useRealTimers();
  });
});
