/*
 * Factory Transfers (Planning Board).
 * A factory sends part of an order's qty to another factory whose Mould Master has
 * the mould. The other factory accepts (or rejects with a reason) and assigns one of
 * its own machines, which creates a normal plan tagged "Transfer from <factory>".
 *
 *  - PlanTransfers.decorateMouldCard(cardEl, group, order)  Create Plan mould cards:
 *      "Also in" badge, Send button, and the transfers already sent for that mould.
 *  - PlanTransfers.openPanel()   Incoming / Sent lists with Accept, Reject,
 *      Assign machine and Cancel.
 *  - PlanTransfers.refreshBadge()  count of incoming transfers waiting for action.
 * API: src/legacy/registerLegacyRoutes.js (/api/plan-transfers*), rules in
 * src/modules/planning/planTransfer.js. Needs JPSMS (app.js).
 */
(function (g) {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (url, opts = {}) => g.JPSMS.api.request(url, { skipLoader: true, silentError: true, ...opts });
  const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });
  const say = (msg, type) => (typeof g.toast === 'function' ? g.toast(msg, type) : alert(msg));
  const fmt = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-';
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const famKey = (v) => String(v || '').trim().replace(/\s+\d+$/, '').toUpperCase();

  const CSS = `
  .pt-strip{margin-top:10px;border:1px dashed #c7d2fe;background:#f5f7ff;border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
  .pt-strip-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
  .pt-where{font-size:.82rem;color:#3730a3;font-weight:700}
  .pt-where b{color:#1e1b4b}
  .pt-send{min-height:32px;border-radius:9px;border:1px solid #6366f1;background:#4f46e5;color:#fff;font-weight:700;font-size:.8rem;padding:0 12px;cursor:pointer}
  .pt-send:disabled{opacity:.5;cursor:not-allowed}
  .pt-chip{display:inline-flex;gap:6px;align-items:center;font-size:.78rem;font-weight:700;border-radius:999px;padding:3px 10px;border:1px solid #e2e8f0;background:#fff;color:#334155}
  .pt-chip.WAITING{background:#fffbeb;border-color:#fde68a;color:#92400e}
  .pt-chip.ACCEPTED{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
  .pt-chip.PLANNED{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
  .pt-chip.REJECTED{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
  .pt-chip.CANCELLED{background:#f8fafc;color:#64748b}
  .pt-chips{display:flex;flex-wrap:wrap;gap:6px}
  .pt-back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:3200;display:flex;align-items:flex-start;justify-content:center;padding:5vh 12px;overflow:auto}
  .pt-box{background:#fff;border-radius:16px;width:min(980px,100%);padding:16px 18px;box-shadow:0 20px 50px rgba(15,23,42,.25)}
  .pt-box.small{width:min(520px,100%)}
  .pt-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
  .pt-head h3{margin:0;font-size:1.1rem;color:#0f172a;display:flex;gap:8px;align-items:center}
  .pt-x{border:0;background:#f1f5f9;border-radius:10px;width:36px;height:36px;font-size:1.1rem;cursor:pointer}
  .pt-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
  .pt-tab{min-height:36px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;padding:0 14px;font-weight:700;cursor:pointer;color:#334155}
  .pt-tab.on{background:#0f172a;color:#fff;border-color:#0f172a}
  .pt-tab .pt-n{margin-left:6px;background:#dc2626;color:#fff;border-radius:999px;padding:1px 7px;font-size:.72rem}
  .pt-list{display:flex;flex-direction:column;gap:10px}
  .pt-card{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}
  .pt-card .pt-t{font-weight:800;color:#0f172a;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .pt-card .pt-s{font-size:.84rem;color:#475569;margin-top:4px;line-height:1.45}
  .pt-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
  .pt-btn{min-height:36px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;padding:0 12px;font-weight:700;cursor:pointer;font-size:.84rem}
  .pt-btn.ok{background:#16a34a;border-color:#16a34a;color:#fff}
  .pt-btn.go{background:#4f46e5;border-color:#4f46e5;color:#fff}
  .pt-btn.no{color:#b91c1c;border-color:#fecaca}
  .pt-empty{padding:26px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px}
  .pt-form{display:flex;flex-direction:column;gap:12px}
  .pt-form label{display:flex;flex-direction:column;gap:4px;font-size:.82rem;font-weight:700;color:#334155}
  .pt-form select,.pt-form input,.pt-form textarea{min-height:40px;border:1px solid #cbd5e1;border-radius:10px;padding:6px 10px;font:inherit;font-weight:500}
  .pt-form textarea{min-height:64px}
  .pt-info{font-size:.84rem;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;line-height:1.5}
  .pt-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
  .pt-warn{font-size:.84rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 10px}
  .pt-count{display:none;margin-left:6px;background:#dc2626;color:#fff;border-radius:999px;padding:1px 7px;font-size:.72rem;font-weight:800}
  .pt-count.on{display:inline-block}
  @media (max-width:640px){.pt-card{grid-template-columns:1fr}.pt-acts{justify-content:flex-start}}
  `;
  function injectCss() {
    if (document.getElementById('pt-css')) return;
    const s = document.createElement('style');
    s.id = 'pt-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const STATUS_TEXT = {
    WAITING: 'Waiting',
    ACCEPTED: 'Accepted - machine not set',
    PLANNED: 'Planned',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled'
  };
  const STATUS_ICON = { WAITING: 'bi-hourglass-split', ACCEPTED: 'bi-check2', PLANNED: 'bi-play-circle', REJECTED: 'bi-x-circle', CANCELLED: 'bi-slash-circle' };

  function modal(html, { small = false } = {}) {
    injectCss();
    const back = document.createElement('div');
    back.className = 'pt-back';
    back.innerHTML = `<div class="pt-box${small ? ' small' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-pt-close]')) close(); });
    document.body.appendChild(back);
    return { el: back, close };
  }

  /* ---------------- order data (Create Plan mould cards) ---------------- */
  const orderCache = new Map();
  function loadOrder(orderNo, fresh = false) {
    const key = String(orderNo || '').trim();
    if (!key) return Promise.resolve(null);
    // Short cache: one fetch serves every mould card of the order rendered together.
    const hit = orderCache.get(key);
    if (!fresh && hit && Date.now() - hit.at < 15000) return hit.p;
    const p = api(`/plan-transfers/order/${encodeURIComponent(key)}`).catch(() => null);
    orderCache.set(key, { p, at: Date.now() });
    return p;
  }

  function transferLine(t, side) {
    const st = String(t.status || '').toUpperCase();
    const other = side === 'sent' ? t.to_factory_name : t.from_factory_name;
    let txt = `${fmt(t.qty)} ${side === 'sent' ? '→' : '←'} ${esc(other || '-')}: ${STATUS_TEXT[st] || st}`;
    if (st === 'PLANNED') txt += ` · ${esc(t.plan_machine || t.planned_machine || '')} · made ${fmt(t.produced_qty)}`;
    return `<span class="pt-chip ${esc(st)}" title="${esc(t.reject_reason ? 'Reason: ' + t.reject_reason : (t.note || ''))}"><i class="bi ${STATUS_ICON[st] || 'bi-dot'}"></i> ${txt}</span>`;
  }

  async function decorateMouldCard(cardEl, group, order) {
    if (!cardEl || !group || !order) return;
    const data = await loadOrder(order.orderNo);
    if (!data || !data.ok || !cardEl.isConnected) return;
    injectCss();
    const rows = (group.rows || []).filter((r) => !r.isDropped);
    const codes = rows.map((r) => r.mould_no || r.item_code).filter(Boolean);
    const factories = new Map();
    codes.forEach((c) => (data.locations?.[c] || []).forEach((f) => factories.set(f.factoryId, f.factoryName)));
    const families = new Set(codes.map(famKey));
    const transfers = (data.transfers || []).filter((t) => families.has(famKey(t.mould_no)));
    if (!factories.size && !transfers.length) return;

    const fid = Number(localStorage.getItem('jpsms_factory_id')) || null;
    const balance = Math.max(0, ...rows.map((r) => Number(r.familyRemainingQty ?? r.remainingQty) || 0));
    const strip = document.createElement('div');
    strip.className = 'pt-strip';
    strip.innerHTML = `
      <div class="pt-strip-top">
        <div class="pt-where">${factories.size
          ? `<i class="bi bi-geo-alt-fill"></i> Also in: <b>${[...factories.values()].map(esc).join(', ')}</b>`
          : '<i class="bi bi-arrow-left-right"></i> Factory transfers'}</div>
        ${factories.size && data.can_send
          ? `<button type="button" class="pt-send" ${balance > 0 ? '' : 'disabled title="No balance left to send"'}><i class="bi bi-send"></i> Send to factory</button>`
          : (factories.size && data.main_only ? '<span class="mini muted">Send from the main site</span>' : '')}
      </div>
      ${transfers.length ? `<div class="pt-chips">${transfers.map((t) => transferLine(t, Number(t.from_factory_id) === fid ? 'sent' : 'incoming')).join('')}</div>` : ''}`;
    const sendBtn = strip.querySelector('.pt-send');
    if (sendBtn) {
      sendBtn.onclick = (e) => {
        e.stopPropagation();
        openSend(order, rows, data);
      };
    }
    const host = cardEl.firstElementChild && cardEl.firstElementChild.firstElementChild;
    (host || cardEl).appendChild(strip);
  }

  function openSend(order, rows, data) {
    const options = rows
      .map((r) => ({ row: r, code: r.mould_no || r.item_code, list: data.locations?.[r.mould_no || r.item_code] || [] }))
      .filter((o) => o.code && o.list.length);
    if (!options.length) return say('No other factory has this mould', 'error');
    const m = modal(`
      <div class="pt-head"><h3><i class="bi bi-send"></i> Send to another factory</h3><button class="pt-x" data-pt-close aria-label="Close">×</button></div>
      <div class="pt-form">
        <div class="pt-info">Order <b>${esc(order.orderNo)}</b> · ${esc(order.productName || '')}<br>
          The other factory will see this in <b>Factory Transfers → Incoming</b>, accept it and choose its own machine.
          The qty is held back from this order's balance until they plan it or reject it.</div>
        <label>Mould
          <select id="ptMould">${options.map((o, i) => `<option value="${i}">${esc(o.code)}${o.row.mould_name ? ' - ' + esc(o.row.mould_name) : ''}</option>`).join('')}</select>
        </label>
        <label>Send to factory <select id="ptFactory"></select></label>
        <label>Qty to send <input id="ptQty" type="number" min="1" step="1" inputmode="numeric"></label>
        <div class="pt-info" id="ptBal"></div>
        <label>Note for the other factory (optional) <textarea id="ptNote" maxlength="500" placeholder="e.g. urgent, start this week"></textarea></label>
        <div class="pt-foot"><button class="pt-btn" data-pt-close>Close</button><button class="pt-btn go" id="ptGo"><i class="bi bi-send"></i> Send</button></div>
      </div>`, { small: true });
    const $ = (id) => m.el.querySelector('#' + id);
    const fill = () => {
      const o = options[Number($('ptMould').value) || 0];
      $('ptFactory').innerHTML = o.list.map((f) => `<option value="${f.factoryId}">${esc(f.factoryName)} (master: ${esc(f.mouldNumber)})</option>`).join('');
      const bal = Math.max(0, Number(o.row.familyRemainingQty ?? o.row.remainingQty) || 0);
      $('ptQty').value = bal || '';
      $('ptQty').max = bal || '';
      $('ptBal').innerHTML = `Balance of this mould: <b>${fmt(bal)}</b>. You can send all of it or only a part.`;
    };
    $('ptMould').onchange = fill;
    fill();
    $('ptGo').onclick = async () => {
      const o = options[Number($('ptMould').value) || 0];
      const btn = $('ptGo');
      btn.disabled = true;
      try {
        const res = await post('/plan-transfers', {
          orderNo: order.orderNo, mouldNo: o.code, toFactoryId: Number($('ptFactory').value), qty: Number($('ptQty').value), note: $('ptNote').value
        });
        say(`Sent to ${res.toFactoryName || 'the factory'}. They will accept it and set the machine.`, 'success');
        m.close();
        orderCache.delete(String(order.orderNo).trim());
        if (typeof g.selectCpOrder === 'function' && g.cpSelectedOrder) g.selectCpOrder(g.cpSelectedOrder, true);
      } catch (e) {
        say(e.message || 'Could not send', 'error');
        btn.disabled = false;
      }
    };
  }

  /* ---------------- Factory Transfers panel ---------------- */
  let panel = null;
  let tab = 'incoming';

  async function openPanel(which) {
    if (which) tab = which;
    if (panel) panel.close();
    panel = modal(`
      <div class="pt-head"><h3><i class="bi bi-arrow-left-right"></i> Factory Transfers</h3><button class="pt-x" data-pt-close aria-label="Close">×</button></div>
      <div class="pt-tabs">
        <button class="pt-tab" data-tab="incoming">Incoming <span class="pt-n" style="display:none"></span></button>
        <button class="pt-tab" data-tab="sent">Sent</button>
        <label style="margin-left:auto;display:flex;gap:6px;align-items:center;font-size:.84rem;color:#475569"><input type="checkbox" id="ptAll"> Show old (done / rejected)</label>
      </div>
      <div id="ptMsg"></div>
      <div class="pt-list" id="ptList"><div class="pt-empty">Loading…</div></div>`);
    const el = panel.el;
    el.querySelectorAll('.pt-tab').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; renderPanel(); }; });
    el.querySelector('#ptAll').onchange = renderPanel;
    const closeOld = panel.close;
    panel.close = () => { closeOld(); panel = null; };
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-pt-close]')) panel = null; });
    renderPanel();
  }

  async function renderPanel() {
    if (!panel) return;
    const el = panel.el;
    el.querySelectorAll('.pt-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const list = el.querySelector('#ptList');
    const msg = el.querySelector('#ptMsg');
    list.innerHTML = '<div class="pt-empty">Loading…</div>';
    const all = el.querySelector('#ptAll').checked;
    let res;
    try {
      res = await api(`/plan-transfers?box=${tab}&status=${all ? 'all' : 'open'}`);
    } catch (e) {
      list.innerHTML = `<div class="pt-empty">${esc(e.message || 'Could not load')}</div>`;
      return;
    }
    updateCount(res.waiting_incoming);
    const n = el.querySelector('.pt-tab[data-tab="incoming"] .pt-n');
    if (n) { n.textContent = res.waiting_incoming || ''; n.style.display = res.waiting_incoming ? '' : 'none'; }
    msg.innerHTML = res.need_factory
      ? '<div class="pt-warn">Select one factory (top of the page) to see its transfers.</div>'
      : (res.main_only ? '<div class="pt-warn">Accepting and assigning machines works on the main site only.</div>' : '');
    const rows = res.data || [];
    if (!rows.length) {
      list.innerHTML = `<div class="pt-empty">${tab === 'incoming' ? 'No transfers sent to this factory.' : 'This factory has not sent any transfers.'}</div>`;
      return;
    }
    const can = !!res.can_manage;
    list.innerHTML = rows.map((t) => cardHtml(t, can)).join('');
    list.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => act(b.dataset.act, rows.find((t) => String(t.id) === b.dataset.id));
    });
  }

  function cardHtml(t, can) {
    const st = String(t.status || '').toUpperCase();
    const incoming = tab === 'incoming';
    const other = incoming ? `From <b>${esc(t.from_factory_name || '-')}</b>` : `To <b>${esc(t.to_factory_name || '-')}</b>`;
    const lines = [
      `${other} · sent by ${esc(t.requested_by || '-')} on ${esc(when(t.requested_at))}`,
      `Mould <b>${esc(t.mould_no)}</b>${t.mould_name ? ' - ' + esc(t.mould_name) : ''} · ${esc(t.item_name || '')}${t.client_name ? ' · ' + esc(t.client_name) : ''}`
    ];
    if (t.note) lines.push(`Note: ${esc(t.note)}`);
    if (st === 'REJECTED') lines.push(`<span style="color:#b91c1c">Rejected by ${esc(t.decided_by || '-')}: ${esc(t.reject_reason || '')}</span>`);
    if (st === 'ACCEPTED') lines.push(`Accepted by ${esc(t.decided_by || '-')} on ${esc(when(t.decided_at))}`);
    if (st === 'PLANNED') {
      const where = incoming ? '' : `Running at <b>${esc(t.to_factory_name || '-')}</b> · `;
      lines.push(`${where}Machine <b>${esc(t.plan_machine || t.planned_machine || '-')}</b> · Plan ${esc(t.plan_id || '-')} · ${esc(String(t.plan_status || '').toUpperCase() || 'PLANNED')} · made <b>${fmt(t.produced_qty)}</b> / ${fmt(t.qty)}`);
    }
    if (st === 'CANCELLED') lines.push(`Cancelled by ${esc(t.cancelled_by || '-')}`);
    const acts = [];
    if (can && incoming && st === 'WAITING') {
      acts.push(`<button class="pt-btn ok" data-act="accept" data-id="${t.id}"><i class="bi bi-check2"></i> Accept</button>`);
      acts.push(`<button class="pt-btn no" data-act="reject" data-id="${t.id}"><i class="bi bi-x"></i> Reject</button>`);
    }
    if (can && incoming && st === 'ACCEPTED') acts.push(`<button class="pt-btn go" data-act="assign" data-id="${t.id}"><i class="bi bi-cpu"></i> Assign machine</button>`);
    if (can && !incoming && (st === 'WAITING' || st === 'ACCEPTED')) acts.push(`<button class="pt-btn no" data-act="cancel" data-id="${t.id}">Cancel</button>`);
    return `
      <div class="pt-card">
        <div>
          <div class="pt-t">${esc(t.order_no)} <span class="pt-chip ${esc(st)}"><i class="bi ${STATUS_ICON[st] || 'bi-dot'}"></i> ${esc(STATUS_TEXT[st] || st)}</span> <span>${fmt(t.qty)} pcs</span></div>
          <div class="pt-s">${lines.join('<br>')}</div>
        </div>
        <div class="pt-acts">${acts.join('')}</div>
      </div>`;
  }

  async function act(action, t) {
    if (!t) return;
    try {
      if (action === 'accept') {
        await post(`/plan-transfers/${t.id}/accept`);
        say('Accepted. Now assign a machine.', 'success');
        await renderPanel();
        return openAssign(t);
      }
      if (action === 'reject') {
        const reason = prompt(`Reason for rejecting ${t.order_no} (${fmt(t.qty)} pcs)? The sending factory will see it.`);
        if (reason == null) return;
        if (!reason.trim()) return say('Please write the reason', 'error');
        await post(`/plan-transfers/${t.id}/reject`, { reason });
        say('Rejected', 'success');
      }
      if (action === 'cancel') {
        if (!confirm(`Cancel the transfer of ${fmt(t.qty)} pcs to ${t.to_factory_name}? The qty comes back to your balance.`)) return;
        await post(`/plan-transfers/${t.id}/cancel`);
        say('Cancelled', 'success');
      }
      if (action === 'assign') return openAssign(t);
      renderPanel();
    } catch (e) {
      say(e.message || 'Failed', 'error');
      renderPanel();
    }
  }

  async function openAssign(t) {
    let res;
    try {
      res = await api(`/plan-transfers/${t.id}/machines`);
    } catch (e) { return say(e.message || 'Could not load machines', 'error'); }
    const mould = res.mould || {};
    const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hinted = new Set(`${mould.primary_machine || ''},${mould.secondary_machine || ''}`.split(',').map(norm).filter(Boolean));
    const machines = res.machines || [];
    const best = machines.filter((mc) => hinted.has(norm(mc.machine)));
    const rest = machines.filter((mc) => !hinted.has(norm(mc.machine)));
    const opt = (mc) => `<option value="${esc(mc.machine)}">${esc(mc.machine)}${mc.line ? ' · Line ' + esc(mc.line) : ''}${mc.tonnage ? ' · ' + esc(mc.tonnage) + 'T' : ''}</option>`;
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const m = modal(`
      <div class="pt-head"><h3><i class="bi bi-cpu"></i> Assign machine</h3><button class="pt-x" data-pt-close aria-label="Close">×</button></div>
      <div class="pt-form">
        <div class="pt-info">Order <b>${esc(t.order_no)}</b> from <b>${esc(t.from_factory_name || '-')}</b><br>
          Mould <b>${esc(t.mould_no)}</b>${t.mould_name ? ' - ' + esc(t.mould_name) : ''} · ${fmt(t.qty)} pcs<br>
          Your Mould Master: primary <b>${esc(mould.primary_machine || '-')}</b>, secondary <b>${esc(mould.secondary_machine || '-')}</b></div>
        ${machines.length ? '' : '<div class="pt-warn">No active moulding machines found in your machine master.</div>'}
        <label>Machine
          <select id="ptMac">
            ${best.length ? `<optgroup label="From your Mould Master">${best.map(opt).join('')}</optgroup>` : ''}
            <optgroup label="All machines">${rest.map(opt).join('')}</optgroup>
          </select>
        </label>
        <label>Start <input id="ptStart" type="datetime-local" value="${now.toISOString().slice(0, 16)}"></label>
        <label>Plan qty <input id="ptPQty" type="number" min="1" max="${esc(t.qty)}" value="${esc(Number(t.qty))}"></label>
        <div class="pt-info">The plan goes on your board with the tag <b>Transfer from ${esc(t.from_factory_name || '-')}</b>, and follows the normal job card approval.</div>
        <div class="pt-foot"><button class="pt-btn" data-pt-close>Close</button><button class="pt-btn go" id="ptSave" ${machines.length ? '' : 'disabled'}><i class="bi bi-check2"></i> Create plan</button></div>
      </div>`, { small: true });
    const $ = (id) => m.el.querySelector('#' + id);
    $('ptSave').onclick = async () => {
      const machine = $('ptMac').value;
      const mc = machines.find((x) => x.machine === machine) || {};
      const qty = Number($('ptPQty').value);
      if (!machine) return say('Choose a machine', 'error');
      if (!(qty > 0) || qty > Number(t.qty)) return say(`Plan qty must be 1 to ${fmt(t.qty)}`, 'error');
      const start = $('ptStart').value ? new Date($('ptStart').value).toISOString() : new Date().toISOString();
      const btn = $('ptSave');
      btn.disabled = true;
      try {
        const out = await post('/planning/create', [{
          transferId: t.id,
          plant: String(res.factory?.name || '').toUpperCase() || 'PLANT',
          building: mc.building || '',
          line: mc.line || '',
          machine,
          orderNo: t.order_no,
          itemCode: t.item_code || t.mould_no,
          itemName: t.item_name || null,
          clientName: t.client_name || null,
          mouldName: t.mould_name || t.mould_no,
          mouldCode: t.mould_no,
          planQty: qty,
          balQty: qty,
          batchQty: qty,
          mouldItemQty: Number(t.qty),
          colourDetails: [],
          startDate: start
        }]);
        if (!out || out.ok === false) throw new Error((out && out.error) || 'Could not create the plan');
        say(`Plan ${(out.planIds || [])[0] || ''} created on ${machine}`, 'success');
        m.close();
        renderPanel();
        if (typeof g.loadMachines === 'function') g.loadMachines();
      } catch (e) {
        say(e.message || 'Could not create the plan', 'error');
        btn.disabled = false;
      }
    };
  }

  /* ---------------- toolbar count ---------------- */
  function updateCount(n) {
    document.querySelectorAll('.pt-count').forEach((b) => {
      b.textContent = n || '';
      b.classList.toggle('on', Number(n) > 0);
      b.title = n ? `${n} incoming transfer(s) need action` : '';
    });
  }
  async function refreshBadge() {
    if (!g.JPSMS || !g.JPSMS.api) return;
    try {
      const res = await api('/plan-transfers?box=incoming&status=open');
      updateCount(res.waiting_incoming);
    } catch (_) { /* ignore */ }
  }
  function startBadge() {
    injectCss();
    refreshBadge();
    setInterval(refreshBadge, 120000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(startBadge, 1500));
  else setTimeout(startBadge, 1500);

  g.PlanTransfers = { decorateMouldCard, openPanel, refreshBadge, loadOrder };
})(window);
