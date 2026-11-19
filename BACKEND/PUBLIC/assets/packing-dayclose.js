/*
 * Packing day close (step 11): close each station's day with a reason for every shortfall
 * and every stoppage. Used by the packing plan board (assembly.html).
 *   PackDayClose.open({ day, station?, onChange })  - no station: the list of all stations
 *   PackDayClose.dayStatus(day)                     - { 'station (lower)': row } for the board tags
 * Needs JPSMS (app.js).
 */
(function (g) {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const api = (url, opts = {}) => JPSMS.api.request(url, { skipLoader: true, silentError: true, ...opts });
    const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
    const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
    const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
    const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
    const dayText = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

    const CSS = `
    .dc-back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}
    .dc-box{background:#fff;border-radius:16px;width:min(920px,100%);padding:16px 18px;box-shadow:0 20px 50px rgba(15,23,42,.25)}
    .dc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}
    .dc-top h3{margin:0;font-size:1.1rem;color:#0f172a;min-width:0}
    .dc-top h3 small{display:block;font-size:.8rem;font-weight:400;color:#64748b;margin-top:2px}
    .dc-x{border:1px solid #cbd5e1;background:#fff;border-radius:8px;min-width:40px;min-height:40px;cursor:pointer;color:#334155}
    .dc-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
    .dc-sum div{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px}
    .dc-sum small{display:block;font-size:.72rem;color:#64748b}
    .dc-sum b{font-size:1.15rem;color:#0f172a}
    .dc-sum .bad b{color:#b45309}
    .dc-note{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:.84rem;color:#475569;margin:10px 0}
    .dc-warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
    .dc-ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
    .dc-h{margin:14px 0 6px;font-size:.92rem;color:#0f172a;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
    .dc-row{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-bottom:8px;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:8px;align-items:center}
    .dc-row.need{border-color:#fcd34d;background:#fffbeb}
    .dc-what b{display:block;color:#0f172a;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dc-what small{display:block;color:#64748b;font-size:.78rem}
    .dc-what .sh{color:#b45309;font-weight:700}
    .dc-why{display:flex;flex-direction:column;gap:6px;min-width:0}
    .dc-why select,.dc-why input,.dc-in{min-height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;width:100%;font:inherit;font-size:.88rem;background:#fff}
    .dc-why .ro{font-size:.86rem;color:#0f172a}
    .dc-why .ro small{color:#64748b}
    .dc-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
    .dc-list{display:flex;flex-direction:column;gap:8px}
    .dc-st{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px}
    .dc-st b{color:#0f172a}
    .dc-st small{display:block;color:#64748b;font-size:.78rem}
    .dc-pill{font-size:.75rem;font-weight:700;border-radius:999px;padding:3px 9px;white-space:nowrap;background:#f1f5f9;color:#475569}
    .dc-pill.closed{background:#dcfce7;color:#166534}
    .dc-pill.open{background:#fef3c7;color:#92400e}
    .dc-pin{display:grid;grid-template-columns:140px 1fr auto;gap:8px;align-items:center;margin-top:10px}
    .dc-empty{color:#64748b;font-size:.86rem}
    body.dc-open .mobile-sidebar-fab{visibility:hidden}
    @media (max-width:640px){
      .dc-back{padding:12px 8px 96px}
      .dc-top{align-items:flex-start}
      .dc-top h3{font-size:1rem}
      .dc-sum{grid-template-columns:repeat(2,minmax(0,1fr))}
      .dc-row{grid-template-columns:1fr}
      .dc-st{grid-template-columns:minmax(0,1fr) auto}
      .dc-st .dc-pill{grid-column:1/-1;justify-self:start}
      .dc-pin{grid-template-columns:1fr}
    }`;

    const S = { box: null, day: null, station: null, data: null, list: null, onChange: null, reopen: false, busy: false };

    function ensureCss() {
        if (document.getElementById('dc-css')) return;
        const st = document.createElement('style');
        st.id = 'dc-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    function reasonSelect(attr, value, reasons) {
        const has = reasons.some(r => r.label === value);
        return `<select ${attr} aria-label="Reason"><option value="">Reason…</option>
            ${reasons.map(r => `<option${r.label === value ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
            ${value && !has ? `<option selected>${esc(value)}</option>` : ''}</select>`;
    }

    function needsNote(label) {
        const r = (S.data.reasons || []).find(x => x.label === label);
        return Boolean(r && r.needs_note);
    }

    /* ---------- all stations ---------- */

    async function loadList() {
        const res = await api(`/packing/day-close/day?day=${encodeURIComponent(S.day)}`);
        if (!res || res.ok === false) throw new Error((res && res.error) || 'Could not load the day');
        S.list = res.data;
        renderList();
    }

    function renderList() {
        const L = S.list;
        const rows = L.stations.map(s => {
            const t = s.totals;
            const fig = t ? `Plan ${fmt(t.plan_qty)} · packed ${fmt(t.packed)}${t.short ? ` · <span style="color:#b45309">${fmt(t.short)} short</span>` : ''} · ${fmt(t.lost_min)} min lost` : 'Nothing yet';
            const pill = s.status === 'CLOSED' ? `<span class="dc-pill closed">Closed · ${esc(s.closed_by || '')}</span>`
                : s.status === 'REOPENED' ? '<span class="dc-pill open">Reopened</span>'
                    : (s.has_work ? '<span class="dc-pill open">Not closed</span>' : '<span class="dc-pill">No work</span>');
            const btn = L.future ? '' : `<button type="button" class="btn btn-sm ${s.status === 'CLOSED' ? 'btn-outline' : 'btn-primary'}" data-st="${esc(s.station)}">${s.status === 'CLOSED' ? 'View' : 'Close day'}</button>`;
            return `<div class="dc-st"><div><b>${esc(s.station)}</b><small>${fig}</small></div>${pill}${btn}</div>`;
        }).join('');
        const closed = L.stations.filter(s => s.status === 'CLOSED').length;
        S.box.innerHTML = `<div class="dc-box" role="dialog" aria-modal="true" aria-label="Close day">
            <div class="dc-top"><h3><i class="bi bi-moon-stars"></i> Close day<small>${esc(dayText(L.day))} · ${closed} of ${L.stations.length} stations closed</small></h3>
                <button type="button" class="dc-x" data-close="1" aria-label="Close"><i class="bi bi-x-lg"></i></button></div>
            ${L.future ? '<div class="dc-note dc-warn">This day has not started yet.</div>' : ''}
            ${L.before_17 ? '<div class="dc-note dc-warn">It is before 17:00. If you close now, stoppages are counted only up to now.</div>' : ''}
            <div class="dc-list">${rows || '<span class="dc-empty">No packing station is set up. Add stations in Packing Masters.</span>'}</div>
        </div>`;
    }

    /* ---------- one station ---------- */

    async function loadStation() {
        const res = await api(`/packing/day-close?station=${encodeURIComponent(S.station)}&day=${encodeURIComponent(S.day)}`);
        if (!res || res.ok === false) throw new Error((res && res.error) || 'Could not load the day');
        S.data = res.data;
        S.reopen = false;
        renderStation();
    }

    function lineRow(l, i, ro) {
        const short = Number(l.short) || 0;
        const what = `<div class="dc-what"><b title="${esc(l.item_name)}">${esc(l.item_name || 'Plan ' + l.plan_id)}</b>
            <small>${l.job_card_no ? `${esc(l.job_card_no)} · ` : ''}${l.tables ? `Tables ${esc(String(l.tables).split(',').join(' '))} · ` : ''}plan ${fmt(l.plan_qty)} · packed ${fmt(l.packed)}${short ? ` · <span class="sh">${fmt(short)} short</span>` : ' · on target'}</small></div>`;
        if (!short) return `<div class="dc-row">${what}<div class="dc-why"><span class="ro" style="color:#166534">No reason needed</span></div></div>`;
        if (ro) return `<div class="dc-row">${what}<div class="dc-why"><span class="ro">${esc(l.reason)}${l.note ? `<small> · ${esc(l.note)}</small>` : ''}</span></div></div>`;
        const note = l.reason || l.note;
        return `<div class="dc-row${l.reason ? '' : ' need'}" data-line="${i}">${what}<div class="dc-why">${reasonSelect(`data-lr="${i}"`, l.reason, S.data.reasons)}
            <input data-ln="${i}" placeholder="${needsNote(l.reason) ? 'Note (needed)' : 'Note (optional)'}" maxlength="200" value="${esc(l.note || '')}"${note ? '' : ' hidden'}></div></div>`;
    }

    function stopRow(g2, i, ro) {
        const what = `<div class="dc-what"><b>${esc(hm(g2.from))} – ${esc(hm(g2.to))} · ${fmt(g2.minutes)} min</b>
            <small>${g2.tables && g2.tables.length ? `Tables ${esc(g2.tables.join(' '))}` : 'No good scan'}</small></div>`;
        if (ro) return `<div class="dc-row">${what}<div class="dc-why"><span class="ro">${esc(g2.reason)}${g2.note ? `<small> · ${esc(g2.note)}</small>` : ''}</span></div></div>`;
        const note = g2.reason || g2.note;
        return `<div class="dc-row${g2.reason ? '' : ' need'}">${what}<div class="dc-why">${reasonSelect(`data-sr="${i}"`, g2.reason, S.data.reasons)}
            <input data-sn="${i}" placeholder="${needsNote(g2.reason) ? 'Note (needed)' : 'Note (optional)'}" maxlength="200" value="${esc(g2.note || '')}"${note ? '' : ' hidden'}></div></div>`;
    }

    /* what still needs a reason (or the note a reason like "Other" asks for) */
    function missingOf(w) {
        const bad = (x) => !x.reason || (needsNote(x.reason) && String(x.note || '').trim().length < 3);
        return w.lines.filter(l => l.short > 0 && bad(l)).length + w.stoppages.filter(bad).length;
    }

    function updateFoot() {
        const w = working();
        if (!w || !S.box) return;
        const n = missingOf(w);
        const msg = S.box.querySelector('#dcMissing');
        const btn = S.box.querySelector('[data-save]');
        if (msg) msg.textContent = n ? `${n} reason${n === 1 ? '' : 's'} or note${n === 1 ? '' : 's'} still needed` : 'All reasons given';
        if (btn) btn.disabled = Boolean(n) || S.busy;
    }

    /* the draft with the reasons typed so far (or the previous close's, for a reopened day) */
    function working() {
        const d = S.data;
        if (!d.draft) return null;
        if (!d._work) {
            const prevL = new Map(((d.previous && d.previous.lines) || []).map(l => [Number(l.plan_id), l]));
            const prevS = new Map(((d.previous && d.previous.stoppages) || []).map(s => [String(s.key), s]));
            d._work = {
                lines: d.draft.lines.map(l => ({ ...l, reason: (prevL.get(l.plan_id) || {}).reason || '', note: (prevL.get(l.plan_id) || {}).note || '' })),
                stoppages: d.draft.stoppages.map(s => ({ ...s, reason: (prevS.get(s.key) || {}).reason || '', note: (prevS.get(s.key) || {}).note || '' }))
            };
        }
        return d._work;
    }

    function renderStation() {
        const d = S.data;
        const closed = d.status === 'CLOSED';
        const w = closed ? { lines: d.saved.lines || [], stoppages: d.saved.stoppages || [] } : working();
        const t = closed ? { plan_qty: d.saved.plan_qty, packed: d.saved.packed_qty, short: d.saved.short_qty, lost_min: d.saved.lost_min } : d.draft.totals;
        const missing = closed ? 0 : missingOf(w);
        const status = closed
            ? `<div class="dc-note dc-ok"><i class="bi bi-check-circle"></i> Closed by <b>${esc(d.saved.closed_by || '')}</b> at ${esc(when(d.saved.closed_at))}${d.saved.reopen_count ? ` · reopened ${d.saved.reopen_count}× (last: ${esc(d.saved.last_reopen_reason || '')})` : ''}</div>`
            : (d.status === 'REOPENED' ? `<div class="dc-note dc-warn">Reopened by ${esc(d.saved.reopened_by || '')}: ${esc(d.saved.last_reopen_reason || '')}. Check the reasons and close it again.</div>` : '')
              + (d.before_17 ? '<div class="dc-note dc-warn">It is before 17:00. If you close now, stoppages are counted only up to now.</div>' : '');
        const fillAll = !closed && w.stoppages.length > 1
            ? `<select class="dc-in" style="width:auto" data-fillall="1" aria-label="Set every empty stoppage to"><option value="">Set all empty to…</option>${d.reasons.map(r => `<option>${esc(r.label)}</option>`).join('')}</select>` : '';
        const reopenBox = closed && S.reopen ? `<div class="dc-pin"><input class="dc-in" id="dcPin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Supervisor PIN" aria-label="Supervisor PIN">
            <input class="dc-in" id="dcWhy" maxlength="200" placeholder="Why reopen? (needed)" aria-label="Why reopen">
            <button type="button" class="btn btn-primary" data-doreopen="1">Reopen</button></div>` : '';
        S.box.innerHTML = `<div class="dc-box" role="dialog" aria-modal="true" aria-label="Close day ${esc(d.station)}">
            <div class="dc-top"><h3><i class="bi bi-moon-stars"></i> Close day · ${esc(d.station)}<small>${esc(dayText(d.day))}</small></h3>
                <div style="display:flex;gap:8px">${S.list ? '<button type="button" class="btn btn-outline" data-back="1"><i class="bi bi-arrow-left"></i> All stations</button>' : ''}
                <button type="button" class="dc-x" data-close="1" aria-label="Close"><i class="bi bi-x-lg"></i></button></div></div>
            ${status}
            <div class="dc-sum"><div><small>Plan for the day</small><b>${fmt(t.plan_qty)}</b></div><div><small>Packed</small><b>${fmt(t.packed)}</b></div>
                <div class="${t.short ? 'bad' : ''}"><small>Short</small><b>${fmt(t.short)}</b></div><div class="${t.lost_min ? 'bad' : ''}"><small>Time lost</small><b>${fmt(t.lost_min)} min</b></div></div>
            <div class="dc-h">Plans (${w.lines.length})</div>
            ${w.lines.map((l, i) => lineRow(l, i, closed)).join('') || '<div class="dc-empty">Nothing was planned or packed on this station.</div>'}
            <div class="dc-h"><span>Stoppages over ${fmt(d.idle_min)} min (${w.stoppages.length})</span>${fillAll}</div>
            ${w.stoppages.map((s, i) => stopRow(s, i, closed)).join('') || '<div class="dc-empty">No stoppage. Good scans never stopped for more than ' + fmt(d.idle_min) + ' minutes.</div>'}
            <div class="dc-note">${esc(d.note)}</div>
            ${reopenBox}
            <div class="dc-foot">
                ${closed ? (S.reopen ? '' : '<button type="button" class="btn btn-outline" data-reopen="1"><i class="bi bi-unlock"></i> Reopen (supervisor PIN)</button>') + '<button type="button" class="btn btn-primary" data-close="1">Done</button>'
                    : `<span class="dc-empty" id="dcMissing" style="align-self:center">${missing ? `${missing} reason${missing === 1 ? '' : 's'} or note${missing === 1 ? '' : 's'} still needed` : 'All reasons given'}</span>
                       <button type="button" class="btn btn-outline" data-close="1">Cancel</button>
                       <button type="button" class="btn btn-primary" data-save="1"${missing || S.busy ? ' disabled' : ''}><i class="bi bi-check2"></i> Close day</button>`}
            </div></div>`;
        if (S.reopen) { const p = S.box.querySelector('#dcPin'); if (p) p.focus(); }
    }

    async function save() {
        if (S.busy) return;
        const w = working();
        S.busy = true;
        renderStation();
        try {
            const res = await post('/packing/day-close', {
                station: S.data.station, day: S.data.day,
                lines: w.lines.filter(l => l.short > 0).map(l => ({ plan_id: l.plan_id, reason: l.reason, note: l.note })),
                stoppages: w.stoppages.map(s => ({ key: s.key, reason: s.reason, note: s.note }))
            });
            if (!res || res.ok === false) throw new Error((res && res.error) || 'Could not close the day');
            JPSMS.toast(`${S.data.station} closed for ${S.data.day}`, 'success');
            if (S.onChange) S.onChange();
            S.busy = false;
            if (S.list) { S.station = null; await loadList(); } else await loadStation();
        } catch (e) {
            S.busy = false;
            JPSMS.toast(e.message || 'Could not close the day', 'error');
            /* the scans may have moved on (a stoppage changed); reload the draft but keep the reasons */
            const keep = working();
            try { await loadStation(); } catch (_) { return; }
            const now = working();
            if (now && keep) {
                const L = new Map(keep.lines.map(l => [l.plan_id, l]));
                const G = new Map(keep.stoppages.map(s => [s.key, s]));
                now.lines.forEach(l => { const o = L.get(l.plan_id); if (o) { l.reason = o.reason; l.note = o.note; } });
                now.stoppages.forEach(s => { const o = G.get(s.key); if (o) { s.reason = o.reason; s.note = o.note; } });
                renderStation();
            }
        }
    }

    async function reopen() {
        const pin = (S.box.querySelector('#dcPin') || {}).value || '';
        const why = ((S.box.querySelector('#dcWhy') || {}).value || '').trim();
        if (!pin) return JPSMS.toast('Enter the supervisor PIN', 'error');
        if (why.length < 3) return JPSMS.toast('Write why the day is being reopened', 'error');
        try {
            const res = await post('/packing/day-close/reopen', { station: S.data.station, day: S.data.day, pin, reason: why });
            if (!res || res.ok === false) throw new Error((res && res.error) || 'Could not reopen');
            JPSMS.toast(`${S.data.station} ${S.data.day} reopened`, 'success');
            if (S.onChange) S.onChange();
            await loadStation();
        } catch (e) { JPSMS.toast(e.message || 'Could not reopen', 'error'); }
    }

    function close() {
        if (S.box) S.box.remove();
        S.box = null; S.data = null; S.list = null;
        document.body.classList.remove('dc-open');
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    function wire() {
        S.box.addEventListener('click', async (e) => {
            if (e.target === S.box) return close();
            const el = e.target.closest('button');
            if (!el) return;
            if (el.dataset.close) return close();
            if (el.dataset.st) { S.station = el.dataset.st; try { await loadStation(); } catch (err) { JPSMS.toast(err.message, 'error'); } return; }
            if (el.dataset.back) { S.station = null; S.data = null; try { await loadList(); } catch (err) { JPSMS.toast(err.message, 'error'); } return; }
            if (el.dataset.save) return save();
            if (el.dataset.reopen) { S.reopen = true; return renderStation(); }
            if (el.dataset.doreopen) return reopen();
        });
        S.box.addEventListener('change', (e) => {
            const t = e.target;
            const w = S.data && S.data.draft ? working() : null;
            if (!w) return;
            const focusNote = (sel) => { if (needsNote(t.value)) { const n = S.box.querySelector(sel); if (n) n.focus(); } };
            if (t.dataset.lr !== undefined) { w.lines[Number(t.dataset.lr)].reason = t.value; renderStation(); focusNote(`[data-ln="${t.dataset.lr}"]`); }
            else if (t.dataset.sr !== undefined) { w.stoppages[Number(t.dataset.sr)].reason = t.value; renderStation(); focusNote(`[data-sn="${t.dataset.sr}"]`); }
            else if (t.dataset.fillall) { w.stoppages.forEach(s => { if (!s.reason) s.reason = t.value; }); renderStation(); }
        });
        S.box.addEventListener('input', (e) => {
            const t = e.target;
            const w = S.data && S.data.draft ? working() : null;
            if (!w) return;
            if (t.dataset.ln !== undefined) w.lines[Number(t.dataset.ln)].note = t.value;
            else if (t.dataset.sn !== undefined) w.stoppages[Number(t.dataset.sn)].note = t.value;
            updateFoot();
        });
        S.box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'dcPin') reopen(); });
    }

    async function open(opts = {}) {
        ensureCss();
        close();
        S.day = opts.day || new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
        S.station = opts.station || null;
        S.onChange = opts.onChange || null;
        S.box = document.createElement('div');
        S.box.className = 'dc-back';
        S.box.innerHTML = '<div class="dc-box"><span class="dc-empty">Loading…</span></div>';
        document.body.appendChild(S.box);
        document.body.classList.add('dc-open');
        document.addEventListener('keydown', onKey);
        wire();
        try {
            if (S.station) await loadStation(); else await loadList();
        } catch (e) { JPSMS.toast(e.message || 'Could not load the day', 'error'); close(); }
    }

    async function dayStatus(day) {
        try {
            const res = await api(`/packing/day-close/day?day=${encodeURIComponent(day)}`);
            const out = {};
            ((res && res.data && res.data.stations) || []).forEach(s => { out[s.station.toLowerCase()] = s; });
            return out;
        } catch (_) { return {}; }
    }

    g.PackDayClose = { open, dayStatus };
})(window);
