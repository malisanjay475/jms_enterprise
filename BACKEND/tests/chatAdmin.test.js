'use strict';

const { __test: t, DEFAULT_RETENTION_DAYS } = require('../src/modules/chat/chatAdmin');

describe('chat console filters', () => {
  test('only well-formed values are kept', () => {
    const f = t.parseFilters({
      user: ' bob ', factory: '2', from: '2026-10-01', to: 'yesterday', conversation: 'not-a-uuid', q: 'm-12'
    });
    expect(f).toMatchObject({ user: 'bob', factory: 2, from: '2026-10-01', to: null, conversation: '', text: 'm-12' });
    expect(t.parseFilters({ factory: 'main' }).factory).toBe('main');
    expect(t.parseFilters({ factory: "1; DROP TABLE x" }).factory).toBeNull();
  });

  test('every value goes in as a parameter, never into the SQL', () => {
    const params = [];
    const where = t.messageWhere(t.parseFilters({ user: "o'brien", factory: '3', from: '2026-01-01', to: '2026-01-31', q: '50%_' }), params);
    expect(where).not.toMatch(/o'brien|50%/);
    expect(params).toEqual(["o'brien", 3, '2026-01-01', '2026-01-31', '%50\\%\\_%']);
    expect(where).toMatch(/Asia\/Kolkata/);
  });

  test('main site means messages written on MAIN (no factory id)', () => {
    const params = [];
    expect(t.messageWhere(t.parseFilters({ factory: 'main' }), params)).toMatch(/x\.factory_id IS NULL/);
    expect(params).toEqual([]);
  });
});

describe('chat export cells', () => {
  test('CSV cells are quoted and formulas become text', () => {
    expect(t.csvCell('plain')).toBe('"plain"');
    expect(t.csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(t.csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(t.csvCell('+91 98765')).toBe(`"'+91 98765"`);
    expect(t.csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(t.csvCell(null)).toBe('""');
  });

  test('deleted and purged messages are marked, never shown', () => {
    expect(t.bodyText({ body: 'x', purged_at: new Date() })).toBe('[removed after the retention period]');
    expect(t.bodyText({ body: 'x', deleted_at: new Date() })).toBe('[deleted by sender]');
    expect(t.bodyText({ body: 'hello' })).toBe('hello');
  });
});

test('retention defaults to 2 years', () => {
  expect(DEFAULT_RETENTION_DAYS).toBe(730);
});
