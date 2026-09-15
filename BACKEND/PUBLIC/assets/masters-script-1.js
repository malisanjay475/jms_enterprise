    // ... existing scripts ...

    // clearStdActual REMOVED
    let mouldMode = 'edit';
    const mouldFields = [
      'mould_number', 'mould_name', 'std_wt_kg', 'runner_weight',
      'primary_machine', 'secondary_machine', 'labour_job_machine',
      'moulding_sqn', 'consumption_ratio_qty', 'tonnage', 'no_of_cav', 'cycle_time', 'pcs_per_hour',
      'target_pcs_day', 'material', 'manpower', 'operator_activities', 'sfg_std_packing', 'sfg_bag_type', 'sfg_bag_size',
      'std_volume_cap'
    ];
    const mouldColumnTitles = {
      mould_number: 'MOULD NUMBER',
      mould_name: 'MOULD NAME',
      std_wt_kg: 'STD WT (KG)',
      runner_weight: 'RUNNER WEIGHT',
      primary_machine: 'PRIMARY MACHINE',
      secondary_machine: 'SECONDARY MACHINE',
      labour_job_machine: 'LABOUR JOB MACHINE',
      moulding_sqn: 'MOULDING SQN.',
      consumption_ratio_qty: 'CONSUMPTION RATIO(QTY)',
      tonnage: 'TONNAGE',
      no_of_cav: 'NO OF CAV',
      cycle_time: 'CYCLE TIME',
      pcs_per_hour: 'PCS/HOUR',
      target_pcs_day: 'TARGET PCS/DAY',
      material: 'MATERIAL',
      manpower: 'MANPOWER',
      operator_activities: 'OPERATOR ACTIVITIES',
      sfg_std_packing: 'SFG STD PACKING',
      sfg_bag_type: 'SFG BAG TYPE',
      sfg_bag_size: 'SFG BAG SIZE',
      std_volume_cap: 'STD VOLUME CAP.'
    };
    const orjrWiseSummaryColumns = [
      'or_jr_no', 'jr_date', 'our_code', 'bom_type', 'jr_item_name', 'jr_qty', 'uom',
      'mould_no', 'mould', 'mould_item_qty', 'tonnage', 'machine', 'cycle_time', 'cavity'
    ];
    const orjrWiseSummaryTitles = {
      or_jr_no: 'OR/JR No',
      jr_date: 'JR Date',
      our_code: 'Our Code',
      bom_type: 'BomType',
      jr_item_name: 'JR Item Name',
      jr_qty: 'JR Qty',
      uom: 'UOM',
      mould_no: 'Mould No',
      mould: 'Mould',
      mould_item_qty: 'Mould Item Qty',
      tonnage: 'Tonnage',
      machine: 'Machine',
      cycle_time: 'Cycle Time',
      cavity: 'Cavity'
    };
    const orjrWiseDetailColumns = [
      'or_jr_no', 'jr_date', 'our_code', 'bom_type', 'jr_item_name', 'jr_qty', 'uom',
      'mould_item_code', 'mould_item_name', 'mould_no', 'mould', 'mould_item_qty',
      'tonnage', 'machine', 'cycle_time', 'cavity'
    ];
    const orjrWiseDetailTitles = {
      or_jr_no: 'OR/JR No',
      jr_date: 'JR Date',
      our_code: 'Our Code',
      bom_type: 'BomType',
      jr_item_name: 'JR Item Name',
      jr_qty: 'JR Qty',
      uom: 'UOM',
      mould_item_code: 'Mold Item Code',
      mould_item_name: 'Mold Item Name',
      mould_no: 'Mould No',
      mould: 'Mould',
      mould_item_qty: 'Mould Item Qty',
      tonnage: 'Tonnage',
      machine: 'Machine',
      cycle_time: 'Cycle Time',
      cavity: 'Cavity'
    };
    const jcDetailColumns = [
      'or_jr_no', 'jr_date', 'jc_no', 'jc_id', 'jc_date', 'jc_qty', 'our_code', 'bom_type',
      'jr_item_name', 'jr_qty', 'uom', 'plan_date', 'plan_qty', 'mould_item_code', 'mould_item_name',
      'mould_no', 'mould', 'mould_item_qty', 'tonnage', 'machine', 'cycle_time', 'cavity'
    ];
    const jcDetailTitles = {
      or_jr_no: 'OR/JR No',
      jr_date: 'JR Date',
      jc_no: 'JC No',
      jc_id: 'JC ID',
      jc_date: 'JC Date',
      jc_qty: 'JC Qty',
      our_code: 'Our Code',
      bom_type: 'BomType',
      jr_item_name: 'JR Item Name',
      jr_qty: 'JR Qty',
      uom: 'UOM',
      plan_date: 'Plan Date',
      plan_qty: 'Plan Qty',
      mould_item_code: 'Mold Item Code',
      mould_item_name: 'Mold Item Name',
      mould_no: 'Mould No',
      mould: 'Mould',
      mould_item_qty: 'Mould Item Qty',
      tonnage: 'Tonnage',
      machine: 'Machine',
      cycle_time: 'Cycle Time',
      cavity: 'Cavity'
    };
    const boPlanningDetailColumns = [
      'or_jr_no', 'jr_date', 'our_code', 'bom_type', 'jr_item_name', 'jr_qty', 'uom',
      'plan_date', 'plan_qty', 'bo_item_code', 'bo_item_name', 'bo_uom', 'bo_item_qty', 'remarks_all'
    ];
    const boPlanningDetailTitles = {
      or_jr_no: 'OR/JR No',
      jr_date: 'JR Date',
      our_code: 'Our Code',
      bom_type: 'BomType',
      jr_item_name: 'JR Item Name',
      jr_qty: 'JR Qty',
      uom: 'UOM',
      plan_date: 'Plan Date',
      plan_qty: 'Plan Qty',
      bo_item_code: 'Bo Item Code',
      bo_item_name: 'Bo Item Name',
      bo_uom: 'Bo UOM',
      bo_item_qty: 'Bo Item Qty',
      remarks_all: 'Remarks'
    };
    const wipStockColumns = [
      'factory_name', 'stock_date', 'row_status', 'factory_unit', 'party_group', 'location_floor_dept',
      'item_code', 'item_name', 'job_no', 'job_date', 'ageing_period',
      'previous_stock_qty', 'current_stock_available_qty', 'current_live_qty', 'total_qty', 'uom',
      'remark_from_factory_unit', 'remark_from_ho_sales_team'
    ];
    const wipStockTitles = {
      stock_date: 'Stock Date',
      row_status: 'Row Status',
      factory_unit: 'Factory Unit',
      party_group: 'Party Group',
      location_floor_dept: 'Location/Floor/Dept',
      item_code: 'Item Code',
      item_name: 'Item Name',
      job_no: 'Job No.',
      job_date: 'Job Date',
      ageing_period: 'Ageing Period',
      previous_stock_qty: 'Previous Stock',
      current_stock_available_qty: 'Current Stock Available',
      current_live_qty: 'Current Live Qty',
      total_qty: 'Total Qty',
      uom: 'UOM',
      remark_from_factory_unit: 'Remark From Factory Unit',
      remark_from_ho_sales_team: 'Remark From HO/Sales Team'
    };
    const MACHINE_PROCESS_OPTIONS = ['Moulding', 'Tuffting', 'Printing'];

    function normalizeMachineProcessValue(value, fallback = 'Moulding') {
      const raw = String(value || '').trim();
      if (!raw) return fallback;
      const normalized = raw.toLowerCase().replace(/\s+/g, '');
      if (['moulding', 'molding'].includes(normalized)) return 'Moulding';
      if (['tuffting', 'tufting', 'tuf', 'tuft'].includes(normalized)) return 'Tuffting';
      if (['printing', 'print'].includes(normalized)) return 'Printing';
      if (['labourjob', 'laborjob', 'labour', 'labor'].includes(normalized)) return 'Labour Job';
      return fallback;
    }

    function getSelectedMachineProcessFilter() {
      const selected = document.getElementById('machineProcessFilter')?.value || '';
      return normalizeMachineProcessValue(selected, '');
    }

    function isPrintingMachineView() {
      return currentType === 'machines' && getSelectedMachineProcessFilter() === 'Printing';
    }

    function updateMachineSearchPlaceholder() {
      const filterSearch = document.getElementById('filterSearch');
      if (!filterSearch || currentType !== 'machines') return;
      filterSearch.placeholder = isPrintingMachineView()
        ? 'Machine number, vendor, model, machine type...'
        : 'Machine, process, building, line...';
    }

    function updateMachineModalProcessView(processValue) {
      const normalizedProcess = normalizeMachineProcessValue(processValue, 'Moulding');
      const standardFields = document.getElementById('machineStandardFields');
      const printingFields = document.getElementById('machinePrintingFields');
      const labourFields = document.getElementById('machineLabourFields');
      const machineLabel = document.getElementById('m_machine_label');
      const machineInput = document.getElementById('m_machine');

      if (machineLabel) machineLabel.textContent = normalizedProcess === 'Printing' ? 'Machine Number' : 'Machine Name';
      if (machineInput) {
        machineInput.placeholder = normalizedProcess === 'Printing' ? 'Enter machine number' : 'Enter machine name';
      }
      // Labour Job hides both standard and printing fields
      if (standardFields) standardFields.style.display = (normalizedProcess === 'Printing' || normalizedProcess === 'Labour Job') ? 'none' : 'block';
      if (printingFields) printingFields.style.display = normalizedProcess === 'Printing' ? 'block' : 'none';
      if (labourFields) {
        if (normalizedProcess === 'Labour Job') {
          labourFields.style.display = 'block';
          // Populate party dropdown if empty
          const partySelect = document.getElementById('m_labour_party_id');
          if (partySelect && partySelect.options.length <= 1) {
            JPSMS.api.get('/labour-parties').then(res => {
              if (res.ok) {
                (res.data || []).forEach(p => {
                  const opt = document.createElement('option');
                  opt.value = p.id;
                  opt.textContent = p.party_name;
                  partySelect.appendChild(opt);
                });
              }
            }).catch(() => {});
          }
          // Populate factory dropdown from allowedFactories global
          const factorySelect = document.getElementById('m_lj_factory_id');
          if (factorySelect && factorySelect.options.length <= 1 && window.allowedFactories && window.allowedFactories.length) {
            window.allowedFactories.forEach(f => {
              const opt = document.createElement('option');
              opt.value = f.id;
              opt.textContent = f.name || f.code || `Factory ${f.id}`;
              factorySelect.appendChild(opt);
            });
          }
        } else {
          labourFields.style.display = 'none';
        }
      }
    }

    function openMouldModal(mode, data) {
      if (!ensureSingleFactoryScope(mode === 'add' ? 'add moulds' : 'edit moulds')) return;
      mouldMode = mode;
      document.getElementById('mouldModal').style.display = 'flex';
      document.getElementById('mouldModalTitle').textContent = mode === 'add' ? 'Add New Mould' : 'Edit Mould';

      const f = document.getElementById('mouldForm');
      f.reset();

      if (data) {
        mouldFields.forEach(k => {
          const el = document.getElementById('mould_' + k);
          if (el) el.value = data[k] !== undefined && data[k] !== null ? data[k] : '';
        });
        // ALLOW EDITING
        document.getElementById('mould_original_id').value = data.mould_number || '';
        document.getElementById('mould_mould_number').readOnly = false;
      } else {
        document.getElementById('mould_original_id').value = '';
        document.getElementById('mould_mould_number').readOnly = false;
      }
      loadMachineList();
      loadLabourJobMachineList();
    }

    // Auto-calc PCS/HOUR and Target PCS/DAY from Cycle Time and No. of Cavities.
    // PCS/HOUR = (3600 / cycle_time) * cavity   (rounded down)
    // Target PCS/DAY = PCS/HOUR * 23 running hours
    function recalcMouldOutput() {
      const cycle = parseFloat(document.getElementById('mould_cycle_time').value);
      const cavRaw = parseFloat(document.getElementById('mould_no_of_cav').value);
      const cav = (isNaN(cavRaw) || cavRaw <= 0) ? 1 : cavRaw;
      const pcsEl = document.getElementById('mould_pcs_per_hour');
      const targetEl = document.getElementById('mould_target_pcs_day');
      if (isNaN(cycle) || cycle <= 0) {
        pcsEl.value = '';
        targetEl.value = '';
        return;
      }
      const pcsPerHour = Math.floor((3600 / cycle) * cav);
      pcsEl.value = pcsPerHour;
      targetEl.value = pcsPerHour * 23;
    }

    async function loadLabourJobMachineList() {
      const list = document.getElementById('labourJobMachineList');
      if (!list || list.children.length > 0) return;
      try {
        const res = await JPSMS.api.get('/labour-parties');
        if (res.ok) {
          const parties = res.data || [];
          const seen = new Set();
          const opts = [];
          parties.forEach(p => (p.machines || []).forEach(m => {
            if (m.machine && !seen.has(m.machine)) { seen.add(m.machine); opts.push(m.machine); }
          }));
          list.innerHTML = opts.map(m => `<option value="${m}">`).join('');
        }
      } catch (e) {
        console.error('loadLabourJobMachineList', e);
      }
    }

    async function loadMachineList() {
      if (document.getElementById('machineList').children.length > 0) return;
      try {
        const res = await JPSMS.api.get('/masters/machines?process=Moulding');
        if (res.ok) {
          const list = document.getElementById('machineList');
          const sorted = (res.data || []).slice().sort((a, b) => {
            const la = String(a.line || '').trim(), lb = String(b.line || '').trim();
            const ba = la.charAt(0) || 'Z', bb = lb.charAt(0) || 'Z';
            if (ba !== bb) return ba.localeCompare(bb);
            const lna = parseInt((la.match(/L(\d+)/i) || [0,0])[1], 10) || 999;
            const lnb = parseInt((lb.match(/L(\d+)/i) || [0,0])[1], 10) || 999;
            if (lna !== lnb) return lna - lnb;
            const na = parseInt((a.machine.match(/(\d+)$/) || [0,0])[1], 10) || 999;
            const nb = parseInt((b.machine.match(/(\d+)$/) || [0,0])[1], 10) || 999;
            return na - nb;
          });
          list.innerHTML = sorted.map(m => {
            const line = String(m.line || '').trim();
            // If machine already has ">" (line prefix stored in machine column), or if it starts with the line name, use as-is
            const startsWithLine = line && m.machine.replace(/\s+/g, '').toLowerCase().startsWith(line.replace(/\s+/g, '').toLowerCase());
            const display = (m.machine.includes('>') || startsWithLine) ? m.machine : (line ? `${line}>${m.machine}` : m.machine);
            return `<option value="${display}">`;
          }).join('');
        }
      } catch (e) {
        console.error(e);
      }
    }

    // Multi-select Picker Logic
    document.addEventListener('DOMContentLoaded', () => {
      const picker = document.getElementById('mould_sec_picker');
      if (picker) {
        picker.addEventListener('change', function () {
          const val = this.value;
          if (!val) return;

          // Optional: Check if valid machine (client-side)
          // const opts = Array.from(document.getElementById('machineList').options).map(o => o.value);
          // if (!opts.includes(val)) return; 

          const main = document.getElementById('mould_secondary_machine');
          if (main.value) {
            // Check duplicate
            const parts = main.value.split(',').map(s => s.trim());
            if (!parts.includes(val)) {
              main.value += ', ' + val;
            }
          } else {
            main.value = val;
          }
          this.value = ''; // Reset picker
        });
      }
    });

    async function saveMould() {
      if (!ensureSingleFactoryScope('save mould changes')) return;
      const payload = {};
      mouldFields.forEach(k => {
        const el = document.getElementById('mould_' + k);
        if (el) payload[k] = el.value;
      });

      // Audit User
      payload._user = JPSMS.auth.getUser().username || 'Unknown';

      try {
        let res;
        if (mouldMode === 'add') {
          res = await JPSMS.api.post('/moulds', payload);
        } else {
          const originalId = document.getElementById('mould_original_id').value;
          res = await JPSMS.api.put('/moulds/' + encodeURIComponent(originalId), payload);
        }
        alert(res.message);
        document.getElementById('mouldModal').style.display = 'none';
        loadMasterData();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    /* ============================================================
       MOULD VERIFICATION (strict 6-step badge workflow)
       PPC -> Quality -> Moulding -> Tool Room -> GM Approve -> NKB Authorise.
       Server enforces order + role; the UI mirrors it so only the eligible
       next step is actionable for the current user.
    ============================================================ */
    const MOULD_VERIFY_STEPS = [
      { key: 'ppc',      col: 'ppc',      label: 'PPC Check',              roles: ['ppc_manager', 'ppc_ass_manager'] },
      { key: 'quality',  col: 'quality',  label: 'Quality Check',          roles: ['quality', 'quality_ass__manager'] },
      { key: 'moulding', col: 'moulding', label: 'Moulding Check',         roles: ['moulding_manager', 'moulding_ass_manager'] },
      { key: 'toolroom', col: 'toolroom', label: 'Tool Room Check',        roles: ['toolroom_manager'] },
      { key: 'gm',       col: 'gm',       label: 'General Manager Approve', roles: ['general_manager'] },
      { key: 'nkb',      col: 'nkb',      label: 'NKB Authorise',          roles: [] } // superadmin only
    ];

    // How many of the ordered steps are stamped, and whether fully verified.
    function mouldVerifyProgress(row) {
      let done = 0;
      for (const s of MOULD_VERIFY_STEPS) {
        if (row['verify_' + s.col + '_at']) done++; else break;
      }
      return { done, total: MOULD_VERIFY_STEPS.length, verified: !!row.verify_nkb_at };
    }

    function currentUserCanVerifyStep(step) {
      const u = JPSMS.auth.getUser() || {};
      const role = String(u.role_code || '').toLowerCase();
      if (role === 'superadmin') return true;
      if (step.key === 'nkb') return false;
      if (role === 'admin') return true;
      return step.roles.includes(role);
    }

    let _mvCurrentMouldNumber = null;

    function openMouldVerifyModal(row) {
      _mvCurrentMouldNumber = row.mould_number;
      document.getElementById('mvMouldTitle').textContent =
        `${row.mould_number || ''}${row.mould_name ? ' — ' + row.mould_name : ''}`;
      renderMouldVerifySteps(row);
      const u = JPSMS.auth.getUser() || {};
      const isSuper = String(u.role_code || '').toLowerCase() === 'superadmin';
      const resetBtn = document.getElementById('mvResetBtn');
      const anyDone = MOULD_VERIFY_STEPS.some(s => row['verify_' + s.col + '_at']);
      resetBtn.style.display = (isSuper && anyDone) ? 'inline-block' : 'none';
      document.getElementById('mouldVerifyModal').style.display = 'flex';
    }

    function renderMouldVerifySteps(row) {
      const prog = mouldVerifyProgress(row);
      const banner = document.getElementById('mvBadgeBanner');
      banner.style.display = prog.verified ? 'flex' : 'none';

      const writeAllowed = (typeof jmsMouldWriteAllowed === 'function') ? jmsMouldWriteAllowed() : true;
      const html = MOULD_VERIFY_STEPS.map((s, i) => {
        const at = row['verify_' + s.col + '_at'];
        const by = row['verify_' + s.col + '_by'];
        const isDone = !!at;
        const isNext = !isDone && i === prog.done;
        const canAct = isNext && writeAllowed && currentUserCanVerifyStep(s);

        let right = '';
        if (isDone) {
          right = `<span style="color:#166534; font-size:0.72rem; text-align:right">
                     <i class="bi bi-check-circle-fill"></i> ${by || ''}<br>
                     <span style="color:#94a3b8">${new Date(at).toLocaleString()}</span>
                   </span>`;
        } else if (canAct) {
          right = `<button onclick="openMouldVerifyDetail('${s.key}')" class="btn-action"
                     style="padding:5px 14px; font-size:0.76rem; background:#2563eb">Approve</button>`;
        } else if (isNext) {
          right = `<span style="color:#94a3b8; font-size:0.72rem">Awaiting ${s.label}</span>`;
        } else {
          right = `<span style="color:#cbd5e1; font-size:0.72rem"><i class="bi bi-lock-fill"></i> Locked</span>`;
        }

        const circleBg = isDone ? '#16a34a' : (isNext ? '#2563eb' : '#e2e8f0');
        const circleColor = (isDone || isNext) ? '#fff' : '#94a3b8';
        return `
          <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; border:1px solid ${isNext ? '#bfdbfe' : '#e2e8f0'}; border-radius:8px; background:${isDone ? '#f0fdf4' : (isNext ? '#eff6ff' : '#f8fafc')}">
            <div style="width:26px; height:26px; border-radius:50%; background:${circleBg}; color:${circleColor}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.8rem; flex:0 0 auto">${isDone ? '<i class=\"bi bi-check-lg\"></i>' : (i + 1)}</div>
            <div style="flex:1"><div style="font-weight:600; font-size:0.86rem; color:#0f172a">${s.label}</div></div>
            <div>${right}</div>
          </div>`;
      }).join('');
      document.getElementById('mvSteps').innerHTML = html;
    }

    async function submitMouldVerifyStep(stepKey) {
      if (!_mvCurrentMouldNumber) return;
      const step = MOULD_VERIFY_STEPS.find(s => s.key === stepKey);
      if (!step) return;
      if (!confirm(`Confirm "${step.label}" for mould ${_mvCurrentMouldNumber}?`)) return;
      try {
        const res = await JPSMS.api.post(
          '/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/verify',
          { step: stepKey, session: JPSMS.auth.getUser() }
        );
        alert(res.message || 'Done');
        document.getElementById('mouldVerifyModal').style.display = 'none';
        loadMasterData();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function resetMouldVerify() {
      if (!_mvCurrentMouldNumber) return;
      if (!confirm(`Reset the ENTIRE verification chain for mould ${_mvCurrentMouldNumber}? All 6 steps must be redone.`)) return;
      try {
        const res = await JPSMS.api.post(
          '/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/verify/reset',
          { session: JPSMS.auth.getUser() }
        );
        alert(res.message || 'Reset');
        document.getElementById('mouldVerifyModal').style.display = 'none';
        loadMasterData();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    /* ---- Verification Detail modal (read-only master + history + notes + confirm) ---- */
    let _mvdStepKey = null;

    function mvEsc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    async function openMouldVerifyDetail(stepKey) {
      if (!_mvCurrentMouldNumber) return;
      _mvdStepKey = stepKey;
      const step = MOULD_VERIFY_STEPS.find(s => s.key === stepKey);
      document.getElementById('mvdTitle').textContent = 'Verification — ' + (step ? step.label : 'Review');
      document.getElementById('mvdMouldTitle').textContent = '';
      document.getElementById('mvdMasterGrid').innerHTML = '';
      document.getElementById('mvdNotes').innerHTML = '';
      document.getElementById('mvdNoteInput').value = '';
      document.getElementById('mvdHistory').innerHTML = 'Loading…';
      document.getElementById('mvdConfirmLabel').textContent = 'Confirm ' + (step ? step.label : 'Approval');
      document.getElementById('mouldVerifyDetailModal').style.display = 'flex';

      try {
        const res = await JPSMS.api.get('/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/verify-detail');
        if (!res.ok) throw new Error(res.error);
        renderVerifyDetail(res.data);
      } catch (e) {
        document.getElementById('mvdMasterGrid').innerHTML = `<span style="color:#dc2626">Failed to load: ${mvEsc(e.message)}</span>`;
      }
      // History loads independently so a DPR hiccup doesn't block approval.
      try {
        const h = await JPSMS.api.get('/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/moulding-history');
        if (h.ok) renderMouldingHistory(h.data);
        else document.getElementById('mvdHistory').innerHTML = '<span style="color:#94a3b8">No history available.</span>';
      } catch (_) {
        document.getElementById('mvdHistory').innerHTML = '<span style="color:#94a3b8">No history available.</span>';
      }
    }

    function renderVerifyDetail(data) {
      const m = data.mould || {};
      document.getElementById('mvdMouldTitle').textContent =
        `${m.mould_number || ''}${m.mould_name ? ' — ' + m.mould_name : ''}`;
      // Read-only master fields (plain text, no inputs => cannot be edited here).
      document.getElementById('mvdMasterGrid').innerHTML = mouldFields.map(k => {
        const label = mouldColumnTitles[k] || k.replace(/_/g, ' ').toUpperCase();
        const val = m[k];
        return `<div style="padding:5px 0; border-bottom:1px solid #f1f5f9">
                  <div style="font-size:0.64rem; color:#94a3b8; letter-spacing:0.02em">${label}</div>
                  <div style="color:#0f172a; font-weight:600">${val == null || val === '' ? '—' : mvEsc(val)}</div>
                </div>`;
      }).join('');
      renderVerifyNotes(data.notes || []);
    }

    function renderVerifyNotes(notes) {
      const wrap = document.getElementById('mvdNotes');
      if (!notes.length) {
        wrap.innerHTML = '<span style="color:#94a3b8; font-size:0.76rem">No details added yet.</span>';
        return;
      }
      const stepLabel = k => (MOULD_VERIFY_STEPS.find(s => s.key === k) || {}).label || k;
      wrap.innerHTML = notes.map(n => `
        <div style="border:1px solid #e2e8f0; border-radius:6px; padding:7px 10px; background:#f8fafc">
          <div style="font-size:0.82rem; color:#0f172a; white-space:pre-wrap">${mvEsc(n.note)}</div>
          <div style="font-size:0.66rem; color:#94a3b8; margin-top:3px">${mvEsc(stepLabel(n.step))} · ${mvEsc(n.created_by || '')} · ${new Date(n.created_at).toLocaleString()}</div>
        </div>`).join('');
    }

    function renderMouldingHistory(data) {
      const blocks = [['d7', 'Last 7 Days'], ['d30', 'Last 30 Days']]
        .filter(([k]) => data[k])
        .map(([k, title]) => {
          const w = data[k];
          const t = w.totals || {};
          const daily = (w.daily || []).map(r => `
            <tr>
              <td style="padding:3px 8px">${new Date(r.d).toLocaleDateString()}</td>
              <td style="padding:3px 8px; text-align:right">${Number(r.good).toLocaleString('en-IN')}</td>
              <td style="padding:3px 8px; text-align:right">${Number(r.reject).toLocaleString('en-IN')}</td>
              <td style="padding:3px 8px; text-align:right">${Number(r.downtime).toLocaleString('en-IN')}</td>
              <td style="padding:3px 8px; text-align:right">${r.machines}</td>
            </tr>`).join('');
          const machines = (w.byMachine || []).slice(0, 8).map(mm =>
            `<span style="display:inline-block; margin:2px 4px 0 0; padding:2px 8px; border-radius:999px; background:#eef2ff; color:#3730a3; font-size:0.68rem">${mvEsc(mm.machine || 'Unassigned')}: ${Number(mm.good).toLocaleString('en-IN')}</span>`
          ).join('');
          return `
            <div style="flex:1; min-width:320px; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px">
              <div style="font-weight:700; color:#0f172a; margin-bottom:6px">${title}</div>
              <div style="display:flex; flex-wrap:wrap; gap:10px; font-size:0.74rem; margin-bottom:8px">
                <span>Good: <b style="color:#166534">${Number(t.good || 0).toLocaleString('en-IN')}</b></span>
                <span>Reject: <b style="color:#b91c1c">${Number(t.reject || 0).toLocaleString('en-IN')}</b></span>
                <span>Reject %: <b>${t.rejectPct || 0}%</b></span>
                <span>Downtime: <b>${Number(t.downtime || 0).toLocaleString('en-IN')} min</b></span>
                <span>Active days: <b>${t.activeDays || 0}</b></span>
                <span>Machines: <b>${t.machines || 0}</b></span>
              </div>
              ${machines ? `<div style="margin-bottom:8px">${machines}</div>` : ''}
              ${daily
                ? `<div style="max-height:150px; overflow:auto; border-top:1px solid #f1f5f9">
                     <table style="width:100%; border-collapse:collapse; font-size:0.72rem">
                       <thead><tr style="color:#94a3b8; text-align:left">
                         <th style="padding:3px 8px">Date</th><th style="padding:3px 8px; text-align:right">Good</th>
                         <th style="padding:3px 8px; text-align:right">Reject</th><th style="padding:3px 8px; text-align:right">Downtime</th>
                         <th style="padding:3px 8px; text-align:right">Mc</th>
                       </tr></thead><tbody>${daily}</tbody>
                     </table>
                   </div>`
                : '<div style="color:#94a3b8; font-size:0.74rem">No production recorded in this period.</div>'}
            </div>`;
        });
      document.getElementById('mvdHistory').innerHTML =
        `<div style="display:flex; gap:12px; flex-wrap:wrap">${blocks.join('')}</div>`;
    }

    async function addMouldVerifyNote() {
      if (!_mvCurrentMouldNumber || !_mvdStepKey) return;
      const note = document.getElementById('mvdNoteInput').value.trim();
      if (!note) { alert('Please type a detail to add.'); return; }
      try {
        const res = await JPSMS.api.post(
          '/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/verify-note',
          { step: _mvdStepKey, note, session: JPSMS.auth.getUser() }
        );
        if (!res.ok) throw new Error(res.error);
        document.getElementById('mvdNoteInput').value = '';
        // Reload just the notes.
        const d = await JPSMS.api.get('/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/verify-detail');
        if (d.ok) renderVerifyNotes(d.data.notes || []);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function confirmMouldVerifyFromDetail() {
      if (!_mvCurrentMouldNumber || !_mvdStepKey) return;
      const step = MOULD_VERIFY_STEPS.find(s => s.key === _mvdStepKey);
      if (!confirm(`Confirm "${step ? step.label : 'this step'}" for mould ${_mvCurrentMouldNumber}? This cannot be undone (only Superadmin can reset).`)) return;
      try {
        const res = await JPSMS.api.post(
          '/moulds/' + encodeURIComponent(_mvCurrentMouldNumber) + '/verify',
          { step: _mvdStepKey, session: JPSMS.auth.getUser() }
        );
        alert(res.message || 'Done');
        document.getElementById('mouldVerifyDetailModal').style.display = 'none';
        document.getElementById('mouldVerifyModal').style.display = 'none';
        loadMasterData();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function viewMouldHistory(id) {
      try {
        const res = await JPSMS.api.get('/moulds/history/' + encodeURIComponent(id));
        if (!res.ok) throw new Error(res.error);

        const tbody = document.getElementById('historyBody');
        tbody.innerHTML = res.data.map(r => {
          // Beautify Changes
          let chgHtml = '';
          try {
            const chg = typeof r.changed_fields === 'string' ? JSON.parse(r.changed_fields) : r.changed_fields;
            if (chg.message) {
              chgHtml = `<span style="color:green">${chg.message}</span>`;
            } else {
              chgHtml = Object.keys(chg).map(k => {
                const oldV = chg[k].old !== undefined ? chg[k].old : '(empty)';
                const newV = chg[k].new;
                // Beautify Key
                const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `<div style="font-size:0.75rem"><b>${label}:</b> ${oldV} &rarr; <span style="color:blue;font-weight:bold">${newV}</span></div>`;
              }).join('');
            }
          } catch (e) { chgHtml = String(r.changed_fields); }

          return `
               <tr>
                 <td>${new Date(r.changed_at).toLocaleString()}</td>
                 <td>${r.changed_by}</td>
                 <td>${r.action_type}</td>
                 <td>${chgHtml}</td>
               </tr>
             `;
        }).join('');

        document.getElementById('historyModal').style.display = 'flex';
      } catch (e) { alert(e.message); }
    }

    async function viewMachineHistory(encodedMachineId) {
      try {
        const res = await JPSMS.api.get('/machines/history/' + encodedMachineId);
        if (!res.ok) throw new Error(res.error);

        const rows = Array.isArray(res.data) ? res.data : [];
        const tbody = document.getElementById('historyBody');

        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#64748b">No machine history found.</td></tr>`;
          document.getElementById('historyModal').style.display = 'flex';
          return;
        }

        tbody.innerHTML = rows.map(r => {
          let chgHtml = '';
          try {
            const chg = typeof r.changed_fields === 'string' ? JSON.parse(r.changed_fields) : (r.changed_fields || {});
            if (chg.message) {
              chgHtml = `<span style="color:green">${chg.message}</span>`;
            } else {
              chgHtml = Object.keys(chg).map(k => {
                const oldV = chg[k].old !== undefined ? chg[k].old : '(empty)';
                const newV = chg[k].new !== undefined ? chg[k].new : '(empty)';
                const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `<div style="font-size:0.75rem"><b>${label}:</b> ${oldV} &rarr; <span style="color:blue;font-weight:bold">${newV}</span></div>`;
              }).join('');
            }
          } catch (e) {
            chgHtml = String(r.changed_fields || '');
          }

          return `
               <tr>
                 <td>${new Date(r.changed_at).toLocaleString()}</td>
                 <td>${r.changed_by || '-'}</td>
                 <td>${r.action_type}</td>
                 <td>${chgHtml}</td>
               </tr>
             `;
        }).join('');

        document.getElementById('historyModal').style.display = 'flex';
      } catch (e) { alert(e.message); }
    }

    function closeOrderCompletionHistoryModal() {
      const modal = document.getElementById('orderCompletionHistoryModal');
      if (modal) modal.style.display = 'none';
    }

    async function openOrderCompletionHistory(orderNo = '', factoryId = '') {
      if (!JPSMS.auth.isAdminLike()) {
        JPSMS.toast('Only Admin or Superadmin can view completion history.', 'error');
        return;
      }

      const modal = document.getElementById('orderCompletionHistoryModal');
      const body = document.getElementById('orderCompletionHistoryBody');
      const title = document.getElementById('orderCompletionHistoryTitle');
      const summary = document.getElementById('orderCompletionHistorySummary');

      try {
        if (body) {
          body.innerHTML = `<tr><td colspan="6" style="padding:24px; text-align:center; color:#64748b;">Loading completion history...</td></tr>`;
        }
        if (title) {
          title.textContent = orderNo ? `Completion history for ${orderNo}` : 'Recent completion confirmations';
        }
        if (summary) {
          summary.textContent = orderNo
            ? 'Date-wise status changes, confirmations, and restores for the selected order.'
            : 'Date-wise status changes across the allowed factory scope.';
        }
        modal.style.display = 'flex';

        const qs = new URLSearchParams();
        if (orderNo) qs.set('order_no', orderNo);
        if (factoryId) qs.set('factory_id', factoryId);

        const res = await JPSMS.api.get('/orders/completion-history' + (qs.toString() ? `?${qs.toString()}` : ''));
        if (!res.ok) throw new Error(res.error || 'Unable to load completion history');

        const rows = Array.isArray(res.data) ? res.data : [];
        if (!rows.length) {
          body.innerHTML = `<tr><td colspan="6" style="padding:24px; text-align:center; color:#64748b;">No completion history found yet.</td></tr>`;
          return;
        }

        body.innerHTML = rows.map(row => {
          const canRestore = String(row.action_type || '').toUpperCase() === 'CONFIRMED_COMPLETE'
            || String(row.master_status_after || '').toLowerCase() === 'completed';
          const details = [
            row.summary_text || '-',
            row.change_to ? `To: ${row.change_to}` : '',
            row.master_status_before || row.master_status_after
              ? `Master: ${row.master_status_before || '-'} -> ${row.master_status_after || '-'}`
              : ''
          ].filter(Boolean).join('<br>');
          return `
            <tr>
              <td>${row.changed_at ? moment(row.changed_at).format('DD-MMM-YYYY hh:mm A') : '-'}</td>
              <td>${row.factory_name || '-'}</td>
              <td>${row.actor_name || 'System'}</td>
              <td>
                <span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:${canRestore ? '#eff6ff' : '#f8fafc'}; color:${canRestore ? '#1d4ed8' : '#475569'}; font-weight:700; font-size:0.74rem;">
                  ${row.action_type || 'UPDATED'}
                </span>
              </td>
              <td style="min-width:260px; color:#334155; line-height:1.45;">${details}</td>
              <td>
                ${canRestore
                  ? `<button onclick="restoreOrderCompletion(${row.id})" class="btn-action" style="padding:4px 10px; background:#0f766e;"><i class="bi bi-arrow-counterclockwise"></i> Restore</button>`
                  : `<span style="color:#94a3b8;">-</span>`}
              </td>
            </tr>
          `;
        }).join('');
      } catch (e) {
        if (body) {
          body.innerHTML = `<tr><td colspan="6" style="padding:24px; text-align:center; color:#dc2626;">${e.message}</td></tr>`;
        }
      }
    }

    async function confirmOrderCompletion(orderNo, factoryId) {
      if (!orderNo) return;
      if (!ensureSingleFactoryScope('confirm an order completion')) return;
      if (!confirm(`Confirm completion for ${orderNo}?\n\nThis will mark the order completed and remove it from the active Order Master list.`)) return;

      try {
        const res = await JPSMS.api.post('/orders/confirm-completion', {
          order_no: orderNo,
          factory_id: factoryId || null
        });
        if (!res.ok) throw new Error(res.error || 'Unable to confirm completion');
        JPSMS.toast(res.message || 'Order confirmed successfully.', 'success');
        loadMasterData();
      } catch (e) {
        JPSMS.toast(e.message, 'error');
      }
    }

    /* ── Superadmin: Confirm ALL pending orders at once ── */
    async function confirmAllOrders() {
      if (!JPSMS.auth.isSuperadmin()) return;
      if (!ensureSingleFactoryScope('confirm all orders')) return;

      // Gather all rows currently awaiting confirmation from the table
      const pending = [];
      if (masterTable) {
        masterTable.rows().every(function () {
          const d = this.data();
          if (d && d.completion_confirmation_required === true) {
            pending.push({ orderNo: d.or_jr_no || d.order_no || '', factoryId: d.factory_id || null });
          }
        });
      }

      if (pending.length === 0) {
        JPSMS.toast('No orders awaiting confirmation.', 'info');
        return;
      }

      if (!confirm(`Confirm ALL ${pending.length} pending order${pending.length > 1 ? 's' : ''} at once?\n\nThis will mark all of them as completed and remove them from the active Order Master list.`)) return;

      const btn = document.getElementById('confirmAllBtn');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Confirming…'; }

      let done = 0, failed = 0;
      for (const { orderNo, factoryId } of pending) {
        try {
          const res = await JPSMS.api.post('/orders/confirm-completion', { order_no: orderNo, factory_id: factoryId });
          if (res.ok) done++; else failed++;
        } catch { failed++; }
      }

      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-all"></i> Confirm All'; }

      if (failed === 0) {
        JPSMS.toast(`✅ ${done} order${done > 1 ? 's' : ''} confirmed successfully.`, 'success');
      } else {
        JPSMS.toast(`Confirmed ${done}, failed ${failed}. Reload to check.`, 'warning');
      }
      loadMasterData();
    }

    async function restoreOrderCompletion(historyId) {
      if (!historyId) return;
      if (!confirm('Restore this completed order back into Order Master?')) return;

      try {
        const res = await JPSMS.api.post('/orders/restore-completion', {
          history_id: historyId
        });
        if (!res.ok) throw new Error(res.error || 'Unable to restore completion');
        JPSMS.toast(res.message || 'Order restored successfully.', 'success');
        await openOrderCompletionHistory();
        if (currentType === 'orders') {
          loadMasterData();
        }
      } catch (e) {
        JPSMS.toast(e.message, 'error');
      }
    }

    async function setOrderPriority(orderNo, factoryId, priority) {
      if (!orderNo || !priority) return;
      if (!ensureSingleFactoryScope('change order priority')) return;

      const normalizedPriority = String(priority).trim();
      const label = normalizedPriority === 'High' ? 'High Priority' : normalizedPriority;
      if (!confirm(`Set ${orderNo} as ${label}?`)) return;

      try {
        const res = await JPSMS.api.post('/orders/priority', {
          order_no: orderNo,
          factory_id: factoryId || null,
          priority: normalizedPriority
        });
        if (!res.ok) throw new Error(res.error || 'Unable to update priority');
        JPSMS.toast(res.message || 'Priority updated.', 'success');
        if (currentType === 'orders') loadMasterData();
      } catch (e) {
        JPSMS.toast(e.message, 'error');
      }
    }

    // --- Order Plan View Modal ---
    window.viewOrderPlan = function (orderNo, detailsEncoded) {
      const details = JSON.parse(decodeURIComponent(detailsEncoded));

      // Build Markup
      const modalId = 'orderPlanModal';
      const old = document.getElementById(modalId);
      if (old) old.remove();

      let rowsHtml = '';
      if (!details.length) {
        rowsHtml = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#64748b">No active plans found for this order.</td></tr>';
      } else {
        rowsHtml = details.map(d => `
            <tr style="border-bottom:1px solid #e2e8f0">
               <td style="padding:8px">${d.mould || '-'}</td>
               <td style="padding:8px; font-weight:600">${d.machine || '-'}</td>
               <td style="padding:8px">${d.startDate ? new Date(d.startDate).toLocaleDateString() : '-'}</td>
               <td style="padding:8px"><span class="tag ${d.status}">${d.status}</span></td>
            </tr>
          `).join('');
      }

      const mk = `
       <div id="${modalId}" style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px)">
           <div style="background:white; border-radius:12px; width:600px; max-width:95%; overflow:hidden; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); animation: popIn 0.2s ease-out">
               <div style="padding:16px 24px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center">
                  <div style="font-weight:700; color:#0f172a; font-size:1.1rem">Plan Details: ${orderNo}</div>
                  <button onclick="document.getElementById('${modalId}').remove()" style="border:none; background:none; cursor:pointer; font-size:1.2rem">&times;</button>
               </div>
               <div style="padding:0; max-height:60vh; overflow-y:auto">
                   <table style="width:100%; border-collapse:collapse; font-size:0.85rem">
                       <thead style="background:#f1f5f9; position:sticky; top:0">
                          <tr>
                             <th style="padding:8px; text-align:left; color:#64748b; font-size:0.75rem; text-transform:uppercase">Mould</th>
                             <th style="padding:8px; text-align:left; color:#64748b; font-size:0.75rem; text-transform:uppercase">Machine</th>
                             <th style="padding:8px; text-align:left; color:#64748b; font-size:0.75rem; text-transform:uppercase">Start Date</th>
                             <th style="padding:8px; text-align:left; color:#64748b; font-size:0.75rem; text-transform:uppercase">Status</th>
                          </tr>
                       </thead>
                       <tbody>
                          ${rowsHtml}
                       </tbody>
                   </table>
               </div>
               <div style="padding:16px 24px; border-top:1px solid #e2e8f0; text-align:right">
                   <button onclick="document.getElementById('${modalId}').remove()" class="btn-action">Close</button>
               </div>
           </div>
       </div>`;

      document.body.insertAdjacentHTML('beforeend', mk);
    };

    // --- Plant Closure Logic ---
    window.openPlantClosureModal = async function() {
      document.getElementById('pc-date').valueAsDate = new Date();
      document.getElementById('plantClosureModal').style.display = 'flex';
      
      // Populate dropdown dynamically with plants and lines
      try {
          const res = await JPSMS.api.get('/machines');
          const sel = document.getElementById('pc-plant');
          sel.innerHTML = '<option value="All">All Plants (Factory Shutdown)</option>';
          
          const ogPlants = document.createElement('optgroup');
          ogPlants.label = 'Plants';
          ['B', 'C', 'E', 'F'].forEach(p => ogPlants.appendChild(new Option('Plant ' + p, p)));
          sel.appendChild(ogPlants);
          
          if (res.ok && res.data && res.data.length > 0) {
              const lines = [...new Set(res.data.map(m => m.line).filter(Boolean))].sort();
              if (lines.length > 0) {
                  const ogLines = document.createElement('optgroup');
                  ogLines.label = 'Specific Lines';
                  lines.forEach(l => ogLines.appendChild(new Option('Line ' + l, l)));
                  sel.appendChild(ogLines);
              }
          }
      } catch(e) { console.error('Error loading lines for closure modal', e); }

      loadPlantClosures();
    };

    async function loadPlantClosures() {
      try {
        const res = await JPSMS.api.get('/admin/closed-plants');
        if (!res.ok) throw new Error(res.error);
        
        const body = document.getElementById('plantClosureBody');
        body.innerHTML = res.data.map(r => `
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:10px">${moment(r.dpr_date_str || r.dpr_date).format('DD MMM YYYY')}</td>
            <td style="padding:10px"><span style="font-weight:700; color:#be185d">${r.plant === 'All' ? 'All Plants' : r.plant.includes('-') ? 'Line ' + r.plant : 'Plant ' + r.plant}</span></td>
            <td style="padding:10px">
              <span style="background:${r.shift==='Both'?'#fdf2f8':'#eff6ff'}; color:${r.shift==='Both'?'#be185d':'#2563eb'}; padding:2px 8px; border-radius:999px; font-weight:600">
                ${r.shift}
              </span>
            </td>
            <td style="padding:10px; color:#64748b">${r.remarks || '-'}</td>
            <td style="padding:10px; text-align:right">
              <button onclick="deletePlantClosure(${r.id})" style="border:none; background:none; color:#ef4444; cursor:pointer" title="Re-open Plant">
                <i class="bi bi-unlock"></i> Open
              </button>
            </td>
          </tr>
        `).join('');
        if (!res.data.length) body.innerHTML = '<tr><td colspan="5" style="padding:40px; text-align:center; color:#94a3b8">No active closures found.</td></tr>';
      } catch (e) { alert(e.message); }
    }

    async function savePlantClosure() {
      const payload = {
        dpr_date: document.getElementById('pc-date').value,
        plant: document.getElementById('pc-plant').value,
        shift: document.getElementById('pc-shift').value,
        remarks: document.getElementById('pc-remarks').value,
        closed_by: JPSMS.auth.getUser().username
      };
      
      if (!payload.dpr_date) return alert('Please select a date');
      
      try {
        const res = await JPSMS.api.post('/admin/close-plant', payload);
        if (res.ok) {
          document.getElementById('pc-remarks').value = '';
          loadPlantClosures();
        } else alert(res.error);
      } catch (e) { alert(e.message); }
    }

    async function deletePlantClosure(id) {
      if (!confirm('Re-open this plant for entries?')) return;
      try {
        const res = await JPSMS.api.delete('/admin/close-plant/' + id);
        if (res.ok) loadPlantClosures();
        else alert(res.error);
      } catch (e) { alert(e.message); }
    }