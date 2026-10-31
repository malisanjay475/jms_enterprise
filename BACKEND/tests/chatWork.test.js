'use strict';

const chatWork = require('../src/modules/chat/chatWork');

describe('chat polls', () => {
  test('needs a question and 2+ distinct options; at most 10', () => {
    expect(chatWork.cleanPoll({ question: 'Overtime Sunday?', options: ['Yes', 'No', 'Yes', ''] }))
      .toEqual({ question: 'Overtime Sunday?', options: ['Yes', 'No'], multi: false });
    expect(chatWork.cleanPoll({ question: 'x', options: ['only one'] })).toBeNull();
    expect(chatWork.cleanPoll({ options: ['a', 'b'] })).toBeNull();
    expect(chatWork.cleanPoll(null)).toBeNull();
    const many = Array.from({ length: 15 }, (_, i) => `o${i}`);
    expect(chatWork.cleanPoll({ question: 'q', options: many, multi: 1 }).options).toHaveLength(10);
  });

  test('tallies votes per option and marks mine', async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        if (/FROM chat_poll_votes/.test(sql)) {
          return { rows: [
            { message_sync_id: 'm1', username: 'Ravi', options: [0] },
            { message_sync_id: 'm1', username: 'me', options: [1] },
            { message_sync_id: 'm1', username: 'Sita', options: [0] }
          ] };
        }
        return { rows: [] };
      })
    };
    const rows = [{ sync_id: 'm1', meta: { poll: { question: 'q', options: ['Yes', 'No'] } } }, { sync_id: 'm2', meta: null }];
    const p = (await chatWork.pollsFor(pool, rows, 'Me')).get('m1');
    expect(p.total).toBe(3);
    expect(p.options.map((o) => o.votes)).toEqual([2, 1]);
    expect(p.mine).toEqual([1]);
  });
});

describe('quiet hours (IST)', () => {
  // 22:00-07:00 IST = 16:30-01:30 UTC
  const s = { quiet_from: '22:00', quiet_to: '07:00' };
  test('overnight window', () => {
    expect(chatWork.inQuiet(s, new Date('2026-10-24T17:00:00Z'))).toBe(true);  // 22:30 IST
    expect(chatWork.inQuiet(s, new Date('2026-10-24T01:00:00Z'))).toBe(true);  // 06:30 IST
    expect(chatWork.inQuiet(s, new Date('2026-10-24T06:00:00Z'))).toBe(false); // 11:30 IST
  });
  test('off when not set', () => {
    expect(chatWork.inQuiet({}, new Date())).toBe(false);
    expect(chatWork.inQuiet(null, new Date())).toBe(false);
  });
});
