'use strict';

/**
 * Excel for the Order Tracker "Tonnage load" view, laid out like the factory's
 * monthly "Machine planning summary" sheet: title band, the period / efficiency
 * inputs in yellow, one row per machine tonnage, shortage cells red, excess
 * cells green and a navy total row. A second sheet lists the orders and moulds
 * behind every tonnage.
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
  const ws = wb.addWorksheet('Machine planning summary', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [14, 14, 12, 13, 12, 14, 12, 13, 13, 12, 13, 13, 12, 12, 13, 9, 9].map(width => ({ width }));
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

  /* row 4: headers */
  const heads = ['M/c Tonnage', 'Hrs Required', 'Days Required', 'Available Hrs', 'Available Days', 'Machines With Us',
    'Total Machine Plan', 'Machine Shortage Numbers', 'Machine Shortage Days', 'Capacity Booked', 'Machine Excess Numbers',
    'Machine Excess Days', 'Running Hrs', 'Queued Hrs', 'No Machine Hrs', 'Orders', 'Moulds'];
  const hr = ws.getRow(4);
  hr.values = heads; hr.height = 44;
  hr.eachCell(c => { c.font = { bold: true }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.fill = fill(HEAD); c.border = box; });

  const nums = ['#,##0.00', '#,##0.00', '#,##0', '#,##0.00', '0', '#,##0.00', '#,##0.00', '#,##0.00', '0%', '#,##0.00', '#,##0.00', '#,##0.0', '#,##0.0', '#,##0.0', '0', '0'];
  const put = (r, name, bold) => {
    const row = ws.addRow([name, r.load_hours, r.load_days, r.avail_hours, r.avail_days, r.machine_count, r.machines_needed,
      r.shortage_machines || null, r.shortage_days || null, r.booked_pct == null ? null : r.booked_pct / 100,
      r.excess_machines || null, r.excess_days || null, r.running_hours, r.queued_hours, r.unplanned_hours, r.orders, r.moulds]);
    row.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = box;
      if (i > 1) { c.numFmt = nums[i - 2]; c.alignment = { horizontal: 'right' }; }
      if (c.value == null && i > 1) { c.value = '-'; c.alignment = { horizontal: 'center' }; }
    });
    row.getCell(1).font = { bold: true };
    if (!bold) {
      if (r.shortage_machines > 0) [8, 9].forEach(i => { row.getCell(i).fill = fill(RED); row.getCell(i).font = { bold: true, italic: true }; });
      if (r.excess_machines > 0) [11, 12].forEach(i => { row.getCell(i).fill = fill(GREEN); row.getCell(i).font = { bold: true, italic: true }; });
    }
    return row;
  };
  T.classes.forEach(r => put(r, `${r.tonnage}`));
  const tot = put(T.total, 'Total', true);
  tot.eachCell({ includeEmpty: true }, c => { c.fill = fill(NAVY); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  if (T.unknown.items.length) {
    const u = put(T.unknown, 'No tonnage', true);
    u.getCell(1).font = { bold: true, color: { argb: 'FFC00000' } };
    ws.addRow([]);
    ws.addRow([`${T.unknown.items.length} moulds have no tonnage in the mould master or ERP; they are not in the total.`]).getCell(1).font = { italic: true, color: { argb: 'FFC00000' } };
  }
  ws.addRow([]);
  ws.addRow(['Hrs Required = balance pieces of open orders ÷ pieces per hour (live DPR rate, else mould standard). Available Hrs = machines × 24 h × days × efficiency.'])
    .getCell(1).font = { italic: true, color: { argb: 'FF595959' } };

  /* sheet 2: what makes up the load */
  const d = wb.addWorksheet('Order detail', { views: [{ state: 'frozen', ySplit: 1 }] });
  d.columns = [
    { header: 'M/c Tonnage', key: 'ton', width: 12 }, { header: 'Order', key: 'order', width: 22 },
    { header: 'Client', key: 'client', width: 24 }, { header: 'Product', key: 'product', width: 30 },
    { header: 'Mould', key: 'mould', width: 28 }, { header: 'Mould T', key: 'mt', width: 9 },
    { header: 'Target', key: 'target', width: 12 }, { header: 'Balance Pcs', key: 'bal', width: 12, style: { numFmt: '#,##0' } },
    { header: 'Rate / h', key: 'rate', width: 9, style: { numFmt: '#,##0' } }, { header: 'Hours', key: 'hrs', width: 10, style: { numFmt: '#,##0.00' } },
    { header: 'Days', key: 'days', width: 9, style: { numFmt: '#,##0.00' } }, { header: 'Where', key: 'where', width: 26 }
  ];
  d.getRow(1).eachCell(c => { c.font = { bold: true }; c.fill = fill(HEAD); c.border = box; c.alignment = { vertical: 'middle', wrapText: true }; });
  T.classes.concat(T.unknown.items.length ? [T.unknown] : []).forEach(r => r.items.forEach(i => d.addRow({
    ton: r.tonnage == null ? 'No tonnage' : r.tonnage, order: i.order_no, client: i.client_name, product: i.product_name,
    mould: i.mould_name, mt: i.mould_tonnage, target: i.target_date ? String(i.target_date).slice(0, 10) : '',
    bal: i.balance, rate: i.rate_pph || null, hrs: i.hours, days: i.hours == null ? null : i.hours / 24,
    where: i.status === 'RUNNING' ? 'Running on ' + (i.machines || []).join(', ')
      : i.queue ? `Queued #${i.queue.position} on ${i.queue.machine}` : 'No machine'
  })));
  d.autoFilter = { from: 'A1', to: 'L1' };

  return wb.xlsx.writeBuffer();
}

module.exports = { buildTonnageWorkbook };
