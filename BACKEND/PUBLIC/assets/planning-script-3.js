    // --- Boot Routing Logic ---

    function pEsc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // ROBUST NAV (Hoisted)
    // ROBUST NAV (Hoisted)
    window.openMouldReport = function () {
      console.log('Force opening Mould Report (Manual Override)');

      // 1. Manually Hide All Known Views
      const views = [
        'view-main',
        'masterView',
        'timelineView',
        'excelTimelineView',
        'printJCView',
        'pendingPlanApprovalView',
        'productionCompletionReport',
        'mapWrap',
        'dashboardToolbar'
      ];
      views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // Special handling for KPI and Toolbars
      const kpi = document.querySelector('.kpi-deck');
      if (kpi) kpi.style.display = 'none';

      const tb = document.querySelector('.toolbar');
      if (tb && tb.id !== 'dashboardToolbar') tb.style.display = 'none';

      // 2. Show Mould Report
      const report = document.getElementById('mouldChangeReport');
      if (report) {
        report.style.display = 'block';
        if (typeof window.loadMouldChangeReport === 'function') {
          window.loadMouldChangeReport();
        } else {
          // Retry
          setTimeout(() => {
            if (typeof window.loadMouldChangeReport === 'function') window.loadMouldChangeReport();
          }, 500);
        }
        window.view = 'mould_change';
      } else {
        alert('Critical Error: #mouldChangeReport div not found in DOM.');
      }
    };

    /** Keeps ?view=… and #view=… in sync so deep links survive clean-URL redirects (query often stripped). */
    window.syncPlanningViewInHistory = function (viewName) {
      try {
        const url = new URL(window.location.href);
        const v = String(viewName || '').trim();
        if (!v || v === 'main') {
          url.searchParams.delete('view');
          url.hash = '';
        } else {
          url.searchParams.set('view', v);
          url.hash = 'view=' + encodeURIComponent(v);
        }
        window.history.pushState({}, '', url);
      } catch (e) { }
    };

    window.readPlanningDeepLinkView = function () {
      try {
        const queryView = (new URLSearchParams(window.location.search).get('view') || '').trim();
        if (queryView) return queryView;
        const rawHash = (window.location.hash || '').replace(/^#/, '');
        if (!rawHash) return '';
        return (new URLSearchParams(rawHash).get('view') || '').trim();
      } catch (e) {
        return '';
      }
    };

    window.enforcePlanningDeepLinkView = function (reason = 'route-guard') {
      const deepView = typeof window.readPlanningDeepLinkView === 'function' ? window.readPlanningDeepLinkView() : '';
      if (!deepView) return false;
      const pageContent = document.getElementById('pageContent');
      if (!pageContent || typeof window.switchView !== 'function') return false;

      const printView = document.getElementById('printJCView');
      const needsPrintReapply = deepView === 'print_jc' && (!printView || printView.style.display === 'none');
      if (window.view === deepView && !needsPrintReapply) return true;

      console.log('[PlanningRoute] Applying deep link:', deepView, reason);
      window.switchView(deepView);
      return true;
    };

    window.addEventListener('hashchange', () => window.enforcePlanningDeepLinkView('hashchange'));
    window.addEventListener('popstate', () => window.enforcePlanningDeepLinkView('popstate'));
    window.addEventListener('load', () => {
      window.enforcePlanningDeepLinkView('window-load');
      setTimeout(() => window.enforcePlanningDeepLinkView('window-load-deferred'), 150);
    });

    window.switchView = function (viewName) {
      viewName = (viewName || '').trim();
      console.log('Switching View to:', viewName);

      // 1. Hide All Views
      const views = [
        'view-main',
        'masterView',
        'timelineView',
        'excelTimelineView',
        'printJCView',
        'productionCompletionReport',
        'mouldChangeReport',
        'mapWrap',
        'dashboardToolbar'
      ];

      views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      const kpi = document.querySelector('.kpi-deck');
      if (kpi) kpi.style.display = 'none';

      const tb = document.querySelector('.toolbar');
      if (tb && tb.id !== 'dashboardToolbar') tb.style.display = 'none';

      // 2. Show Selected
      if (viewName === 'mould_change') {
        const el = document.getElementById('mouldChangeReport');
        if (el) el.style.display = 'block';

        // Try to load data if function exists
        if (typeof window.loadMouldChangeReport === 'function') {
          window.loadMouldChangeReport();
        } else {
          console.warn('loadMouldChangeReport not yet defined');
          // It might be defined later, so we can try a timeout or just wait
          setTimeout(() => {
            if (typeof window.loadMouldChangeReport === 'function') window.loadMouldChangeReport();
          }, 500);
        }
        window.view = 'mould_change';
      }
      else if (viewName === 'master') {
        document.getElementById('masterView').style.display = 'block';
        if (typeof loadMasterPlan === 'function') loadMasterPlan();
        window.view = 'master';
      }
      else if (viewName === 'timeline') {
        document.getElementById('timelineView').style.display = 'block';
        if (typeof loadTimeline === 'function') loadTimeline();
        window.view = 'timeline';
      }
      else if (viewName === 'excel_timeline') {
        const etv = document.getElementById('excelTimelineView');
        if (etv) etv.style.display = 'block';
        if (typeof window.loadExcelTimeline === 'function') window.loadExcelTimeline();
        window.view = 'excel_timeline';
      }
      else if (viewName === 'prod_complete' || viewName === 'completed') {
        document.getElementById('productionCompletionReport').style.display = 'block';
        if (typeof loadProductionCompletionReport === 'function') loadProductionCompletionReport();
        window.view = 'prod_complete';
      }
      else if (viewName === 'print_jc') {
        document.getElementById('printJCView').style.display = 'block';
        if (typeof window.loadPrintJobCards === 'function') window.loadPrintJobCards();
        window.view = 'print_jc';
      }
      else {
        // DASHBOARD (Default)
        if (kpi) kpi.style.display = 'grid';
        document.getElementById('mapWrap').style.display = 'block';
        document.getElementById('dashboardToolbar').style.display = 'block';
        if (typeof loadMachines === 'function') loadMachines();
        window.view = 'dashboard';
      }

      window.syncPlanningViewInHistory(viewName);
    };

    // GLOBAL ACTIONS (Defined early to ensure availability for inline onclicks)
    window.activatePlan = async function (id, orderNo, force = false, confirmMsg = null) {
      const j = window.JPSMS;
      if (!j || !j.api) { alert('System not fully loaded. Please wait.'); return; }

      // P1: JC Guard — check plan's jcNo and job_card_given before activation
      // Use allMasterPlans if available (loaded by loadMasterPlan), else fall through to backend check
      const planList = window.allMasterPlans || [];
      const planForJc = planList.find(p => String(p.id) === String(id));
      if (planForJc) {
        const jcLinked = planForJc.jcNo || planForJc.jc_no || planForJc.job_card_no || '';
        const jcGiven  = planForJc.job_card_given;
        if (!jcLinked) {
          alert(`Cannot activate plan — Job Card is not linked to Order ${orderNo}.\n\nPlease link a Job Card before activating.`);
          return;
        }
        if (!jcGiven) {
          alert(`Cannot activate plan — "JC Given" is not marked for Order ${orderNo}.\n\nPlease mark JC Given before activating.`);
          return;
        }
      }

      const msg = confirmMsg || `Activate Order ${orderNo}? This will push it to the Supervisor Queue.`;
      if (!confirm(msg)) return;

      try {
        const res = await j.api.post('/planning/run', { rowId: id, force });

        if (res && res.ok) {
          if (j.toast) j.toast('Plan Activated successfully!', 'success');
          if (typeof window.loadMasterPlan === 'function') window.loadMasterPlan();
          else window.location.reload();
        }
        else if (res && res.requireConfirm && res.runningPlan) {
          // SWAP LOGIC
          const rp = res.runningPlan;
          const swapMsg = `Machine ${rp.machine} is currently running Order ${rp.order_no} (${rp.item_name}).\n\nDo you want to STOP it and START Order ${orderNo}?`;
          // Recursive call with force=true
          setTimeout(() => window.activatePlan(id, orderNo, true, swapMsg), 100);
        }
        else {
          if (j.toast) j.toast(res.error || 'Failed to activate', 'error');
          else alert(res.error || 'Failed');
        }
      } catch (e) {
        console.error('Activation Error:', e);
        if (j.toast) j.toast(e.message || 'Error occurred', 'error');
        else alert(e.message);
      }
    };

    window.stopPlan = async function (id, confirmMsg = null) {
      const j = window.JPSMS;
      if (!j || !j.api) { alert('System not fully loaded.'); return; }

      if (!confirm(confirmMsg || 'Stop this running plan?')) return;

      try {
        const res = await j.api.post('/planning/stop', { rowId: id });
        if (res && res.ok) {
          if (j.toast) j.toast('Plan Stopped.', 'success');
          if (typeof window.loadMasterPlan === 'function') window.loadMasterPlan();
          else window.location.reload();
        } else {
          if (j.toast) j.toast(res.error || 'Failed to stop', 'error');
          else alert(res.error || 'Failed');
        }
      } catch (e) {
        console.error(e);
        if (j.toast) j.toast(e.message, 'error');
        else alert(e.message);
      }
    };

    // Audit Log Functionality
    window.showAuditLog = async function () {
      const j = window.JPSMS;
      if (!j || !j.api) return;

      // Simple Modal for Audit Log
      const backdrop = document.createElement('div');
      backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;justify-content:center;align-items:center';
      backdrop.onclick = (e) => { if (e.target === backdrop) document.body.removeChild(backdrop); };

      const card = document.createElement('div');
      card.style.cssText = 'background:white;width:800px;max-width:90%;max-height:80vh;border-radius:12px;padding:20px;display:flex;flex-direction:column;box-shadow:0 10px 25px rgba(0,0,0,0.2)';
      card.innerHTML = `<div style="font-weight:700; font-size:1.2rem; margin-bottom:15px; display:flex; justify-content:space-between">
            <span>Plan Activity Log</span>
            <button onclick="this.closest('div').parentElement.parentElement.remove()" style="border:none;background:none;cursor:pointer;font-size:1.2rem">&times;</button>
        </div>
        <div style="flex:1; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px">
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem">
                <thead style="background:#f1f5f9; position:sticky; top:0">
                    <tr>
                        <th style="padding:10px; text-align:left; color:#64748b">Time</th>
                        <th style="padding:10px; text-align:left; color:#64748b">Action</th>
                        <th style="padding:10px; text-align:left; color:#64748b">Details</th>
                        <th style="padding:10px; text-align:left; color:#64748b">User</th>
                    </tr>
                </thead>
                <tbody id="auditLogBody">
                    <tr><td colspan="4" style="padding:20px; text-align:center; color:#94a3b8">Loading...</td></tr>
                </tbody>
            </table>
        </div>`;

      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      try {
        const logs = await j.api.get('/planning/audit');
        console.log('Audit Logs:', logs); // DEBUG
        if (!Array.isArray(logs) && logs.error) throw new Error(logs.error);

        const tbody = card.querySelector('#auditLogBody');
        tbody.innerHTML = '';

        const list = Array.isArray(logs) ? logs : [];

        if (!list.length) {
          tbody.innerHTML = `<tr><td colspan="4" style="padding:20px; text-align:center; color:#94a3b8">No activity recorded.</td></tr>`;
          return;
        }

        list.forEach(l => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid #f1f5f9';
          let det = l.details;
          if (typeof det === 'string') try { det = JSON.parse(det) } catch (e) { }

          let detailStr = '';
          if (det) {
            if (det.reason) detailStr += `<div style="color:#ef4444">${det.reason}</div>`;
            if (det.machine) detailStr += `<b>${det.machine}</b>`;
            if (det.order) detailStr += ` Order: ${det.order}`;
          }

          let actionColor = '#334155';
          if (l.action === 'ACTIVATE') actionColor = '#16a34a';
          if (l.action === 'DELETE') actionColor = '#ef4444';
          if (l.action === 'SWAP_STOP') actionColor = '#f59e0b';

          tr.innerHTML = `
                    <td style="padding:8px 10px; color:#475569">${new Date(l.created_at).toLocaleString()}</td>
                    <td style="padding:8px 10px; font-weight:600; color:${actionColor}">${l.action}</td>
                    <td style="padding:8px 10px; color:#334155">${detailStr}</td>
                    <td style="padding:8px 10px; color:#64748b">${l.user_name || 'System'}</td>
                `;
          tbody.appendChild(tr);
        });

      } catch (e) {
        console.error('Audit Log Error:', e);
        if (j.toast) j.toast('Failed to load logs: ' + e.message, 'error');
        const tbody = card.querySelector('#auditLogBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="padding:20px; text-align:center; color:#ef4444">Error loading logs: ${e.message}</td></tr>`;
      }
    };

    // Removed duplicate removePlan


    window.deleteAllPlans = async function () {
      const j = window.JPSMS;
      if (!j || !j.api || !j.store) return;

      const me = j.store.me || {};
      // Strict Admin Check
        if (!(window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.isAdminLike && window.JPSMS.auth.isAdminLike(me))) {
          alert('Access Denied: Admin or Superadmin only.');
          return;
        }

      if (!confirm("⚠️ DANGER: This will DELETE ALL PLANS from the board.\n\nAre you sure you want to proceed?")) return;
      if (!confirm("This action cannot be undone. Confirm delete all?")) return;

      try {
        const res = await j.api.post('/planning/delete-all', { user: me.name });
        if (res && res.ok) {
          j.toast('All Plans Deleted.', 'success');
          if (typeof window.loadMasterPlan === 'function') window.loadMasterPlan();
          else window.location.reload();
        } else {
          j.toast(res.error || 'Failed', 'error');
        }
      } catch (e) {
        console.error(e);
        j.toast(e.message, 'error');
      }
    };

    const waitForJmsShell = async (timeoutMs = 3000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (window.JPSMS && typeof window.JPSMS.renderShell === 'function') {
          return window.JPSMS;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return null;
    };

    /* ── Plan Board API Cache (2-minute TTL) ─────────────────────────────────
       Switching views (Kanban → Timeline → Excel) re-calls loadMachines /
       loadMasterPlan which each hit /planning/board again. With 10+ users on
       factory WiFi this causes unnecessary DB hits. Cache the response for 2
       minutes — data stays fresh for normal factory workflows (shifts don't
       change every 30 seconds).
       Call window._planCache.invalidate() after any plan create/update/delete.
    ────────────────────────────────────────────────────────────────────────── */
    window._planCache = (function () {
      const TTL = 2 * 60 * 1000; // 2 minutes
      const store = {};           // key → { data, ts }

      return {
        async get(key, fetchFn) {
          const entry = store[key];
          if (entry && (Date.now() - entry.ts) < TTL) {
            return entry.data; // cache hit — instant
          }
          const data = await fetchFn();
          store[key] = { data, ts: Date.now() };
          return data;
        },
        invalidate(key) {
          if (key) delete store[key];
          else Object.keys(store).forEach(k => delete store[k]);
        }
      };
    })();

    window.addEventListener('DOMContentLoaded', async () => {
      // alert('DEBUG: Script started');
      const jmsShell = await waitForJmsShell();
      if (!jmsShell) {
        console.error('[Planning] JMS OCEAN shell not loaded', {
          hasJPSMS: Boolean(window.JPSMS),
          jpsmsKeys: window.JPSMS ? Object.keys(window.JPSMS) : [],
          appScript: document.querySelector('script[src*="/assets/app.js"]')?.src || null,
          readyState: document.readyState
        });
        alert('JMS OCEAN shell not loaded. Please hard refresh once, then reopen Planning Board.');
        return;
      }
      try {
        const { renderShell, api, toast, store, auth } = jmsShell;
        window.toast = toast || ((m) => alert(m)); // Expose global

        /* ── Auto-invalidate plan cache on any planning mutation ──────────────
           Every local alias ($api, j.api, client, api) points to the SAME
           window.JPSMS.api object, so wrapping .post once covers all ~25
           mutation call sites. Any POST to /planning/* clears the 2-min plan
           board cache → the user always sees their own create/edit/delete/move
           immediately, while other users still get fast cached view-switches.
           Idempotent guard prevents double-wrapping on re-init. */
        if (window.JPSMS && window.JPSMS.api && typeof window.JPSMS.api.post === 'function' && !window.JPSMS.api.__planCacheWrapped) {
          const _origPost = window.JPSMS.api.post.bind(window.JPSMS.api);
          window.JPSMS.api.post = function (url, ...rest) {
            try {
              if (typeof url === 'string' && url.indexOf('/planning/') !== -1 && window._planCache) {
                window._planCache.invalidate();
              }
            } catch (_) { /* never let cache logic break a real request */ }
            return _origPost(url, ...rest);
          };
          window.JPSMS.api.__planCacheWrapped = true;
        }

        // Auth Check
        auth.requireAuth();
        if (!auth.can('planning')) {
          toast('Access Denied: Planning', 'error');
          setTimeout(() => window.location.href = 'index.html', 1000);
          return;
        }

        await renderShell("planning");
        // alert('DEBUG: RenderShell finished');


        const me = (store && store.me) || {};



        window.deleteAllPlans = async function () {
          if (!confirm('WARNING: ARE YOU SURE YOU WANT TO DELETE ALL PLANS?\n\nThis will wipe the entire planning board. This action cannot be undone.')) return;

          const btn = document.getElementById('btnDeleteAll');
          const oldTxt = btn.innerHTML;
          btn.innerHTML = 'Deleting...'; btn.disabled = true;

          try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            const res = await api.post('/planning/delete-all', { user: 'Admin' });

            if (res.ok || (res.data && res.data.ok)) {
              if (typeof toast === 'function') toast('All Plans Deleted Successfully', 'success');
              if (typeof loadMasterPlan === 'function') loadMasterPlan();
              setTimeout(() => window.location.reload(), 500);
            } else {
              alert('Failed to delete all: ' + (res.error || 'Unknown Error'));
            }
          } catch (e) {
            alert('Error: ' + e.message);
          } finally {
            btn.innerHTML = oldTxt; btn.disabled = false;
          }
        };


        // app.js renderShell now ensures #pageContent exists
        const root = document.getElementById("pageContent");
        if (!root) {
          console.error('pageContent not found even after renderShell');
          alert('Error: page content not found');
          return;
        }

        // Handle URL Params Logic (Legacy Ported)
        const params = new URLSearchParams(window.location.search);
        const action = params.get('action');
        const view = typeof window.readPlanningDeepLinkView === 'function' ? window.readPlanningDeepLinkView() : '';

        if (action === 'create' && auth.can('plan_create')) {
          // This will be handled by the UI rendering code below / openCreatePlanLauncher
        } else if (action === 'create') {
          toast('Permission Denied: Create Plan', 'error');
        }

        const canEdit = auth.can('planning', 'edit');
        const isSupervisor = (me?.role_code === 'supervisor' || auth.can('dpr_entry'));

        /* ----------------------------- UI ----------------------------- */
        root.innerHTML = `
        <!-- Header Removed as per user request (Now in Sidebar) -->
        <div id="view-main" class="planning-home">
          <div class="toolbar planning-toolbar" id="dashboardToolbar">
            <div class="planning-toolbar-grid">
              <div class="planning-toolbar-panel">
                <div class="planning-panel-kicker">
                  <i class="bi bi-funnel"></i>
                  <span>Machine Filters</span>
                </div>
                <div class="planning-filter-row">
                  <div class="search">
                    <i class="bi bi-search"></i>
                    <input id="machineSearch" placeholder="Search machine code or machine name" aria-label="Search machines"/>
                  </div>
                  <div id="planningProcessFilter" style="min-width:340px" aria-label="Filter by process"></div>
                  <select id="buildingFilter" class="input" style="width:180px" aria-label="Filter by building">
                    <option value="">All Buildings</option>
                    <option>B</option><option>C</option><option>E</option><option>F</option>
                  </select>
                </div>
                <div class="legend mini">
                  <span class="chip b">Unplanned</span>
                  <span class="chip g">Running</span>
                  <span class="chip r">Stopped/Off</span>
                  <span class="chip y">Maintenance</span>
                </div>
              </div>

              <div class="planning-toolbar-panel">
                <div class="planning-panel-kicker">
                  <i class="bi bi-lightning-charge"></i>
                  <span>Planning Actions</span>
                </div>
                <div class="planning-action-buttons">
                    <button class="btn" id="btnToggleMap"><i class="bi bi-eye-slash"></i> Hide Machine Grid</button>
                  <button class="btn" type="button" onclick="window.switchView('timeline')"><i class="bi bi-bar-chart-steps"></i> Machine Timeline</button>
                  <button class="btn" type="button" onclick="window.switchView('excel_timeline')" style="background:linear-gradient(135deg,#eff6ff,#dbeafe); color:#1d4ed8; border-color:#bfdbfe; font-weight:700;"><i class="bi bi-grid-3x3-gap-fill"></i> Excel View Timeline</button>
                  <button class="btn" type="button" onclick="window.switchView('master')"><i class="bi bi-table"></i> Master Plan</button>
                  <button class="btn" id="btnBalance" style="display:${canEdit ? 'inline-flex' : 'none'}"><i class="bi bi-shuffle"></i> Balance Load</button>
                  <button class="btn primary" id="btnAutoP1" style="display:${canEdit ? 'inline-flex' : 'none'}"><i class="bi bi-lightning-charge"></i> Auto-Assign P1</button>
                </div>
              </div>
            </div>
          </div>

          <section class="planning-overview-card">
            <div class="planning-overview-header">
              <div>
                <div class="planning-panel-kicker">
                  <i class="bi bi-speedometer2"></i>
                  <span>Planning Dashboard</span>
                </div>
                <h3 id="planningScopeTitle" style="margin:6px 0 4px;">All Buildings</h3>
                <p id="planningSummaryText" style="margin:0; color:#64748b;">Loading planning dashboard metrics...</p>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:8px;">
                <span class="chip" id="planningScopeChip"><i class="bi bi-building"></i><span>All Buildings</span></span>
                <span class="chip" id="planningFilterChip"><i class="bi bi-funnel"></i><span>Filters loading...</span></span>
              </div>
            </div>

            <div class="kpi-deck" id="planningKpiDeck">
              ${kpiCard('bi-box-seam', 'All Pending Orders (Order Master)', 'pending')}
              ${kpiCard('bi-check2-circle', 'Today Completed Orders', 'inprog')}
              ${kpiCard('bi-exclamation-triangle', 'Delayed Pending Orders', 'variance')}
              ${kpiCard('bi-calendar2-week', 'Upcoming Orders', 'upcoming')}
            </div>

            <div class="planning-focus-grid">
              <div class="planning-focus-tile">
                <div class="planning-focus-label">Pending Focus</div>
                <div class="planning-focus-value" id="planningFocusPending">Loading pending order summary...</div>
              </div>
              <div class="planning-focus-tile">
                <div class="planning-focus-label">Planning Flow</div>
                <div class="planning-focus-value" id="planningFocusFlow">Reading live machine load...</div>
              </div>
              <div class="planning-focus-tile mini">
                <div class="planning-focus-label">Visible Machines</div>
                <div class="planning-focus-count" id="planningVisibleCount">0</div>
              </div>
              <div class="planning-focus-tile mini">
                <div class="planning-focus-label">Running</div>
                <div class="planning-focus-count" id="planningRunningCount">0</div>
              </div>
              <div class="planning-focus-tile mini">
                <div class="planning-focus-label">Planned</div>
                <div class="planning-focus-count" id="planningPlannedCount">0</div>
              </div>
              <div class="planning-focus-tile mini">
                <div class="planning-focus-label">Off / Maintenance</div>
                <div class="planning-focus-count" id="planningBlockedCount">0</div>
              </div>
            </div>
          </section>
        </div> <!-- End view-main -->

          <div class="map-wrap" id="mapWrap" aria-expanded="false">
            <div class="map-head">
              <div class="map-title-wrap">
                <div class="planning-panel-kicker">
                  <i class="bi bi-diagram-3"></i>
                        <span>Machine Grid</span>
                </div>
                <div class="map-title-row">
                  <strong class="map-title">Live Machine Load Overview</strong>
                  <span class="chip">Building Wise</span>
                  <span class="demo-badge" id="demoBadge" style="display:none"><i class="bi bi-bug"></i> Demo data</span>
                </div>
                <div class="map-sub" id="planningMapSub">Loading machine availability for the planning department.</div>
                <div class="muted mini" id="planningGridMeta" style="margin-top:6px;">Loading dashboard summary...</div>
              </div>
              <div class="map-actions">
                <label class="small-muted">Horizon</label>
                <div class="days-filter" id="horizonDays">
                  <span class="chip select" data-day="0" role="button" tabindex="0" aria-pressed="false" style="color:var(--ok); border-color:var(--ok)">Running</span>
                  ${[1, 2, 3, 4, 5].map(d => `<span class="chip select" data-day="${d}" role="button" tabindex="0" aria-pressed="false">#${d}</span>`).join("")}
                </div>
                <div style="width:8px"></div>
                <label class="small-muted">Show Off / Maintenance</label>
                <label class="chip select" id="toggleInactive" role="button" title="Include Off & Maintenance">
                  <i class="bi bi-power"></i> Toggle
                </label>
              </div>
            </div>
            <div id="machineGrid"></div>
          </div>

          <!-- Master Plan View -->
          <div id="masterView" style="display:none; margin-top:20px;">
            <div class="master-report-heading">
              <div class="master-report-kicker">Planning Board</div>
              <h2>Master Plan Report</h2>
            </div>
            <div class="toolbar master-toolbar-shell">
              <div class="master-toolbar-top">
                <div class="master-search-shell master-toolbar-search">
                  <i class="bi bi-search master-search-icon"></i>
                  <input id="masterSearch" class="master-search-input" placeholder="Search order, client, mould, machine..." aria-label="Search Master Plan"/>
                  <span id="masterSearchMeta" class="master-search-meta">All Plans</span>
                  <button type="button" id="masterSearchClear" class="master-search-clear" aria-label="Clear search">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
                <div id="masterProcessFilter" class="master-toolbar-process" aria-label="Filter master plan by process"></div>
              </div>
              <div class="master-toolbar-bottom">
                <div class="master-toolbar-secondary">
                  <button class="btn" onclick="window.showAuditLog()" title="View Activity Log"><i class="bi bi-clock-history"></i> History</button>
                  <button class="btn" id="btnDeleteAll" onclick="window.deleteAllPlans()" style="display:none; color:#ef4444; border-color:#ef4444; background:#fef2f2" title="Delete ALL Plans (Admin Only)"><i class="bi bi-trash"></i> Delete All</button>
                </div>
              </div>
            </div>
            
            <div class="list master-grid-shell" id="masterTableContainer">
                <!-- Updated Grid Template for Better Spacing -->
                <div class="row h master-grid-head" style="grid-template-columns: 40px minmax(220px, 1.4fr) 190px minmax(330px, 2.15fr) 144px minmax(190px, 1.2fr) 98px 104px 128px 128px 128px 88px 112px 168px; width: 1880px; min-width: 1880px;">
                  <div>JC</div><div>Machine</div><div>Order No</div><div>Mould / Product</div><div>Mould No</div><div>Client</div><div>Plan Qty</div><div>Balance</div><div>Start</div><div>Sched End</div><div>Expected End</div><div>Eff.%</div><div>Status</div><div style="text-align:right; padding-right:10px">Actions</div>
                </div>
               <div id="masterTableBody"></div>
            </div>
            <div class="muted mini" style="margin-top:8px">Showing all scheduled plans. Use filters to narrow down.</div>
          </div>
      <!-- Timeline View -->
      <div id="timelineView" style="display:none; padding-bottom:100px;">

        <div id="timelineContainer" class="timeline-container">
           <!-- Rows will go here -->
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════
           EXCEL VIEW TIMELINE
           Compact spreadsheet: machines = rows, plan slots = columns
           ═══════════════════════════════════════════════════════════════ -->
      <div id="excelTimelineView" style="display:none; padding-bottom:80px;">
        <!-- Filter bar + grid rendered dynamically by loadExcelTimeline() -->
      </div>

      <!-- Completed Plans View -->
      <!-- Production Completion Report View (Renamed) -->
      <div id="productionCompletionReport" style="display:none; margin-top:20px;">
         <div class="toolbar pcr-toolbar" style="background:linear-gradient(135deg,#ffffff 0%,#effaff 60%,#f7fbff 100%); padding:12px 14px; border:1px solid #bae6fd; border-radius:16px; margin-bottom:12px; box-shadow:0 12px 28px rgba(15,23,42,.06); overflow:hidden;">
            <div class="pcr-toolbar-row" style="display:flex; align-items:center; gap:8px; flex-wrap:nowrap; width:100%;">
               <strong style="color:#0369a1; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; font-size:.9rem; flex:0 0 218px;"><i class="bi bi-check-circle-fill"></i> Complete Production Plan Report</strong>
               <div style="flex:1 1 230px; min-width:210px; max-width:320px; position:relative;">
                  <i class="bi bi-search" style="position:absolute; left:13px; top:50%; transform:translateY(-50%); color:#64748b; pointer-events:none"></i>
                  <input type="text" id="pcrSearch" class="input" placeholder="Search Machine, OR No, Job Card, Mould, Client..."
                         style="width:100%; height:38px; padding-left:38px; padding-right:34px; border-radius:999px; background:#fff; border:1px solid #bfdbfe; font-weight:700; box-shadow:inset 0 1px 0 rgba(255,255,255,.95);"
                         list="pcrSuggestions"
                         onkeyup="window.pcrDebounceSearch()">
                  <button type="button" id="pcrClear" onclick="window.pcrClearSearch()" title="Clear search" aria-label="Clear search"
                          style="display:none; position:absolute; right:8px; top:50%; transform:translateY(-50%); width:22px; height:22px; border:none; border-radius:50%; background:#e2e8f0; color:#475569; cursor:pointer; line-height:1; font-size:0.85rem; align-items:center; justify-content:center;">&times;</button>
                  <datalist id="pcrSuggestions"></datalist>
               </div>
               <span id="pcrCount" style="font-size:0.78rem; font-weight:800; color:#0369a1; white-space:nowrap; flex:0 0 auto;"></span>
               <div style="display:flex; align-items:center; gap:5px; white-space:nowrap; flex:0 0 auto;">
                  <label for="pcrFrom" style="font-size:0.78rem; color:#64748b; font-weight:900">From</label>
                  <input type="date" id="pcrFrom" class="input" style="width:124px; height:38px; border-radius:10px; border:1px solid #bfdbfe; font-weight:800">
                  <label for="pcrTo" style="font-size:0.78rem; color:#64748b; font-weight:900">To</label>
                  <input type="date" id="pcrTo" class="input" style="width:124px; height:38px; border-radius:10px; border:1px solid #bfdbfe; font-weight:800">
               </div>
               <button class="btn primary" onclick="window.loadProductionCompletionReport()" style="height:38px; border-radius:11px; background:#0369a1; border-color:#0369a1; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; font-weight:900; padding:0 12px; flex:0 0 auto;">
                  <i class="bi bi-funnel"></i> Apply Filters
               </button>
               <button class="btn" onclick="window.switchView('master')" style="height:38px; border-radius:11px; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; font-weight:900; padding:0 12px; flex:0 0 auto;"><i class="bi bi-arrow-left"></i> Back</button>
               <button class="btn" onclick="window.loadProductionCompletionReport()" title="Refresh Results" aria-label="Refresh Results" style="height:38px; width:38px; border-radius:11px; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;"><i class="bi bi-arrow-clockwise"></i></button>
            </div>
         </div>
         <div style="width:100%; overflow-x:auto; overflow-y:auto; max-height: calc(100vh - 250px); padding-bottom:15px; border-bottom:2px solid #e2e8f0;">
            <div id="productionCompletionList" style="display:flex; flex-direction:column; gap:10px; min-width:1500px;"></div>
         </div>
         <div style="margin-top:10px; font-size:0.8rem; color:#64748b; text-align:center;"><i class="bi bi-info-circle"></i> Use the scrollbar above to view more columns.</div>
      </div>

      <!-- Mould Changed Report View (Restored) -->
      <div id="mouldChangeReport" style="display:none; margin-top:20px;">
         <div class="toolbar" style="background:#f0fdf4; padding:10px; border:1px solid #bbf7d0; border-radius:10px; margin-bottom:12px">
            <div class="row-flex">
               <strong style="color:#15803d"><i class="bi bi-arrow-repeat"></i> Mould Changed Report</strong>
               <div style="width:20px"></div>
               <button class="btn" onclick="window.switchView('master')"><i class="bi bi-arrow-left"></i> Back to Master</button>
               
               <!-- Filters -->
               <div style="margin-left:10px; display:flex; align-items:center; gap:8px">
                  <label class="small-muted" style="color:#15803d; font-weight:600">Date:</label>
                  <input type="date" id="mcrDate" class="input" style="width:130px; border-color:#bbf7d0">
                  
                  <label class="small-muted" style="color:#15803d; font-weight:600; margin-left:8px">Shift:</label>
                  <select id="mcrShift" class="input" style="width:100px; border-color:#bbf7d0">
                     <option value="Both">Both</option>
                     <option value="Day">Day</option>
                     <option value="Night">Night</option>
                  </select>

                  <label class="small-muted" style="color:#15803d; font-weight:600; margin-left:8px; display:flex; align-items:center; gap:5px; cursor:pointer" title="Show all mould changes coming up in the next 24 hours from now">
                     <input type="checkbox" id="mcrNext24" style="accent-color:#ea580c; width:16px; height:16px"> Next 24h
                  </label>

                  <label class="small-muted" style="color:#15803d; font-weight:600; margin-left:8px; display:flex; align-items:center; gap:5px; cursor:pointer" title="Show every mould change across all dates (ignores Date / Next 24h)">
                     <input type="checkbox" id="mcrAllDates" style="accent-color:#7c3aed; width:16px; height:16px"> All Dates
                  </label>
               </div>

               <button class="btn" onclick="window.loadMouldChangeReport()" style="background:#dcfce7; color:#15803d; border-color:#86efac"><i class="bi bi-arrow-clockwise"></i> Load Report</button>
               <button class="btn" onclick="window.printMouldChangeReport()" style="margin-left:6px"><i class="bi bi-printer"></i> Print</button>
            </div>
            <div class="small-muted" style="color:#15803d; margin-top:6px; font-size:0.72rem"><i class="bi bi-info-circle"></i> <strong>Next 24h ON</strong> = every mould change due in the next 24 hours (ignores Date). <strong>OFF</strong> = changes on the selected Date.</div>
         </div>

         <div id="mcrBody" style="min-height:200px; overflow-x:auto">
            <div class="muted" style="padding:20px; text-align:center">Select Date and Click Load Report</div>
         </div>
      </div>



      <!-- Print Job Card View -->
      <div id="printJCView" style="display:none; margin-top:20px;">
         <div class="toolbar" style="background:linear-gradient(135deg,#ffffff 0%,#effaff 55%,#fff8e7 100%); padding:18px; border:1px solid rgba(14,165,233,.28); border-radius:22px; margin-bottom:16px; box-shadow:0 18px 45px rgba(15,23,42,.08)">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap">
               <div style="min-width:220px">
                 <div style="font-size:.72rem; font-weight:900; color:#0284c7; letter-spacing:.14em; text-transform:uppercase">Planning Board</div>
                 <div style="font-size:1.45rem; font-weight:950; color:#0f2f4c; line-height:1.05; margin-top:3px"><i class="bi bi-printer-fill" style="color:#f97316"></i> Print Job Card</div>
               </div>
               <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end; flex:1">
                 <label style="position:relative; flex:1 1 360px; max-width:520px">
                   <i class="bi bi-search" style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:#0284c7; font-size:1rem"></i>
                   <input id="printJCSearch" placeholder="Search OR, JC, mould, client..." aria-label="Search" style="width:100%; height:46px; border-radius:16px; border:1px solid #bae6fd; background:rgba(255,255,255,.92); padding:0 16px 0 44px; font-weight:800; color:#0f172a; outline:none; box-shadow:inset 0 1px 0 rgba(255,255,255,.9), 0 8px 22px rgba(2,132,199,.08)">
                 </label>
                 <button type="button" class="btn" onclick="window.setPjcToday()" style="height:44px; border-radius:14px; background:#e0f2fe; color:#075985; border:1px solid #bae6fd; font-weight:900"><i class="bi bi-calendar-day"></i> Today</button>
                 <button class="btn" onclick="window.loadPrintJobCards()" style="height:44px; border-radius:14px; background:#0f8bb8; color:white; border:1px solid #0ea5e9; font-weight:900; box-shadow:0 10px 22px rgba(14,165,233,.24)"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
               </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:16px">
               <div id="pjcDateRangeWrap" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:rgba(255,255,255,.82); border:1px solid #dbeafe; border-radius:18px; padding:10px 12px; box-shadow:0 8px 20px rgba(15,23,42,.04)">
                 <span style="font-size:.75rem; font-weight:950; letter-spacing:.08em; text-transform:uppercase; color:#64748b">Plan Date</span>
                 <input type="date" id="pjcFrom" class="input" style="width:150px; height:38px; border-radius:12px; border:1px solid #bfdbfe; font-weight:850" title="Single day or start of range">
                 <span class="muted" style="font-weight:900">to</span>
                 <input type="date" id="pjcTo" class="input" style="width:150px; height:38px; border-radius:12px; border:1px solid #bfdbfe; font-weight:850" title="End of range (optional)">
               </div>
               <label id="pjcShowAllWrap" style="display:inline-flex; align-items:center; gap:10px; cursor:pointer; user-select:none; background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; border-radius:999px; padding:11px 16px; font-weight:950; box-shadow:0 8px 20px rgba(249,115,22,.10)">
                 <input type="checkbox" id="pjcShowAllJC" style="width:18px; height:18px; accent-color:#0ea5e9"> Show all Job Cards
               </label>
            </div>
         </div>
         <div id="printJCList" style="display:flex; flex-direction:column; gap:10px; overflow-x:auto;">
             <!-- Items -->
         </div>
      </div>

      <!-- Pending Plan Approval View -->
      <div id="pendingPlanApprovalView" style="display:none; margin-top:20px;">
        <section style="background:linear-gradient(135deg,#ffffff 0%,#eefbff 54%,#fff7ed 100%); border:1px solid rgba(14,165,233,.24); border-radius:24px; padding:20px; box-shadow:0 18px 45px rgba(15,23,42,.08); margin-bottom:16px">
          <div style="display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap">
            <div>
              <div style="font-size:.72rem; font-weight:950; letter-spacing:.14em; color:#0284c7; text-transform:uppercase">Planning Board</div>
              <h2 style="margin:4px 0 4px; color:#0f2f4c; font-size:1.55rem">Pending Plan Approval</h2>
              <p class="muted" style="margin:0; max-width:760px">All created plans stay here first. PPC checks the linked Job Card, then Moulding approves it. Only after final approval will Print Job Card and Supervisor unlock.</p>
            </div>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
              <label style="position:relative; min-width:320px">
                <i class="bi bi-search" style="position:absolute; left:15px; top:50%; transform:translateY(-50%); color:#0284c7"></i>
                <input id="jcApprovalSearch" placeholder="Search OR, plan, batch, mould..." style="width:100%; height:44px; border-radius:16px; border:1px solid #bae6fd; padding:0 14px 0 42px; font-weight:850; outline:none">
              </label>
              <button type="button" class="btn primary" onclick="window.loadJcApprovals('pending')" style="height:44px; border-radius:14px"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
            </div>
          </div>
          <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap">
            <button type="button" id="jcApprovalPendingTab" class="btn primary" onclick="window.loadJcApprovals('pending')"><i class="bi bi-hourglass-split"></i> Pending</button>
            <button type="button" id="jcApprovalHistoryTab" class="btn" onclick="window.loadJcApprovals('history')"><i class="bi bi-clock-history"></i> History</button>
          </div>
        </section>

        <div style="background:white; border:1px solid #dbeafe; border-radius:20px; overflow:hidden; box-shadow:0 14px 35px rgba(15,23,42,.06)">
          <div class="jc-approval-grid jc-approval-head" style="display:grid; grid-template-columns:1.2fr 1.1fr 1fr 1.35fr 1.1fr .9fr; gap:0; background:#f1f9ff; border-bottom:1px solid #dbeafe; font-weight:950; color:#475569; text-transform:uppercase; letter-spacing:.06em; font-size:.76rem">
            <div>OR No</div>
            <div>Client Name</div>
            <div>Job Plan / Plan No</div>
            <div>Mould / Machine</div>
            <div>Jobcard No / Date</div>
            <div>Approval</div>
          </div>
          <div id="jcApprovalList" style="min-height:220px"></div>
        </div>
      </div>

      <div id="jcApprovalModal" style="display:none; position:fixed; inset:0; z-index:9999; background:rgba(15,23,42,.58); backdrop-filter:blur(5px); align-items:center; justify-content:center; padding:20px">
        <div style="width:min(1080px,96vw); max-height:92vh; overflow:hidden; background:#fff; border-radius:24px; box-shadow:0 30px 90px rgba(15,23,42,.35); display:flex; flex-direction:column">
          <div style="padding:18px 22px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; gap:12px; align-items:flex-start">
            <div>
              <div style="font-size:.72rem; font-weight:950; color:#0284c7; letter-spacing:.14em; text-transform:uppercase">Job Card Approval</div>
              <h2 id="jcApprovalModalTitle" style="margin:3px 0 0; color:#0f172a; font-size:1.35rem">Review Plan</h2>
            </div>
            <button type="button" class="btn" onclick="window.closeJcApprovalModal()" style="border-radius:12px"><i class="bi bi-x-lg"></i></button>
          </div>
          <div id="jcApprovalModalBody" style="padding:18px 22px; overflow:auto"></div>
          <div style="padding:14px 22px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap">
            <div id="jcApprovalSignLine" style="color:#475569; font-weight:850"></div>
            <div style="display:flex; gap:10px">
              <button type="button" id="jcApprovalRejectBtn" class="btn" onclick="window.submitJcApproval('REJECTED')" style="background:#fee2e2; color:#b91c1c; border-color:#fecaca; border-radius:12px"><i class="bi bi-x-circle"></i> Reject</button>
              <button type="button" id="jcApprovalApproveBtn" class="btn primary" onclick="window.submitJcApproval('APPROVED')" style="border-radius:12px"><i class="bi bi-shield-check"></i> Approve</button>
            </div>
          </div>
        </div>
      </div>

  <!-- =========================
       NEW CREATE PLAN MODAL (Replaces Old Launcher)
       ========================= -->
  <div id="newCreatePlanModal" class="modal" aria-hidden="true">
    <div class="modal-card cp-modal-card"
      style="width: 1100px; max-width: 95vw; height: 85vh; display: flex; flex-direction: column;">

      <div class="modal-head cp-modal-head">
        <div class="cp-modal-title-wrap">
          <div class="cp-modal-title">
            <span class="cp-modal-icon"><i class="bi bi-calendar-plus"></i></span>
            <span>Create Production Plan</span>
          </div>
          <div class="cp-modal-subtitle">Find the right pending order fast, review mould availability, and build a clean production queue.</div>
        </div>
        <div class="cp-modal-tools">
          <div id="cpProcessFilter" style="min-width:340px" aria-label="Select planning process"></div>
          <div class="search cp-search">
            <i class="bi bi-search"></i>
            <input type="text" id="cpOrderSearch" placeholder="Search OR / JC / Product / Client">
            <button type="button" id="cpSearchClear" class="cp-search-clear" aria-label="Clear search"><i class="bi bi-x-lg"></i></button>
          </div>
          <button class="btn icon ghost cp-close-btn" id="cpClose"><i class="bi bi-x-lg"></i></button>
        </div>
      </div>

      <div class="modal-body cp-modal-body" style="flex:1; display:flex; gap:0; padding:0; overflow:hidden">

        <!-- LEFT: Orders List -->
        <div class="cp-orders-pane">
          <div class="cp-pane-head">
            <div class="cp-pane-kicker">Planning Queue</div>
            <div class="cp-pane-title">Pending Orders</div>
            <div class="cp-pane-copy">Search by order number, JC number, product, client, dates, or quantity to jump to the right job quickly.</div>
          </div>
          <div id="cpOrderList" class="cp-order-list">
            <!-- Items injected here -->
            <div style="padding:20px; text-align:center" class="muted">Loading...</div>
          </div>
          <div id="cpOrderCount" class="cp-order-count">
             Pending Orders
          </div>
        </div>

        <!-- RIGHT: Details & Planning -->
        <div class="cp-detail-pane">

          <!-- Empty State -->
          <div id="cpEmptyState" class="cp-empty-state">
            <div class="cp-empty-icon"><i class="bi bi-stars" style="font-size:2rem"></i></div>
            <div class="cp-empty-title">Select an order to start planning</div>
            <div class="cp-empty-copy">Pick a pending order from the left panel to review mould options, choose a machine, and create a production plan.</div>
          </div>

          <!-- Content State -->
          <div id="cpDetailContent" class="cp-detail-content">

            <!-- Order Header -->
            <div class="cp-order-header">
              <div class="cp-order-header-label">Selected Order</div>
              <div class="cp-order-header-title" id="cpTitleOrderNo"></div>
              <div class="cp-order-header-copy" id="cpTitleProduct"></div>
            </div>

            <div id="cpBatchSetup" style="display:none; flex:0 0 auto; margin:12px 18px 0; border:1px solid #bfdbfe; background:linear-gradient(180deg,#eff6ff,#ffffff); border-radius:18px; padding:14px 16px; overflow:hidden"></div>

            <!-- Moulds List -->
            <div class="cp-section">
              <div class="cp-section-title">Available Moulds</div>
              <div class="cp-section-copy">Review moulding sequence from Mould Master, then choose the right mould family to continue planning.</div>
              <div id="cpSequenceAlert" style="display:none; margin:10px 0 12px"></div>
              <div id="cpSequenceBoard" style="display:none; margin:0 0 12px"></div>
              <div id="cpMouldList" style="display:flex; flex-direction:column; gap:10px">
                <!-- Mould Cards -->
              </div>
            </div>

            <!-- Machine Selector (Dynamic) -->
            <div id="cpMachineSection"
              style="padding:18px; border-top:1px solid rgba(203, 213, 225, 0.8); background:rgba(248,250,252,0.86); display:none">
              <div class="cp-section-title" style="margin-bottom:10px">Select Machine</div>
              <div id="cpSelectedMouldSummary" style="display:none; margin-bottom:12px"></div>
              <div id="cpColourPlanBlock" style="display:none; margin-bottom:12px"></div>
              <div id="cpMachineGuidance" style="display:none; margin-bottom:12px"></div>

              <div style="margin-bottom:10px; font-size:0.9rem">
                Target Tonnage: <span id="cpTargetTonnage" class="tag"
                  style="border-color:#3b82f6; color:#2563eb; background:#eff6ff"></span>
              </div>

              <div id="cpMachineList"
                style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px">
                <!-- Machines -->
              </div>
            </div>

            <!-- QUEUE SECTION (New) -->
            <div id="cpQueueSection" style="padding:18px; border-top:1px solid rgba(203, 213, 225, 0.8); background:linear-gradient(180deg, #f0f9ff, #ecfeff); display:none">
               <div style="font-weight:700; color:#0369a1; margin-bottom:10px; display:flex; justify-content:space-between">
                  <span>PLANS TO CREATE (<span id="cpQueueCount">0</span>)</span>
                  <button class="btn mini ghost" type="button" id="cpClearQueueBtn" style="color:#ef4444">Clear All</button>
               </div>
               <div id="cpQueueList" style="display:flex; flex-direction:column; gap:8px">
                  <!-- Draft Items -->
               </div>
            </div>

          </div>

        </div>
      </div>

      <div class="modal-actions">
        <div style="margin-right:auto; font-size:0.9rem; color:#64748b" id="cpFooterStatus"></div>
        <button class="btn ghost" id="cpCancelBtn">Cancel</button>
        
        <!-- SAVE / ADD TO QUEUE BUTTON -->
        <button class="btn" id="cpAddBtn" style="border:1px solid #cbd5e1; background:#fff; color:#334155" disabled>
           <i class="bi bi-plus-lg"></i> Save & Add Another
        </button>

        <!-- CREATE ALL BUTTON -->
        <button class="btn primary" id="cpSaveBtn" disabled>
          <i class="bi bi-check2-circle"></i> Create Plan
        </button>
      </div>

    </div>
  </div>

      <!-- Preview Modal (Balance / Auto-P1) -->
      <div class="modal" id="previewModal" aria-hidden="true">
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pmTitle">
          <div class="modal-head">
            <div class="row-flex"><i class="bi bi-eye"></i><strong id="pmTitle">Preview</strong></div>
            <button class="btn" id="pmClose" aria-label="Close"><i class="bi bi-x"></i></button>
          </div>
          <div class="modal-body">
            <div class="muted mini" id="pmSub">—</div>
            <div class="list" id="pmList" style="margin-top:8px">
              <div class="row h"><div>#</div><div>Machine</div><div>Orders (proposed)</div><div>Building</div><div>Line</div><div>Count</div></div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" id="pmCancel">Cancel</button>
            <button class="btn primary" id="pmCommit"><i class="bi bi-check2-square"></i> Commit</button>
          </div>
        </div>
      </div>

      <!-- Side sheet (legacy detailed queueing) -->
      <div class="sheet" id="planSheet" aria-hidden="true">
        <div class="sheet-card">
          <div class="sheet-head">
            <div class="row-flex">
              <i class="bi bi-list-check"></i><strong>Plan Queue</strong>
              <span class="chip" id="selMachineChip" style="display:none"></span>
            </div>
            <button class="btn" id="btnCloseSheet" title="Close"><i class="bi bi-x"></i></button>
          </div>
          <div class="sheet-body">
            <div class="row-flex" style="margin-bottom:10px">
              <div class="search"><i class="bi bi-search"></i><input id="ordersSearch" placeholder="Search orders (order no, item, mould)" aria-label="Search orders"/></div>
              <label class="chip select" id="btnSameMould"><i class="bi bi-layers"></i> Same mould</label>
              <label class="chip select" id="btnRefreshOrders"><i class="bi bi-arrow-clockwise"></i> Refresh</label>
            </div>

            <div class="list" id="ordersList">
              <div class="row h">
                <div>✓</div><div>Priority</div><div>Order • Item</div><div>Mould</div><div>Qty</div><div>Age</div>
              </div>
            </div>
            <div class="muted mini" style="margin-top:8px">Queue-first: no dates/shifts — jobs auto-start when the previous job completes.</div>
          </div>
          <div class="sheet-actions">
            <button class="btn primary" id="btnQueueSelected"><i class="bi bi-check2-circle"></i> Queue Selected</button>
          </div>
        </div>
      </div>

      <!-- Machine hover dialog -->
      <div id="hoverCard" class="hover-card" role="dialog" aria-modal="false">
        <div class="hdr">
          <div class="t" id="hcTitle">Machine</div>
          <button class="x" id="hcClose" title="Close dialog"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="r" id="hcLine">—</div>
        <div class="r" id="hcStatus">Status: —</div>
        <div class="r" id="hcJob">Job: —</div>
        <div class="r" id="hcQueue">Queue: —</div>
        <div class="r" id="hcIssue" style="display:none"></div>
        <div class="bar"></div>
        <div class="actions">
          ${canEdit ? `<button class="btn" id="hcPlanBtn" title="Create plan here"><i class="bi bi-plus-circle"></i> Create Plan</button>` : ''}
        </div>
      </div>
    `;

        /* Deep-link views before heavy init (loadMachines etc.) so ?view=print_jc never flashes the dashboard */
        window.applyPlanningPrintJcLayout = function (rootEl) {
          if (!rootEl) return;
          const pjv = rootEl.querySelector('#printJCView');
          if (!pjv) return;
          const vm = rootEl.querySelector('#view-main');
          const mw = rootEl.querySelector('#mapWrap');
          const tb = rootEl.querySelector('#dashboardToolbar');
          const kd = rootEl.querySelector('.kpi-deck');
          ['masterView', 'timelineView', 'productionCompletionReport', 'completedView', 'mouldChangeReport', 'pendingPlanApprovalView'].forEach((id) => {
            const el = rootEl.querySelector('#' + id);
            if (el) el.style.display = 'none';
          });
          if (vm) vm.style.display = 'none';
          if (mw) mw.style.display = 'none';
          if (tb) tb.style.display = 'none';
          if (kd) kd.style.display = 'none';
          pjv.style.display = 'block';
          const pf = rootEl.querySelector('#pjcFrom');
          const pt = rootEl.querySelector('#pjcTo');
          if (pf && pt && !pf.value && !pt.value) {
            const t = new Date();
            const ymd = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
            pf.value = ymd;
            pt.value = ymd;
          }
        };
        if (view === 'print_jc') window.applyPlanningPrintJcLayout(root);

        /* ---------- helpers to render KPI cards with spark ---------- */
        function fmtNum(val) {
          const n = Number(val || 0);
          return Number.isFinite(n) ? n.toLocaleString('en-IN') : '0';
        }

        function kpiCard(icon, label, key) {
          return `
        <div class="kpi-card" data-k="${key}">
          <div class="ico"><i class="bi ${icon}"></i></div>
          <div class="txt">
            <div class="t">${label}</div>
            <div class="v" id="kpi_${key}">—</div>
          </div>
          <div class="right">
            <canvas class="spark" id="spark_${key}" width="120" height="24"></canvas>
            <div class="delta" id="delta_${key}">—</div>
          </div>
        </div>`;
        }
        function setKpi(key, v, deltaPct, trend) {
          const el = document.getElementById('kpi_' + key);
          if (el) el.textContent = fmtNum(v);
          const d = document.getElementById('delta_' + key);
          if (d) {
            const up = (deltaPct || 0) >= 0;
            d.className = 'delta ' + (up ? 'up' : 'down');
            d.textContent = (up ? '+' : '') + (deltaPct || 0) + '% vs last';
          }
          if (trend) drawSpark('spark_' + key, trend);
        }
        function drawSpark(id, arr) {
          try {
            const c = document.getElementById(id); if (!c) return;
            const ctx = c.getContext('2d'); const w = c.width, h = c.height;
            ctx.clearRect(0, 0, w, h);
            const max = Math.max(...arr), min = Math.min(...arr);
            const norm = (v) => h - ((v - min) / (max - min || 1)) * h;
            ctx.lineWidth = 1.5; ctx.beginPath();
            arr.forEach((v, i) => { const x = (w / (arr.length - 1)) * i; const y = norm(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand') || '#60a5fa';
            ctx.stroke();
          } catch { }
        }

        const PLANNING_TIMEZONE = 'Asia/Kolkata';

        function getPlanningGreeting(hour) {
          if (hour >= 5 && hour < 12) return 'Good Morning';
          if (hour >= 12 && hour < 17) return 'Good Afternoon';
          return 'Good Evening';
        }

        function updatePlanningHeroClock() {
          const greetingEl = document.getElementById('planningHeroGreeting');
          const copyEl = document.getElementById('planningHeroCopy');
          const dateChip = document.getElementById('planningDateChip');
          if (!greetingEl || !copyEl || !dateChip) return;

          const user = (window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.getUser)
            ? window.JPSMS.auth.getUser()
            : null;
          const userName = String(user?.full_name || user?.name || user?.username || 'Planning Team')
            .trim()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b\w/g, ch => ch.toUpperCase());

          const hour = Number(new Intl.DateTimeFormat('en-GB', {
            timeZone: PLANNING_TIMEZONE,
            hour: '2-digit',
            hourCycle: 'h23'
          }).format(new Date()));
          const greeting = getPlanningGreeting(hour);
          const fullDate = new Intl.DateTimeFormat('en-IN', {
            timeZone: PLANNING_TIMEZONE,
            dateStyle: 'full',
            timeStyle: 'short'
          }).format(new Date());

          greetingEl.textContent = `${greeting}, ${userName}`;
          copyEl.textContent = 'Manage pending orders, machine loading, and daily planning flow from one clean planning screen.';
          dateChip.innerHTML = `<i class="bi bi-clock-history"></i><span>${fullDate} IST</span>`;
        }

        function getPlanningMachineState(machine) {
          const allPlans = window.allMasterPlans || [];
          const horizonValue = window.horizon !== undefined ? window.horizon : 1;

          const plans = allPlans.filter(plan => {
            const machineCode = String(machine.code || '').trim().toUpperCase();
            const planMachine = String(plan.machine || '').trim().toUpperCase();
            const planStatus = String(plan.status || '').trim().toUpperCase();
            return machineCode && machineCode === planMachine && !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(planStatus);
          }).sort((a, b) => ((a.seq || 0) - (b.seq || 0)) || ((a.id || 0) - (b.id || 0)));

          let activePlan = null;
          if (horizonValue === 0) {
            activePlan = plans.find(plan => String(plan.status || '').trim().toUpperCase() === 'RUNNING') || null;
          } else {
            activePlan = plans[horizonValue - 1] || null;
          }

          if (machine.is_maintenance) return 'maintenance';
          if (activePlan) {
            return String(activePlan.status || '').trim().toUpperCase() === 'RUNNING' ? 'running' : 'planned';
          }

          const raw = String(machine.status || '').trim().toLowerCase();
          if (raw === 'running') return 'running';
          if (raw === 'stopped' || raw === 'off') return 'blocked';
          if (raw === 'maintenance') return 'maintenance';
          return 'available';
        }

        function updatePlanningOverview(list) {
          const scopeChip = document.getElementById('planningScopeChip');
          const filterChip = document.getElementById('planningFilterChip');
          const scopeTitle = document.getElementById('planningScopeTitle');
          const summaryText = document.getElementById('planningSummaryText');
          const visibleEl = document.getElementById('planningVisibleCount');
          const runningEl = document.getElementById('planningRunningCount');
          const plannedEl = document.getElementById('planningPlannedCount');
          const blockedEl = document.getElementById('planningBlockedCount');
          const focusPending = document.getElementById('planningFocusPending');
          const focusFlow = document.getElementById('planningFocusFlow');
          const gridMeta = document.getElementById('planningGridMeta');
          const mapSub = document.getElementById('planningMapSub');

          const building = document.getElementById('buildingFilter')?.value || '';
          const query = (document.getElementById('machineSearch')?.value || '').trim();
          const process = getPlanningProcessFilter();
          const scopeText = building
            ? (process === 'Moulding' ? `Building ${building}` : building)
            : (process === 'Moulding' ? 'All Buildings' : `All ${process} Machines`);
          const horizonText = horizon === 0 ? 'Running slot' : `Plan #${horizon} horizon`;

          let running = 0;
          let planned = 0;
          let blocked = 0;

          (list || []).forEach(machine => {
            const state = getPlanningMachineState(machine);
            if (state === 'running') running += 1;
            else if (state === 'planned') planned += 1;
            else if (state === 'blocked' || state === 'maintenance') blocked += 1;
          });

          const visible = (list || []).length;
          const available = Math.max(visible - running - planned - blocked, 0);
          const filterText = `${process} | ${horizonText}${showInactive ? ' | Showing off and maintenance' : ' | Active machines only'}${query ? ` | Search: ${query}` : ''}`;
          const summary = visible
            ? `${visible} ${process.toLowerCase()} machines visible. ${running} running, ${planned} planned, ${available} available, ${blocked} off or maintenance.`
            : 'No machines match the current planning filters.';

          if (scopeChip) scopeChip.innerHTML = `<i class="bi bi-building"></i><span>${pEsc(scopeText)}</span>`;
          if (filterChip) filterChip.innerHTML = `<i class="bi bi-funnel"></i><span>${pEsc(filterText)}</span>`;
          if (scopeTitle) scopeTitle.textContent = scopeText;
          if (summaryText) summaryText.textContent = summary;
          if (visibleEl) visibleEl.textContent = visible;
          if (runningEl) runningEl.textContent = running;
          if (plannedEl) plannedEl.textContent = planned;
          if (blockedEl) blockedEl.textContent = blocked;
          if (focusFlow) focusFlow.textContent = visible ? 'Machine load is updating live' : 'Adjust filters or show inactive machines';
          if (gridMeta) gridMeta.textContent = summary;
          if (mapSub) mapSub.textContent = summary;
          if (focusPending && /loading/i.test(focusPending.textContent || '')) {
            focusPending.textContent = 'Pending order summary is updating live';
          }
        }

        /* --------------------------- Helpers & Init --------------------------- */
        // 'api' is already in scope from line 1127



        let cpOrders = [];
        window.restoreCompletedPlan = async function(planId) {
        if (!confirm('Are you sure you want to restore this plan to the board? It will become Stopped.')) return;
        try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            const res = await api.post('/planning/restore-plan', { id: planId });
            if (res.ok) {
                if (window.JPSMS && window.JPSMS.toast) window.JPSMS.toast('Plan restored successfully');
                // Drop it from the completed lookup and invalidate the board cache so Create Plan
                // immediately treats this mould as plan-able again.
                if (window.completedPlanKeys) {
                  Object.keys(window.completedPlanKeys).forEach(k => {
                    const v = window.completedPlanKeys[k];
                    if (v && (v.planId === planId || v.id === planId)) delete window.completedPlanKeys[k];
                  });
                }
                if (window._planCache && window._planCache.invalidate) window._planCache.invalidate();
                window.loadProductionCompletionReport();
            } else {
                alert('Error: ' + res.error);
            }
        } catch (e) {
            alert('Error: ' + e.message);
        }
    };

    window.pcrDebounceTimer = null;
        window.cpSelectedOrder = null;
        window.cpOrderMoulds = [];
        window.cpOrderSequenceMeta = null;
        window.cpOrderBatchHistory = [];
        window.cpCurrentBatchQty = null;
        let cpSelectedMould = null;
        let cpSelectedMachine = null;
        let allMachines = [];

        // GLOBAL STORE & DUPLICATE CHECK HELPER
        window.allMasterPlans = [];

        window.isPlanDuplicate = function (orderNo, mouldNameRaw) {
          const normalize = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
          const targetMould = normalize(mouldNameRaw);
          const targetOrder = normalize(orderNo);

          // A Completed plan must never be re-planned. It stays blocked until a Superadmin
          // restores it (which flips status to Stopped and drops it from completedPlanKeys).
          const completedHit = (window.completedPlanKeys || {})[`${targetOrder}|${targetMould}`];
          if (completedHit) return completedHit;

          if (!window.allMasterPlans || !window.allMasterPlans.length) return null;

          return window.allMasterPlans.find(p => {
            const pMould = normalize(p.mouldName || p.mould_name);
            const pOrder = normalize(p.orderNo || p.order_no);
            const status = normalize(p.status);

            // Match Mould AND Order
            // Status must be RUNNING or PLANNED
            // Check both "Running" and "RUNNING" just in case
            const active = ['RUNNING', 'PLANNED'].includes(status);
            return active && pMould === targetMould && pOrder === targetOrder;
          });
        };

        let lastMachines = [];
        let lastOrders = [];
        let lastPreviewAssignments = [];
        let previewMode = 'balance';
        let horizon = 1; // Default to 1st Plan (Sequence #1)
        let showInactive = false;
        let selectedMachine = null;
        let dialogPinned = false;
        let flippedMachineCard = null;
        const PLANNING_PROCESS_OPTIONS = ['Moulding', 'Printing', 'Tuffting'];
        const normalizePlanningProcessValue = (value, fallback = 'Moulding') => {
          const raw = String(value || '').trim();
          if (!raw) return fallback;
          const normalized = raw.toLowerCase().replace(/\s+/g, '');
          if (['moulding', 'molding'].includes(normalized)) return 'Moulding';
          if (['printing', 'print'].includes(normalized)) return 'Printing';
          if (['tuffting', 'tufting', 'tuf', 'tuft'].includes(normalized)) return 'Tuffting';
          return fallback;
        };
        let planningProcess = normalizePlanningProcessValue(
          params.get('process') || localStorage.getItem('jpsms_planning_process') || 'Moulding',
          'Moulding'
        );

        function getPlanningProcessFilter() {
          return planningProcess;
        }

        function getPlanningProcessQuerySuffix() {
          return `process=${encodeURIComponent(getPlanningProcessFilter())}`;
        }

        function renderPlanningProcessSelector(id) {
          const el = document.getElementById(id);
          if (!el) return;

          el.className = (el.className || '')
            .split(/\s+/)
            .filter(Boolean)
            .filter(name => name !== 'planning-process-group')
            .concat('planning-process-group')
            .join(' ');

          el.innerHTML = PLANNING_PROCESS_OPTIONS.map(option => {
            const isActive = option === planningProcess;
            return `<button type="button" class="planning-process-pill${isActive ? ' is-active' : ''}" data-process-option="${option}">${option}</button>`;
          }).join('');

          Array.from(el.querySelectorAll('[data-process-option]')).forEach(btn => {
            btn.addEventListener('click', () => window.setPlanningProcessFilter(btn.dataset.processOption));
          });
        }

        function syncPlanningProcessSelectors() {
          ['planningProcessFilter', 'masterProcessFilter', 'cpProcessFilter'].forEach(id => {
            renderPlanningProcessSelector(id);
          });
        }

        function updatePlanningProcessUrl() {
          const url = new URL(window.location);
          url.searchParams.set('process', planningProcess);
          window.history.replaceState({}, '', url);
        }

        function resetCreatePlanForProcessChange() {
          window.cpSelectedOrder = null;
          cpSelectedMould = null;
          cpSelectedMachine = null;

          const detail = document.getElementById('cpDetailContent');
          const empty = document.getElementById('cpEmptyState');
          const machineSection = document.getElementById('cpMachineSection');
          const queueSection = document.getElementById('cpQueueSection');
          const queueList = document.getElementById('cpQueueList');
          const queueCount = document.getElementById('cpQueueCount');
          const footer = document.getElementById('cpFooterStatus');
          const addBtn = document.getElementById('cpAddBtn');
          const saveBtn = document.getElementById('cpSaveBtn');

          if (detail) detail.style.display = 'none';
          if (empty) empty.style.display = 'flex';
          if (machineSection) machineSection.style.display = 'none';
          if (queueSection) queueSection.style.display = 'none';
          const batchSetup = document.getElementById('cpBatchSetup');
          if (batchSetup) batchSetup.style.display = 'none';
          if (queueList) queueList.innerHTML = '';
          if (queueCount) queueCount.textContent = '0';
          if (footer) footer.textContent = `Process: ${planningProcess}`;
          if (addBtn) addBtn.disabled = true;
          if (saveBtn) saveBtn.disabled = true;
          window.cpCurrentBatchQty = null;
          window.cpOrderBatchHistory = [];
        }

        function getMachineScopeValue(machine) {
          return String(machine?.building || machine?.machine_process || 'General').trim();
        }

        function getMachineLineValue(machine) {
          return String(machine?.line || (machine?.machine_process ? 'Machines' : '1')).trim();
        }

        function refreshMachineBuildingOptions(list = []) {
          const buildingFilterEl = document.getElementById('buildingFilter');
          if (!buildingFilterEl) return;
          const previous = buildingFilterEl.value;
          const values = [...new Set((list || []).map(getMachineScopeValue).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          const defaultLabel = planningProcess === 'Moulding' ? 'All Buildings' : `All ${planningProcess}`;
          buildingFilterEl.innerHTML = `<option value="">${defaultLabel}</option>` + values.map(value => `<option value="${value}">${value}</option>`).join('');
          if (previous && values.includes(previous)) buildingFilterEl.value = previous;
        }

        function getPlanScopeValue(plan) {
          return String(plan?.building || plan?.machineProcess || plan?.machine_process || '').trim();
        }

        function refreshMasterBuildingOptions() {
          return;
        }

        async function refreshPlanningProcessViews() {
          window.allMasterPlans = [];
          syncPlanningProcessSelectors();
          updatePlanningProcessUrl();

          const timelineViewEl = document.getElementById('timelineView');
          const masterViewEl = document.getElementById('masterView');
          const dashboardEl = document.getElementById('view-main');
          const cpModal = document.getElementById('newCreatePlanModal');
          const timelineVisible = timelineViewEl && timelineViewEl.style.display !== 'none';
          const masterVisible = masterViewEl && masterViewEl.style.display !== 'none';
          const dashboardVisible = dashboardEl && dashboardEl.style.display !== 'none';
          const modalOpen = cpModal && cpModal.style.display === 'flex';

          if (modalOpen) {
            resetCreatePlanForProcessChange();
            if (typeof loadCpOrders === 'function') await loadCpOrders();
          }

          if (timelineVisible) {
            if (typeof window.superLoadTimeline === 'function') await window.superLoadTimeline();
            else if (typeof loadTimeline === 'function') await loadTimeline();
          } else if (masterVisible) {
            await loadMasterPlan();
          } else if (dashboardVisible || !timelineVisible) {
            await loadMachines();
          }
        }

        window.getPlanningProcessFilter = getPlanningProcessFilter;
        window.setPlanningProcessFilter = async function (value, options = {}) {
          const nextValue = normalizePlanningProcessValue(value, 'Moulding');
          if (!options.force && nextValue === planningProcess) {
            syncPlanningProcessSelectors();
            return;
          }
          planningProcess = nextValue;
          localStorage.setItem('jpsms_planning_process', planningProcess);
          await refreshPlanningProcessViews();
        };

        // Logic runs immediately as we are already in DOMContentLoaded

        api.get('/planning/kpis').then(res => {
          if (res && res.data) {
            const k = res.data;
            if (document.getElementById('kpiPending')) document.getElementById('kpiPending').textContent = k.pendingOrders || 0;
            if (document.getElementById('kpiInProgress')) document.getElementById('kpiInProgress').textContent = k.inProgress || 0;
          }
        }).catch(e => console.error('KPI Load Error:', e));

        /* View Routing moved to end of script for hoisting safety */


        if (action === 'create') openCreatePlanLauncher();

        // Toggle map
        // Toggle map
        const btnToggleMap = document.getElementById('btnToggleMap');
        if (btnToggleMap) {
          btnToggleMap.addEventListener('click', () => {
            const wrap = document.getElementById('mapWrap');
            const nowOpen = (!wrap.style.display || wrap.style.display === 'none');
            wrap.style.display = nowOpen ? 'block' : 'none';
            wrap.setAttribute('aria-expanded', String(nowOpen));
            if (nowOpen && !lastMachines.length) loadMachines();
            btnToggleMap.innerHTML =
                nowOpen ? '<i class="bi bi-eye-slash"></i> Hide Machine Grid' : '<i class="bi bi-map"></i> Machine Grid';
            toast(nowOpen ? 'Map View' : 'Hidden Map');
          });
        }

        // Horizon & inactive
        document.querySelectorAll('#horizonDays .chip').forEach(chip => {
          if (Number(chip.dataset.day) === horizon) chip.classList.add('active');
          chip.addEventListener('click', () => {
            document.querySelectorAll('#horizonDays .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            horizon = Number(chip.dataset.day); // Allow 0
            if (isNaN(horizon)) horizon = 1;
            window.horizon = horizon; // SYNC GLOBAL for machineSeat
            loadMachines();
          });
          chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') chip.click(); });
        });


        const toggleInactive = document.getElementById('toggleInactive');
        if (toggleInactive) {
          toggleInactive.addEventListener('click', () => {
            showInactive = !showInactive;
            toggleInactive.classList.toggle('active', showInactive);
            renderFilteredGrid();
          });
        }

        // Filters
        const buildingFilter = document.getElementById('buildingFilter');
        if (buildingFilter) buildingFilter.addEventListener('change', renderFilteredGrid);

        syncPlanningProcessSelectors();
        updatePlanningProcessUrl();

        const machineSearch = document.getElementById('machineSearch');
        if (machineSearch) machineSearch.addEventListener('input', renderFilteredGrid);

        // Factory scope change → refresh map if open
        document.addEventListener('factory:change', () => {
          const mw = document.getElementById('mapWrap');
          if (mw && mw.style.display === 'block') loadMachines();
        });

        // Create Plan entry (Safeguard)
        const btnCreatePlan = document.getElementById('btnCreatePlan');
        if (btnCreatePlan) btnCreatePlan.addEventListener('click', openCreatePlanLauncher);

        // Balance + AutoP1
        const btnBalance = document.getElementById('btnBalance');
        if (btnBalance) btnBalance.addEventListener('click', balanceLoad);

        const btnAutoP1 = document.getElementById('btnAutoP1');
        if (btnAutoP1) btnAutoP1.addEventListener('click', autoAssignP1);

        // Sheet (legacy plan editor)
        const planSheet = document.getElementById('planSheet');
        const btnCloseSheet = document.getElementById('btnCloseSheet');
        if (btnCloseSheet && planSheet) btnCloseSheet.onclick = () => planSheet.style.display = 'none';

        const btnRefreshOrders = document.getElementById('btnRefreshOrders');
        if (btnRefreshOrders) btnRefreshOrders.onclick = loadPendingOrders;

        const btnQueueSelected = document.getElementById('btnQueueSelected');
        if (btnQueueSelected) btnQueueSelected.onclick = queueSelected;

        const btnSameMould = document.getElementById('btnSameMould');
        if (btnSameMould) btnSameMould.onclick = selectSameMould;

        const ordersSearch = document.getElementById('ordersSearch');
        if (ordersSearch) ordersSearch.addEventListener('input', (e) => renderOrdersList(filterOrders(e.target.value)));

        // Machine hover dialog
        const hc = document.getElementById('hoverCard');
        const hcPlanBtn = document.getElementById('hcPlanBtn');
        if (hcPlanBtn) {
          hcPlanBtn.addEventListener('click', () => {
            if (!selectedMachine) return;
            // Block planning if machine is under a live DPR problem (Mould Changeover, Maintenance, etc.)
            if (selectedMachine.live_status === 'stopped' && selectedMachine.live_problem) {
              return toast(`Cannot plan: machine is currently under "${selectedMachine.live_problem}"`);
            }
            if (selectedMachine.is_maintenance || ['off', 'stopped'].includes((selectedMachine.status || '').toLowerCase())) {
              return toast('Cannot plan on a maintenance/off machine');
            }
            openPlanSheet();
          });
        }
        // Hover Helpers
        function hideHover() {
          const h = document.getElementById('hoverCard');
          if (h) h.style.display = 'none';
        }

        function toggleMachineCardFlip(card) {
          if (!card) return;
          hideHover();

          const willFlip = !card.classList.contains('is-flipped');
          if (flippedMachineCard && flippedMachineCard !== card) {
            flippedMachineCard.classList.remove('is-flipped');
            flippedMachineCard.setAttribute('aria-pressed', 'false');
          }

          card.classList.toggle('is-flipped', willFlip);
          card.setAttribute('aria-pressed', willFlip ? 'true' : 'false');
          flippedMachineCard = willFlip ? card : null;
        }

        function showHover(ev, m, pin) {
          const h = document.getElementById('hoverCard');
          if (!h) return;
          // Logic to populate hover card would go here, for now just prevent error
          // If full implementation is needed, it should be added.
          // For now, let's just make sure it doesn't crash functionality.
        }
        function moveHover(ev) {
          // Stub
        }

        document.getElementById('hcClose').addEventListener('click', hideHover);
        hc.addEventListener('mouseenter', () => { dialogPinned = true; });
        hc.addEventListener('mouseleave', () => { dialogPinned = false; });
        document.addEventListener('click', (ev) => {
          if (!ev.target.closest('.machine') && flippedMachineCard) {
            flippedMachineCard.classList.remove('is-flipped');
            flippedMachineCard.setAttribute('aria-pressed', 'false');
            flippedMachineCard = null;
          }
        });

        /* Global bridge so the inline onclick on View Details button can call openPlanJobDetail
           without relying on event bubbling through 3D-transformed elements */
        window._pjdOpen = function(btn) {
          if (typeof window.openPlanJobDetail === 'function') {
            window.openPlanJobDetail(
              btn.dataset.order, btn.dataset.machine,
              btn.dataset.planid, btn.dataset.item, btn.dataset.client
            );
          }
        };

        /* -------- Plan Job Detail Modal -------- */
        window.openPlanJobDetail = async function(orderNo, machineName, planId, itemName, clientName) {
          if (!orderNo || orderNo === '-' || orderNo === 'No active order') return;
          const modal = document.getElementById('planJobDetailModal');
          if (!modal) return;

          // Reset
          const _s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
          _s('pjdProduct', itemName || '…');
          _s('pjdMachine', machineName || '…');
          _s('pjdOrder', orderNo);
          _s('pjdClient', clientName || '…');
          _s('pjdJC', '…'); _s('pjdPlanQty', '…'); _s('pjdProduced', '…'); _s('pjdRej', '…'); _s('pjdBalance', '…');
          document.getElementById('pjdColourTable').innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:#64748b;font-size:0.85rem">Loading…</td></tr>';
          document.getElementById('pjdQCBox').innerHTML = '<div style="color:#64748b;font-size:0.85rem">Loading QC data…</div>';
          document.getElementById('pjdDTBox').innerHTML = '';
          document.getElementById('pjdRejBox').innerHTML = '';
          modal.style.display = 'flex';

          // Fetch main stats
          try {
            const qs = new URLSearchParams({ mode: 'overall' });
            if (machineName) qs.set('machine', machineName);
            if (planId) qs.set('planId', planId);
            const ans = await api.get(`/analyze/order/${encodeURIComponent(orderNo)}?${qs.toString()}`);
            if (ans.ok && ans.data) {
              const info = ans.data.info || {};
              const totals = ans.data.totals || {};
              const colStats = ans.data.colour_stats || {};
              const dtStats = ans.data.downtime_stats || {};
              const rejStats = ans.data.rejection_stats || {};

              _s('pjdProduct', info.product_name || info.item_name || itemName || '-');
              _s('pjdMachine', info.machine || machineName || '-');
              _s('pjdOrder', info.order_no || orderNo);
              _s('pjdClient', info.client_name || clientName || '-');
              _s('pjdJC', info.job_card_no || '-');
              const planQty = Number(totals.plan || info.plan_qty || 0);
              const produced = Number(totals.good || 0);
              const rej = Number(totals.rej || 0);
              const bal = Math.max(0, planQty - produced);
              _s('pjdPlanQty', planQty.toLocaleString('en-IN'));
              _s('pjdProduced', produced.toLocaleString('en-IN'));
              _s('pjdRej', rej.toLocaleString('en-IN'));
              _s('pjdBalance', bal.toLocaleString('en-IN'));

              // Colour table — filter out colours with zero plan AND zero production
              const DOT_COLOURS = ['#3b82f6','#ef4444','#f59e0b','#22c55e','#a855f7','#06b6d4','#f97316','#ec4899','#84cc16','#6366f1'];
              const allColours = Object.entries(colStats);
              const colours = allColours.filter(([, s]) => Number(s.plan_qty || 0) > 0 || Number(s.good_qty || 0) > 0);
              if (colours.length) {
                document.getElementById('pjdColourTable').innerHTML = colours.map(([col, s], idx) => {
                  const p = Number(s.plan_qty || 0), g = Number(s.good_qty || 0), r = Number(s.rej_qty || 0), b = Math.max(0, p - g);
                  const pct = p > 0 ? Math.round(g / p * 100) : (g > 0 ? 100 : 0);
                  const dot = DOT_COLOURS[idx % DOT_COLOURS.length];
                  const barW = Math.min(100, pct);
                  return `<tr style="border-bottom:1px solid #f1f5f9">
                    <td style="padding:7px 8px;font-weight:700;font-size:0.82rem">
                      <span style="display:inline-flex;align-items:center;gap:6px">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dot};flex-shrink:0"></span>
                        ${esc(col)}
                      </span>
                    </td>
                    <td style="padding:7px 8px;text-align:right;color:#475569;font-weight:700">${p > 0 ? p.toLocaleString('en-IN') : '<span style="color:#cbd5e1">—</span>'}</td>
                    <td style="padding:7px 8px;text-align:right;font-weight:800;color:#15803d">
                      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
                        <span style="font-size:0.88rem">${g.toLocaleString('en-IN')}</span>
                        <div style="width:72px;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden">
                          <div style="height:100%;width:${barW}%;background:${dot};border-radius:3px;transition:width 0.4s"></div>
                        </div>
                      </div>
                    </td>
                    <td style="padding:7px 8px;text-align:right;font-weight:800;color:${b>0?'#d97706':'#64748b'}">${b > 0 ? b.toLocaleString('en-IN') : '<span style="color:#22c55e;font-size:0.85rem">✓ Done</span>'}</td>
                    <td style="padding:7px 8px;text-align:right;font-weight:800;color:${pct>=100?'#15803d':pct>0?'#0284c7':'#94a3b8'}">${pct}%</td>
                  </tr>`;
                }).join('') + `<tr style="background:#f8fafc;font-weight:900;border-top:2px solid #e2e8f0">
                  <td style="padding:7px 8px;font-size:0.82rem">TOTAL</td>
                  <td style="padding:7px 8px;text-align:right">${planQty.toLocaleString('en-IN')}</td>
                  <td style="padding:7px 8px;text-align:right;color:#15803d">${produced.toLocaleString('en-IN')}</td>
                  <td style="padding:7px 8px;text-align:right;color:${bal>0?'#d97706':'#22c55e'}">${bal.toLocaleString('en-IN')}</td>
                  <td style="padding:7px 8px;text-align:right;color:${planQty>0?'#0284c7':'#94a3b8'}">${planQty > 0 ? Math.round(produced/planQty*100) : 0}%</td>
                </tr>`;
              } else {
                document.getElementById('pjdColourTable').innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8;font-size:0.85rem">No colour data yet</td></tr>';
              }

              // Downtime
              const dtList = Array.isArray(dtStats.reasons) ? dtStats.reasons : Object.entries(dtStats).map(([k,v])=>({reason:k,minutes:v}));
              const totalDT = Number(dtStats.total_minutes || dtStats.total || dtList.reduce((s,r)=>s+Number(r.minutes||0),0) || 0);
              if (totalDT > 0 || dtList.length) {
                const maxDT = Math.max(...dtList.map(r=>Number(r.minutes||0)), 1);
                document.getElementById('pjdDTBox').innerHTML = `
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <span style="font-weight:900;font-size:0.9rem;color:#0f172a">Downtime Analysis</span>
                    <span style="background:#fef3c7;border:1px solid #fde68a;border-radius:999px;padding:2px 10px;font-size:0.8rem;font-weight:800;color:#92400e">${Math.round(totalDT)} min</span>
                  </div>
                  ${dtList.map(r=>{const pct=Math.round(Number(r.minutes||0)/maxDT*100);return`<div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:6px"><span style="color:#334155;font-weight:600">${esc(String(r.reason||r.label||'-'))}</span><span style="color:#92400e;font-weight:800">${Math.round(Number(r.minutes||0))} min</span></div><div style="background:#fed7aa;border-radius:4px;height:6px;margin-bottom:4px;overflow:hidden"><div style="background:#f97316;height:100%;border-radius:4px;width:${pct}%"></div></div>`;}).join('')}`;
              }

              // Rejection
              const rejList = Array.isArray(rejStats.reasons) ? rejStats.reasons : Object.entries(rejStats).filter(([k])=>k!=='total'&&k!=='total_qty').map(([k,v])=>({reason:k,qty:v}));
              const totalRejQty = Number(rejStats.total_qty || rejStats.total || rejList.reduce((s,r)=>s+Number(r.qty||0),0) || rej);
              if (totalRejQty > 0 || rejList.length) {
                const maxRej = Math.max(...rejList.map(r=>Number(r.qty||0)), 1);
                document.getElementById('pjdRejBox').innerHTML = `
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <span style="font-weight:900;font-size:0.9rem;color:#0f172a">Rejection Analysis</span>
                    <span style="background:#fee2e2;border:1px solid #fecaca;border-radius:999px;padding:2px 10px;font-size:0.8rem;font-weight:800;color:#b91c1c">${totalRejQty} qty</span>
                  </div>
                  ${rejList.map(r=>{const pct=Math.round(Number(r.qty||0)/maxRej*100);return`<div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:6px"><span style="color:#334155;font-weight:600">${esc(String(r.reason||r.label||'-'))}</span><span style="color:#b91c1c;font-weight:800">${Number(r.qty||0)} qty</span></div><div style="background:#fecaca;border-radius:4px;height:6px;margin-bottom:4px;overflow:hidden"><div style="background:#ef4444;height:100%;border-radius:4px;width:${pct}%"></div></div>`;}).join('')}`;
              }
            }
          } catch(e) {
            document.getElementById('pjdColourTable').innerHTML = `<tr><td colspan="5" style="padding:12px;text-align:center;color:#b91c1c">Failed to load: ${esc(e.message)}</td></tr>`;
          }

          // Fetch QC evidence
          try {
            const qqs = new URLSearchParams({ limit: '50' });
            if (planId) qqs.set('planId', planId);
            if (machineName) qqs.set('machine', machineName);
            const qres = await fetch(`/api/qc/job-checks?${qqs.toString()}`);
            const qjson = await qres.json();
            const rows = qjson.ok && Array.isArray(qjson.data) ? qjson.data : [];
            const weights = rows.flatMap(r=>[r.qc_weight_1,r.qc_weight_2,r.qc_weight_3]).filter(v=>v!=null&&String(v)!=='').slice(0,3);
            const fpaSrc = rows.find(r=>r.fpa_form_image||(Array.isArray(r.product_images)&&r.product_images.length));
            const fpaImgs = fpaSrc ? [fpaSrc.fpa_form_image,...(Array.isArray(fpaSrc.product_images)?fpaSrc.product_images:[])].filter(Boolean) : [];
            const supW = rows.find(r=>r.supervisor_weight)?.supervisor_weight || rows.find(r=>r.act_weight)?.act_weight || '-';
            const stdW = rows.find(r=>r.std_weight)?.std_weight || '-';
            document.getElementById('pjdQCBox').innerHTML = `
              <h4 style="font-size:0.95rem;font-weight:900;color:#0f172a;margin:0 0 10px">QC</h4>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:${fpaImgs.length?'14px':'0'}">
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px">
                  <div style="font-size:0.65rem;color:#64748b;font-weight:800;text-transform:uppercase">STD Weight</div>
                  <div style="font-weight:800;color:#0f172a;font-size:1rem">${esc(String(stdW))}</div>
                </div>
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px">
                  <div style="font-size:0.65rem;color:#1d4ed8;font-weight:800;text-transform:uppercase">Supervisor</div>
                  <div style="font-weight:800;color:#1e3a8a;font-size:1rem">${esc(String(supW))}</div>
                </div>
                ${[0,1,2].map(i=>`<div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:10px;padding:10px">
                  <div style="font-size:0.65rem;color:#047857;font-weight:800;text-transform:uppercase">QC Weight ${i+1}</div>
                  <div style="font-weight:800;color:#064e3b;font-size:1rem">${esc(String(weights[i]||'-'))}</div>
                </div>`).join('')}
              </div>
              ${fpaImgs.length ? `
                <div style="font-size:0.85rem;color:#334155;font-weight:800;margin-bottom:8px">FPA Images</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
                  ${fpaImgs.map((src,i)=>`<button type="button" onclick="window.open(decodeURIComponent('${encodeURIComponent(src)}'),'_blank')"
                    style="display:block;padding:0;border:2px solid #e2e8f0;background:#f8fafc;cursor:zoom-in;border-radius:10px;overflow:hidden;width:100%;transition:border-color 0.2s,transform 0.2s"
                    onmouseover="this.style.borderColor='#93c5fd';this.style.transform='scale(1.02)'"
                    onmouseout="this.style.borderColor='#e2e8f0';this.style.transform='scale(1)'">
                    <img src="${src.replace(/"/g,'&quot;')}" alt="FPA ${i+1}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:8px">
                  </button>`).join('')}
                </div>` : '<div style="color:#64748b;font-size:0.82rem;margin-top:6px">No FPA images saved yet.</div>'}`;
          } catch(e) {
            document.getElementById('pjdQCBox').innerHTML = `<div style="color:#b91c1c;font-size:0.82rem">QC data unavailable</div>`;
          }
        };

        window.closePlanJobDetail = function() {
          const modal = document.getElementById('planJobDetailModal');
          if (modal) modal.style.display = 'none';
        };

        /* ---------------------- KPIs ---------------------- */
        async function loadKPIs() {
          try {
            const k = await api.get('/planning/kpis');
            setKpi('pending', k.total_pending_orders, +k.pending_delta_pct || 0, k.pending_trend || [4, 5, 6, 6, 7, 5, 4]);
            setKpi('inprog', k.in_progress_moulding, +k.inprog_delta_pct || 0, k.inprog_trend || [2, 3, 3, 4, 5, 5, 5]);
            setKpi('variance', k.date_variance_above_3pct, +k.variance_delta_pct || -2, k.variance_trend || [3, 3, 2, 2, 1, 2, 2]);
            setKpi('upcoming', k.total_upcoming_orders, +k.upcoming_delta_pct || 1, k.upcoming_trend || [6, 6, 7, 8, 7, 7, 9]);

            const pendingFocus = document.getElementById('planningFocusPending');
            if (pendingFocus) {
              pendingFocus.textContent = `${Number(k.total_pending_orders || 0).toLocaleString('en-IN')} pending orders need planning attention`;
            }

            // If data is real (not demo), hide demo badge if it was showing
            const demo = document.getElementById('demoBadge');
            if (demo && k && !k.is_demo) demo.style.display = 'none';

          } catch {
            // Fallback to zeros on error, NO DEMO DATA
            setKpi('pending', 0, 0, []);
            setKpi('inprog', 0, 0, []);
            setKpi('variance', 0, 0, []);
            setKpi('upcoming', 0, 0, []);
            const demo = document.getElementById('demoBadge'); if (demo) demo.style.display = 'none';
            updatePlanningOverview([]);
            const pendingFocus = document.getElementById('planningFocusPending');
            if (pendingFocus) pendingFocus.textContent = 'Planning KPIs are unavailable right now';
          }
        }

        /* ------------------ Timeline Logic ------------------ */
        // --- Modal Logic ---
        window.openModal = function (id) {
          const el = document.getElementById(id);
          if (el) {
            el.classList.add('active');
            el.style.display = 'flex'; // Ensure flex for centering
            el.setAttribute('aria-hidden', 'false');
          }
        };

        window.closeModal = function (id) {
          const el = document.getElementById(id);
          if (el) {
            el.classList.remove('active');
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
          }
        };

        // --- Global Init ---
        // We will attach these to window to ensure access from HTML onclicks

        // --- MASTER PLAN GLOBAL ACTIONS ---
        window.deleteAllPlans = async function () {
          if (!confirm('ARE YOU SURE?\n\nThis will DELETE ALL PLANS from the board.\nThis action cannot be undone.')) return;
          const key = prompt('Type "DELETE" to confirm clearing the board:');
          if (key !== 'DELETE') return toast('Invalid confirmation', 'error');

          try {
            toast('Deleting all plans...');
            const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);

            // Direct Backend Truncate for 100% Reliability
            await $api.post('/planning/delete-all', {});

            toast('ALL plans deleted');
            loadMasterPlan();
          } catch (e) {
            console.error(e);
            toast('Error deleting: ' + e.message, 'error');
          }
        };

        window.activatePlan = async function (id, orderNo) {
          if (!confirm(`Activate Plan for Order ${orderNo}?`)) return;
          try {
            const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);
            await $api.post('/planning/run', { rowId: id });
            toast('Plan Activated');
            loadMasterPlan();
          } catch (e) {
            toast('Error: ' + (e.response?.data?.error || e.message), 'error');
          }
        };

        window.stopPlan = async function (id) {
          if (!confirm('Stop this plan?')) return;
          try {
            const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);
            await $api.post('/planning/stop', { rowId: id });
            toast('Plan Stopped');
            loadMasterPlan();
          } catch (e) {
            toast('Error: ' + e.message, 'error');
          }
        };

        // removePlan consolidated below


        window.viewPlan = function (id) {
          const plan = (window.allMasterPlans || []).find(p => String(p.id) === String(id));
          if (!plan) return toast('Plan not found in memory', 'error');

          const modalId = 'viewPlanModal';
          const old = document.getElementById(modalId);
          if (old) old.remove();

          const safeHtml = (str) => String(str || '-');

          const markup = `
            <div id="${modalId}" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px)">
                 <div style="background:white; padding:0; border-radius:12px; width:500px; max-width:90%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); overflow:hidden; animation: popIn 0.2s ease-out">
                     <div style="padding:16px 24px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center">
                        <div style="font-weight:700; color:#0f172a; font-size:1.1rem">Plan Details</div>
                        <button class="btn icon ghost" onclick="document.getElementById('${modalId}').remove()"><i class="bi bi-x-lg"></i></button>
                     </div>
                     <div style="padding:24px">
                        <div style="margin-bottom:16px; display:flex; gap:12px">
                             <div style="flex:1">
                                <div class="mini">Order No</div>
                                <div style="font-weight:700; font-size:1.1rem">${safeHtml(plan.orderNo)}</div>
                             </div>
                             <div style="text-align:right">
                                <div class="mini">Priority</div>
                                <div class="tag ${safeHtml(plan.priority)}">${safeHtml(plan.priority)}</div>
                             </div>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px">
                            <div><div class="mini">Item Code</div><div style="font-weight:600">${safeHtml(plan.itemName)}</div></div>
                            <div><div class="mini">Mould</div><div style="font-weight:600">${safeHtml(plan.mouldName)}</div></div>
                            <div><div class="mini">Machine</div><div style="font-weight:600">${safeHtml(plan.machine)}</div></div>
                            <div><div class="mini">Plan Qty</div><div style="font-weight:600">${Number(plan.planQty).toLocaleString()}</div></div>
                        </div>

                        <div style="margin-top:20px; padding-top:16px; border-top:1px solid #f1f5f9; display:flex; flex-direction:column; gap:8px">
                             <div style="display:flex; justify-content:space-between">
                                <span class="mini">Status</span>
                                <span style="font-weight:700; color:${plan.status === 'Running' ? 'var(--ok)' : '#64748b'}">${safeHtml(plan.status)}</span>
                             </div>
                             <div style="display:flex; justify-content:space-between">
                                <span class="mini">Start Date</span>
                                <span>${plan.startDate ? new Date(plan.startDate).toLocaleString() : '-'}</span>
                             </div>
                        </div>
                     </div>
                     <div style="padding:16px 24px; background:#f8fafc; border-top:1px solid #e2e8f0; text-align:right">
                        <button class="btn" onclick="document.getElementById('${modalId}').remove()">Close</button>
                     </div>
                 </div>
            </div>`;
          document.body.insertAdjacentHTML('beforeend', markup);
        };
        // We will attach these to window to ensure access from HTML onclickss
        window.timelineMachines = [];
        window.timelineGroups = {};

        // loadTimeline moved below helpers to fix hoisting issues

        window.populateTimelineFilters = function () {
          const bldgs = new Set();
          const lines = new Set();
          window.timelineMachines.forEach(m => {
            if (m.building) bldgs.add(m.building);
            if (m.line) lines.add(m.line);
          });

          const bSel = document.getElementById('filt-bldg');
          const lSel = document.getElementById('filt-line');
          if (!bSel || !lSel) return;

          const oldB = bSel.value;
          const oldL = lSel.value;

          bSel.innerHTML = '<option value="">Building...</option>' +
            [...bldgs].sort().map(b => `<option value="${b}">${b}</option>`).join('');

          lSel.innerHTML = '<option value="">Line...</option>' +
            [...lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(l => `<option value="${l}">${l}</option>`).join('');

          bSel.value = oldB;
          lSel.value = oldL;
        };

        window.resetTimelineFilters = function () {
          const b = document.getElementById('filt-bldg');
          if (b) b.value = '';
          const l = document.getElementById('filt-line');
          if (l) l.value = '';
          const s = document.getElementById('filt-status');
          if (s) s.value = '';
          const se = document.getElementById('filt-search');
          if (se) se.value = '';
          window.filterTimeline();
        };

        window.filterTimeline = function () {
          const bEl = document.getElementById('filt-bldg');
          const lEl = document.getElementById('filt-line');
          const sEl = document.getElementById('filt-status');
          const qEl = document.getElementById('filt-search');

          if (!bEl) return;

          const bVal = bEl.value;
          const lVal = lEl.value;
          const sVal = sEl.value;
          const qVal = (qEl.value || '').toLowerCase();

          const con = document.getElementById('timelineContainer');
          console.log('[FilterTimeline] Container found:', !!con);
          if (con) con.innerHTML = '';
          else console.error('[FilterTimeline] Container NOT found!');

          const filtered = window.timelineMachines.filter(m => {
            if (bVal && m.building !== bVal) return false;
            if (lVal && m.line !== lVal) return false;

            const mPlans = window.timelineGroups[m.code] || [];
            if (sVal === 'Running') {
              const hasActive = mPlans.some(p => p.status === 'active' || p.status === 'running');
              if (mPlans.length === 0) return false;
            }
            if (sVal === 'Stopped') {
              if (mPlans.length > 0) return false;
            }
            if (sVal === 'Planned') {
              if (mPlans.length === 0) return false;
            }
            if (sVal === 'MouldChange') {
              // Check if any plan has a mould different from the previous one
              const hasChange = mPlans.some((p, i) => {
                if (i === 0) return false; // First plan has no previous to compare
                const curr = (p.mouldNo || p.mould_code || '').trim();
                const prev = (mPlans[i - 1].mouldNo || mPlans[i - 1].mould_code || '').trim();
                return curr && prev && curr !== prev;
              });
              if (!hasChange) return false;
            }

            if (qVal) {
              // Match Machine Code
              if (m.code.toLowerCase().includes(qVal)) return true;

              const hit = mPlans.some(p => {
                const combined = `
                    ${p.orderNo || p.or_no || ''} 
                    ${p.clientName || p.client || ''} 
                    ${p.jcNo || ''} 
                    ${p.mouldName || p.mould_name || ''} 
                    ${p.mouldNo || p.mould_code || ''} 
                    ${p.itemName || p.item_name || ''}
                    ${p.priority || ''}
                 `.toLowerCase();
                return combined.includes(qVal);
              });

              if (!hit) return false;
            }
            return true;
          });

          window.renderTimelineRows(filtered);
        };

        // --- Drag and Drop Logic ---
        window.draggedPlan = null;

        // Inject Styles dynamically
        const dndStyle = document.createElement('style');
        dndStyle.textContent = `
          .timeline-track { transition: background-color 0.2s, outline 0.1s; }
          .timeline-track.drag-over {
              background-color: #f0fdf4 !important; 
              outline: 2px dashed #22c55e;
              outline-offset: -2px;
          }
          .timeline-card.dragging {
              opacity: 0.5;
              transform: scale(0.95);
          }
          /* Position number badge on each timeline card */
          .tl-pos-badge {
              position: absolute; top: -9px; left: -9px; z-index: 6;
              min-width: 22px; height: 22px; padding: 0 6px;
              background: #1d4ed8; color: #fff; border-radius: 11px;
              font-size: 0.74rem; font-weight: 800; line-height: 22px;
              text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.35);
              border: 2px solid #fff; pointer-events: none;
          }
          /* Live insertion indicator shown while dragging */
          .tl-drop-indicator {
              width: 6px; align-self: stretch; flex-shrink: 0; margin: 6px 2px;
              border-radius: 4px; position: relative; pointer-events: none;
              background: linear-gradient(#22c55e, #16a34a);
              box-shadow: 0 0 10px rgba(34,197,94,0.85);
              animation: tlDropPulse 0.9s ease-in-out infinite;
          }
          @keyframes tlDropPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
          .tl-drop-indicator .tl-drop-num {
              position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
              min-width: 22px; height: 22px; padding: 0 6px; line-height: 22px;
              background: #16a34a; color: #fff; border-radius: 11px;
              font-size: 0.74rem; font-weight: 800; text-align: center;
              border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.3); white-space: nowrap;
          }
          @keyframes blinkBorder { 0% { border-color: #ef4444; box-shadow:0 0 5px #ef4444; } 50% { border-color: #fca5a5; box-shadow:none; } 100% { border-color: #ef4444; box-shadow:0 0 5px #ef4444; } }
          .blink-urgent-border {
             animation: blinkBorder 1.5s infinite;
             border-left-color: #ef4444 !important;
             border-left-width: 6px !important;
          }
        `;
        document.head.appendChild(dndStyle);

        window.handleDragStart = function (e, el) {
          if (!JPSMS.auth.can('planning', 'edit')) {
            e.preventDefault();
            JPSMS.toast('Read Only Mode: You cannot move plans.', 'error');
            return false;
          }
          e.dataTransfer.effectAllowed = 'move';
          // Store minimal data
          window.draggedPlan = {
            id: el.dataset.pid,
            machine: el.dataset.machine,
            el: el // visual Ref
          };
          e.dataTransfer.setData('text/plain', JSON.stringify(window.draggedPlan));
          el.classList.add('dragging');
        };

        window.handleDragEnd = function (e, el) {
          if (el) el.classList.remove('dragging');
          window.draggedPlan = null;
          window._tlDropTarget = null;
          window.tlClearDropIndicator();
          // Cleanup any stuck drag-overs
          document.querySelectorAll('.timeline-track.drag-over').forEach(t => t.classList.remove('drag-over'));
        };

        // Single reusable insertion indicator element
        window.tlGetDropIndicator = function () {
          let ind = document.getElementById('tl-drop-indicator');
          if (!ind) {
            ind = document.createElement('div');
            ind.id = 'tl-drop-indicator';
            ind.className = 'tl-drop-indicator';
            ind.innerHTML = '<span class="tl-drop-num"></span>';
          }
          return ind;
        };
        window.tlClearDropIndicator = function () {
          const ind = document.getElementById('tl-drop-indicator');
          if (ind && ind.parentNode) ind.parentNode.removeChild(ind);
        };

        // Compute where the dragged card would land and show the numbered indicator.
        window.handleDragOver = function (e, track) {
          if (e.preventDefault) e.preventDefault(); // Allows dropping
          e.dataTransfer.dropEffect = 'move';
          track.classList.add('drag-over');

          const draggingId = window.draggedPlan ? String(window.draggedPlan.id) : null;
          // Horizontal track: order cards left→right, skip the one being dragged and the indicator.
          const cards = Array.from(track.querySelectorAll('.timeline-card'))
            .filter(c => String(c.dataset.pid) !== draggingId);

          const x = e.clientX;
          let beforeCard = null;
          for (const c of cards) {
            const r = c.getBoundingClientRect();
            if (x < r.left + r.width / 2) { beforeCard = c; break; }
          }

          const ind = window.tlGetDropIndicator();
          let position;
          if (beforeCard) {
            track.insertBefore(ind, beforeCard);
            position = cards.indexOf(beforeCard) + 1;
            window._tlDropTarget = { machine: track.dataset.machine, beforeId: beforeCard.dataset.pid, position };
          } else {
            track.appendChild(ind);
            position = cards.length + 1;
            window._tlDropTarget = { machine: track.dataset.machine, beforeId: null, position };
          }
          const numEl = ind.querySelector('.tl-drop-num');
          if (numEl) numEl.textContent = position;
          return false;
        };

        window.handleDragLeave = function (e, track) {
          // Only clear when the cursor actually leaves the track (not when moving over child cards)
          const to = e.relatedTarget;
          if (to && track.contains(to)) return;
          track.classList.remove('drag-over');
          window.tlClearDropIndicator();
        };

        window.handleDrop = function (e, track) {
          e.preventDefault();
          e.stopPropagation();
          track.classList.remove('drag-over');
          window.tlClearDropIndicator();
          const cardBeingDragged = document.querySelector('.timeline-card.dragging');
          if (cardBeingDragged) cardBeingDragged.classList.remove('dragging');

          if (!JPSMS.auth.can('planning', 'edit')) {
            JPSMS.toast('Read Only Mode: You cannot move plans.', 'error');
            return false;
          }

          const targetMachine = track.dataset.machine;
          // Prevent dropping if no drag source
          if (!window.draggedPlan) return false;

          // Use the precomputed insertion target (from handleDragOver) for exact positioning.
          const target = window._tlDropTarget || {};
          let dropBeforeId = (target.machine === targetMachine) ? (target.beforeId || null) : null;
          let position = (target.machine === targetMachine) ? (target.position || null) : null;

          // Fallback: if no precomputed target, infer from the card under the cursor.
          if (!target.machine) {
            const card = e.target.closest('.timeline-card');
            if (card) {
              if (String(card.dataset.pid) === String(window.draggedPlan.id)) return false;
              dropBeforeId = card.dataset.pid;
            }
          }

          // Dropping exactly where it already is → no-op
          if (dropBeforeId && String(dropBeforeId) === String(window.draggedPlan.id)) return false;

          const planDetails = window.draggedPlan;
          window.confirmMove(planDetails, targetMachine, dropBeforeId, position);
          return false;
        };

        window.confirmMove = function (planData, targetMachine, dropBeforeId, position) {
          const modalId = 'moveConfirmModal';
          let modal = document.getElementById(modalId);
          if (modal) modal.remove();

          const isReorder = (planData.machine === targetMachine);
          const title = isReorder ? 'Confirm Reorder' : 'Confirm Move';
          const posTag = (position != null && position !== '')
            ? ` to position <strong style="color:#fff; background:#16a34a; padding:2px 9px; border-radius:11px">#${position}</strong>`
            : '';
          const msg = isReorder
            ? `Reorder this plan${posTag} within <strong>${targetMachine}</strong>?`
            : `Move plan${posTag} to machine <strong style="color:#0f172a; background:#f1f5f9; padding:2px 6px; border-radius:4px">${targetMachine}</strong>?`;

          const markup = `
             <div id="${modalId}" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px)">
                <div style="background:white; padding:24px; border-radius:12px; width:450px; max-width:90%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); animation: popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)">
                    <div style="margin-bottom:16px; font-weight:700; font-size:1.1rem; color:#0f172a; display:flex; align-items:center; gap:8px">
                       <i class="bi bi-arrow-left-right" style="color:#3b82f6"></i> ${title}
                    </div>
                    <p style="color:#475569; margin-bottom:24px; line-height:1.5">
                       ${msg}
                    </p>
                    <div style="display:flex; justify-content:flex-end; gap:12px">
                        <button class="btn ghost" onclick="document.getElementById('${modalId}').remove()">Cancel</button>
                        <button class="btn primary" onclick="window.executeMove('${planData.id}', '${targetMachine}', '${modalId}', '${dropBeforeId || ''}')">Yes, Do it</button>
                    </div>
                </div>
             </div>
             <style>@keyframes popIn { from { transform:scale(0.9); opacity:0; } to { transform:scale(1); opacity:1; } }</style>
             `;
          document.body.insertAdjacentHTML('beforeend', markup);
        };

        window.executeMove = async function (rowId, targetMachine, modalId, dropBeforeId) {
          if (!JPSMS.auth.can('planning', 'edit')) {
            JPSMS.toast('Access Denied: Read Only User', 'error');
            return;
          }
          const btn = document.querySelector(`#${modalId} .btn.primary`);
          if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Moving...'; }

          // Which timeline view is currently active? Excel View uses a table (no .timeline-track),
          // so the machine-track optimistic DOM mutation below must be skipped for it.
          const etvVisible = (() => {
            const el = document.getElementById('excelTimelineView');
            return !!(el && el.style.display !== 'none' && el.offsetParent !== null);
          })();

          // INSTANT UI UPDATE (Optimistic)
          let optimisticSuccess = false;
          try {
            if (!etvVisible && window.timelineGroups && window.draggedPlan) {
              // 1. Find the plan in current group
              const oldMachine = window.draggedPlan.machine;
              const planObjIdx = (window.timelineGroups[oldMachine] || []).findIndex(p => String(p.id) === String(rowId));

              if (planObjIdx > -1) {
                // 1a. Remove from old machine
                const planObj = window.timelineGroups[oldMachine].splice(planObjIdx, 1)[0];
                planObj.machine = targetMachine;

                // 2. Insert into new machine
                if (!window.timelineGroups[targetMachine]) window.timelineGroups[targetMachine] = [];

                let insertIdx = window.timelineGroups[targetMachine].length;
                if (dropBeforeId) {
                  const targetIdx = window.timelineGroups[targetMachine].findIndex(p => String(p.id) === String(dropBeforeId));
                  if (targetIdx > -1) insertIdx = targetIdx;
                }
                window.timelineGroups[targetMachine].splice(insertIdx, 0, planObj);

                // 2a. Re-calc Sequences & Times for targetMachine locally (Very basic estimation)
                let cursor = Date.now();
                window.timelineGroups[targetMachine].forEach((p, i) => {
                  p.seq = (i + 1) * 10;
                  const isRun = (p.status || '').toUpperCase() === 'RUNNING';
                  const ct = Number(p.cycleTime || 120); const cav = Number(p.cavity || 1); const pcsHr = (ct > 0) ? (3600 / ct) * cav : 30;
                  const qty = Number(p.planQty || 0); const bal = Math.max(0, qty - Number(p.producedQty || 0));
                  p.balQty = bal; const durMs = (bal * 3600 * 1000) / pcsHr; // always use BalQty
                  let start, end;
                  if (isRun) { start = p.firstDprEntry ? new Date(p.firstDprEntry).getTime() : (p.startDate ? new Date(p.startDate).getTime() : Date.now()); end = Date.now() + durMs; }
                  else { start = (i === 0) ? Date.now() : cursor; end = start + durMs; }
                  p._rippledStartRaw = new Date(start); p._rippledEndRaw = new Date(end); p._rippledExpRaw = new Date(end); cursor = end;
                });

                // 2b. Make sure targetMachine is in timelineMachines
                if (!window.timelineMachines.some(m => m.code === targetMachine)) {
                  const baseMachine = (window.allMachines || []).find(m => m.code === targetMachine) ||
                    { code: targetMachine, _finalBuilding: '?', _finalLine: '?' };
                  window.timelineMachines.push({
                    code: targetMachine,
                    _finalBuilding: baseMachine._finalBuilding || baseMachine.building || '?',
                    _finalLine: baseMachine._finalLine || baseMachine.line || '?'
                  });
                }

                // 3. TRUE INSTANT UI: Move the actual DOM element without full re-render
                const cardEl = window.draggedPlan.el;
                if (cardEl) {
                  const targetTrack = document.querySelector(`.timeline-track[data-machine="${CSS.escape(targetMachine)}"]`);
                  if (targetTrack) {
                    if (dropBeforeId) {
                      const beforeCard = targetTrack.querySelector(`.timeline-card[data-pid="${CSS.escape(dropBeforeId)}"]`);
                      if (beforeCard) targetTrack.insertBefore(cardEl, beforeCard);
                      else targetTrack.appendChild(cardEl);
                    } else {
                      targetTrack.appendChild(cardEl);
                    }
                    cardEl.dataset.machine = targetMachine;
                    optimisticSuccess = true;
                  } else {
                    // Track is not visible on screen, forcibly re-render timeline
                    if (typeof window.superFilterTimeline === 'function') {
                      window.superFilterTimeline();
                      optimisticSuccess = true;
                    }
                  }
                }
              }
            }
          } catch (e) { console.error('Optimistic UI update failed:', e); }

          // Close modal right away if optimistic succeeded
          if (optimisticSuccess) {
            const m = document.getElementById(modalId);
            if (m) m.remove();
          }

          // BACKGROUND API CALL
          try {
            // Use 'api' from local scope or window.JPSMS
            const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);

            // Existing API expects: { rowId, newMachine, newSeq(optional) }
            const res = await $api.post('/planning/move', {
              rowId,
              targetMachine,
              dropBeforeId: dropBeforeId || null
            });

            // If optimistic UI didn't run, close modal here.
            const m = document.getElementById(modalId);
            if (m) m.remove();

            if (res.ok || res.data?.ok) {
              if (window.JPSMS && window.JPSMS.toast) window.JPSMS.toast('Plan moved', 'success');
              // Always reload after saving so sequence-based Start/End/Exp ripple dates are accurate.
              reloadActiveTimeline();
            } else {
              if (window.JPSMS && window.JPSMS.toast) window.JPSMS.toast('Error: ' + (res.error || res.data?.error || 'Unknown'), 'error');
              // Refresh to undo optimistic UI on failure
              reloadActiveTimeline();
            }
          } catch (e) {
            console.error(e);
            if (window.JPSMS && window.JPSMS.toast) window.JPSMS.toast('System Error: ' + e.message, 'error');
            const m = document.getElementById(modalId);
            if (m) m.remove();
            // Refresh to undo optimistic UI
            reloadActiveTimeline();
          }

          // Reload whichever timeline view is currently visible.
          function reloadActiveTimeline() {
            if (etvVisible && typeof window.loadExcelTimeline === 'function') { window.loadExcelTimeline(); return; }
            if (typeof window.superLoadTimeline === 'function') window.superLoadTimeline();
            else if (typeof loadTimeline === 'function') loadTimeline();
          }
        };


        // --- RELOCATED loadTimeline ---

        /* -------------------- Machines Map -------------------- */
        async function loadMachines() {
          const grid = document.getElementById('machineGrid');
          grid.innerHTML = `<div class="line-row"><div class="line-title">Loading machines…</div></div>`;
          try {
            // Parallel Fetch: Machines + Master Plan + Live DPR Status
            // Plan board uses 2-min cache — repeat view switches are instant.
            const boardKey = `board|${getPlanningProcessQuerySuffix()}`;
            const [mList, pRes, liveRes] = await Promise.all([
              api.get(`/masters/machines?process=${encodeURIComponent(getPlanningProcessFilter())}`),
              window._planCache.get(boardKey, () => api.get(`/planning/board?${getPlanningProcessQuerySuffix()}`)),
              api.get('/machines/live-status').catch(() => null)
            ]);

            // Populate Global Master Plans
            if (pRes && pRes.data && pRes.data.plans) {
              window.allMasterPlans = pRes.data.plans;
            }

            // Completed plans are excluded from the board, so load them separately into a
            // lookup keyed by order_no|mould_name. Create Plan uses this to block re-planning a
            // mould that is already Completed (until a Superadmin restores it).
            api.get('/planning/completed?limit=2000').then(cRes => {
              const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
              const map = {};
              ((cRes && cRes.data) ? cRes.data : []).forEach(c => {
                if (!c) return;
                map[`${norm(c.orderNo)}|${norm(c.mouldName)}`] = {
                  id: c.id, planId: c.planId, machine: c.machine, status: 'Completed'
                };
              });
              window.completedPlanKeys = map;
            }).catch(() => { window.completedPlanKeys = window.completedPlanKeys || {}; });

            const runningMachines = new Set((window.allMasterPlans || [])
              .filter(plan => String(plan.status || '').toUpperCase() === 'RUNNING')
              .map(plan => String(plan.machine || '').trim().toLowerCase()));

            // Build live DPR status map (machine code → {live_status, problem_label, entry_type})
            const liveMap = {};
            if (liveRes && liveRes.data) {
              liveRes.data.forEach(r => { liveMap[String(r.machine || '').trim().toUpperCase()] = r; });
            }

            const scopedMachines = (mList && mList.data ? mList.data : mList || []);
            lastMachines = scopedMachines.map(machine => {
              const machineCode = String(machine.machine || machine.code || machine.name || '').trim();
              const machineProcess = machine.machine_process || getPlanningProcessFilter();
              const live = liveMap[machineCode.toUpperCase()] || null;
              // Live DPR status overrides plan-board status when available
              let liveStatus = null;
              if (live) {
                liveStatus = live.live_status; // 'running' | 'stopped' | 'idle'
              }
              const planRunning = runningMachines.has(machineCode.toLowerCase());
              return {
                id: machine.id || machineCode,
                code: machineCode,
                name: machineCode,
                building: machine.building || machineProcess || 'General',
                line: machine.line || (machineProcess === 'Moulding' ? '1' : 'Machines'),
                tonnage: machine.tonnage,
                machine_process: machineProcess,
                machine_icon: machine.machine_icon || null,
                status: planRunning ? 'Running' : 'Stopped',
                live_status: liveStatus,
                live_problem: (live && live.problem_label) || null,
                live_entry_type: (live && live.entry_type) || null,
                is_active: machine.is_active !== false,
                is_maintenance: false,
                queue_preview: []
              };
            });
            refreshMachineBuildingOptions(lastMachines);
            renderFilteredGrid();
          } catch (e) {
            grid.innerHTML = `<div class="muted" style="padding:20px; color:var(--bad)">Failed to load machines: ${esc(e.message)}</div>`;
            const demo = document.getElementById('demoBadge'); if (demo) demo.style.display = 'none';
          }
        }

        function renderFilteredGrid() {
          const grid = document.getElementById('machineGrid');
          const b = document.getElementById('buildingFilter').value;
          const q = (document.getElementById('machineSearch').value || '').toLowerCase().trim();

          let list = lastMachines.slice();
          if (b) list = list.filter(x => getMachineScopeValue(x).toUpperCase() === b.toUpperCase());
          if (q) list = list.filter(x => (x.code + ' ' + x.name).toLowerCase().includes(q));
          if (!showInactive) list = list.filter(x => !x.is_maintenance && (x.is_active !== false || (x.status || '').toLowerCase() !== 'off'));

          updatePlanningOverview(list);
          renderMachineGrid(list);
        }

        function renderMachineGrid(list) {
          const byB = groupBy(list, x => getMachineScopeValue(x));
          const grid = document.getElementById('machineGrid');
          flippedMachineCard = null;
          grid.innerHTML = '';

          if (Object.keys(byB).length === 0) {
            grid.innerHTML = `<div class="muted" style="padding:20px">No machines found matching filters.</div>`;
            return;
          }

          Object.keys(byB).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).forEach(building => {
            const lines = groupBy(byB[building], x => getMachineLineValue(x));
            const section = document.createElement('div');
            section.className = 'line-row';

            const header = document.createElement('div');
            header.className = 'line-title';
            header.textContent = planningProcess === 'Moulding' ? `Building ${building}` : building;
            section.appendChild(header);

            Object.keys(lines).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).forEach(line => {
              const wrap = document.createElement('div'); wrap.style.marginBottom = '8px';
              const title = document.createElement('div'); title.className = 'line-title'; title.textContent = line === 'Machines' ? 'Machines' : `Line ${line}`;
              const row = document.createElement('div'); row.className = 'machine-row';

              // Keep line machines in final machine-number order such as ...-1, ...-2, ...-3, ...-4.
              const sortedMachines = lines[line].sort((a, b) => {
                return compareMachineSeriesCodes(a.code, b.code);
              });

              sortedMachines.forEach(m => row.appendChild(machineSeat(m)));
              wrap.appendChild(title);
              wrap.appendChild(row);
              section.appendChild(wrap);
            });

            grid.appendChild(section);
          });
        }

        function compareMachineSeriesCodes(codeA, codeB) {
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
        }

        function machineSeat(m) {
          // 1. DATA LOOKUP from Master Plan (Priority over Machine Data)
          // 1. DATA LOOKUP from Master Plan (Priority over Machine Data)
          const allPlans = window.allMasterPlans || [];

          // Normalized Match & Filter Valid Plans (No History)
          // Strip legacy "BUILDING -L{LINE}>" prefix if present (e.g. "E -L1>HYD-350-1" → "HYD-350-1")
          const stripMachPrefix = (s) => { const t = String(s || '').trim(); return t.includes('>') ? t.split('>').pop().trim() : t; };
          // Fuzzy key: strip prefix + remove all whitespace, compare uppercase
          const machKey = (s) => stripMachPrefix(s).replace(/\s+/g, '').toUpperCase();
          const myPlans = allPlans.filter(p => {
            const pMach = stripMachPrefix(p.machine);
            const mCode = stripMachPrefix(m.code);
            const mMatch = (p.machine === m.code) ||
                           (p.machine && p.machine.trim().toUpperCase() === m.code.trim().toUpperCase()) ||
                           (pMach && pMach.toUpperCase() === mCode.toUpperCase()) ||
                           (pMach && mCode && machKey(p.machine) === machKey(m.code));
            const pStatus = (p.status || '').toUpperCase();
            return mMatch && !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(pStatus);
          });

          // Sort myPlans: Strictly by Sequence
          myPlans.sort((a, b) => {
            // Strict Sequence Order
            return (a.seq || 0) - (b.seq || 0) || (a.id || 0) - (b.id || 0);
          });

          // HORIZON = SEQUENCE INDEX (1-based), 0 = Running Only
          const h = window.horizon !== undefined ? window.horizon : 1;
          let activePlan = null;

          if (h === 0) {
            // Running View: Find the actual running plan anywhere in the list
            activePlan = myPlans.find(p => (p.status || '').toUpperCase() === 'RUNNING');
          } else {
            // Horizon View: Get by sequence index
            const seqIndex = h - 1;
            activePlan = myPlans[seqIndex];
          }

          // 2. Determine physical machine state — live DPR status takes priority.
          const physicalStatus = (() => {
            if (m.is_maintenance) return 'maintenance';
            // Live DPR status: 'running' = pcs entry, 'stopped' = quick entry (problem)
            if (m.live_status === 'running') return 'running';
            if (m.live_status === 'stopped') return 'stopped';
            // Fall back to plan-board status
            const raw = String(m.status || '').toLowerCase();
            if (raw === 'maintenance') return 'maintenance';
            if (raw === 'running') return 'running';
            if (raw === 'stopped' || raw === 'off') return 'stopped';
            return 'available';
          })();

          let statusRaw = physicalStatus;
          if (activePlan && physicalStatus === 'available') {
            statusRaw = 'planned';
          }


          // 3. Visual Class
          let sClass = 's-unplanned';
          if (m.is_maintenance || physicalStatus === 'maintenance') sClass = 's-maint';
          else if (physicalStatus === 'running') sClass = 's-running';
          else if (physicalStatus === 'stopped') sClass = 's-stopped';

          // 4. Display clean name: strip "BUILDING -L{n}>" prefix if present so cards always
          //    show just the machine code (e.g. "AKAR-150-4" not "B -L1>AKAR-150-4").
          //    m.code is still the raw DB value used for data matching; only display differs.
          const displayName = esc(stripMachPrefix(m.code));
          const detail = (value, fallback = '-') => esc(value == null || value === '' ? fallback : value);

          // 5. Active Info Text
          let activeText = prettyStatus(m); // Default
          let subText = '';

          if (activePlan) {
            // ALWAYS show Plan Details if a plan exists for this Horizon
            // Status color (Red/Green/White) will indicate machine state
            activeText = `${esc(activePlan.orderNo)} • ${esc(activePlan.mouldName || activePlan.itemName)}`;
            subText = `Bal: ${Number(activePlan.balQty || 0).toLocaleString()} • ${activePlan.clientName || ''}`;

            // Optional: Add (Stopped) suffix if machine is actually stopped
            if (physicalStatus === 'stopped') {
              activeText += ' (Stopped)';
            } else if (statusRaw === 'planned') {
              activeText = `Planned: ${esc(activePlan.orderNo)}`;
            }
          } else {
            // No Plan logic
            const h = window.horizon !== undefined ? window.horizon : 1;
            if (h > 1 || h === 0) {
              activeText = 'No Plan';
              subText = `No plan assigned`;
            } else {
              activeText = 'No Plan';
              subText = physicalStatus === 'running'
                ? (m.running_product || 'Running without plan')
                : 'No plan assigned';
            }
          }

          // Live DPR-aware status text for the card front face
          let frontStatusText;
          if (m.live_status === 'stopped' && m.live_problem) {
            frontStatusText = m.live_problem; // e.g. "Mould Changeover", "Maintenance"
          } else if (m.live_status === 'running') {
            frontStatusText = 'Running';
          } else if (physicalStatus === 'maintenance') {
            frontStatusText = 'Maintenance';
          } else if (!activePlan) {
            frontStatusText = 'No Plan';
          } else if (statusRaw === 'planned') {
            frontStatusText = 'Planned';
          } else {
            frontStatusText = prettyStatus(m);
          }

          const detailOrder = activePlan ? activePlan.orderNo : (m.running_order || 'No active order');
          const detailJob = activePlan
            ? [activePlan.itemName, activePlan.mouldName].filter(Boolean).join(' / ')
            : (m.running_product || 'No job assigned');
          const detailClient = activePlan ? (activePlan.clientName || '-') : (m.running_client || '-');
          const detailBalance = activePlan
            ? Number(activePlan.balQty || activePlan.planQty || 0).toLocaleString('en-IN')
            : '-';
          const detailStatus = activePlan
            ? (statusRaw === 'planned' ? 'Planned' : frontStatusText)
            : (physicalStatus === 'maintenance' ? 'Maintenance' : 'No Plan');
          const detailSlot = activePlan
            ? (h === 0 ? 'Running Slot' : `Queue ${h}`)
            : (m.running_order ? 'Direct Run' : 'Open');
          const detailLine = m.line || '-';
          const detailTonnage = m.tonnage ? `${m.tonnage}T` : '-';

          const btn = document.createElement('div');
          btn.className = `machine ${sClass}`;
          btn.setAttribute('role', 'button');
          btn.setAttribute('tabindex', '0');
          btn.setAttribute('aria-pressed', 'false');
          let tooltip = `${m.code}`;
          if (activePlan) tooltip += `\nOrder: ${activePlan.orderNo}\nItem: ${activePlan.itemName}\nStatus: ${activePlan.status}`;

          btn.title = tooltip;
          const iconSrc = String(m.machine_icon || '').trim();
          const safeIconSrc = iconSrc ? iconSrc.replace(/"/g, '&quot;') : '';

          btn.innerHTML = `
        <div class="machine-flip">
          <div class="machine-face machine-front">
            <div class="media ${safeIconSrc ? '' : 'fallback'}">
              ${safeIconSrc ? `<img class="thumb" src="${safeIconSrc}" alt="${displayName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentElement.classList.add('fallback');">` : ''}
              <div class="thumb-fallback" style="${safeIconSrc ? 'display:none' : 'display:flex'}"><i class="bi bi-hdd-rack"></i></div>
            </div>
            <div class="name">${displayName}</div>
            <div class="status-text">${esc(frontStatusText)}</div>
            <div class="flip-note">Click for job details</div>
          </div>
          <div class="machine-face machine-back">
            <div class="back-head">
              <div class="back-label">Job Details</div>
              <div class="back-name">${displayName}</div>
            </div>
            <div class="job-grid">
              <div class="job-row"><span>Order</span><strong>${detail(detailOrder, 'No active order')}</strong></div>
              <div class="job-row"><span>Job</span><strong>${detail(detailJob, 'No job assigned')}</strong></div>
              <div class="job-row"><span>Client</span><strong>${detail(detailClient)}</strong></div>
              <div class="job-row"><span>Status</span><strong>${detail(detailStatus)}</strong></div>
              <div class="job-row"><span>Balance</span><strong>${detail(detailBalance)}</strong></div>
            </div>
            <div class="job-meta">
              <div class="job-chip">${detail(detailSlot)}</div>
              <div class="job-chip">Line ${detail(detailLine)}</div>
              <div class="job-chip">${detail(detailTonnage)}</div>
            </div>
            ${activePlan ? `
            <button type="button"
              class="pjd-open-btn"
              data-order="${esc(activePlan.orderNo||'')}"
              data-machine="${esc(m.code||m.name||'')}"
              data-planid="${esc(String(activePlan.id||''))}"
              data-item="${esc(activePlan.itemName||activePlan.mouldName||'')}"
              data-client="${esc(activePlan.clientName||'')}"
              style="width:100%;padding:5px 0;background:linear-gradient(135deg,#0ea5e9,#0369a1);color:#fff;border:none;border-radius:7px;font-size:0.7rem;font-weight:800;cursor:pointer;letter-spacing:0.03em;flex-shrink:0"
              onmouseover="this.style.opacity='0.82'" onmouseout="this.style.opacity='1'"
              onclick="event.stopPropagation(); window._pjdOpen(this);">
              &#128269; View Full Details
            </button>
            <div class="flip-note" style="font-size:0.58rem;margin-top:1px">Tap card to flip back</div>`
            : '<div class="flip-note">Click to flip back</div>'}
          </div>
        </div>
        `;

          btn.addEventListener('mouseenter', (ev) => showHover(ev, m, false));
          btn.addEventListener('mousemove', (ev) => moveHover(ev));
          btn.addEventListener('mouseleave', () => { if (!dialogPinned) hideHover(); });
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // If click came from View Details button, open modal — don't flip
            const openBtn = ev.target.closest('.pjd-open-btn');
            if (openBtn) {
              if (typeof window.openPlanJobDetail === 'function') {
                window.openPlanJobDetail(
                  openBtn.dataset.order,
                  openBtn.dataset.machine,
                  openBtn.dataset.planid,
                  openBtn.dataset.item,
                  openBtn.dataset.client
                );
              }
              return;
            }
            toggleMachineCardFlip(btn);
          });
          btn.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            toggleMachineCardFlip(btn);
          });
          return btn;
        }

        // Helper for pretty status (Fallbacks)
        function prettyStatus(m) {
          if (m.is_maintenance) return 'Under Maintenance';
          const s = (m.status || '').toLowerCase();
          if (s === 'running') return 'Running';
          if (s === 'stopped') return m.is_active ? 'Stopped' : 'Off';
          if (s === 'off') return 'Off';
          if (s === 'maintenance') return 'Maintenance';
          return 'Available';
        }

        // cssStatus removed as it's integrated above

        function groupBy(arr, keyFn) { const out = {}; (arr || []).forEach(x => { const k = keyFn(x); (out[k] = out[k] || []).push(x) }); return out; }

        /* ---------------------- Orders sheet (legacy) ---------------------- */
        function openPlanSheet() {
          const chip = document.getElementById('selMachineChip');
          if (selectedMachine) { chip.style.display = ''; chip.textContent = `${selectedMachine.code} • ${selectedMachine.name} `; }
          else { chip.style.display = 'none'; }
          document.getElementById('planSheet').style.display = 'block';
          loadPendingOrders();
        }

        async function renderPlanningBoard(data) {
          // Mobile View Check
          if (window.innerWidth <= 768) {
            document.getElementById('planningBoard').style.display = 'none';
            document.getElementById('mobilePlanList').style.display = 'block';
            renderMobilePlanningView(data);
            return;
          } else {
            document.getElementById('planningBoard').style.display = 'flex';
            document.getElementById('mobilePlanList').style.display = 'none';
          }

          const { machines, plans, moulds } = data;
          const board = document.getElementById('planningBoard');
          board.innerHTML = '';

          // ... (Existing Desktop Rendering Logic) ...
          machines.forEach(m => {
            // ...
          });
        }

        function renderMobilePlanningView(data) {
          const { machines, plans } = data;
          const container = document.getElementById('mobilePlanList');
          container.innerHTML = '';

          // Group Plans by Machine
          machines.forEach(m => {
            const mPlans = plans.filter(p => p.machine === m.name).sort((a, b) => a.seq - b.seq);

            if (mPlans.length === 0) return;

            let html = `
            <div class="card mb-3" style="border:1px solid #334155; background:#1e293b;">
                <div class="card-header d-flex justify-content-between align-items-center" style="border-bottom:1px solid #334155">
                    <h6 class="mb-0 text-white"><i class="bi bi-cpu"></i> ${m.name}</h6>
                    <span class="badge bg-primary">${mPlans.length} Jobs</span>
                </div>
                <div class="card-body p-2">`;

            mPlans.forEach(p => {
              html += `
                <div class="p-2 mb-2 rounded" style="background:#0f172a; border:1px solid #334155">
                    <div style="color:#e2e8f0; font-weight:600; font-size:0.95rem">${p.item_name || 'Unknown Item'}</div>
                    <div class="d-flex justify-content-between mt-2" style="font-size:0.85rem; color:#94a3b8">
                        <span><i class="bi bi-box-seam"></i> ${p.mould_no || '-'}</span>
                        <span>Qty: ${p.plan_qty}</span>
                    </div>
                     <div class="mt-2 text-end">
                        <span class="badge ${p.status === 'RUNNING' ? 'bg-success' : 'bg-secondary'}">${p.status}</span>
                    </div>
                </div>`;
            });

            html += `</div></div>`;
            container.innerHTML += html;
          });

          if (container.innerHTML === '') {
            container.innerHTML = '<div class="text-center text-muted p-4">No active plans found.</div>';
          }
        }
        async function loadPendingOrders() {
          const listEl = document.getElementById('ordersList');
          injectOrdersSkeleton(listEl);
          try {
            let orders;
            try { orders = await api.get('/orders/pending?unplanned=1'); }
            catch { orders = await api.get('/orders?status=Pending'); }
            lastOrders = normalizeOrders(orders);
            renderOrdersList(lastOrders);
          } catch (e) {
            listEl.innerHTML = `<div style="padding:10px; color:var(--bad)">Failed to load orders: ${esc(e.message)}</div>`;
            const demo = document.getElementById('demoBadge'); if (demo) demo.style.display = 'none';
          }
        }
        function normalizeOrders(arr) {
          const normalized = (arr || []).map(o => ({
            id: o.id, order_no: o.order_no || o.orderNo || `ORD - ${o.id} `,
            item_name: o.item_name || o.item || 'Item',
            mould_id: o.mould_id || o.mouldId || null,
            mould_code: o.mould_code || o.mouldCode || (o.mould_id ? ('M-' + o.mould_id) : '-'),
            qty: Number(o.qty || o.quantity || 0),
            priority: o.priority || o.pri || 'Normal',
            age_days: o.age_days != null ? o.age_days : (Math.floor(Math.random() * 10) + 1)
          }));
          return normalized.sort((a, b) => {
            const pr = getOrderPriorityRank(a.priority) - getOrderPriorityRank(b.priority);
            if (pr !== 0) return pr;
            return (b.qty || 0) - (a.qty || 0);
          });
        }
        function getOrderPriorityRank(priority) {
          const normalized = String(priority || 'Normal').trim().toLowerCase();
          if (normalized === 'urgent') return 0;
          if (normalized === 'high') return 1;
          if (normalized === 'normal') return 2;
          if (normalized === 'low') return 3;
          return 4;
        }
        function injectOrdersSkeleton(el) {
          while (el.children.length > 1) el.removeChild(el.lastChild);
          for (let i = 0; i < 6; i++) {
            const r = document.createElement('div'); r.className = 'row';
            r.innerHTML = `<div><input type="checkbox" disabled></div>
          <div class="muted">—</div><div class="muted">Loading…</div>
          <div class="muted">—</div><div class="muted">—</div><div class="muted">—</div>`;
            el.appendChild(r);
          }
        }
        function renderOrdersList(rows) {
          const el = document.getElementById('ordersList'); while (el.children.length > 1) el.removeChild(el.lastChild);
          rows.forEach(o => {
            const r = document.createElement('div'); r.className = 'row'; r.dataset.id = o.id;
            const priClass = (o.priority || 'Normal');
            const normalizedPriority = String(o.priority || 'Normal').toLowerCase();
            const rowBg = normalizedPriority === 'high'
              ? '#fff7ed'
              : (normalizedPriority === 'urgent' ? '#fef2f2' : 'transparent');
            const rowBorder = normalizedPriority === 'high'
              ? '#f59e0b'
              : (normalizedPriority === 'urgent' ? '#dc2626' : '#e2e8f0');
            r.style.background = rowBg;
            r.style.borderLeft = `4px solid ${rowBorder}`;
            r.innerHTML = `
            <div><input type="checkbox" class="ck" /></div>
          <div><span class="tag ${esc(priClass)}">${esc(o.priority)}</span></div>
          <div><strong>${esc(o.order_no)}</strong> • <span class="muted">${esc(o.item_name)}</span></div>
          <div>${esc(o.mould_code || '-')}</div>
          <div>${o.qty.toLocaleString()}</div>
          <div>${o.age_days}d</div>`;
            el.appendChild(r);
          });
        }
        function filterOrders(q) {
          q = (q || '').toLowerCase().trim(); if (!q) return lastOrders;
          return lastOrders.filter(o => (`${o.order_no} ${o.item_name} ${o.mould_code} `.toLowerCase().includes(q)));
        }
        function selectedOrderIds(containerSel = '#ordersList') {
          const ids = []; document.querySelectorAll(`${containerSel} .row`).forEach(r => { const ck = r.querySelector('.ck'); if (ck && ck.checked) ids.push(Number(r.dataset.id)); });
          return ids;
        }
        function selectSameMould() {
          const ids = selectedOrderIds(); if (!ids.length) return toast('Select one order first');
          const first = lastOrders.find(o => o.id === ids[0]); if (!first || !first.mould_code) return toast('Selected order has no mould');
          document.querySelectorAll('#ordersList .row').forEach(r => {
            const id = Number(r.dataset.id); const o = lastOrders.find(x => x.id === id);
            if (o && o.mould_code === first.mould_code) { const ck = r.querySelector('.ck'); if (ck) ck.checked = true; }
          });
        }
        async function queueSelected() {
          if (!selectedMachine) return toast('Select a machine first');
          const ids = selectedOrderIds(); if (!ids.length) return toast('Select at least one order');

          if (isSupervisor && (selectedMachine.is_maintenance || ['off'].includes((selectedMachine.status || '').toLowerCase()))) {
            return toast('Supervisor: cannot plan on maintenance/off machine');
          }

          try {
            const out = await api.post('/planning/queue', { machine_id: selectedMachine.id, order_ids: ids, remarks: null });
            toast(out?.message || 'Queued');
            document.getElementById('planSheet').style.display = 'none';
            await loadMachines();
          } catch (e) { toast(e?.message || 'Failed to queue'); }
        }



        // --- Helpers for Create Plan ---

        async function loadCpOrders() {
          const list = document.getElementById('cpOrderList');
          if (!list) return;
          list.innerHTML = '<div style="padding:20px;text-align:center" class="muted">Loading Pending Orders...</div>';
          try {
            const res = await api.get('/orders/pending');
            const mapped = (res && res.data ? res.data : []).map(o => ({
              ...o,
              orderNo: o.order_no || o.orderNo,
              jcNo: o.job_card_no || o.jobCardNo || o.jc_no || o.jcNo || '-',
              productName: o.product_name || o.productName || o.item_name || 'Item',
              partyName: o.client_name || o.partyName || o.clientName || null,
              orDate: o.or_jr_date || o.orJrDate || o.or_date || o.orDate || o.orderDate || null,
              orQty: o.or_qty || o.orQty || null,
              jcDate: o.job_card_date || o.jobCardDate || o.jc_date || o.jcDate || null,
              jcQty: o.jr_qty || o.jrQty || o.jc_qty || o.jcQty || null,
              qty: Number(o.jr_qty || o.jrQty || o.jc_qty || o.jcQty || o.qty || 0)
            }));
            // De-dupe to ONE card per OR number. The backend already returns one
            // row per OR (DISTINCT ON), but guard here too: an OR can have many
            // job card rows and we only ever want a single Pending Order card.
            // Per-OR job cards are shown in the expand panel (/job-cards).
            const seenOrders = new Set();
            cpOrders = mapped.filter(o => {
              const key = String(o.orderNo || '').trim().toLowerCase();
              if (!key || seenOrders.has(key)) return false;
              seenOrders.add(key);
              return true;
            }).sort(defaultCpOrderSort);

            const currentFilter = document.getElementById('cpOrderSearch')?.value || '';
            renderCpOrders(currentFilter);
          } catch (e) {
            list.innerHTML = `<div class="error" style="padding:20px">Error: ${esc(e.message)}</div>`;
          }
        }
        window.loadCpOrders = loadCpOrders;

        function formatCpDate(value) {
          if (!value) return '-';
          const d = new Date(value);
          if (!Number.isNaN(d.getTime())) {
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          }
          return String(value);
        }

        function formatCpQty(value) {
          if (value === null || value === undefined || value === '') return '-';
          const n = Number(value);
          if (Number.isFinite(n)) return n.toLocaleString();
          return String(value);
        }

        function normalizeCpSearchText(value) {
          return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
        }

        function compactCpSearchText(value) {
          return normalizeCpSearchText(value).replace(/[^a-z0-9]/g, '');
        }

        function defaultCpOrderSort(a, b) {
          const pr = getOrderPriorityRank(a.priority) - getOrderPriorityRank(b.priority);
          if (pr !== 0) return pr;

          const bDate = new Date(b.orDate || b.jcDate || 0);
          const aDate = new Date(a.orDate || a.jcDate || 0);
          const bTime = Number.isNaN(bDate.getTime()) ? 0 : bDate.getTime();
          const aTime = Number.isNaN(aDate.getTime()) ? 0 : aDate.getTime();
          if (bTime !== aTime) return bTime - aTime;

          const qtyDiff = Number(b.qty || 0) - Number(a.qty || 0);
          if (qtyDiff !== 0) return qtyDiff;

          return String(a.orderNo || '').localeCompare(String(b.orderNo || ''), undefined, { numeric: true, sensitivity: 'base' });
        }

        function scoreCpOrderSearch(order, query) {
          const rawQuery = normalizeCpSearchText(query);
          if (!rawQuery) return 0;

          const compactQuery = compactCpSearchText(query);
          const orDateText = formatCpDate(order.orDate);
          const jcDateText = formatCpDate(order.jcDate);
          const fields = [
            { values: [order.orderNo], exact: 320, prefix: 220, contains: 160 },
            { values: [order.jcNo], exact: 300, prefix: 210, contains: 150 },
            { values: [order.productName], exact: 190, prefix: 150, contains: 115 },
            { values: [order.partyName], exact: 170, prefix: 130, contains: 100 },
            { values: [orDateText, order.orDate], exact: 120, prefix: 95, contains: 74 },
            { values: [jcDateText, order.jcDate], exact: 120, prefix: 95, contains: 74 },
            { values: [formatCpQty(order.orQty), order.orQty], exact: 110, prefix: 88, contains: 66 },
            { values: [formatCpQty(order.jcQty || order.qty), order.jcQty, order.qty], exact: 110, prefix: 88, contains: 66 }
          ];

          let score = 0;
          const tokens = rawQuery.split(' ').filter(Boolean);
          for (const token of tokens) {
            const compactToken = compactCpSearchText(token);
            let best = 0;

            for (const field of fields) {
              for (const value of field.values) {
                const rawValue = normalizeCpSearchText(value);
                const compactValue = compactCpSearchText(value);
                if (!rawValue && !compactValue) continue;

                if ((rawValue && rawValue === token) || (compactToken && compactValue === compactToken)) {
                  best = Math.max(best, field.exact);
                } else if ((rawValue && rawValue.startsWith(token)) || (compactToken && compactValue.startsWith(compactToken))) {
                  best = Math.max(best, field.prefix);
                } else if ((rawValue && rawValue.includes(token)) || (compactToken && compactValue.includes(compactToken))) {
                  best = Math.max(best, field.contains);
                }
              }
            }

            if (!best) return -1;
            score += best;
          }

          const orderCompact = compactCpSearchText(order.orderNo);
          const jcCompact = compactCpSearchText(order.jcNo);
          if (compactQuery && orderCompact === compactQuery) score += 320;
          else if (compactQuery && jcCompact === compactQuery) score += 280;
          else if (compactQuery && orderCompact.startsWith(compactQuery)) score += 190;
          else if (compactQuery && jcCompact.startsWith(compactQuery)) score += 170;

          return score;
        }

        function applyCpOrderCardState(el, state = 'base') {
          if (!el) return;
          const baseBg = el.dataset.baseBg || '#ffffff';
          const hoverBg = el.dataset.hoverBg || baseBg;
          const selectedBg = el.dataset.selectedBg || hoverBg;
          const baseBorder = el.dataset.baseBorder || '#dbe5e1';
          const hoverBorder = el.dataset.hoverBorder || baseBorder;
          const selectedBorder = el.dataset.selectedBorder || hoverBorder;

          if (state === 'selected') {
            el.style.background = selectedBg;
            el.style.borderColor = selectedBorder;
            el.style.boxShadow = '0 16px 34px rgba(37, 99, 235, 0.14)';
            el.style.transform = 'translateY(-1px)';
            return;
          }

          if (state === 'hover') {
            el.style.background = hoverBg;
            el.style.borderColor = hoverBorder;
            el.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.10)';
            el.style.transform = 'translateY(-1px)';
            return;
          }

          el.style.background = baseBg;
          el.style.borderColor = baseBorder;
          el.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.06)';
          el.style.transform = 'translateY(0)';
        }

        function resetCpOrderSelection() {
          window.cpSelectedOrder = null;
          window.cpOrderMoulds = [];
          cpSelectedMould = null;
          cpSelectedMachine = null;
          window.cpLabourPlanType = null;

          const list = document.getElementById('cpOrderList');
          if (list) Array.from(list.children).forEach(c => applyCpOrderCardState(c, 'base'));

          const empty = document.getElementById('cpEmptyState');
          const content = document.getElementById('cpDetailContent');
          if (empty) empty.style.display = 'flex';
          if (content) content.style.display = 'none';

          const tOrder = document.getElementById('cpTitleOrderNo');
          const tProd = document.getElementById('cpTitleProduct');
          if (tOrder) tOrder.textContent = '';
          if (tProd) tProd.textContent = '';

          const mList = document.getElementById('cpMouldList');
          if (mList) mList.innerHTML = '';

          const macSec = document.getElementById('cpMachineSection');
          if (macSec) macSec.style.display = 'none';

          const macList = document.getElementById('cpMachineList');
          if (macList) macList.innerHTML = '';

          const saveBtn = document.getElementById('cpSaveBtn');
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="bi bi-check2-circle"></i> Create Plan';
          }

          const addBtn = document.getElementById('cpAddBtn');
          if (addBtn) addBtn.disabled = true;

          const footer = document.getElementById('cpFooterStatus');
          if (footer) footer.textContent = 'Select an order to view mould details';

          const batchSetup = document.getElementById('cpBatchSetup');
          if (batchSetup) {
            batchSetup.style.display = 'none';
            batchSetup.innerHTML = '';
          }
          window.cpCurrentBatchQty = null;
          window.cpOrderBatchHistory = [];
        }

        function renderCpOrders(filter = '') {
          const list = document.getElementById('cpOrderList');
          if (!list) return;
          list.innerHTML = '';

          const q = normalizeCpSearchText(filter);
          const visible = q
            ? cpOrders
              .map(o => ({ order: o, score: scoreCpOrderSearch(o, q) }))
              .filter(entry => entry.score >= 0)
              .sort((a, b) => b.score - a.score || defaultCpOrderSort(a.order, b.order))
              .map(entry => entry.order)
            : [...cpOrders].sort(defaultCpOrderSort);

          // Update Count
          const countEl = document.getElementById('cpOrderCount');
          if (countEl) {
            countEl.innerText = q
              ? `${visible.length} MATCHES / ${cpOrders.length} ORDERS`
              : `${visible.length} PENDING ORDERS`;
          }

          if (!visible.length) {
            list.innerHTML = q
              ? `<div class="cp-list-empty">No pending orders matched <strong>${esc(filter)}</strong>.<br>Try OR number, JC number, product, client, date, or quantity.</div>`
              : '<div class="cp-list-empty">No pending orders are available right now.</div>';
            return;
          }

          const MAX_RENDER = 80;
          const itemsToRender = visible.slice(0, MAX_RENDER);

          itemsToRender.forEach(o => {
            const el = document.createElement('div');
            el.className = 'cp-order-item';
            el.style.padding = '12px';
            el.style.border = '1px solid #dbe5f1';
            el.style.borderRadius = '16px';
            el.style.cursor = 'pointer';
            el.style.transition = 'background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease';
            const normalizedPriority = String(o.priority || 'Normal').toLowerCase();
            const baseBg = normalizedPriority === 'high'
              ? '#fffaf0'
              : (normalizedPriority === 'urgent' ? '#fff4f4' : '#ffffff');
            const hoverBg = normalizedPriority === 'high'
              ? '#fff2db'
              : (normalizedPriority === 'urgent' ? '#ffe7e7' : '#f8fbff');
            const selectedBg = normalizedPriority === 'high'
              ? '#fde4b3'
              : (normalizedPriority === 'urgent' ? '#ffd0d0' : '#e8f1ff');
            const baseBorder = normalizedPriority === 'high'
              ? '#f6c36b'
              : (normalizedPriority === 'urgent' ? '#f1a0a0' : '#dbe5f1');
            const hoverBorder = normalizedPriority === 'high'
              ? '#f59e0b'
              : (normalizedPriority === 'urgent' ? '#dc2626' : '#93c5fd');
            const selectedBorder = normalizedPriority === 'high'
              ? '#d97706'
              : (normalizedPriority === 'urgent' ? '#b91c1c' : '#3b82f6');

            el.dataset.baseBg = baseBg;
            el.dataset.hoverBg = hoverBg;
            el.dataset.selectedBg = selectedBg;
            el.dataset.baseBorder = baseBorder;
            el.dataset.hoverBorder = hoverBorder;
            el.dataset.selectedBorder = selectedBorder;
            el.style.borderLeft = normalizedPriority === 'high'
              ? '5px solid #f59e0b'
              : (normalizedPriority === 'urgent' ? '5px solid #dc2626' : '5px solid #cbd5e1');
            applyCpOrderCardState(el, 'base');

            el.innerHTML = `
                   <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px">
                      <div style="font-size:0.72rem; color:#64748b; text-transform:uppercase; letter-spacing:0.08em; font-weight:800">Pending Order</div>
                      <div class="tag small">${esc(o.status || 'Pending')}</div>
                   </div>
                   <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px; margin-bottom:8px">
                     <div style="padding:8px 9px; background:rgba(255,255,255,0.82); border:1px solid rgba(203,213,225,0.9); border-radius:12px; min-width:0">
                       <div style="font-size:0.64rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.07em; font-weight:700; margin-bottom:3px">OR Number</div>
                       <div style="font-size:0.8rem; color:#0f172a; font-weight:800; font-family:monospace; line-height:1.22; overflow-wrap:anywhere">${esc(o.orderNo || '-')}</div>
                     </div>
                     <div style="padding:8px 9px; background:rgba(255,255,255,0.82); border:1px solid rgba(203,213,225,0.9); border-radius:12px">
                       <div style="font-size:0.64rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.07em; font-weight:700; margin-bottom:3px">OR Date</div>
                       <div style="font-size:0.8rem; color:#334155; font-weight:700; line-height:1.22">${esc(formatCpDate(o.orDate))}</div>
                     </div>
                   </div>
                   <div style="padding:9px 10px; background:rgba(248,250,252,0.95); border:1px solid rgba(203,213,225,0.95); border-radius:12px; margin-bottom:7px">
                     <div style="font-size:0.64rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.07em; font-weight:700; margin-bottom:3px">Product Name</div>
                     <div style="font-size:0.9rem; color:#0f172a; line-height:1.25; font-weight:800">${esc(o.productName || '-')}</div>
                   </div>
                   <div style="padding:9px 10px; background:rgba(248,250,252,0.95); border:1px solid rgba(203,213,225,0.95); border-radius:12px; margin-bottom:8px">
                     <div style="font-size:0.64rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.07em; font-weight:700; margin-bottom:3px">Client Name</div>
                     <div style="font-size:0.82rem; color:#475569; line-height:1.24; font-weight:700">${esc(o.partyName || '-')}</div>
                   </div>
                   <div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:end">
                     <div style="padding:8px 9px; background:rgba(255,255,255,0.88); border:1px solid rgba(203,213,225,0.9); border-radius:12px">
                       <div style="font-size:0.64rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.07em; font-weight:700; margin-bottom:3px">OR Qty</div>
                       <div style="font-size:0.92rem; color:#0f172a; font-weight:800; line-height:1.18">${esc(formatCpQty(o.orQty))}</div>
                     </div>
                     <span class="tag ${esc(o.priority || 'Normal')}" style="transform:scale(0.82); transform-origin:right center;">${esc(o.priority || 'Normal')}</span>
                   </div>
                   <div class="cp-jobcards-toggle" style="margin-top:9px; display:flex; align-items:center; justify-content:center; gap:6px; padding:7px; background:#f0f7ff; border:1px solid #cfe2fb; border-radius:10px; color:#1d4ed8; font-size:0.74rem; font-weight:800; letter-spacing:0.03em">
                     <i class="bi bi-chevron-down cp-jobcards-chevron" style="transition:transform 0.18s ease"></i>
                     <span class="cp-jobcards-label">View Job Cards</span>
                   </div>
                   <div class="cp-jobcards-panel" style="display:none; margin-top:9px"></div>
                `;

            el.onmouseover = () => applyCpOrderCardState(el, cpSelectedOrder === o ? 'selected' : 'hover');
            el.onmouseout = () => applyCpOrderCardState(el, cpSelectedOrder === o ? 'selected' : 'base');

            el.onclick = (ev) => {
              // Clicks on the job-card panel (rows / Create Plan buttons) handle
              // themselves — don't toggle the panel when interacting inside it.
              if (ev && ev.target && ev.target.closest && ev.target.closest('.cp-jobcards-panel')) return;
              toggleCpOrderJobCards(o, el);
            };

            if (cpSelectedOrder === o) {
              applyCpOrderCardState(el, 'selected');
            }

            list.appendChild(el);
          });

          if (visible.length > MAX_RENDER) {
            const moreEl = document.createElement('div');
            moreEl.style.padding = '14px 12px';
            moreEl.style.textAlign = 'center';
            moreEl.style.color = '#0284c7';
            moreEl.style.background = '#f0f9ff';
            moreEl.style.border = '1px dashed #bae6fd';
            moreEl.style.borderRadius = '16px';
            moreEl.style.fontSize = '0.8rem';
            moreEl.style.fontWeight = '800';
            moreEl.style.marginTop = '10px';
            moreEl.style.boxShadow = '0 2px 8px rgba(2,132,199,0.06)';
            moreEl.textContent = `Showing top ${MAX_RENDER} of ${visible.length} matches. Type more to refine search.`;
            list.appendChild(moreEl);
          }
        }

        // Expand/collapse the inline Job Cards panel inside a Pending Order card.
        // One OR can have multiple job card rows in OR-JR Status; this panel lists
        // each one (Job Card No / Date / Qty + OR-level Bal Qty) with a per-row
        // "Create Plan" button. Bal Qty is OR-level: OR Qty - total planned.
        async function toggleCpOrderJobCards(order, el) {
          const panel = el.querySelector('.cp-jobcards-panel');
          const chevron = el.querySelector('.cp-jobcards-chevron');
          const label = el.querySelector('.cp-jobcards-label');
          if (!panel) return;

          const isOpen = panel.style.display !== 'none';
          if (isOpen) {
            panel.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            if (label) label.textContent = 'View Job Cards';
            return;
          }

          panel.style.display = 'block';
          if (chevron) chevron.style.transform = 'rotate(180deg)';
          if (label) label.textContent = 'Hide Job Cards';

          if (panel.dataset.loaded === '1') return;
          panel.innerHTML = '<div class="mini muted" style="padding:8px 4px">Loading job cards…</div>';
          try {
            // Pull job cards AND the order's mould details in parallel so the panel
            // can also show which moulds are planned vs not planned for this OR.
            const [jcResult, detResult] = await Promise.allSettled([
              api.get(`/planning/orders/${encodeURIComponent(order.orderNo)}/job-cards`),
              api.get(`/planning/orders/${encodeURIComponent(order.orderNo)}/details`)
            ]);
            if (jcResult.status !== 'fulfilled') throw jcResult.reason;
            const res = jcResult.value;
            const data = res && res.data ? res.data : null;
            const moulds = (detResult.status === 'fulfilled' && Array.isArray(detResult.value?.data))
              ? detResult.value.data : [];
            const hasJobCards = data && Array.isArray(data.jobCards) && data.jobCards.length;
            const hasPlans = data && Array.isArray(data.plans) && data.plans.length;
            const hasMoulds = Array.isArray(moulds) && moulds.length;
            if (!data || (!hasJobCards && !hasPlans && !hasMoulds)) {
              panel.innerHTML = '<div class="mini muted" style="padding:8px 4px">No job cards found for this OR.</div>';
              return;
            }
            renderCpJobCards(panel, order, data, moulds);
            panel.dataset.loaded = '1';
          } catch (e) {
            panel.innerHTML = `<div class="mini" style="padding:8px 4px; color:#b91c1c">Failed to load job cards: ${esc(String(e?.message || e))}</div>`;
          }
        }

        // Build a planned/unplanned status list per mould family from the order's
        // /details rows. Pure: ignores the live draft queue (includeDraft=false) so
        // the expand panel reflects only what is actually saved on the board.
        function buildCpMouldStatusGroups(moulds) {
          const list = Array.isArray(moulds) ? moulds : [];
          const groups = new Map();
          list.forEach((mould) => {
            const family = normalizeCpFamilyCode(getCpMouldFamilyValue(mould));
            if (!groups.has(family)) {
              groups.set(family, {
                family,
                displayName: family || mould.mould_name || mould.product_name || mould.mould_no || 'Unnamed Mould',
                rows: []
              });
            }
            groups.get(family).rows.push(mould);
          });
          return Array.from(groups.values()).map((group) => {
            const snapshot = getCpFamilySnapshotByRows(group.rows, group.family, false);
            const minSqn = group.rows.reduce((min, row) => {
              const sqn = parseCpSqn(row.mouldingSqn || row.moulding_sqn);
              return Number.isFinite(sqn) ? (min == null ? sqn : Math.min(min, sqn)) : min;
            }, null);
            const allDropped = group.rows.length > 0 && group.rows.every((row) => !!row.isDropped);
            const hasPlanned = group.rows.some((row) => !!row.hasAnyPlan) || snapshot.plannedQty > 0;
            const fullyPlanned = (snapshot.targetQty > 0 && snapshot.remainingQty <= 0)
              || group.rows.every((row) => !!row.isDropped || !!row.isFullyPlanned);
            let status = 'unplanned';
            if (allDropped) status = 'dropped';
            else if (fullyPlanned) status = 'planned';
            else if (hasPlanned) status = 'partial';
            // Representative mould identity (prefer a dropped row) so the panel can
            // undrop/plan this family directly.
            const rep = group.rows.find((row) => !!row.isDropped) || group.rows[0] || {};
            return {
              displayName: group.displayName,
              minSqn,
              status,
              targetQty: snapshot.targetQty,
              plannedQty: snapshot.plannedQty,
              remainingQty: snapshot.remainingQty,
              mouldNo: rep.mould_no || rep.item_code || '',
              mouldName: rep.mould_name || ''
            };
          }).sort((a, b) => {
            const aSqn = Number.isFinite(a.minSqn) ? a.minSqn : Number.MAX_SAFE_INTEGER;
            const bSqn = Number.isFinite(b.minSqn) ? b.minSqn : Number.MAX_SAFE_INTEGER;
            if (aSqn !== bSqn) return aSqn - bSqn;
            return String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, { numeric: true, sensitivity: 'base' });
          });
        }

        function renderCpMouldStatusSection(moulds) {
          const groups = buildCpMouldStatusGroups(moulds);
          if (!groups.length) return '';
          const styleFor = {
            planned:   { bg: '#ecfdf5', bd: '#bbf7d0', fg: '#15803d', label: 'Planned' },
            partial:   { bg: '#fff7ed', bd: '#fed7aa', fg: '#c2410c', label: 'Partial' },
            unplanned: { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c', label: 'Not Planned' },
            dropped:   { bg: '#f1f5f9', bd: '#e2e8f0', fg: '#64748b', label: 'Dropped' }
          };
          const plannedCount = groups.filter((g) => g.status === 'planned').length;
          const openCount = groups.filter((g) => g.status === 'unplanned' || g.status === 'partial').length;
          const rows = groups.map((g) => {
            const s = styleFor[g.status] || styleFor.unplanned;
            const undropBtn = g.status === 'dropped'
              ? `<button type="button" class="btn small cp-mould-undrop"
                    data-mould-no="${esc(g.mouldNo)}" data-mould-name="${esc(g.mouldName)}"
                    style="width:100%; justify-content:center; margin-top:7px; background:#ecfdf5; color:#059669; border-color:#a7f3d0">
                    <i class="bi bi-arrow-counterclockwise"></i> Undrop &amp; Plan
                  </button>`
              : '';
            return `
              <div style="border:1px solid ${s.bd}; background:${s.bg}; border-radius:11px; padding:8px 10px; margin-bottom:7px">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:5px">
                  <div style="font-size:0.78rem; color:#0f172a; font-weight:800; overflow-wrap:anywhere">${esc(g.displayName)}${g.minSqn != null ? ` <span style="color:#94a3b8; font-weight:700; font-size:0.66rem">Sqn ${esc(String(g.minSqn))}</span>` : ''}</div>
                  <span class="tag small" style="background:#fff; color:${s.fg}; border-color:${s.bd}; font-weight:800">${s.label}</span>
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:0.7rem; color:#475569; font-weight:700">
                  <span>Target <strong style="color:#0f172a">${esc(formatCpQty(g.targetQty || 0))}</strong></span>
                  <span>Planned <strong style="color:#1d4ed8">${esc(formatCpQty(g.plannedQty || 0))}</strong></span>
                  <span>Balance <strong style="color:${(g.remainingQty || 0) > 0 ? '#c2410c' : '#15803d'}">${esc(formatCpQty(g.remainingQty || 0))}</strong></span>
                </div>
                ${undropBtn}
              </div>`;
          }).join('');
          return `
            <div style="margin-top:10px; padding-top:8px; border-top:1px dashed #cbd5e1">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:7px">
                <div style="font-size:0.66rem; color:#475569; font-weight:800; text-transform:uppercase; letter-spacing:0.06em">
                  Moulds — Planned / Not Planned (${plannedCount}/${groups.length} planned${openCount ? `, ${openCount} open` : ''})
                </div>
                <button type="button" class="btn small cp-open-order"
                  style="justify-content:center; background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; white-space:nowrap">
                  <i class="bi bi-box-arrow-up-right"></i> Open Order
                </button>
              </div>
              ${rows}
            </div>`;
        }

        function renderCpJobCards(panel, order, data, moulds) {
          const balQty = Number(data.balQty || 0);
          const orQty = Number(data.orQty || 0);
          const plannedQty = Number(data.plannedQty || 0);
          const fullyPlanned = !!data.fullyPlanned;

          const summary = `
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px">
              <div style="flex:1; min-width:78px; padding:6px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:9px">
                <div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em; font-weight:700">Planned</div>
                <div style="font-size:0.82rem; color:#0f172a; font-weight:800">${esc(formatCpQty(plannedQty))}</div>
              </div>
              <div style="flex:1; min-width:78px; padding:6px 8px; background:${fullyPlanned ? '#ecfdf5' : '#fff7ed'}; border:1px solid ${fullyPlanned ? '#bbf7d0' : '#fed7aa'}; border-radius:9px">
                <div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em; font-weight:700">Bal Qty (OR)</div>
                <div style="font-size:0.82rem; color:${fullyPlanned ? '#15803d' : '#c2410c'}; font-weight:800">${esc(formatCpQty(balQty))}</div>
              </div>
            </div>`;

          const rows = (data.jobCards || []).map((jc, idx) => {
            const linkedBadge = jc.planIdLinked
              ? '<span class="tag small" style="background:#dcfce7; color:#15803d; border-color:#bbf7d0">Linked</span>'
              : (jc.hasJobCardNo ? '' : '<span class="tag small" style="background:#fef2f2; color:#b91c1c; border-color:#fecaca">No JC No</span>');
            return `
              <div style="border:1px solid #e2e8f0; border-radius:11px; padding:9px 10px; margin-bottom:7px; background:#ffffff">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px">
                  <div style="font-size:0.7rem; color:#64748b; font-weight:800; text-transform:uppercase; letter-spacing:0.05em">Job Card ${idx + 1}</div>
                  ${linkedBadge}
                </div>
                <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px; margin-bottom:7px">
                  <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Job Card No</div><div style="font-size:0.76rem; color:#0f172a; font-weight:700; font-family:monospace; overflow-wrap:anywhere">${esc(jc.jobCardNo || '-')}</div></div>
                  <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Job Card Date</div><div style="font-size:0.76rem; color:#334155; font-weight:700">${esc(formatCpDate(jc.jobCardDate))}</div></div>
                  <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Job Card Qty</div><div style="font-size:0.76rem; color:#0f172a; font-weight:800">${esc(formatCpQty(jc.jobCardQty))}</div></div>
                  <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Bal Qty (OR)</div><div style="font-size:0.76rem; color:${fullyPlanned ? '#15803d' : '#c2410c'}; font-weight:800">${esc(formatCpQty(balQty))}</div></div>
                </div>
                <button type="button" class="btn small cp-jc-create-plan" data-idx="${idx}"
                  style="width:100%; justify-content:center; ${fullyPlanned ? 'opacity:0.55; cursor:not-allowed' : ''}"
                  ${fullyPlanned ? 'disabled' : ''}>
                  <i class="bi bi-plus-circle"></i> Create Plan
                </button>
              </div>`;
          }).join('');

          // Created Plans: what is already planned for this OR. Stays visible until
          // the OR leaves the pending list, so the user can see existing plans
          // (and any auto-linked Job Card) before creating more.
          const plansArr = Array.isArray(data.plans) ? data.plans : [];
          let plansSection = '';
          if (plansArr.length) {
            const planRows = plansArr.map((p) => {
              const jcBadge = p.jobCardNo
                ? `<span class="tag small" style="background:#dcfce7; color:#15803d; border-color:#bbf7d0">JC ${esc(p.jobCardNo)}</span>`
                : '<span class="tag small" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe">JC later</span>';
              return `
                <div style="border:1px solid #e2e8f0; border-radius:11px; padding:9px 10px; margin-bottom:7px; background:#f8fafc">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px">
                    <div style="font-size:0.7rem; color:#64748b; font-weight:800; text-transform:uppercase; letter-spacing:0.05em">Job Plan ${p.jobNo != null ? esc(String(p.jobNo)) : '-'}</div>
                    ${jcBadge}
                  </div>
                  <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px">
                    <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Plan ID</div><div style="font-size:0.74rem; color:#0f172a; font-weight:700; font-family:monospace; overflow-wrap:anywhere">${esc(p.planId || '-')}</div></div>
                    <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Job Qty</div><div style="font-size:0.74rem; color:#0f172a; font-weight:800">${esc(formatCpQty(p.jobQty))}</div></div>
                    <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Mould</div><div style="font-size:0.74rem; color:#334155; font-weight:700; overflow-wrap:anywhere">${esc(p.mouldName || '-')}</div></div>
                    <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Machine</div><div style="font-size:0.74rem; color:#334155; font-weight:700; overflow-wrap:anywhere">${esc(p.machine || '-')}</div></div>
                    <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Status</div><div style="font-size:0.74rem; color:#334155; font-weight:700">${esc(p.status || '-')}</div></div>
                    <div><div style="font-size:0.6rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; font-weight:700">Created By</div><div style="font-size:0.74rem; color:#334155; font-weight:700">${esc(p.createdBy || 'System')}</div></div>
                  </div>
                </div>`;
            }).join('');
            plansSection = `
              <div style="margin-top:10px; padding-top:8px; border-top:1px dashed #cbd5e1">
                <div style="font-size:0.66rem; color:#475569; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:7px">Created Plans (${plansArr.length})</div>
                ${planRows}
              </div>`;
          }

          // Moulds planned / not planned for this OR (from /details).
          const mouldsSection = renderCpMouldStatusSection(moulds);

          panel.innerHTML = summary + mouldsSection + rows + plansSection;

          panel.querySelectorAll('.cp-jc-create-plan').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              selectCpOrder(order, btn.closest('.cp-order-item'));
            });
          });

          // "Open Order" — always-available entry into the full order detail,
          // even when the OR shows fully planned (so dropped moulds can be reached).
          const openBtn = panel.querySelector('.cp-open-order');
          if (openBtn) {
            openBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              selectCpOrder(order, panel.closest('.cp-order-item'));
            });
          }

          // "Undrop & Plan" — restore a dropped mould family and open the order
          // detail focused on planning, in one tap from this status panel.
          panel.querySelectorAll('.cp-mould-undrop').forEach((btn) => {
            btn.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              const mould = {
                mould_no: btn.getAttribute('data-mould-no') || '',
                item_code: btn.getAttribute('data-mould-no') || '',
                mould_name: btn.getAttribute('data-mould-name') || ''
              };
              btn.disabled = true;
              try {
                // Open + set order context first so undrop has cpSelectedOrder.
                await selectCpOrder(order, panel.closest('.cp-order-item'));
                if (typeof window.undropCpMould === 'function') {
                  await window.undropCpMould(mould);
                }
              } catch (e) {
                btn.disabled = false;
                if (typeof toast === 'function') toast(String(e?.message || e), 'error');
              }
            });
          });
        }

        async function selectCpOrder(order, el) {
          const preserveQueue = el === true || !!el?.preserveQueue;
          const highlightEl = preserveQueue ? null : el;
          window.cpSelectedOrder = order;
          cpSelectedMould = null;
          cpSelectedMachine = null;
          window.cpOrderSequenceMeta = null;
          if (!preserveQueue) {
            window.cpCurrentBatchQty = null;
            window.cpOrderBatchHistory = [];
          }

          // UI Highlight
          const list = document.getElementById('cpOrderList');
          if (list) Array.from(list.children).forEach(c => applyCpOrderCardState(c, 'base'));
          if (highlightEl) applyCpOrderCardState(highlightEl, 'selected');

          // Show Detail View
          const empty = document.getElementById('cpEmptyState');
          const content = document.getElementById('cpDetailContent');
          if (empty) empty.style.display = 'none';
          if (content) content.style.display = 'flex';

          const tOrder = document.getElementById('cpTitleOrderNo');
          const tProd = document.getElementById('cpTitleProduct');
          if (tOrder) tOrder.textContent = order.orderNo;
          if (tProd) tProd.textContent = order.productName;

          const footer = document.getElementById('cpFooterStatus');
          if (footer) footer.textContent = 'Enter Job Qty to start planning';
          renderCpBatchSetup(order);

          // clear mould list
          const mList = document.getElementById('cpMouldList');
          if (mList) mList.innerHTML = '<div class="muted">Loading Moulds...</div>';

          const macSec = document.getElementById('cpMachineSection');
          if (macSec) macSec.style.display = 'none';
          clearCpColourPlan();

          const saveBtn = document.getElementById('cpSaveBtn');
          if (saveBtn) saveBtn.disabled = true;

          // Restore saved draft OR clear queue on order switch
          if (!preserveQueue) {
            const savedDraft = loadCpDraftForOrder(order.orderNo);
            if (savedDraft && Array.isArray(savedDraft.queue) && savedDraft.queue.length > 0) {
              cpDraftQueue.length = 0;
              savedDraft.queue.forEach((item) => cpDraftQueue.push(item));
              if (savedDraft.batchQty != null) window.cpCurrentBatchQty = savedDraft.batchQty;
            } else {
              cpDraftQueue.length = 0;
            }
            if (typeof updateQueueUI === 'function') updateQueueUI();
          }

          try {
            const [detailsResult, batchesResult] = await Promise.allSettled([
              api.get(`/planning/orders/${encodeURIComponent(order.orderNo)}/details`),
              api.get(`/planning/orders/${encodeURIComponent(order.orderNo)}/batches`)
            ]);
            if (detailsResult.status !== 'fulfilled') throw detailsResult.reason;
            const res = detailsResult.value;
            const batchRes = batchesResult.status === 'fulfilled' ? batchesResult.value : null;
            window.cpOrderMoulds = Array.isArray(res.data) ? res.data : [];
            window.cpOrderSequenceMeta = res.sequenceMeta || null;
            window.cpOrderBatchHistory = Array.isArray(batchRes?.data?.batches) ? batchRes.data.batches : [];
            renderCpBatchSetup(order);
            renderCpMoulds(window.cpOrderMoulds, window.cpOrderSequenceMeta);
          } catch (e) {
            window.cpOrderMoulds = [];
            window.cpOrderSequenceMeta = null;
            window.cpOrderBatchHistory = [];
            if (mList) mList.innerHTML = `<div class="error">Failed to load details: ${esc(e.message)}</div>`;
          }
        }
        window.selectCpOrder = selectCpOrder;

        function isCpWhitespaceChar(ch) {
          return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
        }

        function collapseCpWhitespace(value) {
          const raw = String(value || '').trim();
          let out = '';
          let pendingSpace = false;
          for (const ch of raw) {
            if (isCpWhitespaceChar(ch)) {
              pendingSpace = out.length > 0;
              continue;
            }
            if (pendingSpace) out += ' ';
            out += ch;
            pendingSpace = false;
          }
          return out.trim();
        }

        function stripCpTrailingSpaceNumber(value) {
          let end = value.length - 1;
          while (end >= 0 && value[end] >= '0' && value[end] <= '9') end -= 1;
          if (end === value.length - 1) return value;
          let spaceEnd = end;
          while (spaceEnd >= 0 && isCpWhitespaceChar(value[spaceEnd])) spaceEnd -= 1;
          return spaceEnd < end ? value.slice(0, spaceEnd + 1).trim() : value;
        }

        function normalizeCpFamilyCode(value) {
          return stripCpTrailingSpaceNumber(collapseCpWhitespace(value)).toUpperCase();
        }

        function getCpMouldFamilyValue(row) {
          return row?.mouldFamily || row?.mould_family || row?.mould_no || row?.mouldNo || row?.item_code || row?.itemCode || row?.mould_name || row?.mouldName || '';
        }

        function getCpMouldDisplayCode(row) {
          return row?.mouldNo || row?.mould_no || row?.item_code || row?.itemCode || row?.mouldName || row?.mould_name || '';
        }

        function getCpPayloadFamilyCode(item) {
          const persistedFamily = item?.normalizedFamily || item?.familyCode || item?.mouldFamily || item?.mould_family;
          if (persistedFamily) return normalizeCpFamilyCode(persistedFamily);
          const payloadCode = item?.mouldCode || item?.itemCode || item?.mouldName || '';
          const payloadKey = normalizeCpMouldKey(payloadCode);
          const orderRows = Array.isArray(window.cpOrderMoulds) ? window.cpOrderMoulds : [];
          const matched = orderRows.find((row) => {
            const rowKey = normalizeCpMouldKey(getCpMouldDisplayCode(row));
            const rowNameKey = normalizeCpMouldKey(row.mouldName || row.mould_name);
            return payloadKey && (payloadKey === rowKey || payloadKey === rowNameKey);
          });
          return normalizeCpFamilyCode(matched ? getCpMouldFamilyValue(matched) : payloadCode);
        }

        function parseCpSqn(value) {
          const raw = String(value || '').trim();
          const match = raw.match(/(\d+)/);
          return match ? Number(match[1]) : null;
        }

        function getCpDraftFamilyQtyMap(extraPayloads = []) {
          const map = new Map();
          getCpMergedQueueAndExtraPayloads(extraPayloads).forEach((item) => {
            const family = getCpPayloadFamilyCode(item);
            const qty = parseCpNumber(item.planQty) ?? 0;
            if (!family || qty <= 0) return;
            map.set(family, (map.get(family) || 0) + qty);
          });
          return map;
        }

        function getCpFamilyRowsByValue(value) {
          const family = normalizeCpFamilyCode(value);
          const orderRows = Array.isArray(window.cpOrderMoulds) ? window.cpOrderMoulds : [];
          return orderRows.filter((row) => normalizeCpFamilyCode(getCpMouldFamilyValue(row)) === family);
        }

        function getCpFamilySnapshotByRows(rows, familyCode, includeDraft = true, extraPayloads = []) {
          const safeRows = Array.isArray(rows) ? rows : [];
          // Only active (non-dropped) rows contribute to target and planned qty.
          // Dropped moulds' saved plans must not count — otherwise a dropped mould with
          // prior plans would make the family appear "fully covered" and block planning
          // of the remaining active mould.
          const activeRows = safeRows.filter((row) => !row.isDropped);
          const targetList = activeRows.map((row) => Math.max(0, parseCpNumber(row.targetPlanQty ?? row.plan_qty) ?? 0));
          const targetSum = targetList.reduce((sum, qty) => sum + qty, 0);
          const targetMax = targetList.reduce((max, qty) => Math.max(max, qty), 0);
          const targetQty = targetMax > 0 ? targetMax : targetSum;
          const plannedQty = activeRows.reduce((sum, row) => sum + (Math.max(0, parseCpNumber(row.plannedQty) ?? 0)), 0);
          const draftQty = includeDraft ? (getCpDraftFamilyQtyMap(extraPayloads).get(normalizeCpFamilyCode(familyCode)) || 0) : 0;
          const adjustedPlannedQty = plannedQty + draftQty;
          const remainingQty = Math.max(0, targetQty - adjustedPlannedQty);
          return { targetQty, plannedQty, draftQty, adjustedPlannedQty, remainingQty };
        }

        function getCpFamilySnapshotForMould(mould, includeDraft = true, extraPayloads = []) {
          const family = normalizeCpFamilyCode(getCpMouldFamilyValue(mould));
          const rows = getCpFamilyRowsByValue(family);
          return {
            family,
            rows,
            ...getCpFamilySnapshotByRows(rows, family, includeDraft, extraPayloads)
          };
        }

        function formatCpBalanceOrPlanned(value) {
          const qty = Math.max(0, parseCpNumber(value) ?? 0);
          return qty <= 0 ? 'Planned' : formatCpQty(qty);
        }

        function getCpOrderQty(order = window.cpSelectedOrder) {
          return Math.max(0, parseCpNumber(order?.orQty ?? order?.qty ?? order?.jcQty) ?? 0);
        }

        function getCpActiveBatchQty() {
          return Math.max(0, parseCpNumber(window.cpCurrentBatchQty) ?? 0);
        }

        function getCpMergePayloadKey(item) {
          return `${String(item.orderNo || '')}|${normalizeCpMouldKey(item.mouldCode || item.itemCode || item.mouldName)}|${String(item.machine || '')}`;
        }

        function getCpMergedQueueAndExtraPayloads(extraPayloads = []) {
          const queueItems = (Array.isArray(cpDraftQueue) ? cpDraftQueue : [])
            .filter((item) => Math.max(0, parseCpNumber(item.planQty) ?? 0) > 0);
          const extraItems = (Array.isArray(extraPayloads) ? extraPayloads : [])
            .filter((item) => Math.max(0, parseCpNumber(item.planQty) ?? 0) > 0);
          const merged = new Map();
          extraItems.forEach((row) => merged.set(getCpMergePayloadKey(row), row));
          queueItems.forEach((row) => merged.set(getCpMergePayloadKey(row), row));
          return Array.from(merged.values());
        }

        function getCpQueuedBatchQtyByMould(extraPayloads = []) {
          const map = new Map();
          const payloads = getCpMergedQueueAndExtraPayloads(extraPayloads);
          payloads.forEach((item) => {
            const key = normalizeCpMouldKey(item.mouldCode || item.itemCode || item.mouldName);
            const qty = Math.max(0, parseCpNumber(item.batchQty) ?? 0);
            if (!key || qty <= 0) return;
            map.set(key, (map.get(key) || 0) + qty);
          });
          return map;
        }

        function getCpExistingBatchQtyTotal() {
          return (Array.isArray(window.cpOrderBatchHistory) ? window.cpOrderBatchHistory : [])
            .reduce((sum, batch) => sum + Math.max(0, parseCpNumber(batch.batchQty) ?? 0), 0);
        }

        function formatCpDateTime(value) {
          if (!value) return '-';
          const dt = new Date(value);
          if (Number.isNaN(dt.getTime())) return String(value);
          return dt.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          });
        }

        function renderCpBatchHistoryRows() {
          const batches = Array.isArray(window.cpOrderBatchHistory) ? window.cpOrderBatchHistory : [];
          if (!batches.length) {
            return '';
          }
          return `
            <div style="margin-top:12px; border-top:1px solid #dbeafe; padding-top:12px">
              <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:8px">
                <div style="font-weight:900; color:#1e3a8a">Created Job Plans</div>
                <span class="tag">${esc(batches.length)} Job Plan(s)</span>
              </div>
              <div style="display:flex; flex-direction:column; gap:8px">
                ${batches.map((batch, idx) => `
                  <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; border:1px solid #bfdbfe; background:#fff; border-radius:14px; padding:9px 10px">
                    <div style="min-width:180px; flex:1 1 260px">
                      <div style="font-weight:900; color:#0f172a">Job Plan ${esc(batch.batchNo || idx + 1)} <span style="color:#64748b; font-weight:700">${esc(batch.ourCode || '')}</span></div>
                      <div class="mini muted">Job Qty: ${esc(formatCpQty(batch.batchQty || 0))} | Plan Qty: ${esc(formatCpQty(batch.planQty || 0))} | By ${esc(batch.createdBy || 'System')}</div>
                    </div>
                    <div class="mini muted" style="flex:0 1 auto">${esc(formatCpDateTime(batch.createdAt))}</div>
                    <button class="btn mini" type="button" data-cp-view-batch="${idx}" style="flex:0 0 auto">View Details</button>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }

        function bindCpBatchHistoryActions() {
          const box = document.getElementById('cpBatchSetup');
          if (!box) return;
          box.querySelectorAll('[data-cp-view-batch]').forEach((btn) => {
            btn.onclick = () => openCpBatchDetailsModal(Number(btn.dataset.cpViewBatch));
          });
        }

        function closeCpBatchDetailsModal() {
          const modal = document.getElementById('cpBatchDetailsModal');
          if (modal) modal.remove();
        }
        window.closeCpBatchDetailsModal = closeCpBatchDetailsModal;

        function openCpBatchDetailsModal(batchIndex) {
          const batch = (Array.isArray(window.cpOrderBatchHistory) ? window.cpOrderBatchHistory : [])[batchIndex];
          if (!batch) return toast('Job Plan details not found.', 'error');
          closeCpBatchDetailsModal();
          const rows = Array.isArray(batch.details) ? batch.details : [];
          const modal = document.createElement('div');
          modal.id = 'cpBatchDetailsModal';
          modal.className = 'modal show';
          modal.setAttribute('aria-hidden', 'false');
          modal.style.display = 'flex';
          modal.innerHTML = `
            <div class="modal-card" style="width:min(920px, 96vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden">
              <div class="modal-head" style="padding:14px 18px">
                <div>
                  <div style="font-size:.78rem; color:#0284c7; font-weight:900; letter-spacing:.12em; text-transform:uppercase">Job Plan Details</div>
                  <div style="font-size:1.1rem; color:#0f172a; font-weight:900; margin-top:4px">Job Plan ${esc(batch.batchNo || batchIndex + 1)} ${esc(batch.ourCode || '')}</div>
                  <div class="mini muted" style="margin-top:4px">Job Qty: ${esc(formatCpQty(batch.batchQty || 0))} | Created By: ${esc(batch.createdBy || 'System')} | ${esc(formatCpDateTime(batch.createdAt))}</div>
                </div>
                <button class="btn icon ghost" type="button" onclick="closeCpBatchDetailsModal()"><i class="bi bi-x-lg"></i></button>
              </div>
              <div style="padding:14px 18px; overflow:auto; background:linear-gradient(180deg,#f8fbff,#ffffff)">
                <table style="width:100%; min-width:760px; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden">
                  <thead>
                    <tr style="background:#f8fafc">
                      <th style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:left">Mould Name</th>
                      <th style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:left">Colour Name</th>
                      <th style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:right">Qty</th>
                      <th style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:right">Plan Qty</th>
                      <th style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:left">Machine</th>
                      <th style="padding:10px 8px; border-bottom:1px solid #e2e8f0; text-align:left">Who Create</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.length ? rows.map((row) => `
                      <tr>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; font-weight:800">${esc(row.mouldName || '-')}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; color:#4338ca; font-weight:800">${esc(row.colourName || '-')}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:900">${esc(formatCpQty(row.qty || 0))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right">${esc(formatCpQty(row.planQty || 0))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9">${esc(row.machine || '-')}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9">${esc(row.createdBy || batch.createdBy || 'System')}</td>
                      </tr>
                    `).join('') : `<tr><td colspan="6" style="padding:18px; text-align:center; color:#64748b">No job plan details found.</td></tr>`}
                  </tbody>
                </table>
              </div>
              <div class="modal-actions" style="padding:12px 18px">
                <button class="btn primary" type="button" onclick="closeCpBatchDetailsModal()">Close</button>
              </div>
            </div>
          `;
          document.body.appendChild(modal);
        }
        window.openCpBatchDetailsModal = openCpBatchDetailsModal;

        function renderCpBatchSetup(order = window.cpSelectedOrder) {
          const box = document.getElementById('cpBatchSetup');
          if (!box || !order) return;
          const orderQty = getCpOrderQty(order);
          const batchStatus = getCpBatchCompleteness();
          const locked = cpDraftQueue.length > 0;
          const currentBatchQty = parseCpNumber(window.cpCurrentBatchQty) ?? '';
          const savedMoulds = Math.max(0, (batchStatus.required?.length || 0) - (batchStatus.missing?.length || 0));
          const existingBatchQty = getCpExistingBatchQtyTotal();
          const availableBalanceQty = Math.max(orderQty - existingBatchQty, 0);
          box.style.display = 'block';
          box.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; align-items:stretch">
              <div>
                <div class="mini muted">OR Qty</div>
                <div style="font-weight:900; color:#0f172a; margin-top:4px; font-size:1.05rem">${esc(formatCpQty(orderQty))}</div>
              </div>
              <div>
                <label class="mini muted" for="cpBatchQtyInput" style="display:block; margin-bottom:5px">Create Job Qty</label>
                <input id="cpBatchQtyInput" type="number" min="1" step="1" max="${esc(orderQty || '')}" value="${esc(currentBatchQty)}" ${locked ? 'disabled' : ''}
                  placeholder="Enter job qty, e.g. 600"
                  style="width:100%; border:1px solid #93c5fd; border-radius:12px; padding:10px 12px; font-weight:900; color:#0f172a; background:${locked ? '#f1f5f9' : '#fff'}">
              </div>
              <div style="border:1px solid #fed7aa; background:#fff7ed; border-radius:14px; padding:10px 12px">
                <div class="mini muted">Balance Qty</div>
                <div id="cpBatchBalanceQty" style="font-weight:900; color:#c2410c; margin-top:4px">${esc(formatCpQty(availableBalanceQty))}</div>
                <div class="mini muted" style="margin-top:3px">Available: ${esc(formatCpQty(availableBalanceQty))}</div>
              </div>
              ${locked ? `<div style="border:1px solid #bbf7d0; background:#f0fdf4; color:#166534; border-radius:14px; padding:10px 12px; font-weight:800; font-size:.86rem; min-width:0">Job Plan locked at ${esc(formatCpQty(currentBatchQty))} per mould. Saved moulds ${esc(savedMoulds)} / ${esc(batchStatus.required?.length || 0)}.</div>` : ''}
            </div>
            ${renderCpBatchHistoryRows()}
          `;
          const input = document.getElementById('cpBatchQtyInput');
          if (input && !locked) {
            input.oninput = () => {
              const requested = Math.max(0, parseCpNumber(input.value) ?? 0);
              const value = Math.min(requested, Math.max(orderQty, 0));
              if (requested !== value) input.value = String(value);
              window.cpCurrentBatchQty = value || null;
              const footer = document.getElementById('cpFooterStatus');
              if (footer) footer.textContent = value ? `Job Qty set: ${formatCpQty(value)}` : 'Enter Job Qty to start planning';
            };
          }
          bindCpBatchHistoryActions();
        }

        function buildCpMouldGroups(moulds) {
          const groups = new Map();
          moulds.forEach((mould) => {
            const family = normalizeCpFamilyCode(getCpMouldFamilyValue(mould));
            if (!groups.has(family)) {
              groups.set(family, {
                family,
                displayName: family || mould.mould_name || mould.product_name || mould.mould_no || 'Unnamed Mould',
                rows: []
              });
            }
            groups.get(family).rows.push(mould);
          });
          return Array.from(groups.values()).map((group) => {
            group.rows.sort((a, b) => {
              const aSqn = parseCpSqn(a.mouldingSqn || a.moulding_sqn) ?? Number.MAX_SAFE_INTEGER;
              const bSqn = parseCpSqn(b.mouldingSqn || b.moulding_sqn) ?? Number.MAX_SAFE_INTEGER;
              if (aSqn !== bSqn) return aSqn - bSqn;
              return String(a.mould_no || '').localeCompare(String(b.mould_no || ''), undefined, { numeric: true, sensitivity: 'base' });
            });
            group.minSqn = group.rows.reduce((min, row) => {
              const sqn = parseCpSqn(row.mouldingSqn || row.moulding_sqn);
              return Number.isFinite(sqn) ? (min == null ? sqn : Math.min(min, sqn)) : min;
            }, null);
            group.hasDropped = group.rows.some((row) => !!row.isDropped);
            group.hasPlanned = group.rows.some((row) => !!row.hasAnyPlan);
            group.hasMissingSqn = group.rows.some((row) => !Number.isFinite(parseCpSqn(row.mouldingSqn || row.moulding_sqn)));
            const snapshot = getCpFamilySnapshotByRows(group.rows, group.family, true);
            group.targetPlanQty = snapshot.targetQty;
            group.plannedQty = snapshot.plannedQty;
            group.remainingQty = snapshot.remainingQty;
            group.draftQty = snapshot.draftQty;
            group.adjustedPlannedQty = snapshot.adjustedPlannedQty;
            group.adjustedRemainingQty = snapshot.remainingQty;
            // hasFullyPlanned uses the draft-inclusive snapshot so that adding any variant
            // to the queue immediately greys out the whole family group in the UI.
            // (The Create Plan button is guarded separately via getCpRequiredBatchMoulds.)
            group.hasFullyPlanned = group.rows.every((row) => !!row.isDropped || !!row.isFullyPlanned)
              || (snapshot.targetQty > 0 && snapshot.remainingQty <= 0);
            return group;
          }).sort((a, b) => {
            const aSqn = Number.isFinite(a.minSqn) ? a.minSqn : Number.MAX_SAFE_INTEGER;
            const bSqn = Number.isFinite(b.minSqn) ? b.minSqn : Number.MAX_SAFE_INTEGER;
            if (aSqn !== bSqn) return aSqn - bSqn;
            return String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, { numeric: true, sensitivity: 'base' });
          });
        }

        function renderCpSequenceMeta(meta) {
          const alert = document.getElementById('cpSequenceAlert');
          const board = document.getElementById('cpSequenceBoard');
          if (!alert || !board) return;

          const allRows = Array.isArray(meta?.allMoulds) ? meta.allMoulds : [];
          if (!allRows.length) {
            alert.style.display = 'none';
            board.style.display = 'none';
            board.innerHTML = '';
            return;
          }

          if (meta?.missingSqnMoulds?.length) {
            const names = meta.missingSqnMoulds.map((row) => row.mouldNo || row.mouldName).filter(Boolean).join(', ');
            alert.style.display = 'block';
            alert.innerHTML = `
              <div style="border:1px solid #fecaca; background:#fff1f2; color:#be123c; border-radius:16px; padding:12px 14px; font-weight:700">
                Fill Moulding Sqn. first in Mould Master for: ${esc(names)}.
              </div>
            `;
          } else if (meta?.nextRequiredSqn != null) {
            const nextNames = (meta.requiredRows || []).map((row) => row.mouldNo || row.mouldName).filter(Boolean).join(', ');
            alert.style.display = 'block';
            alert.innerHTML = `
              <div style="border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; border-radius:16px; padding:12px 14px; font-weight:700">
                Plan Moulding Sqn. ${esc(meta.nextRequiredSqn)} first: ${esc(nextNames)}.
              </div>
            `;
          } else {
            alert.style.display = 'block';
            alert.innerHTML = `
              <div style="border:1px solid #bbf7d0; background:#f0fdf4; color:#166534; border-radius:16px; padding:12px 14px; font-weight:700">
                All moulding sequence checks are complete for this order.
              </div>
            `;
          }

          board.style.display = 'block';
          board.innerHTML = `
            <div style="font-size:0.8rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#475569; margin-bottom:8px">
              Mould Master Sequence Check
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px">
              ${allRows.map((row) => {
                const palette = row.planState === 'NEXT'
                  ? { border: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8', badge: '#dbeafe' }
                  : row.planState === 'PLANNED'
                    ? { border: '#86efac', bg: '#f0fdf4', text: '#166534', badge: '#dcfce7' }
                    : row.planState === 'PARTIAL'
                      ? { border: '#f59e0b', bg: '#fffbeb', text: '#b45309', badge: '#fef3c7' }
                    : row.planState === 'DROPPED'
                      ? { border: '#fecaca', bg: '#fff1f2', text: '#be123c', badge: '#ffe4e6' }
                      : row.planState === 'MISSING_SQN'
                        ? { border: '#fdba74', bg: '#fff7ed', text: '#c2410c', badge: '#ffedd5' }
                        : { border: '#cbd5e1', bg: '#ffffff', text: '#334155', badge: '#f1f5f9' };
                return `
                  <div style="border:1px solid ${palette.border}; background:${palette.bg}; border-radius:16px; padding:12px; box-shadow:0 10px 24px rgba(15,23,42,.05); min-width:0">
                    <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start">
                      <div style="font-weight:900; color:#0f172a; line-height:1.15; min-width:0; word-break:break-word">${esc(row.mouldName || row.mouldNo)}</div>
                      <span style="background:${palette.badge}; color:${palette.text}; border-radius:999px; padding:4px 8px; font-size:.72rem; font-weight:900; white-space:nowrap; flex-shrink:0">${esc(row.planState)}</span>
                    </div>
                    <div style="margin-top:7px; color:#475569; font-size:.84rem; line-height:1.35">Mould No: <strong>${esc(row.mouldNo || '-')}</strong></div>
                    <div style="margin-top:2px; color:#475569; font-size:.84rem">Moulding Sqn.: <strong>${esc(row.mouldingSqn || '-')}</strong></div>
                    <div style="margin-top:10px; display:grid; grid-template-columns:repeat(3, minmax(72px, 1fr)); gap:7px">
                      <div style="border:1px solid rgba(203,213,225,.8); border-radius:12px; background:#fff; padding:7px 8px; min-width:0">
                        <div class="mini muted">Target</div>
                        <div style="font-weight:900; color:#0f172a; margin-top:2px; white-space:nowrap">${esc(formatCpQty(row.targetPlanQty || 0))}</div>
                      </div>
                      <div style="border:1px solid rgba(203,213,225,.8); border-radius:12px; background:#fff; padding:7px 8px; min-width:0">
                        <div class="mini muted">Planned</div>
                        <div style="font-weight:900; color:#0f172a; margin-top:2px; white-space:nowrap">${esc(formatCpQty(row.plannedQty || 0))}</div>
                      </div>
                      <div style="border:1px solid rgba(203,213,225,.8); border-radius:12px; background:#fff; padding:7px 8px; min-width:0">
                        <div class="mini muted">Balance</div>
                        <div style="font-weight:900; color:${row.remainingQty > 0 ? '#b45309' : '#166534'}; margin-top:2px; white-space:nowrap">${esc(formatCpQty(row.remainingQty || 0))}</div>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }

        function getCpGroupBlockReason(group, meta) {
          if (meta?.missingSqnMoulds?.length) {
            return 'Fill missing Moulding Sqn. values in Mould Master first.';
          }
          if (group.hasFullyPlanned) {
            return 'This mould family is fully planned or dropped.';
          }
          if (cpDraftQueue.length > 0) {
            return '';
          }
          if (meta?.nextRequiredSqn != null && Number.isFinite(group.minSqn) && group.minSqn !== meta.nextRequiredSqn) {
            const pendingNames = (meta.requiredRows || []).map((row) => row.mouldNo || row.mouldName).filter(Boolean).join(', ');
            return `Plan Moulding Sqn. ${meta.nextRequiredSqn} first: ${pendingNames}.`;
          }
          return '';
        }

        function closeCpMouldChooser() {
          const modal = document.getElementById('cpMouldChooserModal');
          if (modal) modal.remove();
        }
        window.closeCpMouldChooser = closeCpMouldChooser;

        function openCpMouldChooser(group) {
          closeCpMouldChooser();
          const queuedKeys = new Set(getCpMergedQueueAndExtraPayloads().map((item) => normalizeCpMouldKey(item.mouldCode || item.itemCode || item.mouldName)).filter(Boolean));
          const remainingQty = Math.max(0, parseCpNumber(group.adjustedRemainingQty) ?? 0);
          const unusedRows = (group.rows || []).filter((row) => {
            if (row.isDropped || row.isFullyPlanned || row.isAlreadyPlanned) return false;
            const key = normalizeCpMouldKey(getCpMouldDisplayCode(row));
            return key && !queuedKeys.has(key) && !row.hasAnyPlan;
          });
          const chooserRows = (group.rows || []).length > 1 && remainingQty > 0 && unusedRows.length
            ? unusedRows
            : (group.rows || []);
          const hiddenUsedCount = Math.max(0, (group.rows || []).length - chooserRows.length);
          const modal = document.createElement('div');
          modal.id = 'cpMouldChooserModal';
          modal.className = 'modal show';
          modal.setAttribute('aria-hidden', 'false');
          modal.style.display = 'flex';
          modal.innerHTML = `
            <div class="modal-card" style="width:920px; max-width:96vw; max-height:88vh; display:flex; flex-direction:column; overflow:hidden">
              <div class="modal-head" style="flex-shrink:0">
                <div>
                  <div style="font-size:.78rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b">Colour Wise Mould Plan</div>
                  <strong style="font-size:1.2rem; color:#0f172a">${esc(group.displayName)}</strong>
                  <div class="mini muted" style="margin-top:4px">Select the exact mould variant from OR/JR wise summary and Mould Master details.</div>
                </div>
                <button class="btn icon ghost" type="button" onclick="closeCpMouldChooser()"><i class="bi bi-x-lg"></i></button>
              </div>
              <div style="padding:14px 18px; border-bottom:1px solid var(--border); background:#f8fafc; flex-shrink:0; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px">
                <div><div class="mini muted">Selected Order</div><strong>${esc(window.cpSelectedOrder?.orderNo || '-')}</strong></div>
                <div><div class="mini muted">Product</div><strong>${esc(window.cpSelectedOrder?.productName || '-')}</strong></div>
                <div><div class="mini muted">Required Sqn.</div><strong>${esc(window.cpOrderSequenceMeta?.nextRequiredSqn ?? '-')}</strong></div>
              </div>
              <div style="padding:10px 18px; border-bottom:1px solid var(--border); background:#eff6ff; color:#1d4ed8; font-weight:800; font-size:.84rem">
                Shared Family Balance Applied: planning one variant updates balance for all variants in this family.${hiddenUsedCount ? ` Showing only unused variant(s) while balance remains.` : ''}
              </div>
              <div style="padding:18px; overflow:auto; display:flex; flex-direction:column; gap:12px">
                ${chooserRows.map((row, index) => `
                  <div style="border:1px solid rgba(203,213,225,.95); border-radius:18px; padding:16px; background:linear-gradient(180deg, #ffffff, #f8fbff); box-shadow:0 14px 30px rgba(15,23,42,.06)">
                    <div style="display:grid; grid-template-columns:minmax(0, 1.4fr) repeat(4, minmax(110px, .7fr)) auto; gap:12px; align-items:center">
                      <div>
                        <div style="font-size:.78rem; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase">Mould Option ${index + 1}</div>
                        <div style="font-weight:800; font-size:1rem; color:#0f172a; margin-top:4px">${esc(row.mould_name || row.product_name || row.mould_no)}</div>
                        <div style="margin-top:6px; color:#475569; font-size:.85rem">Mould No: <strong>${esc(row.mould_no || '-')}</strong></div>
                      </div>
                      <div><div class="mini muted">Moulding Sqn.</div><strong>${esc(row.mouldingSqn || row.moulding_sqn || '-')}</strong></div>
                      <div><div class="mini muted">STD Cycle Time</div><strong>${esc(row.masterCycleTime || row.cycle_time || '-')}</strong></div>
                      <div><div class="mini muted">Std Weight</div><strong>${esc(row.masterStdWeight || '-')}</strong></div>
                      <div><div class="mini muted">No Of Cavity</div><strong>${esc(row.masterCavity || row.no_of_cavity || '-')}</strong></div>
                      <button class="btn primary" type="button" onclick="window.selectCpMouldVariant(${index})">Select Mould</button>
                    </div>
                    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">
                      ${window.cpLabourPlanType === 'Labour Job' && cpSelectedMachine
                        ? `<span class="tag" style="background:#fef3c7; color:#92400e; border-color:#fde68a"><i class="bi bi-people-fill"></i> Labour Job: ${esc(cpSelectedMachine.machine)}</span>`
                        : `<span class="tag" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe">Primary: ${esc(row.primary_machine || '-')}</span>
                           <span class="tag" style="background:#fff7ed; color:#c2410c; border-color:#fed7aa">Secondary: ${esc(row.secondary_machine || '-')}</span>`
                      }
                      <span class="tag">Target ${esc(formatCpQty(group.targetPlanQty || 0))}</span>
                      <span class="tag">Planned ${esc(formatCpQty(group.adjustedPlannedQty || 0))}</span>
                      <span class="tag">Balance ${esc(formatCpBalanceOrPlanned(group.adjustedRemainingQty || 0))}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          document.body.appendChild(modal);
          window.cpChooserRows = chooserRows.slice();
        }

        window.selectCpMouldVariant = function(index) {
          const rows = Array.isArray(window.cpChooserRows) ? window.cpChooserRows : [];
          const mould = rows[index];
          if (!mould) return toast('Selected mould option is no longer available.', 'error');
          closeCpMouldChooser();
          selectCpMould(mould);
        };

        function renderCpSelectedMouldSummary(mould) {
          const box = document.getElementById('cpSelectedMouldSummary');
          if (!box) return;
          if (!mould) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
          }
          const familySnapshot = getCpFamilySnapshotForMould(mould, true);
          box.style.display = 'block';
          box.innerHTML = `
            <div style="border:1px solid #bfdbfe; background:linear-gradient(180deg, #f8fbff, #eef6ff); border-radius:18px; padding:14px 16px; box-shadow:0 12px 28px rgba(59,130,246,.08)">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap">
                <div>
                  <div style="font-size:.78rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b">Selected Mould</div>
                  <div style="margin-top:4px; font-size:1rem; font-weight:800; color:#0f172a">${esc(mould.mould_name || mould.mouldName || '-')}</div>
                  <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap">
                    <span class="tag" style="font-family:monospace">${esc(mould.mould_no || mould.item_code || '-')}</span>
                    <span class="tag">Moulding Sqn. ${esc(mould.mouldingSqn || mould.moulding_sqn || '-')}</span>
                  </div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(3, minmax(120px, 1fr)); gap:10px; flex:1; min-width:min(100%, 360px)">
                  <div style="border:1px solid rgba(203,213,225,.85); border-radius:14px; padding:10px 12px; background:#fff">
                    <div class="mini muted">STD Cycle Time</div>
                    <div style="font-weight:800; color:#0f172a; margin-top:4px">${esc(mould.masterCycleTime || mould.cycle_time || '-')}</div>
                  </div>
                  <div style="border:1px solid rgba(203,213,225,.85); border-radius:14px; padding:10px 12px; background:#fff">
                    <div class="mini muted">Std Weight</div>
                    <div style="font-weight:800; color:#0f172a; margin-top:4px">${esc(mould.masterStdWeight || mould.std_wt_kg || '-')}</div>
                  </div>
                  <div style="border:1px solid rgba(203,213,225,.85); border-radius:14px; padding:10px 12px; background:#fff">
                    <div class="mini muted">No Of Cavity</div>
                    <div style="font-weight:800; color:#0f172a; margin-top:4px">${esc(mould.masterCavity || mould.no_of_cavity || '-')}</div>
                  </div>
                </div>
              </div>
              <div style="margin-top:12px; display:grid; grid-template-columns:repeat(3, minmax(160px, 1fr)); gap:10px">
                <div style="border:1px solid #e2e8f0; border-radius:14px; padding:10px 12px; background:#fff">
                  <div class="mini muted">Target Qty</div>
                  <div style="font-weight:800; color:#0f172a; margin-top:4px">${esc(formatCpQty(familySnapshot.targetQty || 0))}</div>
                </div>
                <div style="border:1px solid #dbeafe; border-radius:14px; padding:10px 12px; background:#eff6ff">
                  <div class="mini muted">Already Planned</div>
                  <div style="font-weight:800; color:#1d4ed8; margin-top:4px">${esc(formatCpQty(familySnapshot.adjustedPlannedQty || 0))}</div>
                </div>
                <div style="border:1px solid #fed7aa; border-radius:14px; padding:10px 12px; background:#fff7ed">
                  <div class="mini muted">Balance To Plan</div>
                  <div style="font-weight:800; color:#c2410c; margin-top:4px">${esc(formatCpBalanceOrPlanned(familySnapshot.remainingQty || 0))}</div>
                </div>
              </div>
              <div style="margin-top:12px; display:grid; grid-template-columns:repeat(2, minmax(220px, 1fr)); gap:10px">
                <div style="border:1px solid #bfdbfe; border-radius:14px; padding:10px 12px; background:#eff6ff">
                  <div class="mini muted">Primary Machine</div>
                  <div style="font-weight:800; color:#1d4ed8; margin-top:4px">${esc(mould.primary_machine || mould.primaryMachine || '-')}</div>
                </div>
                <div style="border:1px solid #fed7aa; border-radius:14px; padding:10px 12px; background:#fff7ed">
                  <div class="mini muted">Secondary Machine</div>
                  <div style="font-weight:800; color:#c2410c; margin-top:4px">${esc(mould.secondary_machine || mould.secondaryMachine || '-')}</div>
                </div>
              </div>
            </div>
          `;
        }

        function parseCpNumber(value) {
          if (value === null || value === undefined || value === '') return null;
          const raw = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        }

        function clearCpColourPlan() {
          const box = document.getElementById('cpColourPlanBlock');
          if (!box) return;
          box.style.display = 'none';
          box.innerHTML = '';
        }

        function renderCpColourPlan(mould, payload) {
          const box = document.getElementById('cpColourPlanBlock');
          if (!box) return;
          const rows = Array.isArray(payload?.rows) ? payload.rows : [];
          const ratio = parseCpNumber(mould?.consumptionRatioQty);
          const wipDate = payload?.meta?.wipStockDate ? formatCpDate(payload.meta.wipStockDate) : null;

          if (!rows.length) {
            box.style.display = 'block';
            box.innerHTML = `
              <div style="border:1px solid #cbd5e1; background:#fff; border-radius:18px; padding:14px 16px">
                <div style="font-size:.82rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b">Colour Wise Mould Plan</div>
                <div style="margin-top:6px; color:#475569; font-size:.9rem">No OR/JR Wise Detail colours were found for the selected mould.</div>
              </div>
            `;
            return;
          }

          const enrichedRows = rows.map((row, index) => {
            const reqQty = parseCpNumber(row.reqQty ?? row.jr_qty) ?? 0;
            const useQty = parseCpNumber(row.useQty ?? row.planQty ?? row.plan_qty ?? row.suggestedPlanQty ?? row.mould_item_qty) ?? reqQty;
            const planQty = parseCpNumber(row.planQty ?? row.plan_qty ?? row.suggestedPlanQty ?? row.mould_item_qty) ?? useQty;
            const reqBalQty = parseCpNumber(row.reqBalQty) ?? Math.max(reqQty - useQty, 0);
            const wipQty = parseCpNumber(row.wipQty ?? row.wip_qty) ?? 0;
            const consumeQty = ratio == null ? null : Number((useQty * ratio).toFixed(3));
            const wipBalQty = parseCpNumber(row.wipBalQty) ?? Math.max(wipQty - useQty, 0);
            return {
              index: index + 1,
              itemCode: row.itemCode || row.item_code || '-',
              itemName: row.itemName || row.product_name || row.mould_item_name || '-',
              itemColour: row.itemColour || row.item_colour || null,
              rawItemName: row.rawMouldItemName || row.raw_item_name || row.mould_item_name || row.product_name || null,
              reqQty,
              useQty,
              reqBalQty,
              wipQty,
              consumeQty,
              wipBalQty,
              planQty,
              mouldSelection: row.selectedMould || row.mould_no || mould?.mould_no || '-'
            };
          });

          const totals = enrichedRows.reduce((acc, row) => {
            acc.reqQty += row.reqQty || 0;
            acc.useQty += row.useQty || 0;
            acc.reqBalQty += row.reqBalQty || 0;
            acc.wipQty += row.wipQty || 0;
            acc.consumeQty += row.consumeQty || 0;
            acc.wipBalQty += row.wipBalQty || 0;
            acc.planQty += row.planQty || 0;
            return acc;
          }, { reqQty: 0, useQty: 0, reqBalQty: 0, wipQty: 0, consumeQty: 0, wipBalQty: 0, planQty: 0 });

          box.style.display = 'block';
          box.innerHTML = `
            <div style="border:1px solid #bfdbfe; background:linear-gradient(180deg, #ffffff, #f8fbff); border-radius:18px; padding:14px 16px; box-shadow:0 12px 28px rgba(59,130,246,.08)">
              <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; margin-bottom:12px">
                <div>
                  <div style="font-size:.78rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b">Colour Wise Mould Plan</div>
                  <div style="margin-top:4px; color:#0f172a; font-size:1rem; font-weight:800">${esc(mould?.mould_name || mould?.mouldName || mould?.mould_no || '-')}</div>
                  <div style="margin-top:4px; color:#475569; font-size:.86rem">Available colours from OR/JR Wise Detail for the selected mould.</div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end">
                  ${wipDate ? `<span class="tag" style="background:#f0fdf4; color:#166534; border-color:#bbf7d0">WIP As On ${esc(wipDate)}</span>` : ''}
                  ${ratio != null ? `<span class="tag" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe">Consumption Ratio ${esc(formatCpQty(ratio))}</span>` : ''}
                  <span class="tag">${esc(enrichedRows.length)} Colours</span>
                </div>
              </div>
              <div style="overflow:auto; border:1px solid rgba(203,213,225,.92); border-radius:16px; background:#fff">
                <table style="width:100%; min-width:1080px; border-collapse:separate; border-spacing:0">
                  <thead>
                    <tr style="background:#f8fafc">
                      <th style="padding:10px 8px; text-align:left; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">#</th>
                      <th style="padding:10px 8px; text-align:left; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Item Code</th>
                      <th style="padding:10px 8px; text-align:left; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Item Name</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Req. Qty</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Use</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Req. Qty (Bal)</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">WIP</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Consume</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">WIP Bal</th>
                      <th style="padding:10px 8px; text-align:right; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Plan Qty</th>
                      <th style="padding:10px 8px; text-align:left; font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid #e2e8f0">Mould Selection</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${enrichedRows.map((row, idx) => `
                      <tr style="background:${idx % 2 === 0 ? '#fff' : '#f8fbff'}">
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; color:#64748b; font-weight:700">${esc(row.index)}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; color:#0f172a; font-weight:700; font-family:monospace">${esc(row.itemCode)}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; color:#0f172a; min-width:240px">${esc(row.itemName)}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700">${esc(formatCpQty(row.reqQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right; color:#1d4ed8; font-weight:800">${esc(formatCpQty(row.useQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right">${esc(formatCpQty(row.reqBalQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700">${esc(formatCpQty(row.wipQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right">${row.consumeQty == null ? '<span style="color:#94a3b8">-</span>' : esc(formatCpQty(row.consumeQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700; color:#0f766e">${esc(formatCpQty(row.wipBalQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:800">${esc(formatCpQty(row.planQty))}</td>
                        <td style="padding:9px 8px; border-bottom:1px solid #f1f5f9"><span class="tag" style="font-family:monospace">${esc(row.mouldSelection)}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="background:#f8fafc">
                      <td colspan="3" style="padding:10px 8px; border-top:1px solid #e2e8f0; font-weight:800; color:#0f172a">Total</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${esc(formatCpQty(totals.reqQty))}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${esc(formatCpQty(totals.useQty))}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${esc(formatCpQty(totals.reqBalQty))}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${esc(formatCpQty(totals.wipQty))}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${totals.consumeQty ? esc(formatCpQty(totals.consumeQty)) : '-'}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${esc(formatCpQty(totals.wipBalQty))}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:800">${esc(formatCpQty(totals.planQty))}</td>
                      <td style="padding:10px 8px; border-top:1px solid #e2e8f0"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          `;
        }

        async function loadCpColourPlan(mould) {
          const box = document.getElementById('cpColourPlanBlock');
          if (!box || !window.cpSelectedOrder || !mould) {
            clearCpColourPlan();
            return;
          }
          box.style.display = 'block';
          box.innerHTML = `
            <div style="border:1px solid #cbd5e1; background:#fff; border-radius:18px; padding:14px 16px; color:#475569">
              Loading colour-wise mould detail...
            </div>
          `;
          try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            const params = new URLSearchParams();
            if (mould.mould_no) params.set('mouldNo', mould.mould_no);
            if (mould.mould_name) params.set('mouldName', mould.mould_name);
            if (mould.mouldFamily || mould.mould_family) params.set('mouldFamily', mould.mouldFamily || mould.mould_family);
            const res = await api.get(`/planning/orders/${encodeURIComponent(window.cpSelectedOrder.orderNo)}/colour-plan?${params.toString()}`);
            renderCpColourPlan(mould, {
              rows: Array.isArray(res.data) ? res.data : [],
              meta: res.meta || {}
            });
          } catch (e) {
            box.style.display = 'block';
            box.innerHTML = `
              <div style="border:1px solid #fecaca; background:#fff1f2; border-radius:18px; padding:14px 16px; color:#be123c">
                Failed to load colour-wise mould detail: ${esc(e.message)}
              </div>
            `;
          }
        }

        async function fetchCpColourPlanData(mould) {
          if (!window.cpSelectedOrder || !mould) return { rows: [], meta: {} };
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const params = new URLSearchParams();
          if (mould.mould_no) params.set('mouldNo', mould.mould_no);
          if (mould.mould_name) params.set('mouldName', mould.mould_name);
          if (mould.mouldFamily || mould.mould_family) params.set('mouldFamily', mould.mouldFamily || mould.mould_family);
          const res = await api.get(`/planning/orders/${encodeURIComponent(window.cpSelectedOrder.orderNo)}/colour-plan?${params.toString()}`);
          return {
            rows: Array.isArray(res.data) ? res.data : [],
            meta: res.meta || {}
          };
        }

        function closeCpColourPlanModal() {
          const modal = document.getElementById('cpColourPlanModal');
          if (modal) modal.remove();
          // Reset Labour Job flag so the next "Select Mould" click (regular factory mould)
          // doesn't mistakenly inherit the Labour Job machine that was previously selected.
          window.cpLabourPlanType = null;
        }
        window.closeCpColourPlanModal = closeCpColourPlanModal;

        function extractCpColourParts(value) {
          const text = String(value || '').trim();
          if (!text) return { itemName: null, itemColour: null };
          const dashIndex = text.lastIndexOf('-');
          if (dashIndex === -1) return { itemName: text, itemColour: null };
          const itemName = text.slice(0, dashIndex).trim();
          const itemColour = text.slice(dashIndex + 1).trim();
          return {
            itemName: itemName || text,
            itemColour: itemColour || null
          };
        }

        function buildCpColourRows(mould, rows, options = {}) {
          const mouldBalanceLimit = Math.max(0, parseCpNumber(mould?.remainingQty ?? mould?.targetPlanQty ?? mould?.plan_qty) ?? 0);
          let remainingDefaultQty = Number.isFinite(mouldBalanceLimit) ? mouldBalanceLimit : Number.POSITIVE_INFINITY;
          const availableMoulds = Array.isArray(options.availableMoulds) ? options.availableMoulds : [];
          const machineMap = options.machineMap || {};
          return (Array.isArray(rows) ? rows : []).map((row, index) => {
            const colourParts = extractCpColourParts(row.rawMouldItemName || row.rawItemName || row.mould_item_name || row.product_name || row.itemName);
            const mouldItemQty = parseCpNumber(row.mouldItemQty ?? row.mould_item_qty ?? row.reqQty ?? row.jr_qty) ?? 0;
            const reqQty = mouldItemQty;
            const requestedUseQty = parseCpNumber(row.useQty ?? row.planQty ?? row.plan_qty);
            const wipQty = parseCpNumber(row.wipQty ?? row.wip_qty) ?? 0;
            const selectedMouldCodeRaw = row.selectedMould || row.mould_no || mould?.mould_no || '';
            const selectedMouldCode = String(selectedMouldCodeRaw || '');
            const selectedMould = availableMoulds.find((m) => m.code === selectedMouldCode) || availableMoulds[0] || null;
            const machines = selectedMould ? (machineMap[selectedMould.code] || []) : [];
            const selectedMachine = machines[0]?.machine || '';
            const consumptionRatioQty = parseCpNumber(selectedMould?.consumptionRatioQty);
            const initialUseQty = requestedUseQty == null ? 0 : requestedUseQty;
            const useQty = Math.min(Math.max(initialUseQty, 0), remainingDefaultQty);
            const importedPlanQty = parseCpNumber(row.planQty ?? row.plan_qty);
            const autoPlanQty = consumptionRatioQty == null ? 0 : Number((useQty * consumptionRatioQty).toFixed(3));
            const requestedPlanQty = importedPlanQty == null ? autoPlanQty : importedPlanQty;
            const planQty = Math.min(Math.max(requestedPlanQty, 0), reqQty || requestedPlanQty);
            remainingDefaultQty = Math.max(remainingDefaultQty - useQty, 0);
            const consumeFromWip = parseCpNumber(row.consumeFromWip ?? row.consume_from_wip) ?? Math.min(planQty, wipQty);
            return {
              index: index + 1,
              itemCode: row.itemCode || row.item_code || '-',
              itemName: row.itemName || colourParts.itemName || row.product_name || row.mould_item_name || '-',
              itemColour: row.itemColour || row.item_colour || colourParts.itemColour || null,
              rawItemName: row.rawMouldItemName || row.rawItemName || row.mould_item_name || row.product_name || null,
              mouldItemQty,
              consumptionRatioQty,
              reqQty,
              useQty,
              reqBalQty: Math.max(reqQty - planQty, 0),
              wipQty,
              consumeFromWip,
              wipBalQty: parseCpNumber(row.wipBalQty ?? row.wip_bal_qty) ?? Math.max(wipQty - consumeFromWip, 0),
              planQty,
              mouldSelection: row.selectedMould || row.mould_no || mould?.mould_no || '-',
              availableMoulds,
              selectedMouldCode: selectedMould ? selectedMould.code : selectedMouldCode,
              selectedMachine,
              availableMachines: machines
            };
          });
        }

        // Distributes a single total Plan Qty across the colour rows proportional to each
        // row's Mould Item Qty (reqQty). Uses largest-remainder rounding so the parts sum
        // exactly to the (capped) total, and never lets a row exceed its own Mould Item Qty.
        function cpAutoSplitPlanQty(totalValue) {
          const modal = document.getElementById('cpColourPlanModal');
          if (!modal) return;
          const rows = Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : [];
          if (!rows.length) return;
          const planInputs = rows.map((_, i) => modal.querySelector(`.cp-colour-plan-input[data-row-index="${i}"]`));

          // Per-row cap = that colour's Mould Item Qty
          const caps = rows.map((r) => Math.max(0, parseCpNumber(r.mouldItemQty ?? r.reqQty) ?? 0));
          const capSum = caps.reduce((a, b) => a + b, 0);

          // Total can never exceed the sum of Mould Item Qty, nor the family/colour balance limit
          const limit = parseCpNumber(modal.dataset.planQtyLimit);
          let target = Math.max(0, Math.floor(parseCpNumber(totalValue) ?? 0));
          const hardMax = capSum > 0 ? capSum : target;
          target = Math.min(target, hardMax);
          if (limit != null && limit >= 0) target = Math.min(target, Math.floor(limit));

          const shares = rows.map(() => 0);
          if (capSum <= 0) {
            // No Mould Item Qty weights — split equally
            const n = rows.length;
            const base = Math.floor(target / n);
            let rem = target - base * n;
            rows.forEach((_, i) => { shares[i] = base + (i < rem ? 1 : 0); });
          } else {
            // Proportional split by Mould Item Qty, floor first
            const raw = caps.map((c) => target * (c / capSum));
            raw.forEach((s, i) => { shares[i] = Math.min(Math.floor(s), caps[i]); });
            let leftover = target - shares.reduce((a, b) => a + b, 0);
            // Hand out the remaining units to the largest fractional remainders (respecting caps)
            const order = raw
              .map((s, i) => ({ i, frac: s - Math.floor(s) }))
              .sort((a, b) => b.frac - a.frac);
            let guard = 0;
            while (leftover > 0 && guard < order.length * 4) {
              const idx = order[guard % order.length].i;
              if (shares[idx] < caps[idx]) { shares[idx] += 1; leftover -= 1; }
              guard++;
            }
          }

          rows.forEach((_, i) => {
            if (planInputs[i]) planInputs[i].value = shares[i] > 0 ? String(shares[i]) : '';
          });
          recalcCpColourPlanModal();
        }

        function recalcCpColourPlanModal() {
          const modal = document.getElementById('cpColourPlanModal');
          if (!modal) return;
          const rows = Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : [];
          const mouldBalanceLimit = parseCpNumber(modal.dataset.planQtyLimit);
          const planQtyLimit = mouldBalanceLimit;
          const targetBatchQty = getCpActiveBatchQty();
          const queuedBatchQtyByMould = getCpQueuedBatchQtyByMould();
          const currentBatchQtyByMould = new Map();
          const totals = {
            reqQty: 0,
            useQty: 0,
            reqBalQty: 0,
            wipQty: 0,
            consumeFromWip: 0,
            wipBalQty: 0,
            planQty: 0
          };
          let cappedByReqQty = false;
          let cappedByBatchQty = false;
          let cappedByPlanQty = false;

          rows.forEach((row, index) => {
            const input = modal.querySelector(`.cp-colour-use-input[data-row-index="${index}"]`);
            const planInput = modal.querySelector(`.cp-colour-plan-input[data-row-index="${index}"]`);
            const requestedUseQty = Math.max(0, parseCpNumber(input?.value) ?? 0);
            const rowReqQty = Math.max(0, parseCpNumber(row.mouldItemQty ?? row.reqQty) ?? 0);
            const ratio = parseCpNumber(row.consumptionRatioQty);
            const maxBatchQty = ratio && ratio > 0 ? (rowReqQty / ratio) : rowReqQty;
            const cappedToReq = Math.min(requestedUseQty, maxBatchQty || requestedUseQty);
            const mouldKey = normalizeCpMouldKey(row.selectedMouldCode || row.mouldSelection || cpSelectedMould?.mould_no || cpSelectedMould?.item_code || cpSelectedMould?.mould_name);
            const queuedForMould = queuedBatchQtyByMould.get(mouldKey) || 0;
            const currentForMould = currentBatchQtyByMould.get(mouldKey) || 0;
            const remainingForMould = targetBatchQty > 0 ? Math.max(targetBatchQty - queuedForMould - currentForMould, 0) : 0;
            const cappedToBatch = targetBatchQty > 0 ? Math.min(cappedToReq, remainingForMould) : 0;
            const useQty = cappedToBatch;
            if (cappedToReq < requestedUseQty) cappedByReqQty = true;
            if (cappedToBatch < cappedToReq) cappedByBatchQty = true;
            if (mouldKey) currentBatchQtyByMould.set(mouldKey, currentForMould + useQty);
            if (input && String(parseCpNumber(input.value) ?? '') !== String(useQty)) {
              input.value = String(useQty);
            }
            const requestedPlanQty = Math.max(0, parseCpNumber(planInput?.value) ?? 0);
            const rowPlanLimit = rowReqQty > 0 ? rowReqQty : requestedPlanQty;
            const planQty = Math.min(requestedPlanQty, rowPlanLimit);
            if (planQty < requestedPlanQty) cappedByPlanQty = true;
            if (planInput && String(parseCpNumber(planInput.value) ?? '') !== String(planQty)) {
              planInput.value = String(planQty);
            }
            row.useQty = useQty;
            row.planQty = planQty;
            row.reqBalQty = Math.max((row.reqQty || 0) - row.planQty, 0);
            row.consumeFromWip = Math.min(row.planQty, Math.max(0, parseCpNumber(row.wipQty) ?? 0));
            row.wipBalQty = Math.max((row.wipQty || 0) - row.consumeFromWip, 0);

            ['consumptionRatioQty', 'reqBalQty', 'consumeFromWip', 'wipBalQty'].forEach((key) => {
              const cell = modal.querySelector(`[data-colour-cell="${key}-${index}"]`);
              if (cell) cell.textContent = row[key] == null ? 'Fill in Mould Master' : formatCpQty(row[key]);
            });

            Object.keys(totals).forEach((key) => {
              totals[key] += Number(row[key] || 0);
            });
          });

          Object.keys(totals).forEach((key) => {
            const cell = modal.querySelector(`[data-colour-total="${key}"]`);
            if (cell) cell.textContent = formatCpQty(totals[key]);
          });

          // Keep the master "Total Plan Qty" field in sync with the live row total,
          // but don't fight the user while they are actively typing into it.
          const totalPlanInput = modal.querySelector('#cpColourTotalPlanInput');
          if (totalPlanInput && document.activeElement !== totalPlanInput) {
            totalPlanInput.value = totals.planQty > 0 ? String(totals.planQty) : '';
          }

          const exceedsOrderQty = planQtyLimit != null && totals.planQty > planQtyLimit;
          const rowsWithPlan = rows.filter((row) => Number(row.planQty || 0) > 0);
          const missingMachine = rowsWithPlan.length > 0 && !cpSelectedMachine;
          const missingBatchQty = targetBatchQty <= 0;
          const canSavePlan = rowsWithPlan.length > 0 && !missingBatchQty && !missingMachine && !exceedsOrderQty;
          const currentPayloads = canSavePlan ? buildCpColourPlanPayloads() : [];
          const batchStatus = getCpBatchCompleteness(currentPayloads);
          const canSaveThisPlan = canSavePlan && !batchStatus.exceedsBatchQty;
          const queueBtn = modal.querySelector('[data-cp-colour-submit="queue"]');
          const createBtn = modal.querySelector('[data-cp-colour-submit="create"]');
          if (queueBtn) queueBtn.disabled = !canSaveThisPlan;
          if (createBtn) createBtn.disabled = !canSavePlan || !batchStatus.complete;

          const footer = modal.querySelector('#cpColourFooter');
          if (footer) {
            if (missingBatchQty) {
              footer.textContent = 'Enter Job Qty on the selected OR first.';
            } else if (exceedsOrderQty) {
              const overBy = totals.planQty - planQtyLimit;
              footer.textContent = `Total Plan Qty exceeds Mould Item Balance Qty by ${formatCpQty(overBy)} (Limit ${formatCpQty(planQtyLimit || 0)}).`;
            } else if (cappedByPlanQty) {
              footer.textContent = 'Plan Qty cannot be more than Mould Item Qty for a colour row.';
            } else if (cappedByReqQty) {
              footer.textContent = 'Job Qty cannot be more than Mould Item Qty for a colour row.';
            } else if (cappedByBatchQty) {
              footer.textContent = `One selected mould reached the per-mould Job Qty limit of ${formatCpQty(targetBatchQty)}.`;
            } else if (missingMachine) {
              footer.textContent = `Select a machine above to continue | Per mould Job Qty limit: ${formatCpQty(targetBatchQty)}`;
            } else if (!batchStatus.complete) {
              footer.textContent = `${getCpBatchBlockMessage(currentPayloads)} Use Save Plan, then plan another variant only when balance remains.`;
            } else {
              footer.textContent = `Job Plan is complete. Create Plan will save the selected mould variant(s) with one unique job code. Per mould Job Qty limit: ${formatCpQty(targetBatchQty)} | Plan Qty: ${formatCpQty(totals.planQty)}`;
            }
          }

          if (cpSelectedMould) {
            cpSelectedMould.plan_qty = totals.planQty;
            cpSelectedMould.colourPlanRows = rows.map((row) => ({ ...row }));
          }
        }

        // Renders machine selection cards above the colour table.
        // PRIMARY cards first, then SECONDARY, then COMPATIBLE — clicking one selects
        // that machine for ALL colour rows and sets the global cpSelectedMachine.
        function renderCpColourMachineCards(modal, colourRows) {
          const cardsContainer = modal.querySelector('#cpColourMachineCards');
          if (!cardsContainer) return;

          // Union of all unique machines across every colour row's availableMachines list
          const allMachines = [];
          const seen = new Set();
          (Array.isArray(colourRows) ? colourRows : []).forEach((row) => {
            (Array.isArray(row.availableMachines) ? row.availableMachines : []).forEach((m) => {
              if (m && m.machine && !seen.has(m.machine)) {
                seen.add(m.machine);
                allMachines.push(m);
              }
            });
          });

          // Sort: PRIMARY → SECONDARY → COMPATIBLE, then alpha
          const roleOrder = { PRIMARY: 0, SECONDARY: 1, COMPATIBLE: 2 };
          allMachines.sort((a, b) => {
            const ra = roleOrder[a.preferenceRole] ?? 2;
            const rb = roleOrder[b.preferenceRole] ?? 2;
            if (ra !== rb) return ra - rb;
            return String(a.machine || '').localeCompare(String(b.machine || ''));
          });

          cardsContainer.innerHTML = '';

          if (!allMachines.length) {
            // If the mould's mapped machine name does not match Machine Master (after
            // normalization), the backend flags machineNameMismatch. In that case the name
            // is wrong — show a name-mismatch error instead of the generic "not mapped" one.
            const mismatchMap = window.cpVariantMismatchMap || {};
            let mismatchInfo = null;
            (Array.isArray(colourRows) ? colourRows : []).forEach((row) => {
              const info = mismatchMap[row.selectedMouldCode];
              if (info && info.mismatch && !mismatchInfo) mismatchInfo = info;
            });
            if (mismatchInfo) {
              const namePart = mismatchInfo.requestedNames ? ` (mapped: ${esc(mismatchInfo.requestedNames)})` : '';
              cardsContainer.innerHTML = `<div style="color:#be123c; font-weight:700; font-size:0.82rem; background:#fff1f2; border:1px solid #fecdd3; border-radius:10px; padding:10px 14px">Machines are not matching with Machine Master${namePart}. Correct the machine name in Mould Master.</div>`;
            } else {
              cardsContainer.innerHTML = '<div style="color:#be123c; font-weight:700; font-size:0.82rem; background:#fff1f2; border:1px solid #fecdd3; border-radius:10px; padding:10px 14px">No machines found for this mould. Map a Primary Machine in Mould Master first.</div>';
            }
            return;
          }

          allMachines.forEach((mac) => {
            const isPrimary  = mac.preferenceRole === 'PRIMARY';
            const isSecondary = mac.preferenceRole === 'SECONDARY';
            const isFree = !!mac.isFree;

            // Role styling
            const roleBg     = isPrimary ? '#eff6ff' : isSecondary ? '#fff7ed' : '#f8fafc';
            const roleBorder  = isPrimary ? '#bfdbfe' : isSecondary ? '#fed7aa' : '#e2e8f0';
            const roleColor  = isPrimary ? '#1d4ed8' : isSecondary ? '#c2410c' : '#475569';
            const roleLabel  = isPrimary ? 'PRIMARY'  : isSecondary ? 'SECONDARY' : 'MACHINE';

            // Availability
            const statusDot  = isFree ? '🟢' : '🔴';
            const statusText = isFree ? 'AVAILABLE' : (mac.currentStatus || 'BUSY');
            const statusColor = isFree ? '#15803d' : '#dc2626';
            const freeFromText = !isFree && mac.bookedUntil
              ? `Free: ${formatCpMachineAvailability(mac.bookedUntil)}`
              : null;

            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.machineName = mac.machine || '';
            card.dataset.roleBorder = roleBorder;
            card.style.cssText = [
              'text-align:left',
              `border:2px solid ${roleBorder}`,
              'border-radius:10px',
              'background:#fff',
              'padding:7px 9px',
              'cursor:pointer',
              'min-width:128px',
              'max-width:180px',
              'transition:border-color 0.12s, background 0.12s, box-shadow 0.12s',
              'display:flex',
              'flex-direction:column',
              'gap:0'
            ].join(';');

            // Compact meta line: building · line · tonnage
            const metaParts = [];
            if (mac.building) metaParts.push(esc(mac.building));
            if (mac.line) metaParts.push(`L${esc(String(mac.line))}`);
            if (mac.tonnage) metaParts.push(`${esc(String(mac.tonnage))}T`);
            const metaLine = metaParts.join(' · ');

            // Truncate running order list to keep card narrow
            const runningOrders = (mac.currentOrder || '').split(',').map(s => s.trim()).filter(Boolean);
            const runningDisplay = runningOrders.length > 1
              ? `${runningOrders[0]} +${runningOrders.length - 1}`
              : runningOrders[0] || '';

            card.innerHTML = `
              <div style="display:flex; justify-content:space-between; align-items:center; gap:4px; margin-bottom:4px">
                <span style="font-weight:900; color:#0f172a; font-size:0.72rem; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(mac.machine || '-')}</span>
                <span style="background:${roleBg}; color:${roleColor}; border:1px solid ${roleBorder}; border-radius:999px; padding:1px 5px; font-size:0.56rem; font-weight:900; white-space:nowrap; flex-shrink:0">${roleLabel}</span>
              </div>
              ${metaLine ? `<div style="color:#64748b; font-size:0.63rem; margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${metaLine}</div>` : ''}
              <div style="display:flex; align-items:center; gap:3px; margin-top:auto; padding-top:4px; border-top:1px solid #f1f5f9; flex-wrap:wrap">
                <span style="font-size:0.6rem; line-height:1">${statusDot}</span>
                <span style="font-weight:900; color:${statusColor}; font-size:0.65rem">${esc(statusText)}</span>
                ${freeFromText ? `<span style="color:#64748b; font-size:0.6rem; white-space:nowrap">· ${esc(freeFromText)}</span>` : ''}
              </div>
              ${runningDisplay && !isFree ? `<div style="color:#94a3b8; font-size:0.6rem; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">↳ ${esc(runningDisplay)}</div>` : ''}
            `;

            card.addEventListener('click', () => {
              // Deselect all cards
              cardsContainer.querySelectorAll('button[data-machine-name]').forEach((btn) => {
                btn.style.borderColor = btn.dataset.roleBorder || '#e2e8f0';
                btn.style.background  = '#fff';
                btn.style.boxShadow   = 'none';
              });
              // Highlight this card
              card.style.borderColor = '#0284c7';
              card.style.background  = '#f0f9ff';
              card.style.boxShadow   = '0 0 0 3px #bae6fd';

              // Set global machine
              cpSelectedMachine = mac;

              // Propagate to every colour row so buildCpColourPlanPayloads works
              (Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : []).forEach((r) => {
                r.selectedMachine = mac.machine;
              });

              // Update chip label
              const chip = modal.querySelector('#cpColourMachineChip');
              if (chip) {
                chip.textContent = `✓ ${mac.machine}`;
                chip.style.display = 'inline-block';
              }

              recalcCpColourPlanModal();
            });

            cardsContainer.appendChild(card);
          });
        }

        window.onCpColourMouldChange = function(rowIndex, mouldCode) {
          const modal = document.getElementById('cpColourPlanModal');
          const rows = Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : [];
          const row = rows[rowIndex];
          if (!modal || !row) return;
          row.selectedMouldCode = mouldCode;
          const selectedMould = (row.availableMoulds || []).find((m) => m.code === mouldCode) || null;
          row.availableMachines = selectedMould ? (window.cpVariantMachineMap?.[selectedMould.code] || []) : [];
          row.mouldSelection = selectedMould?.code || mouldCode || '-';
          row.consumptionRatioQty = parseCpNumber(selectedMould?.consumptionRatioQty);
          // Mould changed — reset global machine selection and re-render cards
          cpSelectedMachine = null;
          rows.forEach((r) => { r.selectedMachine = ''; });
          const chip = modal.querySelector('#cpColourMachineChip');
          if (chip) { chip.style.display = 'none'; chip.textContent = ''; }
          renderCpColourMachineCards(modal, rows);
          recalcCpColourPlanModal();
        };

        window.onCpColourMachineChange = function(rowIndex, machineName) {
          const rows = Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : [];
          const row = rows[rowIndex];
          if (!row) return;
          row.selectedMachine = machineName || '';
          recalcCpColourPlanModal();
        };

        function renderCpColourPlanMachines(machines) {
          const modal = document.getElementById('cpColourPlanModal');
          const list = modal?.querySelector('#cpColourMachineList');
          if (!list) return;
          window.cpColourPlanMachines = Array.isArray(machines) ? machines : [];
          list.innerHTML = '';
          cpSelectedMachine = null;

          if (!window.cpColourPlanMachines.length) {
            list.innerHTML = '<div style="grid-column:1/-1; color:#be123c; background:#fff1f2; border:1px solid #fecdd3; border-radius:14px; padding:12px 14px; font-weight:700">No primary/secondary machine is available for this mould.</div>';
            return;
          }

          window.cpColourPlanMachines.forEach((mac, index) => {
            const isFree = !!mac.isFree;
            const statusColor = isFree ? '#15803d' : '#c2410c';
            const statusTxt = isFree ? 'AVAILABLE' : (mac.currentStatus || 'BUSY');
            const roleText = mac.preferenceRole === 'PRIMARY' ? 'Primary' : (mac.preferenceRole === 'SECONDARY' ? 'Secondary' : 'Machine');
            const roleColor = mac.preferenceRole === 'PRIMARY' ? '#1d4ed8' : '#c2410c';
            const el = document.createElement('button');
            el.type = 'button';
            el.dataset.machineIndex = String(index);
            el.style.cssText = 'text-align:left; border:1px solid #cbd5e1; border-radius:16px; background:#fff; padding:12px; cursor:pointer; box-shadow:0 10px 22px rgba(15,23,42,.05)';
            el.innerHTML = `
              <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start">
                <div style="font-weight:900; color:#0f172a; line-height:1.2">${esc(mac.machine || '-')}</div>
                <span style="border:1px solid #bfdbfe; background:#eff6ff; color:${roleColor}; border-radius:999px; padding:3px 8px; font-size:.72rem; font-weight:900">${esc(roleText)}</span>
              </div>
              <div style="margin-top:6px; color:#64748b; font-size:.8rem">${esc(mac.building || '-')} ${mac.line ? `- L${esc(mac.line)}` : ''}</div>
              <div style="margin-top:8px; color:${statusColor}; font-weight:900; font-size:.82rem">${esc(statusTxt)}</div>
              <div style="margin-top:4px; color:#64748b; font-size:.78rem">Available on: <strong>${esc(formatCpMachineAvailability(mac.bookedUntil))}</strong></div>
              ${mac.currentOrder ? `<div style="margin-top:4px; color:#94a3b8; font-size:.76rem">Running: ${esc(mac.currentOrder)}</div>` : ''}
            `;
            el.onclick = () => {
              cpSelectedMachine = mac;
              Array.from(list.children).forEach((child) => {
                child.style.borderColor = '#cbd5e1';
                child.style.background = '#fff';
              });
              el.style.borderColor = '#0284c7';
              el.style.background = '#eff6ff';
              modal.querySelectorAll('[data-cp-colour-submit]').forEach((btn) => {
                btn.disabled = false;
              });
            };
            list.appendChild(el);
          });
        }

        async function fetchCpMachinesForMould(mould) {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          // Labour Job: machine already confirmed via Labour Job party modal — return it directly
          // without calling the factory-machines API (which would return factory machines instead).
          if (window.cpLabourPlanType === 'Labour Job' && cpSelectedMachine && cpSelectedMachine.machine) {
            return {
              machines: [{
                machine: cpSelectedMachine.machine,
                tonnage: cpSelectedMachine.tonnage || '-',
                building: 'Labour Job',
                line: 'Machines',
                isFree: true,
                currentStatus: 'AVAILABLE',
                currentOrder: null,
                preferenceRole: 'PRIMARY',
                machine_process: 'Labour Job'
              }],
              mismatch: false,
              requestedNames: ''
            };
          }
          if (getPlanningProcessFilter() === 'Moulding') {
            const params = new URLSearchParams();
            params.set('process', getPlanningProcessFilter());
            if (mould.primary_machine) params.set('primaryMachine', mould.primary_machine);
            if (mould.secondary_machine) params.set('secondaryMachine', mould.secondary_machine);
            const res = await api.get(`/planning/machines/compatible?${params.toString()}`);
            return {
              machines: Array.isArray(res.data) ? res.data : [],
              mismatch: !!res.machineNameMismatch,
              requestedNames: res.requestedMachineNames || ''
            };
          }
          const res = await api.get(`/masters/machines?process=${encodeURIComponent(getPlanningProcessFilter())}`);
          return {
            machines: (res.data || []).map(machine => ({
              machine: machine.machine,
              tonnage: machine.tonnage || '-',
              building: machine.building || getPlanningProcessFilter(),
              line: machine.line || 'Machines',
              isFree: true,
              currentStatus: 'AVAILABLE',
              currentOrder: null
            })),
            mismatch: false,
            requestedNames: ''
          };
        }

        async function openCpColourPlanModal(mould) {
          closeCpColourPlanModal();
          const modalItemName = window.cpSelectedOrder?.productName || mould.product_name || mould.itemName || mould.item_name || '-';
          const modalMouldName = mould.mould_name || mould.mouldName || mould.mould_no || '-';
          const familySnapshot = getCpFamilySnapshotForMould(mould, true);
          const mouldForColourCalc = {
            ...mould,
            targetPlanQty: familySnapshot.targetQty,
            plannedQty: familySnapshot.adjustedPlannedQty,
            remainingQty: familySnapshot.remainingQty
          };
          const modal = document.createElement('div');
          modal.id = 'cpColourPlanModal';
          modal.className = 'modal show';
          modal.setAttribute('aria-hidden', 'false');
          modal.style.display = 'flex';
          modal.innerHTML = `
            <div class="modal-card" style="width:min(1320px, 98vw); height:95vh; max-height:95vh; display:flex; flex-direction:column; overflow:hidden">
              <div class="modal-head" style="flex-shrink:0; padding:14px 18px; gap:14px">
                <div>
                  <div style="font-size:.78rem; color:#0284c7; font-weight:900; letter-spacing:.12em; text-transform:uppercase">Colour Wise Mould Plan</div>
                  <div style="margin-top:4px; display:grid; gap:3px">
                    <div style="font-size:.86rem; color:#475569; font-weight:800">
                      Item Name :- <span style="color:#0f172a">${esc(modalItemName)}</span>
                    </div>
                    <div style="font-size:1.12rem; color:#0f172a; font-weight:900">
                      Mould Name :- ${esc(modalMouldName)}
                    </div>
                  </div>
                </div>
                <button class="btn icon ghost" type="button" onclick="closeCpColourPlanModal()"><i class="bi bi-x-lg"></i></button>
              </div>
              <div id="cpColourPlanPopupBody" style="padding:14px 18px; overflow-y:auto; min-height:0; flex:1 1 auto; background:linear-gradient(180deg,#f8fbff,#ffffff); display:flex; flex-direction:column; gap:10px">
                <div class="muted">Loading OR/JR Wise Detail and machine availability...</div>
              </div>
              <div class="modal-actions" style="flex-shrink:0; padding:12px 18px; background:#fff; border-top:1px solid #e2e8f0">
                <div id="cpColourFooter" style="margin-right:auto; color:#64748b; font-size:.9rem">Select machine to continue</div>
                <button class="btn ghost" type="button" onclick="closeCpColourPlanModal()">Cancel</button>
                <button class="btn" type="button" data-cp-colour-submit="queue" disabled>Save Plan</button>
              </div>
            </div>
          `;
          document.body.appendChild(modal);

          const body = modal.querySelector('#cpColourPlanPopupBody');
          try {
            const selectedMouldKey = normalizeCpMouldKey(getCpMouldDisplayCode(mould));
            const queuedMouldKeys = new Set(getCpMergedQueueAndExtraPayloads().map((item) => normalizeCpMouldKey(item.mouldCode || item.itemCode || item.mouldName)).filter(Boolean));
            const availableFamilyRows = familySnapshot.rows.filter((row) => {
              if (row.isDropped || row.isFullyPlanned || row.isAlreadyPlanned) return false;
              const key = normalizeCpMouldKey(getCpMouldDisplayCode(row));
              return key && (key === selectedMouldKey || (!queuedMouldKeys.has(key) && !row.hasAnyPlan));
            });
            const modalFamilyRows = familySnapshot.rows.length > 1 && familySnapshot.remainingQty > 0 && availableFamilyRows.length
              ? availableFamilyRows
              : familySnapshot.rows;
            const familyMoulds = modalFamilyRows.map((row) => ({
              code: row.mould_no || row.item_code || '',
              name: row.mould_name || row.mouldName || row.product_name || row.mould_no || '-',
              mouldingSqn: row.mouldingSqn || row.moulding_sqn || null,
              primary_machine: row.primary_machine || row.primaryMachine || null,
              secondary_machine: row.secondary_machine || row.secondaryMachine || null,
              item_code: row.item_code || row.mould_no || null,
              consumptionRatioQty: parseCpNumber(row.consumptionRatioQty ?? row.consumption_ratio_qty)
            })).filter((row) => row.code);
            // Fetch colour plan data AND machine availability in parallel (not sequential)
            const [colourPayload, machineEntries] = await Promise.all([
              fetchCpColourPlanData(mould),
              Promise.all(familyMoulds.map(async (variant) => {
                const variantResult = await fetchCpMachinesForMould(variant);
                return [variant.code, variantResult];
              }))
            ]);
            window.cpVariantMachineMap = Object.fromEntries(
              machineEntries.map(([code, r]) => [code, Array.isArray(r.machines) ? r.machines : []])
            );
            window.cpVariantMismatchMap = Object.fromEntries(
              machineEntries.map(([code, r]) => [code, { mismatch: !!r.mismatch, requestedNames: r.requestedNames || '' }])
            );
            const colourRows = buildCpColourRows(mouldForColourCalc, colourPayload.rows, {
              availableMoulds: familyMoulds,
              machineMap: window.cpVariantMachineMap
            });
            window.cpColourPlanRows = colourRows;
            const colourMouldItemQty = colourRows.reduce((sum, row) => sum + Math.max(0, parseCpNumber(row.mouldItemQty ?? row.reqQty) ?? 0), 0);
            const alreadyPlannedQty = Math.max(0, parseCpNumber(familySnapshot.adjustedPlannedQty) ?? 0);
            const colourBalanceQty = colourMouldItemQty > 0 ? Math.max(colourMouldItemQty - alreadyPlannedQty, 0) : 0;
            const familyBalanceQty = Math.max(0, parseCpNumber(familySnapshot.remainingQty) ?? 0);
            const positiveLimits = [familyBalanceQty, colourBalanceQty].filter((qty) => qty > 0);
            const mouldBalanceQty = positiveLimits.length ? Math.min(...positiveLimits) : 0;
            modal.dataset.planQtyLimit = String(mouldBalanceQty ?? '');
            const wipDate = colourPayload?.meta?.wipStockDate ? formatCpDate(colourPayload.meta.wipStockDate) : '-';
            const activeBatchQty = getCpActiveBatchQty();
            const modalMouldKey = normalizeCpMouldKey(mould.mould_no || mould.item_code || mould.mould_name || mould.mouldName);
            const savedBatchQty = getCpQueuedBatchQtyByMould().get(modalMouldKey) || 0;

            body.innerHTML = `
              <!-- KPI strip — compact single row -->
              <div style="display:grid; grid-template-columns:repeat(4, minmax(140px, 1fr)); gap:8px; flex-shrink:0">
                <div style="border:1px solid #bfdbfe; border-radius:12px; padding:8px 12px; background:#eff6ff; display:flex; align-items:center; gap:10px">
                  <div><div class="mini muted">OR Number</div><div style="font-weight:900; color:#0f172a; font-size:0.85rem">${esc(window.cpSelectedOrder?.orderNo || '-')}</div></div>
                </div>
                <div style="border:1px solid #cbd5e1; border-radius:12px; padding:8px 12px; background:#fff; display:flex; align-items:center; gap:10px">
                  <div><div class="mini muted">Client Name</div><div style="font-weight:900; color:#0f172a; font-size:0.85rem">${esc(window.cpSelectedOrder?.partyName || window.cpSelectedOrder?.clientName || '-')}</div></div>
                </div>
                <div style="border:1px solid #fed7aa; border-radius:12px; padding:8px 12px; background:#fff7ed; display:flex; align-items:center; gap:10px">
                  <div><div class="mini muted">OR Qty</div><div style="font-weight:900; color:#c2410c; font-size:0.85rem">${esc(formatCpQty(window.cpSelectedOrder?.orQty || window.cpSelectedOrder?.qty || 0))}</div></div>
                </div>
                <div style="border:1px solid #bbf7d0; border-radius:12px; padding:8px 12px; background:#f0fdf4; display:flex; align-items:center; gap:10px">
                  <div><div class="mini muted">Job Qty / Remaining</div><div style="font-weight:900; color:#166534; font-size:0.85rem">${esc(formatCpQty(activeBatchQty))} / ${esc(formatCpQty(Math.max(activeBatchQty - savedBatchQty, 0)))}</div></div>
                </div>
              </div>

              <!-- Mould info — single compact row -->
              <div style="border:1px solid #dbeafe; border-radius:14px; padding:10px 14px; background:#fff; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap">
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px; min-width:0">
                  <div style="min-width:0">
                    <span style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase">Item</span>
                    <span style="font-weight:900; color:#0f172a; margin-left:6px; font-size:0.9rem">${esc(modalItemName)}</span>
                  </div>
                  <div style="min-width:0">
                    <span style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase">Mould</span>
                    <span style="font-weight:900; color:#0f172a; margin-left:6px; font-size:0.9rem">${esc(modalMouldName)}</span>
                  </div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap">
                    <span class="tag" style="font-family:monospace; font-size:0.72rem">${esc(mould.mould_no || mould.item_code || '-')}</span>
                    <span class="tag" style="font-size:0.72rem">Sqn. ${esc(mould.mouldingSqn || mould.moulding_sqn || '-')}</span>
                    <span class="tag" style="font-size:0.72rem">Target ${esc(formatCpQty(familySnapshot.targetQty || 0))}</span>
                    <span class="tag" style="font-size:0.72rem">Planned ${esc(formatCpQty(familySnapshot.adjustedPlannedQty || 0))}</span>
                    <span class="tag" style="font-size:0.72rem">Balance ${esc(formatCpQty(familySnapshot.remainingQty || 0))}</span>
                    <span class="tag" style="font-size:0.72rem">Cycle ${esc(mould.masterCycleTime || mould.cycle_time || '-')}</span>
                    <span class="tag" style="font-size:0.72rem">Weight ${esc(mould.masterStdWeight || mould.std_wt_kg || '-')}</span>
                    <span class="tag" style="font-size:0.72rem">Cavity ${esc(mould.masterCavity || mould.no_of_cavity || '-')}</span>
                  </div>
                </div>
                <div style="text-align:right; flex-shrink:0">
                  <div class="mini muted">WIP Snapshot</div>
                  <div style="font-weight:900; color:#0f766e; font-size:0.85rem">${esc(wipDate)}</div>
                </div>
              </div>

              <!-- Machine Selection Cards — PRIMARY first, then SECONDARY -->
              <div style="border:1px solid #e2e8f0; border-radius:12px; background:#fff; flex-shrink:0; padding:8px 10px">
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:7px; flex-wrap:wrap">
                  <span style="font-weight:900; color:#0f172a; font-size:0.82rem">&#9881; Select Machine</span>
                  <span style="color:#94a3b8; font-size:0.7rem">Click a card to assign machine to this plan</span>
                  <span id="cpColourMachineChip" style="display:none; background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; border-radius:999px; padding:2px 8px; font-size:0.7rem; font-weight:900"></span>
                </div>
                <div id="cpColourMachineCards" style="display:flex; flex-wrap:wrap; gap:6px; align-items:stretch"></div>
              </div>

              <!-- Colour table — flex-grow to fill ALL remaining space, no max-height cap -->
              <div style="border:1px solid #cbd5e1; border-radius:14px; overflow:hidden; background:#fff; flex:1 1 auto; display:flex; flex-direction:column; min-height:0">
                <div style="padding:9px 14px; background:#f8fafc; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-shrink:0; flex-wrap:wrap">
                  <strong style="color:#0f172a">OR/JR Wise Detail Colours</strong>
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                    <span style="font-size:0.78rem; color:#0f172a; font-weight:800">Total Plan Qty</span>
                    <input id="cpColourTotalPlanInput" type="number" min="0" step="1" max="${esc(mouldBalanceQty || '')}" placeholder="Enter qty" style="width:150px; border:2px solid #0ea5e9; border-radius:8px; padding:6px 10px; text-align:right; font-weight:900; color:#0f172a; font-size:0.92rem">
                    <span style="font-size:0.72rem; color:#0369a1; font-weight:700; background:#e0f2fe; border:1px solid #bae6fd; border-radius:999px; padding:2px 8px">Max ${esc(formatCpQty(mouldBalanceQty || 0))}</span>
                    <span style="font-size:0.7rem; color:#94a3b8">auto-splits across colours by Mould Item Qty</span>
                    <span class="tag">${esc(colourRows.length)} Rows</span>
                  </div>
                </div>
                <div style="overflow:auto; flex:1 1 auto; min-height:0; border-top:1px solid #e2e8f0">
                  <table style="width:100%; min-width:980px; border-collapse:collapse">
                    <thead>
                      <tr style="background:#f8fafc">
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:left; font-size:0.75rem">Item Code</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:left; font-size:0.75rem">Item Name / Colour</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">Cons. Ratio</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">Mould Item Qty</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">Job Qty</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">Req. Bal</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">WIP Qty</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">Consume WIP</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">WIP Bal</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-size:0.75rem">Plan Qty</th>
                        <th style="position:sticky; top:0; z-index:2; background:#f8fafc; padding:7px 8px; border-bottom:1px solid #e2e8f0; text-align:left; font-size:0.75rem">Mould</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${colourRows.length ? colourRows.map((row, index) => `
                        <tr>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; font-family:monospace; font-weight:800; font-size:0.78rem">${esc(row.itemCode)}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; min-width:220px">
                            <div style="font-weight:800; color:#0f172a; font-size:0.82rem">${esc(row.itemName)}</div>
                            ${row.itemColour ? `<div style="font-size:0.76rem; color:#4338ca; font-weight:700">Colour: ${esc(row.itemColour)}</div>` : ''}
                          </td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:900; font-size:0.82rem; color:${row.consumptionRatioQty == null ? '#be123c' : '#0f172a'}" data-colour-cell="consumptionRatioQty-${index}">${row.consumptionRatioQty == null ? 'Fill in Master' : esc(formatCpQty(row.consumptionRatioQty))}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:800; font-size:0.82rem">${esc(formatCpQty(row.reqQty))}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right">
                            <input class="cp-colour-use-input" data-row-index="${index}" type="number" min="0" step="1" value="${esc(row.useQty)}" style="width:90px; border:1px solid #bfdbfe; border-radius:8px; padding:5px 8px; text-align:right; font-weight:900; color:#0f172a; font-size:0.85rem">
                          </td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-size:0.82rem" data-colour-cell="reqBalQty-${index}">${esc(formatCpQty(row.reqBalQty))}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:800; font-size:0.82rem">${esc(formatCpQty(row.wipQty))}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right; font-size:0.82rem" data-colour-cell="consumeFromWip-${index}">${esc(formatCpQty(row.consumeFromWip))}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right; color:#0f766e; font-weight:800; font-size:0.82rem" data-colour-cell="wipBalQty-${index}">${esc(formatCpQty(row.wipBalQty))}</td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9; text-align:right">
                            <input class="cp-colour-plan-input" data-row-index="${index}" type="number" min="0" step="1" max="${esc(row.reqQty || '')}" value="${esc(row.planQty || '')}" style="width:110px; border:1px solid #93c5fd; border-radius:8px; padding:5px 8px; text-align:right; font-weight:900; color:#0f172a; font-size:0.85rem">
                          </td>
                          <td style="padding:6px 8px; border-bottom:1px solid #f1f5f9">
                            <select class="cp-colour-mould-select" data-row-index="${index}" onchange="window.onCpColourMouldChange(${index}, this.value)" style="width:200px; border:1px solid #bfdbfe; border-radius:8px; padding:5px 8px; font-weight:800; font-size:0.82rem">
                              ${(row.availableMoulds || []).map((m) => `<option value="${esc(m.code)}" ${m.code === row.selectedMouldCode ? 'selected' : ''}>${esc(`${m.code}${m.mouldingSqn ? ` (Sqn ${m.mouldingSqn})` : ''}`)}</option>`).join('')}
                            </select>
                          </td>
                        </tr>
                      `).join('') : `<tr><td colspan="11" style="padding:18px; text-align:center; color:#64748b">No OR/JR Wise Detail rows found for this mould.</td></tr>`}
                    </tbody>
                    <tfoot>
                      <tr style="background:#f8fafc">
                        <td colspan="2" style="padding:7px 8px; border-top:1px solid #e2e8f0; font-weight:900; font-size:0.82rem">Total</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="consumptionRatioQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="reqQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="useQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="reqBalQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="wipQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="consumeFromWip">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="wipBalQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0; text-align:right; font-weight:900; font-size:0.82rem" data-colour-total="planQty">-</td>
                        <td style="padding:7px 8px; border-top:1px solid #e2e8f0"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            `;

            modal.querySelectorAll('.cp-colour-use-input').forEach((input) => {
              input.addEventListener('input', recalcCpColourPlanModal);
            });
            modal.querySelectorAll('.cp-colour-plan-input').forEach((input) => {
              input.addEventListener('input', recalcCpColourPlanModal);
            });
            const totalPlanInput = modal.querySelector('#cpColourTotalPlanInput');
            if (totalPlanInput) {
              totalPlanInput.addEventListener('input', function() {
                cpAutoSplitPlanQty(this.value);
              });
            }
            renderCpColourMachineCards(modal, colourRows);
            // Labour Job: machine was already confirmed in the Labour Job party modal.
            // Replace the "Select Machine" section entirely with a "confirmed" banner
            // so the user is NOT asked to select a machine again.
            if (window.cpLabourPlanType === 'Labour Job' && cpSelectedMachine && cpSelectedMachine.machine) {
              const machineCardsEl = modal.querySelector('#cpColourMachineCards');
              const machineSectionEl = machineCardsEl ? machineCardsEl.parentElement : null;
              if (machineSectionEl) {
                machineSectionEl.style.background = '#fefce8';
                machineSectionEl.style.border = '1px solid #fde68a';
                machineSectionEl.style.borderRadius = '14px';
                machineSectionEl.style.padding = '12px 16px';
                machineSectionEl.innerHTML = `
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                    <span style="font-size:1.2rem">✅</span>
                    <span style="font-weight:900;color:#92400e;font-size:0.92rem">Labour Job Machine Confirmed</span>
                    <span style="background:#b45309;color:#fff;border-radius:999px;padding:3px 16px;font-weight:900;font-size:0.87rem">${esc(cpSelectedMachine.machine)}</span>
                    <span style="color:#78350f;font-size:0.78rem">Machine already selected from Labour Job party — no further selection needed.</span>
                  </div>
                `;
              }
              // Pre-assign machine to all colour rows so Save Plan is immediately enabled
              (Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : []).forEach((r) => {
                r.selectedMachine = cpSelectedMachine.machine;
              });
            }
            recalcCpColourPlanModal();

            // P7: Pre-populate plan qty from batch qty when modal opens
            // If activeBatchQty > 0, fill the total-plan input and auto-split across colour rows
            if (activeBatchQty > 0 && totalPlanInput) {
              const cappedBatch = mouldBalanceQty > 0 ? Math.min(activeBatchQty, mouldBalanceQty) : activeBatchQty;
              totalPlanInput.value = String(cappedBatch);
              cpAutoSplitPlanQty(cappedBatch);
            }

            modal.querySelector('[data-cp-colour-submit="queue"]').onclick = () => {
              if (!cpSelectedMachine) return toast('Select a machine first.', 'error');
              addToQueue();
              closeCpColourPlanModal();
            };
          } catch (e) {
            body.innerHTML = `<div style="border:1px solid #fecaca; background:#fff1f2; color:#be123c; border-radius:16px; padding:16px; font-weight:800">Failed to open colour-wise plan: ${esc(e.message)}</div>`;
          }
        }

        function formatCpMachineAvailability(value) {
          if (!value) return 'Not scheduled';
          const dt = new Date(value);
          if (Number.isNaN(dt.getTime())) return String(value);
          return dt.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          });
        }

        function renderCpMachineGuidance(machines, mould) {
          const box = document.getElementById('cpMachineGuidance');
          if (!box) return;
          if (!mould) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
          }
          const primary = (machines || []).find((m) => m.preferenceRole === 'PRIMARY');
          const firstVacantSecondary = (machines || []).find((m) => m.preferenceRole === 'SECONDARY' && m.isFree);
          const secondaryFallback = (machines || []).find((m) => m.preferenceRole === 'SECONDARY');

          if (primary && primary.isBookedFor15Days) {
            const recommended = firstVacantSecondary || secondaryFallback;
            box.style.display = 'block';
            box.innerHTML = `
              <div style="border:1px solid #fed7aa; background:#fff7ed; color:#9a3412; border-radius:16px; padding:12px 14px; font-weight:700">
                Primary machine <strong>${esc(primary.machine)}</strong> is booked for the next 15 days.
                <div style="margin-top:6px; font-weight:600">Available on: <strong>${esc(formatCpMachineAvailability(primary.bookedUntil))}</strong></div>
                ${recommended ? ` First secondary option: <strong>${esc(recommended.machine)}</strong>.` : ' No secondary machine is currently vacant.'}
              </div>
            `;
            return;
          }

          if (primary) {
            box.style.display = 'block';
            box.innerHTML = `
              <div style="border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; border-radius:16px; padding:12px 14px; font-weight:700">
                Primary machine recommended first: <strong>${esc(primary.machine)}</strong>.
                ${primary.bookedUntil ? `<div style="margin-top:6px; font-weight:600">Available on: <strong>${esc(formatCpMachineAvailability(primary.bookedUntil))}</strong></div>` : ''}
              </div>
            `;
            return;
          }

          if (secondaryFallback) {
            box.style.display = 'block';
            box.innerHTML = `
              <div style="border:1px solid #fed7aa; background:#fff7ed; color:#9a3412; border-radius:16px; padding:12px 14px; font-weight:700">
                Primary machine is not configured in Mould Master. Showing secondary machine list only.
              </div>
            `;
            return;
          }

          box.style.display = 'none';
          box.innerHTML = '';
        }

        function renderCpMoulds(moulds, sequenceMeta) {
          const con = document.getElementById('cpMouldList');
          if (!con) return;
          con.innerHTML = '';
          renderCpSequenceMeta(sequenceMeta);

          if (!moulds.length) {
            con.innerHTML = '<div class="cp-list-empty">No detailed mould lines were found for this order.</div>';
            return;
          }
          const groups = buildCpMouldGroups(moulds);
          groups.forEach((group) => {
            const blockReason = getCpGroupBlockReason(group, sequenceMeta);
            const hasMaster = group.rows.some((row) => !!row.mould_id);
            const representative = group.rows[0] || {};
            const row = document.createElement('div');
            row.style.border = `1px solid ${blockReason ? '#fecaca' : 'rgba(203, 213, 225, 0.95)'}`;
            row.style.borderRadius = '18px';
            row.style.padding = '16px';
            row.style.background = blockReason ? '#fffaf9' : 'linear-gradient(180deg, #ffffff, #f8fbff)';
            row.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.06)';
            row.innerHTML = `
              <div style="display:flex; justify-content:space-between; gap:14px; align-items:flex-start">
                <div style="min-width:0">
                  <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center">
                    <div style="font-weight:800; color:#0f172a; font-size:1.02rem">${esc(group.displayName)}</div>
                    <span class="tag" style="background:${hasMaster ? '#f0fdf4' : '#fff7ed'}; color:${hasMaster ? '#166534' : '#c2410c'}; border-color:${hasMaster ? '#bbf7d0' : '#fed7aa'}">${hasMaster ? 'Linked to Mould Master' : 'Master Link Missing'}</span>
                    <span class="tag">Variants ${esc(group.rows.length)}</span>
                    <span class="tag">Moulding Sqn. ${esc(group.minSqn ?? '-')}</span>
                  </div>
                  <div style="margin-top:8px; color:#475569; font-size:.88rem">
                    OR/JR summary found <strong>${esc(group.rows.length)}</strong> mould option(s) for this family. Selection happens inside popup.
                  </div>
                  <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px; background:rgba(241,245,249,0.5); border:1px solid #e2e8f0; padding:10px 12px; border-radius:12px">
                    <div style="font-size:0.75rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px">Mould Master Machine Compatibility</div>
                    ${group.rows.map((r, rIdx) => `
                      <div style="font-size:0.82rem; display:flex; gap:8px; flex-wrap:wrap; align-items:center">
                        <strong style="color:#0f172a; font-family:monospace">${esc(r.mould_no || r.item_code || `Option ${rIdx+1}`)}</strong>
                        <span class="tag small" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; font-size:0.72rem; padding:1px 8px; font-weight:700">Primary: ${esc(r.primary_machine || r.primaryMachine || '-')}</span>
                        <span class="tag small" style="background:#fff7ed; color:#c2410c; border-color:#fed7aa; font-size:0.72rem; padding:1px 8px; font-weight:700">Secondary: ${esc(r.secondary_machine || r.secondaryMachine || '-')}</span>
                      </div>
                    `).join('')}
                  </div>
                  <div style="margin-top:10px; display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; max-width:540px">
                    <div style="border:1px solid #e2e8f0; border-radius:14px; background:#fff; padding:10px 12px">
                      <div class="mini muted">Target Qty</div>
                      <div style="font-weight:800; color:#0f172a; margin-top:4px">${esc(formatCpQty(group.targetPlanQty || 0))}</div>
                    </div>
                    <div style="border:1px solid #dbeafe; border-radius:14px; background:#eff6ff; padding:10px 12px">
                      <div class="mini muted">Planned Qty</div>
                      <div style="font-weight:800; color:#1d4ed8; margin-top:4px">${esc(formatCpQty(group.adjustedPlannedQty || 0))}</div>
                    </div>
                    <div style="border:1px solid #fed7aa; border-radius:14px; background:#fff7ed; padding:10px 12px">
                      <div class="mini muted">Balance Qty</div>
                      <div style="font-weight:800; color:${group.adjustedRemainingQty > 0 ? '#c2410c' : '#166534'}; margin-top:4px">${esc(formatCpQty(group.adjustedRemainingQty || 0))}</div>
                    </div>
                  </div>
                  <div style="margin-top:8px; color:#64748b; font-size:.83rem">
                    Exact mould numbers and master details will open inside the selection popup.
                  </div>
                  ${blockReason ? `<div style="margin-top:10px; color:#be123c; font-weight:700; font-size:.88rem">${esc(blockReason)}</div>` : ''}
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end">
                  ${group.hasDropped
                    ? `<button class="btn mini secondary" type="button" data-cp-action="undrop" style="color:#059669; border-color:#a7f3d0; background:#f0fdf4">Undrop</button>`
                    : `<button class="btn mini secondary" type="button" data-cp-action="drop" ${group.hasPlanned ? 'disabled' : ''} style="color:#dc2626">Drop</button>`
                  }
                  <button class="btn mini secondary" type="button" data-cp-action="labour-job"
                    style="background:#fef3c7; color:#92400e; border-color:#fde68a; font-size:0.75rem"
                    ${blockReason ? 'disabled' : ''}>
                    <i class="bi bi-people-fill"></i> Labour Job
                  </button>
                  <button class="btn primary" type="button" data-cp-action="select" ${blockReason ? 'disabled' : ''}>${group.rows.length > 1 ? 'Open Selection' : 'Select Mould'}</button>
                </div>
              </div>
            `;

            const dropBtn = row.querySelector('[data-cp-action="drop"]');
            if (dropBtn) {
              dropBtn.onclick = (e) => {
                e.stopPropagation();
                const first = group.rows[0] || {};
                if (typeof window.dropCpMould === 'function') {
                  window.dropCpMould(first);
                }
              };
            }

            const undropBtn = row.querySelector('[data-cp-action="undrop"]');
            if (undropBtn) {
              undropBtn.onclick = (e) => {
                e.stopPropagation();
                const first = group.rows[0] || {};
                if (typeof window.undropCpMould === 'function') {
                  window.undropCpMould(first);
                }
              };
            }

            row.querySelector('[data-cp-action="select"]').onclick = (e) => {
              e.stopPropagation();
              if (blockReason) return toast(blockReason, 'error');
              if (group.rows.length > 1) {
                openCpMouldChooser(group);
                return;
              }
              selectCpMould(group.rows[0]);
            };

            const labourJobBtn = row.querySelector('[data-cp-action="labour-job"]');
            if (labourJobBtn) {
              labourJobBtn.onclick = (e) => {
                e.stopPropagation();
                if (blockReason) return toast(blockReason, 'error');
                openLabourJobMouldModal(group);
              };
            }

            con.appendChild(row);
          });
        }

        const cpDraftQueue = []; // Global Queue

        // ------- Draft persistence (survive page refresh) -------
        const CP_DRAFT_STORAGE_KEY = 'jpsms_cp_draft_v1';

        function saveCpDraft() {
          try {
            const orderNo = window.cpSelectedOrder?.orderNo || '';
            if (!orderNo) { localStorage.removeItem(CP_DRAFT_STORAGE_KEY); return; }
            localStorage.setItem(CP_DRAFT_STORAGE_KEY, JSON.stringify({
              orderNo,
              batchQty: window.cpCurrentBatchQty || null,
              queue: Array.isArray(cpDraftQueue) ? cpDraftQueue.slice() : []
            }));
          } catch (e) { /* ignore storage quota errors */ }
        }

        function loadCpDraftForOrder(orderNo) {
          try {
            const raw = localStorage.getItem(CP_DRAFT_STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return (data && data.orderNo === orderNo) ? data : null;
          } catch (e) { return null; }
        }

        function clearCpDraftStorage() {
          try { localStorage.removeItem(CP_DRAFT_STORAGE_KEY); } catch (e) { /* ignore */ }
        }
        // --------------------------------------------------------

        function normalizeCpMouldKey(value) {
          return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        }

        function getCpRequiredBatchMoulds(extraPayloads = []) {
          const orderRows = Array.isArray(window.cpOrderMoulds) ? window.cpOrderMoulds : [];
          // Keys of moulds already saved in the queue or represented by the current modal payload.
          const queuedKeys = new Set(
            getCpMergedQueueAndExtraPayloads(extraPayloads)
              .map((item) => normalizeCpMouldKey(item.mouldCode || item.itemCode || item.mouldName))
              .filter(Boolean)
          );
          const groups = new Map();
          orderRows.forEach((row) => {
            if (row.isDropped) return;
            const family = normalizeCpFamilyCode(getCpMouldFamilyValue(row));
            if (!family) return;
            if (!groups.has(family)) groups.set(family, []);
            groups.get(family).push(row);
          });

          const requiredByKey = new Map();
          const addRequired = (row, family) => {
            const code = getCpMouldDisplayCode(row);
            const key = normalizeCpMouldKey(code);
            if (!key || requiredByKey.has(key)) return;
            requiredByKey.set(key, {
              key,
              family,
              code: code || '-',
              name: row.mouldName || row.mould_name || code || '-'
            });
          };

          groups.forEach((rows, family) => {
            const activeRows = rows.filter((row) => !row.isDropped && !row.isFullyPlanned);
            if (!activeRows.length) return;

            const savedSnapshot = getCpFamilySnapshotByRows(rows, family, false);
            if (savedSnapshot.targetQty > 0 && savedSnapshot.remainingQty <= 0) return;

            const queuedRows = activeRows.filter((row) => queuedKeys.has(normalizeCpMouldKey(getCpMouldDisplayCode(row))));
            queuedRows.forEach((row) => addRequired(row, family));

            const draftSnapshot = getCpFamilySnapshotByRows(rows, family, true, extraPayloads);
            if (draftSnapshot.targetQty > 0 && draftSnapshot.remainingQty <= 0) return;

            const nextRow = activeRows.find((row) => !queuedKeys.has(normalizeCpMouldKey(getCpMouldDisplayCode(row)))) || activeRows[0];
            if (nextRow) addRequired(nextRow, family);
          });

          return Array.from(requiredByKey.values());
        }

        function getCpBatchCompleteness(extraPayloads = []) {
          const required = getCpRequiredBatchMoulds(extraPayloads);
          const payloads = getCpMergedQueueAndExtraPayloads(extraPayloads);
          const plannedKeys = new Set(payloads.map((item) => normalizeCpMouldKey(item.mouldCode || item.itemCode || item.mouldName)).filter(Boolean));
          const missing = required.filter((row) => !plannedKeys.has(row.key));
          const batchQtyValues = payloads
            .map((item) => parseCpNumber(item.batchQty))
            .filter((qty) => qty != null && qty > 0);
          const totalBatchQty = batchQtyValues.reduce((sum, qty) => sum + qty, 0);
          const targetBatchQty = getCpActiveBatchQty();
          const hasBatchQty = targetBatchQty > 0;
          const batchQtyByMould = getCpQueuedBatchQtyByMould(extraPayloads);
          const overLimitMoulds = Array.from(batchQtyByMould.entries())
            .filter(([, qty]) => hasBatchQty && qty - targetBatchQty > 0.0001)
            .map(([key, qty]) => {
              const mould = required.find((row) => row.key === key);
              return { key, code: mould?.code || key, qty };
            });
          const exceedsBatchQty = overLimitMoulds.length > 0;
          return {
            required,
            payloads,
            missing,
            firstBatchQty: targetBatchQty || null,
            totalBatchQty,
            batchQtyByMould,
            overLimitMoulds,
            targetBatchQty,
            hasMixedBatchQty: false,
            exceedsBatchQty,
            hasPendingBatchQty: false,
            complete: required.length > 0 && missing.length === 0 && hasBatchQty && !exceedsBatchQty && payloads.length > 0
          };
        }

        function getCpBatchBlockMessage(extraPayloads = []) {
          const status = getCpBatchCompleteness(extraPayloads);
          if (!status.targetBatchQty) return 'Enter Job Qty first.';
          if (!status.payloads.length) return 'Save at least one plan row first.';
          if (status.exceedsBatchQty) {
            const over = (status.overLimitMoulds || []).map((row) => `${row.code}: ${formatCpQty(row.qty)}`).join(', ');
            return `Job Qty per mould cannot exceed ${formatCpQty(status.targetBatchQty)}. Over limit: ${over || 'selected mould'}.`;
          }
          if (status.missing.length) {
            return `Save Plan for remaining mould variant(s) first. Pending moulds: ${status.missing.map((row) => row.code).join(', ')}.`;
          }
          return '';
        }

        function updateQueueUI() {
          const sec = document.getElementById('cpQueueSection');
          const list = document.getElementById('cpQueueList');
          const cnt = document.getElementById('cpQueueCount');
          const saveBtn = document.getElementById('cpSaveBtn');
          const addBtn = document.getElementById('cpAddBtn');

          cnt.innerText = cpDraftQueue.length;

          if (cpDraftQueue.length > 0) {
            sec.style.display = 'block';
            list.innerHTML = '';
            cpDraftQueue.forEach((item, idx) => {
              const row = document.createElement('div');
              row.style.background = '#fff';
              row.style.padding = '8px 12px';
              row.style.borderRadius = '6px';
              row.style.border = '1px solid #bae6fd';
              row.style.display = 'flex';
              row.style.justifyContent = 'space-between';
              row.style.alignItems = 'center';

              row.innerHTML = `
                    <div>
                       <div style="font-weight:700; color:#0c4a6e">${esc(item.mouldName)}</div>
                       <div style="font-size:0.8rem; color:#0284c7">on ${esc(item.machine)}</div>
                    </div>
                    <button type="button" data-cp-remove-queue="${idx}" style="border:0; background:none; color:#ef4444; cursor:pointer"><i class="bi bi-trash"></i></button>
                 `;
              list.appendChild(row);
            });
            list.querySelectorAll('[data-cp-remove-queue]').forEach((btn) => {
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                removeFromQueue(Number(btn.dataset.cpRemoveQueue));
              };
            });

            const batchStatus = getCpBatchCompleteness();
            if (batchStatus.missing.length || batchStatus.exceedsBatchQty) {
              const msg = getCpBatchBlockMessage();
              const warn = document.createElement('div');
              warn.style.cssText = 'margin-top:8px; border:1px solid #fed7aa; background:#fff7ed; color:#9a3412; border-radius:10px; padding:8px 10px; font-size:.82rem; font-weight:800';
              warn.textContent = msg;
              list.appendChild(warn);
            }
            saveBtn.innerHTML = `<i class="bi bi-check2-all"></i> Create ${cpDraftQueue.length} Saved Plan(s)`;
            saveBtn.disabled = !batchStatus.complete;
          } else {
            sec.style.display = 'none';
            saveBtn.innerHTML = '<i class="bi bi-check2-circle"></i> Create Plan';
            saveBtn.disabled = true;
          }
          renderCpBatchSetup(cpSelectedOrder);
          saveCpDraft();
        }

        function buildCpColourPlanPayloads() {
          const rows = Array.isArray(window.cpColourPlanRows) ? window.cpColourPlanRows : [];
          if (!cpSelectedOrder || !rows.length) return [];
          const byKey = new Map();
          rows.forEach((row) => {
            const qty = Math.max(0, parseCpNumber(row.planQty) ?? 0);
            if (qty <= 0) return;
            const mouldCode = row.selectedMouldCode || row.mouldSelection || cpSelectedMould?.mould_no || cpSelectedMould?.item_code;
            const machine = row.selectedMachine || '';
            const consumptionRatioQty = parseCpNumber(row.consumptionRatioQty);
            if (!mouldCode || !machine) return;
            const mouldVariant = (row.availableMoulds || []).find((m) => m.code === mouldCode) || null;
            const normalizedFamily = getCpPayloadFamilyCode({
              mouldCode,
              itemCode: mouldVariant?.item_code || cpSelectedMould?.item_code || mouldCode,
              mouldName: mouldVariant?.name || cpSelectedMould?.mould_name || cpSelectedMould?.mouldName || mouldCode
            });
            const key = `${mouldCode}__${machine}`;
            if (!byKey.has(key)) {
              byKey.set(key, {
                plant: (localStorage.getItem('jpsms_factory_id') == '2' ? 'SHIVANI' : 'DUNGRA'),
                machine,
                orderNo: cpSelectedOrder.orderNo,
                itemCode: mouldVariant?.item_code || cpSelectedMould?.item_code || mouldCode,
                itemName: cpSelectedOrder.productName,
                mouldName: mouldVariant?.name || cpSelectedMould?.mould_name || cpSelectedMould?.mouldName || mouldCode,
                mouldCode,
                normalizedFamily,
                mouldFamily: normalizedFamily,
                mouldingSqn: mouldVariant?.mouldingSqn || cpSelectedMould?.mouldingSqn || cpSelectedMould?.moulding_sqn || null,
                planQty: 0,
                balQty: 0,
                batchQty: 0,
                consumptionRatioQty,
                mouldItemQty: 0,
                colourDetails: [],
                planType: window.cpLabourPlanType || undefined,
                startDate: new Date().toISOString()
              });
            }
            const entry = byKey.get(key);
            const rowBatchQty = Math.max(0, parseCpNumber(row.useQty) ?? 0);
            entry.planQty += qty;
            entry.balQty = entry.planQty;
            entry.batchQty += rowBatchQty;
            entry.mouldItemQty += Math.max(0, parseCpNumber(row.mouldItemQty ?? row.reqQty) ?? 0);
            entry.consumptionRatioQty = consumptionRatioQty;
            entry.colourDetails.push({
              itemCode: row.itemCode || '',
              itemName: row.itemName || '',
              colourName: row.itemColour || row.rawItemName || row.itemName || '-',
              batchQty: rowBatchQty,
              planQty: qty,
              consumptionRatioQty
            });
          });
          return Array.from(byKey.values());
        }

        function addToQueue() {
          const colourPayloads = buildCpColourPlanPayloads();
          if (!cpSelectedOrder) return toast('Select Order', 'error');
          if (!colourPayloads.length && (!cpSelectedMould || !cpSelectedMachine)) return toast('Select Order, Mould and Machine', 'error');

          const payloads = colourPayloads.length ? colourPayloads : [{
            plant: (localStorage.getItem('jpsms_factory_id') == '2' ? 'SHIVANI' : 'DUNGRA'),
            machine: cpSelectedMachine.machine,
            orderNo: cpSelectedOrder.orderNo,
            itemCode: cpSelectedMould.item_code,
            itemName: cpSelectedOrder.productName,
            mouldName: cpSelectedMould.mould_name || cpSelectedMould.mouldName,
            mouldCode: cpSelectedMould.mould_no || cpSelectedMould.item_code,
            normalizedFamily: normalizeCpFamilyCode(getCpMouldFamilyValue(cpSelectedMould)),
            mouldFamily: normalizeCpFamilyCode(getCpMouldFamilyValue(cpSelectedMould)),
            mouldingSqn: cpSelectedMould.mouldingSqn || cpSelectedMould.moulding_sqn || null,
            planQty: cpSelectedMould.plan_qty,
            balQty: cpSelectedMould.plan_qty,
            batchQty: getCpActiveBatchQty(),
            startDate: new Date().toISOString()
          }];

          const batchStatus = getCpBatchCompleteness(payloads);
          if (!batchStatus.targetBatchQty || batchStatus.exceedsBatchQty) {
            return toast(getCpBatchBlockMessage(payloads), 'error');
          }

          let added = 0;
          payloads.forEach((payload) => {
            const exists = cpDraftQueue.find((x) => x.mouldCode === payload.mouldCode && x.orderNo === payload.orderNo && x.machine === payload.machine);
            if (exists) return;
            cpDraftQueue.push(payload);
            added += 1;
          });
          if (!added) return toast('Selected mould/machine entries already exist in queue.', 'warning');
          toast(`Added ${added} plan row(s) to Queue`, 'success');

          // Reset Selection (Mould/Machine) but keep Order
          cpSelectedMould = null;
          cpSelectedMachine = null;

          // Refresh UI
          document.getElementById('cpMachineSection').style.display = 'none';
          // Re-render Mould List to clear formatting
          selectCpOrder(cpSelectedOrder, true);

          updateQueueUI();
          renderCpBatchSetup(cpSelectedOrder);
        }

        function removeFromQueue(idx) {
          cpDraftQueue.splice(idx, 1);
          updateQueueUI();
        }
        window.removeFromQueue = removeFromQueue;

        function clearQueue() {
          if (!confirm('Clear all drafted plans?')) return;
          cpDraftQueue.length = 0;
          clearCpDraftStorage();
          updateQueueUI();
        }
        window.clearQueue = clearQueue;

        const cpClearQueueBtn = document.getElementById('cpClearQueueBtn');
        if (cpClearQueueBtn) cpClearQueueBtn.onclick = clearQueue;

        // Defined explicitly for reuse (Fix for Duplicate Status Reset)
        async function handleCreatePlanSubmit() {
          const cpSave = document.getElementById('cpSaveBtn');
          console.log('Create Plan Clicked!');
          console.log('State:', { cpSelectedOrder, cpSelectedMould, cpSelectedMachine });
          const colourPayloads = buildCpColourPlanPayloads();
          const hasColourPayloads = colourPayloads.length > 0;
          const hasQueuedPayloads = cpDraftQueue.length > 0;

          if (!cpSelectedOrder || (!hasQueuedPayloads && !hasColourPayloads && (!cpSelectedMould || !cpSelectedMachine))) {
            let missing = [];
            if (!cpSelectedOrder) missing.push("Order");
            if (!hasQueuedPayloads && !hasColourPayloads) {
              if (!cpSelectedMould) missing.push("Mould");
              if (!cpSelectedMachine) missing.push("Machine");
            }
            return toast('Please select: ' + missing.join(', '), 'error');
          }

          const batchBlockMessage = getCpBatchBlockMessage(colourPayloads);
          if (hasQueuedPayloads || hasColourPayloads) {
            const status = getCpBatchCompleteness(colourPayloads);
            if (!status.complete) return toast(batchBlockMessage, 'error');
          }

          // IN-MEMORY CHECK (Immediate Feedback) via Helper
          const duplicate = cpSelectedMould ? window.isPlanDuplicate(
            cpSelectedOrder ? cpSelectedOrder.orderNo : '',
            cpSelectedMould.mould_name || cpSelectedMould.mouldName
          ) : null;

          if (duplicate) {
            console.error('DEBUG: Duplicate Found!', duplicate);
            const msg = `Blocked: Mould is already ${duplicate.status} on Machine ${duplicate.machine}.\n\nView existing plan?`;
            if (confirm(msg)) {
              closeModal('newCreatePlanModal');
              const machCode = duplicate.machine;
              const searchInput = document.getElementById('masterSearch');
              if (searchInput) {
                searchInput.value = machCode.split('>').pop().trim();
                if (typeof window.filterMasterPlan === 'function') window.filterMasterPlan();
              }
              loadMasterPlan();
            }
            return;
          }

          try {
            if (cpSave) {
              cpSave.disabled = true;
              cpSave.innerHTML = '<i class="bi bi-hourglass-split"></i> Saving...';
            }

            // MODE A: Queue Execution
            if (cpDraftQueue.length > 0) {
              // If there's ALSO a current selection that isn't valid or just a leftover, ignore it?
              // Or add it? 
              // Better: Force user to "Add" first. 
              // Only execute Queue.

              const payload = [...cpDraftQueue].sort((a, b) => {
                const aSqn = parseCpSqn(a.mouldingSqn) ?? Number.MAX_SAFE_INTEGER;
                const bSqn = parseCpSqn(b.mouldingSqn) ?? Number.MAX_SAFE_INTEGER;
                if (a.orderNo !== b.orderNo) return String(a.orderNo || '').localeCompare(String(b.orderNo || ''));
                return aSqn - bSqn;
              });
              // Each item in queue may carry its own planType (e.g. 'Labour Job')
              // Items without planType default to 'Moulding' on the server side.
              // If User has a valid selection pending that IS NOT in queue, ask?
              // For simplicity, just send Queue + Current (if valid)?
              // The user workflow: Select -> Add -> Select -> Add -> Create.
              // So usually Current is null/reset.
              // If they selected a last one but didn't click Add, but clicked Create...
              // We should probably include it.

              if (hasColourPayloads) {
                colourPayloads.forEach((rowPayload) => {
                  const isQueued = payload.find((x) => x.orderNo === rowPayload.orderNo && x.mouldCode === rowPayload.mouldCode && x.machine === rowPayload.machine);
                  if (!isQueued) payload.push(rowPayload);
                });
              } else if (cpSelectedOrder && cpSelectedMould && cpSelectedMachine) {
                // Check if it's already in queue
                const isQueued = cpDraftQueue.find(x => x.mouldName === (cpSelectedMould.mould_name || cpSelectedMould.mouldName));
                if (!isQueued) {
                  // Implicitly add current selection
                  payload.push({
                    plant: (localStorage.getItem('jpsms_factory_id') == '2' ? 'SHIVANI' : 'DUNGRA'),
                    machine: cpSelectedMachine.machine,
                    orderNo: cpSelectedOrder.orderNo,
                    itemCode: cpSelectedMould.item_code,
                    itemName: cpSelectedOrder.productName,
                    mouldName: cpSelectedMould.mould_name || cpSelectedMould.mouldName,
                    mouldCode: cpSelectedMould.mould_no || cpSelectedMould.item_code,
                    mouldingSqn: cpSelectedMould.mouldingSqn || cpSelectedMould.moulding_sqn || null,
                    planQty: cpSelectedMould.plan_qty,
                    balQty: cpSelectedMould.plan_qty,
                    batchQty: getCpActiveBatchQty(),
                    startDate: new Date().toISOString()
                  });
                }
              }

              const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : null;
              console.log('Sending Bulk Payload:', payload);
              const res = await api.post('/planning/create', payload);

              if (res && res.ok) {
                toast(`Successfully created ${res.count || payload.length} plans!`, 'success');
                cpDraftQueue.length = 0; // Clear
                clearCpDraftStorage();
                closeModal('newCreatePlanModal');
                loadMasterPlan();
              } else {
                toast(res.error || 'Failed to create plans', 'error');
              }
              return; // EXIT
            }

            // MODE B: Single Create (Legacy / No Queue)
            const payload = hasColourPayloads
              ? colourPayloads
              : {
                plant: (localStorage.getItem('jpsms_factory_id') == '2' ? 'SHIVANI' : 'DUNGRA'),
                machine: cpSelectedMachine.machine,
                orderNo: cpSelectedOrder.orderNo,
                itemCode: cpSelectedMould.item_code,
                itemName: cpSelectedOrder.productName,
                mouldName: cpSelectedMould.mould_name || cpSelectedMould.mouldName,
                mouldCode: cpSelectedMould.mould_no || cpSelectedMould.item_code,
                mouldingSqn: cpSelectedMould.mouldingSqn || cpSelectedMould.moulding_sqn || null,
                planQty: cpSelectedMould.plan_qty,
                balQty: cpSelectedMould.plan_qty,
                batchQty: getCpActiveBatchQty(),
                startDate: new Date().toISOString(),
                planType: window.cpLabourPlanType || (cpSelectedMachine?.machine_process === 'Labour Job' ? 'Labour Job' : 'Moulding')
              };

            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : null;
            console.log('Sending Payload:', payload);
            const res = await api.post('/planning/create', payload);

            if (res && res.ok) {
              toast(hasColourPayloads ? `Created ${colourPayloads.length} colour-wise plan row(s)!` : 'Plan created successfully!', 'success');
              window.cpLabourPlanType = null; // Reset Labour Job flag
              closeModal('newCreatePlanModal');
              loadMasterPlan();
            } else {
              toast(res.error || 'Failed to create plan', 'error');
            }
          } catch (e) {
            console.error(e);
            toast(e.message, 'error');
          } finally {
            if (cpSave) {
              cpSave.disabled = false;
              cpSave.innerHTML = '<i class="bi bi-check2-circle"></i> Create Plan';
            }
          }
        }

        // ---- Labour Job Mould Modal ----
        let _cpLabourJobGroup = null;

        async function openLabourJobMouldModal(group) {
          const activeBatchQty = getCpActiveBatchQty();
          if (activeBatchQty <= 0) return toast('Enter Job Qty first before selecting Labour Job.', 'error');
          _cpLabourJobGroup = group;

          // Build modal if not already in DOM
          let modal = document.getElementById('cpLabourJobModal');
          if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cpLabourJobModal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
            modal.innerHTML = `
              <div style="background:#fff;padding:24px;border-radius:12px;width:400px;max-width:92%;border-top:4px solid #b45309">
                <div style="font-weight:800;color:#92400e;font-size:1rem;margin-bottom:16px"><i class="bi bi-people-fill"></i> Labour Job — <span id="cpLjMouldName"></span></div>
                <div style="margin-bottom:14px">
                  <label style="font-weight:700;font-size:0.82rem;display:block;margin-bottom:5px">Select Party</label>
                  <select id="cpLjPartySelect" style="width:100%;padding:8px;border:1px solid #fde68a;border-radius:6px;background:#fffbeb;font-size:0.82rem">
                    <option value="">Loading parties...</option>
                  </select>
                </div>
                <div style="margin-bottom:16px">
                  <label style="font-weight:700;font-size:0.82rem;display:block;margin-bottom:5px">Select Machine</label>
                  <div id="cpLjMachineList" style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;padding:4px 0">
                    <div style="color:#94a3b8;font-size:0.8rem">Select a party first</div>
                  </div>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end">
                  <button id="cpLjCancelBtn" style="padding:8px 16px;border:1px solid #e2e8f0;background:#fff;border-radius:6px;cursor:pointer;font-size:0.82rem">Cancel</button>
                  <button id="cpLjConfirmBtn" style="padding:8px 20px;background:#b45309;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:0.82rem">Confirm</button>
                </div>
              </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('cpLjCancelBtn').onclick = () => { modal.style.display = 'none'; };
            document.getElementById('cpLjPartySelect').onchange = async (e) => {
              const partyId = e.target.value;
              const machList = document.getElementById('cpLjMachineList');
              if (!partyId) { machList.innerHTML = '<div style="color:#94a3b8;font-size:0.8rem">Select a party first</div>'; return; }
              machList.innerHTML = '<div style="color:#94a3b8;font-size:0.8rem">Loading...</div>';
              try {
                const api = window.JPSMS?.api;
                const res = await api.get(`/labour-parties/${partyId}/machines`);
                const machines = res.data || [];
                if (!machines.length) { machList.innerHTML = '<div style="color:#dc2626;font-size:0.8rem">No machines assigned to this party</div>'; return; }
                machList.innerHTML = machines.map((m, i) => `
                  <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:0.82rem;background:#fff">
                    <input type="radio" name="cpLjMachine" value="${esc(m.machine)}" data-tonnage="${esc(m.tonnage||'')}" ${i===0?'checked':''}>
                    <span style="font-weight:700">${esc(m.machine)}</span>
                    ${m.tonnage ? `<span style="color:#64748b;font-size:0.72rem">${esc(m.tonnage)}T</span>` : ''}
                  </label>
                `).join('');
              } catch(err) { machList.innerHTML = `<div style="color:#dc2626;font-size:0.8rem">Error: ${esc(err.message)}</div>`; }
            };
            document.getElementById('cpLjConfirmBtn').onclick = () => {
              const checkedMach = document.querySelector('input[name="cpLjMachine"]:checked');
              if (!checkedMach) return toast('Select a machine for Labour Job', 'error');
              const machineName = checkedMach.value;
              const grp = _cpLabourJobGroup;
              if (!grp) { modal.style.display = 'none'; return; }
              // Auto-select mould (first row if single, otherwise open chooser)
              window.cpLabourPlanType = 'Labour Job';
              // Override cpSelectedMachine to the Labour Job machine
              cpSelectedMachine = { machine: machineName, machine_process: 'Labour Job' };
              modal.style.display = 'none';
              if (grp.rows.length > 1) {
                openCpMouldChooser(grp);
              } else {
                selectCpMould(grp.rows[0]);
              }
            };
          }

          // Show modal
          modal.style.display = 'flex';
          document.getElementById('cpLjMouldName').textContent = group.displayName || 'Mould';

          // Load parties
          const partySelect = document.getElementById('cpLjPartySelect');
          partySelect.innerHTML = '<option value="">Loading...</option>';
          document.getElementById('cpLjMachineList').innerHTML = '<div style="color:#94a3b8;font-size:0.8rem">Select a party first</div>';
          try {
            const api = window.JPSMS?.api;
            const res = await api.get('/labour-parties');
            const parties = (res.data || []).filter(p => p.is_active);
            if (!parties.length) {
              partySelect.innerHTML = '<option value="">No active parties found</option>';
            } else {
              partySelect.innerHTML = '<option value="">— Select Party —</option>' +
                parties.map(p => `<option value="${p.id}">${esc(p.party_name)}</option>`).join('');
            }
          } catch(err) {
            partySelect.innerHTML = `<option value="">Error loading parties</option>`;
          }
        }
        window.openLabourJobMouldModal = openLabourJobMouldModal;
        // ---- End Labour Job Mould Modal ----

        async function selectCpMould(mould) {
          const activeBatchQty = getCpActiveBatchQty();
          const orderQty = getCpOrderQty();
          if (activeBatchQty <= 0) {
            return toast('Enter Job Qty after selecting OR first.', 'error');
          }
          if (orderQty > 0 && activeBatchQty > orderQty) {
            return toast(`Job Qty cannot be more than OR Qty (${formatCpQty(orderQty)}).`, 'error');
          }
          const selectedSqn = parseCpSqn(mould.mouldingSqn || mould.moulding_sqn);
          if (window.cpOrderSequenceMeta?.missingSqnMoulds?.length) {
            const names = window.cpOrderSequenceMeta.missingSqnMoulds.map((row) => row.mouldNo || row.mouldName).filter(Boolean).join(', ');
            return toast(`Fill Moulding Sqn. first in Mould Master for: ${names}`, 'error');
          }
          if (cpDraftQueue.length === 0 && window.cpOrderSequenceMeta?.nextRequiredSqn != null && selectedSqn !== window.cpOrderSequenceMeta.nextRequiredSqn) {
            const pendingNames = (window.cpOrderSequenceMeta.requiredRows || []).map((row) => row.mouldNo || row.mouldName).filter(Boolean).join(', ');
            return toast(`Plan Moulding Sqn. ${window.cpOrderSequenceMeta.nextRequiredSqn} first: ${pendingNames}`, 'error');
          }

          // ---------------------------------------------------------
          // DUPLICATE MOULD CHECK (Instant on Selection)
          // ---------------------------------------------------------
          const saveBtn = document.getElementById('cpSaveBtn');

          const familySnapshot = getCpFamilySnapshotForMould(mould, true);
          const remainingQtyForPlan = Math.max(0, familySnapshot.remainingQty);
          const duplicate = remainingQtyForPlan > 0
            ? null
            : window.isPlanDuplicate(
              window.cpSelectedOrder ? window.cpSelectedOrder.orderNo : '',
              mould.mould_name || mould.mouldName
            );

          if (duplicate) {
            // Update UI for Duplicate
            cpSelectedMould = mould; // Keep selected so user knows context
            cpSelectedMachine = null; // No machine selection allowed

            const isCompleted = String(duplicate.status || '').toUpperCase() === 'COMPLETED';

            // 1. Hide Machine List / Show Warning
            const sec = document.getElementById('cpMachineSection');
            const list = document.getElementById('cpMachineList');
            if (sec) sec.style.display = 'block';
            if (list) {
              list.style.display = 'block'; // Ensure visible container
              list.innerHTML = isCompleted
                ? `<div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; padding:16px; text-align:center; color:#047857">
                        <div style="font-size:1.5rem; margin-bottom:8px"><i class="bi bi-check-circle-fill"></i></div>
                        <div style="font-weight:700; margin-bottom:4px">Plan Already Completed</div>
                        <div style="font-size:0.9rem">This mould is already <strong>Completed</strong> for this order.</div>
                        <div style="font-size:0.85rem; margin-top:8px; opacity:0.8">It will not be planned again. A Superadmin can Restore it from the Complete Production Plan report to re-plan.</div>
                    </div>`
                : `<div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:8px; padding:16px; text-align:center; color:#be123c">
                        <div style="font-size:1.5rem; margin-bottom:8px">⚠️</div>
                        <div style="font-weight:700; margin-bottom:4px">Mould is Already Active</div>
                        <div style="font-size:0.9rem">This mould is currently <strong>${duplicate.status}</strong> on Machine <strong>${esc(duplicate.machine)}</strong>.</div>
                        <div style="font-size:0.85rem; margin-top:8px; opacity:0.8">You cannot create a duplicate plan.</div>
                    </div>`;
            }

            // 2. Change Save Button to View Plan
            if (saveBtn && isCompleted) {
              // Completed plans are not on the board — nothing to view. Just block the action.
              saveBtn.disabled = true;
              saveBtn.innerHTML = '<i class="bi bi-check-circle"></i> Already Completed';
              saveBtn.className = 'btn';
              saveBtn.style.background = '#94a3b8';
              saveBtn.style.color = '#fff';
              saveBtn.onclick = null;
            } else if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.innerHTML = '<i class="bi bi-eye"></i> View Existing Plan';
              saveBtn.className = 'btn'; // Reset primary class if needed, or keep
              saveBtn.style.background = '#64748b'; // Secondary color
              saveBtn.style.color = '#fff';

              // Override Click for Redirection
              saveBtn.onclick = () => {
                closeModal('newCreatePlanModal');
                // Redirect Logic
                const machCode = duplicate.machine;
                const searchInput = document.getElementById('masterSearch');

                // Set Highlight ID Global
                window.highlightPlanId = duplicate.id;

                if (window.view !== 'master') {
                  // Switch View Logic
                  window.view = 'master';
                  // Update UI tabs manually if needed, or rely on a helper
                  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                  const masterTab = document.querySelector('.nav-link[onclick*="master"]');
                  if (masterTab) masterTab.classList.add('active');

                  // Hide other views
                  const mapWrap = document.getElementById('mapWrap');
                  const kpiDeck = document.querySelector('.kpi-deck');
                  const dashboardToolbar = document.getElementById('dashboardToolbar');
                  if (mapWrap) mapWrap.style.display = 'none';
                  if (kpiDeck) kpiDeck.style.display = 'none';
                  if (dashboardToolbar) dashboardToolbar.style.display = 'none';
                  document.getElementById('masterView').style.display = 'block';
                }

                if (searchInput) {
                  searchInput.value = machCode.split('>').pop().trim();
                  if (typeof window.filterMasterPlan === 'function') window.filterMasterPlan();
                }
                loadMasterPlan();
              };
            }
            return;
          }

          // ---------------------------------------------------------

          cpSelectedMould = mould;
          // Preserve Labour Job machine — it was already selected in the Labour Job party modal
          if (window.cpLabourPlanType !== 'Labour Job') cpSelectedMachine = null;
          renderCpSelectedMouldSummary(mould);

          // Enable Add Button
          const addBtn = document.getElementById('cpAddBtn');
          if (addBtn) {
            addBtn.disabled = window.cpLabourPlanType !== 'Labour Job'; // Labour Job already has machine
            addBtn.onclick = addToQueue;
          }

          // RESET BUTTON STATE (Fix for Bug)
          if (saveBtn) {
            saveBtn.disabled = window.cpLabourPlanType !== 'Labour Job';
            saveBtn.innerHTML = '<i class="bi bi-check2-circle"></i> Create Plan';
            saveBtn.className = 'btn primary';
            saveBtn.style.background = ''; // Revert style
            saveBtn.style.color = '';
            saveBtn.onclick = handleCreatePlanSubmit; // Restore Handler
          }

          const sec = document.getElementById('cpMachineSection');
          if (sec) sec.style.display = 'none';
          clearCpColourPlan();

          if (getPlanningProcessFilter() === 'Moulding' && !(mould.primary_machine || mould.primaryMachine || mould.secondary_machine || mould.secondaryMachine)) {
            return toast('Primary / Secondary Machine is missing in Mould Master. Fill it first.', 'error');
          }

          await openCpColourPlanModal(mould);
        }

        function renderCpMachines(machines) {
          const list = document.getElementById('cpMachineList');
          if (!list) return;
          list.innerHTML = '';

          if (!machines.length) {
            list.innerHTML = '<div class="muted" style="grid-column:1/-1">No compatible machines found.</div>';
            return;
          }

          machines.forEach(mac => {
            const isFree = mac.isFree;
            const statusColor = isFree ? 'var(--ok)' : 'var(--warn)';
            const statusTxt = isFree ? 'AVAILABLE' : (mac.currentStatus || 'BUSY');
            const availableOn = formatCpMachineAvailability(mac.bookedUntil);
            const preferenceBadge = mac.preferenceRole === 'PRIMARY'
              ? '<span class="tag" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe">Primary</span>'
              : mac.preferenceRole === 'SECONDARY'
                ? '<span class="tag" style="background:#fff7ed; color:#c2410c; border-color:#fed7aa">Secondary</span>'
                : '';
            const machineArea = mac.line && mac.line !== 'Machines'
              ? `${mac.building} - L${mac.line}`
              : `${mac.building}`;

            const el = document.createElement('div');
            el.className = 'machine-card-select';
            el.style.border = '1px solid var(--border)';
            el.style.borderRadius = '8px';
            el.style.padding = '10px';
            el.style.cursor = 'pointer';
            el.style.background = '#fff';
            el.style.position = 'relative';

            if (isFree) el.style.borderColor = 'var(--ok)';

            el.innerHTML = `
                       <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px">
                           <div style="font-weight:800; font-size:1rem; padding-right:8px; line-height:1.2">${esc(mac.machine)}</div>
                           <div style="font-weight:700; color:#64748b; font-size:0.9rem; white-space:nowrap; background:#f1f5f9; padding:2px 6px; border-radius:4px">${esc(mac.tonnage)}T</div>
                       </div>
                    <div style="font-size:0.8rem; color:#64748b">${esc(machineArea)}</div>
                    <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap">${preferenceBadge}${mac.isBookedFor15Days ? '<span class="tag" style="background:#fff1f2; color:#be123c; border-color:#fecdd3">Booked 15 Days</span>' : ''}</div>
                    <div style="font-size:0.8rem; margin-top:6px; font-weight:700; color:${statusColor}">
                       ${statusTxt}
                    </div>
                    <div style="font-size:0.75rem; color:#64748b; margin-top:4px">Available on: <strong>${esc(availableOn)}</strong></div>
                   ${!isFree ? `<div style="font-size:0.75rem; color:#94a3b8">Running: ${esc(mac.currentOrder || '-')}</div>` : ''}
                `;

            el.onclick = () => {
              cpSelectedMachine = mac;
              // Highlights
              Array.from(list.children).forEach(c => {
                c.style.background = '#fff';
                c.style.borderColor = 'var(--border)';
                if (c.querySelector('.status-txt') === 'AVAILABLE') c.style.borderColor = 'var(--ok)';
              });
              el.style.background = '#eff6ff';
              el.style.borderColor = '#3b82f6';

              const sBtn = document.getElementById('cpSaveBtn');
              const aBtn = document.getElementById('cpAddBtn');

              if (sBtn) sBtn.disabled = false;
              if (aBtn) aBtn.disabled = false;

              updateQueueUI(); // Ensure consistent state
            };

            list.appendChild(el);
          });
        }




        function renderDirectOrders(rows) {
          const el = document.getElementById('directOrders'); while (el.children.length > 1) el.removeChild(el.lastChild);
          rows.forEach(o => {
            const r = document.createElement('div'); r.className = 'row'; r.dataset.id = o.id;
            const priClass = (o.priority || 'Normal');
            r.innerHTML = `
            <div><input type="checkbox" class="ck" /></div>
          <div><span class="tag ${esc(priClass)}">${esc(o.priority)}</span></div>
          <div><strong>${esc(o.order_no)}</strong> • <span class="muted">${esc(o.item_name)}</span></div>
          <div>${esc(o.mould_code || '-')}</div>
          <div>${o.qty.toLocaleString()}</div>
          <div>${o.age_days}d</div>`;
            el.appendChild(r);
          });
        }

        /* ------------------ Balance Load (Preview → Commit) ------------------ */
        async function balanceLoad() {
          previewMode = 'balance';
          const payload = {
            horizon_days: horizon,
            include_inactive: !!showInactive,
            building: document.getElementById('buildingFilter').value || null,
            factory_ids: (window.JPSMS?.session?.factories || []).map(f => String(f.id || f)).filter(Boolean)
          };
          try {
            const res = await api.post('/planning/balance', payload);
            const assignments = Array.isArray(res?.assignments) ? res.assignments : [];
            if (assignments.length) {
              lastPreviewAssignments = assignments;
              showPreview('Balance preview from server', assignments);
              return;
            }
            // if server returns message but no assignments, just refresh
            toast(res?.message || 'Balanced via server');
            await loadMachines(); await loadKPIs();
            return;
          } catch {/* fallback client demo */ }
          await clientBalancePreview('Balance preview (demo)');
        }

        async function clientBalancePreview(subtitle) {
          if (!lastOrders.length) await loadPendingOrders();
          if (!lastMachines.length) await loadMachines();

          let scope = lastMachines.filter(m => !m.is_maintenance && (m.is_active !== false) && (m.status || '').toLowerCase() !== 'off');
          const b = document.getElementById('buildingFilter').value;
          const q = (document.getElementById('machineSearch').value || '').toLowerCase().trim();
          if (b) scope = scope.filter(x => String(x.building).toUpperCase() === b);
          if (q) scope = scope.filter(x => (x.code + ' ' + x.name).toLowerCase().includes(q));
          if (!scope.length) { toast('No eligible machines'); return; }

          scope.forEach(m => { m.load = Number(m.load_pct || m.utilization || Math.floor(10 + Math.random() * 60)); m.queue_preview = []; m.queue_effort = 0; });

          const rateFor = (o) => { const base = 100; return (o.priority === 'Urgent') ? base * 1.2 : (o.priority === 'High') ? base * 1.0 : base * 0.85; };
          const tasks = lastOrders.slice().sort((a, b) => {
            const pr = { Urgent: 0, High: 1, Normal: 2 }; const pa = pr[a.priority] ?? 3, pb = pr[b.priority] ?? 3;
            return (pa - pb) || ((b.qty || 0) - (a.qty || 0));
          }).map(o => ({ id: o.id, label: o.order_no, effort: Math.max(1, Math.round((o.qty || 1000) / rateFor(o))) }));

          tasks.forEach(t => {
            const target = scope.reduce((best, m) => { const proj = (m.load || 0) + (m.queue_effort || 0); return (!best || proj < best.proj) ? { m, proj } : best; }, null)?.m;
            if (target) { target.queue_preview.push(t.label); target.queue_effort = (target.queue_effort || 0) + t.effort; }
          });

          const assignments = scope.filter(m => m.queue_preview.length)
            .map(m => ({ machine_id: m.id, machine_code: m.code, building: m.building, line: m.line, orders: m.queue_preview.slice() }));

          lastPreviewAssignments = assignments;
          showPreview(subtitle, assignments);
        }

        /* ------------------ Auto-Assign P1 (Urgent) ------------------ */
        async function autoAssignP1() {
          previewMode = 'p1';
          const payload = {
            limit: 20,
            building: document.getElementById('buildingFilter').value || null,
            factory_ids: (window.JPSMS?.session?.factories || []).map(f => String(f.id || f)).filter(Boolean)
          };
          try {
            const res = await api.post('/planning/auto-assign-p1', payload);
            const assignments = Array.isArray(res?.assignments) ? res.assignments : [];
            if (assignments.length) {
              lastPreviewAssignments = assignments;
              showPreview('Auto-Assign P1 (server)', assignments);
              return;
            }
            toast(res?.message || 'P1 assigned via server'); await loadMachines(); await loadKPIs(); return;
          } catch {/* fallback */ }
          await clientP1Preview('Auto-Assign P1 (demo)');
        }

        async function clientP1Preview(subtitle) {
          if (!lastOrders.length) await loadPendingOrders();
          if (!lastMachines.length) await loadMachines();

          let scope = lastMachines.filter(m => !m.is_maintenance && (m.is_active !== false) && (m.status || '').toLowerCase() !== 'off');
          if (!scope.length) { toast('No eligible machines'); return; }

          const urgent = lastOrders.filter(o => String(o.priority).toLowerCase() === 'urgent');
          if (!urgent.length) { toast('No Urgent (P1) orders'); return; }

          scope.forEach(m => { m.load = Number(m.load_pct || m.utilization || Math.floor(10 + Math.random() * 60)); m.queue_preview = []; m.queue_effort = 0; });

          // Assign top-N urgent to earliest available machines
          urgent.sort((a, b) => (b.qty || 0) - (a.qty || 0));
          urgent.forEach(o => {
            const target = scope.reduce((best, m) => { const proj = (m.load || 0) + (m.queue_effort || 0); return (!best || proj < best.proj) ? { m, proj } : best; }, null)?.m;
            if (target) { target.queue_preview.push(o.order_no); target.queue_effort = (target.queue_effort || 0) + 1; }
          });

          const assignments = scope.filter(m => m.queue_preview.length)
            .map(m => ({ machine_id: m.id, machine_code: m.code, building: m.building, line: m.line, orders: m.queue_preview.slice() }));

          lastPreviewAssignments = assignments;
          showPreview(subtitle, assignments);
        }

        /* ------------------ Preview Modal utils ------------------ */
        function showPreview(subtitle, assignments) {
          const modal = document.getElementById('previewModal');
          modal.querySelector('#pmTitle').textContent = (previewMode === 'p1' ? 'Auto-Assign P1 — Preview' : 'Balance Load — Preview');
          modal.querySelector('#pmSub').textContent = subtitle + ` • ${assignments.length} machine(s)`;
          const list = modal.querySelector('#pmList');
          while (list.children.length > 1) list.removeChild(list.lastChild);
          assignments.forEach((a, idx) => {
            const row = document.createElement('div'); row.className = 'row';
            row.innerHTML = `
            <div>${idx + 1}</div>
          <div><strong>${esc(a.machine_code || a.machine_id)}</strong></div>
          <div class="mini">${(a.orders || []).map(x => esc(x)).join(', ') || '—'}</div>
          <div>${esc(a.building || '-')}</div>
          <div>${esc(a.line || '-')}</div>
          <div>${(a.orders || []).length}</div>`;
            list.appendChild(row);
          });

          modal.querySelector('#pmCommit').onclick = async () => {
            if (!lastPreviewAssignments.length) { closeModal('previewModal'); return; }
            try {
              const out = await api.post(
                previewMode === 'p1' ? '/planning/auto-assign-p1/commit' : '/planning/balance/commit',
                { assignments: lastPreviewAssignments }
              );
              toast(out?.message || 'Committed');
              closeModal('previewModal');
              await loadMachines(); await loadKPIs();
            } catch (e) { toast(e?.message || 'Commit failed'); }
          };
          modal.querySelector('#pmClose').onclick = () => closeModal('previewModal');
          modal.querySelector('#pmCancel').onclick = () => closeModal('previewModal');
          openModal('previewModal');
        }

        /* ------------------ Modal helpers ------------------ */
        var modalScrollLockY = 0;

        function lockModalScroll() {
          if (document.body.getAttribute('data-lock') === '1') return;
          modalScrollLockY = window.scrollY || window.pageYOffset || 0;
          document.documentElement.classList.add('modal-lock');
          document.body.setAttribute('data-lock', '1');
          document.body.style.top = `-${modalScrollLockY}px`;
        }

        function unlockModalScrollIfNeeded() {
          if (document.querySelector('.modal.show')) return;
          document.documentElement.classList.remove('modal-lock');
          document.body.removeAttribute('data-lock');
          document.body.style.top = '';
          window.scrollTo(0, modalScrollLockY);
        }

        function openModal(id) {
          const m = document.getElementById(id);
          if (!m) return;
          m.classList.add('show');
          m.setAttribute('aria-hidden', 'false');
          lockModalScroll();
        }

        function closeModal(id) {
          const m = document.getElementById(id);
          if (!m) return;
          m.classList.remove('show');
          m.setAttribute('aria-hidden', 'true');
          unlockModalScrollIfNeeded();
        }

        function bindModalBackdropGuard(id) {
          const modal = document.getElementById(id);
          if (!modal || modal.dataset.backdropGuardBound === '1') return;
          const card = modal.querySelector('.modal-card');
          const stopBackdropScroll = (ev) => {
            if (!modal.classList.contains('show')) return;
            if (card && !card.contains(ev.target)) {
              ev.preventDefault();
              ev.stopPropagation();
            }
          };
          modal.addEventListener('wheel', stopBackdropScroll, { passive: false });
          modal.addEventListener('touchmove', stopBackdropScroll, { passive: false });
          modal.dataset.backdropGuardBound = '1';
        }

        /* ------------------ Utility ------------------ */
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

        // Backdrop for mobile sidebar
        const backdrop = document.getElementById('sidebarBackdrop');
        if (backdrop) backdrop.addEventListener('click', () => {
          document.body.classList.remove('sidebar-open');
          unlockModalScrollIfNeeded();
        });

        /* --------------- Keyboard shortcuts --------------- */
        document.addEventListener('keydown', (e) => {
          if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); balanceLoad(); }
          if (e.key === 'p' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openCreatePlanLauncher(); }
        });

        // Initial data
        updatePlanningHeroClock();
        setInterval(updatePlanningHeroClock, 60000);
        await loadMachines();
        await loadKPIs();
        if (!lastOrders.length) try { await loadPendingOrders(); } catch (e) { }


        /* ------------------ View Routing ------------------ */
        /* ------------------ View Routing ------------------ */
        /* ------------------ Completed Plans Logic ------------------ */
        window.loadCompletedPlans = async function () {
          const list = document.getElementById('completedList');
          if (!list) return;
          list.innerHTML = '<div style="padding:20px; text-align:center">Loading completed plans...</div>';

          try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : null;
            const res = await api.get('/planning/completed');
            const reports = res.data || [];

            list.innerHTML = '';
            if (!reports.length) {
              list.innerHTML = '<div class="muted" style="padding:40px; text-align:center">No completed plans found.</div>';
              return;
            }

            reports.forEach(rpt => {
              const h = rpt.header;
              const card = document.createElement('div');
              card.className = 'card';
              card.style.borderLeft = '4px solid #10b981'; // Green accent

              let rowsHtml = '';
              (rpt.rows || []).forEach(r => {
                if (!r) return;
                const isDrop = r.type === 'Dropped';
                rowsHtml += `
                         <div style="display:flex; padding:8px 12px; border-bottom:1px solid #f1f5f9; align-items:center; font-size:0.85rem; background:${isDrop ? '#fef2f2' : '#fff'}">
                            <div style="width:80px; font-weight:600; color:${isDrop ? '#ef4444' : '#10b981'}">${r.type}</div>
                            <div style="flex:1">
                               <div style="font-weight:700; color:#334155">${esc(r.mould_name)}</div>
                               <div class="small-muted">${esc(r.mould_code)}</div>
                            </div>
                            <div style="width:120px">${esc(r.machine)}</div>
                            <div style="width:80px; text-align:right">${r.plan_qty.toLocaleString()}</div>
                            <div style="width:150px; text-align:right; font-family:monospace; color:#64748b">${new Date(r.time).toLocaleString()}</div>
                         </div>
                       `;
              });

              card.innerHTML = `
                       <div class="card-body">
                          <div style="display:flex; justify-content:space-between; margin-bottom:12px">
                             <div>
                                <div style="font-size:1.1rem; font-weight:800; color:#0f172a">${esc(h.orderNo)} <span class="tag g">Completed</span></div>
                                <div style="color:#64748b">${esc(h.product)} &bull; ${esc(h.client)}</div>
                             </div>
                             <div style="text-align:right">
                                <div style="font-size:0.9rem; font-weight:600">${h.totalMoulds} Moulds</div>
                                <div class="small-muted">Finished: ${h.completedAt ? new Date(h.completedAt).toLocaleDateString() : '-'}</div>
                             </div>
                          </div>
                          
                          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:12px">
                             ${rowsHtml}
                          </div>
                          
                          <div style="text-align:right">
                             <button class="btn mini secondary" onclick="window.restorePlan('${esc(h.orderNo)}')"><i class="bi bi-arrow-counterclockwise"></i> Restore to Pending</button>
                          </div>
                       </div>
                    `;
              list.appendChild(card);
            });
          } catch (e) {
            list.innerHTML = `<div class="error">Failed to load: ${esc(e.message)}</div>`;
          }
        };

        window.restorePlan = async function (orderNo) {
          if (!confirm('Restore this order to Pending state?')) return;
          try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : null;
            await api.post('/planning/restore', { orderNo });
            toast('Order restored');
            window.loadCompletedPlans(); // Refresh list
          } catch (e) {
            toast('Failed to restore: ' + e.message, 'error');
          }
        };

        /* ------------------ View Routing (early; must handle print_jc — nav uses ?view=print_jc before footer switchView runs) ------------------ */
        window.switchView = function (viewName) {
          viewName = (viewName || '').trim();
          console.log('Switching View to:', viewName);
          const dashboard = document.getElementById('view-main');
          const kpiDeck = document.querySelector('.kpi-deck');
          const mapWrap = document.getElementById('mapWrap');
          const dashboardToolbar = document.getElementById('dashboardToolbar');
          const masterView = document.getElementById('masterView');
          const timelineView = document.getElementById('timelineView');
          const excelTimelineView = document.getElementById('excelTimelineView');
          const pcr = document.getElementById('productionCompletionReport');
          const cv = document.getElementById('completedView');
          const mouldChangeView = document.getElementById('mouldChangeReport');
          const printView = document.getElementById('printJCView');
          const approvalView = document.getElementById('pendingPlanApprovalView');

          [masterView, timelineView, excelTimelineView, pcr, cv, mouldChangeView, printView, approvalView].forEach((el) => {
            if (el) el.style.display = 'none';
          });
          if (dashboard) dashboard.style.display = 'none';
          if (kpiDeck) kpiDeck.style.display = 'none';
          if (dashboardToolbar) dashboardToolbar.style.display = 'none';
          if (mapWrap) mapWrap.style.display = 'none';

          if (viewName === 'master') {
            if (masterView) masterView.style.display = 'block';
            if (dashboardToolbar) dashboardToolbar.style.display = 'block';
            loadMasterPlan();
          } else if (viewName === 'timeline') {
            if (timelineView) timelineView.style.display = 'block';
            if (typeof window.superLoadTimeline === 'function') window.superLoadTimeline();
            else loadTimeline();
          } else if (viewName === 'excel_timeline') {
            if (excelTimelineView) excelTimelineView.style.display = 'block';
            if (typeof window.loadExcelTimeline === 'function') window.loadExcelTimeline();
          } else if (viewName === 'prod_complete') {
            if (pcr) {
              pcr.style.display = 'block';
              window.loadProductionCompletionReport();
            } else {
              alert('Error: Report container not found');
            }
          } else if (viewName === 'completed') {
            if (cv) {
              cv.style.display = 'block';
              if (window.loadCompletedPlans) window.loadCompletedPlans();
            }
          } else if (viewName === 'mould_change') {
            if (mouldChangeView) mouldChangeView.style.display = 'block';
            if (typeof window.loadMouldChangeReport === 'function') window.loadMouldChangeReport();
          } else if (viewName === 'print_jc') {
            if (printView) printView.style.display = 'block';
            const pf = document.getElementById('pjcFrom');
            const pt = document.getElementById('pjcTo');
            if (pf && pt && !pf.value && !pt.value && typeof window.pjcLocalYmd === 'function') {
              const t = window.pjcLocalYmd(new Date());
              pf.value = t;
              pt.value = t;
            }
            if (typeof window.loadPrintJobCards === 'function') window.loadPrintJobCards();
          } else if (viewName === 'pending_plan_approval') {
            if (approvalView) approvalView.style.display = 'block';
            if (typeof window.loadJcApprovals === 'function') window.loadJcApprovals('pending');
          } else {
            if (dashboard) dashboard.style.display = 'grid';
            if (kpiDeck) kpiDeck.style.display = 'grid';
            if (dashboardToolbar) dashboardToolbar.style.display = 'block';
            if (mapWrap) mapWrap.style.display = 'block';
            if (typeof updatePlanningHeroClock === 'function') updatePlanningHeroClock();
            if (typeof loadMachines === 'function') loadMachines();
          }

          window.syncPlanningViewInHistory(viewName);
        };

        if (view === 'master') {
          window.switchView('master');
        } else if (view === 'timeline') {
          window.switchView('timeline');
        } else if (view === 'excel_timeline') {
          window.switchView('excel_timeline');
        } else if (view === 'prod_complete') {
          window.switchView('prod_complete');
        } else if (view === 'mould_change') {
          window.switchView('mould_change');
        } else if (view === 'print_jc') {
          window.switchView('print_jc');
        } else if (view === 'pending_plan_approval') {
          window.switchView('pending_plan_approval');
        }


        // Master View Events
        const masterSearchInput = document.getElementById('masterSearch');
        const masterSearchClear = document.getElementById('masterSearchClear');
        const masterSearchMeta = document.getElementById('masterSearchMeta');

        function syncMasterSearchUi(resultCount = null, totalCount = allMasterPlans.length || 0) {
          if (masterSearchClear) {
            const hasValue = !!((masterSearchInput?.value || '').trim());
            masterSearchClear.classList.toggle('is-visible', hasValue);
          }

          if (masterSearchMeta) {
            if (resultCount === null) {
              masterSearchMeta.textContent = 'All Plans';
            } else {
              masterSearchMeta.textContent = `${resultCount} Match${resultCount === 1 ? '' : 'es'}`;
            }
            masterSearchMeta.title = `${resultCount === null ? totalCount : resultCount} visible plan${(resultCount === 1) ? '' : 's'}`;
          }
        }

        if (masterSearchInput) {
          masterSearchInput.oninput = filterMasterPlan;
          masterSearchInput.onkeydown = (e) => {
            if (e.key === 'Escape' && masterSearchInput.value) {
              masterSearchInput.value = '';
              filterMasterPlan();
            }
          };
        }
        if (masterSearchClear) {
          masterSearchClear.onclick = () => {
            if (!masterSearchInput) return;
            masterSearchInput.value = '';
            masterSearchInput.focus();
            filterMasterPlan();
          };
        }
        function openCreatePlanLauncher() {
          if (!JPSMS.auth.can('planning', 'edit')) {
            JPSMS.toast('Read Only Mode: Cannot create plans', 'error');
            return;
          }
          console.log('Opening Create Plan Launcher...');
          // alert('Debug: Open Create Plan'); // Toggle if needed
          try {
            bindModalBackdropGuard('newCreatePlanModal');
            openModal('newCreatePlanModal');

            const cpClose = document.getElementById('cpClose');
            if (cpClose) cpClose.onclick = () => closeModal('newCreatePlanModal');

            const cpCancel = document.getElementById('cpCancelBtn');
            if (cpCancel) cpCancel.onclick = () => closeModal('newCreatePlanModal');

            // Bind Search Input
            const cpSearch = document.getElementById('cpOrderSearch');
            const cpSearchClear = document.getElementById('cpSearchClear');
            if (cpSearch) {
              const syncCpSearchUi = () => {
                if (!cpSearchClear) return;
                const hasValue = !!(cpSearch.value || '').trim();
                cpSearchClear.style.opacity = hasValue ? '1' : '0';
                cpSearchClear.style.pointerEvents = hasValue ? 'auto' : 'none';
              };

              cpSearch.value = '';
              let cpSearchTimeout = null;
              cpSearch.oninput = (e) => {
                syncCpSearchUi();
                resetCpOrderSelection();
                const val = e.target.value;
                clearTimeout(cpSearchTimeout);
                cpSearchTimeout = setTimeout(() => {
                  renderCpOrders(val);
                }, 100); // 100ms debounce
              };
              cpSearch.onkeydown = (e) => {
                if (e.key === 'Escape' && cpSearch.value) {
                  clearTimeout(cpSearchTimeout);
                  cpSearch.value = '';
                  syncCpSearchUi();
                  resetCpOrderSelection();
                  renderCpOrders('');
                }
              };

              if (cpSearchClear) {
                cpSearchClear.onclick = () => {
                  cpSearch.value = '';
                  syncCpSearchUi();
                  resetCpOrderSelection();
                  renderCpOrders('');
                  cpSearch.focus();
                };
              }

              syncCpSearchUi();
              requestAnimationFrame(() => {
                resetCpOrderSelection();
                cpSearch.focus();
              });
            }

            // Re-bind Save Button explicitly here to ensure freshness
            const cpSave = document.getElementById('cpSaveBtn');
            if (cpSave) {
              // Use the named function to avoid duplicates and allow restoration
              cpSave.onclick = handleCreatePlanSubmit;
            } else {
              console.error('cpSaveBtn NOT FOUND in DOM');
            }

            loadCpOrders();
            // Refresh master plan in background to ensure duplicate check is fresh
            loadMasterPlan().then(() => console.log('DEBUG: Master Plan Refreshed for Check'));
          } catch (e) {
            console.error('Error opening Create Plan:', e);
            alert('Error opening Create Plan: ' + e.message);
          }
        };

        async function loadMasterPlan() {
          const tbody = document.getElementById('masterTableBody');
          tbody.innerHTML = `<div class="row"><div style="grid-column:1/-1; text-align:center; padding:20px" class="muted">Loading master plan...</div></div>`;

          try {
            const boardKey = `board|${getPlanningProcessQuerySuffix()}`;
            const res = await window._planCache.get(boardKey, () => api.get(`/planning/board?${getPlanningProcessQuerySuffix()}`));
            let plans = (res && res.data && res.data.plans) ? res.data.plans : [];

            // FILTER: Remove plans without assigned machines (User Request)
            plans = plans.filter(p => p.machine && p.machine !== '-' && p.machine.trim() !== '');

            // --- 1. SORT (Crucial for Ripple) ---
            plans.sort((a, b) => {
              // Machine Sort
              const getMeta = (val) => {
                const s = String(val || '');
                const parts = s.split('>');
                const line = parts.length > 1 ? parts[0] : '';
                const rest = parts.length > 1 ? parts[1] : parts[0];
                const match = rest.match(/(\d+)$/);
                const idx = match ? parseInt(match[1], 10) : 999999;
                return { line, idx, s };
              };
              const A = getMeta(a.machine);
              const B = getMeta(b.machine);
              if (A.line !== B.line) return A.line.localeCompare(B.line, undefined, { numeric: true });
              if (A.idx !== B.idx) return A.idx - B.idx;
              // 2. Status Priority: Running MUST be first
              const stA = (a.status || '').toLowerCase();
              const stB = (b.status || '').toLowerCase();
              if (stA === 'running' && stB !== 'running') return -1;
              if (stA !== 'running' && stB === 'running') return 1;

              // 3. Seq Sort (Secondary)
              if (Number(a.seq) !== Number(b.seq)) return Number(a.seq) - Number(b.seq);
              // 4. Stable Fallback: ID
              return Number(a.id) - Number(b.id);
            });

            // --- 2. RIPPLE (Daisy-Chain Times) ---
            const byMach = {};
            plans.forEach(p => {
              const m = p.machine || 'Unknown';
              if (!byMach[m]) byMach[m] = [];
              byMach[m].push(p);
            });

            Object.keys(byMach).forEach(m => {
              const chain = byMach[m];
              // Sort by sequence (Already sorted in step 1, but safe to assume)

              let cursorTime = Date.now();

              chain.forEach((p, idx) => {
                const status = (p.status || '').toUpperCase();
                const isRunning = (status === 'RUNNING');

                // 1. Calculate Production Rate (Pcs/Hr)
                const ct = Number(p.cycleTime) || 120; // seconds
                const cav = Number(p.cavity) || 1;
                let pcsHr = 0;
                if (ct > 0) pcsHr = (3600 / ct) * cav;
                if (pcsHr === 0) pcsHr = 30; // Safety Fallback

                // 2. Determine Work Quantity & Duration
                // Force Real-Time Balance
                const qty = Number(p.planQty) || 0;
                const produced = Number(p.producedQty) || 0;
                const bal = Math.max(0, qty - produced);
                p.balQty = bal; // Override static value for display consistency

                // Work Qty — always use BalQty so End Date reflects remaining work
                const workQty = bal;

                let durationMs = 0;
                if (workQty > 0) {
                  const hours = workQty / pcsHr;
                  durationMs = hours * 3600 * 1000;
                } else {
                  // Zero balance? Maybe complete. 
                  durationMs = 0;
                }

                let startMs;
                let endMs;

                // 3. Logic Branch
                const isStopped = (status === 'STOPPED');

                if (isRunning) {
                  // RUNNING: actual start date; end = NOW + remaining work
                  if (p.firstDprEntry) {
                    startMs = new Date(p.firstDprEntry).getTime();
                  } else if (p.startDate) {
                    startMs = new Date(p.startDate).getTime();
                  } else {
                    startMs = Date.now();
                  }
                  // End = remaining duration from NOW (not from startMs)
                  endMs = Date.now() + durationMs;
                  // Cursor advances to this plan's expected end
                  cursorTime = endMs;

                } else if (isStopped) {
                  // STOPPED: always show ORIGINAL DB start date (never use cursor as start)
                  // But expected end (startDate + remaining) feeds cursor for the next plan
                  if (p.startDate) {
                    startMs = new Date(p.startDate).getTime();
                  } else {
                    startMs = Date.now();
                  }
                  endMs = startMs + durationMs;
                  // Advance cursor: next PLANNED plan starts after this STOPPED plan's expected end
                  cursorTime = endMs;

                } else {
                  // PLANNED / QUEUED: start = previous plan's Expected End Date (cursor)
                  if (idx === 0) {
                    startMs = Date.now();
                  } else {
                    startMs = cursorTime;
                  }
                  endMs = startMs + durationMs;
                  cursorTime = endMs;
                }

                // Safety: Normalize dates
                if (!startMs || isNaN(startMs)) startMs = Date.now();
                if (!endMs || isNaN(endMs)) endMs = startMs + 3600000;

                // 4. Store High-Res Dates for Rendering
                p._rippledStartRaw = new Date(startMs);
                p._rippledEndRaw = new Date(endMs);
              });
            });

            allMasterPlans = plans;
            window.allMasterPlans = plans;
            renderMasterTable(plans);
            syncMasterSearchUi((document.getElementById('masterSearch')?.value || '').trim() ? plans.length : null, plans.length);
            toast(`Loaded ${plans.length} plans`);
          } catch (e) {
            console.error(e);
            tbody.innerHTML = `<div class="row"><div style="grid-column:1/-1; text-align:center; padding:20px" class="error">Failed to load: ${e.message}</div></div>`;
          }
        }
        window.loadMasterPlan = loadMasterPlan;

        function renderMasterTable(list) {
          const NOW = new Date();
          const tbody = document.getElementById('masterTableBody');
          tbody.innerHTML = '';

          // Header correction if needed (synced with below)
          // Tighter grid for single-page view (~1275px min) - Updated to fix overlaps
          const gridTemplate = '40px minmax(220px, 1.4fr) 190px minmax(330px, 2.15fr) 144px minmax(190px, 1.2fr) 98px 104px 128px 128px 128px 88px 112px 168px';
          const gridMinWidth = '1880px';

          if (!list.length) {
            tbody.innerHTML = `<div class="row" style="padding:40px; justify-content:center; color:#cbd5e1; font-style:italic">No plans found.</div>`;
            return;
          }

          // Sort by Machine (Suffix Priority) then Seq
          list.sort((a, b) => {
            // 1. Machine Sort
            const getMeta = (val) => {
              const s = String(val || '');
              const parts = s.split('>');
              const line = parts.length > 1 ? parts[0] : '';
              const rest = parts.length > 1 ? parts[1] : parts[0];
              const match = rest.match(/(\d+)$/);
              const idx = match ? parseInt(match[1], 10) : 999999;
              return { line, idx, s };
            };
            const A = getMeta(a.machine);
            const B = getMeta(b.machine);

            if (A.line !== B.line) return A.line.localeCompare(B.line, undefined, { numeric: true });
            if (A.idx !== B.idx) return A.idx - B.idx;

            // 2. Seq Sort (Secondary)
            return (a.seq - b.seq);
          });

          list.forEach(p => {
            // ... (keep existing parsing logic) ...
            // 0. Base Data & Parsing
            // Parse "B -L1>Name" -> Building: B, Line: L1
            if (p.machine && p.machine.includes('>')) {
              const parts = p.machine.split('>');
              const prefix = parts[0]; // "B -L1"
              if (prefix.includes(' -')) {
                const split = prefix.split(' -');
                if (!p.building || p.building === 'undefined') p.building = split[0].trim();
                if (!p.line || p.line === 'undefined') p.line = split[1].trim();
              }
            }

            const qty = p.planQty || 0;
            const produced = Number(p.producedQty) || 0; // From Backend
            const bal = qty - produced;
            const ctStr = p.cycleTime;
            const ct = Number(ctStr);

            let calculatedEnd = '-';
            let expEnd = '-';
            let perfPct = 0;
            let perfClass = 'tag';
            let perfLabel = 'N/A';

            // 1. Calculate Dates & Performance
            // PRIORITY: RIPPLE TIME (Dynamic Scheduling)
            const effectiveStart = p._rippledStartRaw ? p._rippledStartRaw : (p.startDate ? new Date(p.startDate) : null);

            if (effectiveStart) {
              const start = effectiveStart.getTime();

              if (ct > 0) {
                // A. End Date (Based on Full Qty from Start)
                // Use Rippled Sched End (Calculated in Step 2)
                const endDateObj = p._rippledEndRaw ? p._rippledEndRaw : new Date(start + (qty * ct * 1000));
                calculatedEnd = endDateObj.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

                // Debug Marker
                if (p._rippledStartRaw) calculatedEnd += ' <span style="color:#10b981; font-weight:bold; font-size:0.7em" title="Dynamic Schedule Active">(D)</span>';

                // Store for Reporting
                p._calculatedEndRaw = endDateObj;

                // B. Expected End (Based on Balance)
                // Use Rippled Exp End (Calculated in Step 2)
                const expDateObj = p._rippledExpRaw ? p._rippledExpRaw : endDateObj;
                expEnd = expDateObj.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

                // Temporary Debug Toast on first render (throttled)

                // Temporary Debug Toast on first render (throttled)
                if (!window._dynDebugShown) {
                  if (typeof toast === 'function') toast('Dynamic Scheduler v2: Active');
                  window._dynDebugShown = true;
                }

                // C. Performance / Efficiency
                const minutesElapsed = (NOW.getTime() - start) / 1000 / 60;
                if (minutesElapsed > 5 && produced > 0) {
                  const expectedQty = (minutesElapsed * 60) / ct;
                  perfPct = Math.round((produced / expectedQty) * 100);
                } else if (produced === 0 && minutesElapsed > 60) {
                  perfPct = 0;
                } else {
                  perfPct = 100;
                }
              } else {
                // Fallback: Use stored end date if available
                if (p.endDate) {
                  calculatedEnd = new Date(p.endDate).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                  // Store raw for reporting
                  p._calculatedEndRaw = new Date(p.endDate);
                } else {
                  calculatedEnd = 'No CT';
                }
                expEnd = 'No CT';
              }
            }

            // Badge Logic
            if (perfPct < 70) { perfClass += ' r'; perfLabel = 'V.Poor'; }
            else if (perfPct < 80) { perfClass += ' r'; perfLabel = 'Poor'; }
            else if (perfPct < 85) { perfClass += ' y'; perfLabel = 'Avg'; }
            else if (perfPct < 90) { perfClass += ' b'; perfLabel = 'Good'; }
            else { perfClass += ' g'; perfLabel = 'Exc'; }


            const row = document.createElement('div');
            row.className = 'row master-plan-row';

            // Highlight Logic
            if (window.highlightPlanId && (p.id === window.highlightPlanId || String(p.id) === String(window.highlightPlanId))) {
              row.classList.add('highlight-flash');
              row.style.background = '#fef08a'; // heavy yellow fallback
              setTimeout(() => {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Clear after used
                window.highlightPlanId = null;
              }, 100);
            }
            row.style.gridTemplateColumns = gridTemplate;
            row.style.alignItems = 'center';
            row.style.borderBottom = 'none';
            row.style.fontSize = '0.85rem';
            row.style.width = gridMinWidth;
            row.style.minWidth = gridMinWidth;

            // Master Plan Row Color Coding (User Request)
            let baseBg = 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))';
            let hoverBg = 'linear-gradient(180deg, rgba(240,249,255,0.98), rgba(232,245,255,0.96))';
            const cleanSt = (p.status || '').trim().toLowerCase();

            if (cleanSt === 'running') {
              baseBg = 'linear-gradient(180deg, rgba(219,234,254,0.95), rgba(191,219,254,0.92))';
              hoverBg = 'linear-gradient(180deg, rgba(191,219,254,0.98), rgba(147,197,253,0.92))';
            } else if (cleanSt === 'planned' || cleanSt === 'next plan') {
              baseBg = 'linear-gradient(180deg, rgba(255,237,213,0.95), rgba(254,215,170,0.92))';
              hoverBg = 'linear-gradient(180deg, rgba(254,215,170,0.98), rgba(253,186,116,0.92))';
            }

            row.style.background = baseBg;

            // Hover effect (Persistent Color)
            row.onmouseover = () => row.style.background = hoverBg;
            row.onmouseout = () => row.style.background = baseBg;

            // Status Badge
            let sClass = 'tag';
            const st = (p.status || '').toLowerCase();
            if (st === 'running') sClass += ' g';
            else if (st === 'completed') sClass += ' b';
            else if (st === 'stopped') sClass += ' r';
            else sClass += ' Normal';

            // Priority Badge
            const priClass = (p.priority === 'Urgent' ? 'Urgent' : p.priority === 'High' ? 'High' : 'Normal');

            // Action Buttons
            let actionHtml = '';

            const isRunning = (st === 'running');
            const isCompleted = (st === 'completed');

            // View Detail Button (New)
            actionHtml += `
                  <button class="btn icon mini master-action-btn view" 
                     title="View Detail"
                     onclick="window.viewPlan('${p.id}')">
                     <i class="bi bi-eye"></i>
                  </button>
                  
                  <button class="btn icon mini master-action-btn complete" 
                     title="Complete Plan"
                     onclick="event.stopPropagation(); window.openCompletePlanModal('${p.id}', '${encodeURIComponent(JSON.stringify(p))}')">
                     <i class="bi bi-check-lg" style="font-weight:bold"></i>
                  </button>`;

            if (!isCompleted) {
              if (!isRunning) {
                // Play
                actionHtml += `
                    <button class="btn icon mini master-action-btn play" 
                       title="Activate Plan" 
                       onclick="event.stopPropagation(); window.forceActivatePlan('${p.id}', '${esc(p.orderNo || p.order_no || 'Unknown Order')}')">
                       <i class="bi bi-play-fill" style="transform:scale(1.2); margin-left:2px"></i>
                    </button>`;
              } else {
                // STOP Button (New)
                actionHtml += `
                    <button class="btn icon mini master-action-btn stop" 
                       title="Stop Plan" 
                       onclick="event.stopPropagation(); window.stopPlan('${p.id}')">
                       <i class="bi bi-stop-fill"></i>
                    </button>`;

                // Active Pulse
                actionHtml += `
                    <div class="master-action-pulse" title="Running">
                       <i class="bi bi-activity" style="color:#10b981; animation: pulse 2s infinite;"></i>
                    </div>`;
              }
            }

            // PERMANENT DELETE (Admin Only)
            if (window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.hasRole('admin')) {
              actionHtml += `
                <button class="btn icon mini master-action-btn delete" 
                   title="Delete Plan Permanently (Admin Only)" 
                   onclick="event.stopPropagation(); window.removePlan('${p.id}', '${esc(p.orderNo || p.order_no || 'Unknown Order')}')">
                   <i class="bi bi-trash"></i>
                </button>`;
            }

            const lineLabel = p.line ? String(p.line).replace(/^L/i, '') : '-';
            const productLabel = p.itemName || p.item_name || '-';
            const startLabel = p._rippledStartRaw
              ? p._rippledStartRaw.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
              : '-';
            const endLabel = calculatedEnd.replace(/\s\(\w+\)$/, '');

            row.innerHTML = `
               <div style="display:flex; justify-content:center; align-items:center;">
                  <input type="checkbox" style="width:18px; height:18px; cursor:pointer;" 
                     ${p.job_card_given ? 'checked' : ''} 
                     onclick="window.updateJCStatus('${p.id}', this.checked); event.stopPropagation();"
                     title="Mark Job Card as Given">
               </div>
               <div class="master-cell-stack">
                  <div class="master-cell-title is-wrap">${esc(p.machine)}</div>
                  <div class="master-machine-badges">
                     ${(p.building && String(p.building).toUpperCase() !== 'MAIN') ? `<span class="master-mini-chip">${esc(p.building)}</span>` : ''}
                     <span class="master-mini-chip">L${esc(lineLabel)}</span>
                  </div>
               </div>
               <div class="master-cell-stack compact">
                  <div class="master-cell-title is-mono is-wrap" title="${esc(p.orderNo)}">${esc(p.orderNo)}</div>
                  <div class="master-report-meta">
                    <span class="master-mini-chip master-priority-chip">${esc(p.priority || '-')}</span>
                  </div>
               </div>
                
               <div class="master-cell-stack compact" title="${esc(p.mouldName)}">
                  <div class="master-cell-title is-wrap">${esc(p.mouldName)}</div>
                  <div class="master-cell-sub is-wrap" title="${esc(productLabel)}">${esc(productLabel)}</div>
               </div>
               <div class="master-column-value is-mono">${esc(p.mouldNo || p.mould_code || '-')}</div>
               <div class="master-column-value" title="${esc(p.clientName)}">
                  <span class="master-cell-title is-wrap" style="font-size:0.92rem">${esc(p.clientName || '-')}</span>
               </div>
               <div class="master-column-value"><span class="master-value">${qty.toLocaleString()}</span></div>
               <div class="master-column-value"><span class="master-value warn">${bal.toLocaleString()}</span></div>
               <div class="master-column-value is-date">${startLabel}</div>
               <div class="master-column-value is-date">${endLabel}</div>
               <div class="master-column-value is-date expected">${expEnd}</div>
                
               <div class="master-badge-lane"><span class="${perfClass} master-stat-pill" title="Efficiency: ${perfPct}%">${perfPct}%</span></div>
                
               <div class="master-badge-lane"><span class="${sClass} master-stat-pill">${esc(p.status || 'Pending')}</span></div>
               <div class="master-actions">${actionHtml}
                 <button class="btn icon mini master-action-btn" title="Colour-wise completion"
                   onclick="event.stopPropagation(); window.toggleColourDetail('${p.id}', this)"
                   style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; border-radius:6px; padding:3px 7px; cursor:pointer; font-size:0.7rem; white-space:nowrap">
                   <i class="bi bi-palette"></i> Colours
                 </button>
               </div>
            `;
            tbody.appendChild(row);

            // Colour detail sub-row (hidden by default)
            const colourDetailRow = document.createElement('div');
            colourDetailRow.id = `colour-detail-${p.id}`;
            colourDetailRow.style.cssText = 'display:none; grid-column:1/-1; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:0 0 8px 8px; padding:12px 16px; margin-top:-4px';
            colourDetailRow.innerHTML = '<span style="color:#94a3b8; font-size:0.8rem">Loading...</span>';
            tbody.appendChild(colourDetailRow);
          });
        }

        // Toggle colour-wise detail expand under a Master Plan row
        window.toggleColourDetail = async function(planId, btn) {
          const row = document.getElementById('colour-detail-' + planId);
          if (!row) return;
          const isOpen = row.style.display !== 'none';
          if (isOpen) {
            row.style.display = 'none';
            if (btn) btn.style.background = '#f0fdf4';
            return;
          }
          row.style.display = 'block';
          if (btn) btn.style.background = '#bbf7d0';
          row.innerHTML = '<span style="color:#94a3b8; font-size:0.8rem">⏳ Loading colour data...</span>';
          try {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            const res = await api.get(`/planning/colour-wise-completion?planId=${encodeURIComponent(planId)}`);
            if (!res.ok || !res.data || !res.data.length) {
              row.innerHTML = '<span style="color:#94a3b8; font-size:0.8rem">No colour breakdown available for this plan.</span>';
              return;
            }
            const rows = res.data;
            const totalPlan = rows.reduce((s, r) => s + (r.planQty || 0), 0);
            const totalProd = rows.reduce((s, r) => s + (r.producedQty || 0), 0);
            const totalBal = rows.reduce((s, r) => s + (r.balQty || 0), 0);
            const colourRows = rows.map(r => {
              const pct = r.pct || 0;
              const barColor = pct >= 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
              return `<tr>
                <td style="padding:4px 10px; font-weight:600; font-size:0.82rem">${r.colour || '-'}</td>
                <td style="padding:4px 10px; text-align:right">${(r.planQty||0).toLocaleString()}</td>
                <td style="padding:4px 10px; text-align:right; color:#16a34a; font-weight:700">${(r.producedQty||0).toLocaleString()}</td>
                <td style="padding:4px 10px; text-align:right; color:${r.balQty > 0 ? '#dc2626' : '#16a34a'}">${(r.balQty||0).toLocaleString()}</td>
                <td style="padding:4px 10px">
                  <div style="display:flex; align-items:center; gap:6px">
                    <div style="flex:1; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden">
                      <div style="width:${Math.min(100,pct)}%; height:100%; background:${barColor}; border-radius:3px"></div>
                    </div>
                    <span style="font-size:0.75rem; font-weight:700; color:${barColor}; min-width:32px">${pct}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('');
            row.innerHTML = `
              <div style="font-size:0.78rem; font-weight:700; color:#166534; margin-bottom:8px">
                🎨 Colour-Wise Completion — Plan #${planId}
              </div>
              <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                <thead>
                  <tr style="background:#dcfce7">
                    <th style="padding:4px 10px; text-align:left; font-weight:700; color:#166534">Colour</th>
                    <th style="padding:4px 10px; text-align:right; color:#166534">Plan Qty</th>
                    <th style="padding:4px 10px; text-align:right; color:#166534">Produced</th>
                    <th style="padding:4px 10px; text-align:right; color:#166534">Balance</th>
                    <th style="padding:4px 10px; color:#166534">Progress</th>
                  </tr>
                </thead>
                <tbody>${colourRows}</tbody>
                <tfoot>
                  <tr style="border-top:2px solid #bbf7d0; font-weight:700">
                    <td style="padding:4px 10px">Total</td>
                    <td style="padding:4px 10px; text-align:right">${totalPlan.toLocaleString()}</td>
                    <td style="padding:4px 10px; text-align:right; color:#16a34a">${totalProd.toLocaleString()}</td>
                    <td style="padding:4px 10px; text-align:right; color:${totalBal > 0 ? '#dc2626' : '#16a34a'}">${totalBal.toLocaleString()}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>`;
          } catch (e) {
            row.innerHTML = `<span style="color:#dc2626; font-size:0.8rem">Error loading colour data: ${e.message}</span>`;
          }
        };

        function filterMasterPlan() {
          const b = '';
          const q = (document.getElementById('masterSearch')?.value || '').toLowerCase();

          const filtered = allMasterPlans.filter(p => {
            if (b && getPlanScopeValue(p) !== b) return false;
            if (q) {
              const text = `${p.machine} ${p.orderNo} ${p.itemName} ${p.mouldName} ${p.status} `.toLowerCase();
              if (!text.includes(q)) return false;
            }
            return true;
          });
          if (typeof syncMasterSearchUi === 'function') {
            syncMasterSearchUi(q ? filtered.length : null, allMasterPlans.length || filtered.length);
          }
          renderMasterTable(filtered);
        }

        // Removed nested activatePlan/removePlan to avoid scope issues





        // (Restored catch block for main init try wrapper)
      } catch (err) {
        console.error('Main Init Error:', err);
        if (typeof toast === 'function') toast('Init Error: ' + err.message, 'error');
      }

      if (window.JPSMS && window.JPSMS.ui) {
        window.JPSMS.ui.enableRowSelection('#masterTableBody', '.row');
        window.JPSMS.ui.enableRowSelection('#pmList', '.row');
      }

      // -------------------------------------------------------------
      // AUTO-OPEN PLAN LAUNCHER FROM URL ?order=...
      // -------------------------------------------------------------
      const urlParams = new URLSearchParams(window.location.search);
      const autoOrder = urlParams.get('order');
      if (autoOrder) {
        // Wait a tick for initiation
        setTimeout(() => {
          openCreatePlanLauncher();

          // Switch to Direct Tab
          const launcher = document.getElementById('createPlanLauncher');
          const directTab = launcher.querySelector('.tab[data-tab="direct"]');
          if (directTab) directTab.click();

          // Fill Search & Trigger
          const searchInput = launcher.querySelector('#directOrderSearch');
          if (searchInput) {
            searchInput.value = autoOrder;
            searchInput.dispatchEvent(new Event('input')); // Trigger filter
          }
          toast('Pre-filtering for Order: ' + autoOrder);
        }, 800);
      }


      /* ==========================================================================================
         ADVANCED MOULD PLANNING FEATURES (Alternatives & Batch)
         ========================================================================================== */

      window.updateJCStatus = async function (id, checked) {
        console.log('[JC Update] Sending:', { id, checked });
        try {
          // Use global JPSMS.api to avoid scope issues
          const client = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : api;
          await client.post('/planning/set-jc', { planId: id, status: checked });
          toast('JC Status Updated');
        } catch (e) {
          console.error('[JC Update Error]', e);
          toast('Failed: ' + e.message, 'error');
        }
      };

      // --- 1. Find Alternative Moulds ---
      window.findAlternativeMoulds = async function (input, currentMould, planQty) {
        const payload = (input && typeof input === 'object' && !Array.isArray(input))
          ? input
          : { mouldNo: input, mouldName: currentMould, planQty };
        const orderNo = payload.orderNo || (window.cpSelectedOrder ? window.cpSelectedOrder.orderNo : '');
        const orDate = payload.orDate || (window.cpSelectedOrder ? window.cpSelectedOrder.orDate : '');
        const mouldNo = payload.mouldNo || payload.itemCode || '';
        const mouldName = payload.mouldName || currentMould || '';
        const qtyToUse = payload.planQty != null ? payload.planQty : planQty;
        const mouldFamily = String(mouldNo || payload.itemCode || '').trim().replace(/\s+\d+$/, '').trim();

        // Self-Healing: Force remove old modal to ensure fresh state/Z-index
        const oldModal = document.getElementById('altMouldModal');
        if (oldModal) oldModal.remove();

        // Nuclear Option: Inline Styles for Wrapper
        const markup = `
        <div id="altMouldModal" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px)">
            <div style="background:white; padding:24px; border-radius:12px; width:600px; max-width:90%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25)">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-shrink:0">
                  <strong style="font-size:1.1rem; color:#0f172a"><i class="bi bi-shuffle"></i> Alternative Moulds</strong>
                  <button class="btn icon ghost" onclick="document.getElementById('altMouldModal').remove()"><i class="bi bi-x-lg"></i></button>
              </div>
              <div id="altMouldList" style="overflow-y:auto; flex:1"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', markup);

        const list = document.getElementById('altMouldList');
        if (!list) return;

        list.innerHTML = '<div class="muted" style="padding:20px; text-align:center">Loading alternatives...</div>';

        try {
          const orderRows = Array.isArray(window.cpOrderMoulds) ? window.cpOrderMoulds : [];
          const localMap = new Map();
          if (mouldFamily) {
            orderRows.forEach(row => {
              const rowCode = String(row.mould_no || row.item_code || row.mould_code || '').trim();
              const rowFamily = rowCode.replace(/\s+\d+$/, '').trim();
              if (!rowCode || rowFamily !== mouldFamily) return;
              if (localMap.has(rowCode)) return;
              localMap.set(rowCode, {
                mould_name: row.mould_name || row.product_name,
                mould_no: rowCode,
                item_code: rowCode,
                product_name: row.product_name || row.mould_name,
                no_of_cavity: row.masterCavity || row.no_of_cavity || row.reportCavity,
                cycle_time: row.masterCycleTime || row.cycle_time || row.reportCycleTime,
                machine_tonnage: row.masterMachineRaw || row.machine_tonnage || row.reportTonnage,
                primary_machine: row.primary_machine || null,
                secondary_machine: row.secondary_machine || null,
                is_current: rowCode === String(mouldNo || '').trim()
              });
            });
          }

          let rows = Array.from(localMap.values());
          rows.sort((a, b) => {
            if (!!a.is_current !== !!b.is_current) return a.is_current ? -1 : 1;
            const aNum = Number((String(a.mould_no || '').match(/\s+(\d+)$/) || [])[1] || 0);
            const bNum = Number((String(b.mould_no || '').match(/\s+(\d+)$/) || [])[1] || 0);
            if (aNum !== bNum) return aNum - bNum;
            return String(a.mould_no || '').localeCompare(String(b.mould_no || ''), undefined, { numeric: true, sensitivity: 'base' });
          });

          if (!rows.length) {
            const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);
            if (!$api) throw new Error('API client not initialized');

            const params = new URLSearchParams();
            if (orderNo) params.set('orderNo', orderNo);
            if (orDate) params.set('orDate', orDate);
            if (mouldNo) params.set('mouldNo', mouldNo);
            if (payload.itemCode || mouldNo) params.set('itemCode', payload.itemCode || mouldNo);
            if (mouldName) params.set('currentMould', mouldName);

            const res = await $api.get(`/planning/moulds/alternatives?${params.toString()}`);
            rows = res.data || [];
          }

          if (!rows.length) {
            list.innerHTML = '<div class="muted" style="padding:20px; text-align:center">No alternative moulds were found for this order.</div>';
            return;
          }

          list.innerHTML = '';
          rows.forEach(m => {
            const el = document.createElement('div');
            el.className = 'row';
            el.style.border = m.is_current ? '1px solid rgba(37, 99, 235, 0.28)' : '1px solid #e2e8f0';
            el.style.borderRadius = '14px';
            el.style.padding = '14px 16px';
            el.style.marginBottom = '10px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.background = m.is_current ? 'linear-gradient(180deg, #f3f7ff, #eef4ff)' : '#ffffff';

            el.innerHTML = `
            <div style="flex:1">
              <div style="font-weight:600; font-size:15px; margin-bottom:4px; color:#1e293b">
                ${esc(m.mould_name || m.product_name)}
                ${m.is_current ? '<span style="display:inline-flex; align-items:center; gap:4px; margin-left:8px; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; color:#1d4ed8; background:#dbeafe">Current</span>' : ''}
              </div>
              <div class="mini">
                 <span style="font-family:monospace; background:#e2e8f0; padding:2px 4px; border-radius:4px; margin-right:6px">
                   ${esc(m.mould_no || m.item_code || m.mould_id || '-')}
                 </span>
                Cav: ${esc(m.no_of_cavity)} • Tonnage: ${esc(m.machine_tonnage || '-')}
              </div>
            </div>
            <div style="width:100px; text-align:right; margin-right:16px">
              <div style="font-weight:700">${esc(m.cycle_time)}s</div>
              <div class="mini">Cycle Time</div>
            </div>
            <button class="btn mini btn-primary">Select</button>
          `;

            // Safe click binding
            el.querySelector('button').onclick = () => {
              // Map to CP Mould Format
              const adapted = {
                mould_name: m.mould_name || m.product_name,
                mould_no: m.mould_no || m.item_code || mouldNo,
                item_code: m.mould_no || m.item_code || mouldNo,
                mould_code: m.mould_no || m.item_code || mouldNo,
                product_name: m.product_name,
                no_of_cavity: m.no_of_cavity,
                cycle_time: m.cycle_time,
                machine: m.machine_tonnage,
                masterMachineRaw: m.machine_tonnage,
                masterCavity: m.no_of_cavity,
                masterCycleTime: m.cycle_time,
                plan_qty: qtyToUse
              };

              if (typeof selectCpMould === 'function') {
                selectCpMould(adapted);
                document.getElementById('altMouldModal').remove();
              } else {
                console.error('selectCpMould function missing!');
                toast('Error: Cannot select mould. Logic missing.', 'error');
              }
            };
            list.appendChild(el);
          });
        } catch (e) {
          list.innerHTML = `<div class="error" style="padding:20px">${esc(e.message)}</div>`;
        }
      };

      // --- 2. Job Planning ---
      window._batchOrdersCache = {};
      // --- 2. Job Planning ---
      window.openBatchPlanning = async function (itemCode, mouldName, planQty) {
        const oldModal = document.getElementById('batchPlanModal');
        if (oldModal) oldModal.remove();

        const markup = `
            <div id="batchPlanModal" class="modal show" aria-hidden="false" style="display:flex;">
                <div class="modal-card" style="width:1150px; max-width:98vw; height:90vh; display:flex; flex-direction:column;">
                  <div class="modal-head">
                    <div>
                      <strong><i class="bi bi-collection"></i> Job Planning</strong>
                      <div class="mini muted">Schedule multiple orders in one go</div>
                    </div>
                    <button class="btn icon ghost" onclick="document.getElementById('batchPlanModal').remove()"><i class="bi bi-x-lg"></i></button>
                  </div>
                  
                  <div style="padding:12px 14px; background:#f8fafc; border-bottom:1px solid var(--border); display:flex; gap:32px; font-size:0.9rem; align-items:center">
                     <div>
                        <div class="mini muted">Mould Name</div>
                        <strong id="bpMouldName" style="color:#0f172a">...</strong>
                     </div>
                     <div>
                        <div class="mini muted">Mould No</div>
                        <strong id="bpMouldNo" style="color:#0be881">...</strong>
                     </div>
                     <div>
                        <div class="mini muted">Item Code</div>
                        <strong id="bpItemCode" style="color:#0f172a">...</strong>
                     </div>
                     <div style="margin-left:auto; display:flex; align-items:center; gap:8px">
                        <span class="badge" style="background:#e0f2fe; color:#0369a1" id="bpTonnageBadge">...</span>
                     </div>
                  </div>

                  <div class="list" style="border:none; border-radius:0; flex:1; overflow:hidden; display:flex; flex-direction:column">
                     <!-- Header -->
                     <div class="row h" style="grid-template-columns: 40px 80px 140px 180px 100px 100px 1fr; padding:10px 14px">
                        <div style="text-align:center"><input type="checkbox" id="bpCheckAll" onclick="window.toggleBpAll(this)"></div>
                        <div>Priority</div>
                        <div>Order No</div>
                        <div>Client</div>
                        <div>OR Date</div>
                        <div style="text-align:right">Qty</div>
                        <div>Assign Machine</div>
                     </div>
                     <!-- Rows -->
                     <div id="bpRows" style="overflow-y:auto; flex:1; background:#fff"></div>
                  </div>

                  <div class="modal-actions">
                     <button class="btn" onclick="document.getElementById('batchPlanModal').remove()">Cancel</button>
                     <button class="btn btn-primary" onclick="commitBatchPlan()" id="bpCommitBtn">Plan Selected (0)</button>
                  </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', markup);

        const elName = document.getElementById('bpMouldName');
        const elNo = document.getElementById('bpMouldNo');
        const elItem = document.getElementById('bpItemCode');
        const elRows = document.getElementById('bpRows');
        const elBadge = document.getElementById('bpTonnageBadge');

        if (elName) elName.textContent = mouldName;
        if (elItem) elItem.textContent = itemCode;
        if (elRows) elRows.innerHTML = '<div class="muted" style="padding:40px; text-align:center"><span class="spinner-border spinner-border-sm"></span> Loading matching orders...</div>';

        // Global for commit
        window.bpTargetMould = { itemCode, mouldName, planQty };

        try {
          const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);
          if (!$api) throw new Error('API client not initialized');

          const [machRes, ordRes] = await Promise.all([
            $api.get('/masters/machines'),
            $api.get(`/planning/orders/matching?itemCode=${encodeURIComponent(itemCode)}`)
          ]);

          const machines = machRes.data || [];
          const orders = ordRes.data || [];

          if (!orders.length) {
            if (elRows) elRows.innerHTML = '<div class="muted" style="padding:40px; text-align:center; font-style:italic">No matching pending orders found.</div>';
            return;
          }

          // Extract Extra Info from first order (since query returns joined data)
          const first = orders[0];
          const mouldNo = first.mould_no || '-';
          const requiredTonnage = first.required_tonnage || null;

          if (elNo) elNo.textContent = mouldNo;

          let tonnageLabel = 'Any Tonnage';
          if (requiredTonnage) {
            tonnageLabel = `Req: ${requiredTonnage}`;
            if (elBadge) elBadge.textContent = tonnageLabel;
          }

          window.renderBatchGrid(orders, machines, requiredTonnage);

        } catch (e) {
          console.error(e);
          if (elRows) elRows.innerHTML = `<div class="error" style="padding:20px">Error: ${e.message}</div>`;
        }
      };

      window.renderBatchGrid = function (orders, machines, requiredTonnage) {
        const con = document.getElementById('bpRows');
        con.innerHTML = '';

        if (!orders.length) return;

        window._batchOrdersCache = {};
        orders.forEach(o => window._batchOrdersCache[o.id] = o);

        // Filter Machines by Tonnage (if required)
        let compatibleMachines = machines;

        if (requiredTonnage) {
          compatibleMachines = machines.filter(m => {
            if (!m.tonnage) return false;
            // Fuzzy Match numbers
            const mT = String(m.tonnage).replace(/[^0-9]/g, '');
            const rT = String(requiredTonnage).replace(/[^0-9]/g, '');
            return mT === rT;
          });
        }

        const machOpts = compatibleMachines
          .filter(m => m.is_active !== false && m.is_active !== 'false')
          .sort((a, b) => String(a.machine || '').localeCompare(String(b.machine || ''), undefined, { numeric: true }))
          .map(m => `<option value="${m.machine}">${m.machine}</option>`)
          .join('');

        const noMachOpts = `<option value="" disabled>No ${requiredTonnage || ''} machines</option>`;

        orders.forEach(o => {
          const row = document.createElement('div');
          row.className = 'row bp-row';
          // Match Header Grid Template
          row.style.gridTemplateColumns = '40px 80px 140px 180px 100px 100px 1fr';
          row.style.alignItems = 'center';
          row.style.padding = '8px 14px';
          row.style.borderBottom = '1px solid #f1f5f9';

          // Format OR Date
          let dateStr = '-';
          if (o.or_date) {
            const d = new Date(o.or_date);
            if (!isNaN(d.getTime())) {
              dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
            }
          }

          // Priority Tag
          const priClass = (o.priority === 'Urgent' ? 'Urgent' : o.priority === 'High' ? 'High' : 'Normal');

          row.innerHTML = `
          <div style="text-align:center"><input type="checkbox" class="bp-chk" data-oid="${o.id}"></div>
          <div><span class="tag ${priClass}" style="transform:scale(0.9); transform-origin:left">${esc(o.priority)}</span></div>
          <div style="font-family:monospace; font-weight:600; color:#334155">${esc(o.order_no)}</div>
          <div style="font-size:0.85rem; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${esc(o.client_name)}">${esc(o.client_name || '-')}</div>
          <div style="font-size:0.85rem; color:#64748b">${dateStr}</div>
          <div style="font-family:monospace; text-align:right; font-weight:600">${Number(o.qty).toLocaleString()}</div>
          <div>
            <select class="bp-mach input" style="width:100%; padding:6px; font-size:0.9rem">
              <option value="">Select Machine...</option>
              ${machOpts || noMachOpts}
            </select>
          </div>
        `;
          con.appendChild(row);
        });

        con.querySelectorAll('.bp-chk').forEach(c => c.onchange = window.updateBpSummary);
        window.updateBpSummary();
      }

      window.toggleBpAll = function (el) {
        document.querySelectorAll('.bp-chk').forEach(c => c.checked = el.checked);
        window.updateBpSummary();
      };

      window.updateBpSummary = function () {
        const n = document.querySelectorAll('.bp-chk:checked').length;
        const btn = document.getElementById('bpCommitBtn');
        if (btn) {
          btn.textContent = `Plan Selected (${n})`;
          btn.disabled = (n === 0);
        }
      };

      window.commitBatchPlan = async function () {
        const rows = document.querySelectorAll('.bp-row');
        const plans = [];
        let error = false;

        if (!window._batchOrdersCache) window._batchOrdersCache = {};

        rows.forEach(r => {
          const chk = r.querySelector('.bp-chk');
          if (chk && chk.checked) {
            const sel = r.querySelector('.bp-mach');
            const mach = sel.value;
            const oid = chk.dataset.oid;
            const order = window._batchOrdersCache[oid];

            if (!mach) {
              sel.style.borderColor = 'red';
              error = true;
            } else if (order) {
              plans.push({ order, mach });
            }
          }
        });

        if (error) return toast('Please select a machine for all checked orders', 'error');
        if (!plans.length) return toast('No orders selected', 'error');

        if (!confirm(`Create plans for ${plans.length} orders?`)) return;

        const btn = document.getElementById('bpCommitBtn');
        btn.disabled = true;
        btn.innerHTML = 'Creating...';

        try {
          for (const p of plans) {
            const payload = {
              plant: (localStorage.getItem('jpsms_factory_id') == '2' ? 'SHIVANI' : 'DUNGRA'),
              machine: p.mach,
              orderNo: p.order.order_no,
              itemCode: bpTargetMould.itemCode, // closure var
              itemName: p.order.client_name || 'Item',
              mouldName: bpTargetMould.mouldName,
              planQty: p.order.qty,
              balQty: p.order.qty,
              startDate: new Date().toISOString()
            };
            const $api = (typeof api !== 'undefined') ? api : (window.JPSMS && window.JPSMS.api);
            if (!$api) throw new Error('API client not initialized');

            await $api.post('/planning/create', payload);
          }
          toast('Job plans created!');
          document.getElementById('batchPlanModal').remove();
          loadMasterPlan();
          loadKpIs();
        } catch (e) {
          console.error(e);
          toast(e.message, 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = 'Plan Selected'; }
        }
      };


      // -------------------------------------------------------------
      // DROP MOULD HANDLER
      // -------------------------------------------------------------
      window.dropCpMould = async function (mould) {
        if (!window.cpSelectedOrder) return toast('No Order Context', 'error');

        const remark = prompt(`Drop ${mould.mould_name}?\nEnter Remarks completely:`);
        if (remark === null) return; // Cancelled
        if (!remark.trim()) return toast('Remark is required to drop', 'error');

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const res = await api.post('/planning/drop', {
            orderNo: window.cpSelectedOrder.orderNo,
            itemCode: mould.item_code,
            mouldNo: mould.mould_no,
            mouldName: mould.mould_name,
            remarks: remark
          });

          if (res.ok || res.data?.ok) {
            toast('Mould Dropped Successfully');
            loadCpOrders();
            selectCpOrder(cpSelectedOrder, null);
          } else {
            toast('Failed: ' + (res.error || 'Unknown'), 'error');
          }
        } catch (e) {
          console.error(e);
          toast(e.message, 'error');
        }
      };

      // -------------------------------------------------------------
      // UNDROP MOULD HANDLER
      // -------------------------------------------------------------
      window.undropCpMould = async function (mould) {
        if (!window.cpSelectedOrder) return toast('No Order Context', 'error');

        if (!confirm(`Are you sure you want to Undrop this mould family for order ${window.cpSelectedOrder.orderNo}?`)) return;

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const res = await api.post('/planning/undrop', {
            orderNo: window.cpSelectedOrder.orderNo,
            mouldNo: mould.mould_no || mould.item_code,
            mouldName: mould.mould_name
          });

          if (res.ok || res.data?.ok) {
            toast('Mould Restored to Plan Successfully');
            loadCpOrders();
            selectCpOrder(cpSelectedOrder, null);
          } else {
            toast('Failed: ' + (res.error || 'Unknown'), 'error');
          }
        } catch (e) {
          console.error(e);
          toast(e.message, 'error');
        }
      };

      // -------------------------------------------------------------
      // COMPLETED PLANS VIEW
      // -------------------------------------------------------------
      window.loadCompletedPlans = async function () {
        const main = document.querySelector('.main-content');
        // We reuse main-content or whatever container the other views use
        // Assuming simpler replacement for now as per app pattern

        main.innerHTML = `
            <div style="padding:20px; max-width:1200px; margin:0 auto">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px">
                    <h2 style="font-size:1.5rem; font-weight:700; color:#0f172a"><i class="bi bi-check-circle-fill" style="color:#22c55e"></i> Completed Plans</h2>
                    <button class="btn" onclick="window.location.reload()"><i class="bi bi-arrow-left"></i> Back to Board</button>
                </div>
                <div id="completedReportCon">Loading...</div>
            </div>
         `;
        // Note: Reload is a bit harsh for Back, maybe loadMasterPlan() is better but 'window.view' state handling is complex.
        // Let's try loadMasterPlan() if available.

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const res = await api.get('/planning/completed?mode=hierarchical');
          window.renderCompletedPlans(res.data || []);
        } catch (e) {
          document.getElementById('completedReportCon').innerHTML = `<div class="error">Failed to load: ${esc(e.message)}</div>`;
        }
      };

      window.renderCompletedPlans = function (reports) {
        const con = document.getElementById('completedReportCon');
        if (!reports.length) {
          con.innerHTML = '<div class="muted" style="text-align:center; padding:40px; background:#f8fafc; border-radius:12px">No fully completed plans yet.</div>';
          return;
        }

        con.innerHTML = '';

        reports.forEach(rpt => {
          const h = rpt.header;
          const rows = rpt.rows;

          const card = document.createElement('div');
          card.style.background = '#fff';
          card.style.borderRadius = '12px';
          card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
          card.style.border = '1px solid #e2e8f0';
          card.style.marginBottom = '24px';
          card.style.overflow = 'hidden';

          const dateStr = h.completedAt ? new Date(h.completedAt).toLocaleString() : '-';

          card.innerHTML = `
                 <div style="padding:16px 24px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center">
                     <div>
                        <div style="font-weight:700; font-size:1.1rem; color:#0f172a; display:flex; gap:12px; align-items:center">
                            ${esc(h.orderNo)} 
                            <span class="tag g">Fully Planned</span>
                        </div>
                        <div style="font-size:0.9rem; color:#64748b; margin-top:4px">
                            ${esc(h.product)} • <span style="font-weight:600">${h.totalMoulds} Moulds</span>
                        </div>
                     </div>
                     <div style="text-align:right">
                         <div style="font-size:0.85rem; color:#94a3b8; display:none">Transfer Date</div>
                         <div style="font-weight:600; color:#334155">${dateStr}</div>
                         
                         ${(window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.hasRole('admin'))
              ? `<div style="margin-top:8px">
                                <button class="btn mini" onclick="window.restorePlan('${h.orderNo}')" style="background:#fff; border:1px solid #cbd5e1; color:#475569">
                                    <i class="bi bi-arrow-counterclockwise"></i> Restore (Admin)
                                </button>
                              </div>`
              : ''
            }
                     </div>
                 </div>
                 
                 <div style="overflow-x:auto">
                    <table style="width:100%; border-collapse:collapse; font-size:0.9rem">
                        <thead>
                            <tr style="background:#f8fafc; color:#64748b; text-align:left">
                                <th style="padding:10px 24px; font-weight:600">Mould Name / No</th>
                                <th style="padding:10px 12px; font-weight:600">Machine</th>
                                <th style="padding:10px 12px; font-weight:600">Status</th>
                                <th style="padding:10px 12px; font-weight:600">User</th>
                                <th style="padding:10px 24px; font-weight:600; text-align:right">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => {
              const isDrop = r.type === 'Dropped';
              const stClass = isDrop ? 'r' : 'b';
              return `
                                    <tr style="border-bottom:1px solid #f1f5f9">
                                        <td style="padding:12px 24px; color:#334155; font-weight:500">
                                            ${esc(r.mould_name)}
                                            <div style="font-size:0.75rem; color:#94a3b8; font-family:monospace">${esc(r.mould_code || '-')}</div>
                                            ${isDrop && r.remarks ? `<div style="font-size:0.75rem; color:#dc2626; margin-top:2px">Remark: ${esc(r.remarks)}</div>` : ''}
                                        </td>
                                        <td style="padding:12px 12px; color:#475569">${esc(r.machine)}</td>
                                        <td style="padding:12px 12px">
                                            <span class="tag ${stClass}">${esc(r.type)}</span>
                                        </td>
                                        <td style="padding:12px 12px; color:#64748b">${esc(r.user_name || 'System')}</td>
                                        <td style="padding:12px 24px; text-align:right; color:#94a3b8; font-size:0.85rem">
                                            ${new Date(r.time).toLocaleString()}
                                        </td>
                                    </tr>
                                `;
            }).join('')}
                        </tbody>
                    </table>
                 </div>
              `;
          con.appendChild(card);
        });
      };

      window.restorePlan = async function (orderNo) {
        if (!confirm('Restore this Order back to Pending List? Plans will remain attached.')) return;
        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          const res = await api.post('/planning/restore', { orderNo });
          if (res.ok || (res.data && res.data.ok)) {
            toast('Order Restored');
            window.loadCompletedPlans();
          } else {
            toast('Restore Failed', 'error');
          }
        } catch (e) {
          toast('Error: ' + e.message, 'error');
        }
      };


      /* --- Print Job Card Logic --- */
      window.pjcLocalYmd = function (d) {
        const x = d instanceof Date ? d : new Date();
        const y = x.getFullYear();
        const m = String(x.getMonth() + 1).padStart(2, '0');
        const day = String(x.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      window.setPjcToday = function () {
        const t = window.pjcLocalYmd(new Date());
        const a = document.getElementById('pjcFrom');
        const b = document.getElementById('pjcTo');
        if (a) a.value = t;
        if (b) b.value = t;
        const c = document.getElementById('pjcShowAllJC');
        if (c) c.checked = false;
        if (typeof window.syncPjcToolbarState === 'function') window.syncPjcToolbarState();
        window.loadPrintJobCards();
      };

      window.syncPjcToolbarState = function () {
        const showAll = !!(document.getElementById('pjcShowAllJC') && document.getElementById('pjcShowAllJC').checked);
        const dateWrap = document.getElementById('pjcDateRangeWrap');
        const toggleWrap = document.getElementById('pjcShowAllWrap');
        ['pjcFrom', 'pjcTo'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.disabled = showAll;
        });
        if (dateWrap) {
          dateWrap.style.opacity = showAll ? '.45' : '1';
          dateWrap.style.filter = showAll ? 'grayscale(.25)' : 'none';
        }
        if (toggleWrap) {
          toggleWrap.style.background = showAll ? '#ecfeff' : '#fff7ed';
          toggleWrap.style.color = showAll ? '#075985' : '#9a3412';
          toggleWrap.style.borderColor = showAll ? '#67e8f9' : '#fed7aa';
          toggleWrap.style.boxShadow = showAll ? '0 10px 24px rgba(14,165,233,.18)' : '0 8px 20px rgba(249,115,22,.10)';
        }
      };

      window.loadPrintJobCards = async function () {
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const escAttr = (s) => esc(s).replace(/'/g, '&#39;');
        const con = document.getElementById('printJCList');
        if (!con) return console.error('printJCList not found');

        con.innerHTML = '<div style="padding:40px; text-align:center"><div class="spinner-border text-primary" role="status"></div><div style="margin-top:10px; color:#64748b">Loading…</div></div>';

        const search = document.getElementById('printJCSearch') ? document.getElementById('printJCSearch').value : '';
        const from = document.getElementById('pjcFrom') ? document.getElementById('pjcFrom').value : '';
        const to = document.getElementById('pjcTo') ? document.getElementById('pjcTo').value : '';
        const showAllJc = document.getElementById('pjcShowAllJC') && document.getElementById('pjcShowAllJC').checked;

        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          let rows = [];

          if (showAllJc) {
            let url = '/planning/print-jc-plans?limit=500';
            if (search) url += '&search=' + encodeURIComponent(search);
            const res = await api.get(url);
            rows = (res && res.data) || [];
          } else {
            let url = '/planning/print-jc-plans?limit=500';
            if (search) url += '&search=' + encodeURIComponent(search);
            if (from) url += '&from=' + encodeURIComponent(from);
            if (to) url += '&to=' + encodeURIComponent(to);
            const res = await api.get(url);
            rows = (res && res.data) || [];
          }

          const renderMasterRows = false;

          if (!rows.length) {
            con.innerHTML = '<div class="muted" style="padding:40px; text-align:center; background:#f8fafc; border-radius:8px; border:1px dashed #cbd5e1">No rows match. Adjust the date or search, or use “Show all Job Cards”.</div>';
            return;
          }

          const byDate = new Map();
          rows.forEach((r) => {
            const dk = renderMasterRows
              ? (r.plan_date ? String(r.plan_date).slice(0, 10) : '—')
              : (r.plan_day ? String(r.plan_day).slice(0, 10) : '—');
            if (!byDate.has(dk)) byDate.set(dk, []);
            byDate.get(dk).push(r);
          });
          const dateKeys = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

          let html = '';
          dateKeys.forEach((dk) => {
            const label = dk === '—' ? 'Date N/A' : new Date(dk + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            html += `<div style="margin:16px 0 8px; font-weight:900; color:#92400e; font-size:0.9rem; letter-spacing:.04em; text-transform:uppercase">${esc(label)}</div>`;
            html += (byDate.get(dk) || []).map((r) => {
              if (renderMasterRows) {
                const jc = r.jc_no || '-';
                const or = r.or_jr_no || '-';
                const mld = r.mould_no || '-';
                const date = r.plan_date ? new Date(r.plan_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
                const client = r.client_name || '-';
                const items = r.item_count || 0;
                return `
                     <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:16px 20px; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 1px 2px rgba(0,0,0,0.03); margin-bottom:10px">
                         <div style="display:flex; gap:20px; align-items:center; flex:1; flex-wrap:wrap">
                             <div style="min-width:120px; font-weight:700; color:#0f172a; font-family:monospace; background:#f1f5f9; padding:6px 10px; border-radius:6px; text-align:center; border:1px solid #e2e8f0">${esc(jc)}</div>
                             <div style="display:flex; flex-direction:column; gap:2px; min-width:120px">
                                 <div style="font-size:0.75rem; color:#94a3b8; font-weight:600; text-transform:uppercase">OR No</div>
                                 <div style="color:#334155; font-family:monospace; font-weight:600">${esc(or)}</div>
                             </div>
                             <div style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:160px">
                                 <div style="font-size:0.75rem; color:#94a3b8; font-weight:600; text-transform:uppercase">Product / Mould</div>
                                 <div style="color:#1e293b; font-weight:600; font-size:0.95rem">${esc(r.product_name || mld)}</div>
                             </div>
                             <div style="display:flex; flex-direction:column; gap:2px; min-width:120px">
                                 <div style="font-size:0.75rem; color:#94a3b8; font-weight:600; text-transform:uppercase">Client</div>
                                 <div style="color:#64748b; font-size:0.9rem">${esc(client)}</div>
                             </div>
                             <div style="display:flex; flex-direction:column; gap:2px; width:90px">
                                 <div style="font-size:0.75rem; color:#94a3b8; font-weight:600; text-transform:uppercase">Date</div>
                                 <div style="color:#64748b; font-size:0.9rem">${date}</div>
                             </div>
                             <div style="font-size:0.8rem; color:#94a3b8; background:#f8fafc; padding:4px 8px; border-radius:20px; border:1px solid #e2e8f0">${items} Items</div>
                         </div>
                         <div style="padding-left:16px; border-left:1px solid #f1f5f9; display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end">
                             <button type="button" class="btn" onclick="window.printJobLabels('${escAttr(or)}', '${escAttr(jc)}')" style="padding:8px 14px; font-size:0.88rem; display:flex; gap:6px; align-items:center; background:#ecfeff; color:#075985; border-color:#67e8f9; font-weight:900">
                                <i class="bi bi-qr-code"></i> Print Label
                             </button>
                             <button type="button" class="btn" onclick="window.showJobCardLabelLog('${escAttr(or)}', '${escAttr(jc)}')" style="padding:8px 14px; font-size:0.88rem; display:flex; gap:6px; align-items:center; background:#f8fafc; color:#334155; border-color:#cbd5e1; font-weight:900">
                                <i class="bi bi-clock-history"></i> Label Log
                             </button>
                             <button type="button" class="btn primary" onclick="window.printJobCard('${escAttr(or)}', '${escAttr(jc)}')" style="padding:8px 16px; font-size:0.9rem; display:flex; gap:6px; align-items:center; background:#b45309; border-color:#b45309">
                                <i class="bi bi-printer-fill"></i> Print Job Card
                             </button>
                         </div>
                     </div>`;
              }
              const or = r.order_no || '-';
              const batch = r.our_code || '-';
              const pid = r.plan_id || '-';
              const mld = r.mould_name || r.mould_code || '-';
              const mach = r.machine || '-';
              const jcR = r.resolved_jc_no || '';
              const jcD = r.resolved_jc_date ? new Date(r.resolved_jc_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
              const linkOk = !!r.jc_linked;
              const warn = linkOk ? '' : `<span style="color:#b45309; font-size:0.78rem; font-weight:700">Link: add <strong>${esc(batch)}</strong> or <strong>${esc(pid)}</strong> to OR–JR Remarks</span>`;
              const printDisabled = !linkOk ? 'disabled' : '';
              return `
                     <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:16px 20px; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 1px 2px rgba(0,0,0,0.03); margin-bottom:10px">
                         <div style="display:flex; gap:16px; align-items:center; flex:1; flex-wrap:wrap">
                             <div style="min-width:130px; font-weight:800; color:#0f172a; font-family:monospace; background:#eff6ff; padding:6px 10px; border-radius:6px; border:1px solid #bfdbfe">${esc(batch)}</div>
                             <div style="display:flex; flex-direction:column; gap:2px; min-width:120px">
                                 <div style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase">OR</div>
                                 <div style="font-family:monospace; font-weight:700">${esc(or)}</div>
                             </div>
                             <div style="display:flex; flex-direction:column; gap:2px; min-width:160px; flex:1">
                                 <div style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase">Mould / Machine</div>
                                 <div style="font-weight:700; color:#1e293b">${esc(mld)}</div>
                                 <div style="font-size:0.82rem; color:#64748b">${esc(mach)}</div>
                             </div>
                             <div style="display:flex; flex-direction:column; gap:2px; min-width:110px">
                                 <div style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase">JC No / Date</div>
                                 <div style="font-weight:800; color:${linkOk ? '#166534' : '#94a3b8'}">${esc(jcR || '—')}</div>
                                 <div style="font-size:0.82rem">${esc(jcD)}</div>
                             </div>
                             <div style="min-width:200px">${warn}</div>
                         </div>
                         <div style="padding-left:16px; border-left:1px solid #f1f5f9; display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end">
                             <button type="button" class="btn" ${printDisabled} onclick="window.printJobLabels('${escAttr(or)}', '${escAttr(jcR)}', { planId: '${escAttr(pid)}', ourCode: '${escAttr(batch)}' })" style="padding:8px 14px; font-size:0.88rem; display:flex; gap:6px; align-items:center; background:#ecfeff; color:#075985; border-color:#67e8f9; font-weight:900">
                                <i class="bi bi-qr-code"></i> Print Label
                             </button>
                             <button type="button" class="btn" onclick="window.showJobCardLabelLog('${escAttr(or)}', '${escAttr(jcR)}', { planId: '${escAttr(pid)}', ourCode: '${escAttr(batch)}' })" style="padding:8px 14px; font-size:0.88rem; display:flex; gap:6px; align-items:center; background:#f8fafc; color:#334155; border-color:#cbd5e1; font-weight:900">
                                <i class="bi bi-clock-history"></i> Label Log
                             </button>
                             <button type="button" class="btn primary" ${printDisabled} onclick="window.printJobCard('${escAttr(or)}', '${escAttr(jcR)}', { planId: '${escAttr(pid)}', ourCode: '${escAttr(batch)}' })" style="padding:8px 16px; font-size:0.9rem; display:flex; gap:6px; align-items:center; background:#b45309; border-color:#b45309">
                                <i class="bi bi-printer-fill"></i> Print Job Card
                             </button>
                         </div>
                     </div>`;
            }).join('');
          });

          con.innerHTML = html;

        } catch (e) {
          console.error(e);
          con.innerHTML = `<div class="error" style="color:#ef4444; background:#fef2f2; padding:20px; text-align:center; border-radius:8px">Error: ${esc(e.message)}</div>`;
        }
      };

      const _pjcSearchEl = document.getElementById('printJCSearch');
      if (_pjcSearchEl) {
        _pjcSearchEl.addEventListener('change', window.loadPrintJobCards);
        let _pjcSearchTimer = null;
        _pjcSearchEl.addEventListener('input', () => {
          clearTimeout(_pjcSearchTimer);
          _pjcSearchTimer = setTimeout(() => window.loadPrintJobCards(), 350);
        });
        _pjcSearchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.loadPrintJobCards(); });
      }
      ['pjcFrom', 'pjcTo', 'pjcShowAllJC'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
          if (typeof window.syncPjcToolbarState === 'function') window.syncPjcToolbarState();
          window.loadPrintJobCards();
        });
      });
      if (typeof window.syncPjcToolbarState === 'function') window.syncPjcToolbarState();

      window.getJobCardPrintPayload = async function (or, jc, opts) {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        const o = opts && typeof opts === 'object' ? opts : {};
        let q = `or_jr_no=${encodeURIComponent(or)}`;
        if (jc) q += `&jc_no=${encodeURIComponent(jc)}`;
        if (o.planId) q += `&plan_id=${encodeURIComponent(o.planId)}`;
        if (o.ourCode) q += `&our_code=${encodeURIComponent(o.ourCode)}`;
        const res = await api.get(`/planning/job-card-print?${q}`);
        if (!res.ok) throw new Error(res.error || 'Failed to load job details');
        return {
          header: res.header || (res.data && res.data.header) || {},
          items: res.items || (res.data && res.data.items) || []
        };
      };

      window.buildJobCardLabels = function (header, items, opts) {
        const h = header || {};
        const rows = Array.isArray(items) ? items : [];
        const o = opts && typeof opts === 'object' ? opts : {};
        const num = (v) => {
          const n = Number(String(v ?? '').replace(/,/g, ''));
          return Number.isFinite(n) ? n : 0;
        };
        const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
        const safeId = (v) => clean(v).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
        const splitColourName = (value) => {
          const text = clean(value);
          if (!text) return '';
          const parts = text.split(/\s+-\s+/);
          return (parts.length > 1 ? parts[parts.length - 1] : text).trim();
        };
        const sfgStd = num(h.sfg_std_packing || h.sfg_pack_size || h.sfg_pack_size_label || h.pack_size);
        if (!sfgStd) {
          throw new Error('SFG STD Packing is missing in Mould Master. Fill SFG STD PACKING first, then print labels.');
        }

        const sourceRows = rows.length ? rows : [{ plan_qty: h.plan_qty || h.fg_qty || 0 }];
        const colourBatches = sourceRows.map((item, idx) => {
          const qty = num(item.plan_qty) || num(item.qty) || num(h.plan_qty) || num(h.fg_qty);
          const rawName = clean(item.raw_mould_item_name || item.rawMouldItemName || item.full_mould_item_name || item.mould_item_full_name || item.mould_item_name || item.item_name || h.product_name);
          const colour = clean(item.colour || item.color || item.colour_1 || item.item_colour || splitColourName(rawName) || 'Default');
          const itemName = clean(item.item_name || h.product_name || rawName);
          return { item, idx, qty, rawName, colour, itemName, count: Math.ceil(qty / sfgStd) };
        }).filter((row) => row.qty > 0 && row.count > 0);

        const totalLabels = colourBatches.reduce((sum, row) => sum + row.count, 0);
        if (!totalLabels) throw new Error('Plan Qty is missing. Cannot calculate label quantity.');

        const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const labels = [];
        let labelNo = 1;
        colourBatches.forEach((batch) => {
          let remaining = batch.qty;
          for (let i = 1; i <= batch.count; i += 1) {
            const labelQty = Math.min(sfgStd, remaining);
            remaining = Math.max(0, remaining - labelQty);
            const uid = [
              'JMSLBL',
              safeId(h.or_jr_no || o.or || 'OR'),
              safeId(h.jc_no || o.jc || 'JC'),
              safeId(o.planId || h.plan_id || o.ourCode || 'PLAN'),
              String(labelNo).padStart(3, '0'),
              runStamp
            ].filter(Boolean).join('-');
            const scanUrl = `${window.location.origin}/label-scan.html?uid=${encodeURIComponent(uid)}`;
            const payload = {
              type: 'JMS_SFG_LABEL',
              label_uid: uid,
              scan_code: scanUrl,
              scan_url: scanUrl,
              order_no: h.or_jr_no || o.or || '',
              jc_no: h.jc_no || o.jc || '',
              plan_id: o.planId || h.plan_id || '',
              batch_no: o.ourCode || h.our_code || '',
              machine: h.machine_name || '',
              mould_no: h.mould_no || '',
              mould_name: h.mould_name || '',
              item_name: batch.itemName,
              colour: batch.colour,
              label_no: labelNo,
              total_labels: totalLabels,
              label_qty: labelQty,
              plan_qty: batch.qty,
              sfg_std_packing: sfgStd,
              generated_at: new Date().toISOString()
            };
            labels.push({
              label_uid: uid,
              order_no: payload.order_no,
              jc_no: payload.jc_no,
              plan_id: payload.plan_id,
              our_code: payload.batch_no,
              machine_name: payload.machine,
              mould_no: payload.mould_no,
              mould_name: payload.mould_name,
              client_name: h.client_name || h.bom_type || '',
              item_name: payload.item_name,
              colour: payload.colour,
              label_no: labelNo,
              total_labels: totalLabels,
              label_qty: labelQty,
              plan_qty: batch.qty,
              sfg_std_packing: sfgStd,
              scan_code: payload.scan_code,
              scan_url: payload.scan_url,
              qr_payload: payload
            });
            labelNo += 1;
          }
        });
        return labels;
      };

      window.printJobLabels = async function (or, jc, opts) {
        const win = window.open('', '_blank', 'width=980,height=900');
        if (!win) return alert('Pop-up blocked. Please allow pop-ups for label printing.');
        win.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Preparing Labels</title>
            <style>
              body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; }
              .box { border: 1px solid #cbd5e1; background: #fff; padding: 22px 28px; font-weight: 900; box-shadow: 0 18px 50px rgba(15,23,42,.12); }
            </style>
          </head>
          <body><div class="box">Preparing labels...</div></body>
          </html>
        `);
        win.document.close();
        try {
          if (typeof toast === 'function') toast('Preparing QR Labels...', 'info');
          const o = { ...(opts || {}), or, jc };
          const { header, items } = await window.getJobCardPrintPayload(or, jc, opts);
          const labels = window.buildJobCardLabels(header, items, o);
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          try {
            await api.post('/planning/job-card-label-log', { labels });
          } catch (logErr) {
            console.warn('Label log failed:', logErr);
          }

          const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          const labelJson = JSON.stringify(labels).replace(/</g, '\\u003c');
          const labelCardList = labels.map((l, idx) => `
            <section class="label">
              <div class="label-title">IDENTIFICATION LABEL</div>
              <div class="label-row"><div class="k">M/C No:-</div><div class="v strong">${esc(l.machine_name)}</div></div>
              <div class="label-row"><div class="k">Job NO:-</div><div class="v strong">${esc(l.jc_no || l.plan_id)}</div></div>
              <div class="label-row item-row"><div class="k item-key">Item Name</div><div class="v item-name-cell">${esc(l.item_name)}</div></div>
              <div class="label-row"><div class="k">Mould :-</div><div class="v strong">${esc(l.mould_no || l.mould_name)}</div></div>
              <div class="label-row"><div class="k">Color :-</div><div class="v strong">${esc(l.colour)}</div></div>
              <div class="lower-grid">
                <div class="qr-cell"><div id="qr-${idx}" class="qr"></div></div>
                <div class="side-grid">
                  <div class="side-row"><div class="k side-key">SFG std :-</div><div class="sfg-std-value">${esc(l.sfg_std_packing)}</div></div>
                  <div class="side-row"><div class="k side-key">Shift :-</div><div class="v strong">${esc(header.shift || header.shift_name || '')}</div></div>
                  <div class="side-row"><div class="k side-key">Label</div><div class="v strong">${l.label_no}/${l.total_labels}</div></div>
                </div>
              </div>
            </section>
          `);
          const labelSheets = [];
          for (let i = 0; i < labelCardList.length; i += 2) {
            labelSheets.push(`
              <div class="label-sheet">
                ${labelCardList[i]}
                ${labelCardList[i + 1] || '<section class="label label-blank"></section>'}
              </div>
            `);
          }

          const title = esc(header.jc_no || jc || '');
          win.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>QR Labels - ${title}</title>
              <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
              <style>
                @page { size: 103mm 50mm; margin: 0; }
                * { box-sizing: border-box; }
                html, body { width: 103mm; margin: 0; padding: 0; }
                body { font-family: Arial, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .label-sheet { width: 103mm; height: 50mm; position: relative; page-break-after: always; break-after: page; overflow: hidden; }
                .label { width: 48mm; height: 48mm; padding: 0; overflow: hidden; position: absolute; top: .35mm; background: #fff; border: 1.25px solid #000; display: grid; grid-template-rows: 3.15mm 3.45mm 3.45mm 8.05mm 3.45mm 3.45mm 1fr; }
                .label:nth-child(1) { left: .5mm; }
                .label:nth-child(2) { left: 53.5mm; }
                .label-blank { padding: 0; }
                .label-title { display: flex; align-items: center; justify-content: center; min-height: 0; border-bottom: 1.05px solid #000; font-size: 6.15px; line-height: 1; font-weight: 900; letter-spacing: 0; overflow: hidden; }
                .label-row { display: grid; grid-template-columns: 11.7mm 1fr; min-height: 0; border-bottom: 1.05px solid #000; }
                .label-row > div, .side-row > div { min-width: 0; min-height: 0; padding: .12mm .42mm; display: flex; align-items: center; overflow: hidden; color: #000; }
                .k { border-right: 1.05px solid #000; font-size: 6.4px; line-height: .98; font-weight: 900; white-space: nowrap; }
                .v { font-size: 6.75px; line-height: .98; overflow-wrap: anywhere; }
                .strong { font-weight: 900; }
                .item-key { font-size: 6.05px; }
                .item-name-cell { white-space: normal; word-break: normal; overflow-wrap: anywhere; align-content: center; line-height: 1.02; font-size: 6.35px; font-weight: 900; }
                .lower-grid { min-height: 0; display: grid; grid-template-columns: 23.5mm 1fr; overflow: hidden; }
                .qr-cell { min-height: 0; display: flex; align-items: center; justify-content: center; padding: .55mm; border-right: 1.05px solid #000; overflow: hidden; }
                .qr { width: 21.2mm; height: 21.2mm; display: flex; align-items: center; justify-content: center; background:#fff; overflow:hidden; }
                .qr img, .qr canvas { width: 21.2mm !important; height: 21.2mm !important; image-rendering: pixelated; display:block; }
                .side-grid { min-height: 0; display: grid; grid-template-rows: repeat(3, 1fr); overflow: hidden; }
                .side-row { min-height: 0; display: grid; grid-template-columns: 11.3mm 1fr; border-bottom: 1.05px solid #000; overflow: hidden; }
                .side-row:last-child { border-bottom: 0; }
                .side-key { font-size: 6.15px; white-space: nowrap; }
                .sfg-std-value { justify-content: center; font-size: 9.9px; line-height: 1; font-weight: 900; text-align: center; }
              </style>
            </head>
            <body>
              ${labelSheets.join('')}
              <script>
                const labels = ${labelJson};
                function renderQrLabels() {
                  if (!window.QRCode) return setTimeout(renderQrLabels, 150);
                  labels.forEach((label, idx) => {
                    const node = document.getElementById('qr-' + idx);
                    if (!node) return;
                    new QRCode(node, {
                      text: label.scan_url || label.scan_code || label.label_uid,
                      width: 170,
                      height: 170,
                      colorDark: '#000000',
                      colorLight: '#ffffff',
                      correctLevel: QRCode.CorrectLevel.Q
                    });
                  });
                  setTimeout(() => {
                    window.focus();
                    window.print();
                  }, 900);
                }
                renderQrLabels();
              <\/script>
            </body>
            </html>
          `);
          win.document.close();
        } catch (e) {
          console.error(e);
          if (win && !win.closed) {
            win.document.open();
            win.document.write('<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:24px"><h3>Label print failed</h3><p>' + String(e.message || e).replace(/[&<>]/g, '') + '</p></body></html>');
            win.document.close();
          }
          alert('Error printing labels: ' + e.message);
        }
      };

      window.showJobCardLabelLog = async function (or, jc, opts) {
        try {
          const o = opts && typeof opts === 'object' ? opts : {};
          let q = `limit=500`;
          if (or) q += `&or_jr_no=${encodeURIComponent(or)}`;
          if (jc) q += `&jc_no=${encodeURIComponent(jc)}`;
          if (o.planId) q += `&plan_id=${encodeURIComponent(o.planId)}`;
          if (o.ourCode) q += `&our_code=${encodeURIComponent(o.ourCode)}`;

          const endpoint = `/planning/job-card-label-log?${q}`;
          const readLog = async () => {
            const token = localStorage.getItem('token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = `Bearer ${token}`;
            const urls = [
              `${window.location.origin}/api${endpoint}`,
              `/api${endpoint}`
            ];
            let lastErr = null;
            for (const url of urls) {
              try {
                const r = await fetch(url, {
                  method: 'GET',
                  headers,
                  credentials: 'same-origin',
                  cache: 'no-store'
                });
                const text = await r.text();
                let json = {};
                try { json = text ? JSON.parse(text) : {}; } catch { json = { ok: false, error: text || 'Invalid response' }; }
                if (!r.ok || json.ok === false) throw new Error(json.error || `HTTP ${r.status}`);
                return json;
              } catch (err) {
                lastErr = err;
              }
            }
            throw lastErr || new Error('Failed to fetch label log');
          };

          let res;
          try {
            res = await readLog();
          } catch (directErr) {
            const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
            if (!api || !api.get) throw directErr;
            res = await api.get(endpoint);
          }
          const rows = res.data || res.items || [];
          const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          const htmlRows = rows.length ? rows.map((r) => `
            <tr>
              <td>${esc(r.printed_at ? new Date(r.printed_at).toLocaleString('en-IN') : '')}</td>
              <td>${esc(r.label_uid)}</td>
              <td>${esc(r.order_no)}</td>
              <td>${esc(r.jc_no)}</td>
              <td>${esc(r.machine_name)}</td>
              <td>${esc(r.mould_no)}</td>
              <td>${esc(r.colour)}</td>
              <td>${esc(r.label_no)}/${esc(r.total_labels)}</td>
              <td>${esc(r.label_qty)}</td>
              <td>${esc(r.printed_by)}</td>
            </tr>
          `).join('') : '<tr><td colspan="10" style="text-align:center; padding:28px; color:#64748b">No label print log found.</td></tr>';
          const win = window.open('', '_blank', 'width=1200,height=800');
          if (!win) return alert('Pop-up blocked. Please allow pop-ups for label log.');
          win.document.write(`
            <!DOCTYPE html><html><head><title>Label Print Log</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; background: #f8fafc; color:#0f172a; }
              h2 { margin: 0 0 14px; }
              table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 12px 30px rgba(15,23,42,.08); border-radius: 14px; overflow: hidden; }
              th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 12px; font-size: 12px; text-align: left; vertical-align: top; }
              th { background: #e0f2fe; color: #075985; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
              td:nth-child(2) { font-family: Consolas, monospace; font-size: 11px; }
            </style></head><body>
            <h2>Label Print Log</h2>
            <table><thead><tr><th>Printed At</th><th>Label UID</th><th>OR No</th><th>JC No</th><th>Machine</th><th>Mould</th><th>Colour</th><th>No</th><th>Qty</th><th>Printed By</th></tr></thead><tbody>${htmlRows}</tbody></table>
            </body></html>
          `);
          win.document.close();
        } catch (e) {
          console.error(e);
          alert('Error opening label log: ' + e.message);
        }
      };

      window.currentJcApprovalMode = 'pending';
      window.currentJcApprovalId = null;

      window.loadJcApprovals = async function (mode = 'pending') {
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        const list = document.getElementById('jcApprovalList');
        const pendingTab = document.getElementById('jcApprovalPendingTab');
        const historyTab = document.getElementById('jcApprovalHistoryTab');
        const search = document.getElementById('jcApprovalSearch')?.value || '';
        if (!list) return;

        window.currentJcApprovalMode = mode === 'history' ? 'history' : 'pending';
        if (pendingTab) pendingTab.className = window.currentJcApprovalMode === 'pending' ? 'btn primary' : 'btn';
        if (historyTab) historyTab.className = window.currentJcApprovalMode === 'history' ? 'btn primary' : 'btn';
        list.innerHTML = '<div style="padding:42px; text-align:center; color:#64748b; font-weight:850">Loading approval data...</div>';

        try {
          const res = await api.get(`/planning/job-card-approvals?status=${encodeURIComponent(window.currentJcApprovalMode)}&search=${encodeURIComponent(search)}`);
          const rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.items) ? res.items : []);
          if (!rows.length) {
            list.innerHTML = `<div style="padding:46px; text-align:center; color:#64748b; font-weight:850">${window.currentJcApprovalMode === 'history' ? 'No approval history yet.' : 'No pending approval rows yet. Create a production plan first; it will appear here before Print Job Card and Supervisor.'}</div>`;
            return;
          }

          if (window.currentJcApprovalMode === 'history') {
            const grouped = new Map();
            rows.forEach((r) => {
              const key = r.acted_at ? String(r.acted_at).slice(0, 10) : 'Date N/A';
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key).push(r);
            });
            list.innerHTML = Array.from(grouped.entries()).map(([key, items]) => {
              const label = key === 'Date N/A' ? key : new Date(key + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
              return `
                <div style="padding:14px 18px; background:#f8fafc; font-weight:950; color:#0f766e; text-transform:uppercase; letter-spacing:.06em">${esc(label)}</div>
                ${items.map((r) => `
                  <div class="jc-approval-grid" style="display:grid; grid-template-columns:1.2fr 1.1fr 1fr 1.35fr 1.1fr .9fr; align-items:center; border-top:1px solid #e2e8f0">
                    <div><b>${esc(r.order_no || '-')}</b><br><span class="muted">${esc(r.plan_id || '')}</span></div>
                    <div>${esc(r.created_by || '-')}<br><span class="muted">Created By</span></div>
                    <div>${esc(r.our_code || '-')}<br><span class="muted">Job Plan ${esc(r.batch_no || '-')}</span></div>
                    <div>${esc(r.approval_stage || '-')}<br><span class="muted">${esc(r.action || '-')} by ${esc(r.acted_by || '-')}</span></div>
                    <div>${esc(r.job_card_no || '-')}<br><span class="muted">${r.job_card_date ? new Date(r.job_card_date).toLocaleDateString('en-GB') : '-'}</span></div>
                    <div><span style="display:inline-flex; padding:7px 12px; border-radius:999px; font-weight:950; background:${String(r.action || '').includes('REJECTED') ? '#fee2e2' : '#dcfce7'}; color:${String(r.action || '').includes('REJECTED') ? '#991b1b' : '#166534'}">${esc(r.action || '-')}</span></div>
                  </div>
                `).join('')}
              `;
            }).join('');
            return;
          }

          const relTime = (ts) => {
            if (!ts) return '';
            const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
            if (diff < 60) return `${diff}s ago`;
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            const days = Math.floor(diff / 86400);
            return days === 1 ? '1 day ago' : `${days} days ago`;
          };
          list.innerHTML = rows.map((r) => {
            const linked = !!r.jc_linked;
            const jcDate = r.job_card_date ? new Date(r.job_card_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            const stage = r.approval_stage || 'PPC';
            const stageLabel = r.approval_stage_label || (stage === 'MOULDING' ? 'Waiting for Moulding Approval' : 'Waiting for PPC Check');
            // Fix 2: Linking is no longer required for approval — show Approve button always.
            // JC linking only matters at the "Start Plan" step (not here).
            const canApprove = !!r.can_approve;
            const buttonLabel = stage === 'MOULDING' ? 'Moulding Approve' : 'PPC Check';
            const stageTone = stage === 'MOULDING'
              ? 'background:#fff7ed; color:#9a3412; border-color:#fed7aa'
              : 'background:#eff6ff; color:#075985; border-color:#bfdbfe';
            const pendingSince = r.created_at ? new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            const pendingAge = relTime(r.created_at);
            const ageDays = r.created_at ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000) : 0;
            const ageTone = ageDays >= 3 ? 'color:#b91c1c; font-weight:950' : ageDays >= 1 ? 'color:#b45309; font-weight:850' : 'color:#64748b';
            return `
              <div class="jc-approval-grid" style="display:grid; grid-template-columns:1.2fr 1.1fr 1fr 1.35fr 1.1fr .9fr; align-items:center; border-top:1px solid #e2e8f0; background:#ffffff">
                <div><b>${esc(r.order_no || '-')}</b><br><span class="muted">${esc(r.product_name || '')}</span>${pendingAge ? `<br><span title="${esc(pendingSince)}" style="font-size:.7rem; ${ageTone}"><i class="bi bi-clock"></i> ${esc(pendingAge)}</span>` : ''}</div>
                <div><b>${esc(r.client_name || '-')}</b><br><span class="muted">Client</span></div>
                <div><b>${esc(r.our_code || '-')}</b><br><span class="muted">${esc(r.plan_id || '-')} / Job Plan ${esc(r.batch_no || '-')}</span></div>
                <div>
                  <b>${esc(r.mould_name || r.mould_code || '-')}</b><br>
                  <span class="muted">${esc(r.machine || '-')}</span>
                  ${r.plan_type === 'Labour Job' ? `<br><span style="background:#fef9c3;color:#b45309;border:1px solid #fde68a;border-radius:4px;padding:1px 7px;font-size:.7rem;font-weight:800;display:inline-block;margin-top:3px"><i class="bi bi-people-fill"></i> LABOUR JOB</span>` : ''}
                </div>
                <div>
                  ${linked
                    ? `<b>${esc(r.job_card_no)}</b><br><span class="muted">${esc(jcDate)}</span>`
                    : `<span style="color:#64748b; font-size:.78rem"><i class="bi bi-info-circle"></i> JC link pending — link at Start Plan</span>`
                  }
                  <br><span style="display:inline-flex; margin-top:5px; border:1px solid; border-radius:999px; padding:4px 9px; font-size:.72rem; font-weight:950; ${stageTone}">${esc(stageLabel)}</span>
                </div>
                <div>
                  <button type="button" class="btn ${canApprove ? 'primary' : ''}" ${canApprove ? '' : 'disabled'} onclick="window.openJcApproval(${Number(r.id)})" style="border-radius:12px; ${canApprove ? '' : 'opacity:.55; cursor:not-allowed'}">
                    <i class="bi bi-shield-check"></i> ${esc(buttonLabel)}
                  </button>
                  ${!canApprove ? `<div class="muted" style="font-size:.72rem; margin-top:6px">${esc(r.approval_role_label || '')}</div>` : ''}
                </div>
              </div>
            `;
          }).join('');
        } catch (e) {
          console.error(e);
          list.innerHTML = `<div style="padding:32px; color:#b91c1c; background:#fef2f2; font-weight:850">Error: ${esc(e.message || e)}</div>`;
        }
      };

      window.openJcApproval = async function (id) {
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        const modal = document.getElementById('jcApprovalModal');
        const body = document.getElementById('jcApprovalModalBody');
        const title = document.getElementById('jcApprovalModalTitle');
        const sign = document.getElementById('jcApprovalSignLine');
        if (!modal || !body) return;
        window.currentJcApprovalId = id;
        // Portal the modal to <body> so its position:fixed resolves against the viewport.
        // While nested inside the approval panel, a transformed/filtered ancestor makes the
        // fixed modal anchor to that ancestor instead — so it opens at the top of the page
        // and the user has to scroll up to reach it. Moving it to body centers it in the
        // current window every time.
        if (modal.parentElement !== document.body) {
          document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
        lockModalScroll(); // keep page at current scroll position while modal is open
        body.scrollTop = 0; // start the detail list at the top; Approve/Reject footer stays pinned
        body.innerHTML = '<div style="padding:36px; text-align:center; color:#64748b; font-weight:850">Loading plan details...</div>';
        try {
          const res = await api.get(`/planning/job-card-approvals/${id}`);
          const data = res?.data || {};
          const p = data.plan || {};
          const colours = data.colours || [];
          window.currentJcApprovalPlan = p;
          if (title) title.textContent = `${p.order_no || '-'} • ${p.job_card_no || '-'}`;
          if (sign) sign.innerHTML = `Created By : <b>${esc(p.created_by || '-')}</b> &nbsp; | &nbsp; Checked By : <b>${esc(p.checked_by || (p.approval_stage === 'PPC' ? 'Pending PPC' : '-'))}</b> &nbsp; | &nbsp; Approved By : <b>${esc(p.approved_by || 'Pending Moulding')}</b>`;
          const approveBtn = document.getElementById('jcApprovalApproveBtn');
          const rejectBtn = document.getElementById('jcApprovalRejectBtn');
          if (approveBtn) {
            approveBtn.innerHTML = `<i class="bi bi-shield-check"></i> ${p.approval_stage === 'MOULDING' ? 'Moulding Approve' : 'PPC Check'}`;
            approveBtn.disabled = !p.can_approve;
            approveBtn.style.opacity = p.can_approve ? '1' : '.55';
          }
          if (rejectBtn) {
            rejectBtn.disabled = !p.can_approve;
            rejectBtn.style.opacity = p.can_approve ? '1' : '.55';
          }
          body.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; background:${p.approval_stage === 'MOULDING' ? '#fff7ed' : '#eff6ff'}; border:1px solid ${p.approval_stage === 'MOULDING' ? '#fed7aa' : '#bfdbfe'}; border-radius:16px; padding:12px 14px; margin-bottom:14px">
              <div>
                <div style="font-size:.72rem; color:#64748b; font-weight:950; text-transform:uppercase">Current approval stage</div>
                <div style="font-weight:950; color:#0f172a">${esc(p.approval_stage_label || '-')}</div>
              </div>
              <div style="font-weight:950; color:${p.can_approve ? '#047857' : '#b45309'}">${p.can_approve ? 'You can approve this stage' : esc(p.approval_role_label || 'Manager approval required')}</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:16px">
              ${[
                ['OR No', p.order_no],
                ['JC No', p.job_card_no],
                ['Product Name', p.product_name],
                ['Mould Name', p.mould_name],
                ['Client', p.client_name],
                ['OR Qty', p.or_qty],
                ['Job Qty', p.batch_qty],
                ['Consumption Ratio Qty', p.consumption_ratio_qty],
                ['Plan Qty', p.plan_qty],
                ['Job Plan / Plan', `${p.our_code || '-'} / ${p.plan_id || '-'}`],
                ['Machine', p.machine],
                ['Job Card Date', p.job_card_date ? new Date(p.job_card_date).toLocaleDateString('en-GB') : '-']
              ].map(([k, v]) => `<div style="border:1px solid #dbeafe; border-radius:14px; padding:11px 12px; background:#f8fbff"><div style="font-size:.72rem; color:#64748b; font-weight:950; text-transform:uppercase">${esc(k)}</div><div style="font-weight:950; color:#0f172a; margin-top:3px">${esc(v || '-')}</div></div>`).join('')}
            </div>
            <div style="border:1px solid #dbeafe; border-radius:16px; overflow:hidden; margin-bottom:16px">
              <div style="display:grid; grid-template-columns:90px 1fr 180px; background:#eff6ff; color:#475569; font-weight:950; text-transform:uppercase; font-size:.76rem">
                <div style="padding:10px 12px">Sr.No</div><div style="padding:10px 12px">Color Name</div><div style="padding:10px 12px; text-align:right">Colour Plan Qty</div>
              </div>
              ${colours.map((c, idx) => `<div style="display:grid; grid-template-columns:90px 1fr 180px; border-top:1px solid #e2e8f0">
                <div style="padding:10px 12px; font-weight:850">${idx + 1}</div>
                <div style="padding:10px 12px; font-weight:850">${esc(c.colour_name || '-')}</div>
                <div style="padding:10px 12px; text-align:right; font-weight:950">${Number(c.colour_plan_qty || 0).toLocaleString('en-IN')}</div>
              </div>`).join('') || '<div style="padding:18px; color:#64748b">No colours found for this plan.</div>'}
              <div style="display:grid; grid-template-columns:1fr 180px; border-top:2px solid #bae6fd; background:#f8fafc">
                <div style="padding:11px 12px; font-weight:950; text-align:right">Total Qty</div>
                <div style="padding:11px 12px; text-align:right; font-weight:950">${Number(data.total_qty || 0).toLocaleString('en-IN')}</div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <label style="font-weight:950; color:#334155">PPC Remarks <textarea id="jcApprovalPpcRemarks" placeholder="Required if PPC rejects, optional if PPC checks" style="width:100%; min-height:84px; margin-top:7px; border:1px solid #cbd5e1; border-radius:12px; padding:10px; resize:vertical">${esc(p.ppc_remarks || '')}</textarea></label>
              <label style="font-weight:950; color:#334155">Moulding Remarks <textarea id="jcApprovalMouldingRemarks" placeholder="Required if Moulding rejects, optional if Moulding approves" style="width:100%; min-height:84px; margin-top:7px; border:1px solid #cbd5e1; border-radius:12px; padding:10px; resize:vertical">${esc(p.moulding_remarks || '')}</textarea></label>
            </div>
          `;
        } catch (e) {
          body.innerHTML = `<div style="padding:24px; color:#b91c1c; background:#fef2f2; border-radius:14px; font-weight:850">Error: ${esc(e.message || e)}</div>`;
        }
      };

      window.closeJcApprovalModal = function () {
        const modal = document.getElementById('jcApprovalModal');
        if (modal) modal.style.display = 'none';
        window.currentJcApprovalId = null;
        window.currentJcApprovalPlan = null;
        unlockModalScrollIfNeeded(); // restore scroll position to where user was
      };

      window.submitJcApproval = async function (action) {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
        if (!window.currentJcApprovalId) return;
        const stage = window.currentJcApprovalPlan?.approval_stage || 'PPC';
        const ppcRemarks = document.getElementById('jcApprovalPpcRemarks')?.value || '';
        const mouldingRemarks = document.getElementById('jcApprovalMouldingRemarks')?.value || '';
        if (action === 'REJECTED') {
          const requiredRemarks = stage === 'MOULDING' ? mouldingRemarks : ppcRemarks;
          if (!String(requiredRemarks || '').trim()) {
            alert('Reject remarks are mandatory.');
            return;
          }
        }
        const body = {
          action,
          ppc_remarks: ppcRemarks,
          moulding_remarks: mouldingRemarks,
          checked_by: document.getElementById('jcApprovalCheckedBy')?.value || '',
          approved_by: document.getElementById('jcApprovalApprovedBy')?.value || ''
        };
        try {
          const res = await api.post(`/planning/job-card-approvals/${window.currentJcApprovalId}/action`, body);
          const msg = res?.status === 'PPC_APPROVED' ? 'PPC checked. Sent to Moulding approval.' : `Plan ${action === 'APPROVED' ? 'approved' : 'rejected'}`;
          if (typeof toast === 'function') toast(msg, 'success');
          window.closeJcApprovalModal();
          window.loadJcApprovals('pending');
        } catch (e) {
          alert(e.message || String(e));
        }
      };

      const _jcApprovalSearch = document.getElementById('jcApprovalSearch');
      if (_jcApprovalSearch) {
        let _jcApprovalTimer = null;
        _jcApprovalSearch.addEventListener('input', () => {
          clearTimeout(_jcApprovalTimer);
          _jcApprovalTimer = setTimeout(() => window.loadJcApprovals(window.currentJcApprovalMode || 'pending'), 350);
        });
        _jcApprovalSearch.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') window.loadJcApprovals(window.currentJcApprovalMode || 'pending');
        });
      }

      window.printJobCard = async function (or, jc, opts) {
        try {
          const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
          if (typeof toast === 'function') toast('Preparing Print Layout...', 'info');

          const o = opts && typeof opts === 'object' ? opts : {};
          let q = `or_jr_no=${encodeURIComponent(or)}`;
          if (jc) q += `&jc_no=${encodeURIComponent(jc)}`;
          if (o.planId) q += `&plan_id=${encodeURIComponent(o.planId)}`;
          if (o.ourCode) q += `&our_code=${encodeURIComponent(o.ourCode)}`;

          const res = await api.get(`/planning/job-card-print?${q}`);

          if (!res.ok) throw new Error(res.error || 'Failed to load details');

          const data = res.items || (res.data && res.data.items) || [];
          const h = res.header || (res.data && res.data.header) || {};
          const u = (window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.getUser) ? window.JPSMS.auth.getUser() : {};
          const viewerName = (u && (u.full_name || u.name || u.username)) ? String(u.full_name || u.name || u.username) : '';

          if (!data.length) {
            alert('No items found for this Job Card.');
            return;
          }

          const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          const num = (v) => {
            const n = Number(String(v ?? '').replace(/,/g, ''));
            return Number.isFinite(n) ? n : 0;
          };
          const fmt = (v, digits) => {
            const n = num(v);
            if (!n) return '';
            return n.toLocaleString('en-IN', {
              maximumFractionDigits: Number.isFinite(digits) ? digits : 3,
              minimumFractionDigits: 0
            });
          };
          const fmtDate = (value) => {
            if (!value) return '';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return esc(value);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}-${mm}-${yyyy}`;
          };
          const splitColourName = (value) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (!text) return '';
            const parts = text.split(/\s+-\s+/);
            return (parts.length > 1 ? parts[parts.length - 1] : text).trim();
          };
          const firstItem = data[0] || {};
          const totalPlanQty = data.reduce((sum, i) => sum + (num(i.plan_qty) || num(i.qty)), 0);
          const partWeight = num(h.part_weight);
          const runnerWeight = num(h.runner_weight);
          const fgQty = num(h.fg_qty || h.or_qty) || totalPlanQty;
          const pcsPerHr = num(h.pcs_per_hour) || (num(h.cycle_time) && num(h.mould_cavity || firstItem.no_of_cav || firstItem.cavity) ? Math.round((3600 / num(h.cycle_time)) * num(h.mould_cavity || firstItem.no_of_cav || firstItem.cavity)) : 0);
          const totalProdHr = pcsPerHr && fgQty ? (fgQty / pcsPerHr) : 0;
          const rmForQty = (qty) => Math.ceil((partWeight + runnerWeight) * num(qty)) * 1.01;
          const rmBags = (kg) => kg ? kg / 25 : 0;
          const mainColour = firstItem.master_batch_1 || firstItem.mb || 'MB';
          const sfgStdPacking = num(h.sfg_std_packing || h.sfg_pack_size || h.sfg_pack_size_label);
          const reqSfgLabel = sfgStdPacking && totalPlanQty ? Math.ceil(totalPlanQty / sfgStdPacking) : '';
          const sfgPackingTypeSize = [h.sfg_bag_type, h.sfg_bag_size].map(v => String(v || '').trim()).filter(Boolean).join(' / ');

          const printColourRows = (() => {
            const rows = [];
            const colourRows = data.length ? data : [{}];
            colourRows.forEach((item) => {
              const qty = num(item.plan_qty) || num(item.qty);
              const kg = rmForQty(qty);
              const bags = rmBags(kg);
              const extractedColour = item.colour || item.color || item.colour_1 || item.item_colour || splitColourName(item.mould_item_name || item.item_name) || '';
              const baseMouldItem = String(item.raw_mould_item_name || item.rawMouldItemName || item.full_mould_item_name || item.mould_item_full_name || item.mould_item_name || item.item_name || '').replace(/\s+/g, ' ').trim();
              const colourName = (() => {
                if (!baseMouldItem) return extractedColour || '-';
                if (!extractedColour) return baseMouldItem;
                return baseMouldItem.toLowerCase().includes(String(extractedColour).toLowerCase())
                  ? baseMouldItem
                  : `${baseMouldItem} - ${extractedColour}`;
              })();
              for (let i = 0; i < 6; i += 1) {
                rows.push(`
                  <tr>
                    ${i === 0 ? `<td rowspan="6" class="colour-cell group-left">${esc(colourName)}</td>` : ''}
                    ${i === 0 ? `<td rowspan="6" class="center strong">${fmt(qty, 0)}</td>` : ''}
                    <td>&nbsp;</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    ${i === 0 ? `<td rowspan="3" class="center strong rm-cell">${bags ? `${fmt(bags, 2)}<br>Bags` : ''}</td>` : ''}
                    ${i === 3 ? `<td rowspan="3" class="center strong rm-cell">${kg ? `${fmt(kg, 2)}<br>Kgs` : ''}</td>` : ''}
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                `);
              }
            });
            let groupCount = colourRows.length;
            while (groupCount < 6) {
              for (let i = 0; i < 6; i += 1) {
                rows.push(`
                  <tr>
                    ${i === 0 ? `<td rowspan="6" class="colour-cell group-left">-</td>` : ''}
                    ${i === 0 ? `<td rowspan="6" class="center"></td>` : ''}
                    <td>&nbsp;</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    ${i === 0 ? `<td rowspan="3" class="rm-cell"></td>` : ''}
                    ${i === 3 ? `<td rowspan="3" class="rm-cell"></td>` : ''}
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                `);
              }
              groupCount += 1;
            }
            return rows.join('');
          })();

          const win = window.open('', '_blank', 'width=1200,height=900');
          if (!win) return alert('Pop-up blocked. Please allow pop-ups for printing.');

          const jcDateStr = h.job_card_date
            ? new Date(h.job_card_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : '';
          const fmtDateTime = (value) => {
            if (!value) return '';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return String(value || '');
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
          };
          const formatSigner = (name, at, fallbackText = '') => {
            const cleanName = String(name || '').trim();
            const cleanTime = fmtDateTime(at);
            if (cleanName && cleanTime) return `${cleanName} (${cleanTime})`;
            if (cleanName) return cleanName;
            if (cleanTime) return cleanTime;
            return fallbackText;
          };
          const preparedBy = formatSigner(h.created_by || h.plan_created_by || h.createdBy || '', h.created_at || h.plan_created_at, '');
          const checkedBy = formatSigner(h.checked_by || '', h.checked_at, '');
          const approvedBy = formatSigner(h.approved_by || '', h.approved_at, '');
          const productionStartStr = fmtDateTime(h.production_start_date || h.prodn_start_date || h.production_start_time || h.start_date || h.plan_date);
          const productionEndStr = fmtDateTime(h.production_end_date || h.prodn_end_date || h.production_end_time || h.end_date || h.expected_end);

          const printHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>Job Card - ${esc(h.jc_no || '')}</title>
              <style>
                @page { size: A4 portrait; margin: 4mm; }
                * { box-sizing: border-box; }
                body { font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; color: #000; font-size: 10px; }
                .sheet { width: 100%; min-height: calc(297mm - 8mm); display: flex; flex-direction: column; }
                .title { font-family: "Times New Roman", serif; font-size: 23px; line-height: 1; font-weight: 900; text-align: center; letter-spacing: .2px; border: 1.5px solid #000; border-bottom: 0; padding: 2px 0 3px; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                td, th { border: 1px solid #000; padding: 2px 3px; vertical-align: middle; word-break: break-word; overflow-wrap: anywhere; }
                th { background: #d9d9d9; text-align: center; font-weight: 900; }
                .label { font-weight: 900; white-space: normal; }
                .val { font-weight: 900; }
                .center { text-align: center; }
                .strong { font-weight: 900; }
                .top-grid td { height: 21px; line-height: 1.15; }
                .top-grid .label { font-size: 9px; }
                .top-grid .val { font-size: 10px; }
                .tight-label { font-size: 8.5px !important; line-height: 1.05 !important; }
                .prod-date-label { font-size: 8px !important; line-height: 1 !important; white-space: nowrap; }
                .date-value { font-size: 8.8px !important; white-space: nowrap; letter-spacing: -0.15px; }
                .mp-value { font-size: 9px !important; white-space: nowrap; }
                .operator-row td { height: 29px; }
                .operator-note { font-size: 10px !important; line-height: 1.15 !important; }
                .small { font-size: 8px; }
                .colour-cell { text-align: center; font-size: 10px; line-height: 1.2; }
                .group-left { border-top-width: 2px; }
                .detail-grid { page-break-inside: avoid; flex: 1 1 auto; }
                .detail-grid th { font-size: 9px; line-height: 1.08; height: 50px; }
                .detail-grid td { height: 19px; line-height: 1.08; }
                .rm-cell { font-size: 9px; line-height: 1.15; }
                .detail-grid tr:nth-child(6n + 2) td { border-top-width: 2px; }
                .sign-row { page-break-inside: avoid; }
                .sign-row td { height: 24px; font-weight: 900; font-size: 10px; }
              </style>
            </head>
            <body>
              <div class="sheet">
                <div class="title">JOYO PLASTICS VAPI JOB CARD</div>
                <table class="top-grid">
                  <colgroup>
                    <col style="width:14%"><col style="width:14%"><col style="width:10%"><col style="width:20%"><col style="width:12%"><col style="width:12%"><col style="width:10%"><col style="width:8%">
                  </colgroup>
                  <tr>
                    <td class="label">Machine :</td><td class="val">${esc(h.machine_name || '')}</td>
                    <td class="label">Order No :</td><td colspan="2" class="val">${esc(h.or_jr_no || '')}</td>
                    <td class="label">Job Card No :</td><td colspan="2" class="val">${esc(h.jc_no || '')}</td>
                  </tr>
                  <tr>
                    <td class="label">BOM Type :</td><td colspan="3" class="val">${esc(h.bom_type || h.client_name || '')}</td>
                    <td class="label">Job Card Date :</td><td colspan="3" class="val">${esc(fmtDate(h.job_card_date) || jcDateStr)}</td>
                  </tr>
                  <tr>
                    <td class="label">Item :</td><td colspan="3" class="val">${esc(h.product_name || firstItem.item_name || '')}</td>
                    <td class="label">FG Code :</td><td class="val">${esc(h.fg_code || firstItem.item_code || '')}</td>
                    <td class="label">Cycle Time :</td><td class="val">${fmt(h.cycle_time, 2)}</td>
                  </tr>
                  <tr>
                    <td class="label">Sub_Part :</td><td colspan="3" class="val">${esc(h.mould_name || firstItem.mould_item_name || '')}</td>
                    <td class="label">Mould Code :</td><td class="val">${esc(h.mould_no || '')}</td>
                    <td class="label">Pcs / Hour</td><td class="val">${fmt(pcsPerHr, 0)}</td>
                  </tr>
                  <tr>
                    <td class="label">Cavity :</td><td class="val">${esc(h.mould_cavity || firstItem.cavity || firstItem.no_of_cav || '')}</td>
                    <td class="label">FG Qty :</td><td class="val">${fmt(fgQty, 0)}</td>
                    <td class="label">FG Pack Size :</td><td class="val">${esc(h.fg_pack_size || h.fg_pack_size_label || '')}</td>
                    <td class="label">Target / Day :</td><td class="val">${fmt(h.target_pcs, 0)}</td>
                  </tr>
                  <tr>
                    <td class="label">Part Weight :</td><td class="val">${fmt(h.part_weight, 3)}</td>
                    <td class="label">Colour :</td><td class="val">${esc(mainColour)}</td>
                    <td class="label">SFG Pack Size :</td><td class="val">${esc(h.sfg_pack_size || h.pack_size || '')}</td>
                    <td class="label tight-label">Total Prodn.<br>Hours :</td><td class="val">${totalProdHr ? fmt(totalProdHr, 3) : ''}</td>
                  </tr>
                  <tr>
                    <td class="label">Runner Weight :</td><td class="val">${fmt(h.runner_weight, 3)}</td>
                    <td class="label">Ratio :</td><td class="val">400 GM</td>
                    <td class="label tight-label">Mixing RM Ratio :</td>
                    <td class="val">${esc(h.material || '')}</td>
                    <td class="label tight-label">MP Req. :</td>
                    <td class="val mp-value">${fmt(h.manpower, 2)}${h.manpower ? ' Nos' : ''}</td>
                  </tr>
                  <tr class="operator-row">
                    <td class="label prod-date-label">Prodn Start :</td>
                    <td class="val date-value">${esc(productionStartStr)}</td>
                    <td class="label prod-date-label">Prodn End :</td>
                    <td class="val date-value">${esc(productionEndStr)}</td>
                    <td class="label tight-label">SFG Packing<br>Type/Size :</td>
                    <td class="val">${esc(sfgPackingTypeSize || '')}</td>
                    <td class="label tight-label">Req. SFG<br>Label :</td>
                    <td class="val">${reqSfgLabel ? fmt(reqSfgLabel, 0) : ''}</td>
                  </tr>
                  <tr class="operator-row">
                    <td colspan="2" class="label">Operator Activities :</td>
                    <td colspan="6" class="val operator-note">${esc(h.operator_activities || '')}</td>
                  </tr>
                  <tr>
                    <td colspan="2" class="label">Special Instructions :</td><td colspan="6">&nbsp;</td>
                  </tr>
                </table>

                <table class="detail-grid">
                  <colgroup>
                    <col style="width:14.5%"><col style="width:6.5%"><col style="width:9%"><col style="width:9%"><col style="width:8%"><col style="width:9.5%"><col style="width:9%"><col style="width:6.5%"><col style="width:7%"><col style="width:7.2%"><col style="width:7.2%"><col style="width:7.6%">
                  </colgroup>
                  <tr>
                    <th>Colour.....</th>
                    <th>Qty.</th>
                    <th>Production<br>(Qty)</th>
                    <th>Balance<br>(Qty)</th>
                    <th>Date &<br>Shift</th>
                    <th>Shifting<br>(Qty)</th>
                    <th>Balance<br>(Qty)</th>
                    <th>Issue &<br>Rec Sign<br>(P + S)</th>
                    <th>R.M<br>(Bags<br>& Kgs)</th>
                    <th>R.M<br>Issue<br>(In Bags)</th>
                    <th>R.M<br>Balance<br>(In Bags)</th>
                    <th>Issue &<br>Rec Sign<br>(Rm + P)</th>
                  </tr>
                  ${printColourRows}
                </table>

                <table class="sign-row">
                  <tr>
                    <td>Prepared By : ${esc(preparedBy || '')}</td>
                    <td>Checked By : ${esc(checkedBy || '')}</td>
                    <td>Approved By : ${esc(approvedBy || '')}</td>
                  </tr>
                </table>
              </div>

              <script>
                 setTimeout(() => {
                    window.print();
                 }, 800); 
              <\/script>
            </body>
            </html>
          `;

          win.document.write(printHtml);
          win.document.close();

        } catch (e) {
          console.error(e);
          alert('Error printing: ' + e.message);
        }
      };

      // --- View Routing (Deferred) ---
      const routeParams = new URLSearchParams(window.location.search);
      const view = (() => {
        const fq = (routeParams.get('view') || '').trim();
        if (fq) return fq;
        const raw = (window.location.hash || '').replace(/^#/, '');
        if (!raw) return '';
        try {
          return (new URLSearchParams(raw).get('view') || '').trim();
        } catch (e) {
          return '';
        }
      })();
      const action = routeParams.get('action');

      const vm = document.getElementById('view-main');
      const kpiDeck = document.querySelector('.kpi-deck');
      const dashboardToolbar = document.getElementById('dashboardToolbar');
      const mapWrap = document.getElementById('mapWrap');
      const printJcEl = document.getElementById('printJCView');
      const approvalEl = document.getElementById('pendingPlanApprovalView');

      if (view === 'print_jc') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        if (printJcEl) printJcEl.style.display = 'block';
        const pf = document.getElementById('pjcFrom');
        const pt = document.getElementById('pjcTo');
        if (pf && pt && !pf.value && !pt.value && typeof window.pjcLocalYmd === 'function') {
          const t = window.pjcLocalYmd(new Date());
          pf.value = t;
          pt.value = t;
        }
        if (typeof window.loadPrintJobCards === 'function') window.loadPrintJobCards();
      } else if (view === 'pending_plan_approval') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        if (printJcEl) printJcEl.style.display = 'none';
        if (approvalEl) approvalEl.style.display = 'block';
        if (typeof window.loadJcApprovals === 'function') window.loadJcApprovals('pending');
      } else if (view === 'master') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        document.getElementById('masterView').style.display = 'block';
        if (typeof loadMasterPlan === 'function') loadMasterPlan();
      } else if (view === 'timeline') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        document.getElementById('timelineView').style.display = 'block';
        if (typeof loadTimeline === 'function') loadTimeline();
      } else if (view === 'excel_timeline') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        const excelTimelineViewEl = document.getElementById('excelTimelineView');
        if (excelTimelineViewEl) excelTimelineViewEl.style.display = 'block';
        if (typeof window.loadExcelTimeline === 'function') window.loadExcelTimeline();
      } else if (view === 'completed' || view === 'prod_complete') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        if (typeof loadCompletedPlans === 'function' && view === 'completed') loadCompletedPlans();
        if (view === 'prod_complete') {
          const productionView = document.getElementById('productionCompletionReport');
          if (productionView) productionView.style.display = 'block';
          if (typeof window.loadProductionCompletionReport === 'function') window.loadProductionCompletionReport();
        }
      } else if (view === 'mould_change') {
        if (vm) vm.style.display = 'none';
        if (kpiDeck) kpiDeck.style.display = 'none';
        if (mapWrap) mapWrap.style.display = 'none';
        if (dashboardToolbar) dashboardToolbar.style.display = 'none';
        const mouldChangeView = document.getElementById('mouldChangeReport');
        if (mouldChangeView) mouldChangeView.style.display = 'block';
        if (typeof window.loadMouldChangeReport === 'function') window.loadMouldChangeReport();
      } else {
        if (printJcEl) printJcEl.style.display = 'none';
        if (approvalEl) approvalEl.style.display = 'none';
        if (vm) vm.style.display = 'grid';
        if (kpiDeck) kpiDeck.style.display = 'grid';
        if (dashboardToolbar) dashboardToolbar.style.display = 'block';
        if (mapWrap) mapWrap.style.display = 'block';
        updatePlanningHeroClock();
        if (typeof loadMachines === 'function') {
          loadMachines();
        }
      }
      /* End Ensure Init Block */

      /* Re-apply Print Job Card after microtasks (motion/layout) so the view cannot be overwritten by async init */
      if (view === 'print_jc') {
        const _pjRoot = document.getElementById('pageContent');
        const _pjReapply = () => {
          if (_pjRoot && typeof window.applyPlanningPrintJcLayout === 'function') window.applyPlanningPrintJcLayout(_pjRoot);
          if (typeof window.switchView === 'function') window.switchView('print_jc');
        };
        _pjReapply();
        setTimeout(_pjReapply, 0);
        setTimeout(_pjReapply, 150);
      }

      // --- Admin-Only Enforcement (Delete All Button) - Post Render ---
      if (window.JPSMS && window.JPSMS.auth) {
        const u = window.JPSMS.auth.getUser();
        if (u && ((window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.isAdminLike && window.JPSMS.auth.isAdminLike(u)) || u.role_code === 'admin')) {
          const btnDel = document.getElementById('btnDeleteAll');
          if (btnDel) btnDel.style.display = 'inline-block';
        }
      }

    });