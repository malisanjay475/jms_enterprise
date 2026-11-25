    // --- JOB DETAIL POPUP: helpers and the QC section. The popup itself is dpr-job-detail.js ---
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

    function getJobSummaryScope() {
        return {
            date: document.getElementById('s-date')?.value || '',
            shift: document.getElementById('s-shift')?.value || ''
        };
    }

    // FPA image viewer transform state (zoom + rotate).
    let _jobImgZoom = 1, _jobImgRot = 0;
    function applyJobImgTransform() {
        const img = document.getElementById('modalJobImageLarge');
        if (img) img.style.transform = `scale(${_jobImgZoom}) rotate(${_jobImgRot}deg)`;
    }
    function openJobImage(src) {
        const wrap = document.getElementById('modalJobImageViewer');
        const img = document.getElementById('modalJobImageLarge');
        if (!wrap || !img) return;
        _jobImgZoom = 1; _jobImgRot = 0;
        img.src = src;
        img.style.transition = 'transform 0.15s ease';
        applyJobImgTransform();
        wrap.style.display = 'flex';
    }
    function zoomJobImage(delta, ev) {
        if (ev) ev.stopPropagation();
        _jobImgZoom = Math.min(5, Math.max(0.25, +(_jobImgZoom + delta).toFixed(2)));
        applyJobImgTransform();
    }
    function rotateJobImage(ev) {
        if (ev) ev.stopPropagation();
        _jobImgRot = (_jobImgRot + 90) % 360;
        applyJobImgTransform();
    }
    function closeJobImage() {
        const wrap = document.getElementById('modalJobImageViewer');
        const img = document.getElementById('modalJobImageLarge');
        if (img) { img.src = ''; img.style.transform = ''; }
        _jobImgZoom = 1; _jobImgRot = 0;
        if (wrap) wrap.style.display = 'none';
    }

    // QC 2-hour Online Report inside the DPR job modal (select QC → see the slot checks).
    const QC_ONLINE_SLOTS = ['06-07', '08-09', '10-11', '12-01', '02-03', '04-05'];
    function qcSlotCell(status, problem, remarks) {
        if (!status) return '<span style="color:#cbd5e1">—</span>';
        if (/machine\s*stop/i.test(String(status))) {
            return '<span style="color:#b45309;font-weight:700">⛔ Machine Stop</span>'
                + `<div style="font-size:11px;color:#64748b">${dprEsc([problem, remarks].filter(Boolean).join(' · '))}</div>`;
        }
        const ok = String(status).toUpperCase().includes('OK') && !String(status).toUpperCase().includes('NOT');
        const badge = ok ? '<span style="color:#059669;font-weight:700">✔ OK</span>'
                         : '<span style="color:#dc2626;font-weight:700">✘ Not OK</span>';
        const extra = ok ? '' : `<div style="font-size:11px;color:#64748b">${dprEsc([problem, remarks].filter(Boolean).join(' · '))}</div>`;
        return badge + extra;
    }
    async function toggleJobOnlineQC(btn) {
        const box = document.getElementById('modalJobOnlineQC');
        if (!box) return;
        if (box.style.display !== 'none') { box.style.display = 'none'; btn.innerHTML = '<i class="bi bi-clipboard-data"></i> Show QC 2-hour Online Report'; return; }
        box.style.display = 'block';
        btn.innerHTML = '<i class="bi bi-clipboard-data"></i> Hide QC 2-hour Online Report';
        box.innerHTML = '<div style="color:#64748b;font-size:0.82rem">Loading QC checks…</div>';
        const scope = getJobSummaryScope();
        if (btn.getAttribute('data-date')) scope.date = btn.getAttribute('data-date');
        if (btn.getAttribute('data-shift')) scope.shift = btn.getAttribute('data-shift');
        if (scope.shift === 'Both') scope.shift = '';
        const machine = btn.getAttribute('data-machine') || '';
        try {
            const qs = new URLSearchParams();
            if (scope.date) qs.set('date', scope.date);
            if (scope.shift) qs.set('shift', scope.shift);
            if (machine) qs.set('machine', machine);
            const res = await fetch(`/api/qc/online-report/list?${qs.toString()}`);
            const json = await res.json();
            const rows = (json.ok && Array.isArray(json.data)) ? json.data : [];
            if (!rows.length) { box.innerHTML = '<div style="color:#64748b;font-size:0.82rem">No QC 2-hour checks for this machine/shift.</div>'; return; }
            let html = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.8rem">
                <thead><tr style="text-align:left;color:#64748b">
                  <th style="padding:6px 8px">Slot</th><th style="padding:6px 8px">Visual</th>
                  <th style="padding:6px 8px">Colour</th><th style="padding:6px 8px">Function/Fitment</th>
                  <th style="padding:6px 8px">By</th><th style="padding:6px 8px">When</th>
                </tr></thead><tbody>`;
            QC_ONLINE_SLOTS.forEach(sl => {
                const r = rows.find(x => x.slot === sl);
                if (!r) return;
                const when = r.entered_at ? new Date(r.entered_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
                html += `<tr style="border-top:1px solid #f1f5f9">
                  <td style="padding:6px 8px;font-weight:600">${dprEsc(sl)}</td>
                  <td style="padding:6px 8px">${qcSlotCell(r.visual_status, r.visual_problem, r.visual_remarks)}</td>
                  <td style="padding:6px 8px">${qcSlotCell(r.colour_status, r.colour_problem, r.colour_remarks)}</td>
                  <td style="padding:6px 8px">${qcSlotCell(r.ff_status, r.ff_problem, '')}</td>
                  <td style="padding:6px 8px;color:#64748b">${dprEsc(r.entered_by || '')}</td>
                  <td style="padding:6px 8px;color:#64748b">${dprEsc(when)}</td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            box.innerHTML = html;
        } catch (e) {
            box.innerHTML = '<div style="color:#b91c1c;font-size:0.82rem">Failed to load QC checks.</div>';
        }
    }

    // QC One-time Setup (QC app, saved twice per shift: 1st half / 2nd half) for the
    // clicked job + date + shift: STD vs Actual weight, cycle time and cavity.
    async function loadQcSetupBlock(details, date, shift) {
        const jc = details.job_card_no || details.JobCardNo || '';
        const machine = details.machine || '';
        if (!jc || !machine || !date || !shift) return '';
        try {
            const qs = new URLSearchParams({ job_card_no: jc, date, shift, machine, mould_name: details.mould_name || '' });
            const res = await fetch(`/api/qc/job-setup?${qs.toString()}`);
            const json = await res.json();
            if (!json || !json.ok) return '';
            const halves = [(json.setups && json.setups[1]) || null, (json.setups && json.setups[2]) || null];
            const std = json.std || {};
            const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
            const pick = k => num(halves[0] && halves[0][k]) ?? num(halves[1] && halves[1][k]) ?? num(std[k]);
            const rows = [
                // [label, STD, actual column, out-of-line test]
                ['Weight', pick('std_weight'), 'act_weight', (s, a) => s > 0 && Math.abs(a - s) / s > 0.10],
                ['Cycle time', pick('std_cycle_time'), 'act_cycle_time', (s, a) => s > 0 && a > s * 1.10],
                ['Cavity', pick('std_cavity'), 'act_cavity', (s, a) => s > 0 && a < s],
                ['Runner weight', pick('std_runner_weight'), 'act_runner_weight', (s, a) => s > 0 && Math.abs(a - s) / s > 0.10]
            ];
            const cell = (h, key, s, off) => {
                const a = num(h && h[key]);
                if (a === null) return '<td style="padding:5px 8px; color:#94a3b8">—</td>';
                const bad = s !== null && off(s, a);
                return `<td style="padding:5px 8px; font-weight:800; color:${bad ? '#dc2626' : '#0f172a'}">${dprEsc(String(a))}</td>`;
            };
            const when = h => h
                ? `${dprEsc(h.setup_by || '—')}${h.setup_at ? ' · ' + dprEsc(new Date(h.setup_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })) : ''}`
                : 'not saved';
            const savedCount = halves.filter(Boolean).length;
            return `
                <div style="margin-top:12px; border:1px solid #bfdbfe; border-radius:10px; padding:10px 12px; background:#f8fbff">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
                        <div style="font-size:0.8rem; font-weight:900; color:#1d4ed8; text-transform:uppercase">QC One-time Setup</div>
                        <span style="font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:999px; ${savedCount === 2 ? 'background:#dcfce7; color:#166534' : 'background:#fee2e2; color:#991b1b'}">${savedCount}/2 saved</span>
                    </div>
                    <div style="font-size:0.72rem; color:#64748b; margin-bottom:6px">${dprEsc(dprFmtDate(date))} · ${dprEsc(shift)} shift</div>
                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem">
                        <thead><tr style="text-align:left; color:#64748b; font-size:0.7rem; text-transform:uppercase">
                            <th style="padding:5px 8px"></th><th style="padding:5px 8px">STD</th><th style="padding:5px 8px">1st half</th><th style="padding:5px 8px">2nd half</th>
                        </tr></thead>
                        <tbody>
                            ${rows.map(([label, s, key, off]) => `<tr style="border-top:1px solid #e2e8f0">
                                <td style="padding:5px 8px; font-weight:700; color:#334155">${label}</td>
                                <td style="padding:5px 8px; color:#475569">${s === null ? '—' : dprEsc(String(s))}</td>
                                ${cell(halves[0], key, s, off)}${cell(halves[1], key, s, off)}
                            </tr>`).join('')}
                        </tbody>
                    </table>
                    <div style="font-size:0.72rem; color:#64748b; margin-top:6px">1st half: ${when(halves[0])} &nbsp;|&nbsp; 2nd half: ${when(halves[1])}</div>
                    ${(window.canDeleteQcEntry && window.canDeleteQcEntry() && halves.some(h => h && h.id)) ? `<div style="display:flex; gap:6px; justify-content:flex-end; margin-top:8px">
                        ${halves.map((h, i) => (h && h.id) ? `<button type="button" onclick="deleteQcEntry('setup', ${Number(h.id)}, '${i ? '2nd' : '1st'} half setup', () => { if (window._lastQcJobDetails && window.loadJobQCEvidence) window.loadJobQCEvidence(window._lastQcJobDetails); })" style="border:1px solid #fca5a5; background:#fef2f2; color:#b91c1c; border-radius:8px; padding:3px 9px; font-size:0.75rem; font-weight:700; cursor:pointer"><i class="bi bi-trash"></i> Delete ${i ? '2nd' : '1st'} half</button>` : '').join('')}
                    </div>` : ''}
                </div>`;
        } catch (_) {
            return '';
        }
    }

    async function loadJobQCEvidence(details) {
        const box = document.getElementById('modalJobQCEvidence');
        if (!box) return;
        // Remember the job so a delete can re-render this same evidence panel.
        window._lastQcJobDetails = details;

        const jc = details.job_card_no || details.JobCardNo || '';
        const planId = details.plan_id || details.PlanID || '';
        const machine = details.machine || '';
        // Date/shift of the summary row that was clicked (falls back to the filter).
        const scope = getJobSummaryScope();
        const rowDate = details._row_date || scope.date || '';
        const rowShift = details._row_shift || (scope.shift === 'Both' ? '' : scope.shift) || '';
        box.innerHTML = '<div style="color:#64748b; font-size:0.85rem">Loading QC weights and FPA evidence...</div>';

        try {
            const qs = new URLSearchParams();
            if (jc) qs.set('jobCardNo', jc);
            if (planId) qs.set('planId', planId);
            if (machine) qs.set('machine', machine);
            qs.set('limit', '50');
            const [res, qcSetupHtml] = await Promise.all([
                fetch(`/api/qc/job-checks?${qs.toString()}`),
                loadQcSetupBlock(details, rowDate, rowShift)
            ]);
            const json = await res.json();
            const rows = json.ok && Array.isArray(json.data) ? json.data : [];
            // No FPA on this machine: the job may have been moved here after its FPA was done
            // on another machine. Show that one, marked, so QC knows a new FPA is due here.
            let otherFpa = null;
            if (machine && !rows.some(r => r.fpa_status === 'Done')) {
                const q2 = new URLSearchParams(qs); q2.delete('machine');
                try {
                    const j2 = await (await fetch(`/api/qc/job-checks?${q2.toString()}`)).json();
                    otherFpa = ((j2.ok && j2.data) || []).find(r => r.fpa_status === 'Done' && r.machine !== machine
                        && (r.fpa_form_image || (Array.isArray(r.product_images) && r.product_images.length))) || null;
                } catch (_) { /* best-effort */ }
            }
            const weights = rows
                .flatMap(r => [r.qc_weight_1, r.qc_weight_2, r.qc_weight_3])
                .filter(v => v !== null && v !== undefined && String(v) !== '')
                .slice(0, 2);
            const fpa = rows.find(r => r.fpa_form_image || (Array.isArray(r.product_images) && r.product_images.length));
            // Who saved the QC weights (qc_job_checks.supervisor / fpa_done_by).
            const qcSavedBy = (rows.find(r => r.supervisor || r.fpa_done_by) || {});
            const qcSavedByName = qcSavedBy.supervisor || qcSavedBy.fpa_done_by || '';
            const fpaImages = fpa ? [fpa.fpa_form_image, ...((Array.isArray(fpa.product_images) ? fpa.product_images : []))].filter(Boolean) : [];
            const fpaRowId = fpa ? fpa.id : null;
            const canDelFpa = !!(window.canDeleteFpaImage && window.canDeleteFpaImage());
            // QC approval remark left by Quality when approving the FPA (optional).
            const fpaStatus = fpa ? (fpa.fpa_approval_status || 'Pending') : '';
            const fpaReviewer = fpa ? (fpa.fpa_reviewed_by || '') : '';
            const fpaRemark = fpa ? (fpa.fpa_approve_remark || '') : '';
            const fpaApprovalNote = (fpaStatus === 'Approved' && (fpaReviewer || fpaRemark))
                ? `<div style="margin-top:10px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:8px 12px; font-size:0.82rem; color:#065f46">
                       <b>Approved${fpaReviewer ? ' by ' + dprEsc(fpaReviewer) : ''}</b>${fpaRemark ? ' — <b>Remark:</b> ' + dprEsc(fpaRemark) : ''}
                   </div>`
                : '';

            box.innerHTML = `
                <div class="jd-head"><h4>Quality check</h4>${qcSavedByName ? `<span class="jd-note">QC saved by ${dprEsc(qcSavedByName)}</span>` : ''}</div>
                <div class="jd-kv">
                    ${[0, 1].map(i => `<span>QC weight ${i + 1}</span><b>${dprEsc(weights[i] || '-')}</b>`).join('')}
                </div>
                ${qcSetupHtml}
                ${fpaImages.length ? `
                    <div style="font-size:0.85rem; color:#334155; font-weight:800; margin:14px 0 8px">FPA Images</div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px">
                        ${fpaImages.map((src, i) => `
                        <div style="position:relative">
                        <button type="button" onclick="openJobImage(decodeURIComponent('${encodeURIComponent(src)}'))"
                            style="display:block;padding:0;border:2px solid #e2e8f0;background:#f8fafc;cursor:zoom-in;border-radius:10px;overflow:hidden;transition:border-color 0.2s,transform 0.2s;width:100%"
                            onmouseover="this.style.borderColor='#93c5fd';this.style.transform='scale(1.02)'"
                            onmouseout="this.style.borderColor='#e2e8f0';this.style.transform='scale(1)'">
                            <img src="${dprEsc(/^\/uploads\/qc-images\//.test(src) ? ('/api/qc/thumb?src=' + encodeURIComponent(src) + '&w=360') : src)}" alt="FPA image ${i + 1}" loading="lazy" decoding="async"
                                style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:8px">
                        </button>
                        ${(canDelFpa && fpaRowId) ? `<button type="button" title="Delete this FPA image"
                            onclick="deleteFpaImage(${fpaRowId}, decodeURIComponent('${encodeURIComponent(src)}'))"
                            style="position:absolute;top:5px;right:5px;width:26px;height:26px;padding:0;border:none;border-radius:50%;background:#dc2626;color:#fff;font-size:15px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35);z-index:2">&times;</button>` : ''}
                        </div>`).join('')}
                    </div>
                ` : otherFpa ? `
                    <div style="margin-top:10px; padding:10px 12px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px">
                        <div style="font-weight:800; color:#b45309; font-size:0.85rem">No FPA on ${dprEsc(machine)} yet</div>
                        <div style="font-size:0.8rem; color:#92400e; margin-top:2px">FPA for this job was done on <b>${dprEsc(otherFpa.machine || '-')}</b>${otherFpa.fpa_done_at ? ' on ' + dprEsc(new Date(otherFpa.fpa_done_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })) : ''}${otherFpa.fpa_approval_status ? ' (' + dprEsc(otherFpa.fpa_approval_status) + ')' : ''}. The job moved to this machine, so it needs an FPA here.</div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px">${[otherFpa.fpa_form_image, ...(Array.isArray(otherFpa.product_images) ? otherFpa.product_images : [])].filter(Boolean).map(src => `<a href="${dprEsc(src)}" target="_blank" rel="noopener"><img src="${dprEsc(/^\/uploads\/qc-images\//.test(src) ? ('/api/qc/thumb?src=' + encodeURIComponent(src) + '&w=200') : src)}" alt="FPA image from ${dprEsc(otherFpa.machine || '')}" loading="lazy" style="width:64px; height:64px; object-fit:cover; border-radius:6px; border:1px solid #fde68a; opacity:0.85"></a>`).join('')}</div>
                    </div>` : '<div style="color:#64748b; font-size:0.82rem; margin-top:10px">No FPA images saved for this job yet.</div>'}
                ${fpaApprovalNote}
                <div style="margin-top:14px; border-top:1px dashed #e2e8f0; padding-top:12px">
                    <button type="button" onclick="toggleJobOnlineQC(this)" data-machine="${dprEsc(machine)}" data-date="${dprEsc(rowDate)}" data-shift="${dprEsc(rowShift)}"
                        style="display:inline-flex; align-items:center; gap:6px; background:#0ea5e9; color:#fff; border:none; border-radius:8px; padding:8px 14px; font-weight:700; font-size:0.82rem; cursor:pointer">
                        <i class="bi bi-clipboard-data"></i> Show QC 2-hour Online Report
                    </button>
                    <div id="modalJobOnlineQC" style="display:none; margin-top:10px"></div>
                </div>
            `;
        } catch (err) {
            box.innerHTML = `<div style="color:#b91c1c; font-size:0.85rem">QC evidence could not be loaded: ${String(err.message || err)}</div>`;
        }
    }

    // Delete one FPA image (Quality / admin / superadmin). Server re-checks the role.
    // After a successful delete, re-render the same job's evidence so the grid updates
    // and Quality can capture a fresh FPA photo from the app.
    // Global so the QC entry delete buttons (onclick) can refresh the QC panel.
    window.loadJobQCEvidence = loadJobQCEvidence;

    window.deleteFpaImage = async function (id, url) {
        if (!confirm('Delete this FPA image? Quality can then add a new one.')) return;
        try {
            const res = await JPSMS.api.post('/qc/fpa/delete-image', { id, url, session: JPSMS.auth.getUser() });
            if (res && res.ok) {
                if (window._lastQcJobDetails) loadJobQCEvidence(window._lastQcJobDetails);
            } else {
                alert((res && res.error) || 'Could not delete image.');
            }
        } catch (e) {
            alert('Delete failed: ' + (e.message || e));
        }
    };

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