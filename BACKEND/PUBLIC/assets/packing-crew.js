/*
 * Packing crew editor (step 10): put packers on stations, move them, take them off.
 * Used by the packing plan board (assembly.html, all stations) and the station screen
 * (scan_station.html, one station). PackCrew.open({ station, onChange }).
 * Needs JPSMS (app.js). Times are today's; a blank time means now.
 */
(function (g) {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const api = (url, opts = {}) => JPSMS.api.request(url, { skipLoader: true, silentError: true, ...opts });
    const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
    const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

    const CSS = `
    .pc-back{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:3000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}
    .pc-box{background:#fff;border-radius:16px;width:min(860px,100%);padding:16px 18px;box-shadow:0 20px 50px rgba(15,23,42,.25)}
    .pc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    .pc-top h3{margin:0;font-size:1.1rem;color:#0f172a}
    .pc-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .pc-tools label{font-size:.8rem;color:#475569;display:flex;gap:6px;align-items:center}
    .pc-tools input[type=time]{min-height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px}
    .pc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
    .pc-st{border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;min-width:0}
    .pc-st.drop{border-color:#2563eb;background:#eff6ff}
    .pc-sh{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px}
    .pc-sh b{color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pc-n{font-size:.75rem;font-weight:700;border-radius:999px;padding:2px 8px;background:#dcfce7;color:#166534;white-space:nowrap}
    .pc-n.short{background:#fef3c7;color:#92400e}
    .pc-chips{display:flex;flex-wrap:wrap;gap:6px}
    .pc-chip{border:1px solid #cbd5e1;background:#f8fafc;border-radius:999px;padding:4px 10px;font-size:.85rem;cursor:pointer;color:#0f172a;min-height:32px}
    .pc-chip:hover,.pc-chip.sel{border-color:#2563eb;background:#eff6ff}
    .pc-chip small{color:#64748b;margin-left:4px}
    .pc-add{border-style:dashed;background:none;color:#2563eb}
    .pc-free{margin-top:14px;border-top:1px solid #e2e8f0;padding-top:10px}
    .pc-free h4{margin:0 0 6px;font-size:.9rem;color:#0f172a}
    .pc-empty{color:#64748b;font-size:.85rem}
    .pc-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:8px 10px;margin-bottom:10px;font-size:.88rem}
    .pc-bar select{min-height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;max-width:100%}
    .pc-log{margin-top:12px;font-size:.8rem;color:#475569;max-height:140px;overflow:auto}
    .pc-log div{padding:2px 0;border-top:1px solid #f1f5f9}
    body.pc-open .mobile-sidebar-fab{visibility:hidden}
    .pc-search{min-height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;width:min(260px,100%)}
    `;

    const S = { box: null, station: null, onChange: null, crew: null, stations: [], pick: null, q: '' };

    function ensureCss() {
        if (document.getElementById('pc-css')) return;
        const st = document.createElement('style');
        st.id = 'pc-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    async function load() {
        const [crew, board] = await Promise.all([api('/packing/crew'), api('/packing/board')]);
        S.crew = crew.data;
        const rows = (board.data && board.data.rows) || [];
        S.stations = rows.filter(r => r.is_station).map(r => ({ name: r.name, persons: r.persons }));
        render();
    }

    function timeVal() {
        const el = S.box && S.box.querySelector('#pcAt');
        return el && el.value ? el.value : undefined;
    }

    async function act(url, body, okText) {
        try {
            const at = timeVal();
            const res = await post(url, at ? { ...body, at } : body);
            if (res && res.ok === false) throw new Error(res.error || 'Could not save');
            if (okText) JPSMS.toast(okText, 'success');
            S.pick = null;
            await load();
            if (S.onChange) S.onChange();
        } catch (e) { JPSMS.toast(e.message || 'Could not save', 'error'); }
    }

    function stationCard(st) {
        const list = (S.crew.stations && S.crew.stations[st.name]) || [];
        const short = st.persons && list.length < st.persons;
        const n = st.persons ? `${list.length} / ${st.persons}` : `${list.length}`;
        const drop = S.pick ? ' drop' : '';
        return `<div class="pc-st${drop}" data-st="${esc(st.name)}">
            <div class="pc-sh"><b title="${esc(st.name)}">${esc(st.name)}</b><span class="pc-n${short ? ' short' : ''}">${n}</span></div>
            <div class="pc-chips">${list.map(w => `<button type="button" class="pc-chip${S.pick && S.pick.id === w.worker_id ? ' sel' : ''}" data-w="${w.worker_id}" data-name="${esc(w.name)}" data-from="${esc(st.name)}" title="On since ${esc(hm(w.since))}">${esc(w.name)}<small>${esc(hm(w.since))}</small></button>`).join('')}
            ${S.pick ? `<button type="button" class="pc-chip pc-add" data-put="${esc(st.name)}">Put ${esc(S.pick.name)} here</button>` : (list.length ? '' : '<span class="pc-empty">No one yet</span>')}</div></div>`;
    }

    function render() {
        const c = S.crew;
        const stations = S.station ? S.stations.filter(s => s.name.toLowerCase() === S.station.toLowerCase()) : S.stations;
        if (S.station && !stations.length) stations.push({ name: S.station, persons: null });
        const q = S.q.toLowerCase();
        const moves = (c.moves || []).filter(m => !S.station || String(m.station).toLowerCase() === S.station.toLowerCase());
        const free = (c.free || []).filter(w => !q || w.name.toLowerCase().includes(q) || String(w.badge_no || '').toLowerCase().includes(q));
        const pickBar = S.pick ? `<div class="pc-bar"><span><b>${esc(S.pick.name)}</b>${S.pick.from ? ` is on ${esc(S.pick.from)}` : ''}. Tap a station to put them there${S.pick.from ? ', or' : '.'}</span>
            ${S.pick.from ? `<button type="button" class="btn btn-outline" data-remove="${S.pick.id}">Take off station</button>` : ''}
            ${S.station ? '' : `<select id="pcTo" aria-label="Station"><option value="">Station…</option>${S.stations.map(s => `<option>${esc(s.name)}</option>`).join('')}</select>`}
            <button type="button" class="btn btn-outline" data-cancel="1">Cancel</button></div>` : '';
        const copy = !S.station && c.last_day && !Object.keys(c.stations || {}).length
            ? `<button type="button" class="btn btn-outline" data-copy="1"><i class="bi bi-arrow-repeat"></i> Same as ${esc(c.last_day.date)} (${c.last_day.packers})</button>` : '';
        S.box.innerHTML = `<div class="pc-box" role="dialog" aria-modal="true" aria-label="Packing crew">
            <div class="pc-top"><h3><i class="bi bi-people"></i> ${S.station ? `Crew · ${esc(S.station)}` : "Today's crew"}</h3>
                <div class="pc-tools">${copy}<label>Time <input type="time" id="pcAt" title="Leave blank for now"></label>
                <button type="button" class="btn btn-outline" data-close="1" aria-label="Close"><i class="bi bi-x-lg"></i></button></div></div>
            ${pickBar}
            ${c.workers ? '' : '<div class="pc-bar">No packers in the list yet. Add them in Packing Masters &gt; Packers.</div>'}
            <div class="pc-grid">${stations.map(stationCard).join('')}</div>
            <div class="pc-free"><h4>Not on a station (${free.length})</h4>
                <input class="pc-search" id="pcQ" placeholder="Search name or badge" value="${esc(S.q)}" aria-label="Search packers">
                <div class="pc-chips" style="margin-top:8px">${free.map(w => `<button type="button" class="pc-chip${S.pick && S.pick.id === w.id ? ' sel' : ''}" data-w="${w.id}" data-name="${esc(w.name)}">${esc(w.name)}${w.badge_no ? `<small>${esc(w.badge_no)}</small>` : ''}</button>`).join('') || '<span class="pc-empty">Everyone is on a station.</span>'}</div></div>
            ${moves.length ? `<div class="pc-log">${moves.slice().reverse().slice(0, 40).map(m => `<div>${esc(hm(m.start_at))}${m.end_at ? `–${esc(hm(m.end_at))}` : ''} · ${esc(m.name)} · ${esc(m.station)}</div>`).join('')}</div>` : ''}
        </div>`;
        const qEl = S.box.querySelector('#pcQ');
        qEl.oninput = () => { S.q = qEl.value; const pos = qEl.selectionStart; render(); const n = S.box.querySelector('#pcQ'); n.focus(); n.setSelectionRange(pos, pos); };
        const to = S.box.querySelector('#pcTo');
        if (to) to.onchange = () => { if (to.value) act('/packing/crew/assign', { worker_id: S.pick.id, station: to.value }, `${S.pick.name} → ${to.value}`); };
    }

    function onClick(e) {
        const t = e.target.closest('button, .pc-st');
        if (!t) { if (e.target === S.box) close(); return; }
        if (t.dataset.close) return close();
        if (t.dataset.cancel) { S.pick = null; return render(); }
        if (t.dataset.copy) return act('/packing/crew/copy-yesterday', {}, 'Crew copied');
        if (t.dataset.remove) return act('/packing/crew/remove', { worker_id: Number(t.dataset.remove) }, `${S.pick.name} taken off`);
        if (t.dataset.put) return act('/packing/crew/assign', { worker_id: S.pick.id, station: t.dataset.put }, `${S.pick.name} → ${t.dataset.put}`);
        if (t.dataset.w) {
            const id = Number(t.dataset.w);
            if (S.pick && S.pick.id === id) { S.pick = null; return render(); }
            S.pick = { id, name: t.dataset.name, from: t.dataset.from || '' };
            /* on one station's screen, tapping a free packer puts them straight on it */
            if (S.station && !S.pick.from) return act('/packing/crew/assign', { worker_id: id, station: S.station }, `${S.pick.name} → ${S.station}`);
            return render();
        }
        if (t.classList.contains('pc-st') && S.pick && t.dataset.st && t.dataset.st !== S.pick.from) {
            return act('/packing/crew/assign', { worker_id: S.pick.id, station: t.dataset.st }, `${S.pick.name} → ${t.dataset.st}`);
        }
    }

    function onKey(e) { if (e.key === 'Escape') close(); }

    function close() {
        if (!S.box) return;
        S.box.remove();
        S.box = null;
        document.body.classList.remove('pc-open');
        document.removeEventListener('keydown', onKey);
    }

    async function open(opts = {}) {
        ensureCss();
        close();
        S.station = opts.station || null;
        S.onChange = opts.onChange || null;
        S.pick = null;
        S.q = '';
        S.box = document.createElement('div');
        S.box.className = 'pc-back';
        S.box.innerHTML = '<div class="pc-box">Loading crew…</div>';
        S.box.addEventListener('click', onClick);
        document.addEventListener('keydown', onKey);
        document.body.appendChild(S.box);
        /* the app's floating menu button sits above any dialog; hide it while the crew is open */
        document.body.classList.add('pc-open');
        try { await load(); } catch (e) {
            S.box.innerHTML = `<div class="pc-box"><p>Couldn't load the crew: ${esc(e.message)}</p><button class="btn btn-outline" data-close="1">Close</button></div>`;
        }
    }

    /* "3 of 4 · Ramesh, Sunita, Anil" for a station screen. */
    async function summary(station) {
        const res = await api('/packing/crew');
        const list = ((res.data && res.data.stations) || {})[station] || [];
        return { n: list.length, names: list.map(w => w.name) };
    }

    g.PackCrew = { open, close, summary };
})(window);
