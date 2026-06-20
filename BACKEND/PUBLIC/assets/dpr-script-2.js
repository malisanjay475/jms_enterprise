    // --- DETAILED JOB SUMMARY MODAL ---
    const jobDetailState = { details: null, orderNo: '', machine: '', mode: 'current', data: null };

    function dprEsc(value) {
        return String(value ?? '-').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
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
        dprSetText('modalJobScopeLabel', jobDetailState.mode === 'current' ? 'Current shift' : 'Overall job');
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

    function renderReasonAnalysis(containerId, title, stats, unit, accent) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const rows = Object.entries(stats || {})
            .map(([reason, qty]) => ({ reason, qty: dprNumber(qty) }))
            .filter(r => r.qty > 0)
            .sort((a, b) => b.qty - a.qty);
        const total = rows.reduce((sum, r) => sum + r.qty, 0);
        container.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
                <h4 style="margin:0; font-size:1rem; font-weight:900; color:#0f172a">${title}</h4>
                <span style="background:${accent}16; color:${accent}; border:1px solid ${accent}44; padding:4px 10px; border-radius:999px; font-size:0.78rem; font-weight:900">${dprFmtQty(total)} ${unit}</span>
            </div>
            ${rows.length ? rows.map(r => {
                const pct = total > 0 ? Math.min(100, (r.qty / total) * 100) : 0;
                return `
                    <div style="margin-bottom:10px">
                        <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.84rem; font-weight:800; color:#334155">
                            <span>${dprEsc(r.reason)}</span>
                            <span>${dprFmtQty(r.qty)} ${unit}</span>
                        </div>
                        <div style="height:8px; background:#f1f5f9; border-radius:999px; overflow:hidden; margin-top:5px">
                            <div style="height:100%; width:${pct}%; background:${accent}; border-radius:999px"></div>
                        </div>
                    </div>
                `;
            }).join('') : `<div style="color:#94a3b8; font-style:italic">No ${title.toLowerCase()} recorded.</div>`}
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

        const isAdmin = !!window.JPSMS?.auth?.hasRole?.('admin');
        const setupBtn = document.getElementById('btnDeleteSetup');
        if (setupBtn) {
            if (isAdmin && d.id) {
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
        setJobDetailMode('current');
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
                        <div style="font-weight:800; color:#0f172a">${stdWeight || '-'}</div>
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

    async function fetchDetailedStats(orderNo, machine, headerDetails) {
        const tbody = document.getElementById('modalJobColours');
        tbody.innerHTML = '<tr><td colspan="5" style="padding:14px; text-align:center; color:#64748b">Loading stats...</td></tr>';

        // Reset Summary
        dprSetText('modalJobPlanQty', dprFmtQty(headerDetails.plan_qty || 0));
        dprSetText('modalJobPending', '...');
        dprSetText('modalJobProduced', '...');
        const tfoot = document.getElementById('modalJobColoursFooter');
        if (tfoot) tfoot.innerHTML = '';
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
                const pending = Math.max(0, planQty - produced);

                // Efficiency Calculation: (Produced / Plan) * 100
                const progressPct = planQty > 0 ? ((produced / planQty) * 100).toFixed(1) : 0;

                // Rejection Rate: (Rej / (Good + Rej)) * 100
                const totalShots = produced + Number(totals.rej || 0);
                const rejRate = totalShots > 0 ? ((Number(totals.rej || 0) / totalShots) * 100).toFixed(1) : 0;

                // Update DOM
                dprSetText('modalJobPlanQty', dprFmtQty(planQty));
                dprSetText('modalJobProduced', dprFmtQty(produced));
                dprSetText('modalJobPending', dprFmtQty(pending));
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
                        const rowPlan = Number(d.plan || 0);
                        const rowGood = Number(d.good || 0);
                        const rowRej = Number(d.rej || 0);
                        const rowBal = Math.max(0, rowPlan - rowGood);
                        sumBal += rowBal;
                        sumPlan += rowPlan;
                        sumProd += rowGood;
                        sumRej += rowRej;

                        tbody.innerHTML += `
                            <tr style="border-bottom:1px solid #eee">
                                <td style="padding:10px; font-weight:800">${dprEsc(c)}</td>
                                <td style="padding:10px; text-align:center">${dprFmtQty(rowPlan)}</td>
                                <td style="padding:10px; text-align:center"><button type="button" onclick="openColourHistory('${encodeURIComponent(c)}')" style="border:0; background:#dcfce7; color:#047857; border-radius:999px; padding:5px 12px; font-weight:900; cursor:pointer">${dprFmtQty(rowGood)}</button></td>
                                <td style="padding:10px; text-align:center; color:#dc2626; font-weight:800">${dprFmtQty(rowRej)}</td>
                                <td style="padding:10px; text-align:center; color:#d97706; font-weight:900">${dprFmtQty(rowBal)}</td>
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
                            <td style="padding:10px; text-align:center; color:#d97706">${dprFmtQty(grandTotalBal)}</td>
                        </tr>
                    `;
                }


                renderReasonAnalysis('dtChartContainer', 'Downtime Analysis', dtStats, 'min', '#f97316');
                renderReasonAnalysis('rejChartContainer', 'Rejection Analysis', rejStats, 'qty', '#dc2626');

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