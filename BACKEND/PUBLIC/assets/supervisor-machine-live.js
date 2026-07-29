/**
 * Supervisor live machine strip (read-only).
 *
 * Adds a small collapsible panel (bottom-right) that shows live counter, cycle
 * time and run/stop status for every machine linked to a Modbus source. Purely
 * additive: it injects its own DOM node and polls /api/machine-data/latest. It
 * does not touch supervisor.html's existing logic.
 *
 * To remove: delete this file's <script> tag from supervisor.html.
 */
(function () {
  'use strict';

  var panel, body;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function build() {
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;max-width:320px;' +
      'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;' +
      'font-family:system-ui,sans-serif;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.35)';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;' +
      'padding:8px 10px;border-bottom:1px solid #334155;cursor:pointer;font-weight:700';
    head.innerHTML = '<span>⚙ Live machines</span><span id="mdlive-toggle" style="color:#94a3b8">▾</span>';
    body = document.createElement('div');
    body.style.cssText = 'padding:6px 10px;max-height:300px;overflow:auto';
    body.innerHTML = '<div style="color:#94a3b8;padding:6px 0">Loading…</div>';
    head.addEventListener('click', function () {
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      document.getElementById('mdlive-toggle').textContent = hidden ? '▾' : '▸';
    });
    panel.appendChild(head);
    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  function render(readings) {
    if (!readings || !readings.length) {
      body.innerHTML = '<div style="color:#94a3b8;padding:6px 0">No machine linked yet.</div>';
      return;
    }
    body.innerHTML = readings.map(function (r) {
      var run = r.machine_running;
      var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
        (run ? '#22c55e' : '#64748b') + ';margin-right:6px"></span>';
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #1e293b">' +
        '<span>' + dot + esc(r.machine_name || '') + '</span>' +
        '<span style="color:#94a3b8">good <b style="color:#e2e8f0">' + (r.good_shots == null ? '—' : esc(r.good_shots)) +
        '</b> · cyc <b style="color:#e2e8f0">' + (r.cycle_time_s == null ? '—' : esc(r.cycle_time_s)) + 's</b></span>' +
        '</div>';
    }).join('');
  }

  function refresh() {
    fetch('/api/machine-data/latest', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { if (b && b.ok) render(b.readings); })
      .catch(function () { /* best-effort */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    build();
    refresh();
    setInterval(refresh, 10000);
  });
})();
