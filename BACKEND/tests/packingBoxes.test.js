'use strict';

const boxes = require('../src/modules/packing/registerPackingBoxRoutes');

/*
 * In-memory stand-in for the few queries the box logic runs, so the box / carton
 * maths can be tested without a database. Real SQL is checked on a test server.
 */
function memoryDb({ pcsPerBox = 32, boxesPerCarton = 4, packed = 0 } = {}) {
  const rows = [];
  const plan = { id: 7, sync_id: null, table_id: 'Assembly Station B1', item_name: 'Super Bucket', client_name: 'Reliance Retail', job_card_no: 'JC/1', scanned_qty: packed };
  let nextId = 1;
  const live = (r) => !r.voided_at;
  const query = async (sql, p = []) => {
    if (/to_regclass\('public\.or_jr_report'\)/.test(sql)) return { rows: [{ t: 'or_jr_report' }] };
    if (/FROM or_jr_report/.test(sql)) return { rows: pcsPerBox ? [{ item_code: '0012', pcs_per_box: pcsPerBox, boxes_per_carton: boxesPerCarton }] : [] };
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/SELECT COALESCE\(scanned_qty/.test(sql)) return { rows: [{ q: plan.scanned_qty }] };
    if (/AS all_rows/.test(sql)) {
      const mine = rows.filter(r => r.plan_id === p[0]);
      const bx = mine.filter(r => r.kind === 'BOX' && live(r));
      return { rows: [{
        boxed: mine.filter(r => ['BOX', 'OPENING'].includes(r.kind) && live(r)).reduce((t, r) => t + r.qty, 0),
        all_rows: mine.length,
        boxes: bx.length,
        cartons: mine.filter(r => r.kind === 'CARTON' && live(r)).length,
        loose_boxes: bx.filter(r => !r.carton_code).length,
        max_box: Math.max(0, ...mine.filter(r => r.kind === 'BOX').map(r => r.seq_no)),
        max_carton: Math.max(0, ...mine.filter(r => r.kind === 'CARTON').map(r => r.seq_no))
      }] };
    }
    if (/INSERT INTO packing_boxes/.test(sql) && /'OPENING'/.test(sql)) {
      rows.push({ id: nextId++, kind: 'OPENING', code: p[1], seq_no: 0, qty: p[2], plan_id: p[3] });
      return { rows: [] };
    }
    if (/INSERT INTO packing_boxes/.test(sql)) {
      const r = { id: nextId++, factory_id: p[0], kind: p[1], code: p[2], seq_no: p[3], qty: p[4], box_count: p[5], is_part: p[6], plan_id: p[7], carton_code: null };
      rows.push(r);
      return { rows: [r] };
    }
    if (/SELECT id, code, qty FROM packing_boxes/.test(sql)) {
      return { rows: rows.filter(r => r.plan_id === p[0] && r.kind === 'BOX' && live(r) && !r.carton_code).sort((a, b) => a.seq_no - b.seq_no) };
    }
    if (/UPDATE packing_boxes SET carton_code/.test(sql)) {
      rows.filter(r => p[1].includes(r.id)).forEach(r => { r.carton_code = p[0]; });
      return { rows: [] };
    }
    throw new Error('unexpected SQL: ' + sql.slice(0, 80));
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  /* one good scan */
  const scan = async () => { plan.scanned_qty += 1; return boxes.afterGoodScan(pool, plan, plan.scanned_qty); };
  return { pool, plan, rows, scan };
}

describe('packing boxes - box and carton maths', () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env.SERVER_TYPE = 'LOCAL'; process.env.LOCAL_FACTORY_ID = '1'; });
  afterEach(() => { process.env = { ...OLD }; });

  test('the 32nd piece fills box 1, the 4th box closes carton 1', async () => {
    const m = memoryDb({ pcsPerBox: 32, boxesPerCarton: 4 });
    const made = [];
    for (let i = 0; i < 128; i++) made.push(...await m.scan());
    expect(made.map(b => b.code)).toEqual(['PK1-7-B001', 'PK1-7-B002', 'PK1-7-B003', 'PK1-7-B004', 'PK1-7-C001']);
    const carton = made[4];
    expect(carton).toMatchObject({ kind: 'CARTON', qty: 128, box_count: 4, is_part: false });
    expect(m.rows.filter(r => r.kind === 'BOX').every(r => r.carton_code === 'PK1-7-C001')).toBe(true);
  });

  test('no labels when the item has no pcs per box', async () => {
    const m = memoryDb({ pcsPerBox: 0 });
    for (let i = 0; i < 40; i++) expect(await m.scan()).toEqual([]);
    expect(m.rows).toHaveLength(0);
  });

  test('a job already packed before labels began gets an opening balance, not back-dated labels', async () => {
    const m = memoryDb({ pcsPerBox: 32, boxesPerCarton: 4, packed: 5000 });
    const made = await m.scan();
    expect(made).toEqual([]);
    expect(m.rows).toEqual([expect.objectContaining({ kind: 'OPENING', qty: 5000, code: 'PK1-7-OPEN' })]);
    const later = [];
    for (let i = 0; i < 32; i++) later.push(...await m.scan());
    expect(later.map(b => b.code)).toEqual(['PK1-7-B001']);
  });

  test('closing the job makes a part box and a part carton', async () => {
    const m = memoryDb({ pcsPerBox: 32, boxesPerCarton: 4 });
    for (let i = 0; i < 70; i++) await m.scan();
    const made = await boxes.closeOpenBoxes(m.pool, m.plan, 'tester');
    expect(made.map(b => [b.code, b.qty, b.is_part])).toEqual([['PK1-7-B003', 6, true], ['PK1-7-C001', 70, true]]);
    expect(await boxes.closeOpenBoxes(m.pool, m.plan, 'tester')).toEqual([]);
  });

  test('a box code says factory, job and number; MAIN uses M', () => {
    expect(boxes.codeFor(2, 318, 'BOX', 66)).toBe('PK2-318-B066');
    expect(boxes.codeFor(null, 9, 'CARTON', 3)).toBe('PKM-9-C003');
  });
});
