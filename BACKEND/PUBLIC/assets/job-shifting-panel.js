/*
 * Job "Production · QC · Shifting" panel — one block used by every job-details view
 * (DPR / QC Compliance job details, Shifting Supervisor). Reads
 * GET /api/shifting/availability (by plan id, or OR number + machine) and shows:
 *   totals (plan, produced, QC verified, not verified, shifted, ready on floor, QC hold),
 *   shifted qty per location, a colour-wise table with shifted-by-location per colour,
 *   and the latest shifting entries.
 *   window.JMSJobShifting.render(containerEl, { planId, orderNo, machine })
 */
(function () {
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
    const kgFmt = (n) => { const v = Math.round((Number(n) || 0) * 1000) / 1000; return v ? v.toLocaleString('en-IN') : ''; };
    const when = (t) => {
        if (!t) return '';
        const d = new Date(t);
        return isNaN(d) ? String(t) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    };
    const locChips = (list) => (list || []).length
        ? list.map(l => `<span style="display:inline-block; background:#eef2ff; color:#3730a3; border-radius:6px; padding:2px 7px; margin:2px 4px 2px 0; font-size:0.72rem; font-weight:700">${esc(l.location)}: ${fmt(l.qty)}</span>`).join('')
        : '<span style="color:#94a3b8; font-size:0.75rem">—</span>';

    function tile(label, value, color, bg) {
        return `<div style="background:${bg || '#f8fafc'}; border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px; min-width:0">
            <div style="font-size:0.66rem; font-weight:800; letter-spacing:0.4px; text-transform:uppercase; color:#64748b">${label}</div>
            <div style="font-size:1.15rem; font-weight:800; color:${color || '#0f172a'}">${value}</div>
        </div>`;
    }

    function html(d) {
        const t = d.totals || {};
        const hold = d.hold;
        const colours = d.colours || [];
        const recent = d.recent || [];
        // The plan's colour split often uses short names that don't match DPR colours.
        const showPlan = colours.some(c => c.plan_qty > 0);
        const th = 'padding:6px 8px; text-align:right; font-size:0.7rem; color:#475569; font-weight:800; text-transform:uppercase; border-bottom:1px solid #e2e8f0; white-space:nowrap';
        const td = 'padding:6px 8px; text-align:right; border-bottom:1px solid #f1f5f9; font-weight:700; white-space:nowrap';
        return `
        <div style="border:1px solid #cbd5e1; border-radius:12px; padding:12px; background:#fff">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px">
                <div style="font-weight:800; color:#0f172a; font-size:0.95rem"><i class="bi bi-truck"></i> Production · QC · Shifting</div>
                <div style="font-size:0.75rem; color:#64748b">${esc([d.machine, d.plan_code, d.status].filter(Boolean).join(' · '))}</div>
            </div>
            <div style="font-size:0.78rem; color:#334155; margin-bottom:8px">
                OR <b>${esc(d.order_no || '—')}</b> · JC <b>${esc(d.jc_no || '—')}</b> · Party <b>${esc(d.client_name || '—')}</b>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(105px, 1fr)); gap:8px">
                ${tile('Plan', fmt(d.plan_qty))}
                ${tile('Produced', fmt(t.produced))}
                ${tile('QC verified', fmt(t.verified), '#047857', '#ecfdf5')}
                ${tile('Not verified', fmt(t.not_verified), t.not_verified > 0 ? '#b91c1c' : '#0f172a', t.not_verified > 0 ? '#fef2f2' : '')}
                ${tile('Shifted', fmt(t.shifted), '#1d4ed8', '#eff6ff')}
                ${tile('Ready on floor', fmt(t.ready), t.ready > 0 ? '#047857' : '#0f172a')}
                ${tile('QC hold', hold ? (hold.qty > 0 ? fmt(hold.qty) : 'YES') : '0', hold ? '#b91c1c' : '#0f172a', hold ? '#fef2f2' : '')}
            </div>
            ${hold ? `<div style="margin-top:8px; background:#dc2626; color:#fff; border-radius:8px; padding:6px 10px; font-weight:700; font-size:0.8rem">QC HOLD on ${esc(d.machine)}: ${esc((hold.reasons || []).join('; ') || 'no reason given')}</div>` : ''}
            ${d.verification_enforced ? '' : '<div style="margin-top:6px; font-size:0.72rem; color:#b45309">QC verification data is kept on the factory server; verified figures here may be incomplete.</div>'}
            <div style="margin-top:10px; font-size:0.78rem"><b>Shifted to:</b> ${locChips(t.by_location)}</div>
            <div style="margin-top:10px; overflow-x:auto">
                <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                    <thead><tr>
                        <th style="${th}; text-align:left">Colour</th>
                        ${showPlan ? `<th style="${th}">Plan</th>` : ''}<th style="${th}">Produced</th><th style="${th}">QC verified</th>
                        <th style="${th}">Not verified</th><th style="${th}">Shifted</th><th style="${th}">Ready</th>
                        <th style="${th}; text-align:left">Shifted to (location)</th>
                    </tr></thead>
                    <tbody>
                        ${colours.length ? colours.map(c => `<tr>
                            <td style="${td}; text-align:left">${esc(c.colour || '—')}</td>
                            ${showPlan ? `<td style="${td}; color:#64748b">${c.plan_qty ? fmt(c.plan_qty) : '—'}</td>` : ''}
                            <td style="${td}">${fmt(c.produced)}</td>
                            <td style="${td}; color:#047857">${fmt(c.verified)}</td>
                            <td style="${td}; color:${c.not_verified > 0 ? '#b91c1c' : '#0f172a'}">${fmt(c.not_verified)}</td>
                            <td style="${td}; color:#1d4ed8">${fmt(c.shifted)}</td>
                            <td style="${td}; color:${c.ready > 0 ? '#047857' : '#0f172a'}">${fmt(c.ready)}</td>
                            <td style="${td}; text-align:left; white-space:normal">${locChips(c.by_location)}</td>
                        </tr>`).join('') : `<tr><td colspan="${showPlan ? 8 : 7}" style="padding:10px; color:#94a3b8; text-align:center">No production entered yet.</td></tr>`}
                    </tbody>
                </table>
            </div>
            ${recent.length ? `<div style="margin-top:10px">
                <div style="font-weight:800; font-size:0.78rem; color:#475569; margin-bottom:4px">Latest shifting</div>
                ${recent.map(r => `<div style="display:flex; justify-content:space-between; gap:8px; border-top:1px dashed #e2e8f0; padding:4px 0; font-size:0.76rem">
                    <span>${esc(when(r.at))} · ${esc(r.colour || 'Manual')} → <b>${esc(r.location)}</b> · ${esc(r.label ? 'Label ' + r.label : 'Manual')} · ${esc(r.by)}</span>
                    <span style="font-weight:800">${fmt(r.qty)} pcs${r.kg ? ' · ' + kgFmt(r.kg) + ' kg' : ''}</span>
                </div>`).join('')}
            </div>` : ''}
        </div>`;
    }


    // ── Job flow strip: Produced · Bal · QC verified · QC hold · QC bal · Shifted · Shift bal · Shop floor ──
    const FLOW = [
        ['produced', 'Produced', '#0f172a', 'Prod'],
        ['balance', 'Balance', '#b45309', 'Bal'],
        ['qc_verified', 'QC verified', '#047857', 'QC ok'],
        ['qc_hold', 'QC hold', '#b91c1c', 'Hold'],
        ['qc_balance', 'QC balance', '#b91c1c', 'QC bal'],
        ['shifted', 'Shifted', '#1d4ed8', 'Shifted'],
        ['shift_balance', 'Shifting bal', '#047857', 'Sh bal'],
        ['shop_floor', 'Shop floor', '#7c3aed', 'Floor']
    ];

    /** Flow figures from an availability response (job popup). */
    function flowFromAvailability(d) {
        const t = d.totals || {};
        return {
            item_name: d.item_name || '', plan_qty: d.plan_qty,
            produced: t.produced, balance: (Number(d.plan_qty) || 0) - (Number(t.produced) || 0),
            qc_verified: t.verified, qc_hold: d.hold ? d.hold.qty : 0, on_hold: !!d.hold,
            qc_balance: t.not_verified, shifted: t.shifted, shift_balance: t.ready,
            shop_floor: Math.max((Number(t.produced) || 0) - (Number(t.shifted) || 0), 0)
        };
    }

    function flowValue(f, key) {
        const v = Number(f[key]) || 0;
        if (key === 'qc_hold' && f.on_hold && v <= 0) return 'HOLD';
        if (key === 'balance' && v < 0) return '+' + fmt(-v);
        return fmt(v);
    }

    /** big = job popup tiles; otherwise a compact 4×2 grid for a summary machine cell. */
    function flowHtml(f, big) {
        if (big) {
            return `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(96px, 1fr)); gap:8px">
                ${FLOW.map(([k, label, color]) => `<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px">
                    <div style="font-size:0.64rem; font-weight:800; letter-spacing:0.4px; text-transform:uppercase; color:#64748b">${label}</div>
                    <div style="font-size:1.1rem; font-weight:800; color:${(k === 'qc_hold' && !f.on_hold) || (k === 'qc_balance' && !(f[k] > 0)) ? '#0f172a' : color}">${flowValue(f, k)}</div>
                </div>`).join('')}
            </div>`;
        }
        return `<div class="jms-flow" title="Running job: ${esc(f.item_name || '')}${f.order_no ? ' · ' + esc(f.order_no) : ''}" style="margin-top:6px; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:2px 6px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:4px 6px">
            ${FLOW.map(([k, label, color, short]) => `<div style="min-width:0; line-height:1.15" title="${label}">
                <div style="font-size:0.56rem; font-weight:800; text-transform:uppercase; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${short}</div>
                <div style="font-size:0.72rem; font-weight:800; color:${(k === 'qc_hold' && !f.on_hold) || (k === 'qc_balance' && !(f[k] > 0)) ? '#334155' : color}">${flowValue(f, k)}</div>
            </div>`).join('')}
        </div>`;
    }

    /** Adds the flow strip to every machine cell (td[data-dpr-machine]) of a rendered summary. */
    async function decorate(container) {
        if (!container) return;
        const cells = [...container.querySelectorAll('td[data-dpr-machine]')];
        if (!cells.length) return;
        // One strip per machine per date block (job-level figures).
        const seen = new Set();
        const targets = cells.filter(td => {
            const k = td.getAttribute('data-dpr-machine') + '|' + (td.getAttribute('data-dpr-date') || '');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        const machines = [...new Set(targets.map(td => td.getAttribute('data-dpr-machine')))];
        const token = String(Date.now()) + Math.random();
        container.dataset.jobFlowToken = token;
        let res;
        try {
            res = await window.JPSMS.api.get(`/shifting/job-flow?machines=${encodeURIComponent(machines.join(','))}`);
        } catch (_) { return; }
        if (container.dataset.jobFlowToken !== token || !res || !res.ok) return;
        const data = res.data || {};
        targets.forEach(td => {
            if (!td.isConnected) return;
            const f = data[td.getAttribute('data-dpr-machine')];
            td.querySelectorAll('.jms-flow').forEach(n => n.remove());
            if (f) td.insertAdjacentHTML('beforeend', flowHtml(f, false));
        });
    }

    // Re-decorate whenever a Compliance Summary (Moulding / QC / Shifting) is re-rendered.
    function watchSummary() {
        const box = document.getElementById('summary-container');
        if (!box || box.dataset.jobFlowWatch) return;
        box.dataset.jobFlowWatch = '1';
        let timer = null;
        new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => decorate(box), 400);
        }).observe(box, { childList: true });
        if (box.querySelector('td[data-dpr-machine]')) decorate(box);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchSummary);
    else watchSummary();
    // The summary container may be created later (view switch): look again a few times.
    let tries = 0;
    const iv = setInterval(() => { watchSummary(); if (++tries > 20 || document.getElementById('summary-container')?.dataset.jobFlowWatch) clearInterval(iv); }, 1500);

    async function render(el, opts) {
        if (!el) return;
        const o = opts || {};
        const qs = new URLSearchParams();
        if (o.planId) qs.set('plan_id', String(o.planId));
        else if (o.orderNo) { qs.set('order_no', String(o.orderNo)); if (o.machine) qs.set('machine', String(o.machine)); }
        else { el.innerHTML = ''; return; }
        const token = String(Date.now()) + Math.random();
        el.dataset.jobShiftingToken = token;
        el.innerHTML = '<div style="padding:12px; color:#64748b; font-size:0.85rem">Loading production, QC and shifting…</div>';
        try {
            const res = await window.JPSMS.api.get(`/shifting/availability?${qs.toString()}`);
            if (el.dataset.jobShiftingToken !== token) return; // a newer job was opened meanwhile
            if (!res || !res.ok) throw new Error((res && res.error) || 'Could not load shifting data');
            el.innerHTML = html(res.data || {});
            // Optional 8-figure flow tiles (job popup "Overall Progress").
            if (o.flowEl) o.flowEl.innerHTML = flowHtml(flowFromAvailability(res.data || {}), true);
        } catch (e) {
            if (el.dataset.jobShiftingToken !== token) return;
            el.innerHTML = `<div style="padding:10px; color:#b91c1c; font-size:0.85rem">Production · QC · Shifting: ${esc(e.message || e)}</div>`;
        }
    }

    window.JMSJobShifting = { render, decorate };
})();
