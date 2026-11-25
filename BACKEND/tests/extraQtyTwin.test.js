const syncService = require('../services/sync.service');

const { adoptExtraQtyTwinAllowedAt, setRuntimeForTests } = syncService.__test;

const ROW = { plan_id: 'PLN-1', colour: 'Red', allowed_by: 'ppc', allowed_at: '2026-11-25T08:37:58.250Z', extra_qty: 500 };

async function run(found, row = ROW) {
  const calls = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return { rows: String(sql).includes('AS exact') ? found : [], rowCount: 0 };
    })
  };
  const done = await adoptExtraQtyTwinAllowedAt(client, row);
  return { done, update: calls.find((c) => c.sql.startsWith('UPDATE')), calls };
}

beforeEach(() => setRuntimeForTests({ pool: { query: jest.fn() } }));

describe('adoptExtraQtyTwinAllowedAt', () => {
  it('gives the own microsecond row the incoming allowed_at', async () => {
    const r = await run([{ id: 7, exact: false }]);
    expect(r.done).toBe(true);
    expect(r.update.params).toEqual([ROW.allowed_at, 7]);
  });

  it.each([
    ['no row matches', []],
    ['the exact key exists', [{ id: 7, exact: true }]],
    ['an old doubled pair exists', [{ id: 7, exact: false }, { id: 8, exact: true }]]
  ])('changes nothing when %s', async (_n, found) => {
    const r = await run(found);
    expect(r.done).toBe(false);
    expect(r.update).toBeUndefined();
  });

  it('ignores a row without its key', async () => {
    const r = await run([], { ...ROW, allowed_at: null });
    expect(r.done).toBe(false);
    expect(r.calls).toHaveLength(0);
  });
});
