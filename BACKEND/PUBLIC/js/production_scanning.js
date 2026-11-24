/*
 * Production Scanning (scanning.html, cards) and Scanning List (scanning_list.html, rows).
 * One station = one card. Every way to scan stays: COM port or IP scanner through the
 * bridge on this PC, Web Serial, a USB scanner that types, manual input, and the ESP32
 * table scanners that post to the server by themselves.
 *
 * A card is built once and then only patched, so the scan log, a half-typed barcode and
 * the STOP screen survive a refresh or a scanner connecting.
 */
(function (g) {
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (n) => Number(n || 0).toLocaleString('en-IN');
    const shortName = (n) => String(n || '').replace(/^Assembly Station\s*-\s*/i, '');
    const isRunning = (p) => String(p.status || '').toUpperCase() === 'RUNNING';
    const codesOf = (p) => String(p.tables || '').split(',').map(x => x.trim()).filter(Boolean);
    const api = (path, body) => JPSMS.api.request(path, body ? { method: 'POST', body: JSON.stringify(body), skipLoader: true } : { skipLoader: true });

    const LOG_MAX = 40, REFRESH_MS = 30000;
    const S = {
        layout: 'cards', lines: [], stations: new Map(), filter: '', known: [], comPorts: [],
        bridge: null, bridgeOn: false, loaded: false, ips: [], stats: null
    };
    const store = {
        get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private window */ } }
    };
    try { S.ips = JSON.parse(store.get('JPSMS_SAVED_IPS', '[]')) || []; } catch (_) { S.ips = []; }
    S.filter = store.get('JPSMS_SCAN_FILTER', '');

    /* ---------- start ---------- */

    async function start(layout) {
        S.layout = layout;
        JPSMS.auth.requireAuth();
        JPSMS.renderShell('packing');
        $('scRefresh').addEventListener('click', () => load(true));
        $('scStations').addEventListener('click', onClick);
        $('scStations').addEventListener('change', onChange);
        $('scStations').addEventListener('keydown', onKey);
        $('scAssembly').addEventListener('click', e => {
            const b = e.target.closest('[data-st]');
            if (!b) return;
            S.filter = b.dataset.st;
            store.set('JPSMS_SCAN_FILTER', S.filter);
            paint();
        });
        try { S.lines = (await api('/assembly/lines')).data || []; } catch (e) { console.error('Lines:', e); }
        if ('serial' in navigator) {
            const ports = async () => { try { S.known = await navigator.serial.getPorts(); } catch (_) { S.known = []; } S.stations.forEach(paintScanner); };
            navigator.serial.addEventListener('connect', ports);
            navigator.serial.addEventListener('disconnect', ports);
            await ports();
        }
        await load(false);
        connectBridge();
        listenServer();
        setInterval(() => { if (!document.hidden) load(false); }, REFRESH_MS);
        setInterval(() => S.stations.forEach(paintStatus), 5000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
    }

    async function load(byHand) {
        try {
            const res = await api('/assembly/active');
            const plans = (res.data || []).filter(p => !p.is_table_alias);
            const by = new Map();
            plans.forEach(p => { if (!by.has(p.table_id)) by.set(p.table_id, []); by.get(p.table_id).push(p); });
            for (const id of [...S.stations.keys()]) {
                /* keep a station whose scanner is on or that shows STOP, even with no plan left */
                const st = S.stations.get(id);
                if (!by.has(id) && !st.conn && !st.lock) { if (st.el) st.el.remove(); S.stations.delete(id); }
                else if (!by.has(id)) { st.plans = []; st.sel = null; }
            }
            by.forEach((list, id) => {
                let st = S.stations.get(id);
                if (!st) {
                    const line = S.lines.find(l => l.line_id === id);
                    const cfg = String((line && line.scanner_config) || '');
                    st = { id, plans: [], sel: null, log: [], lock: null, conn: null, tableConn: {}, devices: {}, mode: /^IP:/i.test(cfg) ? 'IP' : 'COM', el: null };
                    S.stations.set(id, st);
                }
                st.plans = list;
                if (!list.some(p => String(p.id) === String(st.sel))) st.sel = (list.find(isRunning) || list[0]).id;
            });
            S.loaded = true;
            $('scUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
            $('scUpdated').className = 'sc-upd';
            paint();
            loadStats();
            if (byHand) JPSMS.toast('Refreshed', 'success');
        } catch (e) {
            $('scUpdated').textContent = 'Not updated: ' + (e.message || 'no connection');
            $('scUpdated').className = 'sc-upd bad';
            if (!S.loaded) $('scStations').innerHTML = '<div class="sc-empty"><b>Could not load the plans.</b><span>Check the connection and press Refresh.</span></div>';
        }
    }

    async function loadStats() {
        try { S.stats = (await api('/packing/scan-stats')).data; S.stations.forEach(paintStatus); paintFigures(); } catch (_) { /* figures only */ }
    }

    const planOf = (st) => st.plans.find(p => String(p.id) === String(st.sel)) || null;
    const statOf = (p) => (p && S.stats && S.stats.plans[p.id]) || null;

    /* "Assembly Station - B1/B9" is table B9 of station B1 */
    function stationOfLine(line) {
        const id = String(line || '');
        if (S.stations.has(id)) return { st: S.stations.get(id), table: null };
        const i = id.lastIndexOf('/');
        if (i > 0) {
            const name = id.slice(0, i).toLowerCase();
            for (const st of S.stations.values()) if (st.id.toLowerCase() === name) return { st, table: id.slice(i + 1).toUpperCase() };
        }
        for (const st of S.stations.values()) if (st.id.toLowerCase() === id.toLowerCase()) return { st, table: null };
        return { st: null, table: null };
    }

    /* ---------- page ---------- */

    function paint() {
        const all = [...S.stations.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        if (S.filter && !S.stations.has(S.filter)) S.filter = '';
        $('scAssembly').innerHTML = `<button type="button" class="sc-chip" data-st="" aria-pressed="${!S.filter}">All <small>${all.length}</small></button>` +
            all.map(st => `<button type="button" class="sc-chip" data-st="${esc(st.id)}" aria-pressed="${S.filter === st.id}">${esc(shortName(st.id))}</button>`).join('');
        const box = $('scStations');
        if (!all.length) {
            box.innerHTML = '<div class="sc-empty"><i class="bi bi-clipboard-check"></i><b>No packing job is planned.</b><span>Plan one on the <a href="assembly.html">Packing Plan</a>.</span></div>';
            paintFigures();
            return;
        }
        box.querySelectorAll('.sc-empty, .sc-skel').forEach(x => x.remove());
        let prev = null;
        all.forEach(st => {
            if (!st.el) build(st);
            if (st.el.parentNode !== box || st.el.previousElementSibling !== prev) box.insertBefore(st.el, prev ? prev.nextSibling : box.firstChild);
            prev = st.el;
            st.el.hidden = Boolean(S.filter && S.filter !== st.id);
            paintJob(st); paintScanner(st); paintStatus(st); paintLock(st);
        });
        paintFigures();
    }

    function paintFigures() {
        const all = [...S.stations.values()];
        const on = all.filter(s => s.conn && s.conn.on).length;
        const t = S.stats && S.stats.totals;
        $('scFigures').innerHTML =
            `<span><b>${all.filter(s => s.plans.some(isRunning)).length}</b> of ${all.length} running</span>` +
            (t ? `<span><b>${num(t.today)}</b> packed today</span><span class="${t.wrong_hour ? 'bad' : ''}"><b>${num(t.wrong_hour)}</b> wrong in the last hour</span>` : '') +
            `<span><b>${on}</b> scanner${on === 1 ? '' : 's'} connected here</span>` +
            `<span class="sc-bridge ${S.bridgeOn ? 'on' : ''}"><i class="sc-dot ${S.bridgeOn ? 'on' : ''}"></i>${S.bridgeOn ? 'Bridge running on this PC' : 'No bridge on this PC'}</span>`;
    }

    function build(st) {
        const el = document.createElement('article');
        el.className = 'sc-card';
        el.dataset.station = st.id;
        el.setAttribute('aria-label', st.id);
        el.innerHTML = `
            <header class="sc-top"><div><h2>${esc(shortName(st.id))}</h2><small>${esc(st.id)}</small></div><span class="sc-pill" data-x="pill"></span></header>
            <div class="sc-job" data-x="job"></div>
            <div class="sc-work">
                <label class="sc-input"><span class="sr-only">Scan or type a barcode for ${esc(st.id)}</span><i class="bi bi-upc-scan"></i><input type="text" data-x="scan" placeholder="Scan or type the barcode, then Enter" autocomplete="off" inputmode="numeric"></label>
                <details class="sc-setup" data-x="setup"><summary><i class="sc-dot" data-x="dot"></i><span data-x="scanner"></span><em>Scanner</em></summary><div data-x="controls"></div></details>
                <div class="sc-dev" data-x="dev" hidden></div>
            </div>
            <div class="sc-log" data-x="log" role="log" aria-label="Scans"><p class="info">No scan yet on this screen.</p></div>
            <div class="sc-lock" data-x="lock" role="alertdialog" aria-label="Wrong barcode" hidden></div>`;
        st.el = el;
        st.x = {};
        el.querySelectorAll('[data-x]').forEach(n => { st.x[n.dataset.x] = n; });
    }

    function paintJob(st) {
        const p = planOf(st);
        const box = st.x.job;
        if (!p) { box.innerHTML = '<p class="sc-none">No job is planned now.</p>'; st.jobKey = ''; return; }
        const key = JSON.stringify([st.sel, p.plan_qty, st.plans.map(x => [x.id, x.item_name, x.status, x.tables])]);
        if (st.jobKey !== key) {
            if (box.contains(document.activeElement)) return; // the job list is open: leave it until the next refresh
            st.jobKey = key;
            const tables = codesOf(p);
            box.innerHTML = `
                ${st.plans.length > 1 ? `<label class="sc-pick"><span>Job on this screen</span><select data-x="pick">${st.plans.map(x => `<option value="${esc(x.id)}" ${String(x.id) === String(st.sel) ? 'selected' : ''}>${esc(x.item_name)}${codesOf(x).length ? ` (${esc(codesOf(x).join(' '))})` : ''}${isRunning(x) ? ', running' : ''}</option>`).join('')}</select></label>` : ''}
                <div class="sc-item">${esc(p.item_name || 'No item name')}</div>
                <div class="sc-sub">${esc([p.client_name, p.job_card_no].filter(Boolean).join(' · '))}</div>
                ${tables.length ? `<div class="sc-tables" aria-label="Tables">${tables.map(c => `<b>${esc(c)}</b>`).join('')}</div>` : ''}
                <div class="sc-count"><b data-q="done"></b><span data-q="of"></span><em data-q="pct"></em></div>
                <div class="sc-bar"><i data-q="bar"></i></div>
                <div class="sc-ean ${p.ean_number ? '' : 'bad'}">${p.ean_number ? `EAN <b>${esc(p.ean_number)}</b>` : 'No EAN on this plan, so every scan will be wrong'}</div>`;
        }
        paintQty(st);
    }

    function paintQty(st) {
        const p = planOf(st), q = (k) => st.x.job.querySelector(`[data-q="${k}"]`);
        if (!p || !q('done')) return;
        const done = Number(p.scanned_qty) || 0, plan = Number(p.plan_qty) || 0;
        const pct = plan ? Math.round(done / plan * 100) : 0;
        q('done').textContent = num(done);
        q('of').textContent = `of ${num(plan)}${plan > done ? `, ${num(plan - done)} left` : ''}`;
        q('pct').textContent = pct + '%';
        q('bar').style.width = Math.min(100, pct) + '%';
        st.x.job.classList.toggle('full', plan > 0 && done >= plan);
    }

    const ago = (s) => s < 60 ? `${Math.max(0, Math.round(s))} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;

    function paintStatus(st) {
        if (!st.x) return;
        const p = planOf(st), stat = statOf(p);
        let cls = 'plan', txt = 'Planned';
        if (!p) { cls = 'none'; txt = 'No job'; }
        else if (p.plan_qty > 0 && p.scanned_qty >= p.plan_qty) { cls = 'done'; txt = 'Complete'; }
        else {
            const last = st.lastGood ? (Date.now() - st.lastGood) / 1000 : (stat && stat.last_sec !== null ? stat.last_sec : null);
            if (isRunning(p) && last !== null && last > 600) { cls = 'slow'; txt = 'No scan for ' + ago(last).replace(' ago', ''); }
            else if (isRunning(p) || (last !== null && last <= 600)) { cls = 'run'; txt = 'Running'; }
        }
        st.x.pill.className = 'sc-pill ' + cls;
        st.x.pill.textContent = txt;
        const dev = [
            ...Object.entries(st.tableConn).map(([c, on]) => `<span><i class="sc-dot ${on ? 'on' : 'bad'}"></i>Table ${esc(c)} scanner ${on ? 'on' : 'off'}</span>`),
            ...Object.entries(st.devices).map(([c, at]) => `<span><i class="sc-dot on"></i>Table ${esc(c)} device, ${ago((Date.now() - at) / 1000)}</span>`)
        ];
        st.x.dev.hidden = !dev.length;
        st.x.dev.innerHTML = dev.join('');
    }

    /* ---------- scanner controls ---------- */

    function scannerText(st) {
        const c = st.conn;
        if (c && c.on) return c.persistent ? `Scanner on, ${c.port}` : `Connected, ${c.label || c.port}`;
        if (c) return `Connecting to ${c.label || c.port}`;
        return st.connError || 'No scanner connected here';
    }

    function paintScanner(st) {
        if (!st.x) return;
        const c = st.conn;
        st.x.dot.className = 'sc-dot' + (c && c.on ? ' on' : c ? ' wait' : st.connError ? ' bad' : '');
        st.x.scanner.textContent = scannerText(st);
        const key = JSON.stringify([c && [c.on, c.port, c.type, c.persistent], st.mode, S.comPorts, S.known.length, S.ips, S.bridgeOn]);
        if (st.ctlKey === key) return;
        const box = st.x.controls;
        if (box.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName) && !(c && !c.on) && st.ctlMode === st.mode) return;
        st.ctlKey = key; st.ctlMode = st.mode;
        const n = 'm' + [...S.stations.keys()].indexOf(st.id);
        if (c) {
            box.innerHTML = c.persistent
                ? '<p class="sc-hint">The bridge keeps this scanner connected by itself. Change it in <a href="packing_settings.html">Packing Settings</a>.</p>'
                : '<button type="button" class="btn btn-outline" data-act="disconnect">Disconnect</button>';
            return;
        }
        const com = st.mode === 'COM';
        box.innerHTML = `
            <div class="sc-seg" role="group" aria-label="Connection type"><button type="button" data-act="mode" data-mode="COM" aria-pressed="${com}">COM port</button><button type="button" data-act="mode" data-mode="IP" aria-pressed="${!com}">Network IP</button></div>
            ${com ? `
            <div class="sc-two">
                <label>Port<select data-c="port"><option value="">Pick a port</option>
                    ${S.bridgeOn && S.comPorts.length ? `<optgroup label="Bridge on this PC">${S.comPorts.map(p => `<option value="BRIDGE:${esc(p.path)}">${esc(p.path)}</option>`).join('')}</optgroup>` : ''}
                    ${S.known.length ? `<optgroup label="Web Serial">${S.known.map((p, i) => `<option value="SERIAL:${i}">Web Serial device ${i + 1}</option>`).join('')}</optgroup>` : ''}
                    <option value="NEW_SERIAL">Pair a new Web Serial device</option></select></label>
                <label>Speed<select data-c="baud"><option>9600</option><option>115200</option><option>19200</option><option>38400</option><option>57600</option></select></label>
            </div>` : `
            <label>Scanner IP and port<input type="text" data-c="ip" list="ips-${n}" placeholder="192.168.1.50:9000" autocomplete="off" value="${esc(S.ips[0] || '')}"><datalist id="ips-${n}">${S.ips.map(ip => `<option value="${esc(ip)}">`).join('')}</datalist></label>
            ${S.ips.length ? `<button type="button" class="sc-link" data-act="clear-ips">Clear the ${S.ips.length} saved IP${S.ips.length > 1 ? 's' : ''}</button>` : ''}`}
            ${!S.bridgeOn && !com ? '<p class="sc-hint bad">An IP scanner needs the scanner bridge running on this PC.</p>' : ''}
            <button type="button" class="btn btn-primary" data-act="connect">Connect</button>`;
    }

    function setConn(st, conn, err) {
        st.conn = conn;
        st.connError = err || '';
        paintScanner(st);
        paintFigures();
    }

    function onClick(e) {
        const card = e.target.closest('.sc-card');
        const b = e.target.closest('[data-act]');
        if (!card || !b) return;
        const st = S.stations.get(card.dataset.station);
        if (!st) return;
        const act = b.dataset.act;
        if (act === 'mode') { st.mode = b.dataset.mode; st.ctlKey = null; b.blur(); paintScanner(st); }
        else if (act === 'connect') connect(st);
        else if (act === 'disconnect') disconnect(st);
        else if (act === 'clear-ips') { if (confirm('Clear all saved scanner IPs on this PC?')) { S.ips = []; store.set('JPSMS_SAVED_IPS', '[]'); b.blur(); S.stations.forEach(paintScanner); } }
        else if (act === 'resume') unlock(st);
        else if (act === 'unlock') unlockPin(st);
    }

    function onChange(e) {
        const card = e.target.closest('.sc-card');
        if (card && e.target.matches('[data-x="pick"]')) pickJob(S.stations.get(card.dataset.station), e.target.value, e.target);
    }

    function onKey(e) {
        if (e.key !== 'Enter') return;
        const card = e.target.closest('.sc-card');
        const st = card && S.stations.get(card.dataset.station);
        if (!st) return;
        if (e.target.matches('[data-x="scan"]')) {
            const v = e.target.value.trim();
            e.target.value = '';
            if (v) scan(st, v);
        } else if (e.target.matches('[data-c="ip"]')) connect(st);
        else if (e.target.matches('[data-c="pin"]')) unlockPin(st);
    }

    /* The job picked here becomes the running one, so the dashboard shows the same job. */
    async function pickJob(st, id, sel) {
        const p = st && st.plans.find(x => String(x.id) === String(id));
        if (!p) return;
        const before = st.sel;
        st.sel = p.id;
        st.lastGood = null;
        if (sel) sel.blur();
        try {
            await api('/assembly/activate', { table_id: st.id, plan_id: p.id });
            st.plans.forEach(x => { x.status = String(x.id) === String(p.id) ? 'RUNNING' : (isRunning(x) ? 'PLANNED' : x.status); });
            log(st, `Job changed to ${p.item_name}`, 'info');
        } catch (e) {
            st.sel = before;
            JPSMS.toast('Job not changed: ' + e.message, 'error');
        }
        st.jobKey = null;
        paintJob(st); paintStatus(st);
    }

    /* ---------- connecting a scanner ---------- */

    async function connect(st) {
        const c = (k) => { const n = st.x.controls.querySelector(`[data-c="${k}"]`); return n ? n.value.trim() : ''; };
        if (st.mode === 'IP') {
            const ip = c('ip');
            if (!/^[^:\s]+:\d{1,5}$/.test(ip)) return JPSMS.toast('Type the scanner as IP:PORT, for example 192.168.1.50:9000', 'error');
            if (!S.ips.includes(ip)) { S.ips.push(ip); store.set('JPSMS_SAVED_IPS', JSON.stringify(S.ips)); }
            return openTcp(st, ip);
        }
        const v = c('port'), baud = parseInt(c('baud'), 10) || 9600;
        if (!v) return JPSMS.toast('Pick a port first', 'error');
        if (v === 'NEW_SERIAL') {
            if (!('serial' in navigator)) return JPSMS.toast('This browser has no Web Serial. Use Chrome or Edge, or the bridge.', 'error');
            try {
                const port = await navigator.serial.requestPort();
                S.known = await navigator.serial.getPorts();
                return openSerial(st, port, baud);
            } catch (e) { return log(st, 'Not paired: ' + e.message, 'bad'); }
        }
        if (v.startsWith('SERIAL:')) { const port = S.known[Number(v.slice(7))]; return port && openSerial(st, port, baud); }
        if (v.startsWith('BRIDGE:')) return openCom(st, v.slice(7), baud);
    }

    function openTcp(st, ip) {
        if (!S.bridge) return JPSMS.toast('The scanner bridge is not running on this PC.', 'error');
        const [host, port] = ip.split(':');
        setConn(st, { type: 'tcp', port: ip, on: false });
        S.bridge.send(JSON.stringify({ action: 'open-tcp', host, port: parseInt(port, 10) }));
    }

    function openCom(st, path, baudRate) {
        if (!S.bridge) return JPSMS.toast('The scanner bridge is not running on this PC.', 'error');
        setConn(st, { type: 'bridge', port: path, on: false });
        S.bridge.send(JSON.stringify({ action: 'open', path, baudRate, dataBits: 8, stopBits: 1, parity: 'none' }));
    }

    async function openSerial(st, port, baudRate) {
        try {
            await port.open({ baudRate });
            const dec = new TextDecoderStream();
            const closed = port.readable.pipeTo(dec.writable).catch(() => {});
            const reader = dec.readable.getReader();
            const conn = { type: 'serial', port: 'Serial', label: 'Web Serial', portObj: port, reader, closed, keep: true, on: true };
            setConn(st, conn);
            let buf = '';
            while (conn.keep) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += value || '';
                const parts = buf.split(/[\r\n]+/);
                buf = parts.pop();
                parts.map(x => x.trim()).filter(Boolean).forEach(x => scan(st, x));
            }
        } catch (e) { log(st, 'Scanner: ' + e.message, 'bad'); }
        if (st.conn && st.conn.portObj === port) { setConn(st, null); try { await port.close(); } catch (_) { /* unplugged */ } }
    }

    async function disconnect(st) {
        const c = st.conn;
        if (!c || c.persistent) return;
        if (c.type === 'serial') {
            c.keep = false;
            setConn(st, null);
            try { await c.reader.cancel(); await c.closed; await c.portObj.close(); } catch (_) { /* already closed */ }
        } else {
            if (S.bridge) {
                const [host, port] = String(c.port).split(':');
                S.bridge.send(JSON.stringify(c.type === 'tcp' ? { action: 'close-tcp', host, port: parseInt(port, 10) } : { action: 'close', path: c.port }));
            }
            setConn(st, null);
        }
        log(st, 'Scanner disconnected', 'info');
    }

    /* Scanners set in Packing Settings connect by themselves once the bridge is there. */
    function autoConnect() {
        S.lines.forEach(line => {
            const st = S.stations.get(line.line_id);
            const cfg = String(line.scanner_config || '').trim();
            if (!st || st.conn || !cfg) return;
            const ip = cfg.match(/^(?:IP:)?([^:\s]+\.[^:\s]+:\d+)$/i), com = cfg.match(/^(?:BRIDGE:)?(COM\d+|\/dev\/\S+)$/i);
            if (ip) { st.mode = 'IP'; openTcp(st, ip[1]); }
            else if (com) { st.mode = 'COM'; openCom(st, com[1], 9600); }
        });
    }

    /* ---------- scanner bridge on this PC ---------- */

    function connectBridge() {
        let ws;
        try { ws = new WebSocket('ws://localhost:8999'); } catch (_) { return; }
        ws.onopen = () => { S.bridge = ws; S.bridgeOn = true; S.stations.forEach(paintScanner); paintFigures(); setTimeout(autoConnect, 400); };
        ws.onerror = () => {};
        ws.onclose = () => {
            S.bridge = null; S.bridgeOn = false;
            S.stations.forEach(st => {
                st.tableConn = {};
                if (st.conn && st.conn.type !== 'serial') setConn(st, null, 'Bridge stopped'); else paintScanner(st);
                paintStatus(st);
            });
            paintFigures();
            setTimeout(connectBridge, 10000);
        };
        ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; } bridgeMessage(m); };
    }

    function bridgeMessage(m) {
        const byPort = () => [...S.stations.values()].find(st => st.conn && !st.conn.persistent && st.conn.port === m.path);
        if (m.type === 'ports') { S.comPorts = m.ports || []; S.stations.forEach(paintScanner); }
        else if (m.type === 'status') {
            const st = byPort();
            if (st) { if (m.connected) { st.conn.on = true; setConn(st, st.conn); } else setConn(st, null, 'Scanner disconnected'); }
        } else if (m.type === 'data') {
            const st = byPort();
            if (st) { if (!st.conn.on) { st.conn.on = true; setConn(st, st.conn); } scan(st, String(m.data || '').trim()); }
        } else if (m.type === 'raw') {
            const st = byPort();
            if (st) { st.x.dot.classList.add('blink'); setTimeout(() => st.x.dot.classList.remove('blink'), 200); }
        } else if (m.type === 'scanner-status') {
            const { st, table } = stationOfLine(m.table_id);
            if (!st) return;
            if (table) { st.tableConn[table] = Boolean(m.connected); paintStatus(st); }
            else if (m.connected) setConn(st, { type: 'tcp', port: m.path || 'bridge', persistent: true, on: true });
            else if (st.conn && st.conn.persistent) setConn(st, null, 'Scanner off, the bridge keeps trying');
        } else if (m.type === 'scan-result') {
            /* the bridge already posted this scan: only show it, never post it again */
            const { st, table } = stationOfLine(m.table_id);
            if (st) shown(st, { ok: m.ok, match: m.match, new_qty: m.new_qty, error: m.error, locked: /LOCKED/i.test(m.error || ''), plan_id: m.plan_id }, m.ean, table);
        } else if (m.type === 'error') {
            const text = /121/.test(m.message || '') ? 'Port busy (code 121). Unplug the scanner and plug it in again, or close the other app that uses the port.' : (m.message || 'Scanner error');
            const st = byPort();
            if (st) { setConn(st, null, 'Not connected: ' + text); log(st, text, 'bad'); st.x.setup.open = true; }
            else JPSMS.toast('Scanner bridge: ' + text, 'error');
        }
    }

    /* ---------- live events from the server (ESP32 table scanners, other screens) ---------- */

    function listenServer() {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource('/api/assembly/events'); // reconnects by itself
        es.onmessage = (ev) => {
            let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
            const d = (msg && msg.data) || {};
            const { st } = stationOfLine(d.station || d.table_id);
            if (!st) return;
            const device = d.source === 'device';
            if (device && d.table) st.devices[d.table] = Date.now();
            if (msg.type === 'scan' && d.match) {
                const p = st.plans.find(x => String(x.id) === String(d.plan_id));
                if (p && d.new_qty != null) { p.scanned_qty = d.new_qty; paintQty(st); }
                st.lastGood = Date.now();
                if (device) { log(st, `${d.table ? 'Table ' + d.table + ' · ' : ''}${d.scanned_ean} · ${num(d.new_qty)} of ${num(d.plan_qty)}`, 'ok'); flash(st, 'ok'); }
            } else if (msg.type === 'alert' && device) {
                log(st, `${d.table ? 'Table ' + d.table + ' · ' : ''}${d.ean} · wrong (${d.type === 'UNKNOWN_BARCODE' ? 'not planned on this table' : 'expected ' + (d.expected || '?')})`, 'bad');
                flash(st, 'bad');
            }
            paintStatus(st);
        };
    }

    /* ---------- a scan ---------- */

    async function scan(st, ean) {
        if (!ean) return;
        const p = planOf(st);
        if (!p) return log(st, 'No job is planned, scan not counted', 'bad');
        try {
            shown(st, { plan_id: p.id, ...await api('/assembly/scan', { plan_id: p.id, ean }) }, ean, null);
        } catch (e) { log(st, `${ean} · not saved: ${e.message}`, 'bad'); flash(st, 'bad'); }
    }

    function shown(st, r, ean, table) {
        const where = table ? `Table ${table} · ` : '';
        if (r.ok && r.match) {
            const p = st.plans.find(x => String(x.id) === String(r.plan_id)) || planOf(st);
            if (p && r.new_qty != null) { p.scanned_qty = r.new_qty; paintQty(st); }
            st.lastGood = Date.now();
            log(st, `${where}${ean} · ${num(r.new_qty)}`, 'ok');
            flash(st, 'ok');
            if (st.lock && !st.lock.pin) unlock(st);
            paintStatus(st);
        } else if (r.ok) {
            log(st, `${where}${ean} · wrong barcode`, 'bad');
            stop(st, { ean, expected: (planOf(st) || {}).ean_number, pin: false });
            checkPin(st);
        } else if (r.locked) {
            log(st, `${where}${ean} · station locked, not counted`, 'bad');
            stop(st, { ean: st.lock ? st.lock.ean : '', expected: (planOf(st) || {}).ean_number, pin: true });
        } else {
            log(st, `${where}${ean} · ${r.error || 'not counted'}`, 'bad');
            flash(st, 'bad');
        }
    }

    /* With a supervisor PIN set for the factory, the server has locked the station too. */
    async function checkPin(st) {
        try {
            const res = await api('/packing/station-screen?station=' + encodeURIComponent(st.id));
            if (res.data && res.data.lock && st.lock) { st.lock.pin = true; st.lockKey = null; paintLock(st); }
        } catch (_) { /* Resume stays; a locked station refuses the next scan anyway */ }
    }

    function stop(st, lock) { st.lock = lock; st.lockKey = null; paintLock(st); }

    function paintLock(st) {
        const l = st.lock, box = st.x.lock;
        const key = l ? JSON.stringify(l) : '';
        if (st.lockKey === key) return;
        st.lockKey = key;
        box.hidden = !l;
        st.x.scan.disabled = Boolean(l);
        st.el.classList.toggle('stopped', Boolean(l));
        if (!l) { box.innerHTML = ''; return; }
        box.innerHTML = `
            <h3>${esc(shortName(st.id))}</h3><strong><i class="bi bi-exclamation-octagon-fill"></i>Stop, wrong barcode</strong>
            ${l.ean ? `<p>Scanned <b>${esc(l.ean)}</b></p>` : ''}${l.expected ? `<p>Expected <b>${esc(l.expected)}</b></p>` : ''}
            ${l.pin ? `<label>Supervisor PIN<input type="password" data-c="pin" inputmode="numeric" maxlength="6" autocomplete="off"></label><em data-c="pinerr" role="alert"></em><button type="button" class="btn" data-act="unlock"><i class="bi bi-unlock-fill"></i>Unlock</button>`
                : '<span>Take the wrong piece out.</span><button type="button" class="btn" data-act="resume"><i class="bi bi-unlock-fill"></i>Resume</button>'}`;
        const f = box.querySelector('[data-c="pin"], [data-act="resume"]');
        if (f && !st.el.hidden && (S.filter || S.stations.size === 1)) f.focus();
    }

    function unlock(st) {
        st.lock = null;
        paintLock(st);
        if (!st.el.hidden) st.x.scan.focus({ preventScroll: true });
    }

    async function unlockPin(st) {
        const pin = st.x.lock.querySelector('[data-c="pin"]'), err = st.x.lock.querySelector('[data-c="pinerr"]');
        if (!pin) return;
        if (!/^\d{4,6}$/.test(pin.value.trim())) { err.textContent = 'Enter the 4 to 6 digit PIN.'; return; }
        try {
            const r = await api('/packing/unlock', { station: st.id, pin: pin.value.trim() });
            log(st, 'Unlocked by ' + (r.unlocked_by || 'supervisor'), 'info');
            unlock(st);
        } catch (e) { err.textContent = e.message || 'Wrong PIN.'; pin.value = ''; pin.focus(); }
    }

    function log(st, text, cls) {
        const box = st.x.log;
        if (!st.logged) { box.innerHTML = ''; st.logged = true; }
        const p = document.createElement('p');
        p.className = cls || 'info';
        const t = document.createElement('time');
        t.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
        const b = document.createElement('span');
        b.textContent = text;
        p.append(t, b);
        box.prepend(p);
        while (box.children.length > LOG_MAX) box.lastChild.remove();
    }

    function flash(st, cls) {
        st.el.classList.remove('flash-ok', 'flash-bad');
        void st.el.offsetWidth;
        st.el.classList.add('flash-' + cls);
        setTimeout(() => st.el.classList.remove('flash-' + cls), 500);
    }

    /* Web Serial ports belong to this tab. Bridge scanners stay on after the page closes. */
    g.addEventListener('beforeunload', () => S.stations.forEach(st => { if (st.conn && st.conn.type === 'serial') disconnect(st); }));

    g.PackScan = { start };
})(window);
