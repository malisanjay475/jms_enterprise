/*
 * DPR job popup: one job, whole life (all dates, all machines it ran on).
 * Sections: header, progress, findings, machine time, trend, reasons, colours, setup,
 * dates, shifting. The QC section stays in dpr-script-2.js (loadJobQCEvidence).
 * Calculations: dpr-job-analysis.js. Data: /api/analyze/order and /api/shifting/availability.
 * Uses dprEsc / dprNumber / dprFmtQty / dprFmtDate from dpr-script-2.js.
 */
(function () {
    'use strict';
    const A = window.DprJobAnalysis;
    const esc = dprEsc, qty = dprFmtQty, num = dprNumber;
    const state = { token: 0, data: null, ship: null, shipError: '', details: {}, view: 'hour', colour: '' };
    const $ = (id) => document.getElementById(id);
    const pct = (f, d) => (f === null || f === undefined) ? '–' : (f * 100).toFixed(d === undefined ? 1 : d) + '%';
    const key = (v) => String(v || '').trim().toLowerCase();
    const dayMon = (d) => new Date(String(d).split('T')[0] + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const stamp = (ts) => new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const span = (h) => h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hrs`;
    const val = (v, unit) => (v === null || v === undefined || v === '' || Number(v) === 0) ? '–' : `${v}${unit || ''}`;

    // ── Open / close ─────────────────────────────────────────────────────────
    function showJobDetails(details, orderNo) {
        if (!details || Object.keys(details).length === 0) {
            if (orderNo) alert('Details not available for this job.');
            return;
        }
        const d = details;
        Object.assign(state, { token: state.token + 1, data: null, ship: null, shipError: '', details: d, view: '', colour: '' });

        // Delete Setup allowed for admin/superadmin + planner, ppc_ass_manager, ppc_manager.
        const del = $('btnDeleteSetup');
        const canDel = !!(window.canDeleteDprEntry && window.canDeleteDprEntry()) && d.id;
        del.style.display = canDel ? '' : 'none';
        window.currentSetupId = canDel ? d.id : null;

        renderHeader({}, d, orderNo);
        $('jdStatus').innerHTML = '';
        $('jdMain').innerHTML = '<div class="jd-card jd-note">Loading job…</div>';
        $('jdBody').scrollTop = 0;
        $('jobDetailModal').style.display = 'flex';
        loadJobQCEvidence(d);
        load(d, d.order_no || orderNo || '', state.token);
    }

    function closeJobModal() {
        state.token += 1; // answers still on the way belong to a closed popup
        $('jobDetailModal').style.display = 'none';
        closeJobImage();
    }

    async function load(d, orderNo, token) {
        const planId = d.plan_id || d.PlanID || '';
        const qs = new URLSearchParams({ mode: 'overall' });
        // A plan moved to another machine keeps its plan id, so the machine is only needed
        // when there is no plan id; filtering by it hid what the first machine made.
        if (planId) qs.set('planId', planId);
        else if (d.machine) qs.set('machine', d.machine);
        const sq = new URLSearchParams();
        if (planId) sq.set('plan_id', planId);
        else { sq.set('order_no', orderNo); if (d.machine) sq.set('machine', d.machine); }

        const shipReq = window.JPSMS.api.get(`/shifting/availability?${sq}`)
            .then((r) => { if (!r || !r.ok) throw new Error((r && r.error) || 'not available'); return r.data || {}; });
        shipReq.catch(() => {}); // handled below; no unhandled rejection if the job itself fails
        try {
            if (!orderNo) throw new Error('This job has no order number.');
            const ans = await window.JPSMS.api.get(`/analyze/order/${encodeURIComponent(orderNo)}?${qs}`);
            if (token !== state.token) return;
            if (!ans || !ans.ok || !ans.data) throw new Error((ans && ans.error) || 'No data.');
            state.data = ans.data;
        } catch (e) {
            if (token !== state.token) return;
            $('jdMain').innerHTML = `<div class="jd-card jd-error">Job details could not be loaded: ${esc(e.message || e)}</div>`;
            return;
        }
        renderAll(); // production first; QC and shifting figures fill in when they arrive
        try { const s = await shipReq; if (token !== state.token) return; state.ship = s; }
        catch (e) { if (token !== state.token) return; state.shipError = String(e.message || e); }
        renderAll();
    }

    // ── Header ───────────────────────────────────────────────────────────────
    function renderHeader(info, d, orderNo) {
        const title = info.product_name || info.item_name || d.product_name || d.item_name || info.mould_name || d.mould_name || '-';
        $('jdTitle').textContent = title;
        const mould = info.mould_name || d.mould_name || '';
        const items = [
            ['OR', info.order_no || d.order_no || orderNo],
            ['JC', info.job_card_no || d.job_card_no],
            ['Machine', info.machine || d.machine],
            ['Mould', key(mould) === key(title) ? '' : mould],
            ['Client', info.client_name || d.client_name]
        ].filter((x) => x[1]);
        $('jdMeta').innerHTML = items.map(([l, v]) => `<span>${l} <b>${esc(v)}</b></span>`).join('');
    }

    function renderStatus(info, plan, good) {
        const st = String(info.status || '').trim().toUpperCase();
        let cls = 'idle', text = st ? st.charAt(0) + st.slice(1).toLowerCase() : 'Unknown';
        if (['COMPLETED', 'CLOSED'].includes(st)) cls = 'done';
        else if (st === 'RUNNING') cls = 'run';
        else if (/STOP|HOLD|CANCEL|REJECT/.test(st)) cls = 'bad';
        let extra = '';
        if (plan > 0 && good > plan) extra = `<span class="jd-status over">Over by ${qty(good - plan)}</span>`;
        else if (plan > 0 && good === plan && cls === 'run') extra = '<span class="jd-status done">Plan made</span>';
        $('jdStatus').innerHTML = `<span class="jd-status ${cls}">${esc(text)}</span>${extra}`;
    }

    // ── Everything ───────────────────────────────────────────────────────────
    function model() {
        const data = state.data, info = { ...(data.info || {}) }, d = state.details;
        // Older plans can miss the setup on the backend answer; the clicked row has it.
        info.std_cycle = info.std_cycle || d.std_cycle_time || d.std_cycle;
        info.std_weight = info.std_weight || d.std_weight;
        info.std_cavity = info.std_cavity || d.std_cavity || d.cavity;
        info.act_cycle = info.act_cycle || d.act_cycle || d.cycle_act;
        info.act_weight = info.act_weight || d.act_weight || d.article_act;
        info.act_cavity = info.act_cavity || d.act_cavity || d.cavity_act;
        const t = data.totals || {};
        const plan = num(t.plan) || num(info.plan_qty), good = num(t.good), rej = num(t.rej);
        const hours = A.hourly(data.logs), target = A.targetPerHour(info);
        const use = A.timeUse(hours, target);
        return { data, info, plan, good, rej, balance: plan - good, hours, target, use, fc: A.forecast(hours, plan - good, target, Date.now()) };
    }

    function renderAll() {
        const m = model();
        renderHeader(m.info, state.details);
        renderStatus(m.info, m.plan, m.good);
        if (!state.view) state.view = m.hours.length > 48 ? 'shift' : 'hour';
        const top = $('jdBody').scrollTop;
        $('jdMain').innerHTML = [
            progressHtml(m), findingsHtml(m), timeHtml(m),
            '<section class="jd-card" id="jdTrend"></section>',
            `<div class="jd-two">${reasonsHtml('Downtime reasons', m.data.downtime_stats, 'min', 'down', m)}${reasonsHtml('Reject reasons', m.data.rejection_stats, 'pcs', 'rej', m)}</div>`,
            coloursHtml(m),
            `<div class="jd-two">${setupHtml(m)}${datesHtml(m)}</div>`,
            shiftingHtml()
        ].join('');
        renderTrend(m);
        $('jdBody').scrollTop = top;
    }

    // ── 1. Progress ──────────────────────────────────────────────────────────
    function progressHtml(m) {
        const s = state.ship, t = s && s.totals;
        const f = m.plan > 0 ? m.good / m.plan : 0;
        const base = Math.max(m.plan, m.good, 1);
        const row = (label, v, cls, note, noteCls) => `<div class="jd-flow-row">
            <span class="jd-flow-label">${label}</span>
            <span class="jd-track"><i class="${cls}" style="width:${Math.min(100, (num(v) / base) * 100).toFixed(1)}%"></i></span>
            <b>${qty(v)}</b><span class="jd-flow-note ${noteCls || ''}">${note}</span></div>`;
        const blank = (label) => `<div class="jd-flow-row"><span class="jd-flow-label">${label}</span><span class="jd-track"></span><b>–</b><span class="jd-flow-note">${state.shipError ? 'not available' : 'loading…'}</span></div>`;
        const left = m.balance > 0 ? `${qty(m.balance)} to make` : m.balance < 0 ? `${qty(-m.balance)} over plan` : 'plan made';
        let flow = row('Produced', m.good, 'c-good', left, m.balance > 0 ? 'warn' : '');
        if (t) {
            const enforcedNote = s.verification_enforced ? '' : ' (factory server has the full figure)';
            flow += row('QC verified', t.verified, 'c-qc', (t.not_verified > 0 ? `${qty(t.not_verified)} waiting for QC` : 'all checked') + enforcedNote, t.not_verified > 0 ? 'warn' : '');
            flow += row('Shifted', t.shifted, 'c-ship', t.ready > 0 ? `${qty(t.ready)} ready to shift` : 'nothing waiting', t.ready > 0 ? 'warn' : '');
        } else flow += blank('QC verified') + blank('Shifted');

        const orq = num(m.info.or_qty);
        const facts = [
            ['Plan', qty(m.plan), orq && orq !== m.plan ? `of OR ${qty(orq)}` : ''],
            ['Produced', qty(m.good), pct(f) + ' of plan', 'good'],
            [m.balance < 0 ? 'Over plan' : 'Balance', qty(Math.abs(m.balance)), m.balance < 0 ? 'extra pieces' : m.balance === 0 ? 'done' : pct(m.plan > 0 ? m.balance / m.plan : 0) + ' left', m.balance > 0 ? 'warn' : ''],
            ['Reject', qty(m.rej), pct(m.good + m.rej > 0 ? m.rej / (m.good + m.rej) : 0) + ' of all made', m.rej > 0 ? 'bad' : ''],
            ['On shop floor', t ? qty(Math.max(num(t.produced) - num(t.shifted), 0)) : '–', 'made, not shifted']
        ];
        const hold = s && s.hold;
        return `<section class="jd-card jd-progress">
            ${hold ? `<div class="jd-hold"><i class="bi bi-octagon-fill"></i> QC hold on ${esc(s.machine)}${hold.qty > 0 ? ` (${qty(hold.qty)} pcs)` : ''}: ${esc((hold.reasons || []).join('; ') || 'no reason given')}</div>` : ''}
            <div class="jd-facts">${facts.map(([l, v, n, c]) => `<div><span>${l}</span><b class="${c || ''}">${v}</b><em>${n}</em></div>`).join('')}</div>
            <div class="jd-flow">${flow}</div>
            ${forecastHtml(m)}
        </section>`;
    }

    function forecastHtml(m) {
        const st = String(m.info.status || '').toUpperCase(), fc = m.fc;
        if (['COMPLETED', 'CLOSED'].includes(st) || !fc) {
            const last = m.hours.length ? m.hours[m.hours.length - 1].ts : 0;
            return last && (m.balance <= 0 || st === 'COMPLETED' || st === 'CLOSED')
                ? `<div class="jd-finish done"><div><span>Last production</span><b>${stamp(last)}</b></div><p>${m.balance > 0 ? `Closed with ${qty(m.balance)} pcs not made.` : 'The planned quantity is made.'}</p></div>` : '';
        }
        if (!fc.paceHours) return `<div class="jd-finish"><div><span>Not started</span><b>${fc.bestHours ? `Needs ${span(fc.bestHours)} at STD` : 'No production yet'}</b></div><p></p></div>`;
        const live = st === 'RUNNING' && fc.silentHours < 4;
        const late = fc.hoursLeft === null || (fc.bestHours && fc.hoursLeft > fc.bestHours * 1.3);
        if (!live) {
            return `<div class="jd-finish late"><div><span>No finish time</span><b>Last entry ${stamp(fc.lastTs)}</b></div>
                <p>${qty(m.balance)} pcs left.${fc.bestHours ? ` Needs ${span(fc.bestHours)} at STD` : ''}${fc.hoursLeft ? `, ${span(fc.hoursLeft)} at its last pace.` : '.'}</p></div>`;
        }
        if (fc.finish === null) return `<div class="jd-finish late"><div><span>No finish time</span><b>No good pieces in the last ${fc.paceHours} hours</b></div><p>${qty(m.balance)} pcs left.${fc.bestHours ? ` Needs ${span(fc.bestHours)} at STD.` : ''}</p></div>`;
        return `<div class="jd-finish ${late ? 'late' : ''}">
            <div><span>Expected finish</span><b>${stamp(fc.finish)}</b></div>
            <p>${span(fc.hoursLeft)} left at ${qty(Math.round(fc.pace))} pcs/hr (last ${fc.paceHours} hours, stops included).${fc.bestFinish ? ` At STD ${qty(Math.round(m.target))} pcs/hr it would finish ${stamp(fc.bestFinish)}.` : ''}</p></div>`;
    }

    // ── 2. Findings ──────────────────────────────────────────────────────────
    function findingsHtml(m) {
        if (!m.hours.length) return '';
        const list = A.findings({ info: m.info, hours: m.hours, use: m.use, target: m.target, rejStats: m.data.rejection_stats, dtStats: m.data.downtime_stats });
        const icon = { bad: 'bi-exclamation-octagon-fill', warn: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
        return `<section class="jd-card"><div class="jd-head"><h4>What needs attention</h4></div>
            ${list.length ? `<ul class="jd-find">${list.map((f) => `<li class="${f.level}"><i class="bi ${icon[f.level]}"></i><div><b>${esc(f.title)}</b><p>${esc(f.text)}</p></div></li>`).join('')}</ul>`
                : '<div class="jd-note">Nothing unusual. Reject, downtime, speed and weight are within limits.</div>'}</section>`;
    }

    // ── 3. Machine time ──────────────────────────────────────────────────────
    function timeHtml(m) {
        const u = m.use;
        if (!u.hours) return '';
        const tile = (l, v, n) => `<div><span>${l}</span><b>${v}</b><em>${n}</em></div>`;
        const tiles = `<div class="jd-facts jd-oee">
            ${tile('OEE', pct(u.oee, 0), u.oee === null ? 'no STD cycle' : 'good pcs against STD')}
            ${tile('Running time', pct(u.availability, 0), `${u.runHours.toFixed(1)} of ${qty(u.hours)} hrs`)}
            ${tile('Speed', pct(u.speed, 0), m.target ? `STD ${qty(Math.round(m.target))} pcs/hr` : 'no STD cycle')}
            ${tile('Quality', pct(u.quality, 0), `${qty(u.good)} good of ${qty(u.good + u.rej)}`)}
            ${tile('Good pcs/hr', qty(Math.round(u.goodPerHour)), 'average, stops included')}
        </div>`;
        let bar = '';
        if (u.parts) {
            const parts = [['Good pieces', u.parts.good, 'c-good'], ['Rejected pieces', u.parts.reject, 'c-rej'], ['Slow running', u.parts.slow, 'c-slow'], ['Stopped', u.parts.down, 'c-down']];
            bar = `<div class="jd-timebar" role="img" aria-label="${parts.map((p) => `${p[0]} ${p[1].toFixed(1)} hours`).join(', ')}">
                ${parts.map(([l, h, c]) => h > 0 ? `<i class="${c}" style="flex:${h.toFixed(3)}" title="${l}: ${h.toFixed(1)} hrs"></i>` : '').join('')}</div>
                <div class="jd-legend">${parts.map(([l, h, c]) => `<span><i class="${c}"></i>${l} <b>${h.toFixed(1)} h</b> ${pct(h / u.hours, 0)}</span>`).join('')}</div>`;
        }
        return `<section class="jd-card"><div class="jd-head"><h4>Where the machine time went</h4><span class="jd-note">${qty(u.hours)} hours with a DPR entry</span></div>${bar}${tiles}</section>`;
    }

    // ── 4. Trend ─────────────────────────────────────────────────────────────
    function renderTrend(m) {
        const box = $('jdTrend');
        if (!m.hours.length) { box.innerHTML = '<div class="jd-head"><h4>Production</h4></div><div class="jd-note">No production entered yet.</div>'; return; }
        const shiftView = state.view === 'shift';
        const all = shiftView ? A.byShift(m.hours) : m.hours;
        const MAX = 48, list = all.slice(-MAX);
        const W = 1000, L = 44, R = 10, T = 18, PH = 170, GAP = 12, DH = 44, X = 34;
        const H = T + PH + GAP + DH + X;
        const step = (W - L - R) / list.length, bw = Math.min(34, step * 0.66);
        const max = Math.max(1, ...list.map((b) => Math.max(b.good + b.rej, m.target * b.hours))) * 1.06;
        const y = (v) => T + PH - (v / max) * PH, dTop = T + PH + GAP, base = dTop + DH;
        const cx = (i) => L + i * step + step / 2;
        const labelEvery = Math.ceil(list.length / (shiftView ? 16 : 18));
        let g = '';
        [0, 0.5, 1].forEach((f) => {
            const v = (max / 1.06) * f;
            g += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"></line><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${qty(Math.round(v))}</text>`;
        });
        g += `<line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" class="grid"></line><text x="${L - 6}" y="${dTop + DH / 2 + 3}" text-anchor="end">Stop</text>`;
        let last = '';
        list.forEach((b, i) => {
            const x = cx(i) - bw / 2, dayKey = b.date + (shiftView ? '' : b.shift);
            if (dayKey !== last) {
                last = dayKey;
                const lx = L + i * step;
                g += `<line x1="${lx.toFixed(1)}" x2="${lx.toFixed(1)}" y1="${T}" y2="${base + 4}" class="day"></line><text x="${(lx + 3).toFixed(1)}" y="${H - 4}" class="strong">${dayMon(b.date)}${shiftView ? '' : ' ' + esc(b.shift)}</text>`;
            }
            const gh = (b.good / max) * PH, rh = (b.rej / max) * PH, dh = (b.dt / (60 * b.hours)) * DH;
            const name = shiftView ? `${dayMon(b.date)} ${b.shift} (${b.hours} hrs)` : `${dayMon(b.date)} ${b.shift} ${b.slot}`;
            const tip = `${name}\nGood ${qty(b.good)}${m.target ? ` (${pct(b.good / (m.target * b.hours), 0)} of STD)` : ''}\nReject ${qty(b.rej)}${b.good + b.rej ? ` (${pct(b.rej / (b.good + b.rej))})` : ''}\nStopped ${qty(b.dt)} min`;
            g += `<g class="bar"><title>${esc(tip)}</title><rect class="hit" x="${(L + i * step).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${base - T}"></rect>`
                + `<rect class="f-good" x="${x.toFixed(1)}" y="${(T + PH - gh).toFixed(1)}" width="${bw.toFixed(1)}" height="${gh.toFixed(1)}"></rect>`
                + (rh > 0 ? `<rect class="f-rej" x="${x.toFixed(1)}" y="${(T + PH - gh - rh - 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${rh.toFixed(1)}"></rect>` : '')
                + (dh > 0 ? `<rect class="f-down" x="${x.toFixed(1)}" y="${(base - dh).toFixed(1)}" width="${bw.toFixed(1)}" height="${dh.toFixed(1)}"></rect>` : '')
                + (m.target && shiftView ? `<line class="std" x1="${(x - 2).toFixed(1)}" x2="${(x + bw + 2).toFixed(1)}" y1="${y(m.target * b.hours).toFixed(1)}" y2="${y(m.target * b.hours).toFixed(1)}"></line>` : '')
                + '</g>';
            if (i % labelEvery === 0) g += `<text x="${cx(i).toFixed(1)}" y="${base + 15}" text-anchor="middle">${esc(shiftView ? b.shift : b.slot)}</text>`;
        });
        if (m.target && !shiftView) g += `<line class="std" x1="${L}" x2="${W - R}" y1="${y(m.target).toFixed(1)}" y2="${y(m.target).toFixed(1)}"></line><text x="${W - R}" y="${(y(m.target) - 4).toFixed(1)}" text-anchor="end" class="stdt">STD ${qty(Math.round(m.target))}/hr</text>`;

        const shifts = A.byShift(m.hours).reverse();
        box.innerHTML = `<div class="jd-head"><h4>Production</h4>
                <div class="jd-seg" role="group" aria-label="Chart view">
                    <button type="button" class="${shiftView ? '' : 'on'}" onclick="jdView('hour')">Hour by hour</button>
                    <button type="button" class="${shiftView ? 'on' : ''}" onclick="jdView('shift')">Shift by shift</button>
                </div></div>
            <div class="jd-legend"><span><i class="c-good"></i>Good</span><span><i class="c-rej"></i>Reject</span><span><i class="c-down"></i>Stopped time</span>${m.target ? '<span><i class="c-std"></i>STD</span>' : ''}</div>
            <div class="jd-scroll"><svg class="jd-chart" viewBox="0 0 ${W} ${H}">${g}</svg></div>
            ${all.length > MAX ? `<div class="jd-note">Last ${MAX} of ${all.length} ${shiftView ? 'shifts' : 'hours'}.</div>` : ''}
            <details class="jd-more"><summary>Shift table (${shifts.length})</summary><div class="jd-scroll"><table class="jd-table">
                <thead><tr><th>Shift</th><th class="r">Hours</th><th class="r">Good</th><th class="r">Pcs/hr</th>${m.target ? '<th class="r">Of STD</th>' : ''}<th class="r">Reject</th><th class="r">Reject %</th><th class="r">Stopped</th></tr></thead>
                <tbody>${shifts.map((s) => `<tr><td>${dayMon(s.date)} ${esc(s.shift)}</td><td class="r">${s.hours}</td><td class="r"><b>${qty(s.good)}</b></td><td class="r">${qty(Math.round(s.good / s.hours))}</td>${m.target ? `<td class="r">${pct(s.good / (m.target * s.hours), 0)}</td>` : ''}<td class="r">${qty(s.rej)}</td><td class="r">${pct(s.good + s.rej ? s.rej / (s.good + s.rej) : 0)}</td><td class="r">${qty(s.dt)} min</td></tr>`).join('')}</tbody></table></div></details>`;
    }
    function jdView(v) { state.view = v; if (state.data) renderTrend(model()); }

    // ── 5. Reasons ───────────────────────────────────────────────────────────
    function reasonsHtml(title, stats, unit, cls, m) {
        const rows = Object.entries(stats || {}).map(([r, v]) => ({ r, v: num(v) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
        const total = rows.reduce((a, x) => a + x.v, 0), top = rows.length ? rows[0].v : 1;
        const lost = cls === 'down' && m.target ? `, about ${qty(Math.round((total / 60) * m.target))} pcs` : '';
        return `<section class="jd-card"><div class="jd-head"><h4>${title}</h4><span class="jd-note">${rows.length ? `${qty(total)} ${unit}${lost}` : ''}</span></div>
            ${rows.length ? rows.map((x) => `<div class="jd-reason"><div><span>${esc(x.r)}</span><b>${qty(x.v)} <em>${pct(x.v / total, 0)}</em></b></div><span class="jd-track"><i class="c-${cls}" style="width:${((x.v / top) * 100).toFixed(1)}%"></i></span></div>`).join('')
                : '<div class="jd-note">None entered.</div>'}</section>`;
    }

    // ── 6. Colours (production + QC + shifting in one table) ─────────────────
    function coloursHtml(m) {
        const s = state.ship, stats = m.data.colour_stats || {};
        const ship = new Map((s && s.colours || []).map((c) => [key(c.colour), c]));
        const rows = Object.keys(stats).map((c) => ({ name: c, ...stats[c], s: ship.get(key(c)) }));
        rows.sort((a, b) => num(b.plan_qty) - num(a.plan_qty) || num(b.good_qty) - num(a.good_qty));
        const bal = (n) => n > 0 ? `<b class="warn">${qty(n)}</b>` : n === 0 ? '<b class="good">Done</b>' : `<b class="over">${qty(-n)} over</b>`;
        const cell = (c, f, cls) => c ? `<td class="r ${c[f] > 0 && cls ? cls : ''}">${qty(c[f])}</td>` : '<td class="r">–</td>';
        const t = s && s.totals;
        const un = s && s.unassigned && num(s.unassigned.shifted) > 0;
        return `<section class="jd-card"><div class="jd-head"><h4>Colours</h4><span class="jd-note">Click a produced figure for its hour-by-hour entries</span></div>
            <div class="jd-scroll"><table class="jd-table">
                <thead><tr><th>Colour</th><th class="r">Plan</th><th class="r">Produced</th><th class="r">Balance</th><th class="r">Reject</th><th class="r">QC verified</th><th class="r">Waiting QC</th><th class="r">Shifted</th><th class="r">Ready to shift</th></tr></thead>
                <tbody>${rows.length ? rows.map((r) => {
                    const p = num(r.plan_qty), g = num(r.good_qty), j = num(r.rej_qty);
                    return `<tr><td><b>${esc(r.name)}</b></td><td class="r">${p ? qty(p) : '–'}</td>
                        <td class="r"><button type="button" class="jd-link" data-c="${esc(r.name)}" onclick="openColourHistory(this.dataset.c)">${qty(g)}</button>${p ? `<span class="jd-track sm"><i class="c-good" style="width:${Math.min(100, (g / p) * 100).toFixed(1)}%"></i></span>` : ''}</td>
                        <td class="r">${p ? bal(p - g) : '–'}</td><td class="r ${j > 0 ? 'bad' : ''}">${qty(j)}${j > 0 ? ` <em>${pct(j / (g + j))}</em>` : ''}</td>
                        ${cell(r.s, 'verified')}${cell(r.s, 'not_verified', 'warn')}${cell(r.s, 'shifted')}${cell(r.s, 'ready', 'warn')}</tr>`;
                }).join('') : '<tr><td colspan="9" class="jd-note">No production entered yet.</td></tr>'}
                ${un ? `<tr><td>No colour (manual shift)</td><td colspan="6"></td><td class="r">${qty(s.unassigned.shifted)}</td><td></td></tr>` : ''}</tbody>
                ${rows.length > 1 || un ? `<tfoot><tr><td>Total</td><td class="r">${qty(m.plan)}</td><td class="r">${qty(m.good)}</td><td class="r">${bal(m.balance)}</td><td class="r">${qty(m.rej)}</td><td class="r">${t ? qty(t.verified) : '–'}</td><td class="r">${t ? qty(t.not_verified) : '–'}</td><td class="r">${t ? qty(t.shifted) : '–'}</td><td class="r">${t ? qty(t.ready) : '–'}</td></tr></tfoot>` : ''}
            </table></div>${historyHtml()}</section>`;
    }

    function historyHtml() {
        const c = state.colour;
        if (!c) return '<div id="jdHistory"></div>';
        const rows = ((state.data.history || {})[c] || []).slice()
            .sort((a, b) => A.slotEnd(b.date, b.shift, b.hour_slot) - A.slotEnd(a.date, a.shift, a.hour_slot));
        return `<div id="jdHistory" class="jd-history"><div class="jd-head"><h4>${esc(c)}: entries</h4><button type="button" class="jd-btn" onclick="closeColourHistory()">Hide</button></div>
            ${rows.length ? `<div class="jd-scroll jd-tall"><table class="jd-table"><thead><tr><th>Date</th><th>Shift</th><th>Hour</th><th>Machine</th><th class="r">Good</th><th class="r">Reject</th><th class="r">Stopped</th><th>Entered by</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td>${esc(dprFmtDate(r.date))}</td><td>${esc(r.shift || '-')}</td><td>${esc(r.hour_slot || '-')}</td><td>${esc(r.machine || '-')}</td><td class="r"><b>${qty(r.good)}</b></td><td class="r ${num(r.reject) > 0 ? 'bad' : ''}">${qty(r.reject)}</td><td class="r">${qty(r.downtime)} min</td><td>${esc(r.by || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="jd-note">No entries for this colour.</div>'}</div>`;
    }
    function swapHistory() {
        const el = $('jdHistory');
        if (el && state.data) { el.outerHTML = historyHtml(); if (state.colour) $('jdHistory').scrollIntoView({ block: 'nearest' }); }
    }
    function openColourHistory(colour) { state.colour = colour; swapHistory(); }
    function closeColourHistory() { state.colour = ''; swapHistory(); }

    // ── 7. Setup and dates ───────────────────────────────────────────────────
    function setupHtml(m) {
        const i = m.info;
        const row = (label, std, act, unit, badIf) => {
            const s = num(std), a = num(act), d = s > 0 && a > 0 ? (a - s) / s : null;
            return `<tr><td>${label}</td><td class="r">${esc(val(std, unit))}</td><td class="r"><b>${esc(val(act, unit))}</b></td><td class="r ${d !== null && badIf(d) ? 'bad' : ''}">${d === null ? '–' : Math.abs(d) < 0.0005 ? 'same' : (d > 0 ? '+' : '−') + pct(Math.abs(d))}</td></tr>`;
        };
        return `<section class="jd-card"><div class="jd-head"><h4>Setup</h4></div><table class="jd-table">
            <thead><tr><th></th><th class="r">STD</th><th class="r">Actual</th><th class="r">Difference</th></tr></thead><tbody>
            ${row('Cycle time', i.std_cycle, i.act_cycle, ' s', (d) => d > 0.1)}
            ${row('Part weight', i.std_weight, i.act_weight, ' kg', (d) => Math.abs(d) >= 0.02)}
            ${row('Cavities', i.std_cavity, i.act_cavity, '', (d) => d < 0)}
            </tbody></table></section>`;
    }

    function datesHtml(m) {
        const l = m.data.lifecycle || {}, g = l.gaps || {};
        const steps = [
            ['Order (OR)', l.or_date, null], ['Job card', l.jc_date, g.or_to_jc],
            ['Planned', l.plan_created || l.plan_date, g.jc_to_plan_created],
            ['First production', l.prod_start, g.plan_to_prod], ['Last production', l.prod_last, g.prod_span]
        ];
        const gap = (n) => n === null || n === undefined ? '' : n === 0 ? 'same day' : n > 0 ? `${n} day${n === 1 ? '' : 's'} later` : `${-n} day${n === -1 ? '' : 's'} earlier`;
        const machines = [...new Set(m.hours.map((h) => h.machine).filter(Boolean))];
        return `<section class="jd-card"><div class="jd-head"><h4>Dates</h4></div><ol class="jd-steps">
            ${steps.map(([n, d, x]) => `<li class="${d ? 'on' : ''}"><span>${n}</span><b>${d ? esc(dprFmtDate(d)) : '–'}</b><em>${d ? gap(x) : ''}</em></li>`).join('')}</ol>
            ${machines.length > 1 ? `<div class="jd-note">Ran on ${machines.length} machines: ${machines.map((x) => `${esc(x)} (${qty(m.hours.filter((h) => h.machine === x).reduce((a, h) => a + h.good, 0))})`).join(', ')}</div>` : ''}</section>`;
    }

    // ── 8. Shifting ──────────────────────────────────────────────────────────
    function shiftingHtml() {
        const s = state.ship;
        if (!s) return state.shipError ? `<section class="jd-card jd-error">QC and shifting figures could not be loaded: ${esc(state.shipError)}</section>` : '';
        const loc = (s.totals && s.totals.by_location) || [], recent = s.recent || [];
        if (!loc.length && !recent.length) return '';
        return `<section class="jd-card"><div class="jd-head"><h4>Shifting</h4></div>
            ${loc.length ? `<div class="jd-chips">${loc.map((l) => `<span>${esc(l.location)} <b>${qty(l.qty)}</b></span>`).join('')}</div>` : ''}
            ${recent.length ? `<details class="jd-more"><summary>Latest entries (${recent.length})</summary><div class="jd-scroll"><table class="jd-table"><thead><tr><th>When</th><th>Colour</th><th>To</th><th>Label</th><th>By</th><th class="r">Pcs</th><th class="r">Kg</th></tr></thead><tbody>
            ${recent.map((r) => `<tr><td>${r.at ? stamp(r.at) : '–'}</td><td>${esc(r.colour || 'Manual')}</td><td>${esc(r.location)}</td><td>${esc(r.label || 'Manual')}</td><td>${esc(r.by)}</td><td class="r"><b>${qty(r.qty)}</b></td><td class="r">${r.kg ? num(r.kg).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '–'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</section>`;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || $('jobDetailModal').style.display === 'none') return;
        if ($('modalJobImageViewer').style.display !== 'none') closeJobImage(); else closeJobModal();
    });

    Object.assign(window, { showJobDetails, closeJobModal, jdView, openColourHistory, closeColourHistory });
})();
