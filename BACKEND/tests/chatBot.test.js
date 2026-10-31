'use strict';

const chatBot = require('../src/modules/chat/chatBot');

describe('JMS Bot shift (IST)', () => {
  test('day 08-20, night 20-08 belongs to the date it started', () => {
    expect(chatBot.currentShift(new Date('2026-10-24T10:00:00Z'))).toEqual({ date: '2026-10-24', shift: 'Day' });   // 10:00 IST-shifted input
    expect(chatBot.currentShift(new Date('2026-10-24T21:00:00Z'))).toEqual({ date: '2026-10-24', shift: 'Night' });
    expect(chatBot.currentShift(new Date('2026-10-25T03:00:00Z'))).toEqual({ date: '2026-10-24', shift: 'Night' });
  });
});

describe('JMS Bot commands', () => {
  const pool = { query: jest.fn(async () => ({ rows: [] })) };

  test('/help lists the commands', async () => {
    expect(await chatBot.runCommand(pool, '/help', 'ravi')).toBe(chatBot.HELP);
  });

  test('unknown command answers with help; plain text is not a command', async () => {
    expect(await chatBot.runCommand(pool, '/foo', 'ravi')).toContain('Unknown command /foo');
    expect(await chatBot.runCommand(pool, 'hello', 'ravi')).toBeNull();
  });

  test('missing argument explains the usage', async () => {
    expect(await chatBot.runCommand(pool, '/dpr', 'ravi')).toContain('Usage: /dpr');
    expect(await chatBot.runCommand(pool, '/order', 'ravi')).toContain('Usage: /order');
  });

  test('/dpr with no rows says so', async () => {
    expect(await chatBot.runCommand(pool, '/dpr M-07', 'ravi')).toContain('No DPR entries today');
  });
});
