/*
 * DPR job popup: the calculations only (no DOM), so they can be tested in Jest.
 *   window.DprJobAnalysis / require('../PUBLIC/assets/dpr-job-analysis.js')
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DprJobAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const HOUR = 3600000;
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const SLOTS = ['07-08', '08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07'];

    /** Real end time of an hour slot. Day starts 07:00, Night 19:00 and runs past midnight. */
    function slotEnd(dateStr, shift, slot) {
        const i = SLOTS.indexOf(String(slot || '').trim());
        const base = new Date(String(dateStr || '').split('T')[0] + 'T00:00:00');
        if (i < 0 || Number.isNaN(base.getTime())) return 0;
        base.setHours((String(shift) === 'Night' ? 20 : 8) + i, 0, 0, 0);
        return base.getTime();
    }

    /** One bucket per machine hour, oldest first. Colour-change rows of one hour are added up. */
    function hourly(logs) {
        const map = new Map();
        (Array.isArray(logs) ? logs : []).forEach((l) => {
            if (!l) return;
            const ts = slotEnd(l.date, l.shift, l.hour_slot);
            if (!ts) return;
            const key = [l.date, l.shift, l.hour_slot, l.machine || ''].join('|');
            const b = map.get(key) || { ts, date: l.date, shift: l.shift, slot: l.hour_slot, machine: l.machine || '', hours: 1, good: 0, rej: 0, dt: 0 };
            b.good += num(l.good_qty); b.rej += num(l.reject_qty); b.dt += num(l.downtime_min);
            map.set(key, b);
        });
        const out = [...map.values()].sort((a, b) => a.ts - b.ts);
        out.forEach((b) => { b.dt = Math.min(60, b.dt); });
        return out;
    }

    /** Hour buckets grouped per date + shift. */
    function byShift(hours) {
        const map = new Map();
        hours.forEach((h) => {
            const key = h.date + '|' + h.shift;
            const s = map.get(key) || { ts: h.ts, date: h.date, shift: h.shift, hours: 0, good: 0, rej: 0, dt: 0 };
            s.hours += 1; s.good += h.good; s.rej += h.rej; s.dt += h.dt;
            map.set(key, s);
        });
        return [...map.values()].sort((a, b) => a.ts - b.ts);
    }

    /** STD pieces per hour from the mould master (cycle time and cavity). */
    function targetPerHour(info) {
        const cycle = num(info && info.std_cycle), cav = num(info && info.std_cavity);
        return cycle > 0 && cav > 0 ? (3600 / cycle) * cav : 0;
    }

    /** Where the logged machine hours went. Every hour is in exactly one part. */
    function timeUse(hours, target) {
        const t = { hours: 0, good: 0, rej: 0, dt: 0 };
        hours.forEach((h) => { t.hours += h.hours; t.good += h.good; t.rej += h.rej; t.dt += h.dt; });
        const down = t.dt / 60, running = Math.max(0, t.hours - down), made = t.good + t.rej;
        const r = {
            hours: t.hours, good: t.good, rej: t.rej, downHours: down, runHours: running,
            availability: t.hours > 0 ? running / t.hours : null,
            quality: made > 0 ? t.good / made : null,
            goodPerHour: t.hours > 0 ? t.good / t.hours : 0,
            speed: null, oee: null, parts: null
        };
        if (target > 0 && t.hours > 0) {
            r.speed = running > 0 ? made / (target * running) : null;
            r.oee = t.good / (target * t.hours);
            // Faster than STD: scale so the parts still add up to the logged hours.
            const ideal = made / target, k = ideal > running && ideal > 0 ? running / ideal : 1;
            r.parts = { good: (t.good / target) * k, reject: (t.rej / target) * k, slow: Math.max(0, running - ideal), down };
        }
        return r;
    }

    /**
     * Finish estimate. Pace = good pieces over the last 8 logged hours, stopped hours
     * included; "best" = the same balance at STD.
     */
    function forecast(hours, balance, target, now) {
        if (!(balance > 0)) return null;
        const last = hours.slice(-8);
        const pace = last.length ? last.reduce((a, h) => a + h.good, 0) / last.length : 0;
        const lastTs = last.length ? last[last.length - 1].ts : 0;
        return {
            pace, paceHours: last.length, lastTs,
            silentHours: lastTs ? Math.max(0, (now - lastTs) / HOUR) : null,
            hoursLeft: pace > 0 ? balance / pace : null,
            finish: pace > 0 ? now + (balance / pace) * HOUR : null,
            bestHours: target > 0 ? balance / target : null,
            bestFinish: target > 0 ? now + (balance / target) * HOUR : null
        };
    }

    const top = (stats) => {
        const rows = Object.entries(stats || {}).map(([reason, v]) => ({ reason, v: num(v) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
        const total = rows.reduce((a, r) => a + r.v, 0);
        return rows.length ? { reason: rows[0].reason, v: rows[0].v, share: rows[0].v / total } : null;
    };
    const pct = (f, d) => (f * 100).toFixed(d === undefined ? 1 : d) + '%';
    const n0 = (v) => Math.round(v).toLocaleString('en-IN');

    /** Plain-language findings, worst first. level: bad | warn | info */
    function findings(x) {
        const out = [];
        const add = (level, title, text) => out.push({ level, title, text });
        const info = x.info || {}, use = x.use, hours = x.hours || [], target = x.target || 0;
        const made = use.good + use.rej, rejRate = made > 0 ? use.rej / made : 0;
        const wtAct = num(info.act_weight), wtStd = num(info.std_weight);
        // A setup saved in grams against a kg standard must not become "1000x heavier".
        const wtSane = wtAct > 0 && wtStd > 0 && wtAct / wtStd > 0.5 && wtAct / wtStd < 2;

        if (rejRate >= 0.03) {
            const r = top(x.rejStats);
            add(rejRate >= 0.08 ? 'bad' : 'warn', `Reject is ${pct(rejRate)}`,
                `${n0(use.rej)} pcs rejected${wtSane ? ` (about ${n0(use.rej * wtAct)} kg)` : ''}.${r ? ` Biggest reason: ${r.reason}, ${pct(r.share, 0)} of all rejects.` : ''}`);
        }
        if (hours.length >= 16) {
            const rate = (list) => {
                const g = list.reduce((a, h) => a + h.good, 0), j = list.reduce((a, h) => a + h.rej, 0);
                return g + j > 0 ? j / (g + j) : 0;
            };
            const recent = rate(hours.slice(-8)), before = rate(hours.slice(0, -8));
            if (recent >= 0.05 && recent > before * 1.5) add('bad', 'Reject is getting worse', `${pct(recent)} in the last 8 hours, ${pct(before)} before that.`);
        }
        if (use.availability !== null && use.hours >= 4 && use.availability < 0.85) {
            const d = top(x.dtStats);
            add(use.availability < 0.7 ? 'bad' : 'warn', `Machine stopped ${pct(1 - use.availability, 0)} of the time`,
                `${use.downHours.toFixed(1)} of ${n0(use.hours)} logged hours.${d ? ` Biggest reason: ${d.reason}, ${n0(d.v)} min.` : ''}${target ? ` Cost about ${n0(use.downHours * target)} pcs.` : ''}`);
        }
        if (use.speed !== null && use.runHours >= 4) {
            if (use.speed < 0.9) add('warn', `Running at ${pct(use.speed, 0)} of STD speed`, `Slow running took ${use.parts.slow.toFixed(1)} hours. Check the cycle time, and that all downtime is entered.`);
            else if (use.speed > 1.1) add('info', `Running faster than STD (${pct(use.speed, 0)})`, 'The STD cycle time in the mould master may be too long, or too much downtime is entered.');
        }
        const cs = num(info.std_cycle), ca = num(info.act_cycle);
        if (cs > 0 && ca > cs * 1.1) add('warn', 'Setup cycle is slower than STD', `${ca} s set, STD ${cs} s.`);
        if (cs > 0 && ca > 0 && ca < cs * 0.9 && target && use.hours > 0) {
            const capable = (3600 / ca) * (num(info.act_cavity) || num(info.std_cavity) || 1);
            add('info', 'Setup cycle is faster than STD', `${ca} s set, STD ${cs} s. That could give ${n0(capable)} pcs/hr; the job makes ${n0(use.goodPerHour)} good pcs/hr.`);
        }
        if (num(info.act_cavity) > 0 && num(info.act_cavity) < num(info.std_cavity)) {
            add('bad', 'Cavities are blocked', `Running ${num(info.act_cavity)} of ${num(info.std_cavity)} cavities.`);
        }
        if (wtSane && Math.abs(wtAct / wtStd - 1) >= 0.02) {
            const diff = wtAct - wtStd;
            add(Math.abs(diff / wtStd) > 0.05 ? 'bad' : 'warn', `Part is ${pct(Math.abs(diff) / wtStd)} ${diff > 0 ? 'heavier' : 'lighter'} than STD`,
                diff > 0 ? `About ${n0(diff * made)} kg extra material used so far.` : 'Check for short filling and the customer weight limit.');
        }
        const sh = { Day: { h: 0, g: 0 }, Night: { h: 0, g: 0 } };
        hours.forEach((h) => { const s = sh[h.shift]; if (s) { s.h += 1; s.g += h.good; } });
        if (sh.Day.h >= 6 && sh.Night.h >= 6) {
            const d = sh.Day.g / sh.Day.h, n = sh.Night.g / sh.Night.h, hi = Math.max(d, n), lo = Math.min(d, n);
            if (hi > 0 && lo < hi * 0.8) add('warn', `${d < n ? 'Day' : 'Night'} shift makes ${pct(1 - lo / hi, 0)} less`, `Day ${n0(d)} pcs/hr, Night ${n0(n)} pcs/hr.`);
        }
        const rank = { bad: 0, warn: 1, info: 2 };
        return out.sort((a, b) => rank[a.level] - rank[b.level]);
    }

    return { SLOTS, slotEnd, hourly, byShift, targetPerHour, timeUse, forecast, findings };
});
