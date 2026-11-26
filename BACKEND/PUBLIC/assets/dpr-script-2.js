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
    // Shown under the DPR setup in the popup's Setup section.
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
                if (a === null) return '<td class="r">–</td>';
                return `<td class="r"><b class="${s !== null && off(s, a) ? 'bad' : ''}">${dprEsc(String(a))}</b></td>`;
            };
            const when = h => h
                ? `${dprEsc(h.setup_by || '—')}${h.setup_at ? ' · ' + dprEsc(new Date(h.setup_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })) : ''}`
                : 'not saved';
            const savedCount = halves.filter(Boolean).length;
            const canDel = window.canDeleteQcEntry && window.canDeleteQcEntry() && halves.some(h => h && h.id);
            return `
                <div class="jd-sub">QC one-time setup <span class="jd-note">${dprEsc(dprFmtDate(date))} · ${dprEsc(shift)} shift</span>
                    <span class="jd-pill ${savedCount === 2 ? 'good' : 'bad'}">${savedCount}/2 saved</span></div>
                <table class="jd-table jd-setup">
                    <thead><tr><th></th><th class="r">STD</th><th class="r">1st half</th><th class="r">2nd half</th></tr></thead>
                    <tbody>${rows.map(([label, s, key, off]) => `<tr><td>${label}</td><td class="r">${s === null ? '–' : dprEsc(String(s))}</td>${cell(halves[0], key, s, off)}${cell(halves[1], key, s, off)}</tr>`).join('')}</tbody>
                </table>
                <div class="jd-note jd-mt">1st half: ${when(halves[0])} &nbsp;|&nbsp; 2nd half: ${when(halves[1])}</div>
                ${canDel ? `<div class="jd-actions">${halves.map((h, i) => (h && h.id) ? `<button type="button" class="jd-btn jd-btn-danger" onclick="deleteQcEntry('setup', ${Number(h.id)}, '${i ? '2nd' : '1st'} half setup', () => { if (window._lastQcJobDetails && window.loadJobQCEvidence) window.loadJobQCEvidence(window._lastQcJobDetails); })"><i class="bi bi-trash"></i> Delete ${i ? '2nd' : '1st'} half</button>` : '').join('')}</div>` : ''}`;
        } catch (_) {
            return '';
        }
    }

    // Fills three sections of the job popup (dpr-job-detail.js): the QC half of Setup,
    // Photos (FPA form + product photos) and First piece approval.
    async function loadJobQCEvidence(details) {
        if (!window.jdFill || !document.getElementById('jdSec-fpa')) return;
        // Remember the job so a delete can re-render these sections; an answer for a job
        // that is no longer open is dropped.
        window._lastQcJobDetails = details;
        const fresh = () => window._lastQcJobDetails === details && document.getElementById('jdSec-fpa');

        const jc = details.job_card_no || details.JobCardNo || '';
        const planId = details.plan_id || details.PlanID || '';
        const machine = details.machine || '';
        // Date/shift of the summary row that was clicked (falls back to the filter).
        const scope = getJobSummaryScope();
        const rowDate = details._row_date || scope.date || '';
        const rowShift = details._row_shift || (scope.shift === 'Both' ? '' : scope.shift) || '';
        const when = v => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        const thumb = (src, w) => /^\/uploads\/qc-images\//.test(src) ? ('/api/qc/thumb?src=' + encodeURIComponent(src) + '&w=' + w) : src;
        const hasImg = r => r && (r.fpa_form_image || (Array.isArray(r.product_images) && r.product_images.length));
        const imagesOf = r => r ? [
            ...(r.fpa_form_image ? [{ src: r.fpa_form_image, label: 'FPA form' }] : []),
            ...(Array.isArray(r.product_images) ? r.product_images : []).filter(Boolean).map((src, i) => ({ src, label: `Product photo ${i + 1}` }))
        ] : [];

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
                    otherFpa = ((j2.ok && j2.data) || []).find(r => r.fpa_status === 'Done' && r.machine !== machine && hasImg(r)) || null;
                } catch (_) { /* best-effort */ }
            }
            if (!fresh()) return;

            // Setup: the QC half
            const setupBox = document.getElementById('jdQcSetup');
            if (setupBox) setupBox.innerHTML = qcSetupHtml || '<div class="jd-sub">QC one-time setup</div><div class="jd-note">Not saved for this date and shift.</div>';

            // Photos
            const imgRow = rows.find(hasImg);
            const photos = imagesOf(imgRow);
            const canDelFpa = !!(window.canDeleteFpaImage && window.canDeleteFpaImage()) && imgRow && imgRow.id;
            const tile = (p, big, other) => `<figure class="jd-photo${other ? ' other' : ''}">
                    <button type="button" onclick="openJobImage(decodeURIComponent('${encodeURIComponent(p.src)}'))" aria-label="Open ${dprEsc(p.label)}">
                        <img src="${dprEsc(thumb(p.src, big ? 360 : 200))}" alt="${dprEsc(p.label)}" loading="lazy" decoding="async"></button>
                    <figcaption>${dprEsc(p.label)}</figcaption>
                    ${(!other && canDelFpa) ? `<button type="button" class="jd-photo-del" title="Delete this photo" aria-label="Delete ${dprEsc(p.label)}" onclick="deleteFpaImage(${Number(imgRow.id)}, decodeURIComponent('${encodeURIComponent(p.src)}'))">&times;</button>` : ''}
                </figure>`;
            if (photos.length) {
                window.jdFill('photos', `<div class="jd-photos">${photos.map(p => tile(p, true)).join('')}</div>
                    ${imgRow.fpa_done_by || imgRow.fpa_done_at ? `<div class="jd-note jd-mt">Taken by ${dprEsc(imgRow.fpa_done_by || '-')}${imgRow.fpa_done_at ? ' · ' + dprEsc(when(imgRow.fpa_done_at)) : ''}${imgRow.machine ? ' · ' + dprEsc(imgRow.machine) : ''}</div>` : ''}`,
                    `${photos.length} photo${photos.length === 1 ? '' : 's'}`, 'good');
            } else if (otherFpa) {
                const op = imagesOf(otherFpa);
                window.jdFill('photos', `<div class="jd-note jd-mb">No photos on ${dprEsc(machine)} yet. These are from <b>${dprEsc(otherFpa.machine || '-')}</b>, before the job moved.</div>
                    <div class="jd-photos">${op.map(p => tile(p, false, true)).join('')}</div>`, `From ${otherFpa.machine || 'another machine'}`, 'warn');
            } else {
                window.jdFill('photos', '<div class="jd-empty"><i class="bi bi-camera"></i> No photos saved for this job yet. Quality adds them in the QC app with the FPA.</div>', 'None yet', 'warn');
            }

            // First piece approval
            const fpa = rows.find(r => r.fpa_status === 'Done') || imgRow || null;
            const weights = rows.flatMap(r => [r.qc_weight_1, r.qc_weight_2, r.qc_weight_3])
                .filter(v => v !== null && v !== undefined && String(v) !== '').slice(0, 2);
            const savedBy = (rows.find(r => r.supervisor || r.fpa_done_by) || {});
            let status, tone, icon, note;
            if (fpa) {
                status = fpa.fpa_approval_status || 'Pending';
                tone = /approv/i.test(status) ? 'good' : /reject/i.test(status) ? 'bad' : 'warn';
                icon = tone === 'good' ? 'bi-patch-check-fill' : tone === 'bad' ? 'bi-x-octagon-fill' : 'bi-hourglass-split';
                note = tone === 'good' ? `Approved${fpa.fpa_reviewed_by ? ' by ' + fpa.fpa_reviewed_by : ''}${fpa.fpa_reviewed_at ? ' on ' + when(fpa.fpa_reviewed_at) : ''}`
                    : tone === 'bad' ? `Rejected${fpa.fpa_reviewed_by ? ' by ' + fpa.fpa_reviewed_by : ''}${fpa.fpa_reject_reason ? ': ' + fpa.fpa_reject_reason : ''}`
                    : 'Waiting for Quality to approve';
            } else if (otherFpa) {
                status = 'Due on this machine'; tone = 'warn'; icon = 'bi-arrow-left-right';
                note = `FPA was done on ${otherFpa.machine || 'another machine'}${otherFpa.fpa_done_at ? ' on ' + when(otherFpa.fpa_done_at) : ''}${otherFpa.fpa_approval_status ? ' (' + otherFpa.fpa_approval_status + ')' : ''}. The job moved here, so it needs an FPA here.`;
            } else {
                status = 'Not done'; tone = 'bad'; icon = 'bi-exclamation-octagon-fill';
                note = 'No first piece approval saved for this job yet.';
            }
            const kv = [
                fpa && ['FPA done by', [fpa.fpa_done_by, when(fpa.fpa_done_at)].filter(Boolean).join(' · ')],
                fpa && fpa.fpa_reviewed_by && ['Reviewed by', [fpa.fpa_reviewed_by, when(fpa.fpa_reviewed_at)].filter(Boolean).join(' · ')],
                fpa && fpa.fpa_approve_remark && ['Remark', fpa.fpa_approve_remark],
                fpa && Number(fpa.fpa_resubmit_count) > 0 && ['Sent again', `${fpa.fpa_resubmit_count} time${Number(fpa.fpa_resubmit_count) === 1 ? '' : 's'}`],
                fpa && fpa.fpa_transferred_from && ['Moved from', fpa.fpa_transferred_from],
                ['QC weight 1', weights[0] || '–'],
                ['QC weight 2', weights[1] || '–'],
                (savedBy.supervisor || savedBy.fpa_done_by) && ['QC saved by', savedBy.supervisor || savedBy.fpa_done_by]
            ].filter(x => x && x[1]);
            window.jdFill('fpa', `
                <div class="jd-fpa ${tone}"><i class="bi ${icon}"></i><div><b>${dprEsc(status)}</b><p>${dprEsc(note)}</p></div></div>
                <dl class="jd-dl">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${dprEsc(v)}</dd></div>`).join('')}</dl>
                <div class="jd-actions jd-left">
                    <button type="button" class="jd-btn" onclick="toggleJobOnlineQC(this)" data-machine="${dprEsc(machine)}" data-date="${dprEsc(rowDate)}" data-shift="${dprEsc(rowShift)}">
                        <i class="bi bi-clipboard-data"></i> Show QC 2-hour Online Report</button>
                </div>
                <div id="modalJobOnlineQC" style="display:none; margin-top:10px"></div>`,
                tone === 'good' ? `Approved${fpa.fpa_reviewed_by ? ' by ' + fpa.fpa_reviewed_by : ''}` : status, tone);
        } catch (err) {
            if (!fresh()) return;
            const msg = `<div class="jd-error">QC evidence could not be loaded: ${dprEsc(String(err.message || err))}</div>`;
            window.jdFill('photos', msg, 'Not available', 'bad');
            window.jdFill('fpa', msg, 'Not available', 'bad');
            const setupBox = document.getElementById('jdQcSetup');
            if (setupBox) setupBox.innerHTML = '';
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