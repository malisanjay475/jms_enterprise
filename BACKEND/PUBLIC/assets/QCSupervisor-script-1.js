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