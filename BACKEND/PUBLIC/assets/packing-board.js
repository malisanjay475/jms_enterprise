/*
 * Packing plan board (assembly.html): the day's jobs by station or by table, and the job
 * cards waiting to be planned. The plan form lives in assembly.html and calls in here:
 *   PackBoard.load(quiet)      read the day again and redraw
 *   PackBoard.data()           last /packing/board answer
 *   PackBoard.rows()           stations (and old tables with a job) as [{ id, label, sub, raw }]
 *   PackBoard.tables(station)  active table codes of a station
 *   PackBoard.times(plan)      { start, end, off } inside the shift
 *   PackBoard.state(plan)      where the plan stands
 * Needs JPSMS (app.js), PackShift, PackCrew, PackDayClose and the form's openPlanModal/editPlan.
 */
(function (g) {
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
    const low = (v) => String(v ?? '').trim().toLowerCase();
    const hhmm = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayStr = () => isoDay(new Date());
    const dayDate = (s) => new Date(s + 'T00:00:00');
    const SPAN = PackShift.MIN_PER_DAY;                 // minutes drawn on the board (09:00 to 17:00)
    const hoursText = (min) => (min >= 60 ? `${fmt(min / 60, 1)} h` : `${Math.max(1, Math.round(min))} min`);
    const tablesOf = (p) => String(p.tables || '').split(',').map(x => x.trim()).filter(Boolean);

    const store = {
        get(k, d) { try { return localStorage.getItem('packboard_' + k) || d; } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('packboard_' + k, v); } catch (_) { /* private window */ } }
    };

    const S = {
        data: null, stations: [], tableRows: [], crew: null, dayState: {}, tick: 0,
        view: store.get('view', 'stations'), assembly: store.get('assembly', ''), busyOnly: store.get('busy', '') === '1',
        lateOnly: false, q: '', sort: store.get('sort', 'due'), dragging: null, loadedAt: null, seq: 0
    };

    /* ---------- plan maths ---------- */

    /* Start and end inside the 09:00-17:00 shift. A plan saved outside it (`off`) is drawn from the
       first working minute, so it stays on the board where someone can see and correct it. */
    function times(p) {
        const raw = new Date(p.start_local || p.start_time);
        if (isNaN(raw)) return { start: null, end: null, off: false, raw: null };
        const work = Math.max(1, (Number(p.duration_min) || 60) + (Number(p.delay_min) || 0));
        if (!PackShift.inShift(raw)) {
            const start = PackShift.snap(raw);
            return { start, end: PackShift.addWork(start, work), off: true, raw };
        }
        /* plans saved before v1.185.0 stored the end in UTC: if it is not after the start, work it out */
        const e = new Date(p.end_local || p.end_time);
        return { start: raw, end: !isNaN(e) && e > raw ? e : PackShift.addWork(raw, work), off: false, raw };
    }

    /* Where a plan stands: done / running / late (behind its own schedule) / planned. */
    function state(p, now = new Date()) {
        const qty = Number(p.plan_qty) || 0, packed = Number(p.scanned_qty) || 0;
        const t = times(p);
        const st = { packed, qty, pct: qty > 0 ? Math.min(100, Math.round(packed * 100 / qty)) : 0, cls: 'planned', note: '', label: 'Planned', expected: 0 };
        const valid = t.start && t.end > t.start;
        if (valid && qty > 0) st.expected = qty * Math.min(1, PackShift.workBetween(t.start, now) / (PackShift.workBetween(t.start, t.end) || 1));
        if (p.status === 'DONE' || (qty > 0 && packed >= qty)) {
            st.cls = 'done'; st.label = p.status === 'DONE' ? 'Done' : 'Qty reached';
            return st;
        }
        let behind = 0;
        if (valid && now > t.start && qty > 0) {
            const perMin = qty / (PackShift.workBetween(t.start, t.end) || 1);
            if (packed < st.expected * 0.9 && perMin > 0) behind = Math.round((st.expected - packed) / perMin);
        }
        if (p.status === 'RUNNING') {
            st.cls = behind >= 10 ? 'late' : 'running';
            st.label = 'Running';
            const left = qty - packed;
            if (p.rate_now > 0) st.eta = PackShift.addWork(now, left / p.rate_now * 60);
            else if (valid) st.eta = t.end;
            st.note = behind >= 10 ? `${hoursText(behind)} behind` : (st.eta ? `ends ${PackShift.whenText(st.eta, now)}` : '');
        } else if (behind >= 10) {
            st.cls = 'late';
            st.label = packed === 0 ? 'Not started' : 'Behind';
            st.note = packed === 0 ? 'not started' : `${hoursText(behind)} behind`;
        }
        return st;
    }

    /* Put overlapping jobs on separate lines: the first line where the job fits. */
    function stack(jobs) {
        const ends = [];
        jobs.sort((a, b) => a.from - b.from || a.to - b.to).forEach(j => {
            let i = ends.findIndex(e => e <= j.from);
            if (i < 0) { i = ends.length; ends.push(0); }
            j.line = i;
            ends[i] = j.to;
        });
        return Math.max(1, ends.length);
    }

    /* ---------- data ---------- */

    const api = (url) => JPSMS.api.request(url, { skipLoader: true, silentError: true });

    async function loadTables() {
        try {
            const res = await api('/packing/tables');
            S.tableRows = (res.data || []).filter(t => t.is_active);
        } catch (_) { S.tableRows = []; }
    }

    const tables = (station) => S.tableRows.filter(t => low(t.station_name) === low(station)).map(t => t.code);

    async function load(quiet) {
        const date = $('viewDate').value || todayStr();
        const seq = ++S.seq;
        let board;
        try {
            const res = await JPSMS.api.request(`/packing/board?date=${encodeURIComponent(date)}`, { skipLoader: true, silentError: true });
            board = res.data;
        } catch (e) {
            if (seq !== S.seq) return;
            setUpdated(true);
            if (!S.data) $('pkBoard').innerHTML = `<div class="pk-blank"><b>Could not load the packing plan</b><span>${esc(e.message || 'The server did not answer.')}</span><button type="button" class="btn btn-outline btn-sm" data-retry="1">Try again</button></div>`;
            else if (!quiet) JPSMS.toast(e.message || 'Could not load the packing plan', 'error');
            return;
        }
        if (seq !== S.seq) return; // a newer day was picked while this one loaded
        S.data = board;
        S.loadedAt = new Date();
        if (!quiet || ++S.tick % 4 === 0 || !S.crew) {
            const [ds, crew] = await Promise.all([
                PackDayClose.dayStatus(board.date).catch(() => ({})),
                board.date === todayStr() ? api('/packing/crew').then(r => (r.data && r.data.stations) || {}).catch(() => ({})) : {}
            ]);
            if (seq !== S.seq) return;
            S.dayState = ds || {};
            S.crew = {};
            Object.entries(crew).forEach(([k, v]) => { S.crew[low(k)] = v.length; });
        }
        render();
    }

    function setUpdated(failed) {
        const el = $('pkUpdated');
        el.classList.toggle('bad', !!failed);
        el.textContent = failed ? 'Not updating. Check the connection.' : (S.loadedAt ? `Updated ${hhmm(S.loadedAt)}` : '');
    }

    /* Stations first, then old table names that still have a job. */
    function rows() {
        const src = S.data && S.data.rows.length ? S.data.rows
            : Array.from({ length: 14 }, (_, i) => ({ name: `Table B${i + 1}`, persons: null, scanner: '', is_station: true }));
        return src.map(r => {
            const st = S.stations.find(s => low(s.name) === low(r.name));
            return { id: r.name, label: (st && st.code) || r.name, sub: r.is_station ? (st && st.code && st.code !== r.name ? r.name : '') : 'Old table', raw: r };
        });
    }

    const plansOf = (station) => S.data.plans.filter(p => low(p.table_id) === low(station));
    const inAssembly = (name) => !S.assembly || low(name) === low(S.assembly);

    /* ---------- drawing ---------- */

    function render() {
        if (!S.data) return;
        /* a saved station that this factory does not have would filter everything away */
        if (S.assembly && !rows().some(r => low(r.id) === low(S.assembly))) S.assembly = '';
        setUpdated(false);
        renderStrip();
        renderNotice();
        renderAssemblies();
        renderBoard();
        renderQueue();
    }

    function renderStrip() {
        const now = new Date();
        const plans = S.data.plans.filter(p => inAssembly(p.table_id));
        const sts = plans.map(p => state(p, now));
        const planned = sts.reduce((t, s) => t + s.qty, 0);
        const packed = sts.reduce((t, s) => t + Math.min(s.packed, s.qty), 0);
        const due = Math.min(planned, Math.round(sts.reduce((t, s) => t + s.expected, 0)));
        const pct = planned ? Math.round(packed * 100 / planned) : 0;
        const duePct = planned ? Math.round(due * 100 / planned) : 0;
        const late = sts.filter(s => s.cls === 'late').length;
        const running = plans.filter(p => p.status === 'RUNNING').length;
        const done = sts.filter(s => s.cls === 'done').length;
        const isToday = S.data.date === todayStr();
        const crew = isToday && S.crew ? (S.assembly ? S.crew[low(S.assembly)] || 0 : Object.values(S.crew).reduce((t, n) => t + n, 0)) : null;
        $('pkStrip').innerHTML = `
            <div class="pk-prog">
                <div class="pk-prog-t"><span><b>${fmt(packed)}</b> of ${fmt(planned)} pcs packed</span><b>${pct}%</b></div>
                <div class="pk-prog-b" role="img" aria-label="${pct}% packed${isToday && planned ? `, ${duePct}% due by now` : ''}"><i style="width:${pct}%"></i>${isToday && planned ? `<em style="left:${duePct}%" title="${fmt(due)} pcs due by now"></em>` : ''}</div>
                <small>${isToday && planned ? `${fmt(due)} pcs due by now` : planned ? '&nbsp;' : 'Nothing planned on this day'}</small>
            </div>
            <div class="pk-fig"><b>${fmt(running)}</b><span>running</span></div>
            <div class="pk-fig"><b>${fmt(plans.length - running - done)}</b><span>still to start</span></div>
            <div class="pk-fig"><b>${fmt(done)}</b><span>done</span></div>
            <button type="button" class="pk-fig pk-fig-btn${late ? ' warn' : ''}" id="pkLate" aria-pressed="${S.lateOnly}" ${late || S.lateOnly ? '' : 'disabled'} title="Show only the jobs that are behind"><b>${fmt(late)}</b><span>behind plan</span></button>
            ${crew === null ? '' : `<button type="button" class="pk-fig pk-fig-btn" id="pkCrewN" title="Open today's crew"><b>${fmt(crew)}</b><span>packers on</span></button>`}
            <button type="button" class="pk-fig pk-fig-btn" id="pkToQueue" title="Go to the waiting job cards"><b>${fmt(S.data.waiting_total ?? S.data.waiting.length)}</b><span>job cards waiting</span></button>`;
    }

    function renderNotice() {
        const off = S.data.plans.filter(p => inAssembly(p.table_id) && times(p).off && p.status !== 'DONE');
        const box = $('pkNotice');
        box.hidden = !off.length;
        if (!off.length) return;
        box.innerHTML = `<i class="bi bi-clock-history" aria-hidden="true"></i><div><b>${off.length === 1 ? '1 job has' : `${off.length} jobs have`} a start time outside ${esc(PackShift.label)}.</b>
            Shown from the start of the shift. Open each one, set the right start and save.<p>${off.slice(0, 6).map(p =>
            `<button type="button" class="pk-link" data-plan="${esc(p.id)}">${esc(p.item_name || 'Plan ' + p.id)} (${hhmm(times(p).raw)})</button>`).join('')}${off.length > 6 ? `<span>and ${off.length - 6} more</span>` : ''}</p></div>`;
    }

    function renderAssemblies() {
        const list = rows();
        const n = (id) => plansOf(id).length;
        $('pkAssembly').innerHTML = `<button type="button" class="pk-chip" data-asm="" aria-pressed="${!S.assembly}">All <small>${fmt(S.data.plans.length)}</small></button>` +
            list.map(r => `<button type="button" class="pk-chip" data-asm="${esc(r.id)}" aria-pressed="${low(S.assembly) === low(r.id)}" title="${esc(r.id)}">${esc(r.label)}${n(r.id) ? ` <small>${n(r.id)}</small>` : ''}</button>`).join('');
        document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
        $('pkBusy').setAttribute('aria-pressed', String(S.busyOnly));
    }

    const pctOf = (d, start) => Math.max(0, Math.min(100, (d - start) / 60000 / SPAN * 100));

    /* One plan as drawn on a lane: { p, s, from, to (0-100), ... }, or null when it is not on this day. */
    function barOf(p, dayStart, dayEnd, now) {
        const t = times(p);
        if (!t.start) return null;
        const s = state(p, now);
        if (S.lateOnly && s.cls !== 'late') return null;
        let start = t.start, end = t.end;
        if (p.status === 'RUNNING' && end < now && S.data.date === todayStr()) end = now; // still going past its end
        if (start >= dayEnd) return null;
        if (end <= dayStart) { if (p.status !== 'RUNNING') return null; end = new Date(+dayStart + 30 * 60000); }
        const from = pctOf(start, dayStart), to = Math.max(pctOf(end, dayStart), from + 0.8);
        return { p, s, t, from: Math.min(from, 99.2), to, cutL: start < dayStart, cutR: end > dayEnd };
    }

    function barHtml(b, opts) {
        const { p, s, t } = b;
        const tb = tablesOf(p);
        const name = p.item_name || 'Plan ' + p.id;
        const icon = { running: 'bi-play-fill', late: 'bi-exclamation-triangle-fill', done: 'bi-check2', planned: '' }[s.cls];
        const qty = `${fmt(s.packed)} / ${fmt(s.qty)}`;
        const when = s.note || (s.cls === 'done' ? s.label.toLowerCase() : `${hhmm(t.start)}–${hhmm(t.end)}`);
        const line2 = opts.table
            ? `${qty}${tb.length > 1 ? ` on ${tb.length} tables` : ''} · ${when}`
            : `${tb.length ? `${tb.length > 3 ? `${tb[0]}–${tb[tb.length - 1]} (${tb.length})` : tb.join(' ')} · ` : ''}${qty} · ${when}`;
        const label = `${name}, ${s.label}, packed ${qty}, ${hhmm(t.start)} to ${hhmm(t.end)}${tb.length ? `, table ${tb.join(', ')}` : ''}`;
        return `<button type="button" class="pk-job ${s.cls}${b.cutL ? ' cutl' : ''}${b.cutR ? ' cutr' : ''}${t.off ? ' off' : ''}${b.out ? ' out' : ''}" data-plan="${esc(p.id)}" aria-label="${esc(label)}"
            style="left:${b.from.toFixed(3)}%;width:${(b.to - b.from).toFixed(3)}%;top:${opts.pad + b.line * opts.h}px;height:${opts.h - 4}px${b.out ? `;--room:${Math.floor(b.out)}px` : ''}">
            <span class="pk-fill" style="width:${s.pct}%"></span>
            <span class="pk-txt"><b>${icon ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ''}${esc(name)}</b><small>${esc(line2)}</small></span></button>`;
    }

    /* Short jobs: write the text to the right of the bar when the line is free there. */
    function placeText(bars, laneW) {
        const px = laneW / 100;
        bars.forEach(b => {
            b.out = 0;
            if ((b.to - b.from) * px >= 118) return;
            const next = bars.filter(x => x.line === b.line && x.from >= b.to).reduce((m, x) => Math.min(m, x.from), 100);
            const room = (next - b.to) * px - 8;
            if (room > 90) b.out = Math.min(room, 260);
        });
    }

    function laneHtml(list, key, opts) {
        const now = new Date();
        const dayStart = new Date(+dayDate(S.data.date) + PackShift.START_H * 36e5), dayEnd = new Date(+dayStart + SPAN * 60000);
        const bars = list.map(p => barOf(p, dayStart, dayEnd, now)).filter(Boolean);
        const lines = stack(bars);
        placeText(bars, opts.laneW);
        const height = Math.max(opts.min, opts.pad * 2 + lines * opts.h - 4);
        return { bars, height, html: `<div class="pk-lane" data-lane="${esc(key)}" style="min-height:${height}px">${bars.map(b => barHtml(b, opts)).join('')}</div>` };
    }

    function dayCloseTag(name) {
        const s = S.dayState[low(name)];
        if (!s || S.data.date > todayStr()) return '';
        if (s.status === 'CLOSED') return `<button type="button" class="pk-tag ok" data-dc="${esc(name)}" title="Closed by ${esc(s.closed_by || '')}"><i class="bi bi-check2" aria-hidden="true"></i>Day closed</button>`;
        if (!s.has_work && s.status !== 'REOPENED') return '';
        const late = S.data.date < todayStr() || new Date().getHours() >= PackShift.END_H;
        return `<button type="button" class="pk-tag${late ? ' warn' : ''}" data-dc="${esc(name)}">${late ? 'Not closed' : 'Close day'}</button>`;
    }

    /* Share of the shift that is planned: table-minutes when the station has tables, else minutes of the line. */
    function stationLoad(r, plans) {
        const dayStart = new Date(+dayDate(S.data.date) + PackShift.START_H * 36e5), dayEnd = new Date(+dayStart + SPAN * 60000);
        const nTables = tables(r.id).length;
        const now = new Date();
        const usedNow = new Set();
        let mins = 0;
        plans.forEach(p => {
            const t = times(p);
            if (!t.start) return;
            const tb = tablesOf(p);
            mins += PackShift.workBetween(new Date(Math.max(t.start, dayStart)), new Date(Math.min(t.end, dayEnd))) * (nTables ? Math.max(1, tb.length) : 1);
            if (p.status !== 'DONE' && t.start <= now && t.end > now) (tb.length ? tb : ['?' + p.id]).forEach(c => usedNow.add(c));
        });
        return { nTables, usedNow: usedNow.size, pct: Math.min(100, Math.round(mins * 100 / (SPAN * Math.max(1, nTables)))) };
    }

    function scannerIcon(cfg, what) {
        return cfg ? `<i class="bi bi-upc-scan pk-on" title="Scanner on ${esc(what)}" aria-label="Scanner set"></i>` : '';
    }

    function stationLabel(r, plans) {
        const load = stationLoad(r, plans);
        const crew = S.data.date === todayStr() && S.crew ? (S.crew[low(r.id)] || 0) : null;
        const std = Number(r.raw.persons) || 0;
        const crewHtml = crew === null || !r.raw.is_station ? (std ? `<span class="pk-crew">${std} packers</span>` : '')
            : `<button type="button" class="pk-crew${crew && std && crew < std ? ' short' : ''}" data-crew="${esc(r.id)}" title="Crew on ${esc(r.id)}${std ? `: standard ${std}` : ''}"><i class="bi bi-people" aria-hidden="true"></i>${crew}${std ? ` of ${std}` : ''}</button>`;
        return `<div class="pk-label">
            <div class="pk-l1"><button type="button" class="pk-name" data-open="${esc(r.id)}" title="See the tables of ${esc(r.id)}">${esc(r.label)}</button>${scannerIcon(r.raw.scanner, r.id)}${crewHtml}<button type="button" class="pk-add" data-add="${esc(r.id)}" aria-label="Plan a job on ${esc(r.label)}" title="Plan a job"><i class="bi bi-plus-lg"></i></button></div>
            <div class="pk-l2">${r.raw.is_station
                ? `<span class="pk-load" title="${load.pct}% of the shift planned"><i style="width:${load.pct}%"></i></span><span>${load.nTables ? `${load.usedNow ? `${load.usedNow}/${load.nTables} busy` : `${load.nTables} tables`}` : `${load.pct}% planned`}</span>`
                : '<span>Old table</span>'}${r.raw.is_station ? dayCloseTag(r.id) : ''}</div></div>`;
    }

    function tableLabel(r, t, bars) {
        const now = new Date(), isToday = S.data.date === todayStr();
        const open = bars.filter(b => b.s.cls !== 'done');
        const busyNow = isToday && open.find(b => b.t.start <= now && (b.t.end > now || b.p.status === 'RUNNING'));
        const lastEnd = open.reduce((m, b) => (b.t.end > m ? b.t.end : m), new Date(0));
        const txt = !open.length ? (bars.length ? 'Free now' : 'Free all day') : busyNow ? `Busy to ${PackShift.whenText(busyNow.t.end > now ? busyNow.t.end : now, dayDate(S.data.date))}`
            : isToday && lastEnd <= now ? `${open.length} job${open.length > 1 ? 's' : ''} not started`
            : `${open.length} job${open.length > 1 ? 's' : ''}, free ${PackShift.whenText(lastEnd, dayDate(S.data.date))}`;
        return `<div class="pk-label tbl"><div class="pk-l1"><button type="button" class="pk-name" data-add="${esc(r.id)}" data-table="${esc(t.code)}" title="Plan a job on table ${esc(t.code)}">${esc(t.code)}</button>${scannerIcon(t.scanner_config, t.code)}<span class="pk-tnote${open.length ? '' : ' free'}">${esc(txt)}</span><button type="button" class="pk-add" data-add="${esc(r.id)}" data-table="${esc(t.code)}" aria-label="Plan a job on table ${esc(t.code)}" title="Plan a job"><i class="bi bi-plus-lg"></i></button></div>${t.label ? `<div class="pk-l2"><span>${esc(t.label)}</span></div>` : ''}</div>`;
    }

    function hoursRow(corner, nowPct) {
        let h = nowPct === null ? '' : `<em style="left:${nowPct}%">${hhmm(new Date())}</em>`;
        for (let i = PackShift.START_H; i < PackShift.END_H; i++) h += `<span>${String(i).padStart(2, '0')}:00</span>`;
        return `<div class="pk-corner">${corner}</div><div class="pk-hours">${h}</div>`;
    }

    function renderBoard() {
        const box = $('pkBoard');
        const focusKey = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.plan : null;
        const list = rows().filter(r => inAssembly(r.id));
        const laneW = Math.max(560, box.clientWidth - (window.matchMedia('(max-width: 768px)').matches ? 118 : 232));
        let html = '', shown = 0;

        if (S.view === 'tables') {
            const opts = { table: true, h: 40, pad: 4, min: 44, laneW };
            list.forEach(r => {
                const plans = plansOf(r.id);
                const master = S.tableRows.filter(t => low(t.station_name) === low(r.id));
                const known = new Set(master.map(t => t.code.toUpperCase()));
                /* tables named on a plan but no longer in the master, and plans with no table at all */
                const extra = [...new Set(plans.flatMap(tablesOf))].filter(c => !known.has(c.toUpperCase())).map(code => ({ code, label: 'Not in the table list' }));
                let body = '', nRows = 0;
                [...master, ...extra].forEach(t => {
                    const lane = laneHtml(plans.filter(p => tablesOf(p).some(c => c.toUpperCase() === t.code.toUpperCase())), r.id + '|' + t.code, opts);
                    if ((S.busyOnly || S.lateOnly) && !lane.bars.length) return;
                    nRows++;
                    body += `<div class="pk-row">${tableLabel(r, t, lane.bars)}${lane.html}</div>`;
                });
                const loose = plans.filter(p => !tablesOf(p).length);
                const looseLane = laneHtml(loose, r.id + '|', opts);
                if (looseLane.bars.length) {
                    nRows++;
                    body += `<div class="pk-row"><div class="pk-label tbl"><div class="pk-l1"><span class="pk-name plain">No table set</span></div></div>${looseLane.html}</div>`;
                }
                if (!nRows && (S.busyOnly || S.lateOnly)) return;
                shown += nRows || 1;
                const load = stationLoad(r, plans);
                html += `<div class="pk-group"><div><button type="button" class="pk-name" data-asm="${esc(r.id)}">${esc(r.label)}</button>${r.sub ? `<span>${esc(r.sub)}</span>` : ''}</div>
                    <div><span>${load.nTables ? `${load.usedNow} of ${load.nTables} tables busy now · ${load.pct}% of the shift planned` : `${plans.length} jobs`}</span>${r.raw.is_station ? dayCloseTag(r.id) : ''}</div></div>` +
                    (body || `<div class="pk-blank in"><span>No tables set up for this station. Add them in <a href="packing_settings.html">Packing Settings</a>.</span></div>`);
            });
        } else {
            const opts = { table: false, h: 46, pad: 6, min: 62, laneW };
            list.forEach(r => {
                const plans = plansOf(r.id);
                const lane = laneHtml(plans, r.id, opts);
                if ((S.busyOnly || S.lateOnly) && !lane.bars.length) return;
                shown++;
                html += `<div class="pk-row">${stationLabel(r, plans)}${lane.html}</div>`;
            });
        }

        if (!shown) {
            html += `<div class="pk-blank"><b>${S.lateOnly ? 'No job is behind plan' : 'No jobs here on this day'}</b><span>${S.lateOnly ? '' : 'Pick a job card from the waiting list, or use Plan job.'}</span>${S.lateOnly || S.busyOnly ? '<button type="button" class="btn btn-outline btn-sm" data-showall="1">Show all</button>' : ''}</div>`;
        }

        const now = new Date();
        const dayStart = new Date(+dayDate(S.data.date) + PackShift.START_H * 36e5);
        const showNow = S.data.date === todayStr() && now >= dayStart && now < new Date(+dayStart + SPAN * 60000);
        const keep = { x: box.scrollLeft, y: box.scrollTop };
        box.innerHTML = `<div class="pk-grid ${S.view}"><div class="pk-row head">${hoursRow(S.view === 'tables' ? 'Table' : 'Station', showNow && shown ? pctOf(now, dayStart) : null)}</div>${html}
            <div class="pk-over" aria-hidden="true">${showNow && shown ? `<div class="pk-now" style="left:${pctOf(now, dayStart)}%"></div>` : ''}<div class="pk-ghost" hidden><span></span></div></div></div>`;
        box.scrollLeft = keep.x; box.scrollTop = keep.y;
        hideTip();
        if (focusKey) { const el = box.querySelector(`.pk-job[data-plan="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
    }

    /* ---------- waiting job cards ---------- */

    function queueList() {
        const q = low(S.q);
        const byStation = (j) => !S.assembly || (j.stations || []).some(s => low(s.station) === low(S.assembly));
        const list = (S.data.waiting || []).filter(j => byStation(j) &&
            (!q || [j.item_name, j.item_code, j.job_card_no, j.or_jr_no, j.client_name].some(v => low(v).includes(q))));
        const far = '9999-99-99';
        const cmp = {
            due: (a, b) => (a.due_date || far).localeCompare(b.due_date || far) || (a.jr_date || far).localeCompare(b.jr_date || far),
            oldest: (a, b) => (a.jr_date || far).localeCompare(b.jr_date || far),
            newest: (a, b) => (b.jr_date || '').localeCompare(a.jr_date || ''),
            qty: (a, b) => b.balance_qty - a.balance_qty
        }[S.sort] || (() => 0);
        return list.sort((a, b) => cmp(a, b) || String(a.job_card_no).localeCompare(String(b.job_card_no)));
    }

    const shortDay = (s) => dayDate(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

    function renderQueue() {
        const box = $('pkQueue');
        const total = S.data.waiting_total ?? S.data.waiting.length;
        const list = queueList();
        const loaded = S.data.waiting.length;
        $('pkQueueN').textContent = list.length === total ? fmt(total) : `${fmt(list.length)} of ${fmt(total)}`;
        const more = total > loaded ? `<p class="pk-qnote">Showing the newest ${fmt(loaded)} of ${fmt(total)}. Type a job card number in Plan job for an older one.</p>` : '';
        if (!list.length) {
            box.innerHTML = `<div class="pk-blank in"><b>${loaded ? 'No job card matches' : 'Nothing is waiting'}</b><span>${loaded
                ? (S.assembly ? 'Try All assemblies, or clear the search.' : 'Clear the search to see them all.')
                : 'Every job card of the last 45 days with a packing standard is planned.'}</span></div>` + more;
            return;
        }
        const today = todayStr();
        const codeOf = (name) => { const r = S.stations.find(s => low(s.name) === low(name)); return (r && r.code) || name; };
        box.innerHTML = list.map(j => {
            const st = (j.stations || []).find(s => S.assembly && low(s.station) === low(S.assembly)) || (j.stations || [])[0];
            const mins = st && st.cycle > 0 ? j.balance_qty * st.cycle / 60 : 0;
            const overdue = j.due_date && j.due_date < today;
            const part = j.planned_qty > 0;
            const tip = [j.item_name, j.client_name, `${j.job_card_no}${j.or_jr_no ? ' · ' + j.or_jr_no : ''}`, `JR qty ${fmt(j.jr_qty)}${part ? `, planned ${fmt(j.planned_qty)}, left ${fmt(j.balance_qty)}` : ''}`,
                j.jr_date ? `JR date ${shortDay(j.jr_date)}` : '', ...(j.stations || []).map(s => `${codeOf(s.station)}: ${fmt(s.cycle, 2)} s/pc, ${s.persons || '?'} packers${s.own ? '' : ' (other party\'s standard)'}`)].filter(Boolean).join('\n');
            return `<div role="button" tabindex="0" class="pk-card" draggable="true" data-jc="${esc(j.job_card_no)}" title="${esc(tip)}">
                <span class="pk-c1"><b>${esc(j.item_name || j.item_code)}</b><em>${fmt(j.balance_qty)}<small> pcs</small></em></span>
                <span class="pk-c2"><span>${esc(j.job_card_no)} · ${esc(j.client_name || 'No party')}</span>${j.due_date ? `<span class="pk-due${overdue ? ' bad' : ''}">${overdue ? 'Overdue ' : 'Pack by '}${shortDay(j.due_date)}</span>` : ''}</span>
                <span class="pk-c3">${st ? `<i class="pk-st">${esc(codeOf(st.station))}</i>` : ''}${mins ? `<span title="One table, at the packing standard">${hoursText(mins)} on 1 table</span>` : ''}${part ? `<span class="pk-part">${fmt(j.planned_qty)} of ${fmt(j.jr_qty)} planned</span>` : ''}</span></div>`;
        }).join('') + more;
    }

    /* ---------- job details on hover / focus ---------- */

    function showTip(el) {
        const p = S.data.plans.find(x => String(x.id) === el.dataset.plan);
        if (!p) return;
        const s = state(p), t = times(p), tip = $('pkTip');
        const line = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
        const day = dayDate(S.data.date);
        tip.innerHTML = `<b>${esc(p.item_name || 'Plan ' + p.id)}</b><dl>
            ${line('Status', `<span class="pk-dot ${s.cls}"></span>${esc(s.label)}${s.note && s.note !== 'not started' ? ', ' + esc(s.note) : ''}`)}
            ${line('Packed', `${fmt(s.packed)} of ${fmt(s.qty)} (${s.pct}%)`)}
            ${line('Time', `${PackShift.whenText(t.start, day)} – ${PackShift.whenText(t.end, day)}${t.off ? ` <span class="pk-due bad">saved as ${hhmm(t.raw)}</span>` : ''}`)}
            ${line('Tables', esc(tablesOf(p).join(', ')))}
            ${line('Speed', p.status === 'RUNNING' ? `${fmt(p.rate_now)} pcs/hr${p.std_pcs_hr ? `, standard ${fmt(p.std_pcs_hr)} a table` : ''}` : '')}
            ${line('Party', esc(p.client_name))}${line('Job card', esc(p.job_card_no))}${line('Note', esc(p.machine))}</dl>`;
        tip.hidden = false;
        const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
        tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
        tip.style.top = `${r.bottom + h + 14 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    }
    function hideTip() { const t = $('pkTip'); if (t) t.hidden = true; }

    /* ---------- pointer: time under the cursor, click and drop on a lane ---------- */

    function timeAt(lane, clientX) {
        const r = lane.getBoundingClientRect();
        const m = Math.max(0, Math.min(SPAN - 5, Math.round((clientX - r.left) / r.width * SPAN / 5) * 5));
        const abs = PackShift.START_H * 60 + m;
        return { pct: m / SPAN * 100, text: `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}` };
    }
    function ghost(at) {
        const el = $('pkBoard').querySelector('.pk-ghost');
        if (!el) return;
        el.hidden = !at;
        if (at) { el.style.left = at.pct + '%'; el.firstElementChild.textContent = at.text; }
    }
    function planOn(key, opts) {
        const [station, table] = String(key).split('|');
        openPlanModal(station, { ...opts, table: table || undefined });
    }

    function markTargets(j) {
        const names = (j && j.stations || []).map(s => low(s.station));
        $('pkBoard').querySelectorAll('.pk-lane').forEach(l => l.classList.toggle('fits', names.includes(low(l.dataset.lane.split('|')[0]))));
    }

    function setAssembly(v) { S.assembly = v; store.set('assembly', v); render(); }
    function setView(v) { S.view = v; store.set('view', v); $('pkBoard').scrollTop = 0; render(); }

    function setDay(d) {
        $('viewDate').value = d;
        paintDay();
        load();
    }
    function paintDay() {
        const v = $('viewDate').value || todayStr();
        $('pkDayText').textContent = dayDate(v).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
        $('pkToday').hidden = v === todayStr();
    }
    function step(n) { const d = dayDate($('viewDate').value || todayStr()); d.setDate(d.getDate() + n); setDay(isoDay(d)); }

    function openDayClose(station) {
        PackDayClose.open({ day: (S.data && S.data.date) || $('viewDate').value || todayStr(), station, onChange: () => load() });
    }
    function openCrew(station) { PackCrew.open({ station, onChange: () => load() }); }

    const dialogOpen = () => $('planModal').style.display === 'flex' || document.querySelector('.pc-back, .dc-back');

    function wire() {
        const board = $('pkBoard');
        $('viewDate').addEventListener('change', () => { if (!$('viewDate').value) $('viewDate').value = todayStr(); setDay($('viewDate').value); });
        $('pkDay').addEventListener('click', () => { try { $('viewDate').showPicker(); } catch (_) { $('viewDate').focus(); } });
        $('pkPrev').onclick = () => step(-1);
        $('pkNext').onclick = () => step(1);
        $('pkToday').onclick = () => setDay(todayStr());
        $('pkRefresh').onclick = () => load();
        $('pkCrew').onclick = () => openCrew();
        $('pkClose').onclick = () => openDayClose();
        $('pkNew').onclick = () => openPlanModal(S.assembly || undefined);
        $('pkBusy').onclick = () => { S.busyOnly = !S.busyOnly; store.set('busy', S.busyOnly ? '1' : ''); render(); };
        document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => setView(b.dataset.view); });
        $('pkAssembly').addEventListener('click', e => { const b = e.target.closest('[data-asm]'); if (b) setAssembly(b.dataset.asm); });
        $('pkStrip').addEventListener('click', e => {
            if (e.target.closest('#pkLate')) { S.lateOnly = !S.lateOnly; render(); }
            else if (e.target.closest('#pkCrewN')) openCrew();
            else if (e.target.closest('#pkToQueue')) { $('pkSide').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('pkQ').focus({ preventScroll: true }); }
        });
        const edit = (id) => { const p = S.data && S.data.plans.find(x => String(x.id) === String(id)); if (p) editPlan(p); };
        $('pkNotice').addEventListener('click', e => { const b = e.target.closest('[data-plan]'); if (b) edit(b.dataset.plan); });

        board.addEventListener('click', e => {
            const hit = (sel) => e.target.closest(sel);
            let el;
            if ((el = hit('.pk-job'))) return edit(el.dataset.plan);
            if ((el = hit('[data-dc]'))) return openDayClose(el.dataset.dc);
            if ((el = hit('[data-crew]'))) return openCrew(el.dataset.crew);
            if ((el = hit('[data-add]'))) return openPlanModal(el.dataset.add, { table: el.dataset.table });
            if ((el = hit('[data-open]'))) { S.view = 'tables'; store.set('view', 'tables'); return setAssembly(el.dataset.open); }
            if ((el = hit('[data-asm]'))) return setAssembly(el.dataset.asm);
            if (hit('[data-retry]')) return load();
            if (hit('[data-showall]')) { S.lateOnly = false; S.busyOnly = false; store.set('busy', ''); return render(); }
            if ((el = hit('.pk-lane'))) planOn(el.dataset.lane, { time: timeAt(el, e.clientX).text });
        });
        board.addEventListener('mousemove', e => {
            const lane = e.target.closest('.pk-lane');
            ghost(lane && !e.target.closest('.pk-job') ? timeAt(lane, e.clientX) : null);
        });
        board.addEventListener('mouseleave', () => ghost(null));
        board.addEventListener('mouseover', e => { const j = e.target.closest('.pk-job'); if (j) showTip(j); else hideTip(); });
        board.addEventListener('focusin', e => { const j = e.target.closest('.pk-job'); if (j && j.matches(':focus-visible')) showTip(j); });
        board.addEventListener('focusout', hideTip);
        board.addEventListener('mouseleave', hideTip);
        board.addEventListener('scroll', hideTip, { passive: true });
        board.addEventListener('dragover', e => {
            const lane = e.target.closest('.pk-lane');
            board.querySelectorAll('.pk-lane.drop').forEach(l => { if (l !== lane) l.classList.remove('drop'); });
            if (!lane || !S.dragging) return ghost(null);
            e.preventDefault();
            lane.classList.add('drop');
            ghost(timeAt(lane, e.clientX));
        });
        board.addEventListener('dragleave', e => { if (!board.contains(e.relatedTarget)) { ghost(null); board.querySelectorAll('.drop').forEach(l => l.classList.remove('drop')); } });
        board.addEventListener('drop', e => {
            const lane = e.target.closest('.pk-lane');
            const jc = S.dragging;
            if (!lane || !jc) return;
            e.preventDefault();
            lane.classList.remove('drop');
            ghost(null);
            planOn(lane.dataset.lane, { jc, time: timeAt(lane, e.clientX).text });
        });

        const queue = $('pkQueue');
        queue.addEventListener('click', e => { const c = e.target.closest('[data-jc]'); if (c) openPlanModal(null, { jc: c.dataset.jc, station: S.assembly || undefined }); });
        queue.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-jc]')) { e.preventDefault(); e.target.click(); } });
        queue.addEventListener('dragstart', e => {
            const c = e.target.closest('[data-jc]');
            if (!c) return;
            S.dragging = c.dataset.jc;
            e.dataTransfer.setData('text/plain', c.dataset.jc);
            e.dataTransfer.effectAllowed = 'copy';
            document.body.classList.add('pk-dragging');
            markTargets(S.data.waiting.find(j => j.job_card_no === c.dataset.jc));
        });
        queue.addEventListener('dragend', () => {
            S.dragging = null;
            document.body.classList.remove('pk-dragging');
            ghost(null);
            markTargets(null);
            board.querySelectorAll('.drop').forEach(l => l.classList.remove('drop'));
        });
        $('pkQ').addEventListener('input', () => { S.q = $('pkQ').value; if (S.data) renderQueue(); });
        $('pkSort').value = S.sort;
        $('pkSort').onchange = () => { S.sort = $('pkSort').value; store.set('sort', S.sort); if (S.data) renderQueue(); };

        let rz;
        addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.data) renderBoard(); }, 150); });
        addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
        document.addEventListener('visibilitychange', () => { if (!document.hidden && S.data && !dialogOpen() && !S.dragging) load(true); });
        setInterval(() => { if (!document.hidden && !dialogOpen() && !S.dragging) load(true); }, 30000);
    }

    async function start() {
        $('viewDate').value = todayStr();
        paintDay();
        wire();
        const st = JPSMS.api.request('/packing/stations', { skipLoader: true, silentError: true })
            .then(r => { S.stations = (r.data || []).filter(s => s.is_active); }).catch(() => { S.stations = []; });
        await Promise.all([st, loadTables()]);
        await load();
    }

    g.PackBoard = {
        start, load, rows, times, state, tables, loadTables,
        data: () => S.data,
        date: () => $('viewDate').value || todayStr(),
        today: todayStr,
        station: (name) => S.stations.find(s => low(s.name) === low(name)) || null,
        allTables: () => S.tableRows
    };
})(window);
