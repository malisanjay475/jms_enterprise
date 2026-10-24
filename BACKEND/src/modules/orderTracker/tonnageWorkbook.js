'use strict';

/**
 * Excel for the Order Tracker "Tonnage load" view, laid out like the factory's
 * monthly "Machine planning summary" sheet: title band, the period / efficiency
 * inputs in yellow, one row per machine tonnage, shortage cells red, excess
 * cells green and a navy total row. Further sheets: every order line behind
 * the load (job card, plan, colour, status - complete ones too, marked not
 * counted), each machine of each tonnage, moulds that cannot finish by the date
 * on their own, and open orders with no mould found.
 */

const ExcelJS = require('exceljs');

const NAVY = 'FF1F2D5C', TITLE = 'FFBDD7EE', YELLOW = 'FFFFFF00', RED = 'FFFF0000', GREEN = 'FF00B050', HEAD = 'FFDDEBF7';
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = iso => { const d = new Date(iso); return `${d.getUTCDate()}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`; };

async function buildTonnageWorkbook(T, { until, basis, factoryName }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JMS Order Tracker';
  const ws = wb.addWorksheet('Machine planning summary', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
  ws.columns = [24, 17, 11, 12, 11, 15, 11, 12, 12, 16, 12, 12, 11, 11, 12].map(width => ({ width }));
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const monthName = new Date(until + 'T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

  /* row 1: title */
  ws.mergeCells('A1:L1');
  const t = ws.getCell('A1');
  t.value = `Machine planning summary for ${monthName}${factoryName ? ' (' + factoryName + ')' : ''}`;
  t.font = { bold: true, size: 14 }; t.alignment = { horizontal: 'center', vertical: 'middle' }; t.fill = fill(TITLE);
  ws.getRow(1).height = 24;

  /* row 2: inputs */
  const r2 = ws.getRow(2);
  r2.values = ['From', dmy(today + 'T00:00:00Z'), 'Until', dmy(until + 'T00:00:00Z'), 'Days', T.days, 'Efficiency', T.eff,
    'Load', basis === 'due' ? 'Orders due by date' : 'All open orders'];
  r2.getCell(6).numFmt = '0.00'; r2.getCell(8).numFmt = '0%';
  [2, 4, 6, 8].forEach(c => { r2.getCell(c).fill = fill(YELLOW); r2.getCell(c).font = { bold: true }; r2.getCell(c).alignment = { horizontal: 'center' }; });
  [1, 3, 5, 7, 9].forEach(c => { r2.getCell(c).font = { bold: true, color: { argb: 'FF595959' } }; });

  /* row 4: headers - the columns of the screen, then the load split the screen shows as a bar */
  const heads = ['M/C TONNAGE', 'HRS REQUIRED\nopen load', 'DAYS REQUIRED\nhrs ÷ 24', `AVAILABLE HRS\nuntil ${dmy(until + 'T00:00:00Z')}`, 'AVAILABLE DAYS',
    'MACHINES WITH US', 'MACHINES NEEDED', 'MACHINE SHORTAGE\nnumbers', 'MACHINE SHORTAGE\ndays', 'CAPACITY BOOKED',
    'MACHINE EXCESS\nnumbers', 'MACHINE EXCESS\ndays', 'RUNNING HRS', 'QUEUED HRS', 'NOT PLANNED HRS'];
  const hr = ws.getRow(4);
  hr.values = heads; hr.height = 40;
  hr.eachCell((c, i) => {
    c.font = { bold: true, size: 9, color: { argb: 'FF1E293B' } }; c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle', wrapText: true };
    c.fill = fill(i > 12 ? 'FFF1F5F9' : HEAD); c.border = box;
  });

  const MUTED = 'FF64748B', DRED = 'FFDC2626', DGREEN = 'FF059669', AMBER = 'FFD97706', GREY = 'FF94A3B8', INK = 'FF0F172A';
  const tone = p => p == null ? GREY : p > 100 ? DRED : p >= 85 ? AMBER : DGREEN;
  const f2 = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const inactiveOf = r => { const g = T.master && r.tonnage != null && (T.master.by_tonnage || []).find(x => x.tonnage === r.tonnage); return g ? g.inactive : 0; };
  /* the coloured one-line answer the screen shows under the tonnage */
  const verdict = r => {
    if (r.tonnage == null) return ['? Add tonnage', GREY];
    if (r.shortage_machines > 0) return [`▲ Short ${f2(r.shortage_machines)} m/c`, DRED];
    if (r.mould_limited_hours > 0) { const n = (r.mould_limits || []).length; return [`! ${n} mould${n === 1 ? '' : 's'} late`, DRED]; }
    if (r.machine_count && r.machines_needed / r.machine_count >= 0.85) return ['! Almost full', AMBER];
    if (!r.load_hours) return ['– No load', GREY];
    return [`✓ ${f2(r.excess_machines)} m/c spare`, DGREEN];
  };
  const small = (text, argb, bold) => ({ text, font: { size: 8, bold: !!bold, color: { argb } } });

  const nums = ['#,##0.00', '#,##0.00', '#,##0', '#,##0.00', '0', '#,##0.00', '#,##0.00', '#,##0.00', '0%', '#,##0.00', '#,##0.00', '#,##0.0', '#,##0.0', '#,##0.0'];
  const put = (r, total) => {
    const short = r.shortage_machines > 0, spare = r.excess_machines > 0;
    const row = ws.addRow([null, r.load_hours, r.load_days, r.avail_hours, r.avail_days, r.machine_count, r.machines_needed,
      short ? r.shortage_machines : null, short ? r.shortage_days : null, r.booked_pct == null ? null : r.booked_pct / 100,
      spare ? r.excess_machines : null, spare ? r.excess_days : null, r.running_hours, r.queued_hours, r.unplanned_hours]);
    row.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = box; c.alignment = { horizontal: i === 1 ? 'left' : 'right', vertical: 'middle', wrapText: true };
      if (i > 1) { c.numFmt = nums[i - 2]; c.font = { size: 10, color: { argb: i > 12 ? MUTED : INK } }; }
      if (c.value == null && i > 1) { c.value = '-'; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.font = { color: { argb: GREY } }; }
    });
    if (total) return row;
    row.height = 46;
    const [vt, vc] = verdict(r);
    row.getCell(1).value = { richText: [{ text: r.tonnage == null ? 'Unknown' : `${r.tonnage} T`, font: { size: 10, bold: true, color: { argb: INK } } },
      small(`\n${r.orders || 0} orders · ${r.moulds || 0} moulds${r.done_moulds ? ` · ${r.done_moulds} done` : ''}`, MUTED, true), small(`\n${vt}`, vc, true)] };
    if (r.mould_limited_hours) {
      row.getCell(2).value = { richText: [{ text: f2(r.load_hours), font: { size: 10, color: { argb: INK } } }, small(`\n${f2(r.mould_limited_hours)} h mould limit`, DRED, true)] };
    }
    const ina = inactiveOf(r);
    row.getCell(6).value = { richText: [{ text: String(r.machine_count || 0), font: { size: 10, color: { argb: INK } } },
      small(`\n${r.running || 0} running · ${r.idle || 0} idle${ina ? ` · ${ina} inactive` : ''}`, MUTED)] };
    if (r.machines_needed == null) row.getCell(7).value = '—';
    if (short) [8, 9].forEach(i => { const c = row.getCell(i); c.fill = fill('FFEF4444'); c.font = { bold: true, italic: true, color: { argb: 'FFFFFFFF' } }; });
    if (spare) [11, 12].forEach(i => { const c = row.getCell(i); c.fill = fill('FF16A34A'); c.font = { bold: true, italic: true, color: { argb: 'FFFFFFFF' } }; });
    const bk = row.getCell(10);
    if (r.booked_pct == null) { bk.value = '—'; bk.alignment = { horizontal: 'center', vertical: 'middle' }; } else {
      bk.font = { bold: true, color: { argb: tone(r.booked_pct) } };
      /* the booked bar of the screen, in the cell's own colour, full at 100% */
      ws.addConditionalFormatting({ ref: bk.address, rules: [{ type: 'dataBar', gradient: false, color: { argb: tone(r.booked_pct) },
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }] }] });
    }
    return row;
  };
  const all = T.classes.concat(T.unknown.items.length ? [T.unknown] : []);
  all.forEach(r => put(r, false));
  const tot = put(T.total, true);
  tot.getCell(1).value = 'Total'; tot.height = 22;
  tot.eachCell({ includeEmpty: true }, c => { c.fill = fill(NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  if (T.unknown.items.length) {
    ws.addRow([]);
    ws.addRow([`${T.unknown.items.length} moulds have no tonnage in the mould master or ERP (row "Unknown"); they are not in the total.`]).getCell(1).font = { italic: true, color: { argb: 'FFC00000' } };
  }
  ws.addRow([]);
  [`Hrs Required = balance pieces of open orders ÷ pieces per hour (live DPR rate, else mould standard). Available Hrs = machines × 24 h × days × efficiency.`,
    'Capacity Booked = Hrs Required ÷ Available Hrs: red over 100%, amber 85-100%, green under 85%. Red shortage = more machines needed than we have; green excess = spare machines.',
    `Orders: ${T.total.all_orders || 0} open in the order master, ERP or plan board; ${T.total.closed_orders || 0} of them are complete or closed in the ERP: listed in Order detail, not counted.`,
    'Mould limit = hours of moulds that cannot finish by the date even on a machine of their own (one mould runs on one machine at a time). Machines needed and shortage leave these hours out, since more machines would not help. See the "Mould limits" sheet.']
    .forEach(x => { ws.addRow([x]).getCell(1).font = { italic: true, color: { argb: 'FF595959' } }; });

  const head = sh => sh.getRow(1).eachCell(c => { c.font = { bold: true }; c.fill = fill(HEAD); c.border = box; c.alignment = { vertical: 'middle', wrapText: true }; });
  const day = v => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '');
  const IST = v => (v ? new Date(new Date(v).getTime() + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ') : '');
  const STATUS = { COMPLETE: 'Complete', COMPLETED: 'Complete', ERP_CLOSED: 'Closed in ERP', RUNNING: 'Running', PLANNED: 'Planned', PAUSED: 'Paused', NOT_PLANNED: 'Not planned yet' };

  /* sheet 2: every order line behind the load, one row per plan and colour */
  const d = wb.addWorksheet('Order detail', { views: [{ state: 'frozen', ySplit: 1 }] });
  d.columns = [
    { header: 'M/c Tonnage', key: 'ton', width: 11 }, { header: 'Order No', key: 'order', width: 20 }, { header: 'Order Date', key: 'odate', width: 11 },
    { header: 'Client', key: 'client', width: 22 }, { header: 'Product', key: 'product', width: 28 },
    { header: 'JC No', key: 'jc', width: 18 }, { header: 'JC Date', key: 'jcdate', width: 11 },
    { header: 'Plan ID', key: 'plan', width: 16 }, { header: 'Plan Date', key: 'pdate', width: 11 }, { header: 'Machine', key: 'mc', width: 14 },
    { header: 'Mould No', key: 'mno', width: 16 }, { header: 'Mould Name', key: 'mould', width: 30 }, { header: 'Colour', key: 'colour', width: 16 },
    { header: 'Plan Qty', key: 'pqty', width: 10, style: { numFmt: '#,##0' } }, { header: 'Produce Qty', key: 'prod', width: 11, style: { numFmt: '#,##0' } },
    { header: 'Bal Qty', key: 'bal', width: 10, style: { numFmt: '#,##0' } },
    { header: 'Plan Start Date', key: 'ps', width: 16 }, { header: 'Plan End Date', key: 'pe', width: 16 }, { header: 'Plan Exp. Date', key: 'px', width: 16 },
    { header: 'Plan Status', key: 'lst', width: 12 }, { header: 'Mould Status', key: 'st', width: 15 }, { header: 'In Load', key: 'cnt', width: 8 },
    { header: 'Mould Bal Pcs', key: 'mbal', width: 12, style: { numFmt: '#,##0' } }, { header: 'Rate / h', key: 'rate', width: 9, style: { numFmt: '#,##0' } },
    { header: 'Mould Hours', key: 'hrs', width: 11, style: { numFmt: '#,##0.00' } }, { header: 'Note', key: 'note', width: 30 }
  ];
  head(d);
  T.classes.concat(T.unknown.items.length ? [T.unknown] : []).forEach(r => r.items.forEach(i => (i.lines && i.lines.length ? i.lines : [{}]).forEach((l, n) => {
    const row = d.addRow({
      ton: r.tonnage == null ? 'No tonnage' : r.tonnage, order: i.order_no, odate: day(i.order_date), client: i.client_name, product: i.product_name,
      jc: l.jc_no || '', jcdate: day(l.jc_date), plan: l.plan_id || '', pdate: day(l.plan_date), mc: l.machine || '',
      mno: i.mould_no, mould: i.mould_name, colour: l.colour || '',
      pqty: l.plan_qty, prod: l.produced, bal: l.balance,
      ps: IST(l.plan_start), pe: IST(l.plan_end), px: IST(l.plan_exp),
      lst: l.plan_id && l.status ? (STATUS[l.status] || l.status) : '', st: STATUS[i.status] || i.status, cnt: i.counted ? 'Yes' : 'No',
      /* mould figures once per mould, so a column total is not doubled */
      mbal: n ? null : i.balance, rate: n ? null : (i.rate_pph || null), hrs: n || !i.counted ? null : i.hours,
      note: n ? '' : [i.erp_state, i.mould_source === 'item code' ? 'mould found by item code' : '', i.mould_limited ? 'mould cannot finish by the date alone' : '']
        .filter(Boolean).join('; ')
    });
    if (!i.counted) row.font = { color: { argb: 'FF808080' } };
  })));
  d.autoFilter = { from: 'A1', to: 'Z1' };

  /* sheet: each machine of each tonnage */
  const ms = wb.addWorksheet('Machine summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ms.columns = [
    { header: 'M/c Tonnage', key: 'ton', width: 11 }, { header: 'Machine', key: 'mc', width: 16 }, { header: 'Line', key: 'line', width: 10 },
    { header: 'State', key: 'state', width: 10 }, { header: 'Running Now', key: 'run', width: 46 }, { header: 'Jobs Queued', key: 'q', width: 10 },
    { header: 'Booked Hrs', key: 'bk', width: 11, style: { numFmt: '#,##0.0' } }, { header: 'Available Hrs', key: 'av', width: 12, style: { numFmt: '#,##0' } },
    { header: 'Free Hrs', key: 'free', width: 10, style: { numFmt: '#,##0.0' } }, { header: 'Booked %', key: 'pct', width: 9, style: { numFmt: '0%' } },
    { header: 'Free From', key: 'at', width: 16 }
  ];
  head(ms);
  T.classes.forEach(r => (r.machine_rows || []).forEach(m => {
    const row = ms.addRow({
      ton: r.tonnage, mc: m.machine, line: m.line, state: m.state === 'QUEUED' ? 'Planned' : m.state === 'RUNNING' ? 'Running' : 'Idle',
      run: m.running.map(j => `${j.order_no} · ${j.mould_name}${j.hours_left != null ? ' (' + j.hours_left + ' h left)' : ''}`).join('; '),
      q: m.queue_count, bk: m.booked_hours, av: m.avail_hours, free: m.free_hours, pct: m.booked_pct == null ? null : m.booked_pct / 100,
      at: IST(m.free_at)
    });
    if (m.booked_pct > 100) row.getCell('pct').fill = fill(RED);
    if (m.state === 'IDLE') row.getCell('state').fill = fill(GREEN);
  }));
  ms.autoFilter = { from: 'A1', to: 'K1' };

  /* sheet: moulds that cannot finish by the date on their own */
  const lim = T.classes.flatMap(r => (r.mould_limits || []).map(g => ({ ...g, ton: r.tonnage })));
  if (lim.length) {
    const ml = wb.addWorksheet('Mould limits', { views: [{ state: 'frozen', ySplit: 1 }] });
    ml.columns = [
      { header: 'M/c Tonnage', key: 'ton', width: 11 }, { header: 'Mould No', key: 'mno', width: 16 }, { header: 'Mould Name', key: 'mn', width: 36 },
      { header: 'Orders', key: 'o', width: 8 }, { header: 'Copies', key: 'c', width: 8 },
      { header: 'Hrs Needed', key: 'h', width: 11, style: { numFmt: '#,##0.0' } }, { header: 'Hrs It Can Run', key: 'cap', width: 13, style: { numFmt: '#,##0.0' } },
      { header: 'Hrs Past Date', key: 'x', width: 12, style: { numFmt: '#,##0.0' } }, { header: 'Days Past Date', key: 'xd', width: 13, style: { numFmt: '#,##0.00' } }
    ];
    head(ml);
    lim.forEach(g => ml.addRow({ ton: g.ton, mno: g.mould_no, mn: g.mould_name, o: g.orders, c: g.copies, h: g.hours, cap: g.cap_hours, x: g.extra_hours, xd: g.extra_days }));
  }

  /* sheet: open orders with no mould anywhere */
  if (T.no_mould && T.no_mould.length) {
    const nm = wb.addWorksheet('No mould found', { views: [{ state: 'frozen', ySplit: 1 }] });
    nm.columns = [
      { header: 'Order No', key: 'o', width: 20 }, { header: 'Order Date', key: 'd', width: 11 }, { header: 'Client', key: 'c', width: 26 },
      { header: 'Product', key: 'p', width: 34 }, { header: 'Item Code', key: 'i', width: 11 }, { header: 'Qty', key: 'q', width: 10, style: { numFmt: '#,##0' } },
      { header: 'From', key: 's', width: 13 }
    ];
    head(nm);
    T.no_mould.forEach(o => nm.addRow({ o: o.order_no, d: day(o.order_date), c: o.client_name, p: o.product_name, i: o.item_code, q: o.order_qty || null, s: o.source }));
  }

  /* sheet: machines we have, as per the machine master */
  if (T.master && T.master.total) {
    const M = T.master;
    const m = wb.addWorksheet('Machine master', { views: [{ state: 'frozen', ySplit: 1 }] });
    m.columns = [{ width: 14 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 70 }];
    const h = m.addRow(['M/c Tonnage', 'In master', 'Active', 'Inactive', 'Running', 'Planned', 'Idle', 'Machines']);
    h.eachCell(c => { c.font = { bold: true }; c.fill = fill(HEAD); c.border = box; });
    const line = (name, g) => m.addRow([name, g.total, g.active, g.inactive, g.running, g.queued, g.idle,
      (g.machines || []).map(x => x.machine + (x.active ? '' : ' (inactive)')).join(', ')]).eachCell(c => { c.border = box; c.alignment = { vertical: 'top', wrapText: true }; });
    M.by_tonnage.forEach(g => line(g.tonnage, g));
    if (M.no_tonnage.total) line('No tonnage', M.no_tonnage);
    const t = m.addRow(['Total', M.total, M.active, M.inactive, M.running, M.queued, M.idle, '']);
    t.eachCell({ includeEmpty: true }, c => { c.fill = fill(NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildTonnageWorkbook };
