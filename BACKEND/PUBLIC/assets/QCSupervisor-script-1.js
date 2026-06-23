        'use strict';

        /* ==================== GAS shim (kept for safety) ==================== */
        (function () {
            if (window.google && google.script && google.script.run) return;
            function makeChain(method) {
                const chain = {
                    _ok: null, _err: null,
                    withSuccessHandler(fn) { this._ok = fn; return this; },
                    withFailureHandler(fn) { this._err = fn; return this; }
                };
                chain[method] = (...args) => {
                    console.warn('Apps Script not available. Called:', method, args);
                    setTimeout(() => chain._err && chain._err('Apps Script unavailable'), 0);
                    return chain;
                };
                return chain;
            }
            window.google = window.google || {};
            google.script = google.script || {};
            google.script.run = new Proxy({}, {
                get(_t, prop) {
                    return (..._args) => {
                        const c = makeChain(prop);
                        return c[prop](..._args);
                    };
                }
            });
        })();

        /* ==================== Constants ==================== */
        const HOUR_SLOTS = ['07-08', '08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07'];
        function fillHourSlotSelect(selectId, preselect) {
            const sel = el(selectId);
            if (!sel) return;

            sel.innerHTML = '';
            sel.add(new Option('Select Hour Slot', ''));

            HOUR_SLOTS.forEach(h => {
                sel.add(new Option(h, h));
            });

            if (preselect && HOUR_SLOTS.includes(preselect)) {
                sel.value = preselect;
            }
        }
        const REJECT_REASONS = [
            ['A', 'Short Moulding'], ['B', 'Shrinkage Mark'], ['C', 'Silver Streak/Colour Variation/Trail'],
            ['D', 'Flow Mark/Weld Line'], ['E', 'Fitment Issue'], ['F', 'Dent Mark/Air Bubble'], ['G', 'Warpage'],
            ['H', 'Black/Water Marks'], ['I', 'Startup Pcs/Color Change Pcs'], ['J', 'Bottom bulging issue'],
            ['K', 'Scratch'], ['L', 'Over Lapping'], ['M', 'Punching Hole Issue']
        ];
        const DOWNTIME_REASONS = [
            ['1', 'Manpower Shortage'], ['2', 'Mould Change Over'], ['3', 'Accessories Shortage'], ['4', 'Material Shortage'],
            ['5', 'M/C Under Manintaince (Water/Oil/Air Leakage)'], ['6', 'Nozzle Block/Change'], ['7', 'Mould Problem'],
            ['8', 'Power Failure/Pre Heating'], ['9', 'Color Change Time'], ['10', 'Process Setting'], ['11', 'Mould Trial'], ['12', 'Crane/Hrtc']
        ];

        /* ---------- Geofence (adjust to your site) ---------- */
        const GEOFENCE = { center: { lat: 20.318738, lng: 72.951258 }, radiusMeters: 15000 };

        /* ==================== Helpers ==================== */
        /* DOM CACHE: faster el() lookups */
        const domCache = {};
        function el(id) {
            if (!domCache[id]) {
                domCache[id] = document.getElementById(id);
            }
            return domCache[id];
        }

        // GLOBAL LOADING HANDLER
        let loadingCount = 0;

        function showLoading() {
            loadingCount++;
            const o = el('loading-overlay');
            if (o) o.classList.remove('hidden');
        }

        function hideLoading() {
            loadingCount = Math.max(0, loadingCount - 1);
            if (loadingCount === 0) {
                const o = el('loading-overlay');
                if (o) o.classList.add('hidden');
            }
        }
        const show = id => el(id).classList.remove('hidden');
        const hide = id => el(id).classList.add('hidden');
        function qcScrollRoot() {
            const app = el('view-app');
            if (app && !app.classList.contains('hidden')) return app;
            return el('view-login') || document.scrollingElement || document.documentElement;
        }
        function scrollQcToTop() {
            const root = qcScrollRoot();
            if (root && typeof root.scrollTo === 'function') root.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            else if (root) root.scrollTop = 0;
        }
        const safe = v => (v === null || v === undefined) ? '' : String(v);
        const fmtDT = v => { try { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString(); } catch (_) { return '' } };
        const fmtD = v => { try { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(); } catch (_) { return '' } };
        function distMeters(a, b) { const R = 6371000, toRad = x => x * Math.PI / 180; const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
        function insideGeofence(lat, lng, acc) { if (lat == null || lng == null) return false; const d = distMeters({ lat, lng }, GEOFENCE.center); const margin = Math.max(50, Math.min(400, Number(acc || 0))); return (d - margin) <= GEOFENCE.radiusMeters; }

        /* ==================== Geo handling ==================== */
        let lastGeo = null;
        function currentGeoObj() { return lastGeo ? { lat: lastGeo.lat, lng: lastGeo.lng, accuracy: lastGeo.acc } : null; }

        function updateGeoUI() {
            const debugEl = el('geo-debug');
            const pillEl = el('geo-pill');
            if (!lastGeo) {
                if (debugEl) debugEl.textContent = 'Location: not available. Allow location to continue.';
                if (pillEl) pillEl.textContent = '';
                return;
            }
            const inside = insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc);
            const accTxt = Math.round(lastGeo.acc || 0);
            const txt = (inside ? 'Inside geofence' : 'Outside geofence') + ` • ~${accTxt} m`;
            if (debugEl) debugEl.textContent = txt;
            if (pillEl) pillEl.textContent = txt;
        }

        function startGeoWatch() {
            if (!('geolocation' in navigator)) return;
            try {
                navigator.geolocation.watchPosition(
                    p => {
                        lastGeo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: new Date() };
                        updateGeoUI();
                        validateForm();
                    },
                    _ => {
                        updateGeoUI();
                        validateForm();
                    },
                    { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }
                );
            } catch (_) { }
        }

        async function bestGeoFix(n = 3) {
            if (!('geolocation' in navigator)) throw new Error('GEO_UNSUPPORTED');
            let best = null;
            for (let i = 0; i < n; i++) {
                try {
                    const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, maximumAge: 0, timeout: 9000 }));
                    if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
                    lastGeo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: new Date() };
                    updateGeoUI();
                    if (p.coords.accuracy <= 50) break;
                } catch (e) { }
                await new Promise(r => setTimeout(r, 600));
            }
            if (!best) throw new Error('GEO_DENIED');
            return lastGeo;
        }

        async function recalibrate() {
            const msg = el('login-msg');
            if (msg) msg.textContent = 'Recalibrating location…';
            try {
                await bestGeoFix(4);
                if (lastGeo && insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc)) {
                    msg.innerHTML = '<span class="ok">Location locked. You can login now.</span>';
                } else {
                    msg.innerHTML = '<span class="warn">Location updated but still outside geofence / low accuracy.</span>';
                }
            } catch (e) {
                msg.innerHTML = '<span class="err">Location unavailable. Check GPS & permissions.</span>';
            }
        }

        /* ==================== Session + bootstrap ==================== */
        const session = { username: null, line: null, machine: null, activeJob: null };
        let setupDone = false;
        let jobColorsData = {};   // colour → {plan, bal}
        let usedSlots = [];       // locked hour slots

        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => { const b = document.getElementById('boot'); if (b) b.classList.add('done'); }, 50);

            function realInit() {
                if (location.protocol !== 'https:') { console.warn('Geolocation requires HTTPS on most browsers.'); }
                startGeoWatch();
                updateGeoUI();
                try {
                    const raw = localStorage.getItem('jpsmsSession');
                    if (raw) {
                        const s = JSON.parse(raw);
                        if (s && s.line) {
                            session.username = s.username || '';
                            session.line = s.line;
                            session.machine = s.machine || null;

                            el('line-name').textContent = session.line;
                            showAppView(true);
                            loadMachines();   // will respect session.machine if present & call loadQueue+loadRecent
                            return;
                        }
                    }
                } catch (_) { }
                showAppView(false);
            }

            if (window.requestIdleCallback) {
                requestIdleCallback(realInit);
            } else {
                setTimeout(realInit, 80);
            }
        });

        function showAppView(showing) {
            const login = el('view-login'), app = el('view-app');
            if (showing) { login.classList.add('hidden'); app.classList.remove('hidden'); }
            else { app.classList.add('hidden'); login.classList.remove('hidden'); }
            requestAnimationFrame(scrollQcToTop);
        }

        function showPage(id, btn) {
            document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
            el(id).classList.remove('hidden');
            scrollQcToTop();
            document.querySelectorAll('.tabs button').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
            });
        }

        function isoDate(d) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        }

        function buildDateSelect() {
            const sel = el('d-date'); sel.innerHTML = '';
            const now = new Date(); now.setHours(0, 0, 0, 0);
            const yst = new Date(now); yst.setDate(now.getDate() - 1);
            sel.add(new Option('Today (' + fmtD(now) + ')', isoDate(now)));
            sel.add(new Option('Yesterday (' + fmtD(yst) + ')', isoDate(yst)));
            sel.value = isoDate(now);
        }

        /* ORIGINAL refreshSlots (kept, overridden later) */
        function refreshSlots() {
            const sel = el('d-slot');
            if (!sel) return;
            sel.innerHTML = '';
            HOUR_SLOTS.forEach(s => sel.add(new Option(s, s)));
            if (!sel.value && HOUR_SLOTS.length) sel.value = HOUR_SLOTS[0];
            validateForm();
        }

        function onShiftChange() {
            try {
                const sh = el('d-shift').value || '';
                if (sh) localStorage.setItem('jpsms_last_shift', sh);
            } catch (_) { }

            refreshSlots();
            if (session.activeJob) checkStdStatus();
            validateForm();
        }

        /* ✅ LIVE CAVITY VALIDATION – GLOBAL */
        function validateActCavity() {
            const stdCav = Number(el('std-cavity').value || 0);
            const actCav = Number(el('act-cavity').value || 0);

            if (stdCav > 0 && actCav > stdCav) {
                el('std-msg').innerHTML =
                    '<span class="err">ACT Cavity (' + actCav + ') cannot be more than STD Cavity (' + stdCav + ').</span>';
                el('act-cavity').classList.add('input-error');
            } else {
                el('std-msg').innerHTML = '';
                el('act-cavity').classList.remove('input-error');
            }
        }

        function saveStdActual() {
            const job = session.activeJob;
            if (!job) {
                el('std-msg').textContent = 'No job selected.';
                return;
            }

            const all = job._all || {};
            const orderNo =
                job.OrderNo ||
                all['Order No'] ||
                all['OrderNo'] ||
                all['OR Number'] ||
                all['Order Number'] ||
                '';

            const mouldName =
                job.Mould ||
                all['Mould'] ||
                all['Mould Name'] ||
                all['SFG Name'] ||
                '';

            const payload = {
                PlanID: String(job.PlanID || ''),
                Shift: el('d-shift').value || 'Day',
                DprDate: el('d-date').value || '',
                Machine: job.Machine || session.machine || '',
                OrderNo: orderNo,
                MouldName: mouldName,
                ArticleActual: el('act-article').value,
                RunnerActual: el('act-runner').value,
                CavityActual: el('act-cavity').value,
                CycleActual: el('act-cycle').value,
                PcsHrActual: el('act-pcshr').value,
                ManActual: el('act-man').value,
                EnteredBy: el('act-name').value || session.username || '',
                SfgQtyActual: el('act-sfgqty').value,
                OperatorActivities: el('act-ops').value
            };

            el('std-msg').textContent = 'Saving…';
            showLoading();

            fetch('/api/std-actual/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: { username: session.username, line: session.line },
                    payload,
                    geo: currentGeoObj()
                })
            })
                .then(r => r.json())
                .then(r => {
                    if (r && r.ok) {
                        el('std-msg').innerHTML = '<span class="ok">Saved.</span>';
                        setupDone = true;
                    } else {
                        el('std-msg').innerHTML = '<span class="err">' + ((r && r.error) || 'Failed') + '</span>';
                        setupDone = false;
                    }

                    validateForm();
                    renderColorPlanTable(job);
                })
                .catch(err => {
                    el('std-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
                    setupDone = false;
                    validateForm();
                })
                .finally(() => hideLoading());
        }

        function checkStdStatus() {
            const job = session.activeJob;
            if (!job) return;

            const shift = el('d-shift').value || 'Day';
            const dprDate = el('d-date').value || '';

            const all = job._all || {};
            const orderNo =
                job.OrderNo ||
                all['Order No'] ||
                all['OrderNo'] ||
                all['OR Number'] ||
                all['Order Number'] ||
                '';

            const machine = job.Machine || session.machine || '';

            const ids = [
                'act-article', 'act-runner', 'act-cavity',
                'act-cycle', 'act-pcshr', 'act-man',
                'act-name', 'act-sfgqty', 'act-ops'
            ];

            show('std-actual-card');
            ids.forEach(id => el(id).disabled = true);
            el('std-msg').textContent = 'Checking…';

            showLoading();

            const url = `/api/std-actual/status?planId=${encodeURIComponent(String(job.PlanID || ''))}` +
                `&shift=${encodeURIComponent(String(shift || ''))}` +
                `&date=${encodeURIComponent(String(dprDate || ''))}` +
                `&machine=${encodeURIComponent(String(machine || ''))}`;

            fetch(url)
                .then(r => r.json())
                .then(res => {
                    console.log('std-actual/status raw:', res);
                    ids.forEach(id => el(id).disabled = false);

                    if (!res) {
                        el('std-msg').innerHTML =
                            '<span class="err">EMPTY_RESPONSE_FROM_std-actual/status (raw was null/undefined)</span>';
                        setupDone = false;
                        validateForm();
                        return;
                    }

                    if (res.ok === false) {
                        el('std-msg').innerHTML =
                            '<span class="err">' + (res.error || 'STD status error') + '</span>';
                        setupDone = false;
                        validateForm();
                        return;
                    }

                    const data = res.data || {};
                    if (!data.done) {
                        el('act-article').value = '';
                        el('act-runner').value = '';
                        el('act-cavity').value = '';
                        el('act-cycle').value = '';
                        el('act-pcshr').value = '';
                        el('act-man').value = '';
                        el('act-name').value = session.username || '';
                        el('act-sfgqty').value = '';
                        el('act-ops').value = '';

                        el('std-msg').innerHTML =
                            '<span class="warn">No setup saved — enter ACT values and Save.</span>';
                        setupDone = false;
                        validateForm();
                        return;
                    }

                    const row = data.row || {};

                    const art = row.ArticleACTWeight ?? row.article_act ?? '';
                    const run = row.RunnerACTWeight ?? row.runner_act ?? '';
                    const cav = row.ACTCavity ?? row.cavity_act ?? '';
                    const cyc = row.ACTCycleTime ?? row.cycle_act ?? '';
                    const pcs = row.ACTPCS_HR ?? row.pcshr_act ?? '';
                    const man = row.ACTMANPOWER ?? row.man_act ?? '';
                    const ent = row.EnteredBy ?? row.entered_by ?? session.username ?? '';
                    const sfg = row.SfgQtyActual ?? row.SFGQtyActual ?? row.sfgqty_act ?? '';
                    const ops = row.OperatorActivities ?? row.operator_activities ?? '';

                    el('act-article').value = String(art ?? '');
                    el('act-runner').value = String(run ?? '');
                    el('act-cavity').value = String(cav ?? '');
                    el('act-cycle').value = String(cyc ?? '');
                    el('act-pcshr').value = String(pcs ?? '');
                    el('act-man').value = String(man ?? '');
                    el('act-name').value = String(ent ?? '');
                    el('act-sfgqty').value = String(sfg ?? '');
                    el('act-ops').value = String(ops ?? '');

                    el('std-msg').innerHTML =
                        '<span class="ok">Setup loaded — you can submit DPR.</span>';
                    setupDone = true;
                    validateForm();
                })
                .catch(err => {
                    ids.forEach(id => el(id).disabled = false);
                    console.error('std-actual/status failure:', err);
                    el('std-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
                    setupDone = false;
                    validateForm();
                })
                .finally(() => hideLoading());
        }

        function buildColourOptions(job) {
            const sel = el('d-color'), selCc = el('cc-colour'); sel.innerHTML = ''; selCc.innerHTML = '';
            const keys = ['Colour -1', 'Colour -2', 'Colour -3', 'Colour -4', 'Colour -5', 'Colour -6', 'Color -1', 'Color -2', 'Color -3', 'Color -4', 'Color -5', 'Color -6'];
            const vals = []; if (job && job._all) { keys.forEach(k => { const v = job._all[k]; if (v != null && String(v).trim() !== '') vals.push(String(v).trim()); }); }
            const uniq = [...new Set(vals)];
            if (!uniq.length) { [sel, selCc].forEach(s => s.add(new Option('—', ''))); return; }
            uniq.forEach(v => { sel.add(new Option(v, v)); selCc.add(new Option(v, v)); });
        }

        function renderColorPlanTable(job) {
            if (!job || !job._all) {
                hide('color-plan-card');
                return;
            }
            const all = job._all;
            const tbody = el('color-plan-body');
            tbody.innerHTML = '';

            const rows = [];

            for (let i = 1; i <= 6; i++) {
                let colorName = String(
                    all[`Colour-${i}`] ??
                    all[`Colour -${i}`] ??
                    all[`Colour - ${i}`] ??
                    all[`Color-${i}`] ??
                    all[`Color -${i}`] ??
                    all[`Color - ${i}`] ??
                    ''
                ).trim();

                const cleanName = colorName.replace(/\s+/g, ' ').trim();
                if (
                    !cleanName ||
                    cleanName === '-' ||
                    cleanName === '–' ||
                    /^N\/?A$/i.test(cleanName) ||
                    cleanName === '0'
                ) {
                    continue;
                }
                colorName = cleanName;

                const planQty = Number(
                    all[`Colour-${i} QTY`] ??
                    all[`Colour -${i} QTY`] ??
                    all[`Colour-${i} Qty`] ??
                    all[`Colour -${i} Qty`] ??
                    all[`Color-${i} QTY`] ??
                    all[`Color -${i} QTY`] ??
                    all[`Color-${i} Qty`] ??
                    all[`Color -${i} Qty`] ??
                    0
                );

                const balQty = Number(
                    all[`Colour-${i} Bal QTY`] ??
                    all[`Colour -${i} Bal QTY`] ??
                    all[`Colour-${i} Bal Qty`] ??
                    all[`Colour -${i} Bal Qty`] ??
                    all[`Color-${i} Bal QTY`] ??
                    all[`Color -${i} Bal QTY`] ??
                    all[`Color-${i} Bal Qty`] ??
                    all[`Color -${i} Bal Qty`] ??
                    0
                );

                rows.push({ name: colorName, qty: planQty, bal: balQty });
            }

            if (!rows.length) {
                hide('color-plan-card');
                return;
            }

            jobColorsData = {};
            let sumColourPlan = 0;
            let sumColourBal = 0;

            rows.forEach(r => {
                jobColorsData[r.name] = { plan: r.qty, bal: r.bal };
                sumColourPlan += Number(r.qty || 0);
                sumColourBal += Number(r.bal || 0);

                const tr = document.createElement('tr');
                tr.className = 'color-row';
                tr.innerHTML = `
      <td><span class="color-badge">${r.name}</span></td>
      <td><span class="qty-pill">${r.qty}</span></td>
      <td><span class="qty-pill">${r.bal}</span></td>
    `;
                tr.onclick = () => {
                    const sel = el('d-color');
                    if (sel) {
                        sel.value = r.name;
                        sel.dispatchEvent(new Event('change'));
                    }
                };
                tbody.appendChild(tr);
            });

            const totalPlan = Number(
                all['PLANQTY'] ??
                all['PlanQty'] ??
                all['Plan Qty'] ??
                all['Planned Qty'] ??
                all['PlannedQty'] ??
                sumColourPlan
            );

            const totalBal = sumColourBal;

            const trTot = document.createElement('tr');
            trTot.className = 'color-row';
            trTot.innerHTML = `
    <td><span class="color-badge" style="font-weight:700">Total</span></td>
    <td><span class="qty-pill" style="font-weight:700">${totalPlan}</span></td>
    <td><span class="qty-pill" style="font-weight:700">${totalBal}</span></td>
  `;
            tbody.appendChild(trTot);

            el('color-plan-note').textContent =
                'Total Plan from PLANQTY. Colour-wise Plan from Colour-n QTY. Colour-wise Bal from Colour-n Bal QTY.';
            show('color-plan-card');
        }

        async function login() {
            const uEl = el('login-username');
            const pEl = el('login-password');
            const msg = el('login-msg');

            const username = (uEl?.value || '').trim();
            const password = pEl?.value || '';

            if (!username || !password) {
                if (msg) msg.textContent = 'Enter username & password.';
                return;
            }

            if (msg) msg.textContent = 'Checking...';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, requested_app: 'qc_supervisor_app' })
                });

                const data = await res.json();

                if (!data.ok) {
                    if (msg) msg.textContent = data.error || 'Login failed.';
                    return;
                }

                const s = data.data || {};

                session.username = s.username || username;
                session.line = s.line || '';
                session.machine = null;

                try {
                    localStorage.setItem('jpsmsSession', JSON.stringify({
                        username: session.username,
                        line: session.line,
                        machine: null
                    }));
                } catch (_) { }

                const lineLabel = el('line-name');
                if (lineLabel) lineLabel.textContent = session.line || '—';

                if (msg) msg.innerHTML = '<span class="ok">Login OK.</span>';

                showAppView(true);
                loadMachines();

            } catch (err) {
                console.error(err);
                if (msg) msg.innerHTML = '<span class="err">Cannot reach server.</span>';
            }
        }

        async function loadMachines() {
            const dd = el('dd-machine');
            dd.innerHTML = '';
            dd.add(new Option('Loading…', ''));

            showLoading();

            try {
                let line = session.line;
                if (!line || line === 'undefined' || line === 'null') line = '';

                const res = await fetch('/api/machines?process=Moulding&line=' + encodeURIComponent(line));
                const data = await res.json();

                dd.innerHTML = '';

                const list = (data && data.ok) ? (data.data || []) : [];

                if (!list.length) {
                    dd.add(new Option(`No machines found for "${line}"`, ''));
                    hideLoading();
                    return;
                }

                // Add 'Select Machine' if multiple, or auto-select if one
                if (list.length > 1) {
                    // Optional: dd.add(new Option('Select Machine', ''));
                }

                list.forEach(m => dd.add(new Option(m, m)));

                // Restore selection or default to first
                if (session.machine && list.includes(session.machine)) {
                    dd.value = session.machine;
                    dd.value = session.machine;
                }

                // Persist
                saveSession();

                loadQueue();
                loadRecent();

            } catch (e) {
                console.error('loadMachines error', e);
                dd.innerHTML = '';
                dd.add(new Option('Error loading machines', ''));
                el('submit-errors').textContent = 'Net Error: ' + e.message;
            } finally {
                hideLoading();
            }
        }

        function onMachineChange() {
            session.machine = el('dd-machine').value;
            saveSession();
            loadQueue();
            loadRecent();
        }

        function saveSession() {
            try {
                localStorage.setItem('jpsmsSession', JSON.stringify({
                    username: session.username,
                    line: session.line,
                    machine: session.machine
                }));
            } catch (_) { }
        }

        const FIELD_ORDER = [
            { label: 'Client', keys: ['Client', 'Client Name', 'Customer', 'Party'] },
            { label: 'SFG NAME', keys: ['SFG Name', 'Our Name', 'OurName', 'SFG NAME', 'SFGNAME', 'Item Name', 'SFG'] },
            { label: 'FG CODE', keys: ['FG CODE'] },
            { label: 'MOULD CODE', keys: ['Mould Code', 'Mould code', 'Mould No', 'MouldNo', 'Mouldno', 'MOULD CODE'] },
            { label: 'PLANQTY', keys: ['PlanQty', 'Planned Qty', 'Planned Quantity', 'PLANQTY'] },
            { label: 'Jc Target Qty', keys: ['Jc Target Qty', 'JC Targeted Qty', 'JC Target Qty', 'Target Qty', 'TargetQty'] },
            { label: 'STD Sfg Qty', keys: ['SFG Qty', 'Sfg Qty', 'STD SFG Qty'] },
            { label: 'Mixing Ratio', keys: ['Mixing Ratio', 'MIXING RATIO', 'Mix Ratio'] },
            { label: 'Or Remarks', keys: ['OR Remarks', 'Or Remarks', 'Order Remarks'] },
            { label: 'Special Remarks', keys: ['Special Remarks', 'Special Remark'] },
            { label: 'Operator Activities', keys: ['Operator Activities', 'Operator Activity', 'Ops Activities'] }
        ];

        function lookup(all, job, keys) {
            for (const k of keys) {
                if (job && k in job && job[k] != null && String(job[k]).trim() !== '') return job[k];
                if (all && k in all && all[k] != null && String(all[k]).trim() !== '') return all[k];
            }
            return '';
        }

        function getJobCardNo(job) {
            if (!job) return '';
            const all = job._all || {};
            return String(
                job.JobCardNo ||
                all['Job Card Number'] ||
                all['JobCard Number'] ||
                all['JobCardNo'] ||
                all['JC No'] ||
                all['JC Number'] ||
                ''
            ) || '';
        }

        function orderedDetails(job) {
            const all = job ? (job._all || {}) : {};
            let html = '<div class="card" style="padding:8px">';
            FIELD_ORDER.forEach(f => {
                const val = lookup(all, job, f.keys);
                html += `<div class="inline" style="justify-content:space-between;border-bottom:1px dashed var(--line);padding:6px 0">
               <span class="muted" style="margin-right:8px">${f.label}</span>
               <span>${safe(val)}</span>
             </div>`;
            });
            html += '</div>';
            return html;
        }
        function getJobStatus(job) {
            const all = job && job._all ? job._all : {};
            const raw = job.Status || all.Status || all['Plan Status'] || all['Job Status'] || all['Status '] || all['STATUS'] || '';
            return String(raw || '').trim();
        }

        function loadQueue() {
            const jobsDiv = el('jobs');
            jobsDiv.innerHTML = '';
            el('no-jobs').classList.add('hidden');

            // Reset DPR area
            session.activeJob = null;
            // hide('dpr-form'); // Element removed
            // hide('std-actual-card'); // Element removed 
            // hide('color-plan-card'); // Element removed
            // el('active-job').innerHTML = 'Open Queue → <b>QC Check</b> on the first job.'; // Element removed
            el('job-summary').innerHTML = '';

            showLoading();

            const line = session.line || '';
            const machine = session.machine || el('dd-machine').value || '';

            fetch(`/api/queue?line=${encodeURIComponent(line)}&machine=${encodeURIComponent(machine)}`)
                .then(r => r.json())
                .then(r => {
                    if (!r || !r.ok) {
                        el('no-jobs').classList.remove('hidden');
                        hideLoading();
                        return;
                    }

                    const rows = r.data || [];
                    if (!rows.length) {
                        el('no-jobs').classList.remove('hidden');
                        hideLoading();
                        return;
                    }

                    // Map, filter out completed, add priority
                    const mapped = rows
                        .map((job, originalIndex) => {
                            const statusRaw = getJobStatus(job);
                            const statusNorm = statusRaw.toUpperCase();

                            // Drop fully done jobs
                            if (['DONE', 'COMPLETED', 'CLOSED'].includes(statusNorm)) return null;

                            let pri = 4;
                            if (statusNorm.startsWith('RUN')) pri = 1;
                            else if (statusNorm.startsWith('WAIT') || statusNorm === '') pri = 2;
                            else if (statusNorm.startsWith('POST')) pri = 3;

                            return { job, originalIndex, statusRaw, statusNorm, pri };
                        })
                        .filter(Boolean);

                    if (!mapped.length) {
                        el('no-jobs').classList.remove('hidden');
                        hideLoading();
                        return;
                    }

                    // Sort: RUN first, then WAIT, POST, etc., then original index
                    mapped.sort((a, b) => {
                        if (a.pri !== b.pri) return a.pri - b.pri;
                        return a.originalIndex - b.originalIndex;
                    });

                    // Default to first visible row, but every job can be selected for QC/FPA.
                    const activeIndex = 0;
                    session.activeJob = mapped[activeIndex].job || null;

                    jobsDiv.innerHTML = '';
                    const frag = document.createDocumentFragment();

                    mapped.forEach((item, idx) => {
                        const job = item.job;
                        const all = job._all || {};

                        const st = fmtDT(job.StartDateTime) || '—';
                        const en = fmtDT(job.CalcEndDateTime) || '—';

                        const orderNo = safe(job.OrderNo || all['Order No'] || all['ORDER NO'] || '');
                        const orderDate = safe(all['Order Date'] || all['ORDER DATE'] || '');
                        const jcNo = safe(job.JobCardNo || all['JobCardNo'] || '');
                        const mouldName = safe(
                            job.Mould ||
                            all['Mould'] ||
                            all['Mould Name'] ||
                            all['SFG Name'] ||
                            ''
                        );

                        const statusLabel = item.statusRaw || 'Waiting';
                        const isActiveFirst = (idx === activeIndex);

                        const card = document.createElement('div');
                        card.className = 'job';
                        card.innerHTML = `
          <div class="inline" style="justify-content:space-between;align-items:flex-start">
            <div class="row" style="gap:6px">
              <div style="font-weight:700">
                ${orderNo}
                ${orderDate
                                ? ` <span class="muted">•</span> <span style="font-weight:700">${orderDate}</span>`
                                : ''
                            }
              </div>
              <div style="font-weight:700">
                ${jcNo}
              </div>
              <div style="font-weight:700">
                ${mouldName}
              </div>
            </div>

            <div class="qc-action-row">
              <span class="muted" style="font-size:12px">${statusLabel || 'Waiting'}</span>
              <button class="small primary" onclick="selectJobAndOpenQC(${idx})">QC Check</button>
              <button class="small ghost" onclick="selectJobAndOpenFPA(${idx})">FPA</button>
            </div>
          </div>

          <div class="grid-2" style="font-size:var(--fs-sm);margin-top:8px">
            <div><small class="muted">Start</small><br>${st}</div>
            <div><small class="muted">End</small><br>${en}</div>
          </div>
        `;

                        card.dataset.queueIndex = String(idx);
                        card._qcJob = job;
                        frag.appendChild(card);
                    });

                    jobsDiv.appendChild(frag);
                    hideLoading();
                })
                .catch(err => {
                    console.error(err);
                    jobsDiv.innerHTML = '<span class="err">Failed to load queue.</span>';
                    hideLoading();
                });
        }

        function goQCCheck() {
            try {
                if (!session.activeJob) {
                    alert('No active job found. Refresh queue.');
                    return;
                }
                const job = session.activeJob;

                // Render Job Context into the Online QC Form
                renderJobSummary(job, 'qc1-context');

                // Auto-open Online QC Form
                openQCForm('sec-qc-online');
            } catch (e) {
                alert('Error opening QC Check: ' + e.message);
                console.error(e);
            }
        }

        function getQueuedJobByIndex(idx) {
            const card = document.querySelector(`.job[data-queue-index="${idx}"]`);
            return card && card._qcJob ? card._qcJob : null;
        }

        function selectJobAndOpenQC(idx) {
            const job = getQueuedJobByIndex(idx);
            if (!job) return alert('Job not found. Refresh queue.');
            session.activeJob = job;
            renderJobSummary(job, 'qc1-context');
            openQCForm('sec-qc-online');
        }

        function selectJobAndOpenFPA(idx) {
            const job = getQueuedJobByIndex(idx);
            if (!job) return alert('Job not found. Refresh queue.');
            session.activeJob = job;
            renderJobSummary(job, 'fpa-context');
            openQCForm('sec-qc-fpa');
        }

        function openQCForm(formId) {
            showPage(formId);
            // Auto-fill Data from Session & Active Job
            const job = session.activeJob || {};
            const all = job._all || {};

            const mouldName = safe((job.Mould) || (all['Mould'] || all['Mould Name'] || all['SFG Name'] || ''));
            const itemName = safe(all['SFG Name'] || all['Item Name'] || all['SFG'] || '');

            // Populate Date Dropdowns (Today / Yesterday)
            const populateDate = (id) => {
                const sel = el(id);
                if (!sel || !sel.tagName || sel.tagName !== 'SELECT') return; // Safety check
                sel.innerHTML = '';
                const today = new Date();
                const yest = new Date();
                yest.setDate(yest.getDate() - 1);
                const fmt = d => d.toISOString().split('T')[0];
                const nice = d => d.getDate().toString().padStart(2, '0') + '/' + (d.getMonth() + 1).toString().padStart(2, '0');

                sel.add(new Option(`Today (${nice(today)})`, fmt(today)));
                sel.add(new Option(`Yesterday (${nice(yest)})`, fmt(yest)));
                sel.value = fmt(today);
            };

            populateDate('qc1-date');
            populateDate('qc2-date');
            populateDate('qc3-date');
            populateDate('fpa-date');

            // Keep qc4-valid as date picker (future dates allowed)
            try { el('qc4-valid').valueAsDate = new Date(); } catch (_) { }

            // QC 1 Auto-fill
            if (formId === 'sec-qc-online') {
                el('qc1-item').value = itemName;
                el('qc1-mould').value = mouldName;
                el('qc1-shift').value = getShiftFromTime();
                updateQCSlots(); // New: Populate slots based on shift
            }

            if (formId === 'sec-qc-fpa') {
                renderJobSummary(job, 'fpa-context');
                el('fpa-shift').value = getShiftFromTime();
                updateFPASlots();
                el('fpa-msg').textContent = '';
                el('fpa-preview').innerHTML = '';
            }

            // QC 2 Auto-fill
            if (formId === 'sec-qc-issue') {
                el('qc2-line').value = session.line || '';
                el('qc2-machine').value = session.machine || '';
            }

            // QC 4 Auto-fill
            if (formId === 'sec-qc-deviation') {
                el('qc4-part').value = itemName;
            }
        }

        function getShiftFromTime() {
            const h = new Date().getHours();
            // Day = 7:00 to 19:00 (7 PM)
            // Night = 19:00 to 7:00
            if (h >= 7 && h < 19) return 'Day';
            return 'Night';
        }

        /* New: Update Hour Slots based on Shift */
        function qcSlotsForShift(sh) {
            return sh === 'Day'
                ? ['06:00-10:00', '10:00-14:00', '14:00-18:00']
                : ['18:00-22:00', '22:00-02:00', '02:00-06:00'];
        }

        function updateQCSlots() {
            const sh = el('qc1-shift').value;
            const sel = el('qc1-slot');
            sel.innerHTML = '';
            qcSlotsForShift(sh).forEach(s => sel.add(new Option(s, s)));

            // Attempt to auto-select current slot
            const h = new Date().getHours();
            // Logic for current slot selection can be added here if needed
        }

        function updateFPASlots() {
            const sh = el('fpa-shift') ? el('fpa-shift').value : getShiftFromTime();
            const sel = el('fpa-slot');
            if (!sel) return;
            sel.innerHTML = '';
            qcSlotsForShift(sh).forEach(s => sel.add(new Option(s, s)));
        }

        function renderJobSummary(job, targetId) {
            const box = el(targetId || 'job-summary');
            if (!box) return;
            const mouldName = safe((job.Mould) || (job._all && (job._all['Mould'] || job._all['Mould Name'] || job._all['SFG Name'])));
            box.innerHTML = `
    <div class="inline" style="justify-content:space-between">
      <div><b>${safe(job.OrderNo)}</b> <span class="muted">${job.JobCardNo ? (job.JobCardNo) : ''}${mouldName ? (' • ' + mouldName) : ''}</span></div>
      <span class="tag">${safe(job.MouldNo)}</span>
    </div>
    <div style="font-size:var(--fs-sm);margin-top:6px">${orderedDetails(job)}</div>`;
        }

        // --- CONSTANTS ---
        window.REJECT_REASONS = [
            ['R01', 'Short Shot'], ['R02', 'Flash'], ['R03', 'Silver/Splash'],
            ['R04', 'Burn Marks'], ['R05', 'Weld Line'], ['R06', 'Sink/Shrinkage'],
            ['R07', 'Flow Marks'], ['R08', 'Jetting'], ['R09', 'Bubbles/Voids'],
            ['R10', 'Warpage'], ['R11', 'Dimensional Issue'], ['R12', 'Oil/Grease'],
            ['R13', 'Black/Color Spots'], ['R14', 'Scratches'], ['R15', 'Foreign Material'],
            ['R16', 'Crack/Breakage'], ['R17', 'Ejector Marks'], ['R18', 'Gate Issue'],
            ['R19', 'Insert Issue'], ['R99', 'Others']
        ];
        window.DOWNTIME_REASONS = [
            ['D01', 'Mould Change'], ['D02', 'Machine Breakdown'], ['D03', 'Mould Maintenance'],
            ['D04', 'No Material'], ['D05', 'No Operator'], ['D06', 'No Plan'],
            ['D07', 'Power Failure'], ['D08', 'Quality Issue'], ['D09', 'Trial/Testing'],
            ['D10', 'Preventive Maintenance'], ['D99', 'Others']
        ];

        let rejItems = [], dtItems = [];
        function addRejItem() { rejItems.push({ qty: 0, code: REJECT_REASONS[0][0], text: REJECT_REASONS[0][1] }); renderRejItems(); }
        function addDtItem() { dtItems.push({ min: 0, code: DOWNTIME_REASONS[0][0], text: DOWNTIME_REASONS[0][1] }); renderDtItems(); }
        function renderRejItems() {
            const wrap = el('rej-items'); wrap.innerHTML = '';
            rejItems.forEach((it, i) => {
                const d = document.createElement('div'); d.className = 'chip';
                const q = document.createElement('input'); q.type = 'number'; q.min = '0'; q.value = it.qty || 0; q.inputMode = 'numeric';
                q.oninput = () => { it.qty = Number(q.value || 0); recalcAndValidate(); };
                const s = document.createElement('select'); REJECT_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c))); s.value = it.code;
                s.onchange = () => { const f = REJECT_REASONS.find(r => r[0] === s.value); it.code = s.value; it.text = f ? f[1] : ''; };
                const rm = document.createElement('button'); rm.className = 'small'; rm.textContent = '✕'; rm.onclick = () => { rejItems.splice(i, 1); renderRejItems(); };
                d.append(q, s, rm); wrap.appendChild(d);
            });
            recalcAndValidate();
        }
        function renderDtItems() {
            const wrap = el('dt-items'); wrap.innerHTML = '';
            dtItems.forEach((it, i) => {
                const d = document.createElement('div'); d.className = 'chip';
                const q = document.createElement('input'); q.type = 'number'; q.min = '0'; q.value = it.min || 0; q.inputMode = 'numeric';
                q.oninput = () => { it.min = Number(q.value || 0); recalcAndValidate(); };
                const s = document.createElement('select'); DOWNTIME_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c))); s.value = it.code;
                s.onchange = () => { const f = DOWNTIME_REASONS.find(r => r[0] === s.value); it.code = s.value; it.text = f ? f[1] : ''; };
                const rm = document.createElement('button'); rm.className = 'small'; rm.textContent = '✕'; rm.onclick = () => { dtItems.splice(i, 1); renderDtItems(); };
                d.append(q, s, rm); wrap.appendChild(d);
            });
            recalcAndValidate();
        }
        function onShotsChange() { recalcAndValidate(); }

        function ccRecalc() {
            // Legacy code - removed fields
        }

        function onShotsChange() { /* Legacy */ }
        function recalc() { /* Legacy */ }
        function recalcAndValidate() { /* Legacy */ }

        function onColorChange() { /* Legacy */ }

        function validateForm() {
            // Legacy production validation - disabled for QC Mode
            return true;
        }

        function onDateShiftChange() {
            loadUsedSlots();
        }

        /* Fetches used slots from backend */
        function loadUsedSlots() {
            const pid = session.activeJob ? session.activeJob.PlanID : '';
            if (!pid) return;

            const dt = el('d-date').value;
            const sh = el('d-shift').value;

            const span = el('slot-loader');
            if (span) span.textContent = '...';

            const url = `/api/dpr/used-slots?planId=${encodeURIComponent(pid)}` +
                `&date=${encodeURIComponent(dt)}` +
                `&shift=${encodeURIComponent(sh)}`;

            fetch(url)
                .then(r => r.json())
                .then(r => {
                    if (span) span.textContent = '';
                    usedSlots = (r && r.ok && Array.isArray(r.used)) ? r.used : [];
                    refreshSlots();
                })
                .catch(_ => {
                    if (span) span.textContent = '';
                    usedSlots = [];
                    refreshSlots();
                });
        }

        /* Override refreshSlots – greys out locked slots */
        function refreshSlots() {
            const sel = el('d-slot');
            if (!sel) return;

            const current = sel.value;
            sel.innerHTML = '';

            HOUR_SLOTS.forEach(h => {
                const opt = new Option(h, h);
                if (usedSlots && usedSlots.includes(h)) {
                    opt.disabled = true;
                    opt.textContent = `${h} (Done)`;
                    opt.style.color = '#aaa';
                }
                sel.add(opt);
            });

            if (current && (!usedSlots || !usedSlots.includes(current))) {
                sel.value = current;
            } else {
                for (let i = 0; i < sel.options.length; i++) {
                    if (!sel.options[i].disabled) { sel.selectedIndex = i; break; }
                }
            }
            validateForm();
        }

        /* >>>>>>>>>>>>>>> OPTIMIZED SUBMIT <<<<<<<<<<<<<<< */
        function submitDPR() {
            el('submit-errors').textContent = '';

            const btn = el('btn-submit');
            if (!session.activeJob) {
                el('dpr-msg').textContent = 'Select a job first.';
                return;
            }

            if (!lastGeo || !insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc)) {
                el('submit-errors').textContent =
                    'Blocked: device is outside geofence or location accuracy is low. Recalibrate and try again.';
                return;
            }

            if (btn && btn.disabled) return;

            const colorSel = el('d-color').value || '';
            const rejParts = rejItems
                .filter(i => Number(i.qty) > 0)
                .map(i => `${i.code}:${i.qty}`);
            const dtParts = dtItems
                .filter(i => Number(i.min) > 0)
                .map(i => `${i.code}:${i.min}`);

            const breakdowns = [];
            if (colorSel) breakdowns.push(`Color=${colorSel}`);
            if (rejParts.length) breakdowns.push(`Rej[${rejParts.join('|')}]`);
            if (dtParts.length) breakdowns.push(`DT[${dtParts.join('|')}]`);

            const remarksBase = el('d-remarks').value || '';
            const Remarks = breakdowns.length
                ? (remarksBase ? remarksBase + ' | ' + breakdowns.join(' | ') : breakdowns.join(' | '))
                : remarksBase;

            const shots = Number(el('d-shots').value || 0);
            const rej = rejItems.reduce((s, i) => s + Number(i.qty || 0), 0);
            const dt = dtItems.reduce((s, i) => s + Number(i.min || 0), 0);
            const good = Math.max(0, shots - rej);

            const entry = {
                Date: el('d-date').value,
                Shift: el('d-shift').value,
                HourSlot: el('d-slot').value,
                Shots: shots,
                GoodQty: good,
                RejectQty: rej,
                DowntimeMin: dt,
                Remarks,

                PlanID: session.activeJob.PlanID || '',
                Machine: session.activeJob.Machine || '',
                OrderNo: session.activeJob.OrderNo || '',
                MouldNo: session.activeJob.MouldNo || '',
                JobCardNo: getJobCardNo(session.activeJob),

                Colour: colorSel,
                RejectBreakup: rejParts.join('|'),
                DowntimeBreakup: dtParts.join('|'),
                EntryType: 'Main'
            };

            el('dpr-msg').textContent = 'Saving…';
            if (btn) {
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
            }

            showLoading();
            fetch('/api/dpr/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: { username: session.username, line: session.line },
                    entry,
                    geo: currentGeoObj()
                })
            })
                .then(r => r.json())
                .then(r => {
                    if (r && r.ok) {
                        el('dpr-msg').innerHTML = '<span class="ok">Saved.</span>';
                        loadQueue();
                        loadRecent();
                        loadUsedSlots();
                    } else {
                        el('submit-errors').textContent =
                            (r && r.error) ? String(r.error) : 'Save failed due to an unknown error.';
                        if (btn) {
                            btn.disabled = false;
                            btn.setAttribute('aria-disabled', 'false');
                        }
                    }
                })
                .catch(err => {
                    el('submit-errors').textContent = String(err);
                    if (btn) {
                        btn.disabled = false;
                        btn.setAttribute('aria-disabled', 'false');
                    }
                })
                .finally(() => hideLoading());
        }

        /* ==================== COLOUR CHANGE ==================== */
        let ccRej = [];
        let ccDt = [];

        function openColourChange() {
            ccRej = [];
            ccDt = [];

            el('cc-shots').value = '';
            el('cc-good').value = '';
            el('cc-rej').innerHTML = '';
            el('cc-dt').innerHTML = '';
            el('cc-rej-total').textContent = '0';
            el('cc-dt-total').textContent = '0';
            el('cc-errors').innerHTML = '';
            el('cc-msg').textContent = '';

            el('cc-colour').innerHTML = el('d-color').innerHTML;
            el('cc-colour').value = el('d-color').value;

            const mainSlot = el('d-slot') ? el('d-slot').value : '';
            fillHourSlotSelect('cc-slot', mainSlot);

            show('modal-cc');
        }

        function closeCc() {
            hide('modal-cc');
        }

        function ccAddRej() {
            ccRej.push({ qty: 0, code: REJECT_REASONS[0][0], text: REJECT_REASONS[0][1] });
            ccRenderRej();
        }

        function ccAddDt() {
            ccDt.push({ min: 0, code: DOWNTIME_REASONS[0][0], text: DOWNTIME_REASONS[0][1] });
            ccRenderDt();
        }

        function ccRenderRej() {
            const w = el('cc-rej');
            w.innerHTML = '';

            ccRej.forEach((it, i) => {
                const d = document.createElement('div');
                d.className = 'chip';

                const q = document.createElement('input');
                q.type = 'number';
                q.min = '0';
                q.value = it.qty || 0;
                q.inputMode = 'numeric';
                q.oninput = () => {
                    it.qty = Number(q.value || 0);
                    ccRecalc();
                };

                const s = document.createElement('select');
                REJECT_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c)));
                s.value = it.code;
                s.onchange = () => {
                    const f = REJECT_REASONS.find(r => r[0] === s.value);
                    it.code = s.value;
                    it.text = f ? f[1] : '';
                };

                const rm = document.createElement('button');
                rm.className = 'small';
                rm.textContent = '✕';
                rm.onclick = () => {
                    ccRej.splice(i, 1);
                    ccRenderRej();
                };

                d.append(q, s, rm);
                w.appendChild(d);
            });

            ccRecalc();
        }

        function ccRenderDt() {
            const w = el('cc-dt');
            w.innerHTML = '';

            ccDt.forEach((it, i) => {
                const d = document.createElement('div');
                d.className = 'chip';

                const q = document.createElement('input');
                q.type = 'number';
                q.min = '0';
                q.value = it.min || 0;
                q.inputMode = 'numeric';
                q.oninput = () => {
                    it.min = Number(q.value || 0);
                    ccRecalc();
                };

                const s = document.createElement('select');
                DOWNTIME_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c)));
                s.value = it.code;
                s.onchange = () => {
                    const f = DOWNTIME_REASONS.find(r => r[0] === s.value);
                    it.code = s.value;
                    it.text = f ? f[1] : '';
                };

                const rm = document.createElement('button');
                rm.className = 'small';
                rm.textContent = '✕';
                rm.onclick = () => {
                    ccDt.splice(i, 1);
                    ccRenderDt();
                };

                d.append(q, s, rm);
                w.appendChild(d);
            });

            ccRecalc();
        }

        function ccRecalc() {
            const shots = Number(el('cc-shots').value || 0);
            const rej = ccRej.reduce((s, i) => s + Number(i.qty || 0), 0);
            const dt = ccDt.reduce((s, i) => s + Number(i.min || 0), 0);

            el('cc-rej-total').textContent = String(rej);
            el('cc-dt-total').textContent = String(dt);
            el('cc-good').value = Math.max(0, shots - rej);

            const errs = [];

            if (!el('cc-slot').value) {
                errs.push('Select Hour Slot.');
            }
            if (rej > shots) {
                errs.push('Rejection exceeds Shots.');
            }
            if (dt > 60) {
                errs.push('Downtime exceeds 60.');
            }

            el('cc-errors').innerHTML = errs.map(e => `<span class="err">• ${e}</span>`).join('');
            el('cc-save').disabled = errs.length > 0;
        }

        function ccSave() {
            const job = session.activeJob;
            if (!job) return;

            ccRecalc();
            if (el('cc-save').disabled) return;

            const shots = Number(el('cc-shots').value || 0);
            const rej = ccRej.reduce((s, i) => s + Number(i.qty || 0), 0);
            const dt = ccDt.reduce((s, i) => s + Number(i.min || 0), 0);
            const good = Math.max(0, shots - rej);

            const rejParts = ccRej
                .filter(i => Number(i.qty) > 0)
                .map(i => `${i.code}:${i.qty}`);

            const dtParts = ccDt
                .filter(i => Number(i.min) > 0)
                .map(i => `${i.code}:${i.min}`);

            const entry = {
                Date: el('d-date').value,
                Shift: el('d-shift').value,
                HourSlot: el('cc-slot').value,
                Shots: shots,
                GoodQty: good,
                RejectQty: rej,
                DowntimeMin: dt,
                Remarks: 'Colour Change',

                PlanID: job.PlanID || '',
                Machine: job.Machine || '',
                OrderNo: job.OrderNo || '',
                MouldNo: job.MouldNo || '',
                JobCardNo: getJobCardNo(job),

                Colour: el('cc-colour').value || '',
                RejectBreakup: rejParts.join('|'),
                DowntimeBreakup: dtParts.join('|'),
                EntryType: 'ColourChange'
            };

            el('cc-msg').textContent = 'Saving…';
            showLoading();

            fetch('/api/dpr/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: { username: session.username, line: session.line },
                    entry,
                    geo: currentGeoObj()
                })
            })
                .then(r => r.json())
                .then(r => {
                    if (r && r.ok) {
                        el('cc-msg').innerHTML = '<span class="ok">Saved.</span>';
                        closeCc();
                        loadRecent();
                        loadUsedSlots();
                    } else {
                        el('cc-msg').innerHTML = '<span class="err">' + ((r && r.error) || 'Failed') + '</span>';
                    }
                })
                .catch(err => {
                    el('cc-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
                })
                .finally(() => hideLoading());
        }

        /* ==================== MOULD CHANGE ==================== */
        let mcDt = [];

        function openMouldChange() {
            const mainSlot = el('d-slot') ? el('d-slot').value : '';
            fillHourSlotSelect('mc-slot', mainSlot);

            mcDt = [];
            el('mc-dt').innerHTML = '';
            el('mc-dt-total').textContent = '0';
            el('mc-errors').innerHTML = '';
            el('mc-msg').textContent = '';

            show('modal-mc');
        }

        function closeMc() {
            hide('modal-mc');
        }

        function mcAddDt() {
            mcDt.push({ min: 0, code: DOWNTIME_REASONS[1][0], text: DOWNTIME_REASONS[1][1] });
            mcRender();
        }

        function mcRender() {
            const w = el('mc-dt');
            w.innerHTML = '';

            mcDt.forEach((it, i) => {
                const d = document.createElement('div');
                d.className = 'chip';

                const q = document.createElement('input');
                q.type = 'number';
                q.min = '0';
                q.value = it.min || 0;
                q.inputMode = 'numeric';
                q.oninput = () => {
                    it.min = Number(q.value || 0);
                    mcRecalc();
                };

                const s = document.createElement('select');
                DOWNTIME_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c)));
                s.value = it.code;
                s.onchange = () => {
                    const f = DOWNTIME_REASONS.find(r => r[0] === s.value);
                    it.code = s.value;
                    it.text = f ? f[1] : '';
                };

                const rm = document.createElement('button');
                rm.className = 'small';
                rm.textContent = '✕';
                rm.onclick = () => {
                    mcDt.splice(i, 1);
                    mcRender();
                };

                d.append(q, s, rm);
                w.appendChild(d);
            });

            mcRecalc();
        }

        function mcRecalc() {
            const dt = mcDt.reduce((s, i) => s + Number(i.min || 0), 0);
            el('mc-dt-total').textContent = String(dt);

            const errs = [];

            if (!el('mc-slot').value) {
                errs.push('Select Hour Slot.');
            }
            if (dt > 60) {
                errs.push('Downtime exceeds 60.');
            }

            el('mc-errors').innerHTML = errs.map(e => `<span class="err">• ${e}</span>`).join('');
        }

        function mcSave() {
            const job = session.activeJob;
            if (!job) return;

            const slot = el('mc-slot').value;
            const dt = mcDt.reduce((s, i) => s + Number(i.min || 0), 0);

            mcRecalc();
            if (!slot || dt > 60) {
                return;
            }

            const dtParts = mcDt
                .filter(i => Number(i.min) > 0)
                .map(i => `${i.code}:${i.min}`);

            const entry = {
                Date: el('d-date').value,
                Shift: el('d-shift').value,
                HourSlot: slot,
                Shots: 0,
                GoodQty: 0,
                RejectQty: 0,
                DowntimeMin: dt,
                Remarks: 'Mould Change',

                PlanID: job.PlanID || '',
                Machine: job.Machine || '',
                OrderNo: job.OrderNo || '',
                MouldNo: job.MouldNo || '',
                JobCardNo: getJobCardNo(job),

                Colour: el('d-color').value || '',
                RejectBreakup: '',
                DowntimeBreakup: dtParts.join('|'),
                EntryType: 'MouldChange'
            };

            el('mc-msg').textContent = 'Saving…';
            showLoading();

            fetch('/api/dpr/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: { username: session.username, line: session.line },
                    entry,
                    geo: currentGeoObj()
                })
            })
                .then(r => r.json())
                .then(r => {
                    if (r && r.ok) {
                        el('mc-msg').innerHTML = '<span class="ok">Saved.</span>';
                        closeMc();
                        loadRecent();
                        loadUsedSlots();
                    } else {
                        el('mc-msg').innerHTML = '<span class="err">' + ((r && r.error) || 'Failed') + '</span>';
                    }
                })
                .catch(err => {
                    el('mc-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
                })
                .finally(() => hideLoading());
        }

        /* ==================== RECENT with FILTER & EDIT ==================== */
        /* ==================== RECENT QC REPORTS ==================== */
        function loadRecent() {
            const d = el('recent'); d.innerHTML = 'Loading...';
            const mach = el('dd-machine').value;
            if (!mach) { d.innerHTML = 'Select a machine to view recent reports.'; return; }

            const url = `/api/qc/recent?machine=${encodeURIComponent(mach || '')}&limit=10`;

            fetch(url)
                .then(r => r.json())
                .then(res => {
                    if (!res || !res.ok) { d.innerHTML = (res && res.error) || 'Failed to load recent reports.'; return; }
                    d.innerHTML = '';
                    const rows = (res.data) || [];
                    if (!rows.length) { d.innerHTML = 'No recent QC reports for this machine.'; return; }

                    const frag = document.createDocumentFragment();

                    rows.forEach((row) => {
                        // Create QC Report Card
                        const c = document.createElement('div'); c.className = 'job';
                        // Determine Status Color
                        const isRej = (row.qty_rejected > 0);
                        const statusColor = isRej ? 'var(--red)' : 'var(--green)';
                        const borderStyle = `border-left: 4px solid ${statusColor}`;

                        c.style = borderStyle;
                        c.innerHTML = `
          <div style="font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between">
            <span>${new Date(row.date).toLocaleDateString()} (${row.shift})</span>
            <span style="color:${statusColor}">${isRej ? 'Has Rejects' : 'OK'}</span>
          </div>
          <div style="font-size:14px; margin-bottom:4px">
             <b>${row.item_name || '-'}</b> <span class="muted">•</span> ${row.mould_name || '-'}
          </div>
          <div class="grid-2" style="font-size:13px">
             <div>Checked: <b>${row.qty_checked || 0}</b></div>
             <div>Rejected: <b>${row.qty_rejected || 0}</b></div>
          </div>
          ${row.defect_description ? `<div class="muted" style="font-size:13px;margin-top:6px;font-style:italic">"${row.defect_description}"</div>` : ''}
          ${row.action_taken ? `<div style="font-size:12px;margin-top:4px;color:var(--ink)">Action: ${row.action_taken}</div>` : ''}
        `;
                        frag.appendChild(c);
                    });

                    d.appendChild(frag);
                })
                .catch(err => {
                    d.innerHTML = String(err);
                });
        }

        function openEdit(uid, s, r, d, rem) {
            el('edit-id').value = uid;
            el('edit-shots').value = s;
            el('edit-rej').value = r;
            el('edit-dt').value = d;
            el('edit-remarks').value = rem;
            el('edit-error').textContent = '';
            el('edit-good').value = Math.max(0, s - r);
            show('modal-edit');
        }

        el('edit-shots').oninput = el('edit-rej').oninput = function () {
            const s = Number(el('edit-shots').value);
            const r = Number(el('edit-rej').value);
            el('edit-good').value = Math.max(0, s - r);
        };

        function saveEdit() {
            const p = {
                uniqueId: el('edit-id').value,
                newShots: el('edit-shots').value,
                newReject: el('edit-rej').value,
                newDowntime: el('edit-dt').value,
                newRemarks: el('edit-remarks').value
            };
            const btn = document.querySelector('#modal-edit .primary');
            const txt = btn.innerText; btn.innerText = 'Updating...'; btn.disabled = true;

            fetch('/api/dpr/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: { username: session.username, line: session.line },
                    payload: p
                })
            })
                .then(r => r.json())
                .then(r => {
                    btn.innerText = txt; btn.disabled = false;
                    if (r && r.ok) { hide('modal-edit'); loadRecent(); }
                    else { el('edit-error').textContent = (r && r.error) || 'Update failed.'; }
                })
                .catch(err => {
                    btn.innerText = txt; btn.disabled = false;
                    el('edit-error').textContent = String(err);
                });
        }

        /* ==================== Utils ==================== */
        async function fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(file);
            });
        }



        /* Global JS error surface */
        /* ==================== QC MODULE LOGIC ==================== */

        function toggleSidebar() {
            const sb = el('sidebar');
            if (sb.classList.contains('hidden')) {
                sb.classList.remove('hidden');
            } else {
                sb.classList.add('hidden');
            }
        }

        function showPage(id, tabEl) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
            // Show requested page
            const p = el(id);
            if (p) {
                p.classList.remove('hidden');
                // Auto-scroll to top
                scrollQcToTop();
            }

            // Handle Tab Styling if tabEl is provided
            if (tabEl) {
                document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
                tabEl.classList.add('active');
                el('line-name').scrollIntoView();
            }
        }

        /* QC 1: Online Report */
        function activeJobPayload() {
            const job = session.activeJob || {};
            const all = job._all || {};
            return {
                plan_id: String(job.PlanID || all.PlanID || all['Plan ID'] || ''),
                job_card_no: getJobCardNo(job),
                order_no: String(job.OrderNo || all['Order No'] || all.OrderNo || ''),
                item_name: String(all['SFG Name'] || all['Item Name'] || all.SFG || ''),
                mould_name: String(job.Mould || all.Mould || all['Mould Name'] || all['SFG Name'] || '')
            };
        }

        function submitQC1() {
            const jobInfo = activeJobPayload();
            const data = {
                date: el('qc1-date').value,
                shift: el('qc1-shift').value,
                hour_slot: el('qc1-slot').value,
                line: session.line,
                machine: session.machine,
                plan_id: jobInfo.plan_id,
                job_card_no: jobInfo.job_card_no,
                order_no: jobInfo.order_no,
                item_name: el('qc1-item').value,
                mould_name: el('qc1-mould').value,
                qc_weight_1: el('qc1-weight1').value,
                qc_weight_2: el('qc1-weight2').value,
                qc_weight_3: el('qc1-weight3').value,
                defect_description: el('qc1-defect').value,
                qty_checked: Number(el('qc1-checked').value || 0),
                qty_rejected: Number(el('qc1-rejected').value || 0),
                action_taken: el('qc1-action').value,
                supervisor: session.username
            };

            if (!data.date || !data.item_name) return alert('Date and Item Name are required.');

            fetch('/api/qc/online', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json()).then(r => {
                if (r.ok) { alert('Report Submitted!'); showPage('sec-queue'); }
                else alert('Error: ' + r.error);
            });
        }

        async function submitFPA() {
            if (!session.activeJob) return alert('Select a job first.');
            const formFile = el('fpa-form-image').files[0];
            const productFiles = Array.from(el('fpa-product-images').files || []);
            if (!formFile) return alert('Upload FPA Form image.');
            if (productFiles.length < 2) return alert('Upload minimum 2 product reference images.');

            const jobInfo = activeJobPayload();
            el('fpa-msg').textContent = 'Uploading FPA images...';
            try {
                const formImage = await fileToBase64(formFile);
                const productImages = [];
                for (const file of productFiles.slice(0, 8)) {
                    productImages.push(await fileToBase64(file));
                }
                const data = {
                    date: el('fpa-date').value,
                    shift: el('fpa-shift').value,
                    hour_slot: el('fpa-slot').value,
                    line: session.line,
                    machine: session.machine,
                    plan_id: jobInfo.plan_id,
                    job_card_no: jobInfo.job_card_no,
                    order_no: jobInfo.order_no,
                    item_name: jobInfo.item_name,
                    mould_name: jobInfo.mould_name,
                    fpa_form_image: formImage,
                    product_images: productImages,
                    remarks: el('fpa-remarks').value,
                    supervisor: session.username
                };

                const res = await fetch('/api/qc/fpa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                }).then(r => r.json());
                if (!res.ok) throw new Error(res.error || 'FPA save failed');
                el('fpa-msg').innerHTML = '<span class="ok">FPA saved.</span>';
                el('fpa-preview').innerHTML = [formImage, ...productImages].map(src => `<img src="${src}" alt="FPA image">`).join('');
                loadRecent();
            } catch (err) {
                el('fpa-msg').innerHTML = `<span class="err">${String(err.message || err)}</span>`;
            }
        }

        /* QC 2: Issue Memo */
        function submitQC2() {
            const data = {
                date: el('qc2-date').value,
                line: session.line,
                machine: session.machine,
                issue_description: el('qc2-issue').value,
                responsibility: el('qc2-resp').value,
                status: 'Open',
                supervisor: session.username
            };

            if (!data.date || !data.issue_description) return alert('Date and Description required.');

            fetch('/api/qc/issue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json()).then(r => {
                if (r.ok) { alert('Memo Submitted!'); showPage('sec-queue'); }
                else alert('Error: ' + r.error);
            });
        }

        /* QC 3: Training */
        function submitQC3() {
            const data = {
                date: el('qc3-date').value,
                trainee_name: el('qc3-trainee').value,
                trainer_name: el('qc3-trainer').value,
                topic: el('qc3-topic').value,
                duration: el('qc3-duration').value,
                score: el('qc3-score').value,
                remarks: el('qc3-remarks').value
            };

            if (!data.trainee_name) return alert('Trainee Name required.');

            fetch('/api/qc/training', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json()).then(r => {
                if (r.ok) { alert('Training Record Saved!'); showPage('sec-queue'); }
                else alert('Error: ' + r.error);
            });
        }

        /* QC 4: Deviation */
        function submitQC4() {
            const data = {
                date: el('qc4-valid').value, // Using Valid Upto date as main date for now or add separate date field
                part_name: el('qc4-part').value,
                machine: session.machine,
                deviation_details: el('qc4-details').value,
                reason: el('qc4-reason').value,
                approved_by: el('qc4-approved').value,
                valid_upto: el('qc4-valid').value
            };

            if (!data.part_name) return alert('Part Name required.');

            fetch('/api/qc/deviation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json()).then(r => {
                if (r.ok) { alert('Deviation Form Submitted!'); showPage('sec-queue'); }
                else alert('Error: ' + r.error);
            });
        }

        function logout() {
            localStorage.removeItem('token');
            localStorage.removeItem('jpsmsSession');
            location.reload();
        }

        /* Auto-fill Line/Machine in forms when sidebar opens */
        // Add logic if needed, currently pulled from session on submit

        window.addEventListener('error', e => {
            const s = el('submit-errors'); if (s) { s.textContent = 'Script error: ' + e.message; }
        });

        /* ================================================================
           PRIORITY BADGE + END TIME — job card rendering helpers
           ================================================================ */
        function priorityBadge(machinePriority) {
            if (!machinePriority) return '';
            const map = { P1: '#dc2626', P2: '#d97706', P3: '#854d0e', P4: '#64748b' };
            const bg  = { P1: '#fef2f2', P2: '#fffbeb', P3: '#fefce8', P4: '#f8fafc' };
            const c = map[machinePriority] || '#64748b';
            const b = bg[machinePriority]  || '#f8fafc';
            return `<span style="display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:${b};border:1px solid ${c};color:${c};font-size:11px;font-weight:800;margin-right:4px">${machinePriority}</span>`;
        }

        function endTimeBadge(calcEndDT) {
            if (!calcEndDT) return '<span class="muted" style="font-size:12px">—</span>';
            const end = new Date(calcEndDT);
            const now = new Date();
            const diffDays = Math.round((end - now) / 86400000);
            let label, color;
            if (diffDays < 0)       { label = `Overdue ${Math.abs(diffDays)}d`; color = '#dc2626'; }
            else if (diffDays === 0){ label = 'Due Today';  color = '#d97706'; }
            else if (diffDays === 1){ label = 'Due Tomorrow'; color = '#d97706'; }
            else if (diffDays <= 3) { label = `${diffDays}d left`; color = '#d97706'; }
            else {
                label = end.getDate().toString().padStart(2,'0') + '/' + (end.getMonth()+1).toString().padStart(2,'0');
                color = '#059669';
            }
            return `<span style="font-size:12px;font-weight:600;color:${color}">⏰ ${label}</span>`;
        }

        function statusBadge(statusRaw) {
            const s = (statusRaw || '').toUpperCase();
            if (s.startsWith('RUN')) return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:#ecfdf5;border:1px solid #059669;color:#059669;font-size:11px;font-weight:700"><span style="width:6px;height:6px;border-radius:50%;background:#059669;animation:pulse 1.2s infinite"></span>Running</span>`;
            if (s.startsWith('STOP')) return `<span style="padding:2px 8px;border-radius:999px;background:#fef2f2;border:1px solid #dc2626;color:#dc2626;font-size:11px;font-weight:700">Stopped</span>`;
            return `<span style="padding:2px 8px;border-radius:999px;background:var(--pill);border:1px solid rgba(99,120,180,.2);color:var(--muted);font-size:11px;font-weight:600">${statusRaw || 'Waiting'}</span>`;
        }

        /* Override job card render to include priority + end-time */
        function buildJobCard(item, idx, activeIndex) {
            const job = item.job;
            const all = job._all || {};

            const orderNo  = safe(job.OrderNo  || all['Order No']  || '');
            const jcNo     = safe(job.JobCardNo || all['JobCardNo'] || '');
            const prodName = safe(all['SFG Name'] || all['Item Name'] || job.product_name || '');
            const planQty  = safe(job.PlanQty  || all['Plan Qty']  || '');
            const st       = fmtDT(job.StartDateTime)  || '—';
            const machinePriority = job.machinePriority || all['machinePriority'] || null;
            const calcEnd  = job.CalcEndDateTime || all['CalcEndDateTime'] || null;

            const card = document.createElement('div');
            card.className = 'job';
            if (idx === activeIndex) card.style.borderColor = 'var(--primary)';
            card.innerHTML = `
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
                <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
                  ${priorityBadge(machinePriority)}
                  ${statusBadge(item.statusRaw)}
                  ${endTimeBadge(calcEnd)}
                </div>
                <div class="qc-action-row">
                  <button class="small primary" onclick="selectJobAndOpenQC(${idx})">QC Check</button>
                  <button class="small ghost"   onclick="selectJobAndOpenFPA(${idx})">FPA</button>
                </div>
              </div>
              <div style="font-weight:700;font-size:15px;margin-top:6px">${prodName || orderNo}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px">
                JR: ${orderNo} · JC: ${jcNo}${planQty ? ' · Qty: '+Number(planQty).toLocaleString() : ''}
              </div>
              <div style="font-size:12px;color:var(--muted);margin-top:4px">Start: ${st}</div>`;

            card.dataset.queueIndex = String(idx);
            card._qcJob = job;
            return card;
        }

        /* Patch loadQueue to use new card builder */
        const _origLoadQueue = loadQueue;
        loadQueue = function() {
            const jobsDiv = el('jobs');
            jobsDiv.innerHTML = '';
            el('no-jobs').classList.add('hidden');
            session.activeJob = null;
            el('job-summary').innerHTML = '';
            showLoading();
            const line    = session.line    || '';
            const machine = session.machine || el('dd-machine').value || '';
            fetch(`/api/queue?line=${encodeURIComponent(line)}&machine=${encodeURIComponent(machine)}`)
                .then(r => r.json())
                .then(r => {
                    hideLoading();
                    if (!r || !r.ok || !(r.data || []).length) {
                        el('no-jobs').classList.remove('hidden');
                        return;
                    }
                    const mapped = (r.data || [])
                        .map((job, originalIndex) => {
                            const statusRaw  = getJobStatus(job);
                            const statusNorm = statusRaw.toUpperCase();
                            if (['DONE','COMPLETED','CLOSED'].includes(statusNorm)) return null;
                            let pri = 4;
                            if (statusNorm.startsWith('RUN'))  pri = 1;
                            else if (statusNorm.startsWith('WAIT') || statusNorm === '') pri = 2;
                            else if (statusNorm.startsWith('POST')) pri = 3;
                            return { job, originalIndex, statusRaw, statusNorm, pri };
                        })
                        .filter(Boolean);
                    if (!mapped.length) { el('no-jobs').classList.remove('hidden'); return; }
                    mapped.sort((a, b) => a.pri !== b.pri ? a.pri - b.pri : a.originalIndex - b.originalIndex);
                    session.activeJob = mapped[0].job;
                    const frag = document.createDocumentFragment();
                    mapped.forEach((item, idx) => frag.appendChild(buildJobCard(item, idx, 0)));
                    jobsDiv.appendChild(frag);
                    // Check pending verifications after loading queue
                    checkVerifyPending();
                })
                .catch(err => {
                    console.error(err);
                    jobsDiv.innerHTML = '<span class="err">Failed to load queue.</span>';
                    hideLoading();
                });
        };

        /* ================================================================
           QC VERIFICATION — Verify tab logic
           ================================================================ */
        function populateVerifyDate() {
            const sel = el('vfy-date');
            if (!sel) return;
            sel.innerHTML = '';
            const today = new Date(), yest = new Date();
            yest.setDate(yest.getDate() - 1);
            const fmt  = d => d.toISOString().split('T')[0];
            const nice = d => d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth()+1).toString().padStart(2,'0');
            sel.add(new Option('Today (' + nice(today) + ')', fmt(today)));
            sel.add(new Option('Yesterday (' + nice(yest) + ')', fmt(yest)));
            sel.value = fmt(today);
            // Pre-select shift based on time
            const vShift = el('vfy-shift');
            if (vShift) vShift.value = getShiftFromTime();
        }

        function loadVerifySlots() {
            populateVerifyDate();
            const machine = session.machine || el('dd-machine').value || '';
            const date    = el('vfy-date')  ? el('vfy-date').value   : new Date().toISOString().split('T')[0];
            const shift   = el('vfy-shift') ? el('vfy-shift').value  : getShiftFromTime();
            const wrap    = el('vfy-slots');
            const empty   = el('vfy-empty');
            if (!machine) {
                wrap.innerHTML = '<div class="no-jobs">Select a machine first.</div>';
                return;
            }
            wrap.innerHTML = '<div class="muted" style="text-align:center;padding:16px">Loading…</div>';
            empty.classList.add('hidden');
            fetch(`/api/qc/verify/pending?machine=${encodeURIComponent(machine)}&date=${date}&shift=${encodeURIComponent(shift)}`)
                .then(r => r.json())
                .then(r => {
                    if (!r.ok || !r.data || !r.data.length) {
                        wrap.innerHTML = '';
                        empty.classList.remove('hidden');
                        return;
                    }
                    wrap.innerHTML = '';
                    const now = new Date();
                    const currentHour = now.getHours();
                    r.data.forEach(slot => {
                        wrap.appendChild(buildVerifySlotCard(slot, machine, date, shift, currentHour));
                    });
                    updateVerifyBadge(r.data);
                })
                .catch(() => { wrap.innerHTML = '<span class="err">Failed to load slots.</span>'; });
        }

        function slotToHour(slotStr) {
            // "07-08" → 7, "01-02" → 1 (afternoon slot), night handled by shift
            const parts = slotStr.split('-');
            return parseInt(parts[0], 10);
        }

        function isSlotOverdue(slotStr, shift, currentHour) {
            // 2-hour verification window: slot should be verified within 2h of its END
            const slotEnd = slotToHour(slotStr.split('-')[1]) || (slotToHour(slotStr) + 1);
            if (shift === 'Day') {
                return currentHour >= (slotEnd + 2) % 24;
            }
            return true; // Night shift: show all as overdue if not verified
        }

        function buildVerifySlotCard(slot, machine, date, shift, currentHour) {
            const div = document.createElement('div');
            const verified = slot.qc_verified;
            const isDisc   = slot.verify_status === 'Discrepancy';

            let borderColor = 'var(--line)';
            let badge = '';
            if (verified && !isDisc) {
                borderColor = '#059669';
                badge = `<span style="padding:2px 8px;border-radius:999px;background:#ecfdf5;border:1px solid #059669;color:#059669;font-size:11px;font-weight:700">✓ Verified</span>`;
            } else if (verified && isDisc) {
                borderColor = '#d97706';
                badge = `<span style="padding:2px 8px;border-radius:999px;background:#fffbeb;border:1px solid #d97706;color:#d97706;font-size:11px;font-weight:700">⚠ Discrepancy</span>`;
            } else {
                const overdue = isSlotOverdue(slot.hour_slot, shift, currentHour);
                borderColor = overdue ? '#dc2626' : 'var(--primary)';
                badge = overdue
                    ? `<span style="padding:2px 8px;border-radius:999px;background:#fef2f2;border:1px solid #dc2626;color:#dc2626;font-size:11px;font-weight:700">Overdue</span>`
                    : `<span style="padding:2px 8px;border-radius:999px;background:var(--primary-bg);border:1px solid var(--primary);color:var(--primary);font-size:11px;font-weight:700">Pending</span>`;
            }

            const supGood = slot.sup_good_qty  ?? '—';
            const supRej  = slot.sup_reject_qty ?? '—';
            const verifiedLine = verified
                ? `<div class="muted" style="font-size:11px;margin-top:4px">By ${slot.verified_by} at ${slot.verified_at}${isDisc ? ` · Good Δ${(slot.qc_good_qty-slot.sup_good_qty>=0?'+':'')}${slot.qc_good_qty-slot.sup_good_qty} Rej Δ${(slot.qc_reject_qty-slot.sup_reject_qty>=0?'+':'')}${slot.qc_reject_qty-slot.sup_reject_qty}` : ''}</div>`
                : '';

            div.innerHTML = `
              <div style="border:1.5px solid ${borderColor};border-radius:14px;padding:12px;background:var(--surface)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                  <span style="font-weight:800;font-size:15px">${slot.hour_slot}</span>
                  ${badge}
                </div>
                <div class="grid-2" style="font-size:13px;margin-bottom:8px">
                  <div><span class="muted">Sup Good</span><br><b>${supGood}</b></div>
                  <div><span class="muted">Sup Reject</span><br><b>${supRej}</b></div>
                </div>
                ${verifiedLine}
                <div id="vfy-form-${slot.hour_slot.replace('-','_')}" class="${verified ? 'hidden' : ''}">
                  <div class="grid-2" style="gap:8px;margin-top:8px">
                    <label style="margin:0">QC Good
                      <input type="number" id="vfy-good-${slot.hour_slot.replace('-','_')}"
                        value="${slot.qc_good_qty ?? supGood}" min="0" inputmode="numeric"
                        style="margin-top:4px">
                    </label>
                    <label style="margin:0">QC Reject
                      <input type="number" id="vfy-rej-${slot.hour_slot.replace('-','_')}"
                        value="${slot.qc_reject_qty ?? supRej}" min="0" inputmode="numeric"
                        style="margin-top:4px">
                    </label>
                  </div>
                  <input type="text" id="vfy-rmk-${slot.hour_slot.replace('-','_')}"
                    placeholder="Remarks (optional)" style="margin-top:8px">
                  <button class="primary" style="width:100%;margin-top:8px"
                    onclick="submitVerify(${JSON.stringify(slot).replace(/"/g,'&quot;')}, '${machine}', '${date}', '${shift}', this)">
                    ✓ Verify This Slot
                  </button>
                </div>
                ${verified ? `<button class="small ghost" style="margin-top:6px;width:100%"
                    onclick="this.closest('div').parentElement.querySelector('[id^=vfy-form]').classList.toggle('hidden')">
                    Re-verify</button>` : ''}
              </div>`;
            return div;
        }

        function submitVerify(slot, machine, date, shift, btn) {
            const key   = slot.hour_slot.replace('-','_');
            const good  = parseInt(el('vfy-good-'+key)?.value, 10);
            const rej   = parseInt(el('vfy-rej-'+key)?.value,  10);
            const rmk   = el('vfy-rmk-'+key)?.value || '';
            if (isNaN(good) || isNaN(rej)) return alert('Enter both Good Qty and Reject Qty.');
            btn.disabled = true; btn.textContent = 'Saving…';
            fetch('/api/qc/verify/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session,
                    machine, dpr_date: date, shift, hour_slot: slot.hour_slot,
                    dpr_entry_id: slot.dpr_entry_id,
                    qc_good_qty: good, qc_reject_qty: rej,
                    sup_good_qty: slot.sup_good_qty, sup_reject_qty: slot.sup_reject_qty,
                    sup_shots: slot.sup_shots, remarks: rmk
                })
            }).then(r => r.json()).then(r => {
                if (r.ok) { loadVerifySlots(); checkVerifyPending(); }
                else { alert('Error: ' + r.error); btn.disabled = false; btn.textContent = '✓ Verify This Slot'; }
            }).catch(() => { btn.disabled = false; btn.textContent = '✓ Verify This Slot'; });
        }

        function updateVerifyBadge(slots) {
            const pending = slots.filter(s => !s.qc_verified).length;
            const badge = el('verify-badge');
            if (!badge) return;
            if (pending > 0) {
                badge.textContent = pending;
                badge.classList.remove('hidden');
                badge.style.display = 'inline-flex';
            } else {
                badge.classList.add('hidden');
            }
        }

        function checkVerifyPending() {
            const machine = session.machine || (el('dd-machine') ? el('dd-machine').value : '');
            if (!machine) return;
            const date  = new Date().toISOString().split('T')[0];
            const shift = getShiftFromTime();
            fetch(`/api/qc/verify/pending?machine=${encodeURIComponent(machine)}&date=${date}&shift=${encodeURIComponent(shift)}`)
                .then(r => r.json())
                .then(r => {
                    if (!r.ok) return;
                    const now = new Date();
                    const overdue = (r.data || []).filter(s => !s.qc_verified && isSlotOverdue(s.hour_slot, shift, now.getHours()));
                    const banner  = el('verify-banner');
                    const msg     = el('verify-banner-msg');
                    if (!banner) return;
                    if (overdue.length) {
                        const slots = overdue.map(s => s.hour_slot).join(', ');
                        if (msg) msg.textContent = `${overdue.length} slot${overdue.length>1?'s':''} overdue: ${slots}`;
                        banner.classList.remove('hidden');
                        banner.style.display = 'flex';
                    } else {
                        banner.classList.add('hidden');
                    }
                    updateVerifyBadge(r.data || []);
                })
                .catch(() => {});
        }

        /* ================================================================
           FPA — enhanced image capture with compression
           ================================================================ */
        const fpaProductBlobs = [];   // Array of { blob, url } for product reference images
        const FPA_MAX_PX   = 1280;
        const FPA_QUALITY  = 0.82;
        const FPA_MAX_IMGS = 6;

        let fpaFormBlob = null;  // Single form image blob

        async function compressImage(file) {
            return new Promise(resolve => {
                const img = new Image();
                const fr  = new FileReader();
                fr.onload = e => { img.src = e.target.result; };
                img.onload = () => {
                    const scale = Math.min(1, FPA_MAX_PX / Math.max(img.width, img.height));
                    const w = Math.round(img.width * scale);
                    const h = Math.round(img.height * scale);
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    c.toBlob(blob => resolve(blob), 'image/jpeg', FPA_QUALITY);
                };
                fr.readAsDataURL(file);
            });
        }

        async function fpaFormImageChanged(input) {
            if (!input.files || !input.files[0]) return;
            const blob = await compressImage(input.files[0]);
            fpaFormBlob = blob;
            const url = URL.createObjectURL(blob);
            const preview = el('fpa-form-preview');
            const placeholder = el('fpa-form-placeholder');
            if (preview) { preview.src = url; preview.style.display = 'block'; }
            if (placeholder) placeholder.style.display = 'none';
        }

        async function fpaProductImageCaptured(input) {
            if (!input.files || !input.files[0]) return;
            if (fpaProductBlobs.length >= FPA_MAX_IMGS) {
                alert('Maximum ' + FPA_MAX_IMGS + ' product images allowed.');
                return;
            }
            const blob = await compressImage(input.files[0]);
            const url  = URL.createObjectURL(blob);
            fpaProductBlobs.push({ blob, url });
            renderFPAProductGrid();
            input.value = '';  // reset so same image can be re-captured
        }

        function renderFPAProductGrid() {
            const grid = el('fpa-product-grid');
            if (!grid) return;
            grid.innerHTML = '';
            fpaProductBlobs.forEach((item, i) => {
                const cell = document.createElement('div');
                cell.style.cssText = 'position:relative;width:100%;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--line)';
                cell.innerHTML = `
                  <img src="${item.url}" style="width:100%;height:100%;object-fit:cover">
                  <button onclick="removeFPAProductImage(${i})" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;min-height:0;box-shadow:none">✕</button>`;
                grid.appendChild(cell);
            });
            // Add + button if under max
            if (fpaProductBlobs.length < FPA_MAX_IMGS) {
                const add = document.createElement('div');
                add.style.cssText = 'width:100%;aspect-ratio:1;border:2px dashed var(--line-bright);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:#fff;font-size:22px;color:var(--muted)';
                add.innerHTML = '+<span style="font-size:10px;margin-top:2px">Capture</span>';
                add.onclick = () => el('fpa-product-input').click();
                grid.appendChild(add);
            }
            const countEl = el('fpa-img-count');
            if (countEl) countEl.textContent = fpaProductBlobs.length + ' / ' + FPA_MAX_IMGS + ' images';
        }

        function removeFPAProductImage(idx) {
            URL.revokeObjectURL(fpaProductBlobs[idx].url);
            fpaProductBlobs.splice(idx, 1);
            renderFPAProductGrid();
        }

        /* Override submitFPA to use compressed blobs */
        const _origSubmitFPA = typeof submitFPA === 'function' ? submitFPA : null;
        submitFPA = async function() {
            if (fpaProductBlobs.length < 2) {
                return alert('Please capture at least 2 product reference images.');
            }
            const slot  = el('fpa-slot')?.value  || '';
            const shift = el('fpa-shift')?.value || getShiftFromTime();
            const date  = el('fpa-date')?.value  || new Date().toISOString().split('T')[0];
            const rmk   = el('fpa-remarks')?.value || '';
            const job   = session.activeJob || {};
            const all   = job._all || {};
            const msgEl = el('fpa-msg');
            if (msgEl) { msgEl.textContent = 'Uploading…'; msgEl.className = 'muted'; }

            const fd = new FormData();
            fd.append('session',   JSON.stringify(session));
            fd.append('date',      date);
            fd.append('shift',     shift);
            fd.append('slot',      slot);
            fd.append('remarks',   rmk);
            fd.append('plan_id',   safe(job.PlanID || all['PlanID'] || ''));
            fd.append('job_card_no', safe(job.JobCardNo || all['JobCardNo'] || ''));
            fd.append('order_no',  safe(job.OrderNo || all['OrderNo'] || ''));
            fd.append('machine',   session.machine || '');
            fd.append('line',      session.line    || '');
            fd.append('item_name', safe(all['SFG Name'] || all['Item Name'] || ''));
            fd.append('mould_name',safe(job.Mould   || all['Mould Name']  || ''));

            if (fpaFormBlob) {
                fd.append('fpa_form_image', fpaFormBlob, 'fpa-form.jpg');
            }
            fpaProductBlobs.forEach((item, i) => {
                fd.append('fpa_product_images', item.blob, `product-${i+1}.jpg`);
            });

            try {
                const res = await fetch('/api/qc/fpa', { method: 'POST', body: fd });
                const r   = await res.json();
                if (r.ok) {
                    if (msgEl) { msgEl.textContent = '✓ FPA Submitted at ' + new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); msgEl.className = 'ok'; }
                    // Reset images
                    fpaProductBlobs.forEach(i => URL.revokeObjectURL(i.url));
                    fpaProductBlobs.length = 0;
                    fpaFormBlob = null;
                    const p = el('fpa-form-preview'); if (p) { p.style.display='none'; p.src=''; }
                    const ph = el('fpa-form-placeholder'); if (ph) ph.style.display='';
                    renderFPAProductGrid();
                } else {
                    if (msgEl) { msgEl.textContent = 'Error: ' + r.error; msgEl.className = 'err'; }
                }
            } catch (e) {
                if (msgEl) { msgEl.textContent = 'Upload failed. Check connection.'; msgEl.className = 'err'; }
            }
        };

        /* Init FPA grid on page load */
        renderFPAProductGrid();

        /* ================================================================
           INIT — auto-set verify shift on load
           ================================================================ */
        document.addEventListener('DOMContentLoaded', () => {
            const vs = el('vfy-shift');
            if (vs) vs.value = getShiftFromTime();
        });