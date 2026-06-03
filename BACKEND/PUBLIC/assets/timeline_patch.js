
// TIMELINE PATCH v36 (Token Match & Debug)
// This script overrides the timeline logic and improves filtering with robust matching.

(function () {
    console.log('[TimelinePatch] Initializing v56 (Reorder Ripple + Load)...');

    // Global client plan cache with 2-minute TTL
    window._planBoardCache = {
        data: null,
        timestamp: 0,
        ttl: 120000, // 2 minutes
        process: null
    };

    // CSS Injection (Timeline + Modal Styles)
    const style = document.createElement('style');
    style.innerHTML = `
        .timeline-track::-webkit-scrollbar { height: 8px; }
        .timeline-track::-webkit-scrollbar-track { background: #f8fafc; border-radius: 4px; }
        .timeline-track::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; border: 1px solid #f8fafc; }
        .timeline-track::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        .timeline-card { transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; } 
        .timeline-card:hover { transform: translateY(-3px); z-index: 20; box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.15); }
        .timeline-card.dragging { opacity: 0.8; transform: scale(0.98); cursor: grabbing; }
        
        .blink-urgent-border { animation: blinkBorder 2s infinite; }
        @keyframes blinkBorder { 0% { border-left-color: #ef4444; } 50% { border-left-color: #fca5a5; } 100% { border-left-color: #ef4444; } }
        
        /* Filter Bar - Perfect Styling */
        .mod-filter-group {
            display: flex; align-items: center; gap: 10px; width: 100%;
            background: #fff; padding: 10px 16px;
            border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
            border: 1px solid #e2e8f0; flex-wrap: wrap;
        }
        .mod-input-wrapper {
            flex: 1; min-width: 200px; display: flex; align-items: center; 
            background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; 
            padding: 0 10px; height: 38px; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .mod-input-wrapper:focus-within { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); background: #fff; }
        .mod-input { border: none; padding: 0 8px; flex: 1; outline: none; background: transparent; font-size: 0.9rem; color: #334155; }
        .mod-input::placeholder { color: #94a3b8; }
        
        .mod-select { 
            border: 1px solid #cbd5e1; padding: 0 32px 0 12px; border-radius: 8px; 
            height: 38px; font-size: 0.9rem; color: #334155; background-color: #fff;
            cursor: pointer; transition: all 0.2s; outline: none; appearance: none;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
            background-position: right 0.5rem center; background-repeat: no-repeat; background-size: 1.5em 1.5em;
            min-width: 140px;
        }
        .mod-select:hover { border-color: #94a3b8; }
        .mod-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        
        .mod-btn-reset { 
            border: 1px solid #cbd5e1; padding: 0 16px; border-radius: 8px; height: 38px;
            background: #fff; color: #64748b; font-weight: 600; font-size: 0.9rem; cursor: pointer;
            transition: all 0.2s; display: flex; align-items: center; gap: 6px;
        }
        .mod-btn-reset:hover { background: #f1f5f9; color: #334155; border-color: #94a3b8; }
        .mod-btn-reset:active { transform: translateY(1px); }

        /* --- MODAL STYLES --- */
        .om-backdrop {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
            z-index: 9999; display: none; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.3s ease;
        }
        .om-backdrop.active { opacity: 1; pointer-events: auto; }
        
        .om-content {
            background: #fff; width: 98%; max-width: 1440px; max-height: 95vh;
            border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            display: flex; flex-direction: column; overflow: hidden;
            transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .om-backdrop.active .om-content { transform: scale(1); }

        .om-header {
            background: #0f172a; color: #fff; padding: 24px;
            text-align: center; position: relative;
            border-bottom: 5px solid #3b82f6;
        }
        .om-close {
            position: absolute; top: 16px; right: 20px;
            background: rgba(255,255,255,0.1); border: none; color: #fff;
            width: 32px; height: 32px; border-radius: 50%; font-size: 1.2rem; cursor: pointer;
            display: flex; align-items: center; justify-content: center; transition: background 0.2s;
        }
        .om-close:hover { background: rgba(255,255,255,0.2); }

        .om-body { padding: 24px; overflow-y: auto; background: #f8fafc; }
        
        .om-table-card {
            background: #fff; border-radius: 12px; border: 1px solid #e2e8f0;
            overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }
        .om-table { width: 100%; border-collapse: collapse; }
        .om-table th {
            background: #f1f5f9; color: #475569; font-weight: 700; font-size: 0.85rem;
            text-transform: uppercase; padding: 12px 16px; text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }
        .om-table td {
            padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
            font-size: 0.9rem; color: #334155; vertical-align: middle;
        }
        .om-table tr:last-child td { border-bottom: none; }
        .om-table tr:hover td { background: #f8fafc; }
        
        .om-badge {
            padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
        }
        .om-badge.running { background: #dcfce7; color: #15803d; }
        .om-badge.stopped { background: #fee2e2; color: #991b1b; }
        .om-badge.planned { background: #f1f5f9; color: #475569; }
        .om-badge.completed { background: #dbeafe; color: #1e40af; }
        .om-badge.pending { background: #fff1f2; color: #be123c; border: 1px dashed #fda4af; }

        /* ── DRILL-DOWN PANEL ── */
        .dd-panel { animation: ddSlideIn 0.22s ease; }
        @keyframes ddSlideIn { from { opacity:0; transform:translateX(18px); } to { opacity:1; transform:none; } }

        .dd-breadcrumb { display:flex; align-items:center; gap:6px; font-size:0.82rem;
            color:#64748b; padding:10px 16px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; flex-wrap:wrap; }
        .dd-breadcrumb span.sep { color:#cbd5e1; }
        .dd-breadcrumb .dd-crumb { cursor:pointer; color:#3b82f6; font-weight:600; }
        .dd-breadcrumb .dd-crumb:hover { text-decoration:underline; }
        .dd-breadcrumb .dd-crumb.active { color:#0f172a; font-weight:700; cursor:default; text-decoration:none; }

        .dd-summary-bar { display:flex; gap:0; background:#fff; border-bottom:1px solid #e2e8f0; }
        .dd-stat { flex:1; padding:10px 16px; text-align:center; border-right:1px solid #e2e8f0; }
        .dd-stat:last-child { border-right:none; }
        .dd-stat-label { font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:2px; }
        .dd-stat-val { font-size:1.15rem; font-weight:800; }

        .dd-table { width:100%; border-collapse:collapse; }
        .dd-table th { background:#f1f5f9; color:#475569; font-weight:700; font-size:0.78rem;
            text-transform:uppercase; padding:10px 14px; text-align:left; border-bottom:1px solid #e2e8f0; }
        .dd-table td { padding:10px 14px; border-bottom:1px solid #f8fafc; font-size:0.88rem; color:#334155; }
        .dd-table tr:last-child td { border-bottom:none; }
        .dd-table tr.clickable { cursor:pointer; }
        .dd-table tr.clickable:hover td { background:#eff6ff; }
        .dd-table .num { text-align:right; font-weight:700; font-variant-numeric:tabular-nums; }
        .dd-table .dim { color:#94a3b8; font-size:0.8rem; }

        .dd-colour-dot { display:inline-block; width:10px; height:10px; border-radius:50%;
            margin-right:6px; vertical-align:middle; }
        .dd-jc-link { font-family:monospace; font-weight:700; color:#2563eb; cursor:pointer;
            text-decoration:underline; text-underline-offset:2px; word-break:break-all; }
        .dd-jc-link:hover { color:#1d4ed8; }
        .dd-back-btn { display:inline-flex; align-items:center; gap:5px; padding:5px 12px;
            background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; font-size:0.82rem;
            font-weight:600; color:#475569; cursor:pointer; transition:all 0.15s; }
        .dd-back-btn:hover { background:#e2e8f0; color:#0f172a; }

        .dd-empty { text-align:center; padding:32px 16px; color:#94a3b8; font-style:italic; font-size:0.9rem; }
        .dd-loading { text-align:center; padding:32px; color:#64748b; }
    `;
    document.head.appendChild(style);

    // --- 0. Modal Logic ---
    window.createOrderModal = function () {
        if (document.getElementById('orderDetailModal')) return;
        const modal = document.createElement('div');
        modal.id = 'orderDetailModal';
        modal.className = 'om-backdrop';
        modal.innerHTML = `
            <div class="om-content">
                <div class="om-header">
                    <button class="om-close" onclick="window.closeOrderModal()">&times;</button>
                    <div id="om-product" style="font-size:1.5rem; font-weight:800; margin-bottom:4px; color:#60a5fa">Product Name</div>
                    <div id="om-client" style="font-size:1.1rem; font-weight:500; opacity:0.9; margin-bottom:8px">Client Name</div>
                    <div style="display:inline-block; background:rgba(255,255,255,0.15); padding:4px 12px; border-radius:20px; font-size:0.9rem; font-family:monospace; font-weight:700;">
                        <span style="opacity:0.6">ORDER:</span> <span id="om-orderno">#12345</span>
                    </div>
                </div>
                <!-- DRILL-DOWN AREA (replaces body when drilling in) -->
                <div id="om-dd-area" style="display:none; flex:1; overflow:hidden; display:none; flex-direction:column;">
                    <div id="om-dd-breadcrumb" class="dd-breadcrumb"></div>
                    <div id="om-dd-body" style="flex:1; overflow-y:auto; background:#f8fafc;"></div>
                </div>
                <!-- PLANS LIST (default view) -->
                <div id="om-plans-area" class="om-body">
                    <div class="om-table-card">
                        <table class="om-table">
                            <thead>
                                <tr>
                                    <th>Mould / Sub Part</th>
                                    <th>Machine</th>
                                    <th>JC Number</th>
                                    <th>Status</th>
                                    <th style="text-align:right">Plan Qty</th>
                                    <th style="text-align:right">Produced</th>
                                    <th style="text-align:right">Bal</th>
                                    <th>Schedule (Start / End / Exp)</th>
                                </tr>
                            </thead>
                            <tbody id="om-tbody">
                                <!-- Rows -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    };

    // Helper: build and render merged plan rows (used by openOrderModal)
    function _omRenderRows(mergedList, orderNo, headerProd, headerClient) {
        if (mergedList.length === 0) {
            document.getElementById('om-tbody').innerHTML =
                '<tr><td colspan="8" style="text-align:center; padding:30px;">No data found.</td></tr>';
            return;
        }
        document.getElementById('om-product').textContent = headerProd;
        document.getElementById('om-client').textContent  = headerClient;
        document.getElementById('om-orderno').textContent = orderNo;

        const fmt = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
        const esc = (s) => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        // Strip legacy "BUILDING -L{LINE}>" prefix  e.g. "E -L1>HYD-350-1" → "HYD-350-1"
        const stripMach = (s) => { const t = String(s || '').trim(); return t.includes('>') ? t.split('>').pop().trim() : t; };

        document.getElementById('om-tbody').innerHTML = mergedList.map(item => {
            const cleanMachine = stripMach(item.machine);
            const st = (item.status || 'Pending').toLowerCase();
            const isPlanned = cleanMachine && cleanMachine !== '-' && st !== 'pending';

            let badgeClass = 'pending';
            if (st === 'running') badgeClass = 'running';
            else if (st === 'stopped') badgeClass = 'stopped';
            else if (st === 'completed') badgeClass = 'completed';
            else if (st === 'planned') badgeClass = 'planned';

            let datesHtml = '<span style="color:#cbd5e1">-</span>';
            if (item._planObj) {
                const p = item._planObj;
                let start = p.startDate ? new Date(p.startDate) : null;
                let end = p.endDate ? new Date(p.endDate) : null;
                let exp = null;
                if (p._rippledStartRaw) start = p._rippledStartRaw;
                if (p._rippledEndRaw)   end   = p._rippledEndRaw;
                if (p._rippledExpRaw)   exp   = p._rippledExpRaw;
                const sStr = start ? fmt(start) : '-';
                const eStr = end   ? fmt(end)   : '-';
                const xStr = exp   ? fmt(exp)   : '-';
                if (isPlanned) {
                    datesHtml = `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:0.8rem;color:#64748b">
                        <div style="text-align:right;color:#94a3b8">Start:</div><div style="font-weight:600;color:#334155">${sStr}</div>
                        <div style="text-align:right;color:#94a3b8">End:</div><div style="font-weight:600;color:#334155">${eStr}</div>
                        ${exp ? `<div style="text-align:right;color:#2563eb;font-weight:700">Exp:</div><div style="font-weight:700;color:#2563eb">${xStr}</div>` : ''}
                    </div>`;
                }
            }

            const jc = item.jcNo || '-';
            let machDisplay = '';
            if (isPlanned && item._planObj) {
                machDisplay = `<div class="om-mach-click-badge"
                         onclick="window.openMachineSelector(event, '${item._planObj.id}', '${esc(cleanMachine)}', '${esc(item._planObj.primaryMachine || '')}', '${esc(item._planObj.secondaryMachine || '')}')"
                         style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:4px 8px; border-radius:6px; font-weight:700; transition:all 0.2s;"
                         onmouseover="this.style.background='#dbeafe'; this.style.borderColor='#3b82f6';"
                         onmouseout="this.style.background='#eff6ff'; this.style.borderColor='#bfdbfe';">
                        <span>${esc(cleanMachine)}</span>
                        <i class="bi bi-chevron-down" style="font-size:0.75rem; color:#3b82f6;"></i>
                    </div>`;
            } else if (item._planObj) {
                machDisplay = `<div class="om-mach-click-badge"
                         onclick="window.openMachineSelector(event, '${item._planObj.id}', '', '${esc(item._planObj.primaryMachine || '')}', '${esc(item._planObj.secondaryMachine || '')}')"
                         style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; background:#f8fafc; border:1px solid #cbd5e1; color:#64748b; padding:4px 8px; border-radius:6px; font-weight:500; font-style:italic; transition:all 0.2s;"
                         onmouseover="this.style.background='#f1f5f9'; this.style.borderColor='#94a3b8'; color:#475569;"
                         onmouseout="this.style.background='#f8fafc'; this.style.borderColor='#cbd5e1'; color:#64748b;">
                        <span>Unassigned</span>
                        <i class="bi bi-chevron-down" style="font-size:0.75rem; color:#94a3b8;"></i>
                    </div>`;
            } else {
                machDisplay = '<span style="color:#cbd5e1;font-style:italic">Unassigned</span>';
            }
            const jcClickable = jc && jc !== '-'
                ? `<span class="dd-jc-link" onclick="window.openJcDrilldown('${esc(jc)}','${esc(jc)}','${esc(item._planObj ? (item._planObj.planId || item._planObj.plan_id || '') : '')}','${esc(item._planObj ? (item._planObj.orderNo || '') : '')}');event.stopPropagation();" title="Click to see colour/shift/hourly drill-down">${esc(jc)} <i class="bi bi-bar-chart-line-fill" style="font-size:.75rem"></i></span>`
                : '<span style="color:#cbd5e1">—</span>';

            return `<tr>
                <td><div style="font-weight:700;color:#334155">${esc(item.mouldName || '-')}</div>
                    <div style="font-size:0.8rem;color:#64748b;font-family:monospace">${esc(item.mouldNo)}</div></td>
                <td style="font-weight:600;color:#334155">${machDisplay}</td>
                <td>${jcClickable}</td>
                <td><span class="om-badge ${badgeClass}">${esc(item.status || 'Pending')}</span></td>
                <td style="text-align:right;font-weight:700;color:#1e293b">${(item.planQty || 0).toLocaleString()}</td>
                <td style="text-align:right;font-weight:700;color:#16a34a">${(item.producedQty || 0).toLocaleString()}</td>
                <td style="text-align:right;font-weight:700;color:${item.balQty > 0 ? '#f59e0b' : '#10b981'}">${(item.balQty || 0).toLocaleString()}</td>
                <td>${datesHtml}</td>
            </tr>`;
        }).join('');
    }

    window.openOrderModal = async function (orderNo) {
        window.createOrderModal();
        const modal = document.getElementById('orderDetailModal');
        _ddShowPlans(); // make sure plans area is visible, not drill-down

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.classList.add('active');

        // ── STEP 1: Render immediately from cached allMasterPlans (0 ms wait) ──
        const allPlans   = window.allMasterPlans || [];
        const activePlans = allPlans.filter(p => p.orderNo === orderNo);

        let headerProd   = 'Product Name Not Available';
        let headerClient = 'Unknown Client';

        const mergedFromCache = activePlans.map(p => {
            if (headerProd   === 'Product Name Not Available' && p.productName) headerProd   = p.productName;
            if (headerClient === 'Unknown Client'             && p.clientName)  headerClient = p.clientName;
            return {
                isSummary: false,
                mouldName:   p.mouldName,
                mouldNo:     p.mouldNo,
                machine:     p.machine,
                jcNo:        p.jcNo || p.jc_no || p.job_card_no,
                status:      p.status,
                planQty:     p.planQty,
                balQty:      p.balQty,
                producedQty: p.producedQty,
                _planObj:    p
            };
        });

        if (mergedFromCache.length === 0) {
            document.getElementById('om-tbody').innerHTML =
                '<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8">No active plans for this order.</td></tr>';
        } else {
            _omRenderRows(mergedFromCache, orderNo, headerProd, headerClient);
        }

        // ── STEP 2: Fetch mould-planning summary in background to enrich rows ──
        // This is purely additive — it fills in mould_no / plan_qty from ERP data.
        // If it's slow or fails the user already sees all the plan data above.
        try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            // 3-second timeout so a slow API never blocks the UI
            const fetchWithTimeout = (url, ms) => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), ms);
                return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
            };
            const baseUrl = api._base || window.location.origin;
            const raw = await fetchWithTimeout(
                `${baseUrl}/api/planning/orders/${encodeURIComponent(orderNo)}/details`, 3000
            );
            if (!raw.ok) throw new Error('non-ok');
            const resJson = await raw.json();
            const summaryItems = (resJson && resJson.data) ? resJson.data : [];

            if (summaryItems.length > 0) {
                // Re-derive header from summary if better info available
                const validSummary = summaryItems.find(s => s.product_name && s.product_name !== 'null');
                if (validSummary) {
                    headerProd   = validSummary.product_name;
                    if (validSummary.client_name) headerClient = validSummary.client_name;
                }

                const enriched = summaryItems.map(s => {
                    const mouldNo = s.mould_no || s.mouldNo;
                    const ap = activePlans.find(p => (p.mouldNo || p.mould_no || '').trim() === (mouldNo || '').trim());
                    if (headerProd   === 'Product Name Not Available' && ap && ap.productName) headerProd   = ap.productName;
                    if (headerClient === 'Unknown Client'             && ap && ap.clientName)  headerClient = ap.clientName;
                    return {
                        isSummary: true,
                        mouldName:   s.mould_name || s.mouldName || (ap ? ap.mouldName : 'Unknown Mould'),
                        mouldNo,
                        machine:     ap ? ap.machine : '-',
                        jcNo:        ap ? (ap.jcNo || ap.jc_no || ap.job_card_no) : (s.jc_no || '-'),
                        status:      ap ? ap.status : 'Pending',
                        planQty:     s.plan_qty || s.qty || (ap ? ap.planQty : 0),
                        balQty:      ap ? ap.balQty : (s.plan_qty || s.qty || 0),
                        producedQty: ap ? ap.producedQty : 0,
                        _planObj:    ap
                    };
                });
                // Only update if modal is still open for this order
                if (modal.classList.contains('active') &&
                    document.getElementById('om-orderno')?.textContent === orderNo) {
                    _omRenderRows(enriched, orderNo, headerProd, headerClient);
                }
            }
        } catch (e) {
            // Timeout or network error — cached data already showing, nothing to do
            if (e.name !== 'AbortError') console.warn('[OrderModal] summary fetch failed:', e.message);
        }

        // Final: ensure header is set
        if (document.getElementById('om-product')?.textContent === 'Product Name') {
            document.getElementById('om-product').textContent = headerProd;
            document.getElementById('om-client').textContent  = headerClient;
            document.getElementById('om-orderno').textContent = orderNo;
        }
    };

    window.closeOrderModal = function () {
        const modal = document.getElementById('orderDetailModal');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => { modal.style.display = 'none'; window._ddHideDrill(); }, 300);
        }
    };

    /* ================================================================
       DRILL-DOWN LOGIC
       Level 1: Plans list (default modal view)
       Level 2: JC click → colour-wise Plan/Produce/Bal
       Level 3: Colour click → shift-wise totals
       Level 4: Shift click → hourly entries
    ================================================================ */
    window._ddState = { jcNo: '', planId: '', orderNo: '', data: null, colour: null, shift: null };
    const COLOUR_PALETTE = ['#3b82f6','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];
    let _ddColourIndex = {};

    function _ddColour(name) {
        if (!_ddColourIndex[name]) {
            const keys = Object.keys(_ddColourIndex);
            _ddColourIndex[name] = COLOUR_PALETTE[keys.length % COLOUR_PALETTE.length];
        }
        return _ddColourIndex[name];
    }

    function _ddShowPlans() {
        document.getElementById('om-plans-area').style.display = '';
        const dd = document.getElementById('om-dd-area');
        dd.style.display = 'none';
    }
    window._ddHideDrill = _ddShowPlans;

    function _ddShowDrill() {
        document.getElementById('om-plans-area').style.display = 'none';
        const dd = document.getElementById('om-dd-area');
        dd.style.display = 'flex';
        dd.style.flexDirection = 'column';
        dd.style.flex = '1';
        dd.style.overflow = 'hidden';
    }

    function _ddN(n) { return Number(n || 0).toLocaleString(); }
    function _ddMins(m) {
        const v = Number(m || 0);
        if (!v) return '–';
        const h = Math.floor(v / 60), mi = v % 60;
        return h ? `${h}h ${mi}m` : `${mi}m`;
    }
    function _ddFmtDate(d) {
        if (!d) return '–';
        try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); } catch { return d; }
    }

    function _ddBreadcrumb(levels) {
        const el = document.getElementById('om-dd-breadcrumb');
        el.innerHTML = levels.map((l, i) => {
            const isLast = i === levels.length - 1;
            return (i > 0 ? '<span class="sep">›</span>' : '') +
                `<span class="dd-crumb ${isLast ? 'active' : ''}" ${!isLast ? `onclick="(${l.fn})()"` : ''}>${l.label}</span>`;
        }).join('');
    }

    /* Level 2: Colour-wise breakdown */
    window.openJcDrilldown = async function (jcLabel, jcNo, planId, orderNo) {
        _ddColourIndex = {};
        window._ddState = { jcNo: jcNo || jcLabel, planId, orderNo, data: null, colour: null, shift: null };
        _ddShowDrill();
        const body = document.getElementById('om-dd-body');
        body.innerHTML = `<div class="dd-loading"><i class="bi bi-arrow-repeat spin"></i> Loading production data…</div>`;
        _ddBreadcrumb([
            { label: '← All Plans', fn: 'window._ddHideDrill' },
            { label: `JC: ${jcLabel}`, fn: '' }
        ]);

        try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            const qs = new URLSearchParams();
            if (planId) qs.set('planId', planId);
            if (orderNo) qs.set('orderNo', orderNo);
            const res = await api.get('/dpr/plan-drilldown?' + qs.toString());
            if (!res || !res.ok) throw new Error(res?.error || 'Failed');
            window._ddState.data = res.data;
            _ddRenderColours(res.data);
        } catch (e) {
            body.innerHTML = `<div class="dd-empty">Error: ${e.message}</div>`;
        }
    };

    function _ddRenderColours(data) {
        const body = document.getElementById('om-dd-body');
        const { colours = [], planQty = 0, producedQty = 0, balQty = 0, totalReject = 0, mouldName = '' } = data;
        const jcLabel = window._ddState.jcNo;

        _ddBreadcrumb([
            { label: '← All Plans', fn: 'window._ddHideDrill' },
            { label: `JC: ${jcLabel}`, fn: '' }
        ]);

        let colourRows = '';
        if (colours.length === 0) {
            colourRows = `<tr><td colspan="5" class="dd-empty">No production entries found for this plan.</td></tr>`;
        } else {
            // Store colour names in a lookup so onclick uses an index — no string escaping needed
            window._ddColourLookup = colours.map(c => c.colour);
            colourRows = colours.map((c, i) => {
                const dotColor = _ddColour(c.colour);
                const pct = c.planQty > 0 ? Math.round((c.producedQty / c.planQty) * 100) : (c.producedQty > 0 ? 100 : 0);
                const bar = c.planQty > 0
                    ? `<div style="background:#e2e8f0;border-radius:3px;height:4px;margin-top:4px;overflow:hidden"><div style="width:${Math.min(pct,100)}%;height:4px;background:${dotColor};border-radius:3px"></div></div>`
                    : '';
                return `<tr class="clickable" data-cidx="${i}">
                    <td>
                        <span class="dd-colour-dot" style="background:${dotColor}"></span>
                        <strong>${c.colour}</strong>
                    </td>
                    <td class="num">${_ddN(c.planQty)}</td>
                    <td class="num" style="color:#16a34a">${_ddN(c.producedQty)}${bar}</td>
                    <td class="num" style="color:${c.balQty > 0 ? '#f59e0b' : '#10b981'}">${_ddN(c.balQty)}</td>
                    <td class="num dim">${pct}%</td>
                </tr>`;
            }).join('');
        }

        body.innerHTML = `<div class="dd-panel">
            <div class="dd-summary-bar">
                <div class="dd-stat"><div class="dd-stat-label">Plan Qty</div><div class="dd-stat-val" style="color:#1e293b">${_ddN(planQty)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Produced</div><div class="dd-stat-val" style="color:#16a34a">${_ddN(producedQty)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Balance</div><div class="dd-stat-val" style="color:#f59e0b">${_ddN(balQty)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Rejection</div><div class="dd-stat-val" style="color:#ef4444">${_ddN(totalReject)}</div></div>
            </div>
            <div style="padding:16px">
                <div style="font-size:0.8rem;color:#64748b;margin-bottom:8px;font-weight:600">
                    <i class="bi bi-palette-fill" style="color:#8b5cf6;margin-right:4px"></i>
                    Click on a colour to see shift-wise breakdown
                </div>
                <div class="om-table-card">
                    <table class="dd-table">
                        <thead><tr>
                            <th>Colour</th><th class="num">Plan Qty</th>
                            <th class="num">Produced</th><th class="num">Balance</th><th class="num">%</th>
                        </tr></thead>
                        <tbody>${colourRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
        // Wire up colour row clicks via event delegation (avoids inline JS with user data)
        body.querySelectorAll('tr[data-cidx]').forEach(tr => {
            tr.addEventListener('click', () => {
                const idx = Number(tr.dataset.cidx);
                const col = (window._ddColourLookup || [])[idx];
                if (col !== undefined) window._ddOpenShifts(col);
            });
        });
    }

    /* Level 3: Shift-wise totals for a colour */
    window._ddOpenShifts = function (colourName) {
        const data = window._ddState.data;
        if (!data) return;
        window._ddState.colour = colourName;
        const jcLabel = window._ddState.jcNo;
        const colourData = data.colours.find(c => c.colour === colourName);
        if (!colourData) return;

        _ddBreadcrumb([
            { label: '← All Plans',      fn: 'window._ddHideDrill' },
            { label: `JC: ${jcLabel}`,   fn: 'window._ddBackToColours' },
            { label: colourName,          fn: '' }
        ]);

        const { shifts = [] } = colourData;
        const dotColor = _ddColour(colourName);
        let shiftRows = '';

        if (shifts.length === 0) {
            shiftRows = `<tr><td colspan="5" class="dd-empty">No shift entries found.</td></tr>`;
        } else {
            shiftRows = shifts.map(s => {
                const shiftKey = `${s.shift}||${s.date}`;
                const dayNight = s.shift === 'Day'
                    ? `<span style="color:#f59e0b;font-weight:700">☀ Day</span>`
                    : `<span style="color:#6366f1;font-weight:700">🌙 Night</span>`;
                return `<tr class="clickable" data-shift="${s.shift}" data-date="${s.date}">
                    <td>${dayNight}</td>
                    <td>${_ddFmtDate(s.date)}</td>
                    <td class="num" style="color:#16a34a"><strong>${_ddN(s.goodQty)}</strong></td>
                    <td class="num" style="color:#ef4444">${_ddN(s.rejectQty)}</td>
                    <td class="num dim">${_ddMins(s.downtimeMin)}</td>
                </tr>`;
            }).join('');
        }

        const totalGood = shifts.reduce((s, r) => s + r.goodQty, 0);
        const totalRej  = shifts.reduce((s, r) => s + r.rejectQty, 0);
        const totalDt   = shifts.reduce((s, r) => s + r.downtimeMin, 0);

        const body = document.getElementById('om-dd-body');
        body.innerHTML = `<div class="dd-panel">
            <div class="dd-summary-bar">
                <div class="dd-stat">
                    <div class="dd-stat-label"><span class="dd-colour-dot" style="background:${dotColor}"></span>${colourName}</div>
                    <div class="dd-stat-val" style="color:#1e293b">${shifts.length} shift(s)</div>
                </div>
                <div class="dd-stat"><div class="dd-stat-label">Total Produced</div><div class="dd-stat-val" style="color:#16a34a">${_ddN(totalGood)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Total Reject</div><div class="dd-stat-val" style="color:#ef4444">${_ddN(totalRej)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Total Downtime</div><div class="dd-stat-val" style="color:#64748b">${_ddMins(totalDt)}</div></div>
            </div>
            <div style="padding:16px">
                <div style="font-size:0.8rem;color:#64748b;margin-bottom:8px;font-weight:600">
                    <i class="bi bi-calendar2-week-fill" style="color:#3b82f6;margin-right:4px"></i>
                    Click on a shift to see hourly entries
                </div>
                <div class="om-table-card">
                    <table class="dd-table">
                        <thead><tr>
                            <th>Shift</th><th>Date</th>
                            <th class="num">Good Qty</th><th class="num">Reject</th><th class="num">Downtime</th>
                        </tr></thead>
                        <tbody>${shiftRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
        // Wire up shift row clicks via event delegation (data-shift and data-date are safe enum/date strings)
        const _cn = colourName; // captured in closure — never put user data in inline onclick
        body.querySelectorAll('tr[data-shift]').forEach(tr => {
            tr.addEventListener('click', () => window._ddOpenHourly(_cn, tr.dataset.shift, tr.dataset.date));
        });
    };
    window._ddBackToColours = function () { _ddRenderColours(window._ddState.data); };

    /* Level 4: Hourly entries for a colour + shift + date */
    window._ddOpenHourly = function (colourName, shift, date) {
        const data = window._ddState.data;
        if (!data) return;
        window._ddState.shift = { shift, date };
        const jcLabel = window._ddState.jcNo;
        const colourData = data.colours.find(c => c.colour === colourName);
        if (!colourData) return;
        const shiftData = colourData.shifts.find(s => s.shift === shift && s.date === date);
        if (!shiftData) return;

        _ddBreadcrumb([
            { label: '← All Plans',    fn: 'window._ddHideDrill' },
            { label: `JC: ${jcLabel}`, fn: 'window._ddBackToColours' },
            { label: colourName,       fn: `window._ddOpenShifts(window._ddState.colour)` },
            { label: `${shift} – ${_ddFmtDate(date)}`, fn: '' }
        ]);

        const entries = shiftData.entries || [];
        const dotColor = _ddColour(colourName);
        const dayNight = shift === 'Day'
            ? `<span style="color:#f59e0b;font-weight:700">☀ Day Shift</span>`
            : `<span style="color:#6366f1;font-weight:700">🌙 Night Shift</span>`;

        let rows = '';
        if (entries.length === 0) {
            rows = `<tr><td colspan="6" class="dd-empty">No hourly entries found.</td></tr>`;
        } else {
            rows = entries.map(e => {
                const timeStr = e.createdAt
                    ? new Date(e.createdAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
                    : '–';
                const etBadge = e.entryType && e.entryType !== 'MAIN'
                    ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;margin-left:4px">${e.entryType}</span>`
                    : '';
                return `<tr>
                    <td><strong style="font-family:monospace">${e.hourSlot || '–'}</strong></td>
                    <td class="num" style="color:#16a34a;font-size:1rem"><strong>${_ddN(e.goodQty)}</strong></td>
                    <td class="num" style="color:#ef4444">${_ddN(e.rejectQty)}</td>
                    <td class="num dim">${_ddMins(e.downtimeMin)}</td>
                    <td style="font-size:0.82rem">${e.enteredBy || '–'}${etBadge}<br><span class="dim">${timeStr}</span></td>
                    <td style="font-size:0.8rem;color:#64748b;max-width:160px;word-wrap:break-word">${e.remarks || '–'}</td>
                </tr>`;
            }).join('');
        }

        const totalG = entries.reduce((s, e) => s + e.goodQty, 0);
        const totalR = entries.reduce((s, e) => s + e.rejectQty, 0);
        const totalD = entries.reduce((s, e) => s + e.downtimeMin, 0);

        const body = document.getElementById('om-dd-body');
        body.innerHTML = `<div class="dd-panel">
            <div class="dd-summary-bar">
                <div class="dd-stat">
                    <div class="dd-stat-label"><span class="dd-colour-dot" style="background:${dotColor}"></span>${colourName} · ${dayNight}</div>
                    <div class="dd-stat-val" style="color:#1e293b">${entries.length} hour slot(s)</div>
                </div>
                <div class="dd-stat"><div class="dd-stat-label">Total Good</div><div class="dd-stat-val" style="color:#16a34a">${_ddN(totalG)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Total Reject</div><div class="dd-stat-val" style="color:#ef4444">${_ddN(totalR)}</div></div>
                <div class="dd-stat"><div class="dd-stat-label">Downtime</div><div class="dd-stat-val" style="color:#64748b">${_ddMins(totalD)}</div></div>
            </div>
            <div style="padding:16px">
                <div style="font-size:0.8rem;color:#64748b;margin-bottom:8px;font-weight:600">
                    <i class="bi bi-clock-history" style="color:#10b981;margin-right:4px"></i>
                    Hourly entries for ${colourName} — ${shift} Shift, ${_ddFmtDate(date)}
                </div>
                <div class="om-table-card">
                    <table class="dd-table">
                        <thead><tr>
                            <th>Hour Slot</th><th class="num">Good Qty</th>
                            <th class="num">Reject</th><th class="num">Downtime</th>
                            <th>Entered By</th><th>Remarks</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    };

    // --- Helper for Actions (v55) ---
    window._tlMap = {};
    window._tlComplete = function (id) {
        const p = window._tlMap[id];
        if (!p) return alert('Plan data missing');
        if (window.openCompletePlanModal) window.openCompletePlanModal(id, JSON.stringify(p));
        else alert('Complete Modal not found');
    };

    window._tlStart = async function (id) {
        if (!confirm('Start this plan now?')) return;
        try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            const res = await api.post('/planning/run', { rowId: id });
            if (res && res.ok) {
                if (window.JPSMS && window.JPSMS.toast) window.JPSMS.toast('Plan started successfully!', 'success');
                if (typeof loadTimeline === 'function') loadTimeline();
                else if (typeof window.superLoadTimeline === 'function') window.superLoadTimeline();
            } else {
                alert(res?.error || 'Failed to start plan');
            }
        } catch (e) {
            console.error(e);
            alert('Error starting plan: ' + e.message);
        }
    };

    // --- 1. Render Logic (Renamed v53 - Forecast Support) ---
    window.superRenderTimelineRows = function (machines, cutoffTime) {
        window._tlMap = {}; // Reset Cache
        const con = document.getElementById('timelineContainer');
        con.style.cssText = 'display:flex; flex-direction:column; gap:12px; background:#f1f5f9; padding:8px 4px; margin-bottom:80px;';

        if (!machines || machines.length === 0) {
            con.innerHTML = '<div class="text-muted p-4 text-center" style="background:#fff; border-radius:8px; border:1px dashed #cbd5e1;">No machines match criteria</div>';
            return;
        }

        const compareMachineSeriesCodes = (codeA, codeB) => {
            const a = String(codeA || '').trim();
            const b = String(codeB || '').trim();
            const numsA = (a.match(/\d+/g) || []).map(Number);
            const numsB = (b.match(/\d+/g) || []).map(Number);
            const machineNoA = numsA.length ? numsA[numsA.length - 1] : Number.MAX_SAFE_INTEGER;
            const machineNoB = numsB.length ? numsB[numsB.length - 1] : Number.MAX_SAFE_INTEGER;

            if (machineNoA !== machineNoB) return machineNoA - machineNoB;

            const prefixA = numsA.slice(0, -1);
            const prefixB = numsB.slice(0, -1);
            const sharedLength = Math.min(prefixA.length, prefixB.length);

            for (let i = 0; i < sharedLength; i++) {
                if (prefixA[i] !== prefixB[i]) return prefixA[i] - prefixB[i];
            }

            if (prefixA.length !== prefixB.length) return prefixA.length - prefixB.length;

            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        };

        // Sort Machines
        machines.sort((a, b) => {
            const buildingA = String(a._finalBuilding || a.building || '').trim().toUpperCase();
            const buildingB = String(b._finalBuilding || b.building || '').trim().toUpperCase();
            if (buildingA !== buildingB) return buildingA.localeCompare(buildingB, undefined, { numeric: true, sensitivity: 'base' });

            const lineA = String(a._finalLine || a.line || '').trim().toUpperCase();
            const lineB = String(b._finalLine || b.line || '').trim().toUpperCase();
            if (lineA !== lineB) return lineA.localeCompare(lineB, undefined, { numeric: true, sensitivity: 'base' });

            return compareMachineSeriesCodes(a.code, b.code);
        });

        machines.forEach(m => {
            let mPlans = window.timelineGroups[m.code] || [];
            mPlans.forEach(p => window._tlMap[p.id] = p);

            // --- FORECAST CLIP ---
            if (cutoffTime) {
                // Show plans that start before the cutoff.
                // Note: We keep "Running" plans even if they started long ago, because they are active now.
                // We basically just chop off the "Future" beyond the window.
                mPlans = mPlans.filter(p => {
                    const startInfo = p._rippledStartRaw ? p._rippledStartRaw.getTime() : 0;
                    return startInfo < cutoffTime; // Keep if it starts before the limit
                });
            }

            mPlans.sort((a, b) => {
                const isRunA = (a.status || '').toLowerCase() === 'running';
                const isRunB = (b.status || '').toLowerCase() === 'running';
                if (isRunA && !isRunB) return -1;
                if (!isRunA && isRunB) return 1;
                const seqDiff = (Number(a.seq || 0) - Number(b.seq || 0));
                if (seqDiff) return seqDiff;
                const startA = a.startDate ? new Date(a.startDate).getTime() : 0;
                const startB = b.startDate ? new Date(b.startDate).getTime() : 0;
                if (startA !== startB) return startA - startB;
                return Number(a.id || 0) - Number(b.id || 0);
            });

            window.timelineGroups[m.code] = mPlans;

            const formatLoadDuration = (ms) => {
                if (!Number.isFinite(ms) || ms <= 0) return '0m';
                const d = Math.floor(ms / 86400000);
                const h = Math.floor((ms % 86400000) / 3600000);
                const mi = Math.floor((ms % 3600000) / 60000);
                if (d > 0) return `${d}d ${h}h`;
                if (h > 0) return `${h}h ${mi}m`;
                return `${Math.max(1, mi)}m`;
            };

            const totalLoadMs = mPlans.reduce((sum, p) => {
                const start = p._rippledStartRaw ? p._rippledStartRaw.getTime() : NaN;
                const end = p._rippledEndRaw ? p._rippledEndRaw.getTime() : NaN;
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
                return sum + (end - start);
            }, 0);

            // ROW
            const row = document.createElement('div');
            row.className = 'timeline-row';
            row.style.background = '#fff';
            row.style.borderRadius = '8px';
            row.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
            row.style.border = '1px solid #e2e8f0';
            row.style.overflow = 'hidden';
            row.style.display = 'flex';
            row.style.alignItems = 'stretch';
            row.style.minHeight = '150px';

            const cardsHtml = mPlans.map((p, idx) => {
                const st = (p.status || '').toLowerCase();
                let leftBorder = '#94a3b8'; let bgTag = '#f1f5f9'; let txtTag = '#475569';
                if (st === 'running') { leftBorder = '#16a34a'; bgTag = '#dcfce7'; txtTag = '#15803d'; }
                else if (st === 'stopped') { leftBorder = '#ef4444'; bgTag = '#fee2e2'; txtTag = '#991b1b'; }
                else if (st === 'completed') { leftBorder = '#3b82f6'; bgTag = '#dbeafe'; txtTag = '#1e40af'; }

                let isMouldChange = idx > 0 && ((p.mouldNo || '') !== (mPlans[idx - 1].mouldNo || ''));
                let isUrgentChange = isMouldChange && p._rippledStartRaw && ((p._rippledStartRaw.getTime() - Date.now()) < 7200000 && (p._rippledStartRaw.getTime() - Date.now()) > 0);

                let timeBadge = '';
                if (idx === 0 && p._rippledEndRaw) {
                    let msDiff = 0; let label = ''; let col = '#4f46e5';
                    if (st === 'running') {
                        msDiff = p._rippledEndRaw.getTime() - Date.now(); col = '#16a34a';
                        if (msDiff < 0) { msDiff = Math.abs(msDiff); col = '#ef4444'; label = 'OD '; }
                    } else {
                        if (p._rippledStartRaw) msDiff = p._rippledEndRaw.getTime() - p._rippledStartRaw.getTime();
                        col = '#3b82f6';
                    }
                    if (msDiff > 0 || label) {
                        const d = Math.floor(msDiff / 86400000), h = Math.floor((msDiff % 86400000) / 3600000), mi = Math.floor((msDiff % 3600000) / 60000);
                        if (d > 0) label += `${d}d ${h}h`; else if (h > 0) label += `${h}h ${mi}m`; else label += `${mi}m`;
                        timeBadge = `<div style="margin-top:auto; padding-top:4px; border-top:1px dashed #e2e8f0; display:flex; align-items:center; justify-content:center; gap:4px; color:${col}; font-weight:800; font-size:0.8rem;"><i class="bi bi-clock-fill" style="font-size:0.75rem"></i> ${label}</div>`;
                    }
                }

                const fmt = (d) => d ? d.toLocaleString('en-GB', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
                const startStr = fmt(p._rippledStartRaw);
                const endStr = fmt(p._rippledEndRaw);
                const expStr = fmt(p._rippledExpRaw);

                const jcNo = p.jcNo || p.jc_no || p.job_card_no || p.jc_id || '';
                const formatNum = (n) => (n || 0).toLocaleString();
                const esc = (s) => (s || '').toString().replace(/&/g, '&amp;');
                const cardBg = isMouldChange ? '#fff7ed' : '#ffffff';
                const cardBorder = isMouldChange ? '#fdba74' : '#e2e8f0';

                return `
                   <div class="timeline-card ${isUrgentChange ? 'blink-urgent-border' : ''}" 
                        draggable="true"
                        data-pid="${p.id}"
                        data-machine="${m.code}"
                        data-primary-machine="${esc(p.primaryMachine || '')}"
                        data-secondary-machine="${esc(p.secondaryMachine || '')}"
                        ondragstart="window.handleDragStart(event, this)"
                        ondragend="window.handleDragEnd(event, this)"
                        onclick="window.openOrderModal('${esc(p.orderNo)}')"
                        style="
                           min-width: 225px; width: 225px; flex-shrink: 0;
                           background: ${cardBg};
                           border: 1px solid ${cardBorder};
                           border-radius: 6px;
                           border-left: 5px solid ${leftBorder}; 
                           padding: 8px;
                           display: flex; flex-direction: column; gap: 4px;
                           position: relative; height: auto; 
                        ">
                       <div style="display:flex; justify-content:space-between; align-items:start;">
                          <div style="font-weight:800; color:#0f172a; font-size:0.9rem; line-height:1.1">${esc(p.orderNo || '-')}</div>
                          <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; background:${bgTag}; color:${txtTag}; padding:2px 5px; border-radius:4px; white-space:nowrap">${st}</div>
                       </div>
                       
                       <div style="font-size:0.8rem; color:#64748b; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis" title="${esc(p.clientName)}">
                          ${esc(p.clientName || 'Unknown')}
                       </div>

                       <div style="background:#f8fafc; border:1px solid #f1f5f9; border-radius:6px; padding:6px;">
                           <div style="font-weight:700; color:#334155; font-size:0.85rem; line-height:1.2; word-wrap:break-word; white-space:normal;" title="${esc(p.mouldName)}">${esc(p.mouldName)}</div>
                           <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
                              <span style="font-family:monospace; font-size:0.8rem; color:#475569; font-weight:700;">${esc(p.mouldNo)}</span>
                              ${isMouldChange ? `<span style="font-size:0.65rem; font-weight:800; color:#c2410c; background:#ffedd5; padding:1px 5px; border-radius:3px;">CHG</span>` : ''}
                           </div>
                       </div>

                       <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:0.8rem; color:#64748b; padding-bottom:4px; border-bottom:1px solid #f1f5f9;">
                          <div>Qty: <strong style="color:#1e293b">${formatNum(p.planQty)}</strong></div>
                          <div>Bal: <strong style="color:${p.balQty > 0 ? '#f59e0b' : '#10b981'}">${formatNum(p.balQty)}</strong></div>
                          ${jcNo ? `<div style="grid-column:1/-1;" onclick="window.openJcDrilldown('${esc(jcNo)}','${esc(jcNo)}','${esc(p.planId||p.plan_id||'')}','${esc(p.orderNo||'')}'); event.stopPropagation();">JC: <span class="dd-jc-link" style="font-size:0.78rem">${esc(jcNo)} <i class="bi bi-bar-chart-line-fill" style="font-size:0.68rem"></i></span></div>` : ''}
                       </div>

                       <div style="display:grid; grid-template-columns:auto 1fr; gap:0px 6px; font-size:0.75rem; color:#64748b;">
                           <div style="color:#94a3b8; text-align:right">Start Date:</div> <div style="font-weight:600; color:#334155">${startStr}</div>
                           <div style="color:#94a3b8; text-align:right">End Date:</div> <div style="font-weight:600; color:#334155">${endStr}</div>
                           <div style="color:#2563eb; text-align:right; font-weight:700">Exp. Date:</div> <div style="font-weight:700; color:#2563eb">${expStr}</div>
                       </div>
                       ${timeBadge}

                       <!-- ACTIONS FOOTER -->
                       <div style="margin-top:auto; padding-top:6px; border-top:1px dashed #e2e8f0; display:flex; justify-content:space-between; align-items:center">
                           <label style="font-size:0.75rem; color:#64748b; display:flex; align-items:center; gap:4px; cursor:pointer;" onclick="event.stopPropagation()">
                               <input type="checkbox" ${p.job_card_given ? 'checked' : ''} 
                                   onclick="window.updateJCStatus('${p.id}', this.checked); event.stopPropagation();"
                                   style="cursor:pointer; width:14px; height:14px;">
                               JC Given
                           </label>
                           
                           <div style="display:flex; gap:6px;">
                               ${st !== 'running' && st !== 'completed' ? `
                               <button class="btn icon mini" 
                                   onclick="window._tlStart('${p.id}'); event.stopPropagation();"
                                   title="Start Plan"
                                   style="background:#eff6ff; color:#3b82f6; border:1px solid #bfdbfe; width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:4px; cursor:pointer;">
                                   <i class="bi bi-play-fill" style="font-size:1.2rem; margin-left:2px;"></i>
                               </button>
                               ` : ''}
                               <button class="btn icon mini" 
                                   onclick="window._tlComplete('${p.id}'); event.stopPropagation();"
                                   title="Complete Plan"
                                   style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:4px; cursor:pointer;">
                                   <i class="bi bi-check-lg" style="font-size:1rem; font-weight:bold"></i>
                               </button>
                           </div>
                       </div>
                   </div>`;
            }).join('');

            const emptyHtml = mPlans.length === 0 ? '<div style="padding:20px; color:#cbd5e1; font-style:italic; font-size:0.9rem; align-self:center">No active plans in window</div>' : '';

            // V41: SIMPLIFIED RENDER
            const building = m._finalBuilding || '?';
            const line = m._finalLine || '?';

            const displayName = m.code.includes('>') ? m.code.split('>').pop().trim() : m.code;
            const match = m.code.match(/(\d+)$/);
            const machNum = match ? match[1] : m.code.slice(-2).replace(/\D/g, '');

            row.innerHTML = `
                 <div class="timeline-header" style="
                     background: #0f172a; color: white;
                     min-width: 110px; width: 110px;
                     display: flex; flex-direction: column; align-items: center; justify-content: center; 
                     text-align: center; gap: 4px; border-right: 4px solid #3b82f6; padding: 12px 6px;
                     flex-shrink: 0;
                 ">
                     <div style="font-size: 2.2rem; font-weight: 800; line-height: 1; color: #60a5fa;">${machNum}</div>
                     <div style="font-size: 0.95rem; font-weight: 700; color: #fff; line-height:1.1; word-wrap:break-word; max-width:100%">${displayName}</div>
                     <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">${line} • ${building}</div>
                     <div style="margin-top:4px; font-size: 0.7rem; font-weight: 800; color: #0f172a; background: #e2e8f0; padding: 2px 8px; border-radius: 12px;">${mPlans.length} PLANS</div>
                     <div style="font-size: 0.68rem; font-weight: 900; color: #075985; background: #e0f2fe; border:1px solid #7dd3fc; padding: 2px 8px; border-radius: 12px;">LOAD ${formatLoadDuration(totalLoadMs)}</div>
                 </div>

                 <div class="timeline-track" 
                      data-machine="${m.code}" 
                      style="display: flex; gap: 10px; overflow-x: auto; padding: 10px; align-items: stretch; background: #f8fafc; flex:1;"
                      ondragover="window.handleDragOver(event, this)" 
                      ondragleave="window.handleDragLeave(event, this)" 
                      ondrop="window.handleDrop(event, this)">
                     ${cardsHtml} ${emptyHtml}
                 </div>
               `;
            con.appendChild(row);
        });
    };

    // --- 2. Load Function ---
    // --- 2. Load Function (Renamed v50 - Super Isolation) ---
    window.superLoadTimeline = async function () {
        const con = document.getElementById('timelineContainer');
        const currentProcess = (typeof window.getPlanningProcessFilter === 'function')
            ? window.getPlanningProcessFilter()
            : 'Moulding';

        let stickyHeader = document.getElementById('timelineFilters');
        if (!stickyHeader) {
            stickyHeader = document.createElement('div'); stickyHeader.id = 'timelineFilters';
            stickyHeader.style.cssText = `position: sticky; top: 0; z-index: 100; margin: 0 0 10px 0; padding: 10px 0; background:#f1f5f9; box-shadow:0 4px 6px -4px rgba(0,0,0,0.05);`;
            stickyHeader.innerHTML = `
                <div class="mod-filter-group" style="width:100%">
                    <div class="mod-input-wrapper">
                        <i class="bi bi-search" style="color:#64748b; font-size:1rem; margin-right:8px;"></i>
                        <input type="text" id="filt-search" class="mod-input" placeholder="Search Machine, Order No, Mould, Client, JC..." onkeyup="window.superFilterTimeline()">
                    </div>
                    <div id="filt-process" style="display:flex; gap:8px; flex-wrap:wrap; min-width:340px;"></div>
                    <select id="filt-bldg" class="mod-select" onchange="window.superUpdateLineOptions()"><option value="">All Buildings</option></select>
                    <select id="filt-line" class="mod-select" onchange="window.superFilterTimeline()"><option value="">All Lines</option></select>
                    <select id="filt-status" class="mod-select" onchange="window.superFilterTimeline()">
                        <option value="">All Statuses</option>
                        <option value="Running">Running</option>
                        <option value="Stopped">Stopped</option>
                        <option value="Planned">Planned</option>
                        <option value="MouldChange">Mould Changed</option>
                    </select>
                    <select id="filt-forecast" class="mod-select" onchange="window.superFilterTimeline()" style="border-color:#f59e0b; color:#b45309; font-weight:700">
                         <option value="">Forecast: Off</option>
                         <option value="24">Next 24 Hours</option>
                         <option value="48">Next 48 Hours</option>
                         <option value="72">Next 72 Hours</option>
                    </select>

                    <button class="mod-btn-reset" onclick="window.switchView(null)" title="Dashboard" style="margin-right:4px">
                        <i class="bi bi-grid-1x2" style="font-size:1.1rem"></i>
                    </button>

                    <button class="mod-btn-reset" onclick="window.superResetTimelineFilters()" title="Reset Filters">
                        <i class="bi bi-arrow-counterclockwise" style="font-size:1.1rem"></i>
                    </button>

                    <div id="filter-count" style="margin-left:auto; font-weight:700; color:#475569; font-size:0.9rem; background:#e2e8f0; padding:6px 14px; border-radius:20px;"></div>
                </div>`;
            if (con.parentNode) con.parentNode.insertBefore(stickyHeader, con);
        }

        const processFilter = document.getElementById('filt-process');
        if (processFilter) {
            processFilter.innerHTML = ['Moulding', 'Printing', 'Tuffting'].map(option => {
                const isActive = option === currentProcess;
                const style = isActive
                    ? 'background:linear-gradient(135deg,#0f8ea8,#024c81); color:#fff; border-color:transparent; box-shadow:0 12px 24px rgba(2,76,129,0.2);'
                    : 'background:#fff; color:#0f172a; border-color:rgba(148,163,184,0.35); box-shadow:0 8px 18px rgba(15,23,42,0.08);';
                return `<button type="button" data-process-option="${option}" style="min-width:104px; padding:12px 16px; border-radius:16px; border:1px solid; font-size:0.92rem; font-weight:800; ${style}">${option}</button>`;
            }).join('');
            Array.from(processFilter.querySelectorAll('[data-process-option]')).forEach(btn => {
                btn.onclick = () => window.setPlanningProcessFilter && window.setPlanningProcessFilter(btn.dataset.processOption);
            });
        }

        con.innerHTML = '<div style="padding:60px; text-align:center; color:#64748b"><div class="spinner-border text-primary spinner-border-sm"></div><div class="mt-2" style="font-size:0.9rem">Loading...</div></div>';
        try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            
            // Dynamic cache invalidation wrapper for mutations
            if (api && typeof api.post === 'function' && !api.post._isCacheWrapped) {
                const originalPost = api.post;
                api.post = async function(url, ...args) {
                    if (url.includes('/planning/') || url.includes('/sync/')) {
                        console.log('[Cache] Plans updated via post. Invalidating timeline cache...', url);
                        window._planBoardCache.data = null;
                        window._planBoardCache.timestamp = 0;
                    }
                    return originalPost.call(this, url, ...args);
                };
                api.post._isCacheWrapped = true;
            }

            const processQuery = `process=${encodeURIComponent(currentProcess)}`;
            
            // Serve from 2-minute client memory cache if valid
            const now = Date.now();
            let pRes;
            if (window._planBoardCache.data && 
                window._planBoardCache.process === currentProcess && 
                (now - window._planBoardCache.timestamp) < window._planBoardCache.ttl) {
                console.log('[Cache] Served timeline plan board from 2-minute memory cache.');
                pRes = window._planBoardCache.data;
            } else {
                console.log('[Cache] Plan board cache miss. Fetching fresh data...');
                pRes = await api.get(`/planning/board?${processQuery}`);
                window._planBoardCache.data = pRes;
                window._planBoardCache.timestamp = now;
                window._planBoardCache.process = currentProcess;
            }

            const mRes = await api.get(`/masters/machines?${processQuery}`);
            window.allMachines = ((mRes && mRes.data) ? mRes.data : []).map(machine => ({
                code: machine.machine,
                name: machine.machine,
                building: machine.building || machine.machine_process || currentProcess,
                line: machine.line || (machine.machine_process === 'Moulding' ? '1' : 'Machines'),
                machine_process: machine.machine_process || currentProcess,
                is_active: machine.is_active !== false,
                status: machine.is_active === false ? 'off' : 'stopped'
            }));
            let plans = (pRes && pRes.data && pRes.data.plans) ? pRes.data.plans : [];

            // --- UNIFIED INFERENCE HELPER (v47) ---
            const simplify = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const inferInfo = (rawCode) => {
                const parts = rawCode.split('>');
                const prefix = parts.length > 0 ? parts.join('>').trim() : '';
                let b = null, l = null;

                // 1. Analyze Prefix (e.g. "B - L1")
                if (prefix) {
                    const chunks = prefix.split(/[- >]+/); // Split by dash, space, or >
                    // Building: Single Letter A-F at start
                    if (chunks.length > 0 && ['A', 'B', 'C', 'D', 'E', 'F'].includes(chunks[0].toUpperCase())) {
                        b = chunks[0].toUpperCase();
                    }
                    // Line: Look for "L1", "Line1", "L-1"
                    // Strict Regex: Word Boundary, L, Optional Dash/Space, Digits, End Word
                    const lMatch = prefix.match(/\bL[-\s]?(\d+)\b/i) || prefix.match(/\bLine[-\s]?(\d+)\b/i);
                    if (lMatch) l = 'L' + lMatch[1];
                }

                // 2. Fallback
                const cleanName = parts.length > 1 ? parts.pop().trim() : rawCode;
                if (!b && /^[A-F][- ]/.test(rawCode)) b = rawCode.charAt(0).toUpperCase();

                return { b, l };
            };

            // --- STEP A: HEAL ---
            const mapCodeToInfo = {};
            window.allMachines.forEach(m => { mapCodeToInfo[m.code] = m; });

            const resolveMachineCode = (rawCode) => {
                const raw = String(rawCode || '').trim();
                if (!raw) return '';

                const parts = raw.split('>');
                const machineName = parts.length > 1 ? parts.pop().trim() : raw;
                const simpleRaw = simplify(raw);
                const simpleMachine = simplify(machineName);

                for (const key of Object.keys(mapCodeToInfo)) {
                    const simpleKey = simplify(key);
                    if (!simpleKey) continue;
                    if (simpleKey === simpleRaw || simpleKey === simpleMachine) return key;
                    if (simpleKey.length > 3 && simpleMachine.length > 3 && (simpleKey.includes(simpleMachine) || simpleMachine.includes(simpleKey))) {
                        return key;
                    }
                }

                return '';
            };

            plans.forEach(p => {
                if (!p.machine || p.machine === '-') return;
                const raw = p.machine;
                const parts = raw.split('>');
                const machineName = parts.length > 1 ? parts.pop().trim() : raw;
                const simpleM = simplify(machineName);

                const resolvedCode = resolveMachineCode(raw);
                const known = resolvedCode ? mapCodeToInfo[resolvedCode] : null;
                const inferred = inferInfo(raw);
                if (known) {
                    if ((!known.building || known.building === '?' || known.building === 'null') && inferred.b) known.building = inferred.b;
                    if ((!known.line || known.line === '?' || known.line === 'null') && inferred.l) known.line = inferred.l;
                    p._timelineMachineCode = known.code;
                } else {
                    const newEntry = { code: machineName, building: inferred.b || '?', line: inferred.l || '?', machine_process: p.machineProcess || currentProcess, _isDiscovered: true };
                    window.allMachines.push(newEntry);
                    mapCodeToInfo[machineName] = newEntry;
                    p._timelineMachineCode = machineName;
                }
            });

            // --- STEP B: GROUP ---
            window.fullPlanDataset = JSON.parse(JSON.stringify(plans));
            plans = plans.filter(p => p.machine && p.machine.trim() !== '-');
            const byMach = {};
            plans.forEach(p => {
                const bucketCode = p._timelineMachineCode || resolveMachineCode(p.machine) || p.machine;
                p._timelineMachineCode = bucketCode;
                if (!byMach[bucketCode]) byMach[bucketCode] = [];
                byMach[bucketCode].push(p);
            });
            Object.keys(byMach).forEach(m => {
                byMach[m].sort((a, b) => {
                    const isRunA = (a.status || '').toUpperCase() === 'RUNNING';
                    const isRunB = (b.status || '').toUpperCase() === 'RUNNING';
                    if (isRunA && !isRunB) return -1;
                    if (!isRunA && isRunB) return 1;
                    const seqDiff = Number(a.seq || 0) - Number(b.seq || 0);
                    if (seqDiff) return seqDiff;
                    const startA = a.startDate ? new Date(a.startDate).getTime() : 0;
                    const startB = b.startDate ? new Date(b.startDate).getTime() : 0;
                    if (startA !== startB) return startA - startB;
                    return Number(a.id || 0) - Number(b.id || 0);
                });
                let cursor = Date.now();
                byMach[m].forEach((p, i) => {
                    const st = (p.status || '').toUpperCase(); const isRun = st === 'RUNNING';
                    const ct = Number(p.cycleTime || 120); const cav = Number(p.cavity || 1); const pcsHr = (ct > 0) ? (3600 / ct) * cav : 30;
                    const qty = Number(p.planQty || 0); const bal = Math.max(0, qty - Number(p.producedQty || 0));
                    p.balQty = bal; const durMs = ((isRun ? bal : qty) * 3600 * 1000) / pcsHr;
                    let start, end;
                    if (isRun) { start = p.firstDprEntry ? new Date(p.firstDprEntry).getTime() : (p.startDate ? new Date(p.startDate).getTime() : Date.now()); end = Date.now() + durMs; }
                    else { start = (i === 0) ? Date.now() : cursor; end = start + durMs; }
                    p._rippledStartRaw = new Date(start); p._rippledEndRaw = new Date(end); p._rippledExpRaw = new Date(end); cursor = end;
                });
            });
            window.allMasterPlans = plans; window.timelineGroups = byMach;
            window.timelineMachines = (window.allMachines || []).map(m => ({
                code: m.code,
                name: m.name || m.code,
                building: m.building,
                line: m.line,
                machine_process: m.machine_process,
                is_active: m.is_active,
                status: m.status,
                _isRegistered: true
            }));

            Object.keys(byMach).forEach(code => {
                if (!window.timelineMachines.some(m => m.code === code)) {
                    const inferred = inferInfo(code);
                    window.timelineMachines.push({
                        code,
                        name: code,
                        building: inferred.b || '?',
                        line: inferred.l || '?',
                        machine_process: currentProcess,
                        _isDiscovered: true
                    });
                }
            });

            // --- STEP C: FORCE-BIT ---
            window.timelineMachines.forEach(m => {
                const simpleM = simplify(m.code);
                const simpleClean = simplify(m.code.includes('>') ? m.code.split('>').pop() : m.code);

                // 1. Find Match in Master Data
                let info = (window.allMachines || []).find(x => {
                    const simpleX = simplify(x.code);
                    if (!simpleX) return false;
                    if (simpleX === simpleM) return true;
                    if (simpleX === simpleClean) return true;
                    if (simpleX.length > 3 && simpleM.length > 3) return simpleX.includes(simpleM) || simpleM.includes(simpleX);
                    return false;
                }) || {};

                // 2. Resolve Values (Prefer Master Data, Fallback to Inference)
                let b = (info.building && info.building !== 'null' && info.building !== '?') ? info.building : (m.building || info.machine_process || m.machine_process || '?');
                let l = (info.line && info.line !== 'null' && info.line !== '?') ? info.line : (m.line || (info.machine_process || m.machine_process ? 'Machines' : '?'));

                // 3. Last Resort Inference (v47)
                if (b === '?' || !b || l === '?' || !l) {
                    const inferred = inferInfo(m.code);
                    if (b === '?' || !b) b = inferred.b;
                    if (l === '?' || !l) l = inferred.l;
                }

                // 5. STAMP IT
                m._finalBuilding = String(b || '?').trim().toUpperCase();
                m._finalLine = String(l || '?').trim().toUpperCase();
            });

            // --- STEP D: DROPDOWNS ---
            const bldgs = new Set(), lines = new Set();
            window.timelineMachines.forEach(m => {
                if (m._finalBuilding && m._finalBuilding !== '?' && m._finalBuilding !== 'NULL') bldgs.add(m._finalBuilding);
                if (m._finalLine && m._finalLine !== '?' && m._finalLine !== 'NULL') lines.add(m._finalLine);
            });
            const bSel = document.getElementById('filt-bldg'), lSel = document.getElementById('filt-line');
            if (bSel) {
                bSel.innerHTML = currentProcess === 'Moulding' ? '<option value="">All Buildings</option>' : `<option value="">All ${currentProcess}</option>`;
                [...bldgs].sort().forEach(b => bSel.add(new Option(currentProcess === 'Moulding' ? ('Bldg ' + b) : b, b)));
            }
            if (lSel) {
                lSel.innerHTML = '<option value="">All Lines</option>';
                [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(l => lSel.add(new Option(l === 'MACHINES' ? 'Machines' : ('Line ' + l), l)));
            }

            con.innerHTML = ''; window.superRenderTimelineRows(window.timelineMachines);
            if (document.getElementById('filter-count')) document.getElementById('filter-count').textContent = window.timelineMachines.length + ' machines';
        } catch (e) {
            console.error(e); con.innerHTML = '<div class="text-danger p-5">Error Loading: ' + e.message + '</div>';
        }
    };

    // --- DEBUG INSPECTOR (v47) ---
    window.showTimelineDebug = function () {
        const machines = window.timelineMachines || [];
        const report = machines.map(m =>
            `${m.code.padEnd(30)} | B: ${m._finalBuilding.padEnd(5)} | L: ${m._finalLine}`
        ).join('\n');

        const win = window.open('', 'Debug Info', 'width=600,height=800');
        win.document.write(`<pre style="font-family:monospace; font-size:12px; padding:20px;">${report}</pre>`);
        win.document.title = "Timeline Data Inspector (v47)";
    };

    window.superFilterTimeline = function () {
        const q = (document.getElementById('filt-search').value || '').toLowerCase();
        const b = document.getElementById('filt-bldg')?.value;
        const l = document.getElementById('filt-line')?.value;
        const s = document.getElementById('filt-status')?.value;
        const f = document.getElementById('filt-forecast')?.value; // "24", "48", etc.

        const norm = (v) => String(v || '').trim().toUpperCase();

        const now = Date.now();
        const cutoffTime = f ? (now + parseInt(f) * 3600000) : 0;

        console.log(`[SuperFilter] B: "${b}", L: "${l}", S: "${s}", Q: "${q}", Forecast: ${f} (${cutoffTime})`);

        const filtered = window.timelineMachines.filter(m => {
            const build = m._finalBuilding || '?';
            const line = m._finalLine || '?';

            if (b && build !== norm(b)) return false;
            if (l && line !== norm(l)) return false;

            const mPlans = window.timelineGroups[m.code] || [];

            // --- FORECAST FILTER ---
            // If Forecast ON: Show machine ONLY if it has a Mould Change (or new plan) STARTING in [Now, Cutoff]
            if (cutoffTime > 0) {
                const hasChangeInWindow = mPlans.some((p, i) => {
                    // Must strictly be a plan starting in the future window
                    if (!p._rippledStartRaw) return false;
                    const start = p._rippledStartRaw.getTime();
                    if (start <= now || start >= cutoffTime) return false; // Not starting in window

                    // It is in window. Is it a mould change?
                    // If it's the very first plan in the list? Rare if filtered by "Running/Stopped" but theoretically yes.
                    // Generally check if mouldNo differs from previous.
                    if (i === 0) return true; // First plan starts in window -> New Job.
                    const prev = mPlans[i - 1];
                    return (p.mouldNo || '') !== (prev.mouldNo || '');
                });
                if (!hasChangeInWindow) return false;
            }

            if (s) {
                if (s === 'Running' && !mPlans.some(p => (p.status || '').toLowerCase() === 'running')) return false;
                if (s === 'Stopped' && mPlans.length > 0) return false;
                if (s === 'Planned' && mPlans.length === 0) return false;
                if (s === 'MouldChange' && !mPlans.some((p, i) => i > 0 && ((p.mouldNo || '') !== (mPlans[i - 1].mouldNo || '')))) return false;
            }
            if (q) {
                if (m.code.toLowerCase().includes(q)) return true;
                if (!mPlans.some(p => ((p.orderNo || '').toLowerCase().includes(q) || (p.mouldName || '').toLowerCase().includes(q) || (p.mouldNo || '').toLowerCase().includes(q) || (p.clientName || '').toLowerCase().includes(q) || (p.jcNo || '' || p.job_card_no || '').toLowerCase().includes(q)))) return false;
            }
            return true;
        });

        // Use Super Renderer with Cutoff
        const con = document.getElementById('timelineContainer'); con.innerHTML = '';
        window.superRenderTimelineRows(filtered, cutoffTime);

        if (filtered.length === 0 && (b || l || f)) {
            con.innerHTML += `<div style="padding:15px; color:#64748b; font-size:0.9rem">Filtered 0 machines (Debug v53).<br>B:${b}, L:${l}, Forecast:${f}</div>`;
        }
        if (document.getElementById('filter-count')) document.getElementById('filter-count').textContent = filtered.length + ' machines';
    };

    window.superUpdateLineOptions = function () {
        const b = document.getElementById('filt-bldg').value;
        const lSel = document.getElementById('filt-line');
        const currentLine = lSel.value;
        lSel.innerHTML = '<option value="">All Lines</option>';

        const norm = (v) => String(v || '').trim().toUpperCase();
        const lines = new Set();
        (window.timelineMachines || []).forEach(m => {
            if (b && m._finalBuilding !== norm(b)) return;
            if (m._finalLine && m._finalLine !== '?' && m._finalLine !== 'NULL') lines.add(m._finalLine);
        });
        [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(l => {
            lSel.add(new Option(l === 'MACHINES' ? 'Machines' : ('Line ' + l), l));
        });
        if (currentLine && [...lines].includes(currentLine)) lSel.value = currentLine; else lSel.value = '';
        window.superFilterTimeline();
    };

    window.superResetTimelineFilters = function () { ['filt-search', 'filt-bldg', 'filt-line', 'filt-status', 'filt-forecast'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); window.superUpdateLineOptions(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

    // --- STUB LEGACY (Fix Init Error) ---
    window.loadTimeline = function () { console.log('Legacy loadTimeline suppressed by v51'); };

    // Auto-init (Using Super Name)
    if (new URLSearchParams(window.location.search).get('view') === 'timeline') setTimeout(() => { window.superLoadTimeline(); }, 200);

    // --- Interactive Machine Selector Modal ---
    // ── Machine Selector: INSTANT — uses data already loaded with the timeline.
    //    Primary/Secondary machines come from plan._planObj (already in memory).
    //    No API call, no loading delay.
    window.openMachineSelector = function(event, planId, currentMachine, primaryMachine, secondaryMachine) {
        event.stopPropagation();

        // Local HTML-escape (the outer `esc` consts are scoped to other functions).
        const esc = (s) => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        // Build options from data already in memory — 0ms
        const norm = s => String(s||'').trim().toUpperCase();
        const currNorm = norm(currentMachine);
        const machines = [];

        const prim = String(primaryMachine||'').trim();
        if (prim) {
            machines.push({ machine: prim, type: 'Primary' });
        }
        if (secondaryMachine) {
            String(secondaryMachine).split(',').forEach(m => {
                const t = m.trim();
                if (t && norm(t) !== norm(prim)) {
                    machines.push({ machine: t, type: 'Secondary' });
                }
            });
        }
        // Always include current machine so user can see where it is now
        if (currNorm && !machines.some(m => norm(m.machine) === currNorm)) {
            machines.push({ machine: (currentMachine||'').trim(), type: 'Current' });
        }

        // STRICT matching — Mould Master value MUST be in "LINE>MACHINE" format (e.g. "B -L1>HYD-350-1").
        // Values without ">" (old formats like "E-L-1-OM-350-4" or plain "OM-350-4") are rejected.
        // Match is done by comparing line + machine parts separately against Machine Master entries.
        const simplify = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Parse "B -L1>HYD-350-1" → { line: "B -L1", machine: "HYD-350-1" }. Returns null if no ">".
        const parseMouldMachine = (raw) => {
            const str = String(raw||'').trim();
            const idx = str.indexOf('>');
            if (idx < 0) return null;
            return { line: str.slice(0, idx).trim(), machine: str.slice(idx + 1).trim() };
        };

        // Build Machine Master lookup: "BL1|HYD3501" → allMachines entry
        const masterMap = {};
        (Array.isArray(window.allMachines) ? window.allMachines : []).forEach(m => {
            const lineKey = simplify(m.line || '');
            const machKey = simplify(m.code || m.name || m.machine || '');
            if (lineKey && machKey) masterMap[lineKey + '|' + machKey] = m;
        });

        const requestedCount = machines.length;
        // Only keep machines whose Mould Master value has ">" AND whose line+machine combo exists in Machine Master
        const matchedMachines = machines.map(opt => {
            const parsed = parseMouldMachine(opt.machine);
            if (!parsed) return null;
            const key = simplify(parsed.line) + '|' + simplify(parsed.machine);
            const entry = masterMap[key];
            if (!entry) return null;
            return { ...opt, _entry: entry };
        }).filter(Boolean);

        const nameMismatch = requestedCount > 0 && matchedMachines.length === 0 && Object.keys(masterMap).length > 0;
        const requestedNames = machines.map(m => m.machine).filter(Boolean).join(', ');

        const modalId = 'pjdMachineSelectModal';
        let oldModal = document.getElementById(modalId);
        if (oldModal) oldModal.remove();

        let optHtml = '';
        if (nameMismatch) {
            optHtml = `<div style="padding:20px;text-align:center">
                <div style="font-size:2rem;margin-bottom:8px">⚠️</div>
                <div style="font-weight:800;color:#be123c;margin-bottom:6px">Machines are not matching with Machine Master</div>
                <div style="font-size:0.85rem;color:#64748b">${requestedNames ? `Mapped: <strong>${esc(requestedNames)}</strong>. ` : ''}Correct the machine name in Mould Master to exactly match Machine Master, then reload the timeline.</div>
            </div>`;
        } else if (!matchedMachines.length) {
            optHtml = `<div style="padding:20px;text-align:center;color:#94a3b8">
                <div style="font-size:2rem;margin-bottom:8px">🔍</div>
                <div style="font-weight:700;color:#64748b;margin-bottom:4px">No machines configured</div>
                <div style="font-size:0.85rem">Set Primary / Secondary machine in Mould Master for this mould, then reload the timeline.</div>
            </div>`;
        } else {
            optHtml = matchedMachines.map(opt => {
                // Display name and clean API name both come from the verified Machine Master entry
                const entry = opt._entry;
                const displayName = String(entry.line||'').trim() + '>' + (entry.code || entry.name || entry.machine || '');
                const cleanName   = entry.code || entry.name || entry.machine || '';
                const isCurrent   = simplify(cleanName) === simplify(currentMachine);
                const typeLC = (opt.type || '').toLowerCase();
                const badgeBg  = typeLC === 'primary' ? '#dcfce7' : typeLC === 'secondary' ? '#e0f2fe' : '#f1f5f9';
                const badgeTxt = typeLC === 'primary' ? '#15803d' : typeLC === 'secondary' ? '#0369a1'  : '#475569';
                const border   = isCurrent ? 'border:2px solid #3b82f6;background:#eff6ff' : 'border:1px solid #e2e8f0;background:#fff';
                const check    = isCurrent
                    ? '<i class="bi bi-check-circle-fill" style="color:#3b82f6;font-size:1.1rem;margin-left:auto"></i>'
                    : '<i class="bi bi-circle" style="color:#cbd5e1;font-size:1.1rem;margin-left:auto"></i>';
                const clickAttr = isCurrent ? '' :
                    `onclick="window.executeMachineChange('${planId}','${esc(cleanName)}','${modalId}')"`;
                const hover = isCurrent ? '' :
                    `onmouseover="this.style.borderColor='#93c5fd';this.style.background='#f8fafc'" onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#fff'"`;
                return `<div ${clickAttr} ${hover}
                    style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;${isCurrent?'cursor:default':'cursor:pointer'};margin-bottom:8px;transition:all 0.15s;${border}">
                    <div style="flex:1">
                        <div style="font-size:1.05rem;font-weight:800;color:#0f172a">${esc(displayName)}</div>
                        <div style="margin-top:3px">
                            <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;background:${badgeBg};color:${badgeTxt};padding:2px 7px;border-radius:4px">${esc(opt.type)}</span>
                            ${isCurrent ? ' <span style="font-size:0.75rem;color:#3b82f6;font-weight:700">— Current</span>' : ''}
                        </div>
                    </div>
                    ${check}
                </div>`;
            }).join('');
            optHtml = `<div style="color:#64748b;font-size:0.85rem;margin-bottom:12px;padding:8px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
                <i class="bi bi-info-circle" style="color:#3b82f6"></i>
                Select a machine — plan goes <strong>last</strong> on target machine with status <strong>Stopped</strong>.
            </div>
            <div style="max-height:340px;overflow-y:auto;padding:2px">${optHtml}</div>`;
        }

        const markup = `
            <div id="${modalId}" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,0.45);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">
                <div style="background:white;padding:28px 32px;border-radius:16px;width:460px;max-width:94%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:18px;animation:popIn 0.2s cubic-bezier(0.175,0.885,0.32,1.275)">
                    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f1f5f9;padding-bottom:12px;">
                        <div style="font-weight:800;font-size:1.2rem;color:#0f172a;display:flex;align-items:center;gap:8px">
                            <i class="bi bi-cpu" style="color:#3b82f6"></i> Change Machine
                        </div>
                        <button onclick="document.getElementById('${modalId}').remove()" style="border:none;background:none;cursor:pointer;font-size:1.5rem;color:#64748b;font-weight:bold;line-height:1">&times;</button>
                    </div>
                    <div>${optHtml}</div>
                </div>
            </div>
            <style>@keyframes popIn{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}</style>`;
        document.body.insertAdjacentHTML('beforeend', markup);
    };

    window.executeMachineChange = async function(planId, targetMachine, modalId) {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        if (!api) {
            alert('API client not found');
            return;
        }
        
        const modal = document.getElementById(modalId);
        const container = modal.querySelector('div');
        const originalContent = container.innerHTML;
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; gap:16px;">
                <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;"></div>
                <div style="font-weight:700; color:#0f172a; font-size:1.1rem;">Updating Machine...</div>
                <div style="color:#64748b; font-size:0.85rem;">Rescheduling plan to ${targetMachine}</div>
            </div>
        `;
        
        try {
            const res = await api.post('/planning/move', {
                rowId: planId,
                targetMachine: targetMachine
            });
            
            if (res && res.ok) {
                if (window.JPSMS && window.JPSMS.toast) {
                    window.JPSMS.toast('Machine updated successfully!', 'success');
                }
                modal.remove();
                
                window.closeOrderModal();
                
                if (typeof window.superLoadTimeline === 'function') {
                    window.superLoadTimeline();
                } else if (typeof window.loadTimeline === 'function') {
                    window.loadTimeline();
                } else {
                    window.location.reload();
                }
            } else {
                throw new Error(res?.error || 'Failed to change machine');
            }
        } catch(e) {
            console.error(e);
            alert('Error changing machine: ' + e.message);
            modal.innerHTML = originalContent;
        }
    };
})();
