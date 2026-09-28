'use strict';

const { createChangeAwareCache } = require('../src/app/changeAwareCache');

describe('changeAwareCache', () => {
  it('builds one signature query covering every table', async () => {
    const query = jest.fn(async () => [{ sig: '10:55/20:99' }]);
    const cache = createChangeAwareCache(query);

    const sig = await cache.signature(['orders', 'or_jr_report']);

    expect(sig).toBe('10:55/20:99');
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('FROM orders');
    expect(sql).toContain('FROM or_jr_report');
    expect(sql).toContain('SUM(xmin::text::bigint)');
    expect(sql).toContain('count(*)');
  });

  it('reuses the answer only while the signature is unchanged', () => {
    const cache = createChangeAwareCache(jest.fn());
    cache.set('ordersPending:1', 'sig-A', '{"ok":true,"data":[1]}');

    expect(cache.get('ordersPending:1', 'sig-A')).toBe('{"ok":true,"data":[1]}');
    // Any write to a source table changes the signature -> rebuild.
    expect(cache.get('ordersPending:1', 'sig-B')).toBeUndefined();
    // Keys are separate (e.g. per factory).
    expect(cache.get('ordersPending:2', 'sig-A')).toBeUndefined();
  });

  it('never caches or matches an empty signature', () => {
    const cache = createChangeAwareCache(jest.fn());
    cache.set('k', '', 'text');
    expect(cache.get('k', '')).toBeUndefined();
  });

  it('rejects table names that are not plain identifiers', async () => {
    const query = jest.fn();
    const cache = createChangeAwareCache(query);
    await expect(cache.signature(['orders; DROP TABLE orders'])).rejects.toThrow(/bad table name/);
    expect(query).not.toHaveBeenCalled();
  });

  it('stays bounded', () => {
    const cache = createChangeAwareCache(jest.fn(), { maxEntries: 2 });
    cache.set('a', 's', '1');
    cache.set('b', 's', '2');
    cache.set('c', 's', '3');
    expect(cache.get('c', 's')).toBe('3');
    expect(cache.get('a', 's')).toBeUndefined();
  });
});
