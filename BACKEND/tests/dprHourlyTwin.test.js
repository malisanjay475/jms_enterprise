const syncService = require('../services/sync.service');

const { adoptDprHourlyTwinGlobalId, setRuntimeForTests } = syncService.__test;

const COLS = new Set(['id', 'global_id', 'machine', 'dpr_date', 'shift', 'hour_slot', 'plan_id', 'colour',
  'entry_type', 'factory_id', 'created_at', 'good_qty']);

const ROW = {
  global_id: 'main-uuid',
  created_at: '2026-09-09T11:19:22.176Z',
  machine: 'JSL-1-EXCEL-150-4', dpr_date: '2026-09-08', shift: 'Night', hour_slot: '07-08',
  plan_id: 'PLN-2627-3881', colour: 'RED', entry_type: 'HOURLY', factory_id: 2, good_qty: 120
};

function makeClient({ exists = 0, twins = [] } = {}) {
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes('information_schema.columns')) return { rows: [{ data_type: 'timestamp without time zone' }], rowCount: 1 };
    if (text.startsWith('SELECT 1 FROM dpr_hourly')) return { rows: [], rowCount: exists };
    if (text.includes('SELECT id, global_id FROM dpr_hourly')) return { rows: twins, rowCount: twins.length };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query }, calls };
}

beforeEach(() => {
  const poolQuery = jest.fn(async () => ({ rows: [{ column_name: 'dpr_global_id' }], rowCount: 1 }));
  setRuntimeForTests({ pool: { query: poolQuery } });
});

describe('adoptDprHourlyTwinGlobalId', () => {
  it('re-keys the single local twin to the incoming global_id (and its QC links)', async () => {
    const { client, calls } = makeClient({ twins: [{ id: 42927, global_id: 'local-uuid' }] });
    const done = await adoptDprHourlyTwinGlobalId(client, { ...ROW }, COLS, new Set(['main-uuid']));
    expect(done).toBe(true);
    const update = calls.find((c) => c.text.startsWith('UPDATE dpr_hourly SET global_id'));
    expect(update.params).toEqual(['main-uuid', 42927]);
    const qc = calls.filter((c) => c.text.includes('SET dpr_global_id'));
    expect(qc).toHaveLength(2);
    expect(qc[0].params).toEqual(['main-uuid', 'local-uuid']);
  });

  it('does nothing when the incoming global_id already exists', async () => {
    const { client, calls } = makeClient({ exists: 1, twins: [{ id: 1, global_id: 'x' }] });
    expect(await adoptDprHourlyTwinGlobalId(client, { ...ROW }, COLS, new Set())).toBe(false);
    expect(calls.some((c) => c.text.startsWith('UPDATE'))).toBe(false);
  });

  it('does nothing when the twin is ambiguous', async () => {
    const { client, calls } = makeClient({ twins: [{ id: 1, global_id: 'a' }, { id: 2, global_id: 'b' }] });
    expect(await adoptDprHourlyTwinGlobalId(client, { ...ROW }, COLS, new Set())).toBe(false);
    expect(calls.some((c) => c.text.startsWith('UPDATE'))).toBe(false);
  });

  it('does not steal a twin whose own global_id arrives in the same batch', async () => {
    const { client, calls } = makeClient({ twins: [{ id: 1, global_id: 'other-main-uuid' }] });
    expect(await adoptDprHourlyTwinGlobalId(client, { ...ROW }, COLS, new Set(['other-main-uuid']))).toBe(false);
    expect(calls.some((c) => c.text.startsWith('UPDATE'))).toBe(false);
  });

  it('matches the twin on the natural key and the millisecond created_at', async () => {
    const { client, calls } = makeClient({ twins: [] });
    await adoptDprHourlyTwinGlobalId(client, { ...ROW }, COLS, new Set());
    const select = calls.find((c) => c.text.includes('SELECT id, global_id FROM dpr_hourly'));
    expect(select.text).toContain("date_trunc('milliseconds', $2::timestamp)");
    for (const col of ['machine', 'dpr_date', 'shift', 'hour_slot', 'plan_id', 'colour', 'entry_type', 'factory_id']) {
      expect(select.text).toContain(`${col} IS NOT DISTINCT FROM`);
    }
  });
});
