/* Order popup (Machine Timeline): part-wise view of one order.
   Data: GET /api/order-tracker/parts. Used by timeline_patch.js. */
(function () {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    /* value inside a JS string inside an HTML attribute */
    const arg = s => esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
    const n = v => Number(v || 0).toLocaleString('en-IN');
    const toDate = v => (v ? new Date(String(v).length === 10 ? v + 'T12:00:00' : v) : null);
    const day = v => (v ? toDate(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');
    const dayY = v => (v ? toDate(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
    const dt = v => (v ? toDate(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
    const mach = s => { const t = String(s || '').trim(); return t.includes('>') ? t.split('>').pop().trim() : t; };

    const PART_STATUS = {
        COMPLETE: ['Complete', 'completed'], RUNNING: ['Running', 'running'], STOPPED: ['Stopped', 'stopped'], PLANNED: ['Planned', 'planned'],
        SHORT: ['Closed short', 'stopped'], NOT_PLANNED: ['Not planned', 'pending'], DROPPED: ['Dropped', 'planned']
    };
    const ROLE = {
        ALTERNATE: ['Not needed', 'Another mould is making this part'], DROPPED: ['Dropped', 'Dropped by Planning for this order'],
        INACTIVE: ['Inactive', 'Switched off in the mould master'], TO_PLAN: ['To plan', 'No mould of this part is planned yet']
    };

    const css = document.createElement('style');
    css.textContent = `
    .om-header.opv { text-align:left; padding:16px 64px 14px 24px; border-bottom-width:3px; }
    .opv-title { font-size:1.3rem; font-weight:800; line-height:1.25; color:#fff; }
    .opv-client { font-size:.92rem; color:#cbd5e1; margin-top:2px; }
    .opv-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .opv-tag { font-size:.78rem; font-weight:600; color:#e2e8f0; background:rgba(255,255,255,.12); border-radius:6px; padding:3px 9px; }
    .opv-tag b { color:#fff; font-weight:700; }
    .opv-tag.mono b { font-family:monospace; font-size:.84rem; }
    .opv-tag.OK, .opv-tag.DONE { background:#166534; color:#fff; }
    .opv-tag.RISK { background:#92400e; color:#fff; }
    .opv-tag.LATE { background:#991b1b; color:#fff; }

    .opv-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(138px,1fr)); background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
    .opv-kpi { padding:12px 16px; box-shadow:1px 0 0 #e2e8f0, 0 1px 0 #e2e8f0; }
    .opv-kpi .l { font-size:.78rem; font-weight:600; color:#475569; }
    .opv-kpi .v { font-size:1.35rem; font-weight:800; color:#0f172a; font-variant-numeric:tabular-nums; line-height:1.25; }
    .opv-kpi .s { font-size:.76rem; color:#475569; }
    .opv-kpi.main { background:#eff6ff; } .opv-kpi.main .v { color:#1d4ed8; }

    .opv-recipe { margin:12px 2px; font-size:.88rem; color:#334155; line-height:1.9; }
    .opv-recipe .r { display:inline-block; background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:0 8px; font-weight:700; }
    .opv-recipe .r.limit { border-color:#dc2626; color:#991b1b; background:#fef2f2; }

    .opv-sec { background:#fff; border:1px solid #e2e8f0; border-radius:12px; margin-top:12px; overflow:hidden; }
    .opv-sec > summary { list-style:none; cursor:pointer; padding:11px 16px; font-weight:700; font-size:.9rem; color:#0f172a; display:flex; align-items:center; gap:8px; }
    .opv-sec > summary::-webkit-details-marker { display:none; }
    .opv-sec > summary:before { content:'\\25B8'; color:#475569; transition:transform .15s; }
    .opv-sec[open] > summary:before { transform:rotate(90deg); }
    .opv-sec > summary:hover { background:#f8fafc; }
    .opv-sec > summary .c { margin-left:auto; font-weight:500; font-size:.82rem; color:#475569; }
    .opv-sec > summary:focus-visible, .opv-x:focus-visible, .opv-link:focus-visible { outline:2px solid #2563eb; outline-offset:-2px; }
    .opv-alert { display:flex; gap:10px; padding:8px 16px; font-size:.87rem; color:#1e293b; border-top:1px solid #f1f5f9; }
    .opv-alert i { font-style:normal; font-weight:700; font-size:.74rem; flex:0 0 62px; text-align:center; border-radius:5px; padding:2px 0; align-self:flex-start; }
    .opv-alert.bad i { background:#fee2e2; color:#991b1b; } .opv-alert.warn i { background:#fef3c7; color:#854d0e; } .opv-alert.info i { background:#e2e8f0; color:#334155; }

    .opv-bar { display:flex; align-items:center; gap:8px; margin:14px 2px 8px; font-weight:700; color:#0f172a; font-size:.95rem; }
    .opv-link { margin-left:auto; border:1px solid #cbd5e1; background:#fff; color:#1d4ed8; font-weight:600; font-size:.82rem; border-radius:7px; padding:5px 12px; cursor:pointer; }
    .opv-link:hover { background:#eff6ff; }
    .opv-wrap { overflow-x:auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; }
    .opv-t { width:100%; border-collapse:collapse; min-width:980px; }
    .opv-t th { background:#f1f5f9; color:#334155; font-size:.78rem; font-weight:700; text-align:left; padding:9px 12px; border-bottom:1px solid #e2e8f0; white-space:nowrap; }
    .opv-t td { padding:10px 12px; font-size:.88rem; color:#1e293b; border-bottom:1px solid #eef2f7; vertical-align:middle; }
    .opv-t .num { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; white-space:nowrap; }
    .opv-t tr.part { cursor:pointer; } .opv-t tr.part:hover td { background:#f8fafc; }
    .opv-t tr.part.limit td { background:#fef2f2; }
    .opv-t tr.part.limit td:first-child { box-shadow:inset 4px 0 0 #dc2626; }
    .opv-t tr.sub > td { background:#f8fafc; padding:12px 16px 16px 44px; }
    .opv-x { border:0; background:none; font-size:.95rem; color:#334155; cursor:pointer; width:24px; height:24px; padding:0; transition:transform .15s; }
    tr.open .opv-x { transform:rotate(90deg); }
    .opv-sm { font-size:.77rem; color:#475569; font-weight:500; }
    .opv-mono { font-family:monospace; font-size:.8rem; color:#475569; }
    .opv-prog { height:6px; border-radius:3px; background:#e2e8f0; overflow:hidden; margin-top:4px; min-width:110px; }
    .opv-prog span { display:block; height:100%; background:#2563eb; } .opv-prog.done span { background:#16a34a; } .opv-prog.low span { background:#dc2626; }
    .opv-in { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; min-width:860px; }
    .opv-in th { background:#fff; font-size:.75rem; color:#475569; padding:7px 10px; border-bottom:1px solid #e2e8f0; text-align:left; font-weight:700; }
    .opv-in td { padding:8px 10px; font-size:.84rem; border-bottom:1px solid #f1f5f9; background:#fff; }
    .opv-in td .dd-jc-link, .opv-in td .om-badge { white-space:nowrap; word-break:normal; }
    .opv-in tr.off td { color:#64748b; background:#fafafa; }
    .opv-in tr.hl td { background:#fef9c3; } .opv-in tr.hl td:first-child { box-shadow:inset 4px 0 0 #ca8a04; }
    .opv-facts { display:flex; flex-wrap:wrap; gap:4px 18px; font-size:.82rem; color:#334155; margin-bottom:10px; }
    .opv-facts b { font-weight:700; color:#0f172a; }
    .opv-h { font-size:.8rem; font-weight:700; color:#334155; margin:12px 0 5px; }
    .opv-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px 18px; padding:6px 16px 16px; font-size:.86rem; }
    .opv-grid span { display:block; font-size:.76rem; color:#475569; } .opv-grid b { color:#0f172a; }
    @media (max-width:640px) { .om-header.opv { padding:14px 56px 12px 16px; } .om-body { padding:14px !important; } .opv-t tr.sub > td { padding-left:16px; } }
    @media (prefers-reduced-motion:reduce) { .opv-x, .opv-sec > summary:before { transition:none; } }`;
    document.head.appendChild(css);

    const badge = (text, cls, title) => `<span class="om-badge ${cls}" style="text-transform:none" ${title ? `title="${esc(title)}"` : ''}>${esc(text)}</span>`;
    const planBadge = st => {
        const s = String(st || '').toUpperCase();
        const cls = { RUNNING: 'running', STOPPED: 'stopped', COMPLETED: 'completed', CLOSED: 'completed' }[s] || 'planned';
        return badge(s.charAt(0) + s.slice(1).toLowerCase(), cls);
    };

    const unitOf = d => (/set/i.test(d.uom || '') ? 'set' : 'product');

    function header(d) {
        const tag = (l, v, c) => `<span class="opv-tag ${c || ''}">${l ? esc(l) + ' ' : ''}<b>${esc(v)}</b></span>`;
        return `<div class="opv-title" id="om-product">${esc(d.product_name || 'Product')}</div>
            <div class="opv-client" id="om-client">${esc(d.client_name || '')}</div>
            <div class="opv-tags">
                <span class="opv-tag mono">Order <b id="om-orderno">${esc(d.order_no)}</b></span>
                ${d.item_code ? tag('Item', d.item_code) : ''}
                ${d.order_date ? tag('Order date', dayY(d.order_date)) : ''}
                ${d.target_date ? tag('Target', dayY(d.target_date)) : ''}
                ${d.verdict ? tag('', d.verdict.text, d.verdict.code) : ''}
            </div>`;
    }

    function kpis(d) {
        const u = esc(String(d.uom || 'pcs').toLowerCase());
        const box = (l, v, s, c) => `<div class="opv-kpi ${c || ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
        const eta = d.verdict && d.verdict.code === 'DONE' ? 'Done' : d.expected_end ? day(d.expected_end) : 'Not known';
        return `<div class="opv-kpis">
            ${d.or_qty ? box('OR qty', n(d.or_qty), d.or_left > 0 ? `${n(d.or_left)} not in this JR` : `all in this JR`) : ''}
            ${box('JR qty (this job)', n(d.jr_qty), u)}
            ${box('On job cards', n(d.jc_qty), d.jr_left > 0 ? `${n(d.jr_left)} without job card` : `${d.jc_count} job card${d.jc_count === 1 ? '' : 's'}`)}
            ${box('Planned on machines', n(d.planned_sets), d.planned_sets < d.jr_qty ? `${n(d.jr_qty - d.planned_sets)} not fully planned` : 'all parts planned')}
            ${box(`Complete ${unitOf(d)}s`, n(d.sets), `${d.sets_pct}% of ${n(d.jr_qty)} ${u}`, 'main')}
            ${box('Balance', n(d.sets_balance), `${d.parts_complete} of ${d.parts_total} parts done`)}
            ${box('Expected finish', eta, d.expected_end || !d.blocked.length ? (d.target_date ? 'target ' + day(d.target_date) : '') : 'waiting for ' + esc(d.blocked.slice(0, 2).join(', ')) + (d.blocked.length > 2 ? ' +' + (d.blocked.length - 2) : ''))}
        </div>`;
    }

    function recipe(d) {
        const c = d.parts.filter(p => p.counted);
        if (!c.length) return '';
        const unit = unitOf(d);
        return `<div class="opv-recipe">1 complete ${unit} = ${c.map(p => `<span class="r ${p.is_limit && p.balance > 0 ? 'limit' : ''}">${esc(p.name)} × ${n(p.ratio)}</span>`).join(' + ')}</div>`;
    }

    function alerts(d) {
        if (!d.alerts.length) return '';
        const lbl = { bad: 'Urgent', warn: 'Check', info: 'Note' };
        return `<details class="opv-sec" open><summary>Needs attention <span class="c">${d.alerts.length}</span></summary>
            ${d.alerts.map(a => `<div class="opv-alert ${a.level}"><i>${lbl[a.level]}</i><div>${esc(a.text)}</div></div>`).join('')}</details>`;
    }

    function machineCell(pl, ctx) {
        const live = ctx.livePlan(pl.plan_id);
        const name = mach(live ? live.machine : pl.machine);
        if (!live) return `<b>${esc(name || '–')}</b>`;
        return `<button type="button" class="om-mach-click-badge" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;padding:3px 8px;border-radius:6px;font-weight:700;font-size:.82rem;text-align:left"
            onclick="window.openMachineSelector(event,'${arg(live.id)}','${arg(name)}','${arg(live.primaryMachine || '')}','${arg(live.secondaryMachine || '')}')">${esc(name || 'Unassigned')} <i class="bi bi-chevron-down" style="font-size:.7rem"></i></button>`;
    }

    function planRow(m, pl, ctx, d) {
        const live = ctx.livePlan(pl.plan_id);
        const bal = Math.max(0, Number(pl.plan_qty) - pl.produced);
        const closed = ['COMPLETED', 'CLOSED'].includes(pl.status);
        const start = (live && live._rippledStartRaw) || pl.start_date;
        const end = (live && live._rippledEndRaw) || pl.end_date;
        const exp = closed ? null : (live && live._rippledExpRaw) || pl.exp_end;
        const jc = (live && (live.jcNo || live.jc_no || live.job_card_no)) || pl.job_card_no || (d.job_cards.length === 1 ? d.job_cards[0].job_card_no : '');
        const hl = ctx.clicked && [pl.plan_id, live && live.id].some(x => x != null && String(x) === String(ctx.clicked));
        return `<tr class="${hl ? 'hl' : ''}" ${hl ? 'data-highlighted="true"' : ''}>
            <td><b>${esc(m.mould_name)}</b><div class="opv-mono">${esc(m.mould_no)} · <span style="color:#6d28d9">${esc(pl.plan_id || '')}</span></div></td>
            <td>${machineCell(pl, ctx)}</td>
            <td>${jc ? `<span class="dd-jc-link" onclick="window.openJcDrilldown('${arg(jc)}','${arg(jc)}','${arg(pl.plan_id)}','${arg(d.order_no)}');event.stopPropagation();" title="Colour, shift and hour detail">${esc(jc)}</span>` : '–'}</td>
            <td>${planBadge(pl.status)}</td>
            <td class="num">${n(pl.plan_qty)}</td>
            <td class="num" style="color:#15803d">${n(pl.produced)}${pl.produced > pl.plan_qty ? `<div class="opv-sm">+${n(pl.produced - pl.plan_qty)} extra</div>` : ''}</td>
            <td class="num" style="color:${bal > 0 ? '#b45309' : '#15803d'}">${n(bal)}</td>
            <td class="opv-sm" style="white-space:nowrap">${dt(start)} → ${dt(end)}${exp ? `<div style="color:#1d4ed8;font-weight:700">Expected ${dt(exp)}</div>` : ''}${closed && pl.completed_at ? `<div>Closed ${dt(pl.completed_at)}${pl.completed_by ? ' by ' + esc(pl.completed_by) : ''}</div>` : ''}</td></tr>`;
    }

    function mouldRows(p, ctx, d) {
        return p.moulds.map(m => {
            if (m.role === 'IN_USE' && m.plans.length) return m.plans.map(pl => planRow(m, pl, ctx, d)).join('');
            if (m.role === 'IN_USE') {
                return `<tr><td><b>${esc(m.mould_name)}</b><div class="opv-mono">${esc(m.mould_no)}</div></td><td>–</td><td>–</td><td>${badge('Made, no plan', 'planned')}</td>
                    <td class="num">–</td><td class="num" style="color:#15803d">${n(m.produced)}</td><td class="num">–</td><td class="opv-sm">${day(m.first_date)} → ${day(m.last_date)}</td></tr>`;
            }
            const r = m.role === 'ALTERNATE' && p.plan_gap > 0 ? ['Available', `Can make the ${n(p.plan_gap)} pcs not planned yet`] : ROLE[m.role] || [m.role, ''];
            const why = m.role === 'DROPPED' && m.drop
                ? `Dropped ${dt(m.drop.at)}${m.drop.by && m.drop.by !== 'User' ? ' by ' + esc(m.drop.by) : ''}${m.drop.remarks && !/^drop$/i.test(m.drop.remarks) ? ': ' + esc(m.drop.remarks) : ''}`
                : esc(r[1]);
            return `<tr class="off"><td><b>${esc(m.mould_name)}</b><div class="opv-mono">${esc(m.mould_no)}</div></td>
                <td class="opv-sm">${m.allowed_machines && m.allowed_machines.length ? 'Can run on ' + esc(m.allowed_machines.slice(0, 3).join(', ')) : '–'}</td><td>–</td>
                <td>${badge(r[0], m.role === 'TO_PLAN' ? 'pending' : 'planned', r[1])}</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="opv-sm">${why}</td></tr>`;
        }).join('');
    }

    function partSub(p, ctx, d) {
        const used = p.moulds.filter(m => m.role === 'IN_USE');
        const m0 = used[0] || p.moulds[0];
        const f = (l, v) => `<span>${l} <b>${v}</b></span>`;
        const shifted = p.moulds.reduce((s, m) => s + Number(m.shifted || 0), 0);
        return `<div class="opv-facts">
                ${f('Made today', n(p.today))}${f('Speed', p.rate_pph ? n(p.rate_pph) + ' pcs/h' : 'not running')}
                ${m0.std_pph ? f('Standard', n(m0.std_pph) + ' pcs/h') : ''}${f('Cavity', esc(used.map(m => m.cavity).filter(Boolean).join(' + ') || m0.cavity || '–'))}
                ${m0.cycle_time ? f('Cycle', n(m0.cycle_time) + ' s') : ''}${f('Reject', n(p.reject) + ' (' + p.reject_pct + '%)')}
                ${p.counted ? f('Waiting for other parts', n(p.waiting) + ' pcs') : ''}${shifted ? f('Shifted', n(shifted)) : ''}
                ${p.hours_left != null ? f('Time left', p.hours_left < 48 ? p.hours_left + ' h' : (p.hours_left / 24).toFixed(1) + ' days') : ''}
            </div>
            ${used.length > 1 ? `<div class="opv-facts">${used.map(m => `<span>${esc(m.mould_no)}: <b>${n(m.produced)}</b> made of ${n(m.planned)} planned (${m.share_pct}% of this part)</span>`).join('')}</div>` : ''}
            <div style="overflow-x:auto"><table class="opv-in"><thead><tr><th>Mould / plan</th><th>Machine</th><th>Job card</th><th>Status</th><th style="text-align:right">Plan</th><th style="text-align:right">Made</th><th style="text-align:right">Balance</th><th>Schedule</th></tr></thead>
            <tbody>${mouldRows(p, ctx, d)}</tbody></table></div>
            ${p.colours.length ? `<div class="opv-h">Colour-wise</div><div style="overflow-x:auto"><table class="opv-in" style="min-width:480px;max-width:760px"><thead><tr><th>Colour</th><th style="text-align:right">Required</th><th style="text-align:right">Made</th><th style="text-align:right">Balance</th><th style="text-align:right">Reject</th><th>Progress</th></tr></thead><tbody>
                ${p.colours.map(c => {
                    const pc = c.required > 0 ? Math.min(100, Math.round(c.produced / c.required * 100)) : 0;
                    return `<tr><td><b>${esc(c.colour)}</b></td><td class="num">${c.required ? n(c.required) : '–'}</td><td class="num" style="color:#15803d">${n(c.produced)}</td><td class="num">${n(c.balance)}</td><td class="num">${n(c.reject)}</td><td><span class="opv-sm">${pc}%</span><div class="opv-prog ${pc >= 100 ? 'done' : ''}"><span style="width:${pc}%"></span></div></td></tr>`;
                }).join('')}</tbody></table></div>` : ''}`;
    }

    function partsTable(d, ctx) {
        return `<div class="opv-bar">Parts of this ${unitOf(d)} <span class="opv-sm">${d.parts.length} part${d.parts.length === 1 ? '' : 's'}, click a part for moulds, machines and colours</span>
                <button type="button" class="opv-link" id="opv-all">Expand all</button></div>
            <div class="opv-wrap"><table class="opv-t"><thead><tr><th style="width:34px"></th><th>Part</th><th style="text-align:right">Per ${unitOf(d)}</th><th style="text-align:right">Required</th><th style="text-align:right">Planned</th><th style="text-align:right">Made</th><th style="text-align:right">Balance</th><th>Enough for</th><th>Status</th><th>Finish</th></tr></thead><tbody>
            ${d.parts.map((p, i) => {
                const st = PART_STATUS[p.status] || [p.status, 'planned'];
                const spare = p.moulds.filter(m => m.role === 'ALTERNATE').length;
                const dropped = p.moulds.filter(m => m.role === 'DROPPED').length;
                const sub = `${p.moulds_used} of ${p.moulds_total} mould${p.moulds_total === 1 ? '' : 's'} in use${dropped ? `, ${dropped} dropped` : ''}${spare ? `, ${spare} ${p.plan_gap > 0 ? 'available' : 'not needed'}` : ''}`;
                const open = ctx.open.has(p.key);
                const limit = p.is_limit && p.balance > 0;
                return `<tr class="part ${limit ? 'limit' : ''} ${open ? 'open' : ''}" data-i="${i}">
                    <td><button type="button" class="opv-x" aria-expanded="${open}" aria-label="Show ${esc(p.name)} details">▸</button></td>
                    <td><b>${esc(p.name)}</b>${limit ? ' ' + badge('Holding the order', 'stopped') : ''}<div class="opv-sm">${esc(sub)}</div>${p.machines.length ? `<div class="opv-sm">On ${esc(p.machines.map(mach).join(', '))}</div>` : ''}</td>
                    <td class="num">${n(p.ratio)}</td><td class="num">${n(p.required)}</td>
                    <td class="num">${n(p.planned)}${p.plan_gap > 0 && p.counted ? `<div class="opv-sm" style="color:#b45309">${n(p.plan_gap)} short</div>` : ''}</td>
                    <td class="num" style="color:#15803d">${n(p.produced)}</td><td class="num" style="color:${p.balance > 0 ? '#b45309' : '#15803d'}">${n(p.balance)}</td>
                    <td>${p.counted ? `<b>${n(p.sets)}</b> <span class="opv-sm">${unitOf(d)}s · ${p.pct}%</span><div class="opv-prog ${p.pct >= 100 ? 'done' : limit ? 'low' : ''}"><span style="width:${p.pct}%"></span></div>` : '<span class="opv-sm">not counted</span>'}</td>
                    <td>${badge(st[0], st[1])}</td>
                    <td class="opv-sm" style="white-space:nowrap">${p.status === 'COMPLETE' ? 'Done' : p.eta ? dt(p.eta) : p.counted ? 'Not known' : '–'}</td></tr>
                    <tr class="sub" data-sub="${i}" ${open ? '' : 'hidden'}><td colspan="10">${partSub(p, ctx, d)}</td></tr>`;
            }).join('')}</tbody></table></div>`;
    }

    function jobCards(d) {
        if (!d.job_cards.length) return '';
        return `<details class="opv-sec"><summary>Job cards <span class="c">${d.job_cards.length} · ${n(d.jc_qty)} of ${n(d.jr_qty)}</span></summary>
            ${d.job_cards.map(j => `<div style="padding:4px 16px 16px"><div class="opv-facts"><span><b>${esc(j.job_card_no)}</b></span><span>Date <b>${dayY(j.job_card_date)}</b></span><span>Qty <b>${n(j.qty)}</b></span><span>Complete <b>${n(j.sets)} (${j.pct}%)</b></span><span>Moulding plan <b>${day(j.planned_start)} → ${day(j.planned_end)}</b></span></div>
            <div style="overflow-x:auto"><table class="opv-in" style="min-width:560px"><thead><tr><th>Part</th><th style="text-align:right">Per ${unitOf(d)}</th><th style="text-align:right">Required</th><th style="text-align:right">Made</th><th style="text-align:right">Balance</th><th style="text-align:right">Enough for</th></tr></thead><tbody>
            ${j.parts.map(p => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${n(p.ratio)}</td><td class="num">${n(p.required)}</td><td class="num" style="color:#15803d">${n(p.produced)}</td><td class="num">${n(p.balance)}</td><td class="num">${n(p.sets)}</td></tr>`).join('')}
            </tbody></table></div></div>`).join('')}</details>`;
    }

    function more(d) {
        const g = (l, v) => (v === null || v === undefined || v === '' ? '' : `<div><span>${l}</span><b>${esc(v)}</b></div>`);
        const pk = d.packing;
        return `<details class="opv-sec"><summary>More order details</summary><div class="opv-grid">
            ${g('Unit', d.uom)}${g('Standard pack', d.std_pack)}${g('Moulding plan', d.plan_start ? day(d.plan_start) + ' → ' + day(d.plan_end) : '')}
            ${g('First production', d.start_date ? dayY(d.start_date) : 'Not started')}${g('Last production', d.last_date ? dayY(d.last_date) : '')}
            ${g('Running on', d.running_machines.map(mach).join(', ') || 'No machine')}
            ${pk ? g('Packed', n(pk.packed)) + g('Reached store', n(pk.reached)) + g('In store now', n(pk.in_store)) + g('Dispatched', n(pk.dispatched)) : ''}
            ${g('OR remarks', d.or_remarks)}${g('JR remarks', d.jr_remarks)}</div></details>`;
    }

    /* Renders into `body` (popup body) and `head` (popup header). ctx: { clicked, livePlan(planId) } */
    window.renderOrderParts = function (head, body, d, ctx) {
        ctx.open = new Set(d.parts.filter(p => ctx.clicked && p.moulds.some(m => m.plans.some(pl => {
            const live = ctx.livePlan(pl.plan_id);
            return String(pl.plan_id) === String(ctx.clicked) || (live && String(live.id) === String(ctx.clicked));
        }))).map(p => p.key));
        head.innerHTML = header(d);
        body.innerHTML = kpis(d) + recipe(d) + alerts(d) + partsTable(d, ctx) + jobCards(d) + more(d);

        const set = (tr, open) => {
            tr.classList.toggle('open', open);
            tr.querySelector('.opv-x').setAttribute('aria-expanded', String(open));
            body.querySelector(`tr.sub[data-sub="${tr.dataset.i}"]`).hidden = !open;
        };
        const rows = [...body.querySelectorAll('tr.part')];
        const all = body.querySelector('#opv-all');
        const label = () => { all.textContent = rows.every(r => r.classList.contains('open')) ? 'Collapse all' : 'Expand all'; };
        rows.forEach(tr => tr.addEventListener('click', () => { set(tr, !tr.classList.contains('open')); label(); }));
        all.addEventListener('click', () => { const open = !rows.every(r => r.classList.contains('open')); rows.forEach(r => set(r, open)); label(); });
        label();
        const hl = body.querySelector('[data-highlighted="true"]');
        if (hl) setTimeout(() => hl.scrollIntoView({ block: 'nearest' }), 60);
    };
})();
