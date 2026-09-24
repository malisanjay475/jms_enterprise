'use strict';

const fs = require('fs');
const path = require('path');
const { ensureUniqueIndex, parseColumns } = require('../src/db/indexUtils');

describe('ensureUniqueIndex', () => {
  function fakeQuery(existing) {
    const calls = [];
    const query = jest.fn(async (text, params) => {
      calls.push({ text: String(text), params });
      if (String(text).includes('FROM pg_index')) return existing ? [{ '?column?': 1 }] : [];
      return [];
    });
    return { query, calls };
  }

  it('does not create a twin when an equivalent unique index exists', async () => {
    const { query, calls } = fakeQuery(true);
    const created = await ensureUniqueIndex(query, { table: 'dpr_hourly', columns: 'sync_id', name: 'idx_dpr_hourly_sync_id' });
    expect(created).toBe(false);
    expect(calls.some((c) => c.text.startsWith('CREATE'))).toBe(false);
    expect(calls[0].params).toEqual(['dpr_hourly', ['sync_id']]);
  });

  it('creates the named index when none exists', async () => {
    const { query, calls } = fakeQuery(false);
    const created = await ensureUniqueIndex(query, { table: 'std_actual', columns: 'plan_id, shift, dpr_date, machine', name: 'uq_sync_conflict_std_actual' });
    expect(created).toBe(true);
    expect(calls[0].params[1]).toEqual(['plan_id', 'shift', 'dpr_date', 'machine']); // order preserved
    expect(calls[1].text).toBe('CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_conflict_std_actual ON std_actual (plan_id, shift, dpr_date, machine)');
  });

  it('accepts pg results ({ rows }) as well as row arrays', async () => {
    const query = jest.fn(async (text) => (String(text).includes('FROM pg_index') ? { rows: [{ x: 1 }] } : { rows: [] }));
    expect(await ensureUniqueIndex(query, { table: 't', columns: 'a', name: 'n' })).toBe(false);
  });

  it('expression columns cannot be compared, so it just creates (IF NOT EXISTS)', async () => {
    expect(parseColumns('order_no, COALESCE(factory_id, 0)')).toBeNull();
    const { query, calls } = fakeQuery(true);
    await ensureUniqueIndex(query, { table: 'orders', columns: 'order_no, COALESCE(factory_id, 0)', name: 'x' });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('CREATE UNIQUE INDEX IF NOT EXISTS x ON orders');
  });
});

describe('migration 013 (drop duplicate indexes)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '013_drop_duplicate_indexes.sql'), 'utf8');
  const pairs = [...sql.matchAll(/\('([a-z0-9_]+)', '([a-z0-9_]+)', '([a-z0-9_]+)'\)/g)].map((m) => ({ table: m[1], drop: m[2], keep: m[3] }));

  it('lists 93 pairs, never drops a name it keeps elsewhere, never drops twice', () => {
    expect(pairs).toHaveLength(93);
    const drops = new Set(pairs.map((p) => p.drop));
    expect(drops.size).toBe(pairs.length);
    for (const p of pairs) {
      expect(p.drop).not.toBe(p.keep);
      expect(drops.has(p.keep)).toBe(false);
    }
  });

  it('checks every safety condition before dropping', () => {
    for (const guard of [
      "RETURN 'skip: keep index missing'",
      "RETURN 'skip: different tables'",
      "RETURN 'skip: keep index invalid'",
      "RETURN 'skip: definitions differ'",
      "RETURN 'skip: would lose uniqueness'",
      "RETURN 'skip: backs a constraint'"
    ]) expect(sql).toContain(guard);
    expect(sql).toContain("EXECUTE format('DROP INDEX %I', p_drop)");
    expect(sql).toContain('r.keep_name, false)'); // the real migration is not a dry run
  });

  it('no code re-creates an index the migration drops (except via ensureUniqueIndex)', () => {
    const roots = ['src', 'services', 'routes', 'migrations'].map((d) => path.join(__dirname, '..', d));
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|sql)$/.test(e.name) && !p.endsWith('013_drop_duplicate_indexes.sql')) files.push(p); } };
    roots.filter(fs.existsSync).forEach(walk);
    const literal = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON/gi;
    const created = new Set();
    for (const f of files) {
      if (f.includes(`${path.sep}migrations${path.sep}`)) continue; // applied once, never re-run
      for (const m of fs.readFileSync(f, 'utf8').matchAll(literal)) created.add(m[1].toLowerCase());
    }
    const recreated = pairs.filter((p) => created.has(p.drop)).map((p) => p.drop);
    expect(recreated).toEqual([]);
  });
});
