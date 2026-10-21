'use strict';

const chatAuto = require('../src/modules/chat/chatAuto');

describe('chat alerts text', () => {
  test('QC hold lists machine, JC, qty, reason and who', () => {
    const t = chatAuto.holdText({
      machine: 'M-07', job_card_no: 'JC-1234', qty_on_hold: 500, dpr_date: '2026-10-21T00:00:00Z',
      shift: 'Day', slot: '10-11', reason: 'Flash', remarks: 'Check mould', hold_by: 'qc1'
    });
    expect(t).toContain('QC HOLD · Machine M-07');
    expect(t).toContain('JC JC-1234');
    expect(t).toContain('Qty 500');
    expect(t).toContain('2026-10-21 Day 10-11');
    expect(t).toContain('Reason: Flash');
    expect(t).toContain('By qc1');
  });

  test('release skips empty parts', () => {
    expect(chatAuto.releaseText({ machine: 'M-07', released_by: 'mm1' })).toBe('✅ QC hold released · Machine M-07\nBy mm1');
  });
});

describe('chat auto groups switch', () => {
  const saved = process.env.CHAT_AUTO_GROUPS;
  afterEach(() => { if (saved === undefined) delete process.env.CHAT_AUTO_GROUPS; else process.env.CHAT_AUTO_GROUPS = saved; });

  test('CHAT_AUTO_GROUPS=0 turns it off; default on', async () => {
    const pool = { query: jest.fn(async () => ({ rows: [] })) };
    process.env.CHAT_AUTO_GROUPS = '0';
    expect(await chatAuto.enabled(pool)).toBe(false);
    delete process.env.CHAT_AUTO_GROUPS;
    expect(await chatAuto.enabled(pool)).toBe(true);
  });
});
