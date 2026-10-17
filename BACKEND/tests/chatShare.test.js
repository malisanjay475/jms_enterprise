'use strict';

const { __test: t, oneLine } = require('../src/modules/chat/chatShare');

describe('shared links stay inside this JMS site', () => {
  test.each([
    ['/machines.html?line=2#top', '/machines.html?line=2#top'],
    ['/dpr.html?view=summary', '/dpr.html?view=summary'],
    ['/a/../planning.html', '/planning.html']
  ])('%s is allowed', (raw, out) => {
    expect(t.safeRelativeUrl(raw)).toBe(out);
  });

  test.each([
    'https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 'data:text/html,x',
    '/api/chat/me', '/API/admin/backup', 'machines.html', '/x\\y', '/a b', '', null
  ])('%s is refused', (raw) => {
    expect(t.safeRelativeUrl(raw)).toBeNull();
  });

  test('link meta is cleaned and capped', () => {
    const { meta } = t.cleanLinkMeta({
      url: '/machines.html', title: 'x'.repeat(500), factory_id: '2', excerpt: 'ok\u0000\nline',
      locator: { id: 'row7', data: { 'data-machine': 'M-07', onclick: 'evil()', 'data-x y': 'bad' }, codes: ['M-07', 'J/12'], extra: 'dropped' }
    }, 'urgent');
    expect(meta.title).toHaveLength(120);
    expect(meta.factory_id).toBe(2);
    expect(meta.priority).toBe('urgent');
    expect(meta.excerpt).toBe('ok line');
    expect(meta.locator).toEqual({ id: 'row7', data: { 'data-machine': 'M-07' }, codes: ['M-07', 'J/12'] });
    expect(t.cleanLinkMeta({ url: '/x.html' }, 'whatever').meta.priority).toBe('normal');
    expect(t.cleanLinkMeta({ url: 'https://x' }).error).toMatch(/Only links/);
  });
});

describe('reply quotes', () => {
  test('one line per kind', () => {
    expect(oneLine({ kind: 'text', body: 'a\n b' })).toBe('a b');
    expect(oneLine({ kind: 'image', body: '' })).toBe('📷 Photo');
    expect(oneLine({ kind: 'link', body: 'fix', meta: { title: 'Machines' } })).toBe('🔗 Machines: fix');
    expect(oneLine({ kind: 'text', body: 'gone', deleted_at: new Date() })).toBe('');
  });
});
