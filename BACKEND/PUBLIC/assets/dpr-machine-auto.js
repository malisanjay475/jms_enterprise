/**
 * DPR machine-auto overlay (read-only).
 *
 * Stamps a small "⚙ N" badge onto each DPR hourly grid cell showing the machine
 * COUNTER-derived good count for that machine/hour, next to the manually keyed
 * value. Purely additive: it never edits dpr_hourly and never touches the grid
 * render code. It reads the date/shift shown in the grid from the cells'
 * data-dpr-* attributes, fetches /api/machine-data/dpr-auto-bulk, and appends
 * badges. Idempotent — safe to run on a timer.
 *
 * To remove entirely: delete this file's <script> tag from dpr.html (and untick
 * the machine under /machine_data.html). Nothing else needs cleanup.
 */
(function () {
  'use strict';
  var BADGE_CLASS = 'md-auto-badge';

  function esc(s) { return String(s == null ? '' : s); }

  function currentContext() {
    // The sticky machine-label cell carries the date + shift currently rendered.
    var label = document.querySelector('td[data-dpr-date][data-dpr-shift]');
    if (!label) return null;
    return { date: label.getAttribute('data-dpr-date'), shift: label.getAttribute('data-dpr-shift') };
  }

  function applyBadges(map) {
    var cells = document.querySelectorAll('td[data-mdmachine][data-mdslot]');
    cells.forEach(function (td) {
      var machine = td.getAttribute('data-mdmachine');
      var slot = td.getAttribute('data-mdslot');
      var byMachine = map[machine];
      var rec = byMachine ? byMachine[slot] : null;
      var existing = td.querySelector('.' + BADGE_CLASS);
      if (!rec || rec.good == null) { if (existing) existing.remove(); return; }
      var txt = '⚙ ' + rec.good;                 // gear + count
      var tip = 'Click for machine detail · counter this hour: ' + rec.good +
                (rec.cycle != null ? ' · avg cycle ' + rec.cycle + 's' : '');
      if (existing) { existing.firstChild ? (existing.firstChild.nodeValue = txt) : (existing.textContent = txt); existing.title = tip; return; }
      var b = document.createElement('span');
      b.className = BADGE_CLASS;
      b.textContent = txt;
      b.title = tip;
      b.style.cssText = 'position:absolute;bottom:1px;right:2px;background:#0ea5e9;color:#fff;' +
        'font-size:0.55rem;font-weight:800;line-height:1.3;padding:0 4px;border-radius:6px;' +
        'z-index:6;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.2)';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();               // don't open the manual-entry detail
        openDetail(machine, slot);
      });
      td.appendChild(b);
    });
  }

  // --- Popup: the requested registers + when the last reading was taken ------
  function openDetail(machine, slot) {
    var ctx = currentContext();
    if (!ctx) return;
    var url = '/api/machine-data/slot-detail?machine=' + encodeURIComponent(machine) +
      '&date=' + encodeURIComponent(ctx.date) + '&shift=' + encodeURIComponent(ctx.shift || 'Day') +
      '&slot=' + encodeURIComponent(slot);
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) showModal(machine, slot, d); })
      .catch(function () { /* best-effort */ });
  }

  function fmtWhen(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  function showModal(machine, slot, d) {
    closeModal();
    var overlay = document.createElement('div');
    overlay.id = 'md-detail-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;' +
      'display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    var rows = '';
    if (d.found) {
      rows = (d.fields || []).map(function (f) {
        var v = (f.value == null) ? '—' : (f.value + (f.unit ? ' ' + f.unit : ''));
        return '<tr><td style="padding:6px 10px;color:#475569">' + f.label + '</td>' +
               '<td style="padding:6px 10px;font-weight:700;text-align:right">' + v + '</td></tr>';
      }).join('');
    }

    var body = d.found
      ? '<table style="width:100%;border-collapse:collapse;font-size:13px">' + rows + '</table>' +
        '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569">' +
        '<div><b>Last reading taken:</b> ' + fmtWhen(d.last_at) + '</div>' +
        '<div><b>First in this hour:</b> ' + fmtWhen(d.first_at) + '</div>' +
        '<div><b>Readings in this hour:</b> ' + d.samples + '</div>' +
        '</div>'
      : '<div style="color:#64748b;font-size:13px;padding:8px 0">No machine reading recorded in this hour.</div>';

    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:12px;min-width:320px;max-width:420px;' +
      'box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden';
    card.innerHTML =
      '<div style="background:#0ea5e9;color:#fff;padding:10px 14px;font-weight:800;display:flex;justify-content:space-between;align-items:center">' +
      '<span>⚙ ' + esc(machine) + ' · ' + esc(slot) + '</span>' +
      '<span id="md-detail-close" style="cursor:pointer;font-size:18px;line-height:1">×</span></div>' +
      '<div style="padding:14px">' + body + '</div>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.getElementById('md-detail-close').addEventListener('click', closeModal);
  }

  function closeModal() {
    var ex = document.getElementById('md-detail-overlay');
    if (ex) ex.remove();
  }

  function refresh() {
    var ctx = currentContext();
    if (!ctx || !ctx.date) return;
    fetch('/api/machine-data/dpr-auto-bulk?date=' + encodeURIComponent(ctx.date) +
          '&shift=' + encodeURIComponent(ctx.shift || 'Day'), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) { if (body && body.ok && body.machines) applyBadges(body.machines); })
      .catch(function () { /* silent: overlay is best-effort */ });
  }

  // Re-apply on a gentle timer; the grid re-renders on its own, badges re-stamp.
  document.addEventListener('DOMContentLoaded', function () {
    refresh();
    setInterval(refresh, 15000);
  });
})();
