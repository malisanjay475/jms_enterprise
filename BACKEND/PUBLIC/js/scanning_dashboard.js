/*
 * Scanning Dashboard (scanning_dashboard.html): one card per running packing job, live.
 * Counts and times come from the server (/api/packing/scan-stats); scans arrive over
 * /api/assembly/events and are added between refreshes.
 */
(function () {
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (n) => Number(n || 0).toLocaleString('en-IN');
    const shortName = (n) => String(n || '').replace(/^Assembly Station\s*-\s*/i, '');
    const isRunning = (p) => String(p.status || '').toUpperCase() === 'RUNNING';
    const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const api = (path) => JPSMS.api.request(path, { skipLoader: true });
    const store = {
        get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private window */ } }
    };

    const REFRESH_MS = 20000, SLOW_SEC = 300, STOP_SEC = 900, STALE_MS = 70000;
    const STATUS = { running: 'Running', slow: 'Slow', stopped: 'Stopped', waiting: 'Not started', done: 'Done' };
    const D = {
        plans: new Map(),     // id -> { p, last, mins: Map(minute -> n), el }
        totals: { today: 0, hour: 0, wrong_hour: 0 }, trend: 0,
        status: 'all', station: store.get('JPSMS_SCAN_FILTER', ''), sound: store.get('JPSMS_DASH_SOUND', '1') === '1',
        open: null, openFrom: null, sse: null, sseUp: false, loadedAt: 0, first: true
    };
    const minute = () => Math.floor(Date.now() / 60000);

    document.addEventListener('DOMContentLoaded', () => {
        /* a wall TV may have no login: the dashboard still opens there, without the menu */
        let user = {};
        try { user = JSON.parse(localStorage.getItem('user') || '{}') || {}; } catch (_) { /* no login */ }
        if (user.username) { JPSMS.auth.requireAuth(); JPSMS.renderShell('packing'); }
        else document.body.classList.add('db-nologin');
        wire();
        clock();
        setInterval(() => { clock(); D.plans.forEach(paintLive); paintKpis(); }, 1000);
        load();
        setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
        listen();
    });

    const clock = () => { $('dbClock').textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); };

    /* ---------- controls ---------- */

    function wire() {
        $('dbRefresh').addEventListener('click', async () => { if (await load()) JPSMS.toast('Refreshed', 'success'); });
        $('dbStatus').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { D.status = b.dataset.s; filter(); } });
        $('scAssembly').addEventListener('click', e => {
            const b = e.target.closest('[data-st]');
            if (b) { D.station = b.dataset.st; store.set('JPSMS_SCAN_FILTER', D.station); filter(); }
        });
        $('dbGrid').addEventListener('click', e => { const c = e.target.closest('.db-card'); if (c) openDetail(c.dataset.id, c); });
        $('dbSound').addEventListener('click', () => {
            D.sound = !D.sound;
            store.set('JPSMS_DASH_SOUND', D.sound ? '1' : '0');
            if (!D.sound && window.speechSynthesis) speechSynthesis.cancel();
            paintSound();
        });
        paintSound();
        $('dbTv').addEventListener('click', tv);
        document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) tvOff(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('db-tv') && !$('dbDetail').open) tvOff(); });
        $('dbDetail').addEventListener('click', e => { if (e.target === $('dbDetail') || e.target.closest('[data-close]')) $('dbDetail').close(); });
        $('dbDetail').addEventListener('close', () => { D.open = null; if (D.openFrom && document.contains(D.openFrom)) D.openFrom.focus({ preventScroll: true }); });
    }

    function paintSound() {
        $('dbSound').innerHTML = `<i class="bi bi-volume-${D.sound ? 'up' : 'mute'}"></i>Sound ${D.sound ? 'on' : 'off'}`;
        $('dbSound').setAttribute('aria-pressed', D.sound);
    }

    function tv() {
        if (document.body.classList.contains('db-tv')) return tvOff();
        document.body.classList.add('db-tv');
        $('dbTv').innerHTML = '<i class="bi bi-fullscreen-exit"></i>Exit TV';
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { /* the dark view works without it */ });
        D.plans.forEach(paintSpark);
    }

    function tvOff() {
        document.body.classList.remove('db-tv');
        $('dbTv').innerHTML = '<i class="bi bi-tv"></i>TV mode';
        if (document.fullscreenElement) document.exitFullscreen();
        D.plans.forEach(paintSpark);
    }

    /* ---------- data ---------- */

    async function load() {
        let active;
        try { active = (await api('/assembly/active')).data || []; } catch (e) { paintKpis(); return false; }
        let stats = null;
        try { stats = (await api('/packing/scan-stats')).data; } catch (_) { /* older server: live scans only */ }
        D.loadedAt = Date.now();

        /* every running job; a station with none shows its next planned one */
        const by = new Map();
        active.filter(p => !p.is_table_alias).forEach(p => { if (!by.has(p.table_id)) by.set(p.table_id, []); by.get(p.table_id).push(p); });
        const show = [];
        by.forEach(list => {
            const run = list.filter(isRunning);
            show.push(...(run.length ? run : [list.find(p => !(p.plan_qty > 0 && p.scanned_qty >= p.plan_qty)) || list[0]]));
        });
        show.sort((a, b) => String(a.table_id).localeCompare(String(b.table_id), undefined, { numeric: true }) || a.id - b.id);

        const keep = new Set(show.map(p => String(p.id)));
        for (const [id, c] of D.plans) if (!keep.has(id)) { c.el.remove(); D.plans.delete(id); }
        if (D.first) { $('dbGrid').innerHTML = ''; D.first = false; }
        let prev = null;
        show.forEach(p => {
            const id = String(p.id), s = stats && stats.plans[p.id];
            let c = D.plans.get(id);
            if (!c) { c = { id, p, last: null, mins: new Map(), el: null }; D.plans.set(id, c); }
            c.p = p;
            c.stat = s || null;
            if (s) {
                c.last = s.last_sec === null ? null : Date.now() - s.last_sec * 1000;
                c.mins = new Map(Object.entries(s.per_min).map(([m, n]) => [minute() - Number(m), n]));
            }
            else if (c.last === null && p.scanned_qty > 0 && p.idle_seconds != null) c.last = Date.now() - Number(p.idle_seconds) * 1000; // no figures: time of the last change
            if (!c.el) build(c);
            /* move a card only when its place changed: moving it drops the keyboard focus */
            const next = prev ? prev.nextElementSibling : $('dbGrid').firstElementChild;
            if (next !== c.el) $('dbGrid').insertBefore(c.el, next);
            prev = c.el;
            paintCard(c);
        });
        if (stats) {
            if (D.lastHour !== undefined) D.trend = Math.sign(stats.totals.hour - D.lastHour);
            D.lastHour = stats.totals.hour;
            D.totals = stats.totals;
        }
        paintStations();
        filter();
        if (D.open && !D.plans.has(D.open)) $('dbDetail').close();
        return true;
    }

    function listen() {
        const es = new EventSource('/api/assembly/events');
        D.sse = es;
        es.onopen = () => { D.sseUp = true; paintKpis(); };
        es.onerror = () => {
            D.sseUp = false; paintKpis();
            es.close();
            setTimeout(listen, 4000);
        };
        es.onmessage = (ev) => {
            D.sseUp = true;
            let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
            if (m.type === 'scan') onScan(m.data || {});
            else if (m.type === 'alert') onAlert(m.data || {});
        };
    }

    function onScan(d) {
        const c = D.plans.get(String(d.plan_id));
        if (!d.match) { if (c) pulse(c.el, 'shake', 600); return; }
        D.totals.today++; D.totals.hour++;
        if (!c || d.new_qty == null) { /* a job not on screen yet: look again, at most every 3 s */
            if (!D.soon) D.soon = setTimeout(() => { D.soon = null; load(); }, 3000);
            return;
        }
        const was = Number(c.p.scanned_qty) || 0;
        c.p.scanned_qty = d.new_qty;
        if (d.plan_qty) c.p.plan_qty = d.plan_qty;
        c.last = Date.now();
        c.mins.set(minute(), (c.mins.get(minute()) || 0) + 1);
        paintCard(c);
        pulse(c.el, 'hit', 700);
        if (!calm()) {
            const plus = document.createElement('span');
            plus.className = 'db-plus';
            plus.textContent = '+1';
            c.el.appendChild(plus);
            setTimeout(() => plus.remove(), 1000);
        }
        if (c.p.plan_qty > 0 && was < c.p.plan_qty && d.new_qty >= c.p.plan_qty) celebrate(c);
        filter();
    }

    /* ---------- figures ---------- */

    function statusOf(c) {
        const p = c.p;
        if (p.plan_qty > 0 && p.scanned_qty >= p.plan_qty) return 'done';
        if (c.last === null) return 'waiting';
        const s = (Date.now() - c.last) / 1000;
        return s > STOP_SEC ? 'stopped' : s > SLOW_SEC ? 'slow' : 'running';
    }

    /* pieces per minute over the last 15 minutes, from the first minute that had a scan */
    function rate(c) {
        const now = minute();
        let n = 0, first = null;
        c.mins.forEach((v, m) => { if (now - m < 15) { n += v; if (first === null || m < first) first = m; } });
        return n >= 2 ? n / (now - first + 1) : 0;
    }

    function finish(c) {
        const left = (Number(c.p.plan_qty) || 0) - (Number(c.p.scanned_qty) || 0);
        if (left <= 0) return 'Done';
        const r = rate(c);
        if (!r) return '';
        const mins = left / r;
        if (mins < 1) return 'under 1 min';
        if (mins < 90) return Math.round(mins) + ' min';
        if (mins > 24 * 60) return 'over a day';
        return new Date(Date.now() + mins * 60000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    const at = (s) => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d : null; };
    const hm = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    function planWindow(c) {
        const s = c.stat && at(c.stat.start_local), e = c.stat && at(c.stat.end_local);
        if (!s) return '';
        const day = s.toDateString() === new Date().toDateString() ? '' : s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ';
        return day + hm(s) + (e ? ' to ' + hm(e) : '');
    }

    function pace(c) {
        const p = c.p, qty = Number(p.scanned_qty) || 0, plan = Number(p.plan_qty) || 0;
        if (plan > 0 && qty >= plan) return ['good', 'Complete'];
        const s = c.stat && at(c.stat.start_local);
        if (!s || !p.duration_min || plan <= 0) return ['', ''];
        const gone = (Date.now() - s) / 60000;
        if (gone <= 0) return ['', 'Starts ' + hm(s)];
        const diff = Math.round(qty - Math.min(plan, plan / p.duration_min * gone));
        if (diff >= plan * 0.03) return ['good', num(diff) + ' ahead of plan'];
        if (diff <= -plan * 0.03) return ['bad', num(-diff) + ' behind plan'];
        return ['', 'On plan'];
    }

    function ago(c) {
        if (c.last === null) return 'No scan today';
        const s = Math.max(0, Math.floor((Date.now() - c.last) / 1000));
        if (s < 5) return 'Scan just now';
        if (s < 60) return `Scan ${s} s ago`;
        const m = Math.floor(s / 60);
        return m < 60 ? `Scan ${m} min ago` : `Scan ${Math.floor(m / 60)} h ${m % 60} min ago`;
    }

    /* ---------- cards ---------- */

    function build(c) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'db-card';
        el.dataset.id = c.id;
        el.innerHTML = `
            <span class="db-top"><span class="db-st" data-x="st"></span><span class="db-pill" data-x="pill"></span></span>
            <span class="db-item" data-x="item"></span>
            <span class="db-sub" data-x="sub"></span>
            <span class="db-tabs" data-x="tabs"></span>
            <span class="db-qty"><b data-x="qty"></b><span data-x="of"></span><em data-x="pct"></em></span>
            <span class="sc-bar"><i data-x="bar"></i></span>
            <span class="db-row"><span data-x="ago"></span><span class="db-pace" data-x="pace"></span></span>
            <span class="db-spark" data-x="spark" role="img" aria-label="Scans per minute, last 15 minutes"></span>
            <span class="db-row"><span data-x="rate"></span><span data-x="eta"></span></span>`;
        c.el = el;
        c.x = {};
        el.querySelectorAll('[data-x]').forEach(n => { c.x[n.dataset.x] = n; });
    }

    const text = (el, v) => { if (el.textContent !== String(v)) el.textContent = v; };

    function paintCard(c) {
        const p = c.p, qty = Number(p.scanned_qty) || 0, plan = Number(p.plan_qty) || 0, pct = plan ? Math.round(qty / plan * 100) : 0;
        text(c.x.st, shortName(p.table_id));
        text(c.x.item, p.item_name || 'No item name');
        text(c.x.sub, [p.client_name, p.job_card_no, p.machine, planWindow(c)].filter(Boolean).join(' · '));
        const tabs = String(p.tables || '').split(',').map(x => x.trim()).filter(Boolean);
        c.x.tabs.hidden = !tabs.length;
        c.x.tabs.innerHTML = tabs.map(t => `<b>${esc(t)}</b>`).join('');
        count(c, qty);
        text(c.x.of, `of ${num(plan)}${plan > qty ? `, ${num(plan - qty)} left` : ''}`);
        text(c.x.pct, pct + '%');
        c.x.bar.style.width = Math.min(100, pct) + '%';
        paintLive(c);
        paintSpark(c);
    }

    function count(c, to) {
        const from = c.shown;
        c.shown = to;
        if (from === undefined || from === to || calm()) { text(c.x.qty, num(to)); return; }
        const t0 = performance.now();
        const step = (t) => {
            if (c.shown !== to) return;
            const k = Math.min(1, (t - t0) / 350);
            c.x.qty.textContent = num(Math.round(from + (to - from) * k));
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        setTimeout(() => { if (c.shown === to) c.x.qty.textContent = num(to); }, 400); // hidden tabs get no frames
    }

    function paintLive(c) {
        if (!c.x) return;
        const s = statusOf(c), r = rate(c), f = finish(c), [pc, pt] = pace(c);
        if (c.state !== s) { c.state = s; c.el.dataset.state = s; text(c.x.pill, STATUS[s]); c.refilter = true; }
        text(c.x.ago, ago(c));
        text(c.x.rate, r ? `${r.toFixed(1)} per min` : 'No rate yet');
        text(c.x.eta, !f || f === 'Done' ? '' : /min|day/.test(f) ? `Ends in ${f}` : `Ends at ${f}`);
        text(c.x.pace, pt);
        c.x.pace.className = 'db-pace ' + pc;
        if (D.open === c.id) paintDetail(c);
    }

    function bars(c) {
        const now = minute(), v = [];
        for (let i = 14; i >= 0; i--) v.push(c.mins.get(now - i) || 0);
        return v;
    }

    function paintSpark(c) { if (c.x) spark(c.x.spark, bars(c)); }

    function spark(el, v) {
        const max = Math.max(1, ...v), key = v.join();
        if (el.dataset.key === key) return;
        el.dataset.key = key;
        el.innerHTML = `<svg viewBox="0 0 150 30" preserveAspectRatio="none" aria-hidden="true">${v.map((n, i) => {
            const h = n ? Math.max(3, n / max * 28) : 1.5;
            return `<rect class="${n ? '' : 'z'}" x="${i * 10 + 1}" y="${(30 - h).toFixed(1)}" width="8" height="${h.toFixed(1)}" rx="1"/>`;
        }).join('')}</svg>`;
    }

    function pulse(el, cls, ms) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), ms);
    }

    function celebrate(c) {
        JPSMS.toast(`${shortName(c.p.table_id)}: ${c.p.item_name} is complete`, 'success');
        if (calm()) return;
        const colors = ['#149468', '#0b76a8', '#e09a1a', '#d92d20', '#6b7f3a'];
        for (let i = 0; i < 24; i++) {
            const s = document.createElement('span');
            s.className = 'db-confetti';
            s.style.left = Math.random() * 100 + '%';
            s.style.background = colors[i % colors.length];
            s.style.animationDelay = Math.random() * 0.3 + 's';
            c.el.appendChild(s);
            setTimeout(() => s.remove(), 1900);
        }
    }

    /* ---------- filters and totals ---------- */

    function paintStations() {
        const names = [...new Set([...D.plans.values()].map(c => c.p.table_id))];
        if (D.station && !names.includes(D.station)) D.station = '';
        $('scAssembly').dataset.names = names.join('|');
        $('scAssembly').innerHTML = `<button type="button" class="sc-chip" data-st="">All</button>` + names.map(n => `<button type="button" class="sc-chip" data-st="${esc(n)}">${esc(shortName(n))}</button>`).join('');
    }

    function filter() {
        const list = [...D.plans.values()];
        const inSt = list.filter(c => !D.station || c.p.table_id === D.station);
        let shown = 0;
        list.forEach(c => {
            const hide = !inSt.includes(c) || (D.status !== 'all' && statusOf(c) !== D.status);
            c.el.hidden = hide;
            c.refilter = false;
            if (!hide) shown++;
        });
        $('scAssembly').querySelectorAll('[data-st]').forEach(b => b.setAttribute('aria-pressed', b.dataset.st === D.station));
        const n = (s) => inSt.filter(c => statusOf(c) === s).length;
        const key = JSON.stringify([D.status, inSt.length, Object.keys(STATUS).map(n)]);
        if (D.chipKey !== key) {
            D.chipKey = key;
            const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.s : null;
            $('dbStatus').innerHTML = [['all', 'All', inSt.length], ...Object.entries(STATUS).map(([k, t]) => [k, t, n(k)])]
                .map(([k, t, v]) => `<button type="button" class="sc-chip" data-s="${k}" aria-pressed="${D.status === k}">${t} <small>${v}</small></button>`).join('');
            if (focus) { const b = $('dbStatus').querySelector(`[data-s="${focus}"]`); if (b) b.focus(); }
        }
        const none = $('dbEmpty');
        none.hidden = shown > 0 || D.first;
        none.innerHTML = list.length
            ? '<b>No job matches this filter.</b><span>Pick All to see every station.</span>'
            : '<i class="bi bi-clipboard-check"></i><b>No packing job is planned.</b><span>Plan one on the <a href="assembly.html">Packing Plan</a>.</span>';
        paintKpis();
    }

    function paintKpis() {
        const list = [...D.plans.values()].filter(c => !D.station || c.p.table_id === D.station);
        if ([...D.plans.values()].some(c => c.refilter)) return filter();
        const n = (s) => list.filter(c => statusOf(c) === s).length;
        const done = list.reduce((a, c) => a + (Number(c.p.scanned_qty) || 0), 0), plan = list.reduce((a, c) => a + (Number(c.p.plan_qty) || 0), 0);
        const pct = plan ? Math.round(done / plan * 100) : 0;
        const one = Boolean(D.station);
        const sum = (k) => list.reduce((a, c) => a + (c.stat ? c.stat[k] : 0), 0);
        text($('kPct'), pct + '%');
        $('kBar').style.width = Math.min(100, pct) + '%';
        text($('kDone'), `${num(done)} of ${num(plan)} pcs on these jobs`);
        text($('kRun'), n('running'));
        text($('kRunSub'), `of ${list.length} job${list.length === 1 ? '' : 's'}`);
        text($('kSlow'), n('slow'));
        text($('kStop'), n('stopped'));
        $('kStop').parentNode.classList.toggle('bad', n('stopped') > 0);
        $('kSlow').parentNode.classList.toggle('warn', n('slow') > 0);
        const none = D.loadedAt > 0 && D.lastHour === undefined; // not logged in: no figures
        text($('kToday'), none ? 'No figure' : num(one ? sum('today') : D.totals.today));
        text($('kHour'), none ? 'Log in to see it' : `${num(one ? sum('hour') : D.totals.hour)} in the last hour${D.trend > 0 ? ', rising' : D.trend < 0 ? ', falling' : ''}`);
        const wrong = one ? sum('wrong_hour') : D.totals.wrong_hour;
        text($('kWrong'), none ? 'No figure' : num(wrong));
        $('kWrong').parentNode.classList.toggle('bad', wrong > 0);
        const old = D.loadedAt && Date.now() - D.loadedAt > STALE_MS;
        const b = $('dbStale');
        b.hidden = !(old || (!D.sseUp && D.loadedAt));
        text(b.querySelector('span'), old ? `No connection to the server. Figures are from ${hm(new Date(D.loadedAt))}.` : 'Live feed lost, connecting again. Figures refresh every 20 seconds.');
        $('dbConn').className = 'sc-dot ' + (D.sseUp && !old ? 'on' : 'bad');
        text($('dbConnT'), D.sseUp && !old ? 'Live' : 'Not live');
    }

    /* ---------- detail ---------- */

    function openDetail(id, from) {
        const c = D.plans.get(id);
        if (!c) return;
        D.open = id; D.openFrom = from; D.detKey = '';
        paintDetail(c);
        $('dbDetail').showModal();
    }

    function paintDetail(c) {
        const p = c.p, qty = Number(p.scanned_qty) || 0, plan = Number(p.plan_qty) || 0, r = rate(c), f = finish(c);
        const rows = [
            ['Packed', num(qty)], ['Plan', num(plan)], ['Left', num(Math.max(0, plan - qty))], ['Progress', (plan ? Math.round(qty / plan * 100) : 0) + '%'],
            ['Status', STATUS[statusOf(c)]], ['Last scan', ago(c).replace(/^Scan /, '')], ['Rate', r ? r.toFixed(1) + ' per min' : 'No rate yet'], ['Ends at this rate', f || 'Not known'],
            ['Packed today', c.stat ? num(c.stat.today) : 'Not known'], ['Wrong scans, last hour', c.stat ? num(c.stat.wrong_hour) : 'Not known'], ['Against plan', pace(c)[1] || 'Not known'], ['Planned time', planWindow(c) || 'Not set'],
            ['Tables', String(p.tables || '').split(',').filter(Boolean).join(', ') || 'Not set'], ['Party', p.client_name || 'Not set'], ['Job card', p.job_card_no || 'Not set'], ['EAN', p.ean_number || 'Not set'], ...(p.machine ? [['Note', p.machine]] : [])
        ];
        const v = bars(c), key = JSON.stringify([rows, v]);
        if (D.detKey === key) return;
        D.detKey = key;
        $('dbDetailBody').innerHTML = `<h2>${esc(p.table_id)}</h2><p>${esc(p.item_name || 'No item name')}</p>
            <dl>${rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
            <h3>Scans per minute, last 15 minutes</h3><div class="db-spark big"></div>`;
        spark($('dbDetailBody').querySelector('.db-spark'), v);
    }

    /* ---------- wrong barcode ---------- */

    function onAlert(a) {
        D.totals.wrong_hour++;
        const c = D.plans.get(String(a.plan_id));
        if (c && c.stat) c.stat.wrong_hour++;
        const line = String(a.station || a.table_id || '');
        const station = shortName(a.table && line.endsWith('/' + a.table) ? line.slice(0, -(String(a.table).length + 1)) : line) || 'unknown';
        const where = /^table/i.test(station) ? station : `Assembly ${station}`;
        const box = $('dbAlert');
        box.innerHTML = `<i class="bi bi-exclamation-octagon-fill"></i><h1>Wrong barcode</h1>
            <h2>${esc(where)}${a.table ? `, table ${esc(a.table)}` : ''}</h2>
            <p>Scanned <b>${esc(a.ean || a.scanned_ean || 'not known')}</b></p>
            <p>${a.type === 'UNKNOWN_BARCODE' ? 'No job on this table has this barcode' : `Expected <b>${esc(a.expected || a.expected_ean || 'not known')}</b>`}</p>`;
        box.hidden = false;
        clearTimeout(D.alertT);
        D.alertT = setTimeout(() => { box.hidden = true; }, 4000);
        paintKpis();
        if (!D.sound) return;
        siren();
        /* "B1" is spoken as "B 1" */
        const say = (x) => String(x).replace(/([A-Za-z])(\d)/g, '$1 $2');
        const place = say(where) + (a.table ? `, table ${say(a.table)}` : '');
        speak([[`Wrong barcode scan on ${place}`, 'en-US'], [`${place} par, galat barcode scan hua hai`, 'hi-IN']]);
    }

    function siren() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = D.audio = D.audio || new AC();
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime;
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, t);
            [1200, 600, 1200, 600].forEach((f, i) => osc.frequency.linearRampToValueAtTime(f, t + 0.5 * (i + 1)));
            gain.gain.setValueAtTime(0.5, t);
            gain.gain.linearRampToValueAtTime(0, t + 2);
            osc.start(); osc.stop(t + 2);
        } catch (e) { console.warn('Siren:', e.message); }
    }

    function speak(list) {
        const synth = window.speechSynthesis;
        if (!synth) return;
        if (synth.speaking) synth.cancel();
        const voices = synth.getVoices();
        list.forEach(([t, lang]) => {
            const u = new SpeechSynthesisUtterance(t);
            u.rate = 0.9;
            u.lang = lang;
            const v = lang === 'hi-IN'
                ? voices.find(x => x.name.includes('Google') && x.lang.includes('hi')) || voices.find(x => x.lang.includes('hi'))
                : voices.find(x => x.name.includes('Google US')) || voices.find(x => x.name.includes('Zira')) || voices.find(x => x.lang.includes('en'));
            if (v) u.voice = v;
            synth.speak(u);
        });
    }
})();
