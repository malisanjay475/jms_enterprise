    // --- DETAILED JOB SUMMARY MODAL ---
    const jobDetailState = { details: null, orderNo: '', machine: '', mode: 'current', data: null };

    function dprEsc(value) {
        return String(value ?? '-').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
    }

    const DPR_REJECT_REASONS = {
        A: 'Short Moulding', B: 'Shrinkage Mark', C: 'Silver Streak/Colour Variation/Trail',
        D: 'Flow Mark/Weld Line', E: 'Fitment Issue', F: 'Dent Mark/Air Bubble', G: 'Warpage',
        H: 'Black/Water Marks', I: 'Startup Pcs/Color Change Pcs', J: 'Bottom bulging issue',
        K: 'Scratch', L: 'Over Lapping', M: 'Punching Hole Issue'
    };
    const DPR_DOWNTIME_REASONS = {
        '1': 'Manpower Shortage', '2': 'Mould Change Over', '3': 'Accessories Shortage', '4': 'Material Shortage',
        '5': 'M/C Under Maintaince (Water/Oil/Air Leakage)', '6': 'Nozzle Block/Change', '7': 'Mould Problem',
        '8': 'Power Failure/Pre Heating', '9': 'Color Change Time', '10': 'Process Setting', '11': 'Mould Trial',
        '12': 'Crane/Hrtc', '13': 'No Plan'
    };
    function dprReasonName(code, map) {
        const key = String(code ?? '').trim();
        if (!key) return 'Unspecified';
        if (key.startsWith('OTHER_')) return key.slice(6) || 'Other';
        if (/^OTHER$/i.test(key)) return 'Other';
        return map[key] || key;
    }

    function dprNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function dprFmtQty(value) {
        return dprNumber(value).toLocaleString('en-IN');
    }

    function dprFmtValue(value, fallback = '-') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    }

    function dprFmtDate(value) {
        if (!value) return '-';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value).split('T')[0] || '-';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function dprSetText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = dprFmtValue(value);
    }

    function getJobSummaryScope() {
        return {
            date: document.getElementById('s-from-date')?.value || '',
            shift: document.getElementById('s-shift')?.value || ''
        };
    }

    function setJobDetailMode(mode) {
        jobDetailState.mode = mode === 'overall' ? 'overall' : 'current';
        document.querySelectorAll('[data-job-detail-mode]').forEach(btn => {
            const active = btn.dataset.jobDetailMode === jobDetailState.mode;
            btn.style.background = active ? '#0ea5e9' : '#f8fafc';
            btn.style.color = active ? '#ffffff' : '#0f172a';
            btn.style.borderColor = active ? '#0284c7' : '#cbd5e1';
        });
        dprSetText('modalJobScopeLabel', jobDetailState.mode === 'current' ? 'Current shift' : 'Overall job (all dates)');
        if (jobDetailState.orderNo) fetchDetailedStats(jobDetailState.orderNo, jobDetailState.machine, jobDetailState.details || {});
    }

    function openJobImage(src) {
        const wrap = document.getElementById('modalJobImageViewer');
        const img = document.getElementById('modalJobImageLarge');
        if (!wrap || !img) return;
        img.src = src;
        wrap.style.display = 'flex';
    }

    function closeJobImage() {
        const wrap = document.getElementById('modalJobImageViewer');
        const img = document.getElementById('modalJobImageLarge');
        if (img) img.src = '';
        if (wrap) wrap.style.display = 'none';
    }

    function openColourHistory(encodedColour) {
        const colour = decodeURIComponent(encodedColour || '');
        const panel = document.getElementById('modalJobHistoryPanel');
        if (!panel) return;
        const rows = (jobDetailState.data?.history?.[colour] || []);
        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:10px">
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:800; text-transform:uppercase">Production History</div>
                    <div style="font-size:1rem; color:#0f172a; font-weight:900">${dprEsc(colour)}</div>
                </div>
                <button type="button" onclick="closeColourHistory()" style="border:1px solid #cbd5e1; background:white; border-radius:10px; padding:6px 12px; font-weight:800; cursor:pointer">Close</button>
            </div>
            ${rows.length ? `
                <div style="overflow:auto; border:1px solid #e2e8f0; border-radius:12px">
                    <table style="width:100%; border-collapse:collapse; min-width:720px; font-size:0.85rem">
                        <thead style="background:#f8fafc; color:#475569; text-transform:uppercase; font-size:0.72rem">
                            <tr>
                                <th style="padding:9px; text-align:left">Date</th>
                                <th style="padding:9px; text-align:left">Shift / Hour</th>
                                <th style="padding:9px; text-align:left">Machine / Line</th>
                                <th style="padding:9px; text-align:right">Produced</th>
                                <th style="padding:9px; text-align:right">Reject</th>
                                <th style="padding:9px; text-align:right">Downtime</th>
                                <th style="padding:9px; text-align:left">Responsible</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => `
                                <tr style="border-top:1px solid #e2e8f0">
                                    <td style="padding:9px">${dprEsc(dprFmtDate(r.date))}</td>
                                    <td style="padding:9px">${dprEsc(r.shift || '-')} / ${dprEsc(r.hour_slot || '-')}</td>
                                    <td style="padding:9px">${dprEsc(r.machine || '-')}<div style="font-size:0.75rem; color:#64748b">${dprEsc(r.line || '-')}</div></td>
                                    <td style="padding:9px; text-align:right; color:#059669; font-weight:900">${dprFmtQty(r.good)}</td>
                                    <td style="padding:9px; text-align:right; color:#dc2626; font-weight:800">${dprFmtQty(r.reject)}</td>
                                    <td style="padding:9px; text-align:right">${dprFmtQty(r.downtime)} min</td>
                                    <td style="padding:9px">${dprEsc(r.by || '-')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<div style="color:#64748b; padding:12px; border:1px dashed #cbd5e1; border-radius:12px">No shift-wise production history found for this colour.</div>'}
        `;
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function closeColourHistory() {
        const panel = document.getElementById('modalJobHistoryPanel');
        if (panel) panel.style.display = 'none';
    }

    function renderReasonAnalysis(containerId, title, stats, unit, accent, reasonMap) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const rows = Object.entries(stats || {})
            .map(([reason, qty]) => ({ reason: reasonMap ? dprReasonName(reason, reasonMap) : reason, qty: dprNumber(qty) }))
            .filter(r => r.qty > 0)
            .sort((a, b) => b.qty - a.qty);
        const total = rows.reduce((sum, r) => sum + r.qty, 0);

        // Donut segments (CSS conic-gradient — no chart library, works offline)
        const palette = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
        let deg = 0;
        const gradParts = rows.map((r, i) => {
            const c = palette[i % palette.length];
            const span = total > 0 ? (r.qty / total) * 360 : 0;
            const part = `${c} ${deg.toFixed(2)}deg ${(deg + span).toFixed(2)}deg`;
            deg += span;
            return part;
        });
        const donutHtml = rows.length ? `
            <div style="position:relative; width:110px; height:110px; flex:0 0 auto">
                <div style="width:110px; height:110px; border-radius:50%; background:conic-gradient(${gradParts.join(', ')}); box-shadow:inset 0 0 0 1px rgba(15,23,42,0.06)"></div>
                <div style="position:absolute; inset:22px; background:#fff; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(15,23,42,0.12)">
                    <b style="font-size:0.98rem; color:${accent}; line-height:1.1">${dprFmtQty(total)}</b>
                    <span style="font-size:0.6rem; color:#94a3b8; font-weight:800; text-transform:uppercase">${unit}</span>
                </div>
            </div>` : '';

        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
                <h4 style="margin:0; font-size:1rem; font-weight:900; color:#0f172a">${title}</h4>
                <span style="background:${accent}16; color:${accent}; border:1px solid ${accent}44; padding:4px 10px; border-radius:999px; font-size:0.78rem; font-weight:900">${dprFmtQty(total)} ${unit}</span>
            </div>
            ${rows.length ? `
            <div style="display:flex; gap:16px; align-items:flex-start">
                ${donutHtml}
                <div style="flex:1; min-width:0">
                    ${rows.map((r, i) => {
                        const c = palette[i % palette.length];
                        const pct = total > 0 ? (r.qty / total) * 100 : 0;
                        return `
                        <div style="margin-bottom:9px">
                            <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.8rem; font-weight:800; color:#334155">
                                <span style="display:inline-flex; align-items:center; gap:6px; min-width:0"><span style="width:9px; height:9px; border-radius:3px; background:${c}; flex:0 0 auto"></span><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${dprEsc(r.reason)}</span></span>
                                <span style="flex:0 0 auto">${dprFmtQty(r.qty)} ${unit} <span style="color:#94a3b8; font-weight:700; font-size:0.72rem">(${pct.toFixed(1)}%)</span></span>
                            </div>
                            <div style="height:6px; background:#f1f5f9; border-radius:999px; overflow:hidden; margin-top:4px">
                                <div style="height:100%; width:${Math.min(100, pct)}%; background:${c}; border-radius:999px"></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>` : `<div style="color:#94a3b8; font-style:italic">No ${title.toLowerCase()} recorded.</div>`}
        `;
    }

    function showJobDetails(details, orderNo) {
        if (!details || Object.keys(details).length === 0) {
            if (orderNo) {
                // Try to fetch via API if details missing (future enhancement)
                alert('Details not available for this job.');
            }
            return;
        }

        const d = details;
        console.log("Showing details:", d);
        jobDetailState.details = d;
        jobDetailState.orderNo = d.order_no || orderNo || '';
        jobDetailState.machine = d.machine || '';
        jobDetailState.data = null;

        // Delete Setup allowed for admin/superadmin + planner, ppc_ass_manager, ppc_manager.
        const canDelSetup = !!(window.canDeleteDprEntry && window.canDeleteDprEntry());
        const setupBtn = document.getElementById('btnDeleteSetup');
        if (setupBtn) {
            if (canDelSetup && d.id) {
                setupBtn.style.display = 'block';
                window.currentSetupId = d.id;
            } else {
                setupBtn.style.display = 'none';
            }
        }

        // 1. Populate Header
        dprSetText('modalJobProduct', d.product_name || d.item_name || d.mould_name || '-');
        dprSetText('modalJobMachine', d.machine || '-');
        dprSetText('modalJobOrder', d.order_no || orderNo || '-');
        dprSetText('modalJobMould', d.mould_name || '-');
        dprSetText('modalJobJC', d.job_card_no || '-');
        dprSetText('modalJobClient', d.client_name || '-');
        dprSetText('modalJobClientInfo', d.client_name || '-');

        // 2. Dates
        dprSetText('modalJobPlanDate', dprFmtDate(d.plan_date || d.start_date));
        dprSetText('modalJobORDate', dprFmtDate(d.or_date || d.or_jr_date));
        dprSetText('modalJobJCDate', dprFmtDate(d.jc_date || d.job_card_date));

        // 3. Standards & Cavity
        dprSetText('modalJobStdCav', d.std_cavity || d.cavity || '-');
        dprSetText('modalJobActCav', d.act_cavity || d.cavity_act || '-');
        dprSetText('modalJobStdCavity', d.std_cavity || d.cavity || '-');
        dprSetText('modalJobActCavity', d.act_cavity || d.cavity_act || '-');
        dprSetText('modalJobCycle', d.std_cycle_time || d.std_cycle || d.cycleTime || '-');
        dprSetText('modalJobWeight', d.std_weight || '-');
        dprSetText('modalJobStdCycle', d.std_cycle_time || d.std_cycle || d.cycleTime || '-');
        dprSetText('modalJobActCycle', d.act_cycle || d.cycle_act || '-');
        dprSetText('modalJobStdWeight', d.std_weight || '-');
        dprSetText('modalJobActWeight', d.article_act || d.act_weight || '-');

        // 4. Job Summary (Plan vs Actual)
        const machine = d.machine;
        const currentOrder = d.order_no || orderNo;

        loadJobQCEvidence(d);

        // Show Modal
        document.getElementById('jobDetailModal').style.display = 'flex';
        setJobDetailMode('overall');
    }

    async function loadJobQCEvidence(details) {
        const box = document.getElementById('modalJobQCEvidence');
        if (!box) return;

        const jc = details.job_card_no || details.JobCardNo || '';
        const planId = details.plan_id || details.PlanID || '';
        const machine = details.machine || '';
        const stdWeight = details.std_weight || document.getElementById('modalJobWeight')?.innerText || '-';
        const supervisorWeight = details.article_act || details.act_weight || '-';
        box.innerHTML = '<div style="color:#64748b; font-size:0.85rem">Loading QC weights and FPA evidence...</div>';

        try {
            const qs = new URLSearchParams();
            if (jc) qs.set('jobCardNo', jc);
            if (planId) qs.set('planId', planId);
            if (machine) qs.set('machine', machine);
            qs.set('limit', '50');
            const res = await fetch(`/api/qc/job-checks?${qs.toString()}`);
            const json = await res.json();
            const rows = json.ok && Array.isArray(json.data) ? json.data : [];
            const weights = rows
                .flatMap(r => [r.qc_weight_1, r.qc_weight_2, r.qc_weight_3])
                .filter(v => v !== null && v !== undefined && String(v) !== '')
                .slice(0, 3);
            const fpa = rows.find(r => r.fpa_form_image || (Array.isArray(r.product_images) && r.product_images.length));
            const fpaImages = fpa ? [fpa.fpa_form_image, ...((Array.isArray(fpa.product_images) ? fpa.product_images : []))].filter(Boolean) : [];

            box.innerHTML = `
                <h4 style="font-size:1rem; font-weight:900; color:#0f172a; margin:0 0 10px">QC</h4>
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(105px,1fr)); gap:10px">
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px">
                        <div style="font-size:0.7rem; color:#64748b; font-weight:800; text-transform:uppercase">STD Weight</div>
                        <div style="font-weight:800; color:#0f172a">${dprEsc(stdWeight || '-')}</div>
                    </div>
                    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px">
                        <div style="font-size:0.7rem; color:#1d4ed8; font-weight:800; text-transform:uppercase">Supervisor</div>
                        <div style="font-weight:800; color:#1e3a8a">${supervisorWeight || '-'}</div>
                    </div>
                    ${[0, 1, 2].map(i => `
                        <div style="background:#ecfdf5; border:1px solid #bbf7d0; border-radius:10px; padding:10px">
                            <div style="font-size:0.7rem; color:#047857; font-weight:800; text-transform:uppercase">QC Weight ${i + 1}</div>
                            <div style="font-weight:800; color:#064e3b">${weights[i] || '-'}</div>
                        </div>
                    `).join('')}
                </div>
                ${fpaImages.length ? `
                    <div style="font-size:0.85rem; color:#334155; font-weight:800; margin:14px 0 8px">FPA Images</div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px">
                        ${fpaImages.map((src, i) => `
                        <button type="button" onclick="openJobImage(decodeURIComponent('${encodeURIComponent(src)}'))"
                            style="display:block;padding:0;border:2px solid #e2e8f0;background:#f8fafc;cursor:zoom-in;border-radius:10px;overflow:hidden;transition:border-color 0.2s,transform 0.2s;width:100%"
                            onmouseover="this.style.borderColor='#93c5fd';this.style.transform='scale(1.02)'"
                            onmouseout="this.style.borderColor='#e2e8f0';this.style.transform='scale(1)'">
                            <img src="${dprEsc(src)}" alt="FPA image ${i + 1}"
                                style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:8px">
                        </button>`).join('')}
                    </div>
                ` : '<div style="color:#64748b; font-size:0.82rem; margin-top:10px">No FPA images saved for this job yet.</div>'}
            `;
        } catch (err) {
            box.innerHTML = `<div style="color:#b91c1c; font-size:0.85rem">QC evidence could not be loaded: ${String(err.message || err)}</div>`;
        }
    }

    // Real end-timestamp of an hour slot. Day shift starts 07:00; Night starts 19:00
    // and slots after '10-11' fall on the NEXT calendar day (mirrors getSlotEnd in dpr-script-1.js).
    function dprSlotEndTs(dateStr, shift, slot) {
        const dayEndHour = {
            '07-08': 8, '08-09': 9, '09-10': 10, '10-11': 11, '11-12': 12, '12-01': 13,
            '01-02': 14, '02-03': 15, '03-04': 16, '04-05': 17, '05-06': 18, '06-07': 19
        };
        const nightMap = {
            '07-08': [20, 0], '08-09': [21, 0], '09-10': [22, 0], '10-11': [23, 0],
            '11-12': [0, 1], '12-01': [1, 1], '01-02': [2, 1], '02-03': [3, 1],
            '03-04': [4, 1], '04-05': [5, 1], '05-06': [6, 1], '06-07': [7, 1]
        };
        const base = new Date(String(dateStr || '').split('T')[0] + 'T00:00:00');
        if (Number.isNaN(base.getTime())) return 0;
        if (String(shift) === 'Night') {
            const [h, addDay] = nightMap[slot] || [0, 0];
            base.setDate(base.getDate() + addDay);
            base.setHours(h, 0, 0, 0);
        } else {
            base.setHours(dayEndHour[slot] || 0, 0, 0, 0);
        }
        return base.getTime();
    }

    function renderJobTrendChart(logs, info, planQty, produced) {
        const container = document.getElementById('jobTrendContainer');
        if (!container) return;

        // --- 1. Bucket logs per real hour slot (chronological) ---
        const bucketMap = {};
        (Array.isArray(logs) ? logs : []).forEach(l => {
            if (!l || !l.hour_slot) return;
            const ts = dprSlotEndTs(l.date, l.shift, l.hour_slot);
            if (!ts) return;
            const key = `${l.date}|${l.shift}|${l.hour_slot}`;
            if (!bucketMap[key]) bucketMap[key] = { ts, date: l.date, shift: l.shift, slot: l.hour_slot, good: 0, rej: 0, dt: 0 };
            bucketMap[key].good += dprNumber(l.good_qty);
            bucketMap[key].rej += dprNumber(l.reject_qty);
            bucketMap[key].dt += dprNumber(l.downtime_min);
        });
        let buckets = Object.values(bucketMap).sort((a, b) => a.ts - b.ts);

        if (!buckets.length) { container.style.display = 'none'; container.innerHTML = ''; return; }

        const MAX_BARS = 36;
        const clipped = buckets.length > MAX_BARS;
        if (clipped) buckets = buckets.slice(-MAX_BARS);

        // --- 2. Target pcs/hr from standards ---
        const stdCycle = dprNumber(info.std_cycle || info.std_cycle_time);
        const stdCav = dprNumber(info.std_cavity);
        const actCycle = dprNumber(info.act_cycle);
        const actCav = dprNumber(info.act_cavity);
        let targetHr = 0;
        if (stdCycle > 0 && stdCav > 0) targetHr = Math.round((3600 / stdCycle) * stdCav);
        else if (actCycle > 0 && actCav > 0) targetHr = Math.round((3600 / actCycle) * actCav);

        // --- 3. Prediction: remaining ÷ recent run-rate ---
        const remaining = planQty - produced;
        const nonEmpty = buckets.filter(b => b.good > 0);
        const last3 = nonEmpty.slice(-3);
        let rate = last3.length ? last3.reduce((a, b) => a + b.good, 0) / last3.length : 0;
        if (!rate && buckets.length) rate = buckets.reduce((a, b) => a + b.good, 0) / buckets.length;
        if (!rate) rate = targetHr;

        let predHtml = '';
        if (planQty > 0 && remaining <= 0) {
            const lastTs = nonEmpty.length ? nonEmpty[nonEmpty.length - 1].ts : (buckets[buckets.length - 1] || {}).ts;
            const doneStr = lastTs ? new Date(lastTs).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
            predHtml = `<div style="display:flex; align-items:center; gap:8px; background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; border-radius:10px; padding:8px 12px; font-size:0.82rem; font-weight:800"><i class="bi bi-check-circle-fill"></i> Plan completed — last production logged ${doneStr}${remaining < 0 ? ` · over-produced by ${dprFmtQty(Math.abs(remaining))} pcs` : ''}</div>`;
        } else if (planQty > 0 && rate > 0) {
            const hoursLeft = remaining / rate;
            const finish = new Date(Date.now() + hoursLeft * 3600000);
            const behind = targetHr > 0 && rate < targetHr * 0.7;
            const bg = behind ? '#fffbeb' : '#f0f9ff';
            const bd = behind ? '#fde68a' : '#bae6fd';
            const col = behind ? '#b45309' : '#0369a1';
            const icon = behind ? 'bi-exclamation-triangle-fill' : 'bi-clock-history';
            const finStr = finish.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            predHtml = `<div style="display:flex; align-items:center; gap:8px; background:${bg}; border:1px solid ${bd}; color:${col}; border-radius:10px; padding:8px 12px; font-size:0.82rem; font-weight:800; flex-wrap:wrap"><i class="bi ${icon}"></i> Est. completion: <b>${finStr}</b> <span style="font-weight:700; opacity:0.85">(≈ ${hoursLeft >= 48 ? Math.round(hoursLeft / 24) + ' days' : hoursLeft.toFixed(1) + ' hrs'} left · ${dprFmtQty(remaining)} pcs @ ${dprFmtQty(Math.round(rate))} pcs/hr avg${targetHr ? ` · target ${dprFmtQty(targetHr)} pcs/hr` : ''})${behind ? ' — running behind target' : ''}</span></div>`;
        }

        // --- 4. SVG chart ---
        const W = 960, H = 240;
        const padL = 46, padR = 46, padT = 14, padB = 44;
        const plotW = W - padL - padR, plotH = H - padT - padB;
        const n = buckets.length;
        const slotW = plotW / n;
        const barW = Math.min(30, slotW * 0.55);

        const maxQty = Math.max(targetHr, ...buckets.map(b => b.good + b.rej), 1);
        const maxDt = 60; // downtime axis fixed at 60 min/hour
        const yQ = v => padT + plotH - (v / maxQty) * plotH;
        const yD = v => padT + plotH - (Math.min(v, maxDt) / maxDt) * plotH;
        const xC = i => padL + i * slotW + slotW / 2;

        let bars = '', dtPts = [], labels = '', dateMarks = '';
        let lastDate = '';
        buckets.forEach((b, i) => {
            const x = xC(i) - barW / 2;
            const gTop = yQ(b.good), rTop = yQ(b.good + b.rej);
            const tip = `${b.date} ${b.shift} ${b.slot}\nProduced: ${b.good}\nReject: ${b.rej}\nDowntime: ${b.dt} min`;
            bars += `<g><title>${dprEsc(tip)}</title>
                <rect x="${x.toFixed(1)}" y="${gTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${(padT + plotH - gTop).toFixed(1)}" rx="2" fill="#22c55e"></rect>
                ${b.rej > 0 ? `<rect x="${x.toFixed(1)}" y="${rTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${(gTop - rTop).toFixed(1)}" rx="2" fill="#ef4444"></rect>` : ''}
            </g>`;
            dtPts.push(`${xC(i).toFixed(1)},${yD(b.dt).toFixed(1)}`);
            if (n <= 14 || i % Math.ceil(n / 14) === 0) {
                labels += `<text x="${xC(i).toFixed(1)}" y="${H - 26}" text-anchor="middle" font-size="9" fill="#64748b" font-weight="700">${dprEsc(b.slot)}</text>`;
            }
            if (b.date !== lastDate) {
                lastDate = b.date;
                const dLabel = new Date(b.date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                dateMarks += `<line x1="${(padL + i * slotW).toFixed(1)}" y1="${padT}" x2="${(padL + i * slotW).toFixed(1)}" y2="${padT + plotH}" stroke="#cbd5e1" stroke-dasharray="2 3"></line>
                    <text x="${(padL + i * slotW + 3).toFixed(1)}" y="${H - 12}" font-size="9.5" fill="#475569" font-weight="800">${dLabel}${b.shift === 'Night' ? ' 🌙' : ''}</text>`;
            }
        });

        const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
            const y = padT + plotH * (1 - f);
            return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#f1f5f9"></line>
                <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94a3b8" font-weight="700">${dprFmtQty(Math.round(maxQty * f))}</text>
                <text x="${W - padR + 6}" y="${(y + 3).toFixed(1)}" text-anchor="start" font-size="9" fill="#fdba74" font-weight="700">${Math.round(maxDt * f)}m</text>`;
        }).join('');

        const targetLine = targetHr > 0 ? `
            <line x1="${padL}" y1="${yQ(targetHr).toFixed(1)}" x2="${W - padR}" y2="${yQ(targetHr).toFixed(1)}" stroke="#0ea5e9" stroke-width="1.6" stroke-dasharray="6 4"></line>
            <text x="${W - padR - 4}" y="${(yQ(targetHr) - 5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#0284c7" font-weight="800">TARGET ${dprFmtQty(targetHr)}/hr</text>` : '';

        const legend = `
            <div style="display:flex; gap:14px; flex-wrap:wrap; font-size:0.72rem; font-weight:800; color:#475569">
                <span style="display:inline-flex; align-items:center; gap:5px"><span style="width:10px; height:10px; border-radius:3px; background:#22c55e"></span>Produced</span>
                <span style="display:inline-flex; align-items:center; gap:5px"><span style="width:10px; height:10px; border-radius:3px; background:#ef4444"></span>Reject</span>
                <span style="display:inline-flex; align-items:center; gap:5px"><span style="width:14px; height:3px; border-radius:2px; background:#f97316"></span>Downtime (min)</span>
                ${targetHr ? '<span style="display:inline-flex; align-items:center; gap:5px"><span style="width:14px; height:0; border-top:2px dashed #0ea5e9"></span>Target/hr</span>' : ''}
            </div>`;

        container.style.display = 'block';
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap">
                <h4 style="margin:0; font-size:1rem; font-weight:900; color:#0f172a"><i class="bi bi-graph-up" style="color:#0ea5e9; margin-right:6px"></i>Production Trend (Hourly)</h4>
                ${legend}
            </div>
            ${predHtml ? `<div style="margin-bottom:12px">${predHtml}</div>` : ''}
            <div style="overflow-x:auto">
                <svg viewBox="0 0 ${W} ${H}" style="width:100%; min-width:640px; display:block">
                    ${gridLines}
                    ${dateMarks}
                    ${bars}
                    ${targetLine}
                    <polyline points="${dtPts.join(' ')}" fill="none" stroke="#f97316" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
                    ${buckets.map((b, i) => `<circle cx="${xC(i).toFixed(1)}" cy="${yD(b.dt).toFixed(1)}" r="2.6" fill="#f97316"><title>${dprEsc(`${b.slot}: ${b.dt} min downtime`)}</title></circle>`).join('')}
                    ${labels}
                    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#cbd5e1"></line>
                </svg>
            </div>
            ${clipped ? `<div style="font-size:0.72rem; color:#94a3b8; font-weight:700; margin-top:6px">Showing the most recent ${MAX_BARS} production hours.</div>` : ''}
        `;
    }

    // Signed balance → styled HTML. Positive = pending (amber), zero = done (green),
    // negative = over-produced (blue badge) so overruns are never hidden as "0".
    function dprBalHtml(bal) {
        const n = Number(bal) || 0;
        if (n > 0) return `<span style="color:#d97706; font-weight:900">${dprFmtQty(n)}</span>`;
        if (n === 0) return `<span style="color:#16a34a; font-weight:900">✓ Done</span>`;
        return `<span title="Over-produced by ${dprFmtQty(Math.abs(n))}" style="display:inline-block; background:#dbeafe; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:999px; padding:2px 8px; font-weight:900; font-size:0.78rem; white-space:nowrap">+${dprFmtQty(Math.abs(n))} OVER</span>`;
    }

    async function fetchDetailedStats(orderNo, machine, headerDetails) {
        const tbody = document.getElementById('modalJobColours');
        tbody.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:#64748b">Loading stats...</td></tr>';

        // Reset Summary
        dprSetText('modalJobPlanQty', dprFmtQty(headerDetails.plan_qty || 0));
        dprSetText('modalJobPending', '...');
        dprSetText('modalJobProduced', '...');
        const tfoot = document.getElementById('modalJobColoursFooter');
        if (tfoot) tfoot.innerHTML = '';
        const trendBox = document.getElementById('jobTrendContainer');
        if (trendBox) { trendBox.style.display = 'none'; trendBox.innerHTML = ''; }
        closeColourHistory();

        try {
            if (!orderNo) throw new Error("No Order Number");

            const qs = new URLSearchParams();
            qs.set('mode', jobDetailState.mode || 'overall');
            if (machine) qs.set('machine', machine);
            if (headerDetails.plan_id || headerDetails.PlanID) qs.set('planId', headerDetails.plan_id || headerDetails.PlanID);
            if (jobDetailState.mode === 'current') {
                const scope = getJobSummaryScope();
                if (scope.date) qs.set('date', scope.date);
                if (scope.shift && scope.shift !== 'Both') qs.set('shift', scope.shift);
            }
            const ans = await window.JPSMS.api.get(`/analyze/order/${encodeURIComponent(orderNo)}?${qs.toString()}`);

            if (ans.ok && ans.data) {
                jobDetailState.data = ans.data;
                const info = ans.data.info || {};
                const stats = ans.data.colour_stats || {};
                const totals = ans.data.totals || { plan: 0, good: 0, rej: 0, dt: 0 };
                const dtStats = ans.data.downtime_stats || {};
                const rejStats = ans.data.rejection_stats || {};

                // 1. Update Header Info with backend truth if available
                dprSetText('modalJobProduct', info.product_name || info.item_name || headerDetails.product_name || headerDetails.item_name || '-');
                dprSetText('modalJobMould', info.mould_name || headerDetails.mould_name || '-');
                dprSetText('modalJobOrder', info.order_no || orderNo || '-');
                dprSetText('modalJobMachine', info.machine || machine || '-');
                dprSetText('modalJobClient', info.client_name || headerDetails.client_name || '-');
                dprSetText('modalJobClientInfo', info.client_name || headerDetails.client_name || '-');
                dprSetText('modalJobJC', info.job_card_no || headerDetails.job_card_no || headerDetails.jcNo || '-');
                dprSetText('modalJobORDate', dprFmtDate(info.or_jr_date || headerDetails.or_date));
                dprSetText('modalJobJCDate', dprFmtDate(info.job_card_date || headerDetails.jc_date));
                dprSetText('modalJobPlanDate', dprFmtDate(info.start_date || headerDetails.plan_date));
                dprSetText('modalJobStdCycle', info.std_cycle || headerDetails.std_cycle_time || '-');
                dprSetText('modalJobActCycle', info.act_cycle || headerDetails.act_cycle || '-');
                dprSetText('modalJobStdWeight', info.std_weight || headerDetails.std_weight || '-');
                dprSetText('modalJobActWeight', info.act_weight || headerDetails.act_weight || headerDetails.article_act || '-');
                dprSetText('modalJobStdCavity', info.std_cavity || headerDetails.std_cavity || headerDetails.cavity || '-');
                dprSetText('modalJobActCavity', info.act_cavity || headerDetails.act_cavity || headerDetails.cavity_act || '-');
                dprSetText('modalJobStdCav', info.std_cavity || headerDetails.std_cavity || headerDetails.cavity || '-');
                dprSetText('modalJobActCav', info.act_cavity || headerDetails.act_cavity || headerDetails.cavity_act || '-');
                dprSetText('modalJobCycle', info.std_cycle || headerDetails.std_cycle_time || '-');
                dprSetText('modalJobWeight', info.std_weight || headerDetails.std_weight || '-');
                dprSetText('modalJobORQty', dprFmtQty(info.or_qty || headerDetails.or_qty || 0));
                dprSetText('modalJobBatchQty', dprFmtQty(info.batch_qty || info.mould_item_qty || info.plan_qty || headerDetails.batch_qty || 0));

                // 2. Update Progress (Fixing Math Bugs)
                const planQty = Number(totals.plan || info.plan_qty || headerDetails.plan_qty || 0);
                const produced = Number(totals.good || 0);
                // Signed balance: negative = over-produced (never clamp to 0)
                const pending = planQty - produced;

                // Efficiency Calculation: (Produced / Plan) * 100
                const progressPct = planQty > 0 ? ((produced / planQty) * 100).toFixed(1) : 0;

                // Rejection Rate: (Rej / (Good + Rej)) * 100
                const totalShots = produced + Number(totals.rej || 0);
                const rejRate = totalShots > 0 ? ((Number(totals.rej || 0) / totalShots) * 100).toFixed(1) : 0;

                // Update DOM
                dprSetText('modalJobPlanQty', dprFmtQty(planQty));
                dprSetText('modalJobProduced', dprFmtQty(produced));
                // Pending stat: signed — show over-production instead of clamping to 0
                const pendingLabel = document.getElementById('modalJobPendingLabel');
                const pendingEl = document.getElementById('modalJobPending');
                if (pendingEl) {
                    if (pending < 0) {
                        if (pendingLabel) pendingLabel.textContent = 'Over-Produced';
                        pendingEl.innerHTML = `<span style="color:#1d4ed8">+${dprFmtQty(Math.abs(pending))}</span>`;
                    } else {
                        if (pendingLabel) pendingLabel.textContent = 'Pending';
                        pendingEl.textContent = dprFmtQty(pending);
                    }
                }

                // Status chip in the modal header
                const chip = document.getElementById('modalJobStatusChip');
                if (chip) {
                    let chipBg, chipBd, chipColor, chipIcon, chipText;
                    if (planQty > 0 && pending < 0) {
                        chipBg = '#dbeafe'; chipBd = '#bfdbfe'; chipColor = '#1d4ed8'; chipIcon = 'bi-graph-up-arrow'; chipText = 'Over-Produced';
                    } else if (planQty > 0 && pending === 0) {
                        chipBg = '#dcfce7'; chipBd = '#bbf7d0'; chipColor = '#15803d'; chipIcon = 'bi-check-circle-fill'; chipText = 'Completed';
                    } else {
                        chipBg = '#fef3c7'; chipBd = '#fde68a'; chipColor = '#b45309'; chipIcon = 'bi-lightning-charge-fill'; chipText = 'Running';
                    }
                    chip.style.display = 'inline-flex';
                    chip.style.background = chipBg;
                    chip.style.border = `1px solid ${chipBd}`;
                    chip.style.color = chipColor;
                    chip.innerHTML = `<i class="bi ${chipIcon}"></i> ${chipText}`;
                }

                // Progress ring (r=40 → circumference 251.3)
                const arc = document.getElementById('modalJobProgressArc');
                if (arc) {
                    const circ = 251.3;
                    const frac = Math.min(1, Number(progressPct) / 100);
                    arc.setAttribute('stroke-dasharray', `${(circ * frac).toFixed(1)} ${circ}`);
                }
                dprSetText('modalJobEff', progressPct + '%');
                dprSetText('modalJobRejRate', rejRate + '%');
                dprSetText('modalJobRejected', dprFmtQty(totals.rej || 0));
                const fill = document.getElementById('modalJobProgressFill');
                if (fill) fill.style.width = `${Math.min(100, Number(progressPct))}%`;

                // 3. Colour Breakdown Table
                tbody.innerHTML = '';
                const colors = Object.keys(stats);

                const totalPlan = planQty;

                if (colors.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:#64748b">No colour-wise production logs found.</td></tr>';
                } else {
                    let sumPlan = 0;
                    let sumProd = 0;
                    let sumRej = 0;
                    let sumBal = 0;

                    colors.forEach(c => {
                        const d = stats[c];
                        const rowPlan = Number(d.plan_qty || 0);
                        const rowGood = Number(d.good_qty || 0);
                        const rowRej = Number(d.rej_qty || 0);
                        const rowBal = rowPlan - rowGood; // signed: negative = over-produced
                        sumBal += rowBal;
                        sumPlan += rowPlan;
                        sumProd += rowGood;
                        sumRej += rowRej;

                        tbody.innerHTML += `
                            <tr style="border-bottom:1px solid #eee">
                                <td style="padding:10px; font-weight:800">${dprEsc(c)}</td>
                                <td style="padding:10px; text-align:center">${dprFmtQty(rowPlan)}</td>
                                <td style="padding:10px; text-align:center">
                                    <button type="button" onclick="openColourHistory('${encodeURIComponent(c)}')" title="View production history" style="border:0; background:#dcfce7; color:#047857; border-radius:999px; padding:5px 12px; font-weight:900; cursor:pointer">${dprFmtQty(rowGood)}</button>
                                    ${rowPlan > 0 ? `<div style="height:5px; background:#f1f5f9; border-radius:999px; overflow:hidden; margin:6px auto 0; max-width:110px"><div style="height:100%; width:${Math.min(100, (rowGood / rowPlan) * 100).toFixed(1)}%; background:${rowGood >= rowPlan ? '#3b82f6' : '#22c55e'}; border-radius:999px"></div></div>` : ''}
                                </td>
                                <td style="padding:10px; text-align:center; color:#dc2626; font-weight:800">${dprFmtQty(rowRej)}</td>
                                <td style="padding:10px; text-align:center">${dprBalHtml(rowBal)}</td>
                            </tr>
                        `;
                    });

                }

                // ALWAYS Render Total Row (using global job totals)
                const grandTotalPlan = totalPlan;
                const grandTotalProd = produced;
                const grandTotalRej = Number(totals.rej || 0);
                const grandTotalBal = pending;

                const tfoot = document.getElementById('modalJobColoursFooter');
                if (tfoot) {
                    tfoot.innerHTML = `
                        <tr style="background:#f1f5f9; font-weight:bold; color:#1e293b">
                            <td style="padding:10px; text-align:left">TOTAL</td>
                            <td style="padding:10px; text-align:center">${dprFmtQty(grandTotalPlan)}</td>
                            <td style="padding:10px; text-align:center; color:#16a34a">${dprFmtQty(grandTotalProd)}</td>
                            <td style="padding:10px; text-align:center; color:#dc2626">${dprFmtQty(grandTotalRej)}</td>
                            <td style="padding:10px; text-align:center">${dprBalHtml(grandTotalBal)}</td>
                        </tr>
                    `;
                }


                renderReasonAnalysis('dtChartContainer', 'Downtime Analysis', dtStats, 'min', '#f97316', DPR_DOWNTIME_REASONS);
                renderReasonAnalysis('rejChartContainer', 'Rejection Analysis', rejStats, 'qty', '#dc2626', DPR_REJECT_REASONS);
                renderJobTrendChart(ans.data.logs, info, planQty, produced);

            } else {
                tbody.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:#dc2626">Failed to load data.</td></tr>';
            }

        } catch (e) {
            console.error(e);
            tbody.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:#dc2626">Error loading details.</td></tr>';
        }
    }

    function renderDowntimeChart(stats) {
        // Find existing container or create one
        let container = document.getElementById('dtChartContainer');
        if (!container) {
            const tableDiv = document.getElementById('modalJobColours').parentElement.parentElement;
            const wrap = document.createElement('div');
            wrap.id = 'dtChartContainer';
            wrap.style.marginTop = '24px';
            wrap.innerHTML = '<h4 style="font-size:1rem; font-weight:700; color:#334155; margin-bottom:12px">Downtime Analysis</h4><div id="dtChartBody" style="display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start"></div>';
            tableDiv.appendChild(wrap);
            container = wrap;
        }

        const body = document.getElementById('dtChartBody');
        body.innerHTML = '';

        const keys = Object.keys(stats);
        if (keys.length === 0) {
            body.innerHTML = '<div style="color:#94a3b8; font-style:italic">No downtime recorded.</div>';
            return;
        }

        // Sort by duration desc
        const sorted = keys.map(k => ({ code: k, min: stats[k] })).sort((a, b) => b.min - a.min);
        const total = sorted.reduce((a, b) => a + b.min, 0);

        const colors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'];

        // 1. Prepare Pie Chart Segments
        let currentDeg = 0;
        let gradParts = [];

        // 2. Build Legend
        let listHtml = '<div style="flex:1; min-width:200px"><ul style="list-style:none; padding:0; margin:0">';

        sorted.forEach((item, i) => {
            const c = colors[i % colors.length];
            const pct = ((item.min / total) * 100).toFixed(1);
            const deg = (item.min / total) * 360;

            // Pie Segment
            gradParts.push(`${c} ${currentDeg}deg ${currentDeg + deg}deg`);
            currentDeg += deg;

            // Map Code to Reason Label
            const reasonMap = {
                '1': 'Manpower', '2': 'Mould Change', '3': 'Accessories', '4': 'Material', '5': 'M/C Maint',
                '6': 'Nozzle', '7': 'Mould Prob', '8': 'Power/Heat', '9': 'Color Change', '10': 'Process', '11': 'Trial', '12': 'Crane'
            };
            const label = reasonMap[item.code] || `Reason ${item.code}`;

            listHtml += `
                <li style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.85rem">
                    <span style="display:flex; align-items:center; gap:6px">
                        <span style="display:inline-block; width:10px; height:10px; background:${c}; margin-right:6px; border-radius:2px"></span>
                        <span style="color:#475569">${label}</span>
                    </span>
                    <span style="font-weight:700; color:#1e293b">${item.min}m <span style="font-weight:400; color:#94a3b8; font-size:0.75rem">(${pct}%)</span></span>
                </li>
             `;
        });
        listHtml += '</ul></div>';

        const pieHtml = `
            <div style="width:120px; height:120px; border-radius:50%; background:conic-gradient(${gradParts.join(', ')}); position:relative; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)">
                <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:60px; height:60px; background:white; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-direction:column">
                     <div style="font-size:1.1rem; font-weight:800; color:#334155; line-height:1">${total}</div>
                     <div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase">Mins</div>
                </div>
            </div>
        `;

        body.innerHTML = pieHtml + listHtml;
    }

    function closeJobModal() {
        document.getElementById('jobDetailModal').style.display = 'none';
        closeJobImage();
    }

    /* ---- Live Tab Sync -------------------------------------------------- */
    (function () {
      var banner = null;
      var pendingMod = null;

      function showRefreshBanner(mod) {
        pendingMod = mod;
        if (banner) return; // already showing
        banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;' +
          'background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:999px;font-weight:700;font-size:.9rem;' +
          'box-shadow:0 4px 20px rgba(15,23,42,.25);cursor:pointer;display:flex;align-items:center;gap:8px;' +
          'animation:jpsmsSlideDown .3s ease';
        banner.innerHTML = '<i class="bi bi-arrow-clockwise"></i> New data available — tap to refresh';
        banner.onclick = function () {
          if (banner) { banner.remove(); banner = null; }
          location.reload();
        };
        // Auto-dismiss after 8 s without reloading
        setTimeout(function () {
          if (banner) { banner.remove(); banner = null; }
        }, 8000);
        document.body.appendChild(banner);
        if (!document.getElementById('jpsms-slide-down-style')) {
          var s = document.createElement('style');
          s.id = 'jpsms-slide-down-style';
          s.textContent = '@keyframes jpsmsSlideDown{from{opacity:0;transform:translateX(-50%) translateY(-12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
          document.head.appendChild(s);
        }
      }

      window.addEventListener('jpsms:live-refresh', function (e) {
        var mod = (e.detail || {}).module;
        if (mod === 'dpr' || mod === 'planning') showRefreshBanner(mod);
      });
    }());
    /* --------------------------------------------------------------------- */