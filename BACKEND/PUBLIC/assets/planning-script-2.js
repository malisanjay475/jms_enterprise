    function pEsc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    window.forceActivatePlan = async function (id, orderNo) {
      console.log('[Override] Activating Plan via FORCE:', id);
      try {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        if (!api) return alert('API not loaded');

        // Call /api/planning/run which handles Auto-Stop
        const res = await api.post('/planning/run', { rowId: id });

        if (res.ok || (res.data && res.data.ok)) {
          // Success
          if (typeof toast === 'function') toast('Plan Activated', 'success');
          // Reload Master Plan to show new state
          // Reload Page to ensure perfect sync (User Request)
          setTimeout(() => {
            window.location.reload();
          }, 300);
        } else {
          const msg = res.error || (res.data && res.data.error) || 'Activation Failed';
          if (typeof toast === 'function') toast(msg, 'error');
        }
      } catch (e) {
        console.error(e);
        if (typeof toast === 'function') toast('Error: ' + e.message, 'error');
      }
    };

    window.stopPlan = async function (id) {
      if (!confirm('Stop this plan?')) return;
      try {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        // Use update endpoint to set status Stopped
        // Or create a dedicated /stop endpoint.
        // Existing logic likely uses update.
        const res = await api.post('/planning/update', { rowId: id, status: 'Stopped' });
        if (res.ok || (res.data && res.data.ok)) {
          if (typeof toast === 'function') toast('Plan Stopped');
          if (typeof loadMasterPlan === 'function') loadMasterPlan();
        } else {
          if (typeof toast === 'function') toast('Stop Failed', 'error');
        }
      } catch (e) {
        console.error(e);
        if (typeof toast === 'function') toast(e.message, 'error');
      }
    };

    window.removePlan = async function (id, orderNo) {
      if (!confirm('Delete this plan for ' + orderNo + '?')) return;
      try {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        const res = await api.post('/planning/delete', { rowId: id });

        if (res.ok || (res.data && res.data.ok)) {
          // Success
          if (typeof toast === 'function') toast('Plan Deleted Successfully', 'success');
          if (typeof loadMasterPlan === 'function') loadMasterPlan();
          else window.location.reload();
        } else {
          // Failure
          const msg = res.error || (res.data && res.data.error) || 'Delete Failed (Unknown Error)';
          if (typeof toast === 'function') toast(msg, 'error');
          else alert(msg);
        }
      } catch (e) {
        console.error(e);
        const msg = e.message || 'Error deleting plan';
        if (typeof toast === 'function') toast(msg, 'error');
        else alert(msg);
      }
    };

    // Explicitly Render Sidebar in case it wasn't called
    if (window.JPSMS && window.JPSMS.renderShell) {
      try { window.JPSMS.renderShell('planning'); } catch (e) { console.error('Shell Init Error:', e); }
    }

    // --- Read-Only UI Enforcement ---
    if (window.JPSMS && window.JPSMS.auth && !window.JPSMS.auth.can('planning', 'edit')) {
      // Hide Create Buttons
      ['btnCreatePlan'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // Disable Drag Cursors via CSS
      const roStyle = document.createElement('style');
      roStyle.textContent = `.timeline - card { cursor: default !important;
        } .timeline - card.bi - grip - vertical { display: none!important; } `;
      document.head.appendChild(roStyle);
    }


    // ─── Complete Plan Modal v3 — self-healing + full mould-wide colour view ───

    function _ensureCompletePlanModal() {
      // If old modal exists without the enhanced section, replace it entirely
      if (document.getElementById('completePlanModal') && document.getElementById('cpmRelatedSection')) return;
      const old = document.getElementById('completePlanModal');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div id="completePlanModal" style="z-index:9999;display:none;position:fixed;inset:0;background:rgba(15,23,42,0.6);align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 8px;">
          <div style="background:#fff;border-radius:14px;width:720px;max-width:98vw;box-shadow:0 16px 48px rgba(0,0,0,0.24);overflow:hidden;margin:auto;">
            <!-- Header -->
            <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;">
              <div>
                <div style="font-size:1rem;font-weight:800;"><i class="bi bi-check-circle-fill"></i> Complete Production Plan</div>
                <div style="font-size:0.78rem;opacity:0.85;margin-top:1px;" id="cpmTitle">—</div>
              </div>
              <button onclick="document.getElementById('completePlanModal').style.display='none'"
                style="background:rgba(255,255,255,0.18);border:none;cursor:pointer;width:30px;height:30px;border-radius:50%;color:#fff;font-size:1.15rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;">&times;</button>
            </div>
            <!-- Scrollable body -->
            <div style="padding:18px 20px;max-height:76vh;overflow-y:auto;">

              <!-- Sub-info (mould + status badge) -->
              <div id="cpmSub" style="font-size:0.85rem;color:#374151;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"></div>

              <!-- Current plan qty strip -->
              <div style="margin-bottom:18px;">
                <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">
                  <i class="bi bi-gear-fill" style="color:#16a34a;"></i> This Plan
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#6b7280;font-weight:700;margin-bottom:4px;">PLAN QTY</div>
                    <div id="cpmPlanQtyDisplay" style="font-size:1.2rem;font-weight:800;color:#0f172a;">—</div>
                    <input id="cpmPlanQty" type="hidden">
                  </div>
                  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#1d4ed8;font-weight:700;margin-bottom:4px;">PRODUCED</div>
                    <div id="cpmProducedDisplay" style="font-size:1.2rem;font-weight:800;color:#1d4ed8;">—</div>
                  </div>
                  <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#c2410c;font-weight:700;margin-bottom:4px;">BALANCE</div>
                    <div id="cpmBalDisplay" style="font-size:1.2rem;font-weight:800;color:#ea580c;">—</div>
                  </div>
                  <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:10px;text-align:center;">
                    <div style="font-size:0.65rem;color:#166534;font-weight:700;margin-bottom:4px;">ENTER QTY ✎</div>
                    <input id="cpmProduced" type="number" min="0" placeholder="0"
                      style="width:100%;border:none;background:none;text-align:center;font-size:1.1rem;font-weight:800;color:#16a34a;outline:none;padding:0;box-sizing:border-box;">
                    <div id="cpmBal" style="font-size:0.7rem;color:#16a34a;font-weight:700;margin-top:2px;">Bal: —</div>
                  </div>
                </div>
              </div>

              <!-- Related mould plans section -->
              <div id="cpmRelatedSection" style="display:none;margin-bottom:18px;">
                <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
                  <i class="bi bi-diagram-3-fill" style="color:#64748b;"></i>
                  Other Plans — Same Order
                  <span id="cpmRelatedCount" style="font-size:0.7rem;background:#e2e8f0;color:#475569;padding:2px 8px;border-radius:10px;font-weight:700;"></span>
                  <span style="font-size:0.68rem;color:#9ca3af;font-weight:400;"> (enter qty to complete together)</span>
                </div>
                <div id="cpmRelatedBody" style="display:flex;flex-direction:column;gap:7px;"></div>
              </div>

              <!-- Remarks -->
              <div>
                <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
                  <i class="bi bi-chat-left-text"></i> Remarks / Notes
                </div>
                <textarea id="cpmRemarks" rows="2" placeholder="Enter completion notes (optional)..."
                  style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9rem;box-sizing:border-box;resize:vertical;"></textarea>
              </div>
            </div>
            <!-- Footer -->
            <div style="display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <button onclick="document.getElementById('completePlanModal').style.display='none'"
                style="padding:9px 20px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:0.9rem;font-weight:600;color:#374151;">Cancel</button>
              <button id="btnConfirmComplete" onclick="window.submitCompletePlan()"
                style="padding:9px 22px;border:none;border-radius:8px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-size:0.9rem;font-weight:700;box-shadow:0 2px 8px rgba(22,163,74,0.3);">
                <i class="bi bi-check-lg"></i> Complete Plan
              </button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap.firstElementChild);
    }

    // Returns colour tokens for a plan status
    function _cpmStatusStyle(status) {
      const s = (status || '').toLowerCase().trim();
      if (s === 'running')              return { bg: '#dcfce7', border: '#86efac', text: '#15803d', badge: '#16a34a',  badgeBg: '#f0fdf4'  };
      if (s === 'stopped')              return { bg: '#fee2e2', border: '#fca5a5', text: '#b91c1c', badge: '#ef4444',  badgeBg: '#fef2f2'  };
      if (s === 'completed')            return { bg: '#dbeafe', border: '#93c5fd', text: '#1d4ed8', badge: '#3b82f6',  badgeBg: '#eff6ff'  };
      if (s === 'planned' || s === 'next plan') return { bg: '#fff7ed', border: '#fdba74', text: '#c2410c', badge: '#ea580c', badgeBg: '#fff7ed' };
      return                                   { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569', badge: '#64748b',  badgeBg: '#f8fafc'  };
    }

    window.openCompletePlanModal = function (id, jsonRow) {
      try {
        // Self-heal: ensures enhanced modal is in DOM
        _ensureCompletePlanModal();

        // Resolve plan object
        let p;
        if (window._tlMap && window._tlMap[id]) {
          p = window._tlMap[id];
        } else if (jsonRow) {
          try { p = JSON.parse(jsonRow); } catch (_) { p = JSON.parse(decodeURIComponent(jsonRow)); }
        }
        if (!p) throw new Error('Plan data not found for id: ' + id);

        window.cpCurrentPlanId = id;

        const qty      = Number(p.planQty    || 0);
        const produced = Number(p.producedQty || 0);
        const bal      = qty - produced;
        const st       = _cpmStatusStyle(p.status);
        const machName = p.machine || p.machineName || '';

        // ── Header ────────────────────────────────────────────────────────
        document.getElementById('cpmTitle').textContent =
          'Order: ' + (p.orderNo || p.order_no || '') + (machName ? ' — ' + machName : '');

        document.getElementById('cpmSub').innerHTML =
          `<i class="bi bi-tools"></i> Mould: <strong style="margin-right:8px;">${p.mouldName || p.mould_name || '—'}</strong>` +
          `<span style="background:${st.badgeBg};color:${st.badge};border:1px solid ${st.border};padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;text-transform:uppercase;">${p.status || '—'}</span>`;

        // ── This plan's qty strip ─────────────────────────────────────────
        document.getElementById('cpmPlanQty').value              = qty;
        document.getElementById('cpmPlanQtyDisplay').textContent  = qty.toLocaleString();
        document.getElementById('cpmProducedDisplay').textContent = produced.toLocaleString();
        document.getElementById('cpmBalDisplay').textContent      = bal.toLocaleString();
        document.getElementById('cpmBalDisplay').style.color      = bal > 0 ? '#ea580c' : '#16a34a';
        document.getElementById('cpmProduced').value              = produced;
        document.getElementById('cpmBal').textContent             = 'Bal: ' + bal.toLocaleString();
        document.getElementById('cpmRemarks').value               = '';

        document.getElementById('cpmProduced').oninput = function () {
          const newBal = qty - Number(this.value);
          document.getElementById('cpmBal').textContent        = 'Bal: ' + newBal.toLocaleString();
          document.getElementById('cpmBalDisplay').textContent = newBal.toLocaleString();
          document.getElementById('cpmBalDisplay').style.color = newBal > 0 ? '#ea580c' : '#16a34a';
        };

        // ── Find all other plans for the same ORDER ───────────────────────
        const orderNo  = (p.orderNo || p.order_no || '').trim();
        const allPlans = window.allMasterPlans || [];
        const related  = allPlans.filter(r => {
          if (String(r.id) === String(id)) return false;
          const rOrder = (r.orderNo || r.order_no || '').trim();
          return orderNo && rOrder && orderNo === rOrder;
        });

        const relSection = document.getElementById('cpmRelatedSection');
        const relBody    = document.getElementById('cpmRelatedBody');
        const relCount   = document.getElementById('cpmRelatedCount');

        if (related.length > 0) {
          relCount.textContent = related.length + ' plan' + (related.length !== 1 ? 's' : '');
          relBody.innerHTML = related.map(r => {
            const rQty  = Number(r.planQty    || 0);
            const rProd = Number(r.producedQty || 0);
            const rBal  = rQty - rProd;
            const rs    = _cpmStatusStyle(r.status);
            const rMach = r.machine || r.machineName || '—';
            return `
              <div data-related-id="${r.id}"
                style="background:${rs.bg};border:1px solid ${rs.border};border-radius:10px;padding:10px 14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px;flex-wrap:wrap;">
                  <div>
                    <div style="font-size:0.82rem;font-weight:700;color:${rs.text};">
                      <i class="bi bi-cpu" style="margin-right:4px;"></i>${rMach}
                    </div>
                    <div style="font-size:0.72rem;color:#475569;font-weight:600;margin-top:2px;">
                      <i class="bi bi-box-seam" style="margin-right:3px;"></i>${r.mouldName || r.mould_name || '—'}
                    </div>
                  </div>
                  <span style="background:#fff;border:1px solid ${rs.border};color:${rs.badge};padding:2px 9px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase;">${r.status || '—'}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;text-align:center;align-items:center;">
                  <div>
                    <div style="font-size:0.62rem;font-weight:700;color:${rs.text};opacity:.75;margin-bottom:2px;">PLAN QTY</div>
                    <div style="font-size:0.95rem;font-weight:800;color:#0f172a;">${rQty.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style="font-size:0.62rem;font-weight:700;color:${rs.text};opacity:.75;margin-bottom:2px;">PRODUCED</div>
                    <div style="font-size:0.95rem;font-weight:800;color:#1d4ed8;">${rProd.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style="font-size:0.62rem;font-weight:700;color:${rs.text};opacity:.75;margin-bottom:2px;">BALANCE</div>
                    <div style="font-size:0.95rem;font-weight:800;color:#ea580c;">${rBal.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style="font-size:0.62rem;font-weight:700;color:${rs.text};opacity:.75;margin-bottom:2px;">ENTER QTY ✎</div>
                    <input type="number" min="0" placeholder="0"
                      style="width:100%;padding:5px 4px;border:1px solid ${rs.border};border-radius:6px;background:#fff;text-align:center;font-size:0.9rem;font-weight:800;color:#0f172a;box-sizing:border-box;"
                      oninput="var nb=this.closest('[data-related-id]').querySelector('[data-newbal]');var v=Number(this.value);nb.textContent='Bal: '+(${rQty}-v).toLocaleString();nb.style.color=v>0?'#16a34a':'#6b7280';">
                  </div>
                  <div>
                    <div style="font-size:0.62rem;font-weight:700;color:${rs.text};opacity:.75;margin-bottom:2px;">NEW BAL</div>
                    <div data-newbal style="font-size:0.9rem;font-weight:700;color:#6b7280;">Bal: ${rBal.toLocaleString()}</div>
                  </div>
                </div>
              </div>`;
          }).join('');
          relSection.style.display = 'block';
        } else {
          relSection.style.display = 'none';
        }

        document.getElementById('completePlanModal').style.display = 'flex';
      } catch (e) { console.error(e); alert('Error opening modal: ' + e.message); }
    };

    window.submitCompletePlan = async function () {
      const id          = window.cpCurrentPlanId;
      const completedQty = document.getElementById('cpmProduced').value;
      const remarks     = document.getElementById('cpmRemarks').value;
      const user        = (window.JPSMS && window.JPSMS.store && window.JPSMS.store.me)
                          ? window.JPSMS.store.me.username : 'Unknown';
      if (!id) return;
      if (!confirm('Mark this plan as COMPLETE?')) return;

      const btn = document.getElementById('btnConfirmComplete');
      const oldTxt = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Completing...';
      btn.disabled  = true;

      try {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;

        // 1. Complete the primary plan
        const res = await api.post('/planning/complete', {
          id, completed_qty: completedQty, remarks, user
        });
        if (!res.ok) { alert('Failed: ' + (res.error || 'Unknown Error')); return; }

        // 2. Complete any related plans where user entered a qty > 0
        const relRows = document.querySelectorAll('#cpmRelatedBody [data-related-id]');
        const extras  = [];
        relRows.forEach(row => {
          const inp = row.querySelector('input[type=number]');
          if (inp && inp.value !== '' && Number(inp.value) > 0) {
            extras.push({ id: row.dataset.relatedId, qty: inp.value });
          }
        });
        for (const ex of extras) {
          try {
            await api.post('/planning/complete', {
              id: ex.id, completed_qty: ex.qty,
              remarks: (remarks ? remarks + ' (batch)' : 'Batch complete'), user
            });
          } catch (e2) { console.warn('Related plan complete failed:', ex.id, e2.message); }
        }

        const total = 1 + extras.length;
        if (typeof toast === 'function') toast(total + ' plan' + (total > 1 ? 's' : '') + ' completed ✓', 'success');
        document.getElementById('completePlanModal').style.display = 'none';

        // Refresh active view
        if (typeof window.superLoadTimeline === 'function') window.superLoadTimeline();
        else if (typeof loadMasterPlan === 'function') loadMasterPlan();
      } catch (e) {
        alert('Error: ' + e.message);
      } finally {
        btn.innerHTML = oldTxt; btn.disabled = false;
      }
    };

    window.loadProductionCompletionReport = async function () {
    const list = document.getElementById('productionCompletionList');
    const searchEl = document.getElementById('pcrSearch');
    const fromEl = document.getElementById('pcrFrom');
    const toEl = document.getElementById('pcrTo');
    const suggestEl = document.getElementById('pcrSuggestions');
    
    const search = searchEl ? searchEl.value : '';
    const from = fromEl ? fromEl.value : '';
    const to = toEl ? toEl.value : '';
    
    console.log('[PCR] Loading Report. Search:', search, 'From:', from, 'To:', to);
    list.innerHTML = '<div style="padding:40px; text-align:center"><i class="bi bi-arrow-repeat spin" style="font-size:2rem; color:#0369a1"></i><div style="margin-top:10px; color:#64748b">Searching completed plans...</div></div>';

    try {
      const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
      
      // Load suggestions once if not loaded
      if (suggestEl && suggestEl.children.length === 0) {
        api.get('/planning/suggestions').then(res => {
          if (res && res.data) {
            suggestEl.innerHTML = res.data.map(s => `<option value="${s}">`).join('');
          }
        });
      }

      let url = `/planning/completed?limit=250&search=${encodeURIComponent(search)}`;
      if (from) url += `&from=${from}`;
      if (to) url += `&to=${to}`;
      
      console.log('[PCR] Fetching:', url);
      const res = await api.get(url);
      const plans = (res && res.data) ? res.data : [];
      console.log('[PCR] Results Received:', plans.length);

      // Toggle clear button + update result count
      const clearBtn = document.getElementById('pcrClear');
      if (clearBtn) clearBtn.style.display = search ? 'flex' : 'none';
      const countEl = document.getElementById('pcrCount');
      if (countEl) countEl.textContent = plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'}` : '';

      if (plans.length === 0) {
        list.innerHTML = '<div style="padding:48px; text-align:center; color:#94a3b8; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:12px"><i class="bi bi-inbox" style="font-size:1.8rem; display:block; margin-bottom:8px"></i>No completed plans found' + (search ? ' matching "' + pEsc(search) + '"' : '') + '.</div>';
        return;
      }

        // Inject scoped stylesheet once
        if (!document.getElementById('pcrStyles')) {
          const st = document.createElement('style');
          st.id = 'pcrStyles';
          st.textContent = `
            .pcr-grid{--pcr-cols:minmax(130px,1.2fr) 140px 150px minmax(210px,2.2fr) 110px minmax(120px,1fr) 84px 96px 104px 104px 104px 96px 92px 124px 70px;}
            .pcr-head{display:grid;grid-template-columns:var(--pcr-cols);gap:8px;align-items:center;position:sticky;top:0;z-index:6;
              padding:7px 12px;border-radius:10px;margin-bottom:6px;
              background:linear-gradient(180deg,#1e293b 0%,#0f172a 100%);
              color:#e2e8f0;font-size:0.66rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;
              box-shadow:0 4px 12px rgba(15,23,42,.20);}
            .pcr-head .num{text-align:right;}
            .pcr-head .ctr{text-align:center;}
            .pcr-row{display:grid;grid-template-columns:var(--pcr-cols);gap:8px;align-items:center;
              padding:4px 12px;margin-bottom:2px;background:#fff;border:1px solid #eef2f7;border-left:3px solid #cbd5e1;
              border-radius:7px;font-size:0.8rem;line-height:1.25;transition:background .12s ease,border-color .12s ease;}
            .pcr-row:nth-child(even){background:#fafcff;}
            .pcr-row:hover{background:#f1f9ff;border-left-color:#0ea5e9;}
            .pcr-cell{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            .pcr-machine{font-weight:800;color:#0f172a;}
            .pcr-or{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:#334155;font-size:0.8rem;}
            .pcr-chip{display:inline-block;max-width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.76rem;
              color:#0f172a;background:#eef2f7;border:1px solid #e2e8f0;padding:2px 7px;border-radius:6px;
              overflow:hidden;text-overflow:ellipsis;vertical-align:middle;}
            .pcr-mould{font-weight:700;color:#1e293b;}
            .pcr-item{font-size:0.74rem;color:#64748b;font-weight:500;}
            .pcr-sub{color:#475569;font-size:0.8rem;}
            .pcr-num{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;}
            .pcr-plan{color:#334155;font-weight:600;}
            .pcr-prod{color:#16a34a;font-weight:800;}
            .pcr-bal{display:inline-flex;align-items:center;justify-content:flex-end;gap:3px;width:100%;font-weight:800;
              font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;}
            .pcr-bal.met{color:#16a34a;}
            .pcr-bal.short{color:#dc2626;}
            .pcr-bal.zero{color:#64748b;}
            .pcr-time{font-size:0.76rem;color:#475569;}
            .pcr-when{font-size:0.74rem;color:#64748b;}
            .pcr-status-wrap{display:flex;align-items:center;justify-content:center;gap:6px;}
            .pcr-done{display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#15803d;border:1px solid #86efac;
              padding:3px 9px;border-radius:999px;font-size:0.72rem;font-weight:800;letter-spacing:.03em;}
            .pcr-restore{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;font-size:0.7rem;font-weight:700;
              border:1px solid #bae6fd;border-radius:6px;background:#f0f9ff;cursor:pointer;color:#0369a1;white-space:nowrap;}
            .pcr-restore:hover{background:#0369a1;border-color:#0369a1;color:#fff;}
            .pcr-by{display:inline-flex;align-items:center;gap:5px;color:#475569;font-size:0.8rem;font-weight:600;}
            .pcr-avatar{width:18px;height:18px;border-radius:50%;background:#e0f2fe;color:#0369a1;font-size:0.62rem;font-weight:800;
              display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;}
          `;
          document.head.appendChild(st);
        }

        const esc = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;');
        const fmtDate = (v) => v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

        // Store plans for Detail tab use
        window._pcrPlans = plans;

        // Tab bar
        let html = `
          <div id="pcr-tabs" style="display:flex; gap:8px; margin-bottom:12px; border-bottom:2px solid #e2e8f0; padding-bottom:0">
            <button id="pcr-tab-summary" onclick="window.showPcrTab('summary')"
              style="padding:7px 18px; border:none; border-bottom:3px solid #0369a1; background:none; color:#0369a1; font-weight:800; font-size:0.82rem; cursor:pointer; margin-bottom:-2px">
              📋 Summary
            </button>
            <button id="pcr-tab-detail" onclick="window.showPcrTab('detail')"
              style="padding:7px 18px; border:none; border-bottom:3px solid transparent; background:none; color:#94a3b8; font-weight:700; font-size:0.82rem; cursor:pointer; margin-bottom:-2px">
              🎨 Colour Detail
            </button>
          </div>
          <div id="pcr-summary-view">
          <div class="pcr-grid pcr-head">
            <div>Machine</div><div>OR No</div><div>Job Card</div><div>Mould / Product</div><div>Mould No</div><div>Client</div>
            <div class="num">Plan</div><div class="num">Produced</div><div class="num">Bal</div>
            <div>Actual Start</div><div>Actual End</div><div class="ctr">Status</div><div>By</div><div>Date / Time</div><div class="ctr">Action</div>
          </div>`;

        const u = (window.JPSMS && window.JPSMS.auth) ? window.JPSMS.auth.getUser() : {};
        // Restore allowed for superadmin + PPC Manager / PPC Ass. Manager.
        const _restoreRole = String(u.role_code || '').toLowerCase();
        const isSuper = _restoreRole === 'superadmin'
          || _restoreRole === 'ppc_manager'
          || _restoreRole === 'ppc_ass_manager';

        plans.forEach((p) => {
          if (!p) return;
          const orderNo = p.order_no || p.orderNo || '-';
          const qty = Number(p.planQty || 0);
          const prod = Number(p.producedQty || 0);
          const bal = qty - prod;

          // Bal = Plan - Produced.  short (>0)=red ↓ remaining,  surplus (<0)=green ↑ over,  exact=neutral.
          let balCls = 'zero', balHtml = '0';
          if (bal > 0) { balCls = 'short'; balHtml = `<i class="bi bi-arrow-down-short"></i>${bal.toLocaleString()}`; }
          else if (bal < 0) { balCls = 'met'; balHtml = `<i class="bi bi-arrow-up-short"></i>${Math.abs(bal).toLocaleString()}`; }

          const by = p.completedBy || '-';
          const initial = by && by !== '-' ? by.trim().charAt(0).toUpperCase() : '?';
          // Restore targets plan_board.id (numeric PK). Quote it so a string id can't break the
          // inline handler, and prefer the numeric id over the plan_id string.
          const restoreBtn = isSuper
            ? `<button class="pcr-restore" onclick="window.restoreCompletedPlan('${esc(p.id != null ? p.id : (p.planId || ''))}')" title="Restore Plan to board"><i class="bi bi-arrow-counterclockwise"></i> Restore</button>`
            : '<span style="color:#cbd5e1">—</span>';

          html += `
          <div class="pcr-grid pcr-row">
            <div class="pcr-cell pcr-machine" title="${esc(p.machine)}">${p.machine || '-'}</div>
            <div class="pcr-cell pcr-or" title="${esc(orderNo)}">${orderNo}</div>
            <div class="pcr-cell"><span class="pcr-chip" title="${esc(p.jcNo)}">${p.jcNo || '-'}</span></div>
            <div class="pcr-cell">
              <div class="pcr-cell pcr-mould" title="${esc(p.mouldName)}">${p.mouldName || '-'}</div>
              <div class="pcr-cell pcr-item" title="${esc(p.itemName)}">${p.itemName || ''}</div>
            </div>
            <div class="pcr-cell"><span class="pcr-chip" title="${esc(p.mouldCode)}">${p.mouldCode || '-'}</span></div>
            <div class="pcr-cell pcr-sub" title="${esc(p.clientName)}">${p.clientName || '-'}</div>
            <div class="pcr-num pcr-plan">${qty.toLocaleString()}</div>
            <div class="pcr-num pcr-prod">${prod.toLocaleString()}</div>
            <div class="pcr-num"><span class="pcr-bal ${balCls}">${balHtml}</span></div>
            <div class="pcr-cell pcr-time">${fmtDate(p.actualStart)}</div>
            <div class="pcr-cell pcr-time">${fmtDate(p.actualEnd)}</div>
            <div class="pcr-status-wrap"><span class="pcr-done"><i class="bi bi-check-circle-fill"></i>DONE</span></div>
            <div class="pcr-cell pcr-by" title="${esc(by)}"><span class="pcr-avatar">${initial}</span><span class="pcr-cell">${by}</span></div>
            <div class="pcr-cell pcr-when">${fmtDate(p.completedAt)}</div>
            <div class="pcr-status-wrap">${restoreBtn}</div>
          </div>`;
        });
        html += `</div>`; // close pcr-summary-view
        html += `<div id="pcr-detail-view" style="display:none">
          <div style="padding:32px; text-align:center; color:#94a3b8">
            <i class="bi bi-palette" style="font-size:1.5rem; display:block; margin-bottom:8px"></i>
            Click "Colour Detail" tab to load colour-wise breakdown.
          </div>
        </div>`;
        list.innerHTML = html;
      } catch (e) {
        list.innerHTML = `<div style="color:red; padding:20px">Error: ${pEsc(e.message)}</div>`;
      }
    };

    // Switch PCR tabs
    window.showPcrTab = async function(tab) {
      const summaryView = document.getElementById('pcr-summary-view');
      const detailView = document.getElementById('pcr-detail-view');
      const tabSummary = document.getElementById('pcr-tab-summary');
      const tabDetail = document.getElementById('pcr-tab-detail');
      if (!summaryView || !detailView) return;

      if (tab === 'summary') {
        summaryView.style.display = 'block';
        detailView.style.display = 'none';
        if (tabSummary) { tabSummary.style.borderBottomColor = '#0369a1'; tabSummary.style.color = '#0369a1'; }
        if (tabDetail) { tabDetail.style.borderBottomColor = 'transparent'; tabDetail.style.color = '#94a3b8'; }
      } else {
        summaryView.style.display = 'none';
        detailView.style.display = 'block';
        if (tabSummary) { tabSummary.style.borderBottomColor = 'transparent'; tabSummary.style.color = '#94a3b8'; }
        if (tabDetail) { tabDetail.style.borderBottomColor = '#7c3aed'; tabDetail.style.color = '#7c3aed'; }

        // Load detail if not yet loaded
        if (detailView.dataset.loaded === 'true') return;
        detailView.dataset.loaded = 'true';
        detailView.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8">⏳ Loading colour breakdown...</div>';

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const plans = window._pcrPlans || [];
          if (!plans.length) {
            detailView.innerHTML = '<div style="padding:24px; color:#94a3b8">No plans to show.</div>';
            return;
          }

          // Fetch colour data for all completed plans
          const planIds = plans.map(p => p.id || p.planId || p.plan_id).filter(Boolean);
          const allColourRows = [];
          // Fetch in one call per plan (or use the all endpoint)
          await Promise.all(planIds.map(async pid => {
            try {
              const r = await api.get(`/planning/colour-wise-completion?planId=${encodeURIComponent(pid)}`);
              if (r && r.ok && r.data) allColourRows.push(...r.data);
            } catch (_) {}
          }));

          if (!allColourRows.length) {
            detailView.innerHTML = '<div style="padding:24px; color:#94a3b8">No colour breakdown data found.</div>';
            return;
          }

          // Group by planId
          const grouped = {};
          allColourRows.forEach(r => {
            const key = String(r.planId);
            if (!grouped[key]) grouped[key] = { planId: r.planId, machine: r.machine, orderNo: r.orderNo, mouldName: r.mouldName, rows: [] };
            grouped[key].rows.push(r);
          });

          // Render
          let detailHtml = `<div style="margin-top:4px">`;
          Object.values(grouped).forEach(g => {
            const totalPlan = g.rows.reduce((s, r) => s + r.planQty, 0);
            const totalProd = g.rows.reduce((s, r) => s + r.producedQty, 0);
            const totalBal = g.rows.reduce((s, r) => s + r.balQty, 0);
            detailHtml += `
              <div style="margin-bottom:16px; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden">
                <div style="background:#f1f5f9; padding:8px 14px; font-weight:700; font-size:0.82rem; color:#334155; display:flex; gap:16px; flex-wrap:wrap">
                  <span>🏭 ${g.machine}</span>
                  <span style="color:#0369a1">OR: ${g.orderNo}</span>
                  <span>${g.mouldName}</span>
                  <span style="margin-left:auto; color:#64748b">Plan #${g.planId}</span>
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                  <thead><tr style="background:#f8fafc">
                    <th style="padding:5px 12px; text-align:left; color:#64748b; font-weight:700">Colour</th>
                    <th style="padding:5px 12px; text-align:right; color:#64748b; font-weight:700">Plan Qty</th>
                    <th style="padding:5px 12px; text-align:right; color:#16a34a; font-weight:700">Produced</th>
                    <th style="padding:5px 12px; text-align:right; color:#dc2626; font-weight:700">Balance</th>
                    <th style="padding:5px 12px; color:#64748b; font-weight:700">Progress</th>
                  </tr></thead>
                  <tbody>
                    ${g.rows.map(r => {
                      const pct = r.pct || 0;
                      const barColor = pct >= 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
                      return `<tr style="border-top:1px solid #f1f5f9">
                        <td style="padding:5px 12px; font-weight:600">${r.colour}</td>
                        <td style="padding:5px 12px; text-align:right">${r.planQty.toLocaleString()}</td>
                        <td style="padding:5px 12px; text-align:right; color:#16a34a; font-weight:700">${r.producedQty.toLocaleString()}</td>
                        <td style="padding:5px 12px; text-align:right; color:${r.balQty > 0 ? '#dc2626' : '#16a34a'}">${r.balQty.toLocaleString()}</td>
                        <td style="padding:5px 12px">
                          <div style="display:flex; align-items:center; gap:6px">
                            <div style="width:80px; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden">
                              <div style="width:${Math.min(100,pct)}%; height:100%; background:${barColor}; border-radius:3px"></div>
                            </div>
                            <span style="font-size:0.75rem; font-weight:700; color:${barColor}">${pct}%</span>
                          </div>
                        </td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="border-top:2px solid #e2e8f0; background:#f8fafc; font-weight:700">
                      <td style="padding:5px 12px">Total</td>
                      <td style="padding:5px 12px; text-align:right">${totalPlan.toLocaleString()}</td>
                      <td style="padding:5px 12px; text-align:right; color:#16a34a">${totalProd.toLocaleString()}</td>
                      <td style="padding:5px 12px; text-align:right; color:${totalBal > 0 ? '#dc2626' : '#16a34a'}">${totalBal.toLocaleString()}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>`;
          });
          detailHtml += '</div>';
          detailView.innerHTML = detailHtml;
        } catch (e) {
          detailView.innerHTML = `<div style="color:#dc2626; padding:20px">Error: ${e.message}</div>`;
        }
      }
    };

    // --- MOULD CHANGE REPORT LOGIC ---
    window.loadMouldChangeReport = async function () {
      // FIX: Use correct ID matching HTML (mcrBody)
      const list = document.getElementById('mcrBody');
      if (!list) return;

      const dateInput = document.getElementById('mcDate');
      const shiftInput = document.getElementById('mcShift');

      // Use the IDs from the new HTML structure if different
      // HTML has id="mcrDate" and "mcrShift" (Step 261)
      // JS had "mcDate" and "mcShift"
      // CHECKING HTML AGAIN:
      // <input type="date" id="mcrDate" ...>
      // <select id="mcrShift" ...>

      const realDateInput = document.getElementById('mcrDate') || dateInput;
      const realShiftInput = document.getElementById('mcrShift') || shiftInput;

      // Default to Today if empty
      // [FIX] Do NOT use valueAsDate = new Date() — it uses UTC which shows yesterday's date
      // in IST between 00:00 and 05:30. Use local-time getters instead.
      if (!realDateInput.value) {
        const _n = new Date();
        realDateInput.value = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
      }

      const selectedDateStr = realDateInput.value; // YYYY-MM-DD
      const selectedShift = realShiftInput.value; // 'Day', 'Night', 'Both'
      const next24El = document.getElementById('mcrNext24');
      const isNext24 = !!(next24El && next24El.checked); // rolling window: now .. now+24h
      const allDatesEl = document.getElementById('mcrAllDates');
      const isAllDates = !!(allDatesEl && allDatesEl.checked); // show every change, no date filter
      // Escape any value (DOM- or DB-sourced) before injecting into innerHTML to prevent XSS.
      const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
      // Derive Line number from machine code, e.g. "B-L-1-OM-350-5" -> "1"
      const lineOf = (machine) => { const m = String(machine || '').match(/(?:^|[-\s_])L[-\s_]?(\d+)/i); return m ? m[1] : '?'; };
      // Building/unit letter from the machine-code prefix, e.g. "B-L-1-OM-350-5" -> "B",
      // "C-L4-OM-100-1" -> "C". Used to group the report per physical line (B Line 1, C Line 2, …).
      const buildingOf = (machine) => { const m = String(machine || '').trim().match(/^([A-Za-z]+)/); return m ? m[1].toUpperCase() : '?'; };
      // Local (not UTC) YYYY-MM-DD so date filtering matches the factory's wall clock.
      const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      // Robust mould identity: ignore the board's '-' placeholder; fall back to mould name.
      // This is what fixes "changes not showing" when the mould master has no mould number.
      const moldKey = (p) => {
        const no = (p && p.mouldNo != null && String(p.mouldNo).trim() !== '' && String(p.mouldNo).trim() !== '-') ? String(p.mouldNo).trim().toUpperCase() : '';
        const nm = (p && p.mouldName != null && String(p.mouldName).trim() !== '' && String(p.mouldName).trim().toUpperCase() !== 'UNKNOWN') ? String(p.mouldName).trim().toUpperCase() : '';
        return no || nm;
      };
      const now = new Date();
      const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      list.innerHTML = '<div style="padding:20px; text-align:center">Analyzing Master Plan...</div>';

      // 1. Get Data
      let plans = window.allMasterPlans || [];
      if (!plans.length) {
        // Try fetching if empty
        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const res = await api.get(`/planning/board?${getPlanningProcessQuerySuffix()}`);
          if (res && res.data && res.data.plans) {
            plans = res.data.plans;
            // Filter Unassigned
            plans = plans.filter(p => p.machine && p.machine !== '-' && p.machine.trim() !== '');
            window.allMasterPlans = plans;
          }
        } catch (e) { console.error(e); }
      }

      // P3-Fix1: Deduplicate plans by ID to prevent ghost mould-changes from duplicate entries
      {
        const seenIds = new Set();
        plans = plans.filter(p => {
          const key = String(p.id || p.planId || p.plan_id || '');
          if (!key || seenIds.has(key)) return false;
          seenIds.add(key);
          return true;
        });
      }

      // Drop empty / zero-quantity queued plans. A plan with no planned quantity is a
      // placeholder that never actually runs, so counting a transition into it as a mould
      // change adds phantom rows — and many such zero plans pile up at the tail of the
      // queue. Keep RUNNING plans regardless so the mould currently on the machine is never
      // dropped (its start still anchors the next real change).
      plans = plans.filter(p => {
        const isRun = (p.status || '').toUpperCase() === 'RUNNING';
        const qty = Number(p.planQty != null ? p.planQty : p.plan_qty) || 0;
        return isRun || qty > 0;
      });

      if (!plans.length) {
        list.innerHTML = '<div class="muted" style="padding:20px; text-align:center">No planning data available.</div>';
        return;
      }

      // KAN-25: change times come from the rippled schedule (_rippledStartRaw/_rippledExpRaw),
      // normally computed by the Machine Timeline. If the report is opened directly (timeline
      // never loaded this session), compute the same Exp-based ripple here so the report
      // stands alone and always matches the timeline.
      if (!plans.some(p => p._rippledStartRaw)) {
        const rippleGroups = {};
        plans.forEach(p => { (rippleGroups[p.machine] = rippleGroups[p.machine] || []).push(p); });
        Object.keys(rippleGroups).forEach(mach => {
          const arr = rippleGroups[mach];
          arr.sort((a, b) => {
            const rA = (a.status || '').toUpperCase() === 'RUNNING';
            const rB = (b.status || '').toUpperCase() === 'RUNNING';
            if (rA !== rB) return rA ? -1 : 1;
            // P1-P4 machine priority overrides seq — must match the timeline ripple order.
            const priOrder = { P1: 1, P2: 2, P3: 3, P4: 4 };
            const pA = priOrder[a.machinePriority] || 999;
            const pB = priOrder[b.machinePriority] || 999;
            if (pA !== pB) return pA - pB;
            const sa = (a.seq != null && a.seq !== '') ? Number(a.seq) : Infinity;
            const sb = (b.seq != null && b.seq !== '') ? Number(b.seq) : Infinity;
            if (sa !== sb) return sa - sb;
            const da = a.startDate ? new Date(a.startDate).getTime() : 0;
            const db = b.startDate ? new Date(b.startDate).getTime() : 0;
            if (da !== db) return da - db;
            return Number(a.id || 0) - Number(b.id || 0);
          });
          let cursor = Date.now();
          arr.forEach((p, i) => {
            const isRun = (p.status || '').toUpperCase() === 'RUNNING';
            const ct = Number(p.cycleTime || 120), cav = Number(p.cavity || 1);
            const pcsHr = ct > 0 ? (3600 / ct) * cav : 30;
            const qty = Number(p.planQty || 0);
            const bal = qty - Number(p.producedQty || 0);
            const durFull = (qty * 3600 * 1000) / pcsHr;
            const durBal = (Math.max(0, bal) * 3600 * 1000) / pcsHr;
            let start, endExp;
            if (isRun) {
              start = p.firstDprEntry ? new Date(p.firstDprEntry).getTime() : (p.startDate ? new Date(p.startDate).getTime() : Date.now());
              endExp = Date.now() + durBal;
            } else {
              start = (i === 0) ? Date.now() : cursor;
              endExp = start + durBal;
            }
            p._rippledStartRaw = new Date(start);
            p._rippledEndRaw = new Date(start + durFull);
            p._rippledExpRaw = new Date(endExp);
            cursor = endExp; // Exp-based ripple — same rule as the Machine Timeline (KAN-86)
          });
        });
      }

      // 2. Sort by Machine > Running > P1-P4 priority > Seq > Start Date.
      // MUST be the same order the timeline ripple uses, otherwise change detection
      // compares plans that are not actually adjacent in the schedule (KAN-25):
      // a P2 plan runs before a no-priority lower-seq plan, and the running plan
      // is always first regardless of seq.
      plans.sort((a, b) => {
        if (a.machine !== b.machine) return (a.machine || '').localeCompare(b.machine || '');
        const rA = (a.status || '').toUpperCase() === 'RUNNING';
        const rB = (b.status || '').toUpperCase() === 'RUNNING';
        if (rA !== rB) return rA ? -1 : 1;
        const priOrder = { P1: 1, P2: 2, P3: 3, P4: 4 };
        const pA = priOrder[a.machinePriority] || 999;
        const pB = priOrder[b.machinePriority] || 999;
        if (pA !== pB) return pA - pB;
        const sa = (a.seq != null && a.seq !== '') ? Number(a.seq) : Infinity;
        const sb = (b.seq != null && b.seq !== '') ? Number(b.seq) : Infinity;
        if (sa !== sb) return sa - sb;
        const da = a.startDate ? new Date(a.startDate).getTime() : 0;
        const db = b.startDate ? new Date(b.startDate).getTime() : 0;
        return da - db;
      });

      const changes = [];
      // Group by Machine
      const byMach = {};
      plans.forEach(p => {
        if (!byMach[p.machine]) byMach[p.machine] = [];
        byMach[p.machine].push(p);
      });

      Object.keys(byMach).forEach(mach => {
        const machPlans = byMach[mach];
        for (let i = 1; i < machPlans.length; i++) {
          const prev = machPlans[i - 1];
          const curr = machPlans[i];

          // Check if Mould Changed (robust key: ignores '-' placeholder, falls back to name)
          const prevMould = moldKey(prev);
          const currMould = moldKey(curr);

          // Ignore if same, or if we cannot identify the incoming mould at all
          if (!currMould) continue;
          if (prevMould === currMould) continue;

          // CHANGE DETECTED
          // Time of change = when the NEW mould's plan actually starts on the machine.
          // Priority:
          //   1. curr._rippledStartRaw — the incoming plan's rippled start (KAN-25: the ripple
          //      chains from the previous plan's balance-based Exp Date, so this is the
          //      realistic change moment — matches what the Machine Timeline shows)
          //   2. prev._rippledExpRaw  — previous plan's Exp Date (same value when adjacent)
          //   3. prev._rippledEndRaw  — fixed STD end (legacy; only if Exp fields absent)
          //   4. _calculatedEndRaw — set by renderMasterTable() when Master view was loaded
          //   5. endDate from DB   — only set on COMPLETED plans (rarely populated for active plans)
          //   6. startDate + planQty × cycleTime — computed estimate (correct for queued plans)
          //   7. startDate of CURRENT plan — best proxy if prev has no CT
          //   8. prev.startDate   — last resort
          // [FIX] The old code fell back directly to prev.startDate which showed the START of the
          // previous plan as the change time — always wrong when _calculatedEndRaw wasn't available.
          let changeTime = null;
          if (curr._rippledStartRaw) {
            changeTime = new Date(curr._rippledStartRaw);
          } else if (prev._rippledExpRaw) {
            changeTime = new Date(prev._rippledExpRaw);
          } else if (prev._rippledEndRaw) {
            changeTime = new Date(prev._rippledEndRaw);
          } else if (prev._calculatedEndRaw) {
            changeTime = new Date(prev._calculatedEndRaw);
          } else if (prev.endDate) {
            changeTime = new Date(prev.endDate);
          } else if (prev.startDate && Number(prev.planQty) > 0 && Number(prev.cycleTime) > 0) {
            // Estimate: plan start + (qty × cycle-time-in-seconds)
            changeTime = new Date(new Date(prev.startDate).getTime() + Number(prev.planQty) * Number(prev.cycleTime) * 1000);
          } else if (curr.startDate) {
            // If prev has no cycle time, the next plan's start is the best proxy for change time
            changeTime = new Date(curr.startDate);
          } else {
            changeTime = new Date(prev.startDate || Date.now()); // Last resort
          }

          // Filter by Selected Date (LOCAL date, not UTC)
          const chDateStr = localDateStr(changeTime);

          // Shift Logic
          // Day: 08:00 - 20:00
          // Night: 20:00 - 08:00 (Next Day)
          let shift = 'Day';
          const hr = changeTime.getHours();
          if (hr >= 20 || hr < 8) shift = 'Night';

          // Night shift after midnight (00:00-08:00) belongs to the previous production date.
          let productionDateStr = chDateStr;
          if (hr < 8) {
            const d = new Date(changeTime);
            d.setDate(d.getDate() - 1);
            productionDateStr = localDateStr(d);
          }

          // All Dates ON: no date filter (show everything).
          // Next 24h ON: every change due between now and now+24h.
          // Else: the selected PRODUCTION DAY = selected date 08:00 → next day 08:00.
          // (The factory day runs 8 AM to 8 AM; a change at 03:00 on the 18th belongs
          // to the 17th's report. Explicit window, not derived from date strings.)
          if (isAllDates) {
            // no date restriction
          } else if (isNext24) {
            if (changeTime < now || changeTime > horizon) continue;
          } else {
            const winStart = new Date(selectedDateStr + 'T08:00:00');
            const winEnd = new Date(winStart.getTime() + 24 * 60 * 60 * 1000);
            if (changeTime < winStart || changeTime >= winEnd) continue;
          }
          if (selectedShift !== 'Both' && selectedShift !== shift) continue;

          // Compute P/H: prefer mould-master pcsHour, else derive from cycle time + cavity.
          const ct = Number(curr.cycleTime) || 0;
          const cav = Number(curr.cavity) || 0;
          let pcsHour = Number(curr.pcsHour) || 0;
          if (!pcsHour && ct > 0) pcsHour = Math.round((3600 / ct) * (cav || 1));

          changes.push({
            machine: mach,
            line: lineOf(mach),
            building: buildingOf(mach),
            unit: String(curr.plant || curr.building || '1'),
            time: changeTime,
            productionDate: productionDateStr,
            mouldNo: curr.mouldNo || curr.mould_code || '-',
            mouldName: curr.mouldName || 'Unknown',
            planQty: Number(curr.planQty) || 0,
            orderNo: curr.orderNo || '-',
            wt: (curr.stdWt !== null && curr.stdWt !== undefined && curr.stdWt !== '') ? Number(curr.stdWt) : null,
            ct: ct,
            cav: cav,
            ph: pcsHour,
            clientName: curr.clientName || '-',
            shift: shift
          });
        }
      });

      // Render
      if (!changes.length) {
        const scope = isAllDates ? 'in the plan' : (isNext24 ? 'in the next 24 hours' : `on ${escH(selectedDateStr)}`);
        list.innerHTML = `<div class="muted" style="padding:40px; text-align:center; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px">No mould changes found ${scope} (${escH(selectedShift)}).</div>`;
        return;
      }

      // ---- Counts (Day / Night) ----
      const dayCount = changes.filter(c => c.shift === 'Day').length;
      const nightCount = changes.filter(c => c.shift === 'Night').length;

      // ---- Group by BUILDING + LINE (e.g. "B 1", "C 2"), then sort each group by time ----
      // Key is "<building> <line>" so every physical line is its own section:
      // B Line 1..4, C Line 1..4, E Line 1..2, F Line 1, ordered by building letter then line no.
      const byLine = {};
      changes.forEach(c => {
        const key = `${c.building} ${c.line}`;
        (byLine[key] = byLine[key] || []).push(c);
      });
      const lineKeys = Object.keys(byLine).sort((a, b) => {
        const [ba, la] = a.split(' ');
        const [bb, lb] = b.split(' ');
        if (ba !== bb) return ba.localeCompare(bb); // building letter: B, C, E, F …
        const na = parseInt(la, 10), nb = parseInt(lb, 10);
        if (isNaN(na) && isNaN(nb)) return la.localeCompare(lb);
        if (isNaN(na)) return 1; if (isNaN(nb)) return -1;
        return na - nb;
      });
      lineKeys.forEach(k => byLine[k].sort((a, b) => a.time - b.time));

      const fmtNum = (v) => (v === null || v === undefined || v === '' || isNaN(v)) ? '-' : Number(v).toLocaleString('en-IN');
      const fmtWt = (v) => (v === null || v === undefined || v === '' || isNaN(v)) ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
      const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      // When the rows span multiple dates, show the date alongside the time so it is unambiguous.
      const showDate = isAllDates || isNext24;
      const cellTime = (d) => showDate ? `${d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })} ${fmtTime(d)}` : fmtTime(d);

      // Column headers (label + alignment). Order matches the daily sheet.
      const cols = [
        { t: 'S.No', a: 'center' },
        { t: 'MACHINE NAME', a: 'left' }, { t: 'Mould Change Time', a: 'center' },
        { t: 'Mould No.', a: 'left' }, { t: 'Mould Name', a: 'left' },
        { t: 'Plan Qty', a: 'right' }, { t: 'Order No', a: 'left' },
        { t: 'WT', a: 'right' }, { t: 'C/T', a: 'right' }, { t: 'CAV', a: 'right' },
        { t: 'P/H', a: 'right' }, { t: 'Client Name', a: 'left' }, { t: 'SHIFT', a: 'center' }
      ];
      const bd = '1px solid #94a3b8';
      const thCss = `border:${bd}; padding:8px 9px; background:#c9b6e3; color:#1e293b; font-weight:800; font-size:0.72rem; text-transform:uppercase; white-space:nowrap;`;
      const tdBase = `border:${bd}; padding:7px 9px; background:#fff; font-size:0.8rem; vertical-align:middle;`;
      const headRow = (firstLabel) => {
        // Section-band rows repeat the header but replace "MACHINE NAME" (col 1;
        // col 0 is S.No) with the UNIT/LINE label.
        let r = `<tr>`;
        cols.forEach((col, idx) => {
          const txt = (idx === 1 && firstLabel) ? firstLabel : col.t;
          r += `<th style="${thCss} text-align:${idx === 1 ? 'left' : col.a}">${escH(txt)}</th>`;
        });
        return r + `</tr>`;
      };

      // ---- Title bar (date | title | Day/Night counts) ----
      const titleDate = isAllDates
        ? `All Mould Changes`
        : (isNext24
          ? `Next 24 Hours`
          : (selectedDateStr ? new Date(selectedDateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''));
      const subDate = isAllDates
        ? `${changes.length} change${changes.length > 1 ? 's' : ''} total`
        : (isNext24 ? `${fmtTime(now)} → ${horizon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${fmtTime(horizon)}` : '');

      const generatedAt = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${fmtTime(now)}`;
      let html = `
        <div id="mcrPrintArea" style="min-width:1150px">
          <div style="display:flex; align-items:stretch; border:2px solid #1f2937; margin-bottom:-2px; font-family:'Segoe UI',Arial,sans-serif">
            <div style="flex:0 0 280px; padding:10px 14px; background:#bfe3ec; border-right:2px solid #1f2937; display:flex; flex-direction:column; justify-content:center">
              <div style="font-size:1.05rem; font-weight:800; color:#0f172a; line-height:1.15">${escH(titleDate)}</div>
              ${subDate ? `<div style="font-size:0.72rem; color:#334155; font-weight:600">${escH(subDate)}</div>` : ''}
            </div>
            <div style="flex:1; padding:8px 14px; background:#bfe3ec; border-right:2px solid #1f2937; display:flex; flex-direction:column; align-items:center; justify-content:center">
              <div style="font-size:0.82rem; font-weight:800; letter-spacing:.14em; color:#334155">JOYO PLASTICS</div>
              <div style="font-size:1.25rem; font-weight:900; letter-spacing:.04em; color:#0f172a">DAILY MOULD CHANGE REPORT</div>
              <div style="font-size:0.68rem; color:#475569; font-weight:600">Generated: ${escH(generatedAt)}</div>
            </div>
            <div style="flex:0 0 240px; display:flex">
              <div style="flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:6px 10px; border-right:1px solid #1f2937">
                <span style="background:#ea580c; color:#fff; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:4px">Day</span>
                <span style="font-size:1.5rem; font-weight:900; color:#0f172a">${dayCount}</span>
              </div>
              <div style="flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:6px 10px">
                <span style="background:#1e3a8a; color:#fff; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:4px">Night</span>
                <span style="font-size:1.5rem; font-weight:900; color:#0f172a">${nightCount}</span>
              </div>
            </div>
          </div>
          <table id="mcrTable" style="border-collapse:collapse; width:100%; font-family:'Segoe UI',Arial,sans-serif">
            <thead>${headRow(null)}</thead>
            <tbody>
      `;

      let serialNo = 0;
      lineKeys.forEach((k) => {
        const g = byLine[k][0];
        // Section band before EVERY line group (including the first) so each physical
        // line is clearly separated and labelled, e.g. "B LINE 1", "C LINE 2".
        html += headRow(`${escH(g.building)} LINE ${escH(g.line)}`);
        byLine[k].forEach(c => {
          serialNo += 1;
          const shiftBg = c.shift === 'Day' ? '#fff7ed' : '#eff6ff';
          html += `
            <tr>
              <td style="${tdBase} text-align:center; font-weight:700; color:#64748b">${serialNo}</td>
              <td style="${tdBase} font-weight:700; color:#1e293b; white-space:nowrap">${escH(c.machine)}</td>
              <td style="${tdBase} text-align:center; font-weight:600; white-space:nowrap">${escH(cellTime(c.time))}</td>
              <td style="${tdBase} font-family:monospace; color:#15803d; font-weight:700">${escH(c.mouldNo)}</td>
              <td style="${tdBase} color:#0f172a">${escH(c.mouldName)}</td>
              <td style="${tdBase} text-align:right; font-variant-numeric:tabular-nums">${fmtNum(c.planQty)}</td>
              <td style="${tdBase} font-family:monospace; color:#475569">${escH(c.orderNo)}</td>
              <td style="${tdBase} text-align:right; font-variant-numeric:tabular-nums">${fmtWt(c.wt)}</td>
              <td style="${tdBase} text-align:right; font-variant-numeric:tabular-nums">${fmtNum(c.ct)}</td>
              <td style="${tdBase} text-align:right; font-variant-numeric:tabular-nums">${fmtNum(c.cav)}</td>
              <td style="${tdBase} text-align:right; font-variant-numeric:tabular-nums">${fmtNum(c.ph)}</td>
              <td style="${tdBase} color:#475569">${escH(c.clientName)}</td>
              <td style="${tdBase} text-align:center; font-weight:700; background:${shiftBg}">${escH(c.shift)}</td>
            </tr>
          `;
        });
      });

      html += `</tbody></table>
          <div class="mcr-signatures" style="display:flex; justify-content:space-between; gap:24px; margin-top:34px; padding:0 8px; font-family:'Segoe UI',Arial,sans-serif">
            ${['Prepared By (PPC)', 'Mould Change Team', 'Production Head'].map(role => `
              <div style="flex:1; text-align:center">
                <div style="border-top:1.5px solid #1f2937; margin:0 18px; padding-top:6px; font-size:0.75rem; font-weight:700; color:#334155">${role}</div>
                <div style="font-size:0.65rem; color:#94a3b8; margin-top:2px">Name / Sign / Date</div>
              </div>`).join('')}
          </div>
        </div>`;

      // P3-Fix3: Show idle machines (machines in Machine Master with no active plans)
      const activeMachCodes = new Set(Object.keys(byMach));
      const idleMachines = (window.allMachines || window.timelineMachines || [])
        .filter(m => {
          const code = m.code || m.name || '';
          return code && !activeMachCodes.has(code);
        })
        .map(m => m.code || m.name || '')
        .filter(Boolean)
        .sort();

      if (idleMachines.length) {
        html += `
          <div style="margin-top:18px; padding:12px 16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif">
            <div style="font-weight:800; font-size:0.85rem; color:#64748b; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;">
              <i class="bi bi-pause-circle" style="color:#94a3b8"></i> Idle Machines (No Active Plans)
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${idleMachines.map(c => `<span style="font-size:0.78rem; font-weight:700; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:3px 8px; border-radius:5px;">${escH(c)}</span>`).join('')}
            </div>
          </div>`;
      }

      list.innerHTML = html;
    };

    // Print just the report table in a clean window.
    window.printMouldChangeReport = function () {
      const area = document.getElementById('mcrPrintArea');
      if (!area) { alert('Load the report first.'); return; }
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(`<!doctype html><html><head><title>Daily Mould Change Report</title>
        <style>
          @page{size:A4 landscape;margin:8mm}
          body{margin:0;font-family:'Segoe UI',Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
          table{font-size:11px}
          thead{display:table-header-group}   /* repeat column header on every printed page */
          tr{page-break-inside:avoid}
          .mcr-signatures{page-break-inside:avoid}
          #mcrPrintArea{min-width:0 !important}
        </style>
        </head><body>${area.outerHTML}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => { w.print(); }, 250);
    };

    // Export the loaded report as an Excel file (.xls via HTML — opens with full layout).
    window.exportMouldChangeReportExcel = function () {
      const area = document.getElementById('mcrPrintArea');
      if (!area) { alert('Load the report first.'); return; }
      const dateEl = document.getElementById('mcrDate');
      const stamp = (dateEl && dateEl.value) ? dateEl.value : new Date().toISOString().slice(0, 10);
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
        <x:Name>Mould Changes</x:Name><x:WorksheetOptions><x:Print><x:ValidPrinterInfo/></x:Print></x:WorksheetOptions>
        </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
        <body>${area.outerHTML}</body></html>`;
      const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Mould_Change_Report_${stamp}.xls`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };



    /* =====================================================================
       FILL DPR MODAL — Superadmin only
       Opens from Machine Timeline card. Shows colour-wise Plan/Produced/Bal
       and lets the superadmin set the new target produced total per colour.
       Trims DPR entries newest-first to reduce; adds entry to top-up.
    ===================================================================== */
    (function () {
      const MODAL_ID = 'fillDprModal';

      // Always ensures modal exists in DOM — re-creates if route change destroyed it
      function _ensureFillDprModal() {
        if (document.getElementById(MODAL_ID)) return;
        const el = document.createElement('div');
        el.id = MODAL_ID;
        el.style.cssText = 'display:none; position:fixed; inset:0; z-index:9800; background:rgba(15,23,42,.55); align-items:center; justify-content:center;';
        el.innerHTML = `
          <div style="background:#fff; border-radius:14px; width:1050px; max-width:96vw; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 24px 64px rgba(0,0,0,.22); overflow:hidden;">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
              <div>
                <div style="font-size:0.72rem; font-weight:800; color:#ddd6fe; letter-spacing:.1em; text-transform:uppercase">Superadmin Override</div>
                <div style="font-size:1.15rem; font-weight:900; color:#fff; margin-top:2px"><i class="bi bi-clipboard2-data-fill"></i> Fill DPR</div>
              </div>
              <div id="fillDprOrderLabel" style="font-size:0.9rem; font-weight:700; color:#ede9fe; text-align:right"></div>
              <button onclick="window.closeFillDprModal()" style="background:rgba(255,255,255,.15); border:none; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:1.1rem; display:flex; align-items:center; justify-content:center;">&times;</button>
            </div>
            <!-- Warning -->
            <div style="background:#fef3c7; border-bottom:1px solid #fbbf24; padding:9px 20px; display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <i class="bi bi-exclamation-triangle-fill" style="color:#d97706; font-size:1.1rem"></i>
              <span style="font-size:0.82rem; font-weight:600; color:#92400e;">Setting a lower value will <strong>permanently delete DPR entries</strong> (newest first). This cannot be undone. Set a higher value to add a new entry for today's shift.</span>
            </div>
            <!-- Table -->
            <div style="overflow-y:auto; flex:1; padding:16px 20px;">
              <div id="fillDprBody">
                <div style="text-align:center; padding:40px; color:#94a3b8">Loading colour data…</div>
              </div>
            </div>
            <!-- Footer -->
            <div style="padding:14px 20px; border-top:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; background:#fafafa;">
              <div id="fillDprStatus" style="font-size:0.82rem; color:#64748b"></div>
              <div style="display:flex; gap:10px;">
                <button onclick="window.closeFillDprModal()" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; border-radius:8px; padding:8px 18px; font-weight:700; cursor:pointer;">Cancel</button>
                <button id="fillDprApplyBtn" onclick="window.applyFillDpr()" style="background:#7c3aed; color:#fff; border:none; border-radius:8px; padding:8px 22px; font-weight:800; cursor:pointer;"><i class="bi bi-check2-all"></i> Apply Changes</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(el);
        el.addEventListener('click', function(e) {
          if (e.target === this) window.closeFillDprModal();
        });
      }

      // State
      let _fdState = { planId: '', orderNo: '', machine: '', colours: [], callerRole: '' };

      window.openFillDprModal = async function (planId, orderNo, machine, planQty) {
        _ensureFillDprModal(); // re-create if DOM was wiped by route change
        const modal = document.getElementById(MODAL_ID);
        // Guard — only superadmin
        let callerRole = '';
        try {
          callerRole = String(window.JPSMS.auth.getUser().role_code||'').toLowerCase();
          if (callerRole !== 'superadmin') { alert('Fill DPR is for Superadmin only.'); return; }
        } catch(_) { alert('Cannot verify role.'); return; }

        _fdState = { planId, orderNo, machine, colours: [], callerRole };
        document.getElementById('fillDprOrderLabel').textContent = `OR: ${orderNo}  |  Machine: ${machine}`;
        document.getElementById('fillDprBody').innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">Loading colour data…</div>';
        document.getElementById('fillDprStatus').textContent = '';
        modal.style.display = 'flex';

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const res = await api.get(`/job/colors?plan_id=${encodeURIComponent(planId)}&or_jr_no=${encodeURIComponent(orderNo)}`);
          const colours = (res && res.data) ? res.data : (res || []);
          if (!colours.length) {
            document.getElementById('fillDprBody').innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">No colour data found for this plan. Ensure colour_details is set on the plan.</div>';
            return;
          }
          _fdState.colours = colours;
          renderFillDprTable(colours);
        } catch (e) {
          document.getElementById('fillDprBody').innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">Error loading colours: ${e.message||e}</div>`;
        }
      };

      function renderFillDprTable(colours) {
        const escH = (s) => String(s==null?'':s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        const fmtN = (v) => (v==null||isNaN(v))?'-':Number(v).toLocaleString('en-IN');
        const thS = 'padding:12px 16px; background:#ede9fe; color:#4c1d95; font-weight:800; font-size:0.8rem; text-transform:uppercase; border:1px solid #ddd6fe; text-align:right;';
        const tdS = 'padding:11px 16px; border:1px solid #e2e8f0; font-size:0.92rem; vertical-align:middle;';
        let html = `
          <table style="border-collapse:collapse; width:100%">
            <thead><tr>
              <th style="${thS} text-align:left; min-width:130px">Colour</th>
              <th style="${thS}">Plan Qty</th>
              <th style="${thS}">Produced</th>
              <th style="${thS}">Bal Qty</th>
              <th style="${thS}; background:#4c1d95; color:#fff; min-width:140px">BAL QTY</th>
              <th style="${thS}; background:#064e3b; color:#fff; min-width:120px">New Balance</th>
            </tr></thead><tbody>`;
        colours.forEach((c, i) => {
          const produced = Math.round(c.produced || 0);
          const planQty  = Number(c.qty || 0);
          const bal = Math.max(0, c.bal != null ? c.bal : (planQty - produced));
          const overProduced = produced > planQty;
          const targetQtyInit = Math.max(0, planQty - bal);
          const initChanged = targetQtyInit !== produced; // true when over-produced or actual change
          const balCol = bal <= 0 ? '#16a34a' : (bal < planQty*0.2 ? '#d97706' : '#0f172a');
          const balBg  = bal <= 0 ? '#f0fdf4' : '#fff';
          const prodColor = overProduced ? '#dc2626' : '#3b82f6';
          const overBadge = overProduced ? ` <span style="font-size:0.68rem;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;padding:1px 5px;border-radius:4px;font-weight:700;margin-left:4px;">OVER</span>` : '';
          const initBorderColor = initChanged ? '#7c3aed' : '#c4b5fd';
          const initBg = initChanged ? '#f5f3ff' : '';
          html += `
            <tr>
              <td style="${tdS} font-weight:700; color:#1e293b">
                <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${colourSwatch(c.name)}; margin-right:6px; vertical-align:middle; border:1px solid #e2e8f0"></span>
                ${escH(c.name)}
              </td>
              <td style="${tdS} text-align:right; font-variant-numeric:tabular-nums">${fmtN(planQty)}</td>
              <td style="${tdS} text-align:right; font-variant-numeric:tabular-nums; color:${prodColor}; font-weight:700">${fmtN(produced)}${overBadge}</td>
              <td style="${tdS} text-align:right; font-variant-numeric:tabular-nums; color:${balCol}; background:${balBg}; font-weight:700">${fmtN(bal)}</td>
              <td style="${tdS} text-align:right; background:#faf5ff;">
                <input type="number" min="0" max="${planQty}" value="${bal}"
                  data-colour="${escH(c.name)}" data-produced="${produced}" data-planqty="${planQty}" data-origbal="${bal}" data-idx="${i}"
                  style="width:100%; border:2px solid ${initBorderColor}; border-radius:8px; padding:8px 12px; font-size:1rem; font-weight:700; text-align:right; color:#4c1d95; outline:none; background:${initBg};"
                  oninput="window._fdMarkChanged(this)">
              </td>
              <td id="fd-newbal-${i}" style="${tdS} text-align:right; font-weight:800; color:#059669; background:#f0fdf4; font-variant-numeric:tabular-nums">${fmtN(bal)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        html += `<div style="margin-top:10px; font-size:0.76rem; color:#94a3b8"><i class="bi bi-info-circle"></i> Type the desired <strong>Balance</strong> for each colour. The system adjusts produced qty automatically. New Balance updates live.</div>`;
        document.getElementById('fillDprBody').innerHTML = html;
      }

      // Simple colour swatch helper (cycles through palette)
      const _swatchPalette = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#64748b'];
      function colourSwatch(name) {
        let h = 0; for (let i=0; i<(name||'').length; i++) h = (h*31+name.charCodeAt(i))%_swatchPalette.length;
        return _swatchPalette[Math.abs(h)];
      }

      window._fdMarkChanged = function(inp) {
        const planQty  = Number(inp.dataset.planqty||0);
        const produced = Number(inp.dataset.produced||0);
        const idx      = inp.dataset.idx;
        // clamp: desired balance must be between 0 and planQty
        const desiredBal = Math.max(0, Math.min(Number(inp.value||0), planQty));
        const targetQty  = Math.max(0, planQty - desiredBal);
        const changed  = targetQty !== produced; // true when this would actually change data
        inp.style.borderColor = changed ? '#7c3aed' : '#c4b5fd';
        inp.style.background  = changed ? '#f5f3ff' : '';
        const balCell = document.getElementById('fd-newbal-' + idx);
        if (balCell) {
          balCell.textContent = desiredBal.toLocaleString('en-IN');
          balCell.style.color = desiredBal <= 0 ? '#dc2626' : '#059669';
          balCell.style.background = desiredBal <= 0 ? '#fef2f2' : '#f0fdf4';
        }
      };

      window.closeFillDprModal = function () {
        const m = document.getElementById(MODAL_ID);
        if (m) m.style.display = 'none';
      };

      window.applyFillDpr = async function () {
        const inputs = document.querySelectorAll(`#${MODAL_ID} input[data-colour]`);
        const changes = [];
        for (const inp of inputs) {
          const produced   = Math.round(Number(inp.dataset.produced||0));
          const planQty    = Math.round(Number(inp.dataset.planqty||0));
          const desiredBal = Math.max(0, Math.min(Math.round(Number(inp.value||0)), planQty)); // clamp [0, planQty]
          const targetQty  = Math.max(0, planQty - desiredBal); // target produced qty
          if (targetQty === produced) continue; // no actual change needed
          changes.push({ colour: inp.dataset.colour, targetQty, desiredBal, produced, planQty });
        }
        if (!changes.length) { document.getElementById('fillDprStatus').textContent = 'No balance changes made.'; return; }

        // Confirm before applying
        const msg = changes.map(c => `${c.colour}: Balance ${(c.planQty - c.produced).toLocaleString()} → ${c.desiredBal.toLocaleString()}  (Produced: ${c.produced.toLocaleString()} → ${c.targetQty.toLocaleString()})`).join('\n');
        if (!confirm(`Update balances?\n\n${msg}\n\nProceed?`)) return;

        const btn = document.getElementById('fillDprApplyBtn');
        btn.disabled = true; btn.textContent = 'Applying…';
        document.getElementById('fillDprStatus').textContent = '';
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        const errors = [];

        for (const ch of changes) {
          try {
            const r = await api.post('/dpr/superadmin-set-qty', {
              planId: _fdState.planId,
              colour: ch.colour,
              targetQty: ch.targetQty,
              machine: _fdState.machine,
              orderNo: _fdState.orderNo,
              callerRole: _fdState.callerRole
            });
            if (!r || !r.ok) errors.push(`${ch.colour}: ${r?.error || 'Unknown error'}`);
          } catch (e) { errors.push(`${ch.colour}: ${e.message||e}`); }
        }

        btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-all"></i> Apply Changes';

        if (errors.length) {
          document.getElementById('fillDprStatus').innerHTML = `<span style="color:#ef4444">Errors: ${errors.join('; ')}</span>`;
        } else {
          document.getElementById('fillDprStatus').innerHTML = `<span style="color:#16a34a; font-weight:700"><i class="bi bi-check-circle-fill"></i> All ${changes.length} colour(s) updated.</span>`;
          // Clear plan board cache so timeline shows fresh balance after Fill DPR
          if (window._planBoardCache) { window._planBoardCache.data = null; window._planBoardCache.timestamp = 0; }
          // Refresh timeline after short delay so card balance updates immediately
          setTimeout(() => {
            window.closeFillDprModal();
            if (typeof window.superLoadTimeline === 'function') window.superLoadTimeline();
            else if (typeof window.loadTimeline === 'function') window.loadTimeline();
          }, 1200);
        }
      };

    })();

    /* =====================================================================
       EDIT PLAN MODAL — Superadmin only
       Lets the superadmin correct plan qty / job qty / batch qty, per-colour
       qty breakdown, item/mould selection, and dates on an already-created
       plan (e.g. fixing a wrong colour/qty picked at creation time).
    ===================================================================== */
    (function () {
      const MODAL_ID = 'editPlanModal';

      function _ensureEditPlanModal() {
        if (document.getElementById(MODAL_ID)) return;
        const el = document.createElement('div');
        el.id = MODAL_ID;
        el.style.cssText = 'display:none; position:fixed; inset:0; z-index:9800; background:rgba(15,23,42,.55); align-items:center; justify-content:center;';
        el.innerHTML = `
          <div style="background:#fff; border-radius:14px; width:900px; max-width:96vw; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 24px 64px rgba(0,0,0,.22); overflow:hidden;">
            <div style="background:linear-gradient(135deg,#92400e,#f59e0b); padding:16px 20px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
              <div>
                <div style="font-size:0.72rem; font-weight:800; color:#fef3c7; letter-spacing:.1em; text-transform:uppercase">Superadmin Override</div>
                <div style="font-size:1.15rem; font-weight:900; color:#fff; margin-top:2px"><i class="bi bi-pencil-square"></i> Edit Plan</div>
              </div>
              <div id="editPlanOrderLabel" style="font-size:0.9rem; font-weight:700; color:#fffbeb; text-align:right"></div>
              <button onclick="window.closeEditPlanModal()" style="background:rgba(255,255,255,.15); border:none; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:1.1rem; display:flex; align-items:center; justify-content:center;">&times;</button>
            </div>
            <div style="background:#fef3c7; border-bottom:1px solid #fbbf24; padding:9px 20px; display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <i class="bi bi-exclamation-triangle-fill" style="color:#d97706; font-size:1.1rem"></i>
              <span style="font-size:0.82rem; font-weight:600; color:#92400e;">This directly corrects the plan record (qty, colour, item/mould, dates). Changes are logged with your username for audit.</span>
            </div>
            <div style="overflow-y:auto; flex:1; padding:16px 20px;">
              <div id="editPlanBody">
                <div style="text-align:center; padding:40px; color:#94a3b8">Loading plan data…</div>
              </div>
            </div>
            <div style="padding:14px 20px; border-top:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; background:#fafafa;">
              <div id="editPlanStatus" style="font-size:0.82rem; color:#64748b"></div>
              <div style="display:flex; gap:10px;">
                <button onclick="window.closeEditPlanModal()" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; border-radius:8px; padding:8px 18px; font-weight:700; cursor:pointer;">Cancel</button>
                <button id="editPlanApplyBtn" onclick="window.applyEditPlan()" style="background:#b45309; color:#fff; border:none; border-radius:8px; padding:8px 22px; font-weight:800; cursor:pointer;"><i class="bi bi-check2-all"></i> Apply Changes</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(el);
        el.addEventListener('click', function (e) {
          if (e.target === this) window.closeEditPlanModal();
        });
      }

      let _epState = { rowId: null, orderNo: '', machine: '', plan: null };

      window.openEditPlanModal = async function (rowId, planIdStr, orderNo, machine) {
        _ensureEditPlanModal();
        const modal = document.getElementById(MODAL_ID);

        let callerRole = '';
        try {
          callerRole = String(window.JPSMS.auth.getUser().role_code || '').toLowerCase();
          if (callerRole !== 'superadmin') { alert('Edit Plan is for Superadmin only.'); return; }
        } catch (_) { alert('Cannot verify role.'); return; }

        _epState = { rowId, orderNo, machine, plan: null };
        document.getElementById('editPlanOrderLabel').textContent = `OR: ${orderNo}  |  Machine: ${machine}`;
        document.getElementById('editPlanBody').innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">Loading plan data…</div>';
        document.getElementById('editPlanStatus').textContent = '';
        modal.style.display = 'flex';

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const [res, mouldRes] = await Promise.all([
            api.get(`/planning/plan/${encodeURIComponent(rowId)}`),
            api.get(`/planning/orders/${encodeURIComponent(orderNo)}/details`).catch(() => null)
          ]);
          if (!res || !res.ok || !res.plan) {
            document.getElementById('editPlanBody').innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">Could not load plan.</div>`;
            return;
          }
          _epState.plan = res.plan;
          // Only the moulds that belong to THIS job (from its plan summary), so the
          // picker offers the job's own moulds, not the whole mould master.
          _epState.moulds = (mouldRes && Array.isArray(mouldRes.data)) ? mouldRes.data : [];
          renderEditPlanForm(res.plan);
        } catch (e) {
          document.getElementById('editPlanBody').innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">Error loading plan: ${e.message || e}</div>`;
        }
      };

      // Build the Mould Name picker from the mould master. Falls back to a plain
      // text input if the master list didn't load, and always keeps the plan's
      // current mould selectable even when it isn't in the master.
      function _mouldSelectHtml(plan, fieldS, escH) {
        const moulds = Array.isArray(_epState.moulds) ? _epState.moulds : [];
        const cur = String(plan.mouldName || '').trim();
        if (!moulds.length) {
          return `<input id="epMouldName" type="text" value="${escH(plan.mouldName)}" style="${fieldS}">`;
        }
        const norm = (s) => String(s || '').trim().toUpperCase();
        const seen = new Set();
        let opts = '';
        let curInList = false;
        moulds
          .slice()
          .sort((a, b) => String(a.mould_name || '').localeCompare(String(b.mould_name || '')))
          .forEach((md) => {
            const name = String(md.mould_name || '').trim();
            if (!name || seen.has(norm(name))) return;
            seen.add(norm(name));
            const code = String(md.mould_no || md.mould_number || md.mould_code || '').trim();
            const sel = norm(name) === norm(cur) ? ' selected' : '';
            if (sel) curInList = true;
            opts += `<option value="${escH(name)}" data-code="${escH(code)}"${sel}>${escH(name)}${code ? ' (' + escH(code) + ')' : ''}</option>`;
          });
        if (cur && !curInList) {
          opts = `<option value="${escH(cur)}" data-code="${escH(plan.mouldCode || '')}" selected>${escH(cur)} (current)</option>` + opts;
        }
        return `<select id="epMouldName" onchange="window._epMouldPick(this)" style="${fieldS}">${opts}</select>`;
      }

      // When a mould is picked from the dropdown, auto-fill its code.
      window._epMouldPick = function (sel) {
        const opt = sel.options[sel.selectedIndex];
        const code = opt ? (opt.getAttribute('data-code') || '') : '';
        const codeEl = document.getElementById('epMouldCode');
        if (codeEl) codeEl.value = code;
      };

      function renderEditPlanForm(plan) {
        const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
        const fieldS = 'width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; font-size:0.92rem; font-weight:600; color:#1e293b;';
        const labS = 'font-size:0.72rem; font-weight:800; color:#92400e; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; display:block;';
        const toDateInput = (v) => v ? String(v).slice(0, 10) : '';

        let html = `
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px;">
            <div><label style="${labS}">Plan Qty</label><input id="epPlanQty" type="number" min="0" value="${Number(plan.planQty || 0)}" style="${fieldS}"></div>
            <div><label style="${labS}">Job Qty</label><input id="epJobQty" type="number" min="0" value="${Number(plan.jobQty || 0)}" style="${fieldS}"></div>
            <div><label style="${labS}">Batch Qty</label><input id="epBatchQty" type="number" min="0" value="${Number(plan.batchQty || 0)}" style="${fieldS}"></div>
            <div><label style="${labS}">Item Code</label><input id="epItemCode" type="text" value="${escH(plan.itemCode)}" style="${fieldS}"></div>
            <div style="grid-column:span 2;"><label style="${labS}">Item Name</label><input id="epItemName" type="text" value="${escH(plan.itemName)}" style="${fieldS}"></div>
            <div><label style="${labS}">Mould Name</label>${_mouldSelectHtml(plan, fieldS, escH)}</div>
            <div><label style="${labS}">Mould Code</label><input id="epMouldCode" type="text" value="${escH(plan.mouldCode)}" style="${fieldS}"></div>
            <div style="align-self:end; font-size:0.72rem; color:#92400e; line-height:1.3;"><i class="bi bi-info-circle"></i> Changing the mould moves this plan, its summary/report rows and all logged DPR entries to the new mould.</div>
            <div><label style="${labS}">Start Date</label><input id="epStartDate" type="date" value="${toDateInput(plan.startDate)}" style="${fieldS}"></div>
            <div><label style="${labS}">End Date</label><input id="epEndDate" type="date" value="${toDateInput(plan.endDate)}" style="${fieldS}"></div>
          </div>`;

        const colours = Array.isArray(plan.colourDetails) ? plan.colourDetails : [];
        if (colours.length) {
          const thS = 'padding:10px 14px; background:#fef3c7; color:#92400e; font-weight:800; font-size:0.78rem; text-transform:uppercase; border:1px solid #fde68a; text-align:left;';
          const tdS = 'padding:9px 14px; border:1px solid #e2e8f0; font-size:0.9rem; vertical-align:middle;';
          html += `<div style="font-size:0.78rem; font-weight:800; color:#92400e; text-transform:uppercase; margin-bottom:8px;">Colour-wise Qty</div>
            <table style="border-collapse:collapse; width:100%">
              <thead><tr><th style="${thS}">Colour</th><th style="${thS}; text-align:right">Qty</th></tr></thead>
              <tbody>`;
          colours.forEach((c, i) => {
            const name = c.colourName || c.itemColour || c.colour || c.color || c.name || '';
            const qty = c.planQty ?? c.batchQty ?? c.qty ?? 0;
            html += `<tr>
              <td style="${tdS} font-weight:700; color:#1e293b">
                <input type="text" data-colour-idx="${i}" data-field="name" value="${escH(name)}" style="${fieldS}">
              </td>
              <td style="${tdS} text-align:right">
                <input type="number" min="0" data-colour-idx="${i}" data-field="qty" value="${Number(qty || 0)}" style="${fieldS} text-align:right">
              </td>
            </tr>`;
          });
          html += '</tbody></table>';
        } else {
          html += '<div style="color:#94a3b8; font-size:0.85rem;">No colour breakdown on this plan.</div>';
        }

        document.getElementById('editPlanBody').innerHTML = html;
      }

      window.closeEditPlanModal = function () {
        const m = document.getElementById(MODAL_ID);
        if (m) m.style.display = 'none';
      };

      window.applyEditPlan = async function () {
        const plan = _epState.plan;
        if (!plan) return;

        const planQty = Number(document.getElementById('epPlanQty').value || 0);
        const jobQty = Number(document.getElementById('epJobQty').value || 0);
        const batchQty = Number(document.getElementById('epBatchQty').value || 0);
        const itemCode = document.getElementById('epItemCode').value.trim();
        const itemName = document.getElementById('epItemName').value.trim();
        const mouldName = document.getElementById('epMouldName').value.trim();
        const mouldCode = document.getElementById('epMouldCode').value.trim();
        const startDate = document.getElementById('epStartDate').value || null;
        const endDate = document.getElementById('epEndDate').value || null;

        let colourDetails = null;
        const colourInputs = document.querySelectorAll(`#${MODAL_ID} input[data-colour-idx]`);
        if (colourInputs.length) {
          const byIdx = {};
          colourInputs.forEach(inp => {
            const idx = inp.dataset.colourIdx;
            byIdx[idx] = byIdx[idx] || { ...(plan.colourDetails[idx] || {}) };
            if (inp.dataset.field === 'name') byIdx[idx].colourName = inp.value.trim();
            else byIdx[idx].planQty = Number(inp.value || 0);
          });
          colourDetails = Object.keys(byIdx).sort((a, b) => a - b).map(k => byIdx[k]);
        }

        if (!confirm('Apply superadmin edits to this plan? This directly corrects the plan record.')) return;

        const btn = document.getElementById('editPlanApplyBtn');
        btn.disabled = true; btn.textContent = 'Applying…';
        document.getElementById('editPlanStatus').textContent = '';

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const r = await api.post('/planning/superadmin-edit', {
            rowId: _epState.rowId,
            planQty, jobQty, batchQty, colourDetails,
            itemCode, itemName, mouldName, mouldCode,
            startDate, endDate
          });
          if (!r || !r.ok) {
            document.getElementById('editPlanStatus').innerHTML = `<span style="color:#ef4444">${r?.error || 'Unknown error'}</span>`;
          } else {
            document.getElementById('editPlanStatus').innerHTML = `<span style="color:#16a34a; font-weight:700"><i class="bi bi-check-circle-fill"></i> Plan updated.</span>`;
            if (window._planBoardCache) { window._planBoardCache.data = null; window._planBoardCache.timestamp = 0; }
            setTimeout(() => {
              window.closeEditPlanModal();
              if (typeof window.superLoadTimeline === 'function') window.superLoadTimeline();
              else if (typeof window.loadTimeline === 'function') window.loadTimeline();
            }, 1000);
          }
        } catch (e) {
          document.getElementById('editPlanStatus').innerHTML = `<span style="color:#ef4444">${e.message || e}</span>`;
        } finally {
          btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-all"></i> Apply Changes';
        }
      };
    })();

    // Debounce for PCR Search
    let pcrTimer;
    window.pcrDebounceSearch = function() {
      const clearBtn = document.getElementById('pcrClear');
      const searchEl = document.getElementById('pcrSearch');
      if (clearBtn && searchEl) clearBtn.style.display = searchEl.value ? 'flex' : 'none';
      clearTimeout(pcrTimer);
      pcrTimer = setTimeout(() => {
        window.loadProductionCompletionReport();
      }, 400);
    };

    // Clear search box and reload full report
    window.pcrClearSearch = function() {
      const searchEl = document.getElementById('pcrSearch');
      if (searchEl) searchEl.value = '';
      const clearBtn = document.getElementById('pcrClear');
      if (clearBtn) clearBtn.style.display = 'none';
      window.loadProductionCompletionReport();
      if (searchEl) searchEl.focus();
    };
