'use strict';

jest.mock('../src/modules/hrPerformance/registerHrPerformanceRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

jest.mock('../src/modules/interviewPanel/registerInterviewPanelRoutes', () =>
  jest.fn(() => ({ ensureTables: jest.fn().mockResolvedValue(undefined) }))
);

const express = require('express');
const request = require('supertest');
const ExcelJS = require('exceljs');
const registerLegacyRoutes = require('../src/legacy/registerLegacyRoutes');

const rec = (over) => ({
  quantity: 100, weight_kg: null, to_location: 'Packing', shifted_by: 'shifta', scan_mode: 'LABEL_QR',
  label_no: 1, total_labels: 4, status: null, colour: 'Grey', machine: 'B -L1-HYD-350-2',
  item_name: 'Bucket 20L', mould_name: 'BUCKET 20L', order_no: 'JR/1', jc_no: 'JC/1', plan_code: 'PLN-1',
  report_date: '2026-10-04', shift: 'Day', created_at: new Date('2026-10-04T09:15:00'), ...over
});

const RECORDS = [
  rec({ id: 1, quantity: 100, weight_kg: 1.2345 }),
  rec({ id: 2, quantity: 50, weight_kg: 0.5, machine: 'B -L1-HYD-350-10', shifted_by: 'shiftb', created_at: new Date('2026-10-04T10:00:00') }),
  rec({ id: 3, quantity: 30, to_location: 'Printing', scan_mode: 'MANUAL', label_no: null, created_at: new Date('2026-10-04T11:00:00') }),
  rec({ id: 4, quantity: 70, shift: 'Night', created_at: new Date('2026-10-04T22:00:00') })
];

function createApp(records = RECORDS) {
  const calls = [];
  const handle = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes('FROM shifting_records sr') && text.includes('AS report_date')) return { rows: records };
    if (/FROM machines WHERE COALESCE\(is_active, true\)/.test(text)) {
      return { rows: [{ machine: 'B -L1-HYD-350-2', line: 'B -L1' }, { machine: 'B -L1-HYD-350-10', line: 'B -L1' }] };
    }
    if (/SELECT name FROM factories/.test(text)) return { rows: [{ name: 'Factory One' }] };
    return { rows: [] };
  };
  const pool = { query: jest.fn(handle), connect: jest.fn().mockResolvedValue({ query: jest.fn(handle), release: jest.fn() }) };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { username: 'admin1', role: 'admin', permissions: {} }; next(); });
  registerLegacyRoutes({
    app, pool, config: { geminiApiKey: '' },
    services: { aiService: { init: jest.fn() }, syncService: { triggerSync: jest.fn() }, updaterService: {} }
  });
  return { app, calls };
}

describe('Shifting shift-wise report', () => {
  const originalType = process.env.SERVER_TYPE;
  beforeAll(() => { process.env.SERVER_TYPE = 'LOCAL'; }); // locations: built-in list, no seeding
  afterAll(() => {
    if (originalType === undefined) delete process.env.SERVER_TYPE;
    else process.env.SERVER_TYPE = originalType;
  });

  it('rejects ranges longer than 62 days and To before From', async () => {
    const { app } = createApp();
    const long = await request(app).get('/api/shifting/shift-report?from=2026-01-01&to=2026-06-30').set('x-factory-id', '1');
    expect(long.status).toBe(400);
    expect(long.body.error).toMatch(/62 days/);
    const backwards = await request(app).get('/api/shifting/shift-report?from=2026-10-05&to=2026-10-01').set('x-factory-id', '1');
    expect(backwards.status).toBe(400);
  });

  it('passes the date range, factory and shift to the query', async () => {
    const { app, calls } = createApp();
    await request(app).get('/api/shifting/shift-report?from=2026-10-01&to=2026-10-04&shift=night').set('x-factory-id', '1');
    const call = calls.find(c => c.text.includes('AS report_date'));
    expect(call.params).toEqual(['2026-10-01', '2026-10-04', 1, 'Night']);
  });

  it('totals and groups by shift, machine (standard order) and supervisor', async () => {
    const { app } = createApp();
    const res = await request(app).get('/api/shifting/shift-report?from=2026-10-04&to=2026-10-04').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totals).toEqual({ entries: 4, labels: 3, manual: 1, qty: 250, kg: 1.735 });
    expect(d.entry_count).toBe(4);
    expect(d.locations).toEqual(['Printing', 'Packing']); // master order: Printing before Packing

    expect(d.summary.map(s => [s.shift, s.entries, s.qty])).toEqual([['Day', 3, 180], ['Night', 1, 70]]);
    expect(d.summary[0].by_location).toEqual({ Packing: 150, Printing: 30 });
    expect(d.summary[0].supervisors).toBe('shifta, shiftb');

    // Machine -2 before -10 (Line, then machine number), not text order.
    const dayMachines = d.by_machine.filter(m => m.shift === 'Day').map(m => `${m.machine}|${m.location}`);
    expect(dayMachines).toEqual(['B -L1-HYD-350-2|Packing', 'B -L1-HYD-350-2|Printing', 'B -L1-HYD-350-10|Packing']);
    expect(d.by_machine[0].line).toBe('B -L1');

    const daySup = d.by_supervisor.filter(u => u.shift === 'Day').map(u => [u.supervisor, u.qty]);
    expect(daySup).toEqual([['shifta', 130], ['shiftb', 50]]);
  });

  it('downloads a 4-sheet workbook with totals', async () => {
    const { app } = createApp();
    const res = await request(app)
      .get('/api/shifting/shift-report.xlsx?from=2026-10-04&to=2026-10-04&shift=')
      .set('x-factory-id', '1')
      .buffer(true)
      .parse((r, cb) => { const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toContain('Shifting_Shift_Report_2026-10-04.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map(ws => ws.name)).toEqual(['Shift Summary', 'Machine-Item', 'Supervisor', 'All Entries']);
    const summary = wb.getWorksheet('Shift Summary');
    expect(summary.getCell(2, 1).value).toContain('Factory One');
    const header = summary.getRow(5).values.slice(1);
    expect(header).toEqual(['Date', 'Shift', 'Entries', 'Label Scans', 'Manual', 'Qty Shifted', 'Weight (kg)', 'Printing (Qty)', 'Packing (Qty)', 'Shifted By']);
    const totalRow = summary.getRow(8).values.slice(1);
    expect(totalRow[0]).toBe('TOTAL');
    expect(totalRow[5]).toBe(250);
    expect(wb.getWorksheet('All Entries').getRow(10).values[1]).toBe('TOTAL'); // 4 entries + header at row 5
  });

  it('writes a friendly row when nothing was shifted', async () => {
    const { app } = createApp([]);
    const res = await request(app).get('/api/shifting/shift-report?from=2026-10-04&to=2026-10-04').set('x-factory-id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.totals.entries).toBe(0);
    expect(res.body.data.summary).toEqual([]);
  });
});
