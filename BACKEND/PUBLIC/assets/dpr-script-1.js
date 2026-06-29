        function dprEscHtml(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        }

        // Strip "LINE>" prefix from machine codes — e.g. "C -L1>C-L1-OM-660-1" → "C-L1-OM-660-1"
        function stripMachPfx(s) {
            const t = String(s || '').trim();
            return t.includes('>') ? t.split('>').pop().trim() : t;
        }

        // --- CODE MAPPINGS ---
        const REJECTION_CODES = {
            'A': 'Short Shot',
            'B': 'Shrinkage',
            'C': 'Silver / Color Streak',
            'D': 'Flow Line / Weld Line',
            'E': 'Fitment Issue',
            'F': 'Dent / Air Trap',
            'G': 'Warpage',
            'H': 'Black Dot / Water Mark',
            'I': 'Startup Rejection',
            'J': 'Bottom Cracking',
            'K': 'Scratches',
            'L': 'Overlap',
            'M': 'Punching Issue'
        };
        const DOWNTIME_CODES = {
            '1': 'Manpower Shortage',
            '2': 'Mould Change',
            '3': 'Accessories Issue',
            '4': 'No Material',
            '5': 'Machine Maintenance',
            '6': 'Nozzle Blockage',
            '7': 'Mould Problem',
            '8': 'Power / Heater Failure',
            '9': 'Color Change',
            '10': 'Process Setting',
            '11': 'Mould Trial',
            '12': 'Crane / Loading'
        };

        // --- DETAIL MODAL LOGIC ---
        window.showEntryDetails = (entry) => {
            const e = typeof entry === 'string' ? JSON.parse(decodeURIComponent(entry)) : entry;
            const content = document.getElementById('modal-details-content');

            let html = `
                <div style="margin-bottom:20px; text-align:center">
                    <div style="font-size:0.9rem; color:#64748b; font-weight:600">${e.mould_no || '-'} / ${e.colour || '-'}</div>
                    <div style="font-size:1.2rem; margin-top:5px">
                        <span style="font-weight:700; color:#16a34a">${e.good_qty} OK</span>
                        ${e.reject_qty > 0 ? `<span style="margin:0 10px; color:#cbd5e1">|</span><span style="font-weight:700; color:#ef4444">${e.reject_qty} Rej</span>` : ''}
                        ${e.downtime_min > 0 ? `<span style="margin:0 10px; color:#cbd5e1">|</span><span style="font-weight:700; color:#db2777">${(e.downtime_min / 60).toFixed(1)}h DT</span>` : ''}
                    </div>
                </div>
            `;

            // Rejection Reasons
            const rejMap = typeof e.reject_breakup === 'object' ? e.reject_breakup : {};
            if (Object.keys(rejMap).length > 0) {
                html += `<h6 style="font-weight:700; border-bottom:2px solid #fecaca; padding-bottom:5px; margin-top:20px; color:#991b1b">Rejection Reasons</h6>
                 <table style="width:100%; font-size:0.9rem; margin-top:10px">`;
                Object.entries(rejMap).forEach(([k, v]) => {
                    const name = REJECTION_CODES[k] || k;
                    if (v > 0) html += `<tr><td style="padding:4px; color:#475569"><span style="font-weight:600; color:#ef4444; margin-right:6px"></span>${name}</td><td style="padding:4px; text-align:right; font-weight:700; color:#ef4444">${v}</td></tr>`;
                });
                html += `</table>`;
            } else if (e.reject_qty > 0) {
                html += `<div style="padding:10px; background:#fff1f2; color:#be123c; border-radius:6px; margin-top:10px; font-size:0.9rem">Rejections recorded but no reasons specified.</div>`;
            }

            // Downtime Reasons
            const dtMap = typeof e.downtime_breakup === 'object' ? e.downtime_breakup : {};
            if (Object.keys(dtMap).length > 0) {
                html += `<h6 style="font-weight:700; border-bottom:2px solid #fbcfe8; padding-bottom:5px; margin-top:20px; color:#831843">Downtime Reasons</h6>
                 <table style="width:100%; font-size:0.9rem; margin-top:10px">`;
                Object.entries(dtMap).forEach(([k, v]) => {
                    const name = DOWNTIME_CODES[k] || k;
                    if (v > 0) html += `<tr><td style="padding:4px; color:#475569"><span style="font-weight:600; color:#db2777; margin-right:6px"></span>${name}</td><td style="padding:4px; text-align:right; font-weight:700; color:#db2777">${v}m</td></tr>`;
                });
                html += `</table>`;
            } else if (e.downtime_min > 0) {
                html += `<div style="padding:10px; background:#fdf2f8; color:#be185d; border-radius:6px; margin-top:10px; font-size:0.9rem">Downtime recorded but no reasons specified.</div>`;
            }

            content.innerHTML = html;
            document.getElementById('modal-details').style.display = 'flex';
        };

        window.showSummaryDetails = (machine, shift, line, totalGood, totalRej, totalDt, totalAutoDt, stdPcs, aggRejReasons, aggDtReasons) => {
            // Decode if strings
            const rReasons = typeof aggRejReasons === 'string' ? JSON.parse(decodeURIComponent(aggRejReasons)) : aggRejReasons;
            const dReasons = typeof aggDtReasons === 'string' ? JSON.parse(decodeURIComponent(aggDtReasons)) : aggDtReasons;

            const content = document.getElementById('modal-details-content');
            let html = `
                <div style="margin-bottom:20px; text-align:center">
                    <div style="font-size:0.9rem; color:#64748b; font-weight:600">${line} - ${stripMachPfx(machine)} (${shift})</div>
                    <div style="font-size:1.4rem; margin-top:5px; font-weight:800; color:#0f172a">Summary Breakdown</div>
                    
                    <div style="display:flex; justify-content:center; gap:20px; margin-top:15px; flex-wrap:wrap">
                        <div style="text-align:center">
                            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase">Production</div>
                            <div style="font-size:1.2rem; font-weight:700; color:#16a34a">${totalGood}</div>
                            <div style="font-size:0.75rem; color:#64748b">STD: <b>${stdPcs}</b></div>
                        </div>
                        <div style="text-align:center">
                            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase">Rejection</div>
                            <div style="font-size:1.2rem; font-weight:700; color:#ef4444">${totalRej}</div>
                        </div>
                        <div style="text-align:center">
                            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase">Downtime</div>
                            <div style="font-size:1.2rem; font-weight:700; color:#db2777">${(totalDt / 60).toFixed(1)} Hrs</div>
                        </div>
                         <div style="text-align:center">
                            <div style="font-size:0.75rem; color:#be185d; text-transform:uppercase">Auto DT</div>
                            <div style="font-size:1.2rem; font-weight:700; color:#be185d">${Math.round(totalAutoDt)}m</div>
                        </div>
                    </div>
                </div>
             `;

            // Aggregated Rejections
            if (Object.keys(rReasons).length > 0) {
                // Sort
                const sorted = Object.entries(rReasons).sort((a, b) => b[1] - a[1]);
                html += `<h6 style="font-weight:700; border-bottom:2px solid #fecaca; padding-bottom:5px; margin-top:20px; color:#991b1b">Top Rejection Reasons</h6>
                 <table style="width:100%; font-size:0.9rem; margin-top:10px">`;
                sorted.forEach(([k, v]) => {
                    const name = REJECTION_CODES[k] || k;
                    html += `<tr><td style="padding:4px; color:#475569"><span style="font-weight:600; color:#ef4444; margin-right:6px"></span>${name}</td><td style="padding:4px; text-align:right; font-weight:700; color:#ef4444">${v}</td></tr>`;
                });
                html += `</table>`;
            }

            // Aggregated Downtime
            if (Object.keys(dReasons).length > 0) {
                const sorted = Object.entries(dReasons).sort((a, b) => b[1] - a[1]);
                html += `<h6 style="font-weight:700; border-bottom:2px solid #fbcfe8; padding-bottom:5px; margin-top:20px; color:#831843">Top Downtime Reasons</h6>
                 <table style="width:100%; font-size:0.9rem; margin-top:10px">`;
                sorted.forEach(([k, v]) => {
                    const name = DOWNTIME_CODES[k] || k;
                    html += `<tr><td style="padding:4px; color:#475569"><span style="font-weight:600; color:#db2777; margin-right:6px"></span>${name}</td><td style="padding:4px; text-align:right; font-weight:700; color:#db2777">${v}m</td></tr>`;
                });
                html += `</table>`;
            } else if (totalDt > 0) {
                html += `<div style="padding:10px; background:#fdf2f8; color:#be185d; border-radius:6px; margin-top:10px; font-size:0.9rem">Total downtime recorded but no reasons available.</div>`;
            }

            content.innerHTML = html;
            document.getElementById('modal-details').style.display = 'flex';
        };

        // [FIX] IST-safe "today" helper — toISOString() always returns UTC, which is one
        // calendar day BEHIND IST between midnight IST (18:30 UTC) and 05:30 IST (00:00 UTC).
        // Using local-time getters ensures the correct IST date even at night-shift hours.
        function localToday() {
            const d = new Date();
            return d.getFullYear() + '-'
                + String(d.getMonth() + 1).padStart(2, '0') + '-'
                + String(d.getDate()).padStart(2, '0');
        }

        document.addEventListener('DOMContentLoaded', () => {
            const J = window.JPSMS;
            if (J && J.auth) {
                try { J.auth.requireAuth(); } catch (e) { }
            }
            if (J && J.renderShell) {
                J.renderShell('dpr');
            }

            // Handle View Params
            const params = new URLSearchParams(window.location.search);
            const view = params.get('view') || 'summary';
            const card = document.querySelector('.card');
            const title = document.querySelector('.page-title');

            if (view === 'hourly') {
                title.textContent = 'DPR Hourly Report';

                // FILTER BAR — use local-time date (NOT toISOString which is UTC)
                const today = localToday();
                card.innerHTML = `
                  <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:15px; align-items:flex-end; padding:15px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0">
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Date</label>
                      <input type="date" id="f-date" class="form-control" style="padding:6px; border:1px solid #cbd5e1; border-radius:4px" value="${today}">
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Shift</label>
                      <select id="f-shift" class="form-control" style="padding:7px; border:1px solid #cbd5e1; border-radius:4px; min-width:100px">
                         <option value="">All</option>
                         <option value="Day">Day</option>
                         <option value="Night">Night</option>
                      </select>
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Line</label>
                      <select id="f-line" class="form-control" style="padding:7px; border:1px solid #cbd5e1; border-radius:4px; min-width:120px">
                         <option value="">All Lines</option>
                         <option value="B -L1">B -L1</option>
                         <option value="B -L2">B -L2</option>
                         <option value="B -L3">B -L3</option>
                         <option value="B -L4">B -L4</option>
                         <option value="B -L5">B -L5</option>
                         <option value="B -L6">B -L6</option>
                      </select>
                    </div>
                    <div style="display:flex; gap:10px">
                      <button id="btn-apply" class="btn btn-primary" style="padding:7px 15px; background:#3b82f6; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer">Apply Filter</button>
                      <button id="btn-clear" class="btn btn-outline" style="padding:7px 15px; background:white; color:#64748b; border:1px solid #cbd5e1; border-radius:4px; font-weight:600; cursor:pointer">Clear</button>
                      <button id="btn-clear-all" class="btn" style="padding:7px 15px; background:#ef4444; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer">Clear All Data (Admin)</button>
                    </div>
                  </div>
                  <div id="hourly-table-container">
                    <div style="padding:20px; text-align:center; color:#64748b"><i class="bi bi-arrow-repeat spin"></i> Loading hourly report...</div>
                  </div>
                `;

                const loadHourly = () => {
                    const date = document.getElementById('f-date').value;
                    const shift = document.getElementById('f-shift').value;
                    const line = document.getElementById('f-line').value;
                    const container = document.getElementById('hourly-table-container');

                    container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748b"><i class="bi bi-arrow-repeat spin"></i> Loading data...</div>`;

                    let q = '/dpr/hourly?';
                    if (date) q += `date=${encodeURIComponent(date)}&`;
                    if (shift) q += `shift=${encodeURIComponent(shift)}&`;
                    if (line) q += `line=${encodeURIComponent(line)}&`;

                    J.api.get(q).then(res => {
                        if (!res.ok || !res.data) throw new Error(res.error || 'No data');
                        const list = res.data;

                        // define columns header
                        const headers = [
                            'Date', 'Shift', 'Line', 'Machine',
                            'Product Name', 'Mould Name', 'MouldNo', 'Colour',
                            'HourSlot', 'JobCardNo', 'OrderNo', 'ItemCode', 'PlanID', 'Name',
                            'ActWeight', 'ActualCavity', 'Shots', 'GoodQty', 'RejectQty', 'DowntimeMin', 'Entry Person', 'Remarks', 'EntryType', 'CreatedAt', 'EnteredAt',
                            // DT
                            'DT 1 - Manpower', 'DT 2 - Mould Change', 'DT 3 - Accessories', 'DT 4 - Material', 'DT 5 - M/C Maint',
                            'DT 6 - Nozzle', 'DT 7 - Mould Prob', 'DT 8 - Power/Heat', 'DT 9 - Color Change', 'DT 10 - Process', 'DT 11 - Trial', 'DT 12 - Crane',
                            'DowntimeBreakup',
                            // REJ
                            'REJ A - Short', 'REJ B - Shrinkage', 'REJ C - Silver/Color', 'REJ D - Flow/Weld', 'REJ E - Fitment', 'REJ F - Dent/Air', 'REJ G - Warpage',
                            'REJ H - Black/Water', 'REJ I - Startup', 'REJ J - Bottom', 'REJ K - Scratch', 'REJ L - Over Lap', 'REJ M - Punching',
                            'RejectBreakup'
                        ];

                        const isAdmin = (J.auth.isAdminLike ? J.auth.isAdminLike(J.auth.getUser()) : J.auth.getUser().role_code === 'admin');
                        if (isAdmin) headers.unshift('Action');

                        let html = `
                        <div style="margin-bottom:12px; font-weight:700; color:#475569; font-size:0.88rem; display:flex; align-items:center; gap:8px">
                            <span style="background:#e0f2fe; color:#0369a1; padding:4px 10px; border-radius:99px; font-size:0.75rem; font-weight:800">${list.length}</span>
                            <span>Total Hourly Entries Found</span>
                        </div>
                        <div style="overflow-x:auto; max-height:80vh">
                        <table class="table" style="width:100%; border-collapse:collapse; font-size:0.75rem; white-space:nowrap">
                        <thead style="background:#f1f5f9; text-transform:uppercase; color:#64748b; font-weight:700; position:sticky; top:0; z-index:10">
                            <tr>
                            ${headers.map((h, i) => `<th style="padding:8px; border-bottom:2px solid #e2e8f0; border-right:1px solid #e2e8f0; background:#f1f5f9">${h} <span style="font-size:0.65rem; opacity:0.5">${i + 1}</span></th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>`;

                        const parseMap = (val) => {
                            const map = {};
                            if (!val) return map;

                            // 1. Handle Object (JSONB from DB)
                            if (typeof val === 'object') {
                                Object.keys(val).forEach(k => {
                                    map[k] = val[k];
                                });
                                return map;
                            }

                            // 2. Handle String (Legacy "Code:Qty|...")
                            String(val).split('|').forEach(p => {
                                const [k, v] = p.split(':');
                                if (k && v) map[k.trim()] = v;
                            });
                            return map;
                        };

                        if (!list.length) {
                            html += `<tr><td colspan="${headers.length}" style="padding:20px; text-align:center">No records found for selected filters.</td></tr>`;
                        } else {
                            list.forEach(r => {
                                const dtMap = parseMap(r.downtime_breakup);
                                const rejMap = parseMap(r.reject_breakup);

                                // Helper to show raw breakup text
                                const fmtBreakup = (b) => {
                                    if (!b) return '';
                                    if (typeof b === 'object') return JSON.stringify(b);
                                    return b;
                                };

                                html += `
                                <tr style="border-bottom:1px solid #e2e8f0; hover:background:#f8fafc">
                                ${isAdmin ? `<td style="padding:6px; border-right:1px solid #f1f5f9; text-align:center"><button class="btn btn-sm btn-outline" onclick='openDprEdit(${JSON.stringify(r)})' title="Edit (Admin)"><i class="bi bi-pencil"></i></button></td>` : ''}
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.dpr_date || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.shift || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.line || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; font-weight:600">${r.machine || '-'}</td>
                                
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.product_name || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.mould_name || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.mould_no || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.colour || '-'}</td>
                                
                                <td style="padding:6px; border-right:1px solid #f1f5f9; font-weight:600">${r.hour_slot || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.job_card_no || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; font-family:monospace">${r.order_no || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.item_code || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; color:#94a3b8">${r.plan_id || '-'}</td>
                                
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.user_name || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${r.act_weight || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${r.actual_cavity || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${r.shots || 0}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right; font-weight:600; color:#10b981">${r.good_qty || 0}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right; color:#ef4444">${r.reject_qty || 0}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right; color:#f59e0b">${r.downtime_min || 0}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.supervisor || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; max-width:150px; overflow:hidden; text-overflow:ellipsis" title="${r.remarks || ''}">${r.remarks || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9">${r.entry_type || '-'}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; color:#94a3b8">${new Date(r.created_at).toLocaleString()}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; color:#94a3b8">${r.entered_at ? new Date(r.entered_at).toLocaleString() : '-'}</td>

                                <!-- DT 1-12 -->
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['1'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['2'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['3'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['4'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['5'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['6'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['7'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['8'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['9'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['10'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['11'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${dtMap['12'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; font-size:0.7rem; color:#94a3b8">${fmtBreakup(r.downtime_breakup)}</td>
                                
                                <!-- REJ A-M -->
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['A'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['B'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['C'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['D'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['E'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['F'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['G'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['H'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['I'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['J'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['K'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['L'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; text-align:right">${rejMap['M'] || ''}</td>
                                <td style="padding:6px; border-right:1px solid #f1f5f9; font-size:0.7rem; color:#94a3b8">${fmtBreakup(r.reject_breakup)}</td>
                                </tr>`;
                            });
                        }

                        html += `</tbody></table></div>`;
                        container.innerHTML = html;
                    }).catch(err => {
                        container.innerHTML = `<div style="padding:20px; text-align:center; color:#ef4444">Error loading data: ${err.message}</div>`;
                    });
                };

                // Bind Events
                document.getElementById('btn-apply').onclick = loadHourly;
                document.getElementById('btn-clear').onclick = () => {
                    document.getElementById('f-date').value = '';
                    document.getElementById('f-shift').value = '';
                    document.getElementById('f-line').value = '';
                    loadHourly();
                };

                document.getElementById('btn-clear-all').onclick = () => {
                    if (!confirm('DANGER: This will delete ALL HOURLY entries permanently.\nAre you sure you want to proceed?')) return;
                    if (!confirm('Double Check: Are you absolutely sure? This cannot be undone.')) return;

                    J.api.post('/dpr/hourly/clear', { session: J.auth.session }).then(res => {
                        if (res.ok) { alert('All data cleared.'); loadHourly(); }
                        else { alert('Error: ' + (res.error || 'Failed')); }
                    });
                };

                // Initial Load (active by default)
                // Security: Hide Clear All if not admin
                const u = J.auth.getUser();
                if (!(J.auth.isAdminLike ? J.auth.isAdminLike(u) : u.role_code === 'admin')) {
                    const btn = document.getElementById('btn-clear-all');
                    if (btn) btn.style.display = 'none';
                }

                loadHourly();
            } else if (view === 'summary') {
                title.textContent = 'DPR Compliance Summary';

                // Reuse Filter UI — use local-time date (NOT toISOString which is UTC)
                const today = localToday();
                const nowMins = new Date().getHours() * 60 + new Date().getMinutes(); // browser local time (IST on factory devices)
                // Auto-detect shift: factory handover at 08:10 AM / 08:10 PM
                const defaultShift = (nowMins >= 1210 || nowMins < 490) ? 'Night' : 'Day';
                const DPR_PROCESS_OPTIONS = ['Moulding', 'Printing', 'Tuffting', 'Labour Job'];
                let dprProcess = localStorage.getItem('jpsms_dpr_process') || 'Moulding';

                card.innerHTML = `
                  <div id="sticky-dpr-filter" style="position:sticky; top:0; z-index:50; display:flex; flex-wrap:wrap; gap:10px; margin-bottom:15px; align-items:flex-end; padding:15px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0; box-shadow:0 1px 3px rgba(0,0,0,0.1)">
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Date</label>
                      <input type="date" id="s-date" class="form-control" style="padding:6px; border:1px solid #cbd5e1; border-radius:4px" value="${today}">
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Process</label>
                      <div id="s-process" style="display:flex; gap:10px; flex-wrap:wrap; min-width:340px;"></div>
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Shift</label>
                      <select id="s-shift" class="form-control" style="padding:7px; border:1px solid #cbd5e1; border-radius:4px; min-width:100px">
                         <option value="Day">Day</option>
                         <option value="Night">Night</option>
                         <option value="Both">Both (24h)</option>
                      </select>
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Factory</label>
                      <select id="s-factory" class="form-control" style="padding:7px; border:1px solid #cbd5e1; border-radius:4px; min-width:150px">
                        <option value="">All Factories</option>
                      </select>
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">Line Filter</label>
                      <select id="s-line" class="form-control" style="padding:7px; border:1px solid #cbd5e1; border-radius:4px; min-width:130px">
                        <option value="">All Lines</option>
                      </select>
                    </div>
                    <div>
                      <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:4px">View Filter</label>
                      <select id="s-eff-filter" class="form-control" style="padding:7px; border:1px solid #cbd5e1; border-radius:4px; min-width:160px">
                        <option value="">All</option>
                        <option value="Pending">⚠️ Pending Entries</option>
                        <option value="LowEff">Low EFF</option>
                        <option value="ManPowerShortage">MP Shortage</option>
                        <option value="MouldMaintenance">Mould Maintenance</option>
                        <option value="PowerCut">Power Cut</option>
                        <option value="NoPlan">No Plan</option>
                        <option value="MachineMaintenance">Machine Maintenance</option>
                        <option value="MouldTrial">Mould Trial</option>
                      </select>
                    </div>
                    <div style="display:flex; gap:10px">
                      <button id="btn-s-apply" class="btn btn-primary" style="padding:7px 15px; background:#3b82f6; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer">Apply</button>
                    </div>
                    <div style="flex:1; text-align:right; font-size:0.8rem; color:#64748b; align-self:center">
                        <span style="display:inline-block; width:12px; height:12px; background:#22c55e; margin-right:4px; vertical-align:middle; border-radius:3px"></span>Filled
                        <span style="display:inline-block; width:12px; height:12px; background:#facc15; margin-left:10px; margin-right:4px; vertical-align:middle; border-radius:3px"></span>Late (>45m)
                        <span style="display:inline-block; width:12px; height:12px; background:#ef4444; margin-left:10px; margin-right:4px; vertical-align:middle; border-radius:3px"></span>Missing
                        <span style="display:inline-block; width:12px; height:12px; background:#e2e8f0; margin-left:10px; margin-right:4px; vertical-align:middle; border-radius:3px"></span>Future
                    </div>
                  </div>
                  <div id="summary-container">
                    <div style="padding:20px; text-align:center; color:#64748b"><i class="bi bi-arrow-repeat spin"></i> Loading summary map...</div>
                  </div>
                `;

                // Set default shift
                document.getElementById('s-shift').value = defaultShift;

                const renderDprProcessButtons = () => {
                    const host = document.getElementById('s-process');
                    if (!host) return;
                    host.innerHTML = DPR_PROCESS_OPTIONS.map(option => {
                        const isActive = option === dprProcess;
                        const style = isActive
                            ? 'background:linear-gradient(135deg,#0f8ea8,#024c81); color:#fff; border-color:transparent; box-shadow:0 12px 24px rgba(2,76,129,0.2);'
                            : 'background:#fff; color:#0f172a; border-color:rgba(148,163,184,0.35); box-shadow:0 8px 18px rgba(15,23,42,0.08);';
                        return `<button type="button" data-process-option="${option}" style="min-width:104px; padding:12px 16px; border-radius:16px; border:1px solid; font-size:0.92rem; font-weight:800; ${style}">${option}</button>`;
                    }).join('');
                    Array.from(host.querySelectorAll('[data-process-option]')).forEach(btn => {
                        btn.onclick = () => {
                            dprProcess = btn.dataset.processOption;
                            localStorage.setItem('jpsms_dpr_process', dprProcess);
                            renderDprProcessButtons();
                            loadSummary();
                        };
                    });
                };
                renderDprProcessButtons();

                // ---- Labour DPR Summary ----
                let _labourDprPartyId = '';
                const loadLabourDprSummary = async (container, fromDate, toDate, shiftMode) => {
                    const esc = dprEscHtml;
                    container.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b"><i class="bi bi-arrow-repeat spin" style="font-size:2rem;display:block;margin-bottom:10px"></i> Loading Labour DPR...</div>`;

                    // Load parties first if dropdown not ready
                    let parties = [];
                    try {
                        const pr = await J.api.get('/labour-parties');
                        parties = (pr.data || []).filter(p => p.is_active);
                    } catch(e) { /* ignore */ }

                    // Build static shell (no dynamic data in innerHTML to avoid XSS flagging)
                    container.innerHTML = `
                      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-bottom:16px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
                        <div>
                          <label style="font-size:0.75rem;font-weight:700;color:#92400e;display:block;margin-bottom:4px">Labour Party</label>
                          <select id="lj-dpr-party" style="padding:7px 10px;border:1px solid #fde68a;border-radius:6px;min-width:180px;background:#fff;font-weight:700">
                            <option value="">— Select Party —</option>
                          </select>
                        </div>
                        <button id="lj-dpr-load" style="padding:8px 18px;background:#b45309;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700">
                          <i class="bi bi-search"></i> Load
                        </button>
                        <button id="lj-dpr-add" style="padding:8px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700">
                          <i class="bi bi-plus-lg"></i> Add Entry
                        </button>
                      </div>
                      <div id="lj-dpr-grid" style="overflow-x:auto"></div>
                      <!-- Labour DPR Entry Modal -->
                      <div id="ljDprModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9000;align-items:center;justify-content:center">
                        <div style="background:#fff;padding:24px;border-radius:12px;width:460px;max-width:92%;border-top:4px solid #b45309;max-height:90vh;overflow-y:auto">
                          <div style="font-weight:800;color:#92400e;margin-bottom:16px"><i class="bi bi-people-fill"></i> Labour Job DPR Entry</div>
                          <input type="hidden" id="lj-entry-id">
                          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                            <div>
                              <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Date</label>
                              <input type="date" id="lj-e-date" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box" value="${esc(fromDate)}">
                            </div>
                            <div>
                              <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Shift</label>
                              <select id="lj-e-shift" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box">
                                <option value="Day">Day</option>
                                <option value="Night">Night</option>
                              </select>
                            </div>
                          </div>
                          <div style="margin-bottom:12px">
                            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Machine</label>
                            <select id="lj-e-machine" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box">
                              <option value="">— Select Machine —</option>
                            </select>
                          </div>
                          <div style="margin-bottom:12px">
                            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Colour</label>
                            <select id="lj-e-colour" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box">
                              <option value="">— Select Machine First —</option>
                            </select>
                          </div>
                          <div id="lj-colour-info" style="display:none;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:12px">
                            <div style="display:flex;gap:24px">
                              <div>
                                <div style="font-size:0.7rem;font-weight:700;color:#92400e;margin-bottom:2px">PLAN QTY</div>
                                <div id="lj-plan-qty-disp" style="font-size:1.25rem;font-weight:800;color:#92400e">0</div>
                              </div>
                              <div>
                                <div style="font-size:0.7rem;font-weight:700;color:#0369a1;margin-bottom:2px">BAL QTY</div>
                                <div id="lj-bal-qty-disp" style="font-size:1.25rem;font-weight:800;color:#0369a1">0</div>
                              </div>
                            </div>
                          </div>
                          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                            <div>
                              <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Produced Qty</label>
                              <input type="number" id="lj-e-good" min="0" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box" value="0">
                            </div>
                            <div>
                              <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Reject Qty</label>
                              <input type="number" id="lj-e-reject" min="0" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box" value="0">
                            </div>
                          </div>
                          <div style="margin-bottom:12px">
                            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Reject Reason</label>
                            <input type="text" id="lj-e-reason" placeholder="Reason (optional)" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box">
                          </div>
                          <div style="margin-bottom:16px">
                            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:4px">Remarks</label>
                            <input type="text" id="lj-e-remarks" placeholder="Remarks (optional)" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;box-sizing:border-box">
                          </div>
                          <div style="display:flex;gap:10px;justify-content:flex-end">
                            <button id="lj-e-cancel" style="padding:7px 14px;border:1px solid #e2e8f0;background:#fff;border-radius:6px;cursor:pointer">Cancel</button>
                            <button id="lj-e-save" style="padding:7px 18px;background:#b45309;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer">Save</button>
                          </div>
                        </div>
                      </div>
                    `;

                    const partySelect = document.getElementById('lj-dpr-party');
                    // Populate party options via DOM (avoids XSS-through-dom CodeQL flag)
                    parties.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = String(p.id);
                        opt.textContent = p.party_name;
                        if (String(p.id) === String(_labourDprPartyId)) opt.selected = true;
                        partySelect.appendChild(opt);
                    });
                    const gridEl = document.getElementById('lj-dpr-grid');
                    const modal = document.getElementById('ljDprModal');

                    // Per-colour plan data fetched when machine is chosen
                    let _colourPlanData = [];

                    const _updateBalDisplay = () => {
                        const colourSel = document.getElementById('lj-e-colour');
                        const infoEl = document.getElementById('lj-colour-info');
                        const planDisp = document.getElementById('lj-plan-qty-disp');
                        const balDisp = document.getElementById('lj-bal-qty-disp');
                        if (!colourSel || !infoEl) return;
                        const chosen = _colourPlanData.find(c => c.colour === colourSel.value);
                        if (chosen) {
                            const entered = parseFloat(document.getElementById('lj-e-good')?.value || 0) || 0;
                            const newBal = Math.max(0, chosen.bal_qty - entered);
                            if (planDisp) planDisp.textContent = String(chosen.plan_qty);
                            if (balDisp) balDisp.textContent = String(newBal);
                            infoEl.style.display = 'block';
                        } else {
                            infoEl.style.display = 'none';
                        }
                    };

                    const loadGrid = async () => {
                        const pId = partySelect?.value || '';
                        _labourDprPartyId = pId;
                        if (!pId) { gridEl.innerHTML = '<div style="color:#94a3b8;padding:20px">Select a party to view DPR entries.</div>'; return; }
                        gridEl.innerHTML = '<div style="padding:20px;color:#64748b">Loading...</div>';
                        try {
                            const params = new URLSearchParams({ from: fromDate, to: toDate, party_id: pId });
                            if (shiftMode !== 'Both') params.set('shift', shiftMode);
                            const res = await J.api.get(`/dpr/labour?${params}`);
                            const entries = res.data || [];
                            if (!entries.length) { gridEl.innerHTML = '<div style="padding:20px;color:#94a3b8">No entries found for selected dates/party.</div>'; return; }
                            const tbody = document.createElement('tbody');
                            entries.forEach(e => {
                                const tr = document.createElement('tr');
                                tr.style.cssText = 'border-bottom:1px solid #fef3c7';
                                const shiftBg = e.shift === 'Night' ? '#1e293b' : '#fef9c3';
                                const shiftColor = e.shift === 'Night' ? '#fff' : '#92400e';
                                const rejectColor = Number(e.reject_qty) > 0 ? '#dc2626' : '#94a3b8';
                                const cellDefs = [
                                    { text: e.dpr_date ? new Date(e.dpr_date).toLocaleDateString('en-GB') : '-', style: 'padding:7px 8px' },
                                    { html: `<span style="background:${shiftBg};color:${shiftColor};padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:700">${esc(e.shift||'-')}</span>`, style: 'padding:7px 8px' },
                                    { text: e.machine || '-', style: 'padding:7px 8px;font-weight:700' },
                                    { text: e.colour || '-', style: 'padding:7px 8px' },
                                    { text: String(e.good_qty || 0), style: 'padding:7px 8px;text-align:right;font-weight:800;color:#15803d' },
                                    { text: String(e.reject_qty || 0), style: `padding:7px 8px;text-align:right;font-weight:800;color:${rejectColor}` },
                                    { text: e.reject_reason || '', style: 'padding:7px 8px;color:#64748b;font-size:0.76rem' },
                                    { text: e.remarks || '', style: 'padding:7px 8px;color:#64748b;font-size:0.76rem' }
                                ];
                                cellDefs.forEach(c => {
                                    const td = document.createElement('td');
                                    td.style.cssText = c.style || '';
                                    if (c.html) td.innerHTML = c.html; else td.textContent = c.text;
                                    tr.appendChild(td);
                                });
                                const delTd = document.createElement('td');
                                delTd.style.cssText = 'padding:7px 8px';
                                const delBtn = document.createElement('button');
                                delBtn.dataset.entryId = String(e.id);
                                delBtn.className = 'lj-dpr-del-btn';
                                delBtn.style.cssText = 'background:#fee2e2;color:#dc2626;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.72rem';
                                delBtn.innerHTML = '<i class="bi bi-trash"></i>';
                                delTd.appendChild(delBtn);
                                tr.appendChild(delTd);
                                tbody.appendChild(tr);
                            });
                            const table = document.createElement('table');
                            table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.82rem';
                            table.innerHTML = `<thead style="background:#fef3c7"><tr>
                                <th style="padding:8px;text-align:left;border-bottom:2px solid #fde68a">Date</th>
                                <th style="padding:8px;text-align:left;border-bottom:2px solid #fde68a">Shift</th>
                                <th style="padding:8px;text-align:left;border-bottom:2px solid #fde68a">Machine</th>
                                <th style="padding:8px;text-align:left;border-bottom:2px solid #fde68a">Colour</th>
                                <th style="padding:8px;text-align:right;border-bottom:2px solid #fde68a">Produced</th>
                                <th style="padding:8px;text-align:right;border-bottom:2px solid #fde68a">Reject</th>
                                <th style="padding:8px;text-align:left;border-bottom:2px solid #fde68a">Reason</th>
                                <th style="padding:8px;text-align:left;border-bottom:2px solid #fde68a">Remarks</th>
                                <th style="padding:8px;border-bottom:2px solid #fde68a"></th>
                              </tr></thead>`;
                            table.appendChild(tbody);
                            gridEl.innerHTML = '';
                            gridEl.appendChild(table);
                        } catch(err) { gridEl.innerHTML = `<div style="color:#dc2626;padding:20px">Error: ${esc(err.message)}</div>`; }
                    };

                    // Delegated delete handler — avoids inline onclick with API data (CodeQL safe)
                    gridEl.addEventListener('click', (ev) => {
                        const btn = ev.target.closest('.lj-dpr-del-btn');
                        if (btn) window.ljDprDelete(Number(btn.dataset.entryId));
                    });

                    document.getElementById('lj-dpr-load')?.addEventListener('click', loadGrid);

                    const populateMachines = async (pId) => {
                        const machSel = document.getElementById('lj-e-machine');
                        if (!machSel || !pId) return;
                        machSel.innerHTML = '<option value="">— Loading... —</option>';
                        try {
                            const res = await J.api.get(`/labour-parties/${pId}/machines`);
                            machSel.innerHTML = '<option value="">— Select Machine —</option>';
                            (res.data || []).forEach(m => {
                                const opt = document.createElement('option');
                                opt.value = m.machine;
                                opt.textContent = m.machine;
                                machSel.appendChild(opt);
                            });
                        } catch(e) {
                            machSel.innerHTML = '<option value="">— Failed to load —</option>';
                        }
                        // Reset colour dropdown whenever machine list refreshes
                        const colourSel = document.getElementById('lj-e-colour');
                        if (colourSel) colourSel.innerHTML = '<option value="">— Select Machine First —</option>';
                        _colourPlanData = [];
                        _updateBalDisplay();
                    };

                    const populateColours = async (machine) => {
                        const colourSel = document.getElementById('lj-e-colour');
                        if (!colourSel) return;
                        _colourPlanData = [];
                        _updateBalDisplay();
                        if (!machine) {
                            colourSel.innerHTML = '<option value="">— Select Machine First —</option>';
                            return;
                        }
                        colourSel.innerHTML = '<option value="">— Loading colours... —</option>';
                        try {
                            const res = await J.api.get(`/dpr/labour/machine-plan?machine=${encodeURIComponent(machine)}`);
                            const data = res.data || [];
                            _colourPlanData = data;
                            colourSel.innerHTML = '<option value="">— Select Colour —</option>';
                            data.forEach(c => {
                                const opt = document.createElement('option');
                                opt.value = c.colour;
                                opt.textContent = `${c.colour}  (Plan: ${c.plan_qty}  |  Bal: ${c.bal_qty})`;
                                colourSel.appendChild(opt);
                            });
                            if (!data.length) colourSel.innerHTML = '<option value="">— No active plans for this machine —</option>';
                        } catch(e) {
                            colourSel.innerHTML = '<option value="">— Error loading plans —</option>';
                        }
                        _updateBalDisplay();
                    };

                    document.getElementById('lj-e-machine')?.addEventListener('change', (ev) => {
                        populateColours(ev.target.value);
                    });
                    document.getElementById('lj-e-colour')?.addEventListener('change', _updateBalDisplay);
                    document.getElementById('lj-e-good')?.addEventListener('input', _updateBalDisplay);

                    document.getElementById('lj-e-cancel')?.addEventListener('click', () => {
                        if (modal) modal.style.display = 'none';
                    });

                    document.getElementById('lj-dpr-add')?.addEventListener('click', async () => {
                        const pId = partySelect?.value || '';
                        document.getElementById('lj-entry-id').value = '';
                        document.getElementById('lj-e-date').value = fromDate;
                        document.getElementById('lj-e-shift').value = shiftMode !== 'Both' ? shiftMode : 'Day';
                        document.getElementById('lj-e-good').value = '0';
                        document.getElementById('lj-e-reject').value = '0';
                        document.getElementById('lj-e-reason').value = '';
                        document.getElementById('lj-e-remarks').value = '';
                        await populateMachines(pId);
                        if (modal) modal.style.display = 'flex';
                    });

                    document.getElementById('lj-e-save')?.addEventListener('click', async () => {
                        const pId = partySelect?.value || '';
                        if (!pId) { alert('Select a party first'); return; }
                        const machine = document.getElementById('lj-e-machine').value;
                        if (!machine) { alert('Select a machine'); return; }
                        const colour = document.getElementById('lj-e-colour').value;
                        const planEntry = _colourPlanData.find(c => c.colour === colour);
                        const body = {
                            dpr_date: document.getElementById('lj-e-date').value,
                            shift: document.getElementById('lj-e-shift').value,
                            machine,
                            party_id: parseInt(pId, 10),
                            colour: colour || null,
                            plan_id: planEntry ? planEntry.plan_id : null,
                            order_no: planEntry ? planEntry.order_no : null,
                            good_qty: parseFloat(document.getElementById('lj-e-good').value) || 0,
                            reject_qty: parseFloat(document.getElementById('lj-e-reject').value) || 0,
                            reject_reason: document.getElementById('lj-e-reason').value,
                            remarks: document.getElementById('lj-e-remarks').value
                        };
                        try {
                            const entryId = document.getElementById('lj-entry-id').value;
                            let res;
                            if (entryId) {
                                res = await J.api.request(`/dpr/labour/${entryId}`, { method: 'PUT', body: JSON.stringify(body) });
                            } else {
                                res = await J.api.post('/dpr/labour', body);
                            }
                            if (!res.ok) throw new Error(res.error || 'Failed to save');
                            if (modal) modal.style.display = 'none';
                            await loadGrid();
                        } catch(err) { alert('Error: ' + err.message); }
                    });

                    window.ljDprDelete = async (id) => {
                        if (!confirm('Delete this entry?')) return;
                        try {
                            const res = await J.api.request(`/dpr/labour/${id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error(res.error || 'Failed');
                            await loadGrid();
                        } catch(err) { alert('Error: ' + err.message); }
                    };

                    // Auto-load if party already selected
                    if (_labourDprPartyId) await loadGrid();
                };
                // ---- End Labour DPR Summary ----

                const loadSummary = async () => {
                    const fromDate = document.getElementById('s-date').value;
                    const toDate = fromDate; // single date selector
                    const shiftMode = document.getElementById('s-shift').value; // 'Day', 'Night', 'Both'
                    const container = document.getElementById('summary-container');
                    const selectedFactory = document.getElementById('s-factory')?.value || '';

                    // ---- Labour Job DPR: separate path ----
                    if (dprProcess === 'Labour Job') {
                        await loadLabourDprSummary(container, fromDate, toDate, shiftMode);
                        return;
                    }

                    const processQuery = `&process=${encodeURIComponent(dprProcess)}`;
                    const selectedLine = document.getElementById('s-line')?.value || '';
                    const filterMode = document.getElementById('s-eff-filter')?.value || '';

                    localStorage.setItem('jpsms_dpr_process', dprProcess);

                    container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b"><i class="bi bi-arrow-repeat spin" style="font-size:2rem;display:block;margin-bottom:10px"></i> Loading Matrix...</div>`;

                    // P4: Auto-fill elapsed quick-action slots before loading the matrix
                    // Fire-and-forget — don't block the matrix load; errors are non-fatal
                    try { await J.api.post('/dpr/auto-fill-ongoing', {}); } catch(_) {}

                    // Prepare Requests based on Shift Mode
                    const promises = [];
                    const scopedMachinesPromise = J.api.get(`/masters/machines?process=${encodeURIComponent(dprProcess)}`);
                    if (shiftMode === 'Both') {
                        promises.push(J.api.get(`/dpr/summary-matrix?fromDate=${fromDate}&toDate=${toDate}&shift=Day${processQuery}`));
                        promises.push(J.api.get(`/dpr/summary-matrix?fromDate=${fromDate}&toDate=${toDate}&shift=Night${processQuery}`));
                        promises.push(J.api.get(`/shift/team-range?fromDate=${fromDate}&toDate=${toDate}&shift=Day`));
                        promises.push(J.api.get(`/shift/team-range?fromDate=${fromDate}&toDate=${toDate}&shift=Night`));
                    } else if (shiftMode === 'Day') {
                        promises.push(J.api.get(`/dpr/summary-matrix?fromDate=${fromDate}&toDate=${toDate}&shift=Day${processQuery}`));
                        promises.push(Promise.resolve({ ok: true, data: { dates: {} } }));
                        promises.push(J.api.get(`/shift/team-range?fromDate=${fromDate}&toDate=${toDate}&shift=Day`));
                        promises.push(Promise.resolve({ ok: true, data: {} }));
                    } else { // Night
                        promises.push(Promise.resolve({ ok: true, data: { dates: {} } }));
                        promises.push(J.api.get(`/dpr/summary-matrix?fromDate=${fromDate}&toDate=${toDate}&shift=Night${processQuery}`));
                        promises.push(Promise.resolve({ ok: true, data: {} }));
                        promises.push(J.api.get(`/shift/team-range?fromDate=${fromDate}&toDate=${toDate}&shift=Night`));
                    }

                    Promise.all([...promises, scopedMachinesPromise]).then(([resDayMat, resNightMat, resDayTeam, resNightTeam, scopedMachinesRes]) => {
                        // Error Check
                        if (!resDayMat.ok) throw new Error(resDayMat.error || 'Day Fetch Failed');
                        if (!resNightMat.ok) throw new Error(resNightMat.error || 'Night Fetch Failed');

                        let scopedMachinesList = scopedMachinesRes.data || [];
                        if (selectedFactory) {
                            scopedMachinesList = scopedMachinesList.filter(m => String(m.factory_id) === String(selectedFactory));
                        }
                        const allowedMachines = new Set(scopedMachinesList.map(machine => machine.machine));
                        const filterMatrixResponse = (matrixRes) => {
                            const matrixData = matrixRes.data || {};
                            const filteredDates = {};
                            Object.entries(matrixData.dates || {}).forEach(([dateKey, dateValue]) => {
                                const nextEntries = {};
                                Object.entries(dateValue.entries || {}).forEach(([machine, value]) => {
                                    if (allowedMachines.has(machine)) nextEntries[machine] = value;
                                });
                                const nextMaintenance = {};
                                Object.entries(dateValue.maintenance || {}).forEach(([machine, value]) => {
                                    if (allowedMachines.has(machine)) nextMaintenance[machine] = value;
                                });
                                filteredDates[dateKey] = {
                                    ...dateValue,
                                    entries: nextEntries,
                                    maintenance: nextMaintenance,
                                    setups: (dateValue.setups || []).filter(setup => allowedMachines.has(setup.machine))
                                };
                            });

                            return {
                                ...matrixRes,
                                data: {
                                    ...matrixData,
                                    machines: (matrixData.machines || []).filter(machine => allowedMachines.has(machine.machine)),
                                    dates: filteredDates
                                }
                            };
                        };

                        resDayMat = filterMatrixResponse(resDayMat);
                        resNightMat = filterMatrixResponse(resNightMat);

                        const machines = (resDayMat.data.machines && resDayMat.data.machines.length) ? resDayMat.data.machines : (resNightMat.data.machines || []);
                        const dayDatesMap = resDayMat.data.dates || {};
                        const nightDatesMap = resNightMat.data.dates || {};
                        const dayTeamsByDate = resDayTeam.data || {};
                        const nightTeamsByDate = resNightTeam.data || {};
                        
                        const dayClosed = resDayMat.data.closedPlants || [];
                        const nightClosed = resNightMat.data.closedPlants || [];

                        const allDates = Array.from(new Set([...Object.keys(dayDatesMap), ...Object.keys(nightDatesMap)])).sort().reverse();

                        // Populate Lines dropdown from machine data
                        const allLineKeys = new Set();
                        (machines || []).forEach(m => allLineKeys.add(m.line || m.building || m.machine_process || 'General'));
                        const lineDropdown = document.getElementById('s-line');
                        if (lineDropdown) {
                            const prevLineVal = lineDropdown.value;
                            lineDropdown.innerHTML = '<option value="">All Lines</option>';
                            Array.from(allLineKeys).sort().forEach(lk => {
                                const opt = document.createElement('option');
                                opt.value = lk;
                                opt.textContent = lk;
                                if (lk === prevLineVal) opt.selected = true;
                                lineDropdown.appendChild(opt);
                            });
                        }

                        if (allDates.length === 0) {
                            container.innerHTML = '<div style="padding:40px; text-align:center; color:#64748b">No data found for this range.</div>';
                            return;
                        }

                        let masterHtml = '';
                        // Entries counters — computed AFTER allDates loop from raw API data (see below)
                        let grandTotalOpenSlots = 0;
                        let grandTotalFilledSlots = 0;

                        // 1. Render Global Plant Total Section (Visible once at top)
                        masterHtml += `
                            <div id="sticky-plant-total" style="position:sticky; top:105px; z-index:40; background:white; border:1px solid #cbd5e1; border-radius:12px; padding:15px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05)">
                                <div style="font-size:1.1rem; font-weight:700; color:#0f172a">
                                    Plant Total (${new Date(fromDate).toLocaleDateString('en-GB')})
                                    <span style="font-size:0.8rem; font-weight:400; color:#64748b; margin-left:8px">(Combined Summary)</span>
                                </div>
                                <div style="display:flex; gap:24px">
                                    <div style="text-align:right">
                                        <div style="font-size:0.75rem; font-weight:600; color:#7c3aed; text-transform:uppercase">Overall Tonnage</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#7c3aed">
                                            <span id="grand-total-overall">0.00</span> <span style="font-size:0.9rem">Kg</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right">
                                        <div style="font-size:0.75rem; font-weight:600; color:#64748b; text-transform:uppercase">Tonnage</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#2563eb">
                                            <span id="grand-total-tonnage">0.00</span> <span style="font-size:0.9rem">Kg</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right">
                                        <div style="font-size:0.75rem; font-weight:600; color:#64748b; text-transform:uppercase">Rejection</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#dc2626">
                                            <span id="grand-total-rej">0.00</span> <span style="font-size:0.9rem">Kg</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right" title="OEE (Scheduled Time)">
                                        <div style="font-size:0.75rem; font-weight:600; color:#0369a1; text-transform:uppercase">OEE</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#0369a1">
                                            <span id="grand-total-eff">0.0</span> <span style="font-size:0.9rem">%</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right" title="EFF (Net Run Time after Downtime)">
                                        <div style="font-size:0.75rem; font-weight:600; color:#16a34a; text-transform:uppercase">EFF</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#16a34a">
                                            <span id="grand-total-effnet">0.0</span> <span style="font-size:0.9rem">%</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right">
                                        <div style="font-size:0.75rem; font-weight:600; color:#64748b; text-transform:uppercase">Downtime</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#db2777">
                                            <span id="grand-total-dt">0.0</span> <span style="font-size:0.9rem">Hrs</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right">
                                        <div style="font-size:0.75rem; font-weight:600; color:#be185d; text-transform:uppercase" title="Auto Calculated Downtime">Auto DT</div>
                                        <div style="font-size:1.4rem; font-weight:800; color:#be185d">
                                            <span id="grand-total-autodt">0.0</span> <span style="font-size:0.9rem">Hrs</span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:right">
                                        <div style="font-size:0.75rem; font-weight:600; color:#64748b; text-transform:uppercase">Changes</div>
                                        <div style="font-size:1rem; font-weight:700; color:#475569; display:flex; gap:10px; align-items:center;">
                                            <span title="Mould Changes" style="color:#d97706">MC: <span id="grand-total-mc" style="font-weight:800; font-size:1.2rem">0</span></span>
                                            <span style="color:#cbd5e1">|</span>
                                            <span title="Colour Changes" style="color:#c2410c">CC: <span id="grand-total-cc" style="font-weight:800; font-size:1.2rem">0</span></span>
                                            <span style="color:#cbd5e1">|</span>
                                            <span title="Job Changes" style="color:#7c3aed">JC: <span id="grand-total-jc" style="font-weight:800; font-size:1.2rem">0</span></span>
                                        </div>
                                    </div>
                                    <div style="height:40px; border-right:1px solid #e2e8f0"></div>
                                    <div style="text-align:center; min-width:110px" title="Filled Entries / Total Open Slots (non-future)">
                                        <div style="font-size:0.75rem; font-weight:600; color:#0891b2; text-transform:uppercase; letter-spacing:0.5px">Entries</div>
                                        <div style="font-size:1.1rem; font-weight:800; white-space:nowrap; margin:2px 0 3px">
                                            <span id="grand-total-entries-filled" style="font-size:1.4rem; color:#059669; font-weight:900">–</span><span style="color:#cbd5e1; font-size:0.9rem; margin:0 2px">/</span><span id="grand-total-entries-total" style="color:#64748b; font-size:1rem; font-weight:700">–</span>
                                        </div>
                                        <div style="background:#e2e8f0; border-radius:99px; height:5px; width:100%; overflow:hidden; margin-bottom:2px">
                                            <div id="grand-total-entries-bar" style="height:5px; width:0%; background:#059669; border-radius:99px; transition:width 0.5s ease"></div>
                                        </div>
                                        <div id="grand-total-entries-pct" style="font-size:0.72rem; font-weight:700; color:#059669">–%</div>
                                    </div>
                                </div>
                            </div>
                        `;

                        // Reset global tonnages for fresh calc
                        window.lineTheTonnages = {};

                        // Hoist Accumulators to be Line-Level but Cross-Date
                        const lineAccumulators = {};

                        allDates.forEach(date => {
                            const dayData = dayDatesMap[date] || { entries: {}, maintenance: {}, setups: [] };
                            const nightData = nightDatesMap[date] || { entries: {}, maintenance: {}, setups: [] };
                            const dayTeam = dayTeamsByDate[date] || [];
                            const nightTeam = nightTeamsByDate[date] || [];

                            const dateDayClosed = dayClosed.filter(c => (c.dpr_date_str || c.dpr_date || '').startsWith(date));
                            const dateNightClosed = nightClosed.filter(c => (c.dpr_date_str || c.dpr_date || '').startsWith(date));

                            masterHtml += `<div style="background:#0f172a; color:white; padding:12px 20px; font-weight:800; border-radius:12px; margin:40px 0 20px 0; font-size:1.2rem; display:flex; justify-content:space-between; align-items:center; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1)">
                                <span><i class="bi bi-calendar3" style="margin-right:10px"></i>Compliance Summary for ${new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                <span style="font-size:0.9rem; opacity:0.8">${dprEscHtml(dprProcess)} • ${dprEscHtml(shiftMode)} Shift</span>
                            </div>`;

                            const machineMap = new Map();
                            machines.forEach(m => machineMap.set(m.machine, m));

                            const lines = {};
                            Array.from(machineMap.values()).forEach(m => {
                                const lineKey = (m.line || m.building || m.machine_process || 'General');
                                if (!lines[lineKey]) lines[lineKey] = [];
                                lines[lineKey].push(m.machine);
                            });

                        // SORT MACHINES (Natural Order by Suffix: M-1, M-2, M-10)
                        const extractIndex = (str) => {
                            const match = str.match(/-(\d+)$/);
                            return match ? parseInt(match[1]) : 999999;
                        };

                        Object.keys(lines).forEach(k => {
                            lines[k].sort((a, b) => {
                                const idxA = extractIndex(a);
                                const idxB = extractIndex(b);
                                if (idxA !== idxB && idxA !== 999999 && idxB !== 999999) return idxA - idxB;
                                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                            });
                        });

                        // Apply line filter — only keep the selected line
                        if (selectedLine) {
                            Object.keys(lines).forEach(k => {
                                if (k !== selectedLine) delete lines[k];
                            });
                        }

                        // Standard Slots (12 cols)
                        // Standard Slots (12 cols) - Shift starts 07:00
                        const slots = ['07-08', '08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07'];

                        // Map shift teams by line key for easy lookup
                        const teamMap = {};
                        const teamDayMap = {}; dayTeam.forEach(t => teamDayMap[t.line] = t);
                        const teamNightMap = {}; nightTeam.forEach(t => teamNightMap[t.line] = t);

                        if (shiftMode === 'Night') {
                            Object.assign(teamMap, teamNightMap);
                        } else if (shiftMode === 'Day') {
                            Object.assign(teamMap, teamDayMap);
                        } else {
                            // Merge Day & Night for "Both"
                            const allKeys = new Set([...Object.keys(teamDayMap), ...Object.keys(teamNightMap)]);
                            allKeys.forEach(k => {
                                const d = teamDayMap[k];
                                const n = teamNightMap[k];
                                if (d && !n) { teamMap[k] = d; }
                                else if (!d && n) { teamMap[k] = n; }
                                else if (d && n) {
                                    teamMap[k] = { ...d };
                                    const merge = (f) => { if (n[f] && d[f] !== n[f]) teamMap[k][f] = `${d[f]} (D) / ${n[f]} (N)`; };
                                    merge('entry_person');
                                    merge('prod_supervisor');
                                    merge('qc_supervisor');
                                    merge('engineer');
                                }
                            });
                        }

                        // Helper to determine Slot End Time
                        const getSlotEnd = (slotKey, dateStr, rowShift) => {
                            let rawSlot = slotKey;
                            let h = 0;
                            // Standard End-Hour Mapping (Day basis)
                            switch (rawSlot) {
                                case '07-08': h = 8; break;
                                case '08-09': h = 9; break;
                                case '09-10': h = 10; break;
                                case '10-11': h = 11; break;
                                case '11-12': h = 12; break;
                                case '12-01': h = 13; break;
                                case '01-02': h = 14; break;
                                case '02-03': h = 15; break;
                                case '03-04': h = 16; break;
                                case '04-05': h = 17; break;
                                case '05-06': h = 18; break;
                                case '06-07': h = 19; break;
                            }

                            let baseDate = new Date(dateStr);
                            baseDate.setHours(0, 0, 0, 0);

                            if (rowShift === 'Day') {
                                baseDate.setHours(h, 0, 0, 0);
                            } else {
                                // Night Logic (Starts 7pm/19:00)
                                let realH = 0;
                                let addDay = 0;

                                if (rawSlot === '07-08') { realH = 20; }  // 7 PM - 8 PM same day (first slot of Night)
                                else if (rawSlot === '08-09') { realH = 21; }
                                else if (rawSlot === '09-10') { realH = 22; }
                                else if (rawSlot === '10-11') { realH = 23; }
                                else if (rawSlot === '11-12') { realH = 0; addDay = 1; }
                                else if (rawSlot === '12-01') { realH = 1; addDay = 1; }
                                else if (rawSlot === '01-02') { realH = 2; addDay = 1; }
                                else if (rawSlot === '02-03') { realH = 3; addDay = 1; }
                                else if (rawSlot === '03-04') { realH = 4; addDay = 1; }
                                else if (rawSlot === '04-05') { realH = 5; addDay = 1; }
                                else if (rawSlot === '05-06') { realH = 6; addDay = 1; }
                                else if (rawSlot === '06-07') { realH = 7; addDay = 1; }

                                baseDate.setDate(baseDate.getDate() + addDay);
                                baseDate.setHours(realH, 0, 0, 0);
                            }
                            return baseDate.getTime();
                        };

                            // --- GLOBAL STICKY HEADER PER DATE ---
                            masterHtml += `
                                <div class="date-section-header" style="position:sticky; z-index:45; top:130px; margin-bottom:0; box-shadow:0 1px 2px rgba(0,0,0,0.05); background:#f8fafc; border-bottom:1px solid #e2e8f0; border:1px solid #cbd5e1; border-radius:8px 8px 0 0; overflow:hidden">
                                    <table style="width:100%; border-collapse:separate; border-spacing:0; font-size:0.8rem; text-align:center; table-layout:fixed">
                                        <colgroup>
                                            <col style="width:220px; min-width:220px">
                                            <col style="width:45px; min-width:45px">
                                            ${slots.map(() => '<col style="width:65px; min-width:65px">').join('')}
                                            <col style="width:140px; min-width:140px">
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th style="padding:12px; text-align:left; min-width:220px; border-bottom:1px solid #e2e8f0; background:#f8fafc; font-weight:600; color:#475569; border-right:1px solid #e2e8f0">Machine / Mould</th>
                                                <th style="padding:10px 4px; border-bottom:1px solid #e2e8f0; background:#f8fafc; min-width:70px; font-weight:600; color:#475569; border-right:1px solid #e2e8f0;text-align:center"><div style="line-height:1.3"><div>STD</div><div style="font-size:0.6rem;color:#cbd5e1">───</div><div style="color:#16a34a">ACT</div></div></th>
                                                ${slots.map(s => `<th style="padding:10px; border-bottom:1px solid #e2e8f0; background:#f8fafc; min-width:65px; font-weight:600; color:#475569; font-size:0.75rem; text-align:center; border-right:1px solid #e2e8f0">${s}</th>`).join('')}
                                                <th style="padding:10px; border-bottom:1px solid #e2e8f0; background:#f0f9ff; min-width:140px; font-weight:700; color:#0369a1; border-left:2px solid #e2e8f0">Summary</th>
                                            </tr>
                                        </thead>
                                    </table>
                                </div>
                            `;

                        const flatMode = !!filterMode;
                        const lineBuffer = [];
                        const globalMachineBuffer = [];

                        Object.keys(lines).forEach(lineName => {
                            let lineInnerHtml = '';
                            if (!lineAccumulators[lineName]) {
                                lineAccumulators[lineName] = { 
                                    tonnage: 0, rejTonnage: 0, goodPcs: 0, estPcs: 0, 
                                    dt: 0, autoDt: 0, cc: 0, mc: 0, jc: 0 
                                };
                            }
                            const acc = lineAccumulators[lineName];
                            
                            let lineTotalTonnage = 0, lineTotalRejTonnage = 0, lineTotalGoodPcs = 0, lineTotalEstPcs = 0, lineTotalEstPcsNet = 0;
                            let lineTotalDt = 0, lineTotalAutoDt = 0, lineTotalCC = 0, lineTotalMC = 0, lineTotalJC = 0;

                            // Shift Team Display
                            let team = teamMap[lineName];
                            if (!team) {
                                // Fallback: Try matching prefix (e.g. "B -L1" -> "B")
                                const prefix = lineName.split(' -')[0].trim();
                                team = teamMap[prefix] || {};
                            }

                            // Auto-Calc Manager
                            let mgr = '-';
                            if (lineName.startsWith('B') || lineName.startsWith('F')) mgr = 'Rajesh Shrivastav';
                            else if (lineName.startsWith('C') || lineName.startsWith('E')) mgr = 'Ratnakar Behra';

                            const teamInfo = team.entry_person ?
                                `Entry Person: <b>${team.entry_person}</b>&nbsp;|&nbsp;` +
                                `Prodn Supervisor: <b>${team.prod_supervisor || '-'}</b>&nbsp;|&nbsp;` +
                                `QC Supervisor: <b>${team.qc_supervisor || '-'}</b>&nbsp;|&nbsp;` +
                                `Engineer: <b>${team.engineer || '-'}</b>&nbsp;|&nbsp;` +
                                `Prodn Manager: <b>${mgr}</b>`
                                : '<span style="color:#ef4444; font-style:italic">Shift Personnel Not Entered</span>';

                            lineInnerHtml += `
                                <div style="margin-bottom:24px; background:white; border:1px solid #cbd5e1; border-radius:0 0 12px 12px; overflow:hidden; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05); margin-top:-1px">
                                    <div style="padding:8px 20px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; border-top:1px solid #e2e8f0">
                                        <div style="display:flex; justify-content:space-between; align-items:center">
                                            <span style="font-weight:700; color:#0f172a; font-size:1rem">${lineName}</span>
                                            <div style="display:flex; gap:12px; align-items:center">
                                                <div style="font-weight:700; color:#7c3aed; font-size:0.9rem">
                                                    Overall: <span id="line-total-overall-${lineName.replace(/\s/g, '')}">0.00</span> Kg
                                                </div>
                                                <div style="font-weight:700; color:#0f172a; font-size:0.9rem; border-left:1px solid #cbd5e1; padding-left:12px">
                                                    Total: <span id="line-total-tonnage-${lineName.replace(/\s/g, '')}">0.00</span> Kg
                                                </div>
                                                <div style="font-weight:700; color:#dc2626; font-size:0.9rem; border-left:1px solid #cbd5e1; padding-left:12px">
                                                    Rej: <span id="line-total-rej-${lineName.replace(/\s/g, '')}">0.00</span> Kg
                                                </div>
                                                <div style="font-weight:700; color:#0369a1; font-size:0.9rem; border-left:1px solid #cbd5e1; padding-left:12px" title="OEE (Scheduled Time)">
                                                    OEE: <span id="line-total-eff-${lineName.replace(/\s/g, '')}">0.0</span>%
                                                </div>
                                                <div style="font-weight:700; color:#16a34a; font-size:0.9rem; border-left:1px solid #cbd5e1; padding-left:12px" title="EFF (Net Run Time after Downtime)">
                                                    EFF: <span id="line-total-effnet-${lineName.replace(/\s/g, '')}">0.0</span>%
                                                </div>
                                                <div style="font-weight:700; color:#db2777; font-size:0.9rem; border-left:1px solid #cbd5e1; padding-left:12px">
                                                    DT: <span id="line-total-dt-${lineName.replace(/\s/g, '')}">0.0</span> Hrs
                                                </div>
                                                <div style="font-weight:700; color:#be185d; font-size:0.9rem; border-left:1px solid #cbd5e1; padding-left:12px" title="Auto Calculated Downtime">
                                                    Auto: <span id="line-total-autodt-${lineName.replace(/\s/g, '')}">0</span> m
                                                </div>
                                                <div style="font-weight:600; color:#64748b; font-size:0.8rem; border-left:1px solid #cbd5e1; padding-left:12px; display:flex; gap:6px">
                                                    <span title="Mould Change" style="color:#d97706">MC: <span id="line-total-mc-${lineName.replace(/\s/g, '')}">0</span></span>
                                                    <span title="Colour Change" style="color:#c2410c">CC: <span id="line-total-cc-${lineName.replace(/\s/g, '')}">0</span></span>
                                                    <span title="Job Change" style="color:#7c3aed">JC: <span id="line-total-jc-${lineName.replace(/\s/g, '')}">0</span></span>
                                                </div>
                                            </div>
                                        </div>
                                        <div style="margin-top:2px; font-size:0.75rem; color:#475569;">
                                            ${teamInfo}
                                        </div>
                                    </div>
                                    <div style="overflow-x:auto">
                                        <table style="width:100%; border-collapse:separate; border-spacing:0; font-size:0.8rem; text-align:center; table-layout:fixed">
                                            <colgroup>
                                                <col style="width:220px; min-width:220px">
                                                    <col style="width:45px; min-width:45px">
                                                        ${slots.map(() => '<col style="width:65px; min-width:65px">').join('')}
                                                        <col style="width:140px; min-width:140px">
                                                        </colgroup>
                                                        <tbody>
                                                            `;

                            const machineBuffer = [];
                            lines[lineName].forEach(machine => {
                                let machineRowHtml = ''; // Shadow inner HTML for buffering
                                let machineGood = 0, machineEst = 0;
                                const machineEntryTypes = new Set(); // track special entry_types for View Filter
                                let machineMissingSlots = 0; // count of past unfilled slots (for Pending filter)
                                // Determine Shifts for this Machine Row(s)
                                const shiftsToRender = (shiftMode === 'Both') ? ['Day', 'Night'] : [shiftMode];

                                shiftsToRender.forEach(rowShift => {
                                    // Select Data Source
                                    const source = (rowShift === 'Day') ? dayData : nightData;
                                    const rowEntries = source.entries || {};
                                    const rowSetups = source.setups || [];
                                    const rowMaint = source.maintenance || {};
                                    const rowClosed = (rowShift === 'Day') ? dateDayClosed : dateNightClosed;

                                    const mData = {};
                                    const rawMachineData = rowEntries[machine] || {};
                                    Object.keys(rawMachineData).forEach(rawSlot => {
                                        let cleanSlot = rawSlot;
                                        if (cleanSlot.includes('|')) cleanSlot = cleanSlot.split('|').pop();
                                        if (!mData[cleanSlot]) mData[cleanSlot] = [];
                                        mData[cleanSlot] = mData[cleanSlot].concat(rawMachineData[rawSlot]);
                                    });

                                    // --- 1. Identify Distinct Moulds FIRST (v57 Deduplication) ---
                                    const distinctMoulds = [];
                                    const mouldsWithStrongRows = new Set(); // Tracks Mould Codes that have a "Strong" (Order-based) row
                                    const nameToCode = {};
                                    const orderToCode = {};
                                    const sanitize = (str) => (str || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');

                                    // Pre-scan Setups to build Name->Code map
                                    const machineSetups = rowSetups.filter(s => s.machine === machine);
                                    machineSetups.forEach(s => {
                                        if (s.mould_name && s.mould_no) {
                                            nameToCode[sanitize(s.mould_name)] = s.mould_no.trim();
                                        } if (s.order_no && s.mould_no) orderToCode[sanitize(s.order_no)] = s.mould_no.trim();
                                    });
                                    // Scan Entries
                                    slots.forEach(s => {
                                        const list = (mData[s]) ? (Array.isArray(mData[s]) ? mData[s] : [mData[s]]) : [];
                                        list.forEach(e => {
                                            if (e.mould_name && e.mould_no) nameToCode[sanitize(e.mould_name)] = e.mould_no.trim();
                                            if (e.order_no && e.mould_no) orderToCode[sanitize(e.order_no)] = e.mould_no.trim();
                                        });
                                    });

                                    const addMould = (mName, mNo, std, startTime, orderNo, endTime, fullDetails) => {
                                        let code = (mNo || '').trim();
                                        let name = (mName || '').trim();
                                        let order = (orderNo || '').trim();

                                        if (!code && name && nameToCode[sanitize(name)]) code = nameToCode[sanitize(name)];
                                        if (!code && order && orderToCode[sanitize(order)]) code = orderToCode[sanitize(order)];
                                        if (code && name) nameToCode[sanitize(name)] = code;

                                        // Strict Deduplication Keys
                                        // Strong Key: Order No
                                        // Weak Key: Mould Code
                                        const strongKey = order ? order.toLowerCase() : null;
                                        const weakKey = code ? code.toLowerCase() : (name ? name.toLowerCase() : null);

                                        if (!strongKey && !weakKey) return;

                                        // Deduplication Logic
                                        if (strongKey) {
                                            // STRONG ROW (Has Order)
                                            // 1. Check if we already have this Order
                                            const existingStrong = distinctMoulds.find(m => (m.order_no || '').toLowerCase() === strongKey);
                                            if (existingStrong) return; // Already have this Order Row

                                            // 2. RETROACTIVE CLEANUP: Did we add a "Weak" row for this same Mould earlier?
                                            // If so, REMOVE IT. The Strong Row supercedes it.
                                            if (weakKey) {
                                                const weakIdx = distinctMoulds.findIndex(m => !m.order_no && ((m.code || '').toLowerCase() === weakKey || (m.name || '').toLowerCase() === weakKey));
                                                if (weakIdx !== -1) {
                                                    distinctMoulds.splice(weakIdx, 1); // Delete the Orphan
                                                }
                                                mouldsWithStrongRows.add(weakKey); // Mark as Strong
                                            }

                                            // Proceed to add Strong Row
                                        } else {
                                            // WEAK ROW (No Order, just Mould)
                                            // 1. Check if this Mould already has a Strong Row?
                                            if (weakKey && mouldsWithStrongRows.has(weakKey)) return; // Skip Orphan, we have a Parent

                                            // 2. Check if we already have a Weak Row for this Mould?
                                            const existingWeak = distinctMoulds.find(m => !m.order_no && ((m.code || '').toLowerCase() === weakKey || (m.name || '').toLowerCase() === weakKey));
                                            if (existingWeak) return; // Already have this Mould Row
                                        }

                                        // STD & Weight Fallback Logic
                                        const d = fullDetails || {};
                                        let finalStd = parseFloat(std || 0);

                                        if (!finalStd && d.pcshr_act) finalStd = parseFloat(d.pcshr_act);

                                        if (!finalStd) {
                                            const ct = parseFloat(d.cycle_act || d.std_cycle_time || 0);
                                            const cav = parseFloat(d.cavity_act || d.std_cavity || 1);
                                            if (ct > 0) {
                                                finalStd = Math.round((3600 / ct) * cav);
                                            }
                                        }

                                        // STD pcs/hr from Mould Master (std cavity)
                                        // ACT pcs/hr from supervisor's one-time setup (cavity_act in std_actual)
                                        let stdCavPcsHr = 0; // STD — based on mould master std cavity
                                        let actCavPcsHr = 0; // ACT — based on supervisor's actual cavity
                                        const _ct = parseFloat(d.std_cycle_time || 0);
                                        const _stdCav = parseFloat(d.std_cavity || 0);
                                        const _actCav = parseFloat(d.act_cavity || 0);
                                        if (_ct > 0) {
                                            if (_stdCav > 0) stdCavPcsHr = Math.round((3600 / _ct) * _stdCav);
                                            if (_actCav > 0) actCavPcsHr = Math.round((3600 / _ct) * _actCav);
                                        }

                                        if (!d.article_act) {
                                            d.article_act = d.act_weight || d.std_weight || 0;
                                        }

                                        // Track First Activity Time for Sorting
                                        let activityTs = startTime ? new Date(startTime).getTime() : 9999999999999;
                                        // If no setup time, check if we passed a log entry with created_at
                                        if (d.created_at && (!startTime || activityTs > new Date(d.created_at).getTime())) {
                                            activityTs = new Date(d.created_at).getTime();
                                        }

                                        distinctMoulds.push({
                                            name: name || code, code, std: finalStd,
                                            stdCavPcsHr, actCavPcsHr,
                                            start_time: startTime, order_no: order, end_time: endTime,
                                            first_activity_ts: activityTs,
                                            first_slot: 99, // Default to far future
                                            details: d
                                        });
                                    };

                                    // Sources: Setups & Logs
                                    machineSetups.forEach(s => addMould(s.mould_name, s.mould_no, s.std_pcs_hr, s.created_at, s.order_no, s.end_time, s));
                                    slots.forEach((s, sIdx) => {
                                        const list = mData[s] || [];
                                        list.forEach(e => {
                                            if (e && (e.mould_name || e.mould_no || e.order_no)) {
                                                addMould(e.mould_name, e.mould_no, e.std_pcs_hr, null, e.order_no, null, e);
                                                // Find back the mould and update first_slot
                                                const m = distinctMoulds.find(mx => (mx.order_no && mx.order_no === e.order_no) || (!mx.order_no && (mx.code === e.mould_no || mx.name === e.mould_name)));
                                                if (m && m.first_slot > sIdx) m.first_slot = sIdx;
                                            }
                                        });
                                    });

                                    // Sort Moulds Chronologically (By first slot appearance, then by timestamp)
                                    distinctMoulds.sort((a, b) => {
                                        if (a.first_slot !== b.first_slot) return a.first_slot - b.first_slot;
                                        return a.first_activity_ts - b.first_activity_ts;
                                    });

                                    if (distinctMoulds.length === 0) {
                                        distinctMoulds.push({ name: '', code: '', std: '', start_time: null, is_dummy: true });
                                    }

                                    // Count JC
                                    const realMoulds = distinctMoulds.filter(m => !m.is_dummy);
                                    if (realMoulds.length > 1) {
                                        lineTotalJC += (realMoulds.length - 1);
                                    }

                                    const firstMould = distinctMoulds[0] || {};

                                    // [NEW] Plant/Line Closure Check for UI
                                    const mObj = machines.find(ma => ma.machine === machine) || {};
                                    const building = mObj.building || mObj.machine_process || '';
                                    const machineLine = mObj.line || mObj.building || mObj.machine_process || '';
                                    const closure = rowClosed.find(c => c.plant === building || c.plant === machineLine || c.plant === 'All');

                                    // [NEW] Machine-wise JC Highlight Detection (Trigger on 1 or more Job Changes)
                                    const machineJC = realMoulds.length - 1;
                                    const isHighJC = (machineJC >= 1);

                                    distinctMoulds.forEach((m, mIdx) => {
                                        const isFirstMouldInMachine = (mIdx === 0);
                                        const mouldStartTs = m.start_time ? new Date(m.start_time).getTime() : 0;
                                        const rowWeight = parseFloat(m.details?.article_act || m.details?.std_weight || 0);

                                        // Start Row

                                        let machineHtml = '';
                                        if (isFirstMouldInMachine) {
                                            let label = stripMachPfx(machine);
                                            if (shiftMode === 'Both') {
                                                const badgeColor = (rowShift === 'Day') ? '#f59e0b' : '#6366f1';
                                                label += ` <span style="color:${badgeColor}; font-size:0.7rem; background:${badgeColor}15; padding:1px 4px; border-radius:4px; margin-left:4px">${rowShift}</span>`;
                                            }
                                            
                                            // [NEW] JC Colors (Indigo for 1, Red for 2+)
                                            const jcColor = (machineJC >= 2) ? '#ef4444' : '#4f46e5';
                                            const jcBadgeBg = (machineJC >= 2) ? '#fee2e2' : '#e0e7ff';
                                            const jcBadgeBorder = (machineJC >= 2) ? '#fecaca' : '#c7d2fe';

                                            if (isHighJC) {
                                                label += ` <span style="color:${jcColor}; font-size:0.75rem; background:${jcBadgeBg}; border:1px solid ${jcBadgeBorder}; padding:1px 6px; border-radius:12px; font-weight:800; margin-left:6px; white-space:nowrap"><i class="bi bi-arrow-repeat"></i> ${machineJC} JCs</span>`;
                                            }

                                            machineHtml = `<div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; font-weight:700; margin-bottom:6px; color:#64748b; display:flex; align-items:center; flex-wrap:wrap">${label}</div>`;
                                        }

                                        // Mould Name Display (Condensed)
                                        // Render Row Header with Extended Details
                                        const d = m.details || {};

                                         // Build JC/Client/Order HTML
                                         const dateStr = allDates.length > 1 ? `<span style="color:#64748b; font-weight:600; font-size:0.7rem">${new Date(date).toLocaleDateString('en-GB', {day:'2-digit', month:'short'})}</span> | ` : '';
                                         const ordHtml = (m.order_no && !m.is_dummy) ? `<div style="font-size:0.75rem; color:#0ea5e9; font-weight:700;">${dateStr}${m.order_no}${d.job_card_no ? ` | <span style="color:#64748b">${d.job_card_no}</span>` : ''}</div>` : '';
                                         const cliHtml = d.client_name ? `<div style="font-size:0.7rem; color:#475569; font-weight:600; margin-bottom:2px">${d.client_name}</div>` : '';

                                        const nameHtml = !m.is_dummy ? `<div style="font-size:0.85rem; font-weight:700; color:#1e293b; line-height:1.3; margin-top:2px">${m.name}</div>` : `<div style="font-size:0.8rem; color:#94a3b8">-</div>`;

                                        let mouldDisplay = `
                                             <div style="cursor:pointer" onclick='showJobDetails(${JSON.stringify(d).replace(/'/g, "&apos;")}, "${m.order_no || ''}")'>
                                                 <div style="display:flex; flex-direction:column; gap:0px">
                                                     ${ordHtml}
                                                     ${cliHtml}
                                                 </div>
                                                 ${nameHtml}
                                             </div>
                                        `;

                                        let stdDisplay = '';
                                        if (m.is_dummy) {
                                            stdDisplay = '<div style="font-size:0.9rem; color:#94a3b8; text-align:center">-</div>';
                                        } else {
                                            const _stdVal = m.stdCavPcsHr || m.std || '-';
                                            const _actVal = m.actCavPcsHr || m.std || '-';
                                            // Compare resolved display values so color always matches what's shown
                                            const _actDiff = (Number(_actVal) > 0 && Number(_stdVal) > 0 && Number(_actVal) < Number(_stdVal));
                                            const _actColor = _actDiff ? '#dc2626' : '#16a34a';
                                            const _cavInfo = (m.details.std_cavity && m.details.act_cavity)
                                                ? `<div style="font-size:0.58rem;color:#94a3b8;line-height:1">${m.details.std_cavity}c / ${m.details.act_cavity}c</div>`
                                                : '';
                                            stdDisplay = `<div style="text-align:center;line-height:1.25">
                                                <div style="font-size:0.95rem;font-weight:800;color:#0f172a">${_stdVal}</div>
                                                <div style="font-size:0.6rem;color:#cbd5e1;letter-spacing:1px">───</div>
                                                <div style="font-size:0.85rem;font-weight:700;color:${_actColor}">${_actVal}</div>
                                                ${_cavInfo}
                                            </div>`;
                                        }

                                        const jcColor = (machineJC >= 2) ? '#ef4444' : '#6366f1';
                                        const cellBg = isHighJC ? ((machineJC >= 2) ? '#fef2f2' : '#f5f7ff') : 'white';
                                        const borderLeft = isHighJC && isFirstMouldInMachine ? `border-left:8px solid ${jcColor};` : '';

                                        machineRowHtml += `<tr style="${isFirstMouldInMachine ? 'border-top:2px solid #cbd5e1' : ''}">
                                                                <td style="padding:6px 8px; text-align:left; border-right:1px solid #f1f5f9; border-bottom:1px solid #e2e8f0; background:${cellBg}; ${borderLeft} position:sticky; left:0; z-index:5; vertical-align:top; min-width:220px">${machineHtml}${mouldDisplay}<!--ROWCLEAR--></td>
                                                                <td style="padding:6px 4px; text-align:center; border-right:2px solid #e2e8f0; border-bottom:1px solid #e2e8f0; background:#fff; position:sticky; left:220px; z-index:5; vertical-align:middle; min-width:70px">${stdDisplay}</td>`;
                                        // C. Slots Iteration
                                        let activeOverrideStatus = '';
                                        let skipRemainingSlots = false;
                                        let rowQuickIds = []; // quick-action entry ids in this machine row (for superadmin row-clear)

                                        // Identify Active Mould Index for each slot to handle Transitions & Blocking Perfectly
                                        const activeMouldBySlot = Array(slots.length).fill(0);
                                        let currentActiveIdx = 0;
                                        slots.forEach((s, sIdx) => {
                                            const list = mData[s] || [];
                                            const foundMouldIdx = distinctMoulds.findIndex(m => {
                                                if (m.is_dummy) return false;
                                                const mCode = (m.code || '').trim(), mName = (m.name || '').trim(), mOrder = (m.order_no || '').trim().toLowerCase();
                                                return list.some(e => {
                                                    let eNo = (e.mould_no || '').trim(), eName = (e.mould_name || '').trim(), eOrder = (e.order_no || '').trim().toLowerCase();
                                                    if (mOrder && eOrder) return (mOrder === eOrder);
                                                    if (mCode && eNo && mCode === eNo) return true;
                                                    if (mName && eName && mName === eName) return true;
                                                    return false;
                                                });
                                            });
                                            if (foundMouldIdx !== -1) currentActiveIdx = foundMouldIdx;
                                            activeMouldBySlot[sIdx] = currentActiveIdx;
                                        });

                                        slots.forEach((s, idx) => {
                                            if (skipRemainingSlots) return;
                                            
                                            const sEnd = getSlotEnd(s, date, rowShift);
                                            const now = new Date().getTime();
                                            const currentSlotStart = sEnd - 3600000;
                                            const isFuture = (now < currentSlotStart);

                                            let bg = '#ffffff';
                                            let border = '1px solid #f1f5f9';
                                            let content = '';

                                            let slotEntries = mData[s] || [];
                                            if (isFuture) slotEntries = []; // STRICT GATE: No entries for future slots

                                            const list = Array.isArray(slotEntries) ? slotEntries : (slotEntries ? [slotEntries] : []);

                                            // Find Entries (plural)
                                            let entries = list.filter(e => {
                                                let eNo = (e.mould_no || '').trim(), eName = (e.mould_name || '').trim(), eOrder = (e.order_no || '').trim().toLowerCase();
                                                if (!eNo && eName && nameToCode[eName]) eNo = nameToCode[eName];

                                                const mCode = (m.code || '').trim(), mName = (m.name || '').trim(), mOrder = (m.order_no || '').trim().toLowerCase();

                                                // STRICT CHECK: If Row has Order, Entry MUST match Order
                                                // STRICT CHECK: If Row has Order, Entry MUST match Order
                                                if (mOrder && eOrder) {
                                                    return (mOrder === eOrder);
                                                }
                                                // If Row has Order but Entry has NONE, allow Code/Name match
                                                // If Row has NO Order, allow Code/Name match
                                                if (mCode && eNo && mCode === eNo) return true;
                                                if (mName && eName && mName === eName) return true;

                                                return false;
                                            });

                                            // Fallback for First Line matching loose entries
                                            if (entries.length === 0 && isFirstMouldInMachine) {
                                                entries = list.filter(e => !e.mould_no && !e.mould_name && !e.order_no);
                                            }

                                            // 1. Detect OVERRIDES in this slot
                                            let overrideTriggeredThisSlot = false;
                                            let overrideEntryId = null; // id of the quick-action entry in this slot (for superadmin delete)
                                            let overrideEntryDt = 0;    // downtime minutes of the covering quick-action entry
                                            let overrideEntryGood = 0;  // good qty of the covering quick-action entry

                                             // Check purely special Entry Types (Quick Actions)
                                             const spEntry = list.find(e => ['Maintenance', 'MouldChange', 'MouldChangeover', 'ManPowerShortage', 'MouldMaintenance', 'NoPlan', 'MouldTrial', 'PowerCut'].includes(e.entry_type));

                                             if (spEntry) {
                                                 machineEntryTypes.add(spEntry.entry_type); // collect for View Filter
                                                 overrideEntryDt = Number(spEntry.downtime_min) || 0;
                                                 overrideEntryGood = Number(spEntry.good_qty) || 0;
                                                 if (spEntry.entry_type === 'Maintenance') activeOverrideStatus = '🏭 Machine Maintenance';
                                                 else if (spEntry.entry_type.includes('MouldChange')) activeOverrideStatus = 'Mould Changeover';
                                                 else if (spEntry.entry_type === 'ManPowerShortage') activeOverrideStatus = 'Man Power Shortage';
                                                 else if (spEntry.entry_type === 'MouldMaintenance') activeOverrideStatus = 'MOULD MAINT';
                                                 else if (spEntry.entry_type === 'NoPlan') activeOverrideStatus = 'NO PLAN';
                                                 else if (spEntry.entry_type === 'MouldTrial') activeOverrideStatus = 'MOULD TRIAL';
                                                 else if (spEntry.entry_type === 'PowerCut') activeOverrideStatus = '⚡ POWER CUT';
                                                 overrideEntryId = spEntry.id || null;
                                                 overrideTriggeredThisSlot = true;
                                             } else {
                                                // Check manually entered Main types where downtime is >= 45m and 0 production
                                                const dEntry = entries.find(e => e.entry_type === 'Main' && Number(e.downtime_min) >= 45 && Number(e.good_qty || 0) === 0);
                                                if (dEntry) {
                                                    const brk = typeof dEntry.downtime_breakup === 'string' ? {} : (dEntry.downtime_breakup || {});
                                                    overrideEntryDt = Number(dEntry.downtime_min) || 0;
                                                    overrideEntryGood = Number(dEntry.good_qty) || 0;
                                                     if (brk['1']) { activeOverrideStatus = 'Man Power Shortage'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                     else if (brk['2']) { activeOverrideStatus = 'Mould Changeover'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                     else if (brk['5']) { activeOverrideStatus = '🏭 Machine Maintenance'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                     else if (brk['7']) { activeOverrideStatus = 'MOULD MAINT'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                     else if (brk['8']) { activeOverrideStatus = '⚡ POWER CUT'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                     else if (brk['11']) { activeOverrideStatus = 'MOULD TRIAL'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                     else if (brk['13']) { activeOverrideStatus = 'NO PLAN'; overrideTriggeredThisSlot = true; overrideEntryId = dEntry.id || null; }
                                                 }
                                             }

                                            // 2. Detect REAL PRODUCTION to reset override (MACHINE WIDE)
                                            // Strong Reset: Reset if there's any good qty, shots, or Main entry with < 45m downtime on ANY order for this machine
                                            let hasMachineProduction = list.some(e => Number(e.good_qty || 0) > 0 || Number(e.shots || 0) > 0 || (e.entry_type === 'Main' && Number(e.downtime_min || 0) < 45) || e.entry_type === 'ColourChange');
                                            // Also reset if a DIFFERENT job has any entry (manual or production) on this machine in this slot.
                                            // This stops Mould Changeover from Job 1 carrying forward into slots where Job 2 has taken over the machine.
                                            const mOrder = (m.order_no || '').trim().toLowerCase();
                                            const hasDifferentJobEntry = mOrder && list.some(e => {
                                                const eOrder = (e.order_no || '').trim().toLowerCase();
                                                return eOrder && eOrder !== mOrder;
                                            });
                                            if ((hasMachineProduction || hasDifferentJobEntry) && !overrideTriggeredThisSlot) {
                                                activeOverrideStatus = ''; // Reset for the whole machine!
                                            }

                                            // Determine time boundaries to see if slot is eligible for auto-fill
                                            // sEnd, now, isFuture are already declared at top of loop
                                            const sStart = sEnd - 3600000; 

                                            // 3. RENDER THE SLOT
                                            if (mIdx === 0 && activeOverrideStatus && (!hasMachineProduction) && (!isFuture || overrideTriggeredThisSlot)) {
                                                // If an override is active, NO real production on machine blocking it, and it's NOT a future slot, draw Box

                                                 if (activeOverrideStatus === 'NO PLAN') { bg = '#fff1f2'; border = '1px solid #fda4af'; content = `<div style="color:#e11d48; font-weight:800; font-size:0.85rem; line-height:1.1; display:flex; align-items:center; justify-content:center; height:100%; text-align:center">${activeOverrideStatus}</div>`; }
                                                 else if (activeOverrideStatus === 'MOULD MAINT') { bg = '#fefce8'; border = '1px solid #fde047'; content = `<div style="color:#a16207; font-weight:800; font-size:0.85rem; line-height:1.1; display:flex; align-items:center; justify-content:center; height:100%; text-align:center">${activeOverrideStatus}</div>`; }
                                                 else if (activeOverrideStatus === 'MOULD TRIAL') { bg = '#f5f3ff'; border = '1px solid #ddd6fe'; content = `<div style="color:#7c3aed; font-weight:800; font-size:0.85rem; line-height:1.1; display:flex; align-items:center; justify-content:center; height:100%; text-align:center">${activeOverrideStatus}</div>`; }
                                                 else if (activeOverrideStatus === '⚡ POWER CUT') { bg = '#eff6ff'; border = '1px solid #bfdbfe'; content = `<div style="color:#1e40af; font-weight:800; font-size:0.85rem; line-height:1.1; display:flex; align-items:center; justify-content:center; height:100%; text-align:center">${activeOverrideStatus}</div>`; }
                                                 else { bg = '#fee2e2'; border = '1px solid #fca5a5'; content = `<div style="color:#b91c1c; font-weight:700; font-size:0.75rem; line-height:1.1; display:flex; align-items:center; justify-content:center; height:100%; text-align:center">${activeOverrideStatus}</div>`; }

                                                 // Superadmin-only per-cell delete (×) for this quick-action entry
                                                 if (overrideEntryId) rowQuickIds.push(overrideEntryId);
                                                 if (overrideEntryId && window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.isSuperadmin && window.JPSMS.auth.isSuperadmin()) {
                                                     content += `<button title="Delete this quick-action entry" onclick="event.stopPropagation(); deleteQuickEntry(${overrideEntryId}, this)" style="position:absolute; top:1px; right:1px; width:16px; height:16px; line-height:14px; padding:0; border:none; border-radius:50%; background:rgba(0,0,0,0.35); color:#fff; font-size:0.7rem; font-weight:800; cursor:pointer; z-index:5">×</button>`;
                                                 }

                                                 // Full-hour badge: quick-action logged for the whole hour (60 min) with 0 production
                                                 if (overrideTriggeredThisSlot && overrideEntryDt >= 60 && overrideEntryGood === 0) {
                                                     content += `<span title="Full-hour quick action: 60 min downtime, 0 production in this slot" style="position:absolute; bottom:1px; left:1px; background:#b91c1c; color:#fff; font-size:0.55rem; font-weight:800; padding:0 4px; border-radius:6px; line-height:1.45; z-index:5; pointer-events:none">⛔ 60m</span>`;
                                                 }

                                            } else if (entries.length > 0) {
                                                // Updated: Iterate all entries to show stacked visual
                                                bg = '#ffffff'; // Default to white if multiple, or override below
                                                border = '1px solid #f1f5f9';

                                                content = '<div style="display:flex; flex-direction:column; width:100%; height:100%; border-radius:4px; overflow:hidden; border:1px solid #e2e8f0">';

                                                entries.forEach((entry, idx) => {
                                                    let isLate = false;
                                                    if (entry.created_at) {
                                                        const entryTime = new Date(entry.created_at).getTime();
                                                        const slotEndTime = getSlotEnd(s, date, rowShift);
                                                        // 45 minutes = 2700000 ms. If entered after this, mark Late.
                                                        if (slotEndTime > 0 && entryTime > (slotEndTime + 2700000)) isLate = true;
                                                    }

                                                    // Background: yellow for late entries, green for on-time
                                                    const blockBg = isLate ? '#fef9c3' : '#dcfce7';
                                                    // Good qty: always green (late entries still flagged via yellow bg)
                                                    const qtyColor = '#15803d';

                                                    // Divider between stacked entries
                                                    const separator = (idx < entries.length - 1) ? 'border-bottom:1px solid rgba(0,0,0,0.1);' : '';

                                                    const _esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
                                                    const colName = _esc(entry.colour || '');
                                                    const isCC = (entry.entry_type === 'ColourChange');

                                                    const lineAccess = (entry.creator_line_access || '').toLowerCase();
                                                    const isAllAccess = lineAccess === 'all' || (entry.user_name || '').toLowerCase().includes('admin');

                                                    const isAuto = (entry.remarks || '').includes('[Auto-Filled]');

                                                    // DT display: auto-filled entries show "Auto DT: Xm", manual show "X.Xh"
                                                    const dtMins = Number(entry.downtime_min || 0);
                                                    const manualDtStr = (!isAuto && dtMins > 0) ? `${(dtMins / 60).toFixed(1)}h` : '';
                                                    const autoDtStr  = (isAuto  && dtMins > 0) ? `Auto DT: ${Math.round(dtMins)}m` : '';

                                                    const ppcBadge  = isAllAccess ? `<span style="font-size:0.58rem;color:#fff;background:#6366f1;padding:1px 3px;border-radius:2px;font-weight:700">PPC</span>` : '';
                                                    const autoBadge = isAuto      ? `<span style="font-size:0.58rem;color:#fff;background:#94a3b8;padding:1px 3px;border-radius:2px;font-weight:700" title="Auto-Filled">AUTO</span>` : '';
                                                    const ccBadge   = isCC        ? `<span style="font-size:0.58rem;color:#c2410c;background:#fff7ed;border:1px solid #ffedd5;padding:1px 3px;border-radius:2px;font-weight:700">CC</span>` : '';

                                                    const timeStr = entry.created_at ? new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                                                    const rejQty = Number(entry.reject_qty || 0);

                                                    content += `
                                                        <div onclick='showEntryDetails(${JSON.stringify(entry).replace(/'/g, "&apos;")})' style="cursor:pointer;flex:1;min-width:0;width:100%;background:${blockBg};${separator}padding:3px 4px;display:flex;flex-direction:column;gap:2px;transition:background 0.2s" onmouseover="this.style.filter='brightness(0.94)'" onmouseout="this.style.filter='none'">

                                                            <!-- Row 1: 90 | 10  (good green | rej red, no label) -->
                                                            <div style="display:flex;align-items:baseline;gap:3px;line-height:1;min-width:0">
                                                                <span style="font-weight:800;font-size:0.95rem;color:#15803d;line-height:1">${entry.good_qty}</span>
                                                                ${rejQty > 0 ? `<span style="font-size:0.78rem;color:#9ca3af;font-weight:600;line-height:1">|</span><span style="font-weight:800;font-size:0.85rem;color:#dc2626;line-height:1">${rejQty}</span>` : ''}
                                                            </div>

                                                            <!-- Row 2: Time -->
                                                            ${timeStr ? `<div style="font-size:0.62rem;color:#64748b;font-weight:600;line-height:1">${timeStr}</div>` : ''}

                                                            <!-- Row 3: Supervisor DT (manual) -->
                                                            ${manualDtStr ? `<div style="font-size:0.7rem;color:#db2777;font-weight:700;line-height:1">${manualDtStr}</div>` : ''}

                                                            <!-- Row 4: Auto DT -->
                                                            ${autoDtStr ? `<div style="font-size:0.68rem;color:#be185d;font-weight:600;line-height:1">${autoDtStr}</div>` : ''}

                                                            <!-- Row 5: Colour name — plain block, wraps at word boundaries, max 3 lines -->
                                                            ${colName ? `<div style="font-size:0.68rem;color:#334155;font-weight:600;line-height:1.3;overflow:hidden;max-height:3.9em;width:100%;word-break:normal;overflow-wrap:anywhere;white-space:normal" title="${colName}">${colName}</div>` : ''}

                                                            <!-- Row 6: Badges only if present (CC / PPC / AUTO) -->
                                                            ${(ccBadge || ppcBadge || autoBadge) ? `<div style="display:flex;gap:2px;flex-wrap:wrap">${ccBadge}${ppcBadge}${autoBadge}</div>` : ''}

                                                        </div>
                                                    `;
                                                });
                                                content += '</div>';

                                            } else {
                                                // 3. EMPTY SLOT LOGIC
                                                let showCross = false;
                                                let isBlocked = false;
                                                
                                                const isActiveForThisSlot = (mIdx === activeMouldBySlot[idx]);

                                                if (sEnd < now) {
                                                    if (isActiveForThisSlot) {
                                                        // Show red cross for past slots with no production and no Quick Action in THIS slot.
                                                        // A carry-forward activeOverrideStatus (from an earlier slot) must not suppress the cross —
                                                        // only an actual Quick Action entry triggered IN this slot does.
                                                        if (!hasMachineProduction && !overrideTriggeredThisSlot) {
                                                            if (mouldStartTs === 0 || sEnd > (mouldStartTs + 600000)) {
                                                                showCross = true;
                                                                machineMissingSlots++; // count for Pending filter
                                                            }
                                                        }
                                                    } else {
                                                        // Not the active mould for this slot -> Blocked
                                                        isBlocked = true;
                                                    }
                                                }

                                                if (isBlocked) {
                                                    content = ``;
                                                    // Diagonal Hatch Pattern (Crossed Lines)
                                                    bg = 'repeating-linear-gradient(45deg, #f8fafc, #f8fafc 4px, #e2e8f0 4px, #e2e8f0 5px)'; 
                                                    border = '1px solid #f1f5f9';
                                                } else if (showCross) {
                                                    content = `<i class="bi bi-x-lg" style="color:#ef4444; font-size:1.2rem; font-weight:700"></i>`;
                                                    bg = '#fee2e2';
                                                    border = '1px solid #fca5a5';
                                                } else {
                                                    content = '<span style="color:#e2e8f0; font-size:1.5rem">·</span>';
                                                }
                                            } // End of EMPTY SLOT LOGIC
                                            
                                            // [NEW] Beautiful Plant Closure Banner
                                            if (closure) {
                                                let closedTitle = 'FACTORY EXPERIENCING SHUTDOWN';
                                                if (closure.plant !== 'All') {
                                                    closedTitle = closure.plant.includes('-') ? `LINE ${closure.plant} CLOSED` : `PLANT ${closure.plant} CLOSED`;
                                                }
                                                const banner = `
                                                    <div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; padding:6px 0;">
                                                        <div style="background: linear-gradient(90deg, rgba(254,242,242,0.8), rgba(254,226,226,0.95), rgba(254,242,242,0.8)); border:1px solid #fca5a5; border-radius:12px; padding:6px 20px; display:inline-flex; align-items:center; gap:14px; box-shadow: 0 4px 6px -1px rgba(239,68,68,0.1), inset 0 1px 0 rgba(255,255,255,0.5);">
                                                            <div style="background:linear-gradient(135deg, #ef4444, #b91c1c); color:white; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.2); border: 2px solid #fecaca;">
                                                                <i class="bi bi-lock-fill"></i>
                                                            </div>
                                                            <div style="display:flex; flex-direction:column; align-items:flex-start; line-height:1.2;">
                                                                <span style="color:#991b1b; font-weight:800; font-size:0.95rem; letter-spacing:1px; text-transform:uppercase;">${closedTitle}</span>
                                                                <span style="color:#dc2626; font-weight:600; font-size:0.75rem; text-transform:uppercase;">${closure.remarks || 'RESTRICTED'}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                `;
                                                machineRowHtml += `<td colspan="${slots.length}" style="padding:0; background:#fffaf9; border-bottom:1px solid #e2e8f0; border-right:2px solid #e2e8f0; vertical-align:middle; height:50px;">${banner}</td>`;
                                                skipRemainingSlots = true;
                                                return; // Skip rendering remaining slot tds
                                            }

                                            machineRowHtml += `<td style="position:relative; padding:3px; background:${bg}; border:${border}; border-bottom:1px solid #e2e8f0; vertical-align:top; height:44px; min-width:65px">${content}</td>`;
                                        });

                                        // D. Summary Column
                                        let sumStd = 0, sumGood = 0, sumRej = 0, sumDt = 0, sumAutoDt = 0;
                                        let sumTonnage = 0, sumRejTonnage = 0;
                                        let rowAggRej = {};
                                        let rowAggDt = {};
                                        let minSlotIdx = 999, maxSlotIdx = -1;
                                        let hasEntries = false;

                                        // Row Setup Weight Logic ...
                                        const mCode = (m.code || '').toLowerCase(), mName = (m.name || '').toLowerCase(), mOrder = (m.order_no || '').toLowerCase();
                                        // SEARCH IN ROW SETUPS
                                        let matchingSetup = rowSetups.find(s => {
                                            const sOrder = (s.order_no || '').trim().toLowerCase(), sCode = (s.mould_no || '').trim().toLowerCase(), sName = (s.mould_name || '').trim().toLowerCase();
                                            if (sOrder && mOrder && sOrder === mOrder) return (sCode && mCode && sCode === mCode) || (sName && mName && sName === mName);
                                            return false;
                                        });
                                        if (!matchingSetup) matchingSetup = rowSetups.find(s => {
                                            const sCode = (s.mould_no || '').trim().toLowerCase(), sName = (s.mould_name || '').trim().toLowerCase();
                                            return (sCode && mCode && sCode === mCode) || (sName && mName && sName === mName);
                                        });
                                        let rowSetupWeight = matchingSetup ? parseFloat(matchingSetup.article_act || 0) : 0;
                                        if (rowSetupWeight >= 10) rowSetupWeight = rowSetupWeight / 1000;

                                        if (!m.is_dummy) {
                                            let sumActiveOverride = ''; // Tracker for summary
                                            slots.forEach((s, idx) => {
                                                const sEnd = getSlotEnd(s, date, rowShift);
                                                const now = new Date().getTime();
                                                const currentSlotStart = sEnd - 3600000;
                                                const isFuture = (now < currentSlotStart);

                                                let slotEntries = mData[s];
                                                if (isFuture) slotEntries = []; // STRICT GATE: No entries for future slots

                                                const list = Array.isArray(slotEntries) ? slotEntries : (slotEntries ? [slotEntries] : []);
                                                // Find Entries (plural)
                                                let entries = list.filter(e => {
                                                    let eNo = (e.mould_no || '').trim(), eName = (e.mould_name || '').trim(), eOrder = (e.order_no || '').trim().toLowerCase();
                                                    if (!eNo && eName && nameToCode[eName]) eNo = nameToCode[eName];
                                                    // Use shared variables instead of re-declaring them
                                                    const sMCode = (m.code || '').trim(), sMName = (m.name || '').trim(), sMOrder = (m.order_no || '').trim().toLowerCase();

                                                    if (mOrder && eOrder) return (mOrder === eOrder);

                                                    // Fallback: If Row has Order but Entry has None, OR Row has None
                                                    if (mCode && eNo && mCode === eNo) return true;
                                                    if (mName && eName && mName === eName) return true;

                                                    return false;
                                                });
                                                if (entries.length === 0 && isFirstMouldInMachine) entries = list.filter(e => !e.mould_no && !e.mould_name && !e.order_no);

                                                 // --- FEATURE: Auto-Fill Summary Integration ---
                                                 let hasOverrideThisSlot = false;
                                                 const spEntry = list.find(e => ['Maintenance', 'MouldChange', 'MouldChangeover', 'ManPowerShortage', 'MouldMaintenance', 'NoPlan', 'MouldTrial', 'PowerCut'].includes(e.entry_type));
                                                 if (spEntry) {
                                                     if (spEntry.entry_type === 'Maintenance') sumActiveOverride = '🏭 Machine Maintenance';
                                                     else if (spEntry.entry_type.includes('MouldChange')) sumActiveOverride = 'Mould Changeover';
                                                     else if (spEntry.entry_type === 'ManPowerShortage') sumActiveOverride = 'Man Power Shortage';
                                                     else if (spEntry.entry_type === 'MouldMaintenance') sumActiveOverride = 'MOULD MAINT';
                                                     else if (spEntry.entry_type === 'NoPlan') sumActiveOverride = 'NO PLAN';
                                                     else if (spEntry.entry_type === 'MouldTrial') sumActiveOverride = 'MOULD TRIAL';
                                                     else if (spEntry.entry_type === 'PowerCut') sumActiveOverride = '⚡ POWER CUT';
                                                     hasOverrideThisSlot = true;
                                                 } else {
                                                    const dEntry = entries.find(e => e.entry_type === 'Main' && Number(e.downtime_min) >= 45 && Number(e.good_qty || 0) === 0);
                                                    if (dEntry) {
                                                        const brk = typeof dEntry.downtime_breakup === 'string' ? {} : (dEntry.downtime_breakup || {});                                                         if (brk['1']) { sumActiveOverride = 'Man Power Shortage'; hasOverrideThisSlot = true; }
                                                         else if (brk['2']) { sumActiveOverride = 'Mould Changeover'; hasOverrideThisSlot = true; }
                                                         else if (brk['5']) { sumActiveOverride = '🏭 Machine Maintenance'; hasOverrideThisSlot = true; }
                                                         else if (brk['7']) { sumActiveOverride = 'MOULD MAINT'; hasOverrideThisSlot = true; }
                                                         else if (brk['8']) { sumActiveOverride = '⚡ POWER CUT'; hasOverrideThisSlot = true; }
                                                         else if (brk['11']) { sumActiveOverride = 'MOULD TRIAL'; hasOverrideThisSlot = true; }
                                                         else if (brk['13']) { sumActiveOverride = 'NO PLAN'; hasOverrideThisSlot = true; }
                                                     }
                                                 }

                                                // Reset tracker on real machine-wide production
                                                let hasMachineProd = list.some(e => Number(e.good_qty || 0) > 0 || Number(e.shots || 0) > 0 || (e.entry_type === 'Main' && Number(e.downtime_min || 0) < 45) || e.entry_type === 'ColourChange');
                                                // Also reset if a different job has any entry on this machine in this slot
                                                const sumMOrder = (m.order_no || '').trim().toLowerCase();
                                                const hasDiffJobEntry = sumMOrder && list.some(e => {
                                                    const eOrder = (e.order_no || '').trim().toLowerCase();
                                                    return eOrder && eOrder !== sumMOrder;
                                                });
                                                if ((hasMachineProd || hasDiffJobEntry) && !hasOverrideThisSlot) sumActiveOverride = '';

                                                // sEnd, now, isFuture are already declared at top of loop
                                                const sStart = sEnd - 3600000;

                                                // Accumulate Downtime if Auto-Fill is active and valid for time
                                                // Avoid double-counting: Only add for the FIRST ROW of the machine (mIdx === 0)
                                                if (mIdx === 0 && sumActiveOverride && !hasMachineProd && !hasOverrideThisSlot && !isFuture) {
                                                    sumDt += 60;
                                                    // Also add to Aggregate for the Details popup
                                                    let rCode = '5'; // Default Maint
                                                    if (sumActiveOverride === 'Man Power Shortage') rCode = '1';
                                                    else if (sumActiveOverride === 'Mould Changeover') rCode = '2';
                                                    else if (sumActiveOverride === 'MOULD MAINT') rCode = '7';
                                                    else if (sumActiveOverride === '⚡ POWER CUT') rCode = '8';
                                                    else if (sumActiveOverride === 'MOULD TRIAL') rCode = '11';
                                                    else if (sumActiveOverride === 'NO PLAN') rCode = '13';
                                                     rowAggDt[rCode] = (rowAggDt[rCode] || 0) + 60;
                                                }

                                                let isForThisMould = false;
                                                let slotShots = 0;

                                                if (entries.length > 0) {
                                                    isForThisMould = true;
                                                    hasEntries = true;
                                                    if (idx < minSlotIdx) minSlotIdx = idx;
                                                    if (idx > maxSlotIdx) maxSlotIdx = idx;

                                                    let slotDt = 0;
                                                    entries.forEach(entry => {
                                                        const gQty = parseInt(entry.good_qty) || 0;
                                                        sumGood += gQty;
                                                        sumRej += parseInt(entry.reject_qty) || 0;
                                                        
                                                        const dt = parseInt(entry.downtime_min) || 0;
                                                        slotDt += dt;

                                                        // Slot Shots Accumulation
                                                        slotShots += (parseInt(entry.shots) || 0);

                                                        // Counters
                                                        const dtMap = entry.downtime_breakup || {};
                                                        if (entry.entry_type === 'ColourChange' || dtMap['9'] > 0) lineTotalCC++;
                                                        if (dtMap['2'] > 0) lineTotalMC++;

                                                        let entryWeight = 0;
                                                        if (entry.plan_id) {
                                                            const exactSetup = rowSetups.find(st => String(st.plan_id) === String(entry.plan_id));
                                                            if (exactSetup) {
                                                                entryWeight = parseFloat(exactSetup.article_act || 0);
                                                                if (entryWeight >= 10) entryWeight = entryWeight / 1000;
                                                            }
                                                        }
                                                        if (!entryWeight && rowSetupWeight > 0) entryWeight = rowSetupWeight;

                                                        if (gQty > 0 && entryWeight > 0) sumTonnage += (gQty * entryWeight);
                                                        const eRQty = parseInt(entry.reject_qty) || 0;
                                                        if (eRQty > 0 && entryWeight > 0) sumRejTonnage += (eRQty * entryWeight);

                                                        // Aggregation for Summary Modal
                                                        if (entry.reject_breakup && typeof entry.reject_breakup === 'object') {
                                                            Object.entries(entry.reject_breakup).forEach(([r, v]) => {
                                                                if (!rowAggRej[r]) rowAggRej[r] = 0;
                                                                rowAggRej[r] += Number(v);
                                                            });
                                                        }
                                                        if (entry.downtime_breakup && typeof entry.downtime_breakup === 'object') {
                                                            Object.entries(entry.downtime_breakup).forEach(([r, v]) => {
                                                                if (!rowAggDt[r]) rowAggDt[r] = 0;
                                                                rowAggDt[r] += Number(v);
                                                            });
                                                        }
                                                    });
                                                    // Cap Downtime at 60 per slot for machine total
                                                    sumDt += Math.min(60, slotDt);

                                                    // --- Auto Downtime Calculation Per Slot ---
                                                    // "if STD PCs is 60 and user enter total shots is 30... show 30 minutes Downtime"
                                                    // Formula: 60 - ((TotalPcs * 60) / StdPcsHr)
                                                    // Used Total Pcs (Good + Rej) as per user request ("total pcs means good + reject")
                                                    const stdPcsHr = parseFloat(m.std) || 0;
                                                    let slotTotalPcs = 0;
                                                    entries.forEach(e => {
                                                        slotTotalPcs += (parseInt(e.good_qty) || 0) + (parseInt(e.reject_qty) || 0);
                                                    });

                                                    if (stdPcsHr > 0 && slotTotalPcs > 0) {
                                                        const runMin = (slotTotalPcs / stdPcsHr) * 60;
                                                        const diff = 60 - runMin;
                                                        // Only add positive downtime (if runMin < 60)
                                                        if (diff > 0) sumAutoDt += diff;
                                                    }
                                                }

                                                // Std Calc: Add if slot is active and not future/maint/compl
                                                if (isForThisMould) {
                                                    const slotEndTime = getSlotEnd(s, date, rowShift);
                                                    const slotStartTs = slotEndTime - 3600000;
                                                    const now = new Date().getTime();
                                                    const mouldEndTs = m.end_time ? new Date(m.end_time).getTime() : 0;
                                                    let isFuture = (slotStartTs > now);
                                                    let isCompleted = (mouldEndTs > 0 && mouldEndTs < slotStartTs);

                                                    const getSlotStartTs = (dVal, sVal) => getSlotEnd(sVal, dVal, rowShift) - 3600000;
                                                    const mLogs = rowMaint[machine] || [];
                                                    let hasMaint = mLogs.some(log => {
                                                        const lStart = getSlotStartTs(log.start_date, log.start_slot);
                                                        let lEnd = 9999999999999;
                                                        if (!log.is_active && log.end_date && log.end_slot) lEnd = getSlotEnd(log.end_slot, log.end_date, rowShift);
                                                        const overlapStart = Math.max(slotStartTs, lStart);
                                                        const overlapEnd = Math.min(slotEndTime, lEnd);
                                                        return (overlapEnd > overlapStart);
                                                    });

                                                    if (!isFuture && !isCompleted && !hasMaint) {
                                                        sumStd += parseFloat(m.std || 0);
                                                    }
                                                }
                                            });
                                        }

                                        // Efficiency — OEE (gross scheduled time) and EFF (net run time after DT)
                                        let rowEff = 0, estPcs = 0;
                                        let rowEffNet = 0, estPcsNet = 0;
                                        if (hasEntries && maxSlotIdx >= minSlotIdx && !m.is_dummy) {
                                            const availSlots = maxSlotIdx - minSlotIdx + 1;
                                            const availMins = availSlots * 60;
                                            const runTimeMins = Math.max(0, availMins - Math.min(sumDt, availMins));
                                            const std = parseFloat(m.std) || 0;
                                            if (std > 0) {
                                                // OEE = Good / (Std × Scheduled Hours)
                                                estPcs = Math.round(std * (availMins / 60.0));
                                                if (estPcs > 0) rowEff = (sumGood / estPcs) * 100;
                                                // EFF = Good / (Std × Net Run Hours)
                                                estPcsNet = Math.round(std * (runTimeMins / 60.0));
                                                if (estPcsNet > 0) rowEffNet = (sumGood / estPcsNet) * 100;
                                            }
                                        }

                                        // Summary cell variables
                                        const totalPcs = sumGood + sumRej;
                                        const stdWeightRaw = parseFloat(m.details?.std_weight || 0);
                                        const stdWeightKg  = stdWeightRaw >= 10 ? stdWeightRaw / 1000 : stdWeightRaw;
                                        const wtStdGrams   = stdWeightKg > 0 ? Math.round(stdWeightKg * 1000) : 0;
                                        // Wt Act: prefer actual production (good tonnage ÷ good pieces), fallback to setup entry
                                        const wtActKgPerPcs = (sumGood > 0 && sumTonnage > 0) ? (sumTonnage / sumGood) : (rowSetupWeight > 0 ? rowSetupWeight : 0);
                                        const wtActGrams   = wtActKgPerPcs > 0 ? Math.round(wtActKgPerPcs * 1000) : 0;
                                        const totKg        = sumTonnage + sumRejTonnage;
                                        const effColor     = rowEffNet >= 80 ? '#166534' : rowEffNet >= 60 ? '#b45309' : '#dc2626';
                                        const oeeColor     = rowEff    >= 80 ? '#166534' : rowEff    >= 60 ? '#b45309' : '#dc2626';

                                        const summaryClickScript = `showSummaryDetails('${stripMachPfx(machine)}', '${rowShift}', '${lineName}', ${sumGood}, ${sumRej}, ${sumDt}, ${sumAutoDt}, ${Math.round(sumStd)}, '${encodeURIComponent(JSON.stringify(rowAggRej))}', '${encodeURIComponent(JSON.stringify(rowAggDt))}')`;

                                        let summaryH = !m.is_dummy ? `<div style="text-align:left;cursor:pointer;font-size:0.72rem;line-height:1.32;padding:1px 0" onclick="${summaryClickScript}"><div style="font-weight:700;color:#0369a1">Std: ${Math.round(sumStd)}</div><div style="font-weight:800;color:#166534;font-size:0.8rem">${totalPcs}<span style="font-weight:500;color:#64748b;font-size:0.68rem"> (${sumGood} + ${sumRej})</span></div>${sumDt > 0 ? `<div style="color:#db2777;font-weight:700">${(sumDt / 60).toFixed(1)} Hrs DT</div>` : ''}${sumAutoDt > 0 ? `<div style="color:#be185d;font-weight:600">Auto DT: ${Math.round(sumAutoDt)}m</div>` : ''}${(wtStdGrams > 0 || wtActGrams > 0) ? `<div style="color:#64748b;font-weight:600">Wt: ${wtStdGrams > 0 ? wtStdGrams + 'g' : '-'} → ${wtActGrams > 0 ? wtActGrams + 'g' : '-'}</div>` : ''}<div style="font-weight:700;color:#7c3aed">Tot Kg: ${totKg.toFixed(1)}</div>${rowEffNet > 0 ? `<div style="font-weight:700;color:${effColor}" title="EFF (Net Run Time) — Est: ${estPcsNet} pcs">EFF :- ${rowEffNet.toFixed(1)} %</div>` : ''}${rowEff > 0 ? `<div style="font-weight:700;color:${oeeColor}" title="OEE (Scheduled Time) — Est: ${estPcs} pcs">OEE :- ${rowEff.toFixed(1)} %</div>` : ''}</div>` : '<span style="color:#94a3b8">-</span>';

                                        lineTotalTonnage += sumTonnage;
                                        lineTotalRejTonnage += sumRejTonnage;
                                        lineTotalGoodPcs += sumGood;
                                        lineTotalEstPcs += estPcs;
                                        lineTotalEstPcsNet += estPcsNet;
                                        lineTotalDt += sumDt;
                                        lineTotalAutoDt += sumAutoDt; // Accumulate Auto DT
                                        machineGood += sumGood;
                                        machineEst += estPcs;

                                        const _summaryBlink = (rowEff > 0 && rowEff < 85 && !m.is_dummy) ? ' blink-alert' : '';
                                        machineRowHtml += `<td class="${_summaryBlink}" style="background:#f0f9ff; border-left:2px solid #e2e8f0; padding:10px; vertical-align:middle; border-bottom:1px solid #e2e8f0; vertical-align:top">${summaryH}</td></tr>`;

                                        // Superadmin-only row-level "clear quick entries" button (replaces this row's placeholder)
                                        const _uniqQuickIds = Array.from(new Set(rowQuickIds));
                                        const _isSuper = !!(window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.isSuperadmin && window.JPSMS.auth.isSuperadmin());
                                        const _rowClearBtn = (_uniqQuickIds.length && _isSuper)
                                            ? `<button title="Delete all quick-action entries in this row" onclick="event.stopPropagation(); clearRowQuickEntries([${_uniqQuickIds.join(',')}], this)" style="display:inline-block; margin-top:6px; padding:2px 8px; border:1px solid #fca5a5; border-radius:4px; background:#fef2f2; color:#b91c1c; font-size:0.6rem; font-weight:700; cursor:pointer">🗑 Clear ${_uniqQuickIds.length} quick</button>`
                                            : '';
                                        machineRowHtml = machineRowHtml.replace('<!--ROWCLEAR-->', _rowClearBtn);
                                    }); // End distinctMoulds loop (Rows)
                                }); // End shiftsToRender loop

                                // Push to Buffer
                                let mEff = (machineEst > 0) ? (machineGood / machineEst) * 100 : 0;

                                // Blink is now applied per-mould on the summary cell (see _summaryBlink above)

                                if (flatMode) {
                                    globalMachineBuffer.push({ html: machineRowHtml, eff: mEff, name: machine, entryTypes: machineEntryTypes, hasEntries: machineGood > 0 || machineEst > 0, missingSlots: machineMissingSlots });
                                } else {
                                    machineBuffer.push({ html: machineRowHtml, eff: mEff, name: machine });
                                }
                            }); // End machines loop

                            // Append to Line Inner HTML (always, even in flatMode — line totals still update)
                            lineInnerHtml += machineBuffer.map(m => m.html).join('');
                            lineInnerHtml += `</tbody></table></div></div>`;

                            // Store Totals for this line (Accumulate across dates)
                            if (!window.lineTheTonnages[lineName]) {
                                window.lineTheTonnages[lineName] = { good: 0, rej: 0, effGood: 0, effEst: 0, netEst: 0, dt: 0, autoDt: 0, cc: 0, mc: 0, jc: 0 };
                            }
                            const t = window.lineTheTonnages[lineName];
                            t.good += lineTotalTonnage;
                            t.rej += lineTotalRejTonnage;
                            t.effGood += lineTotalGoodPcs;
                            t.effEst += lineTotalEstPcs;
                            t.netEst  = (t.netEst || 0) + lineTotalEstPcsNet;
                            t.dt += lineTotalDt;
                            t.autoDt += lineTotalAutoDt;
                            t.cc += lineTotalCC;
                            t.mc += lineTotalMC;
                            t.jc += lineTotalJC;

                            // Update Line UI for THIS line (shows cumulative for all processed dates so far)
                            const lineId = lineName.replace(/\s/g, '');
                            const updateEl = (suffix, val, fixed = 2) => {
                                const el = document.getElementById(`line-total-${suffix}-${lineId}`);
                                if (el) el.textContent = typeof val === 'number' ? val.toFixed(fixed) : val;
                            };
                            updateEl('overall', t.good + t.rej);
                            updateEl('tonnage', t.good);
                            updateEl('rej', t.rej);
                            updateEl('eff',    t.effEst > 0        ? (t.effGood / t.effEst        * 100) : 0, 1); // OEE
                            updateEl('effnet', (t.netEst || 0) > 0 ? (t.effGood / (t.netEst || 0) * 100) : 0, 1); // EFF
                            updateEl('dt', t.dt / 60, 1);
                            updateEl('autodt', t.autoDt, 0);
                            updateEl('mc', t.mc, 0);
                            updateEl('cc', t.cc, 0);
                            updateEl('jc', t.jc, 0);

                            // Capture for Line Sorting (only in normal mode)
                            let calcEff = (lineTotalEstPcs > 0) ? (lineTotalGoodPcs / lineTotalEstPcs) * 100 : 0;
                            if (!flatMode) {
                                lineBuffer.push({
                                    html: lineInnerHtml,
                                    name: lineName,
                                    eff: calcEff
                                });
                            }
                        }); // END lineName loop

                        if (flatMode) {
                            // Apply View Filter — keep only machines matching the selected filter
                            let filteredMachineBuffer = globalMachineBuffer;
                            if (filterMode === 'Pending') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.missingSlots > 0);
                            } else if (filterMode === 'LowEff') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.eff > 0 && m.eff < 75);
                            } else if (filterMode === 'ManPowerShortage') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.entryTypes.has('ManPowerShortage'));
                            } else if (filterMode === 'MouldMaintenance') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.entryTypes.has('MouldMaintenance'));
                            } else if (filterMode === 'PowerCut') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.entryTypes.has('PowerCut'));
                            } else if (filterMode === 'NoPlan') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.entryTypes.has('NoPlan') || !m.hasEntries);
                            } else if (filterMode === 'MachineMaintenance') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.entryTypes.has('Maintenance'));
                            } else if (filterMode === 'MouldTrial') {
                                filteredMachineBuffer = globalMachineBuffer.filter(m => m.entryTypes.has('MouldTrial'));
                            }
                            // Sort: Pending → most missing slots first; all others → lowest EFF first
                            if (filterMode === 'Pending') {
                                filteredMachineBuffer.sort((a, b) => b.missingSlots - a.missingSlots);
                            } else {
                                filteredMachineBuffer.sort((a, b) => a.eff - b.eff);
                            }
                            masterHtml += `
                                <div style="margin-bottom:24px; background:white; border:1px solid #cbd5e1; border-radius:0 0 12px 12px; overflow:hidden; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05); margin-top:-1px">
                                    <div style="overflow-x:auto">
                                        <table style="width:100%; border-collapse:separate; border-spacing:0; font-size:0.8rem; text-align:center; table-layout:fixed">
                                            <colgroup>
                                                <col style="width:220px; min-width:220px">
                                                <col style="width:45px; min-width:45px">
                                                ${slots.map(() => '<col style="width:65px; min-width:65px">').join('')}
                                                <col style="width:140px; min-width:140px">
                                            </colgroup>
                                            <tbody>
                                                ${filteredMachineBuffer.map(m => {
                                                    if (filterMode === 'Pending' && m.missingSlots > 0) {
                                                        const badge = `<span style="display:inline-block;margin-left:6px;background:#ef4444;color:#fff;font-size:0.65rem;font-weight:800;padding:1px 6px;border-radius:10px;vertical-align:middle;white-space:nowrap">${m.missingSlots} missing</span>`;
                                                        return m.html.replace('<!--ROWCLEAR-->', badge);
                                                    }
                                                    return m.html;
                                                }).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            `;
                        } else {
                            // Normal mode: sort lines alphabetically
                            lineBuffer.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
                            masterHtml += lineBuffer.map(x => x.html).join('');
                        }
                        }); // END allDates.forEach

                        // ---- ENTRIES COUNT: Standalone calculation from raw API data ----
                        // Runs outside the rendering loop so it is never skipped or double-counted.
                        {
                            const _now = Date.now();
                            const _slots = ['07-08','08-09','09-10','10-11','11-12','12-01','01-02','02-03','03-04','04-05','05-06','06-07'];
                            const _shiftsForCount = (shiftMode === 'Both') ? ['Day','Night'] : [shiftMode];
                            // Slot end-hour tables (local browser time)
                            // Day shift 07:00-19:00, Night shift 19:00-07:00
                            const _dayEnd  = {'07-08':8,'08-09':9,'09-10':10,'10-11':11,'11-12':12,'12-01':13,'01-02':14,'02-03':15,'03-04':16,'04-05':17,'05-06':18,'06-07':19};
                            const _nightEnd = {'07-08':20,'08-09':21,'09-10':22,'10-11':23,'11-12':0,'12-01':1,'01-02':2,'02-03':3,'03-04':4,'04-05':5,'05-06':6,'06-07':7};
                            const _nightNextDay = new Set(['11-12','12-01','01-02','02-03','03-04','04-05','05-06','06-07']);
                            // All allowed machines (factory-filtered)
                            const _allMachines = (machines || []).map(m => m.machine).filter(m => allowedMachines.has(m));

                            // Quick-action detection — mirror the cell renderer so the count
                            // includes quick-action entries AND the slots they visually cover.
                            const _QUICK_TYPES = ['Maintenance','MouldChange','MouldChangeover','ManPowerShortage','MouldMaintenance','NoPlan','MouldTrial','PowerCut'];
                            const _QUICK_CODES = ['1','2','5','7','8','11','13'];
                            const _hasQuickCode = (e) => {
                                const brk = (e && e.downtime_breakup && typeof e.downtime_breakup === 'object') ? e.downtime_breakup : {};
                                return _QUICK_CODES.some(c => brk[c]);
                            };

                            _shiftsForCount.forEach(_shift => {
                                const _dmap = (_shift === 'Day') ? dayDatesMap : nightDatesMap;
                                allDates.forEach(_date => {
                                    const _entries = ((_dmap[_date] || {}).entries) || {};
                                    _allMachines.forEach(_machine => {
                                        const _raw = _entries[_machine] || {};
                                        // Normalise slot keys (strip "Day|" / "Night|" prefix)
                                        const _clean = {};
                                        Object.keys(_raw).forEach(k => {
                                            const ck = k.includes('|') ? k.split('|').pop() : k;
                                            if (!_clean[ck]) _clean[ck] = [];
                                            const v = _raw[k];
                                            _clean[ck] = _clean[ck].concat(Array.isArray(v) ? v : (v ? [v] : []));
                                        });
                                        // Carry quick-action override coverage across slots, in slot order,
                                        // exactly like the cell renderer (activeOverrideStatus is machine-wide).
                                        let _activeOverride = false;
                                        _slots.forEach(_slot => {
                                            const _list = (_clean[_slot] || []).filter(Boolean);
                                            // Update override coverage from THIS slot's entries
                                            const _sp = _list.find(e => _QUICK_TYPES.includes(e.entry_type));
                                            const _dn = _list.find(e => e.entry_type === 'Main' && Number(e.downtime_min) >= 45 && Number(e.good_qty || 0) === 0 && _hasQuickCode(e));
                                            const _trigger = !!(_sp || _dn);
                                            const _hasProd = _list.some(e => Number(e.good_qty || 0) > 0 || Number(e.shots || 0) > 0 || (e.entry_type === 'Main' && Number(e.downtime_min || 0) < 45) || e.entry_type === 'ColourChange');
                                            if (_trigger) _activeOverride = true;
                                            else if (_hasProd) _activeOverride = false;

                                            // Compute slot start timestamp in LOCAL time
                                            const endH = (_shift === 'Day') ? _dayEnd[_slot] : _nightEnd[_slot];
                                            const addDay = (_shift === 'Night' && _nightNextDay.has(_slot)) ? 1 : 0;
                                            const _d = new Date(_date);
                                            _d.setHours(endH, 0, 0, 0);
                                            if (addDay) _d.setDate(_d.getDate() + addDay);
                                            const sStart = _d.getTime() - 3600000;
                                            if (_now >= sStart) { // slot has opened
                                                grandTotalOpenSlots++;
                                                // Filled if it has a real entry OR is covered by an active quick-action override
                                                if (_list.length > 0 || _activeOverride) grandTotalFilledSlots++;
                                            }
                                        });
                                    });
                                });
                            });
                        }

                        if (!masterHtml) {
                            masterHtml = '<div style="padding:60px; text-align:center; color:#94a3b8; background:white; border-radius:8px; border:1px dashed #cbd5e1">No Active Machines Found.</div>';
                        }

                        container.innerHTML = masterHtml;

                        // --- DYNAMIC STICKY HEADER CALCULATION ---
                        // "Make It Perfect": Ensure elements stack precisely based on their real rendered height.
                        const recalcSticky = () => {
                            const filterEl = document.getElementById('sticky-dpr-filter');
                            const totalEl = document.getElementById('sticky-plant-total');
                            const globalHeader = document.getElementById('sticky-global-header');

                            if (filterEl && totalEl && globalHeader) {
                                // 1. Filter Height
                                const filterHeight = filterEl.getBoundingClientRect().height;

                                // 2. Position Plant Total
                                totalEl.style.top = filterHeight + 'px';

                                // 3. Position Global Header (below Plant Total)
                                const totalHeight = totalEl.getBoundingClientRect().height;
                                const headerTop = filterHeight + totalHeight;
                                globalHeader.style.top = headerTop + 'px';
                            }
                        };

                        // Run immediately after render
                        // Use requestAnimationFrame to ensure layout is computed
                        requestAnimationFrame(recalcSticky);
                        // Double tap to be safe against image loads/font shifts
                        setTimeout(recalcSticky, 100);

                        // Optional: Update on resize (Debounced ideally, but simple replace is fine for this context)
                        window.addEventListener('resize', recalcSticky);

                        // UPDATE TOTALS (Lines + Grand Total)
                        if (window.lineTheTonnages) {
                            let grandTotal = 0;
                            let grandTotalRej = 0;
                            let grandTotalGoodPcs = 0;
                            let grandTotalEstPcs = 0;
                            let grandTotalNetPcs  = 0;

                            Object.entries(window.lineTheTonnages).forEach(([name, data]) => {
                                const goodVal = (typeof data === 'number') ? data : (data.good || 0);
                                const rejVal = (data.rej || 0);
                                const eGood = (data.effGood || 0);
                                const eEst = (data.effEst || 0);
                                const eNet  = (data.netEst  || 0);

                                const elId = `line-total-tonnage-${name.replace(/\s/g, '')}`;
                                const el = document.getElementById(elId);
                                if (el) el.textContent = goodVal.toFixed(2);

                                const elOverallId = `line-total-overall-${name.replace(/\s/g, '')}`;
                                const elOverall = document.getElementById(elOverallId);
                                if (elOverall) elOverall.textContent = (goodVal + rejVal).toFixed(2);

                                const elRejId = `line-total-rej-${name.replace(/\s/g, '')}`;
                                const elRej = document.getElementById(elRejId);
                                if (elRej) elRej.textContent = rejVal.toFixed(2);

                                // OEE (scheduled time) — shown in line-total-eff span (label changed to "OEE")
                                const lineOee = (eEst > 0) ? ((eGood / eEst) * 100) : 0;
                                const elEffId = `line-total-eff-${name.replace(/\s/g, '')}`;
                                const elEff = document.getElementById(elEffId);
                                if (elEff) elEff.textContent = lineOee.toFixed(1);

                                // EFF (net run time = scheduled − downtime)
                                const lineEffNet = (eNet > 0) ? ((eGood / eNet) * 100) : 0;
                                const elEffNetId = `line-total-effnet-${name.replace(/\s/g, '')}`;
                                const elEffNet = document.getElementById(elEffNetId);
                                if (elEffNet) elEffNet.textContent = lineEffNet.toFixed(1);

                                grandTotalNetPcs += eNet;

                                const dtVal = (data.dt || 0);
                                const elDtId = `line-total-dt-${name.replace(/\s/g, '')}`;
                                const elDt = document.getElementById(elDtId);
                                if (elDt) elDt.textContent = (dtVal / 60).toFixed(1);

                                const elAutoDtId = `line-total-autodt-${name.replace(/\s/g, '')}`;
                                const elAutoDt = document.getElementById(elAutoDtId);
                                if (elAutoDt) elAutoDt.textContent = (data.autoDt || 0).toFixed(0); // Show minutes

                                // Update Line Counters
                                const elCC = document.getElementById(`line-total-cc-${name.replace(/\s/g, '')}`);
                                if (elCC) elCC.textContent = data.cc || 0;
                                const elMC = document.getElementById(`line-total-mc-${name.replace(/\s/g, '')}`);
                                if (elMC) elMC.textContent = data.mc || 0;
                                const elJC = document.getElementById(`line-total-jc-${name.replace(/\s/g, '')}`);
                                if (elJC) elJC.textContent = data.jc || 0;

                                grandTotal += goodVal;
                                grandTotalRej += rejVal;
                                grandTotalGoodPcs += eGood;
                                grandTotalEstPcs += eEst;
                            });

                            const gtOverallEl = document.getElementById('grand-total-overall');
                            if (gtOverallEl) gtOverallEl.textContent = (grandTotal + grandTotalRej).toFixed(2);

                            const gtEl = document.getElementById('grand-total-tonnage');
                            if (gtEl) gtEl.textContent = grandTotal.toFixed(2);

                            const gtRejEl = document.getElementById('grand-total-rej');
                            if (gtRejEl) gtRejEl.textContent = grandTotalRej.toFixed(2);

                            // Counters Update
                            let gCC = 0, gMC = 0, gJC = 0;
                            Object.values(window.lineTheTonnages).forEach(d => {
                                gCC += (d.cc || 0); gMC += (d.mc || 0); gJC += (d.jc || 0);
                            });
                            document.getElementById('grand-total-cc').textContent = gCC;
                            document.getElementById('grand-total-mc').textContent = gMC;
                            document.getElementById('grand-total-jc').textContent = gJC;

                            // Counter Update Done.

                            // Overall OEE (scheduled time)
                            const gtEffEl = document.getElementById('grand-total-eff');
                            if (gtEffEl) {
                                const gOee = (grandTotalEstPcs > 0) ? ((grandTotalGoodPcs / grandTotalEstPcs) * 100) : 0;
                                gtEffEl.textContent = gOee.toFixed(1);
                            }

                            // Overall EFF (net run time)
                            const gtEffNetEl = document.getElementById('grand-total-effnet');
                            if (gtEffNetEl) {
                                const gEffNet = (grandTotalNetPcs > 0) ? ((grandTotalGoodPcs / grandTotalNetPcs) * 100) : 0;
                                gtEffNetEl.textContent = gEffNet.toFixed(1);
                            }

                            if (window.lineTheTonnages) {
                                let grandTotalDt = 0;
                                let grandTotalAutoDt = 0;
                                Object.values(window.lineTheTonnages).forEach(d => {
                                    grandTotalDt += (d.dt || 0);
                                    grandTotalAutoDt += (d.autoDt || 0);
                                });
                                const gtDtEl = document.getElementById('grand-total-dt');
                                if (gtDtEl) gtDtEl.textContent = (grandTotalDt / 60).toFixed(1);

                                const gtAutoDtEl = document.getElementById('grand-total-autodt');
                                if (gtAutoDtEl) gtAutoDtEl.textContent = (grandTotalAutoDt / 60).toFixed(1);
                            }

                            // --- UPDATE ENTRIES COUNT ---
                            const elEntFilled = document.getElementById('grand-total-entries-filled');
                            const elEntTotal  = document.getElementById('grand-total-entries-total');
                            const elEntBar    = document.getElementById('grand-total-entries-bar');
                            const elEntPct    = document.getElementById('grand-total-entries-pct');
                            if (elEntFilled && elEntTotal) {
                                const entPct = grandTotalOpenSlots > 0 ? Math.round((grandTotalFilledSlots / grandTotalOpenSlots) * 100) : 0;
                                const entColor = entPct >= 80 ? '#059669' : entPct >= 50 ? '#d97706' : '#dc2626';
                                elEntFilled.textContent = grandTotalFilledSlots;
                                elEntFilled.style.color = entColor;
                                elEntTotal.textContent  = grandTotalOpenSlots;
                                if (elEntBar) { elEntBar.style.width = entPct + '%'; elEntBar.style.background = entColor; }
                                if (elEntPct) { elEntPct.textContent = entPct + '%'; elEntPct.style.color = entColor; }
                            }
                        }

                    }).catch(err => {
                        console.error(err);
                        container.innerHTML = `<div style="padding:20px; text-align:center; color:#ef4444">Error: ${err.message}</div>`;
                    });
                };

                document.getElementById('btn-s-apply').onclick = loadSummary;
                document.getElementById('s-eff-filter')?.addEventListener('change', loadSummary);
                document.getElementById('s-factory')?.addEventListener('change', loadSummary);

                // Load factories into the factory dropdown
                J.api.get('/factories').then(r => {
                    const sel = document.getElementById('s-factory');
                    if (!sel || !r.ok) return;
                    (r.data || []).forEach(f => {
                        const opt = document.createElement('option');
                        opt.value = String(f.id);
                        opt.textContent = f.name + (f.location ? ` — ${f.location}` : '');
                        sel.appendChild(opt);
                    });
                }).catch(() => {});

                loadSummary();

            } else if (view === 'setup') {
                title.textContent = 'DPR Setup (Saved Entries)';
                card.innerHTML = `
                    <div style="display:flex; justify-content:flex-end; margin-bottom:10px">
                        <button id="btn-setup-clear" style="background:#ef4444; color:white; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer">Clear All Data (Admin)</button>
                    </div>
                    <div id="setup-list" style="padding:20px; text-align:center; color:#64748b"><i class="bi bi-arrow-repeat spin"></i> Loading entries...</div>
                `;

                // Bind clear
                // Security: Hide Clear All if not admin
                const uSetup = J.auth.getUser();
                if (!(J.auth.isAdminLike ? J.auth.isAdminLike(uSetup) : uSetup.role_code === 'admin')) {
                    const btn = document.getElementById('btn-setup-clear');
                    if (btn) btn.style.display = 'none';
                }
                document.getElementById('btn-setup-clear').onclick = () => {
                    if (!confirm('DANGER: This will delete ALL SETUP entries permanently.\nAre you sure you want to proceed?')) return;

                    const user = J.auth.getUser();
                    J.api.post('/admin/clear-std-actual', { user: user.username }).then(res => {
                        if (res.ok) { alert('All setup data cleared.'); loadSetup(); }
                        else { alert('Error: ' + (res.error || 'Failed')); }
                    });
                };

                const loadSetup = () => {
                    const container = document.getElementById('setup-list');
                    J.api.get('/dpr/setup').then(res => {
                        if (!res.ok || !res.data) throw new Error(res.error || 'No data');
                        const list = res.data;
                        let html = `
                                            < div style="overflow-x:auto" >
                                                <table class="table" style="width:100%; border-collapse:collapse; font-size:0.8rem; white-space:nowrap">
                                                    <thead style="background:#f1f5f9; text-transform:uppercase; font-size:0.75rem; color:#64748b; font-weight:700">
                                                        <tr>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">PlanID</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">Shift</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">Line</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">Machine</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">OrderNo</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">MouldName</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">Art.ACT</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">Run.ACT</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">Cav.ACT</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">Cyc.ACT</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">Pcs/Hr</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">Man</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right">SfgQty</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">Operator Activities</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">EnteredBy</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">DprDate</th>
                                                            <th style="padding:10px; border-bottom:1px solid #e2e8f0">Timestamp</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>`;

                        list.forEach(r => {
                            html += `
                        <tr style="border-bottom:1px solid #e2e8f0; hover:background:#f8fafc">
                          <td style="padding:8px; color:#64748b">${r.plan_id || '-'}</td>
                          <td style="padding:8px">${r.shift || '-'}</td>
                          <td style="padding:8px">${r.line || '-'}</td>
                          <td style="padding:8px; font-weight:600; color:#334155">${r.machine || '-'}</td>
                          <td style="padding:8px; font-family:monospace">${r.order_no || '-'}</td>
                          <td style="padding:8px">${r.mould_name || '-'}</td>
                          <td style="padding:8px; text-align:right">${r.article_act || '-'}</td>
                          <td style="padding:8px; text-align:right">${r.runner_act || '-'}</td>
                          <td style="padding:8px; text-align:right">${r.cavity_act || '-'}</td>
                          <td style="padding:8px; text-align:right">${r.cycle_act || '-'}</td>
                          <td style="padding:8px; text-align:right; font-weight:600">${r.pcshr_act || '-'}</td>
                          <td style="padding:8px; text-align:right">${r.man_act || '-'}</td>
                          <td style="padding:8px; text-align:right">${r.sfgqty_act || '-'}</td>
                          <td style="padding:8px; max-width:200px; white-space:normal; font-size:0.75rem">${r.operator_activities || '-'}</td>
                          <td style="padding:8px">${r.entered_by || '-'}</td>
                          <td style="padding:8px">${r.dpr_date || '-'}</td>
                          <td style="padding:8px; color:#94a3b8; font-size:0.75rem">${new Date(r.created_at).toLocaleString()}</td>
                        </tr>`;
                        });

                        html += `</tbody></table></div > `;
                        container.innerHTML = html;
                    }).catch(err => {
                        container.innerHTML = `< div style = "padding:20px; text-align:center; color:#ef4444" > Error loading data: ${err.message}</div > `;
                    });
                };

                loadSetup();
            } else if (view === 'settings') {
                title.textContent = 'DPR Settings';
                renderSettings(card);
            }

            function renderSettings(container) {
                container.innerHTML = `
                    < div style = "padding:10px" >
                    <div style="margin-bottom:30px">
                      <h3 style="margin:0 0 10px; font-size:1.1rem">General Settings</h3>
                      <div style="display:flex; align-items:center; gap:10px; background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0">
                         <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="chkGeo" style="cursor:pointer; width:40px; height:20px">
                         </div>
                         <div>
                            <div style="font-weight:600">Enforce Geofence Constraints</div>
                            <div style="font-size:0.85rem; color:#64748b">If enabled, Supervisors must be within factory premises to submit DPR.</div>
                         </div>
                      </div>
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:20px">
                        <div>
                            <h3 style="margin:0 0 10px; font-size:1.1rem">Rejection Reasons</h3>
                            <div style="display:flex; gap:8px; margin-bottom:10px">
                                <input id="txtRejCode" placeholder="Code" style="padding:8px; border:1px solid #cbd5e1; border-radius:6px; width:60px">
                                <input id="txtRej" placeholder="Reason" style="padding:8px; border:1px solid #cbd5e1; border-radius:6px; flex:1">
                                <button onclick="addReason('REJECTION')" style="background:#2563eb; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer">Add</button>
                            </div>
                            <ul id="listRej" style="list-style:none; padding:0; border:1px solid #e2e8f0; border-radius:8px; max-height:300px; overflow-y:auto"></ul>
                        </div>
                        <div>
                            <h3 style="margin:0 0 10px; font-size:1.1rem">Downtime Reasons</h3>
                            <div style="display:flex; gap:8px; margin-bottom:10px">
                                <input id="txtDownCode" placeholder="Code" style="padding:8px; border:1px solid #cbd5e1; border-radius:6px; width:60px">
                                <input id="txtDown" placeholder="Reason" style="padding:8px; border:1px solid #cbd5e1; border-radius:6px; flex:1">
                                <button onclick="addReason('DOWNTIME')" style="background:#2563eb; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer">Add</button>
                            </div>
                            <ul id="listDown" style="list-style:none; padding:0; border:1px solid #e2e8f0; border-radius:8px; max-height:300px; overflow-y:auto"></ul>
                        </div>
                        <div>
                            <h3 style="margin:0 0 10px; font-size:1.1rem">Operator Activities</h3>
                            <div style="display:flex; gap:8px; margin-bottom:10px">
                                <input id="txtOps" placeholder="Activity Name (e.g. Cleaning)" style="padding:8px; border:1px solid #cbd5e1; border-radius:6px; flex:1">
                                <button onclick="addReason('OPERATOR_ACTIVITY')" style="background:#2563eb; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer">Add</button>
                            </div>
                            <ul id="listOps" style="list-style:none; padding:0; border:1px solid #e2e8f0; border-radius:8px; max-height:300px; overflow-y:auto"></ul>
                        </div>
                    </div>
                  </div>
                        `;

                // Load Initial Data
                loadSettings();
                loadReasons();

                // Listeners
                document.getElementById('chkGeo').addEventListener('change', (e) => {
                    J.api.post('/settings', { key: 'geofence_enabled', value: e.target.checked });
                });
            }

            window.addReason = (type) => {
                let codeIn, reasonIn;

                if (type === 'OPERATOR_ACTIVITY') {
                    reasonIn = document.getElementById('txtOps');
                    codeIn = { value: '' }; // Mock
                } else {
                    codeIn = document.getElementById(type === 'REJECTION' ? 'txtRejCode' : 'txtDownCode');
                    reasonIn = document.getElementById(type === 'REJECTION' ? 'txtRej' : 'txtDown');
                }

                const code = codeIn.value ? codeIn.value.trim() : '';
                const reason = reasonIn.value.trim();

                if (!reason) return alert('Reason is required');

                window.JPSMS.api.post('/dpr/reasons', { type, code, reason }).then(res => {
                    if (res.ok) {
                        if (codeIn.tagName === 'INPUT') codeIn.value = '';
                        reasonIn.value = '';
                        loadReasons();
                    } else {
                        alert('Error: ' + (res.error || 'Unknown'));
                    }
                });
            };

            window.deleteReason = (id) => {
                if (!confirm('Remove this reason?')) return;
                window.JPSMS.api.delete(`/dpr/reasons/${id}`).then(loadReasons);
            };

            function loadSettings() {
                window.JPSMS.api.get('/settings').then(res => {
                    if (res.ok && res.data) {
                        document.getElementById('chkGeo').checked = (res.data.geofence_enabled === 'true');
                    }
                });
            }

            function loadReasons() {
                window.JPSMS.api.get('/dpr/reasons').then(res => {
                    if (res.ok && res.data) {
                        const rejList = document.getElementById('listRej');
                        const downList = document.getElementById('listDown');
                        const opsList = document.getElementById('listOps');

                        rejList.innerHTML = ''; downList.innerHTML = ''; if (opsList) opsList.innerHTML = '';

                        res.data.forEach(r => {
                            const li = document.createElement('li');
                            li.style.cssText = 'padding:8px 12px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center';

                            const text = (r.code ? `<b>${r.code}</b> - ` : '') + r.reason;
                            li.innerHTML = `<span>${text}</span> <i class="bi bi-trash" style="color:#ef4444; cursor:pointer" onclick="deleteReason(${r.id})"></i>`;

                            if (r.type === 'REJECTION') rejList.appendChild(li);
                            else if (r.type === 'DOWNTIME') downList.appendChild(li);
                            else if (r.type === 'OPERATOR_ACTIVITY' && opsList) opsList.appendChild(li);
                        });
                    }
                });
            }
        });
        // --- ADMIN EDIT MODAL LOGIC ---
        let currentEditId = null;

        window.openDprEdit = function (r) {
            currentEditId = r.id;
            const modal = document.getElementById('dprEditModal');
            if (modal) modal.style.display = 'flex';

            const setVal = (id, v) => {
                const el = document.getElementById('e_' + id);
                if (el) el.value = (v !== null && v !== undefined) ? v : '';
            };

            setVal('machine', r.machine);
            setVal('product_name', r.product_name);
            setVal('mould_name', r.mould_name);
            setVal('colour', r.colour);

            setVal('act_weight', r.act_weight);
            setVal('actual_cavity', r.actual_cavity);
            setVal('shots', r.shots);

            setVal('good_qty', r.good_qty);
            setVal('reject_qty', r.reject_qty);
            setVal('downtime_min', r.downtime_min);

            setVal('supervisor', r.supervisor);
            setVal('remarks', r.remarks);
        };

        window.closeDprEdit = function () {
            document.getElementById('dprEditModal').style.display = 'none';
            currentEditId = null;
        };

        window.saveDprEdit = async function () {
            if (!currentEditId) return;
            const getVal = (id) => document.getElementById('e_' + id).value;

            const payload = {
                id: currentEditId,
                machine: getVal('machine'),
                product_name: getVal('product_name'),
                mould_name: getVal('mould_name'),
                colour: getVal('colour'),
                act_weight: (() => {
                    const v = parseFloat(getVal('act_weight'));
                    return (!isNaN(v) && v >= 10) ? (v / 1000) : getVal('act_weight');
                })(),
                actual_cavity: getVal('actual_cavity'),
                shots: getVal('shots'),
                good_qty: getVal('good_qty'),
                reject_qty: getVal('reject_qty'),
                downtime_min: getVal('downtime_min'),
                supervisor: getVal('supervisor'),
                remarks: getVal('remarks')
            };

            try {
                const res = await window.JPSMS.api.post('/api/dpr/update', payload);
                if (res.ok) {
                    alert('Entry Updated!');
                    closeDprEdit();
                    // Reload current view via click (hacky but safe)
                    const applyBtn = document.getElementById('btn-apply');
                    if (applyBtn) applyBtn.click();
                } else {
                    alert('Error: ' + res.error);
                }
            } catch (e) {
                alert('Request Failed: ' + e.message);
            }
        };