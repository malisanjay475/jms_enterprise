    'use strict';

    /* ==================== GAS shim (kept for safety) ==================== */
    (function () {
      if (window.google && google.script && google.script.run) return;
      function makeChain(method) {
        const chain = {
          _ok: null, _err: null,
          withSuccessHandler(fn) { this._ok = fn; return this; },
          withFailureHandler(fn) { this._err = fn; return this; }
        };
        chain[method] = (...args) => {
          console.warn('Apps Script not available. Called:', method, args);
          setTimeout(() => chain._err && chain._err('Apps Script unavailable'), 0);
          return chain;
        };
        return chain;
      }
      window.google = window.google || {};
      google.script = google.script || {};
      google.script.run = new Proxy({}, {
        get(_t, prop) {
          return (..._args) => {
            const c = makeChain(prop);
            return c[prop](..._args);
          };
        }
      });
    })();

    /* ==================== Constants ==================== */
    // Updated Slot Definition (Day starts 08:00)
    const SLOT_ORDER_DAY = ['07-08', '08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07'];
    const SLOT_ORDER_NIGHT = ['20-21', '21-22', '22-23', '23-00', '00-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
    // Wait, Labels are same for Day/Night usually in User's system (08-09 for AM and PM?)
    // User request: "Shift Is like Now Day Shift like 08-09... And Night Shift like 08-09..."
    // So labels are identical. Unique ID is Date    // --- Hourly Slot Management ---
    let SLOT_LABELS = [
      '07-08', '08-09', '09-10', '10-11', '11-12', '12-01',
      '01-02', '02-03', '03-04', '04-05', '05-06', '06-07'
    ];
    // Map<Key, { hasMain: boolean, count: number }>
    let SLOT_STATUS = new Map();

    // DEBUG: Dump Keys


    async function updateFilledSlots() {
      if (!session.machine) return;
      const sel = el('d-slot');
      if (sel) {
        sel.innerHTML = '<option>Loading slots...</option>';
        sel.disabled = true;
      }

      try {
        const res = await apiFetch(`/api/dpr/hourly/recent?machine=${encodeURIComponent(session.machine)}&limit=50`).then(r => r.json());
        SLOT_STATUS.clear();



        if (res.ok && res.data) {
          res.data.forEach(r => {
            // Safe Date Parsing (Force Local Year/Month/Day)
            let dRaw = r.plan_date;
            let dStr = '';

            try {
              let dObj = new Date(dRaw);
              if (!isNaN(dObj.getTime())) {
                const y = dObj.getFullYear();
                const m = String(dObj.getMonth() + 1).padStart(2, '0');
                const day = String(dObj.getDate()).padStart(2, '0');
                dStr = `${y}-${m}-${day}`;
              } else {
                dStr = String(dRaw).substring(0, 10);
              }
            } catch (ex) {
              dStr = String(dRaw).substring(0, 10);
            }

            // Fix for entries saved with "Date|Shift|Slot" format
            let safeSlot = String(r.hour_slot || '').trim();
            if (safeSlot.includes('|')) {
              const parts = safeSlot.split('|');
              if (parts.length >= 3) safeSlot = parts[2];
            }
            safeSlot = safeSlot.trim();

            if (dStr && r.shift && safeSlot) {
              const k = `${dStr}_${String(r.shift).trim().toUpperCase()}_${safeSlot}`;

              // Determine Type
              const eType = r.entry_type || 'Main';
              const QUICK_TYPES = ['Maintenance', 'ManPowerShortage', 'MouldChangeover', 'MouldTrial', 'MouldMaintenance', 'NoPlan'];

              let status = SLOT_STATUS.get(k) || { hasMain: false, hasCC: false, count: 0, isQuick: false, isAutoFill: false, type: eType };
              status.count++;
              if (eType === 'Main') status.hasMain = true;
              if (eType === 'ColourChange') status.hasCC = true;
              if (QUICK_TYPES.includes(eType)) {
                status.isQuick = true;
                status.type = eType;
                // A SYSTEM-AUTOFILL carry-forward row is a placeholder, not a real entry —
                // track it so the Main dropdown keeps the slot selectable for the actual
                // production that ran (a genuine quick action the supervisor took is NOT
                // auto-fill and stays hidden). A real (manual) row on the slot wins.
                if (r.is_auto_fill && !status.hasMain) status.isAutoFill = true;
              }
              if (eType === 'Main') status.isAutoFill = false;

              SLOT_STATUS.set(k, status);
            }
          });
        }

        // Show Debug (Change display:none above to block to see it)


      } catch (e) { console.error(e); alert('Error fetching filled slots: ' + e.message); }

      fillHourSlotSelect('d-slot');
      if (sel) sel.disabled = false;
    }

    function fillHourSlotSelect(selectId, selectedVal = null, hideFilled = true) {
      // Force unhide for CC slot to be absolutely sure
      if (selectId === 'cc-slot') hideFilled = false;

      const sel = el(selectId);
      if (!sel) {
        // console.error('Select Element Missing:', selectId);
        return;
      }

      sel.innerHTML = '';


      // Generate "Last 24 Hours" (Previous Shift + Current Shift)
      const now = new Date();
      const currentHour = now.getHours();

      // Determine Current Shift info
      // Day: 07:10 to 19:10. Night: 19:10 to 07:10 (factory 7:10 handover rule)
      const nowMins = currentHour * 60 + now.getMinutes();
      let isDay = (nowMins >= 430 && nowMins < 1150);

      // We want Current Shift AND Previous Shift
      // If Day (Today): Show Night (Yesterday) + Day (Today)
      // If Night (Today/Tom): Show Day (Today) + Night (Today)

      let shifts = [];

      // Helper for Local Date String (YYYY-MM-DD)
      const toLocalYMD = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const todayStr = toLocalYMD(now);
      const yest = new Date(now); yest.setDate(yest.getDate() - 1);
      const yestStr = toLocalYMD(yest);

      const isQuickAction = (selectId === 'mc-slot');
      const isAdmin = (session.role_code === 'admin' || session.role_code === 'superadmin' || session.username === 'admin');
      const showAllLastShiftSlots = isAdmin || isQuickAction;

      if (isDay) {
        // Current: Day (Today). Previous: Night (Yesterday -> starts yesterday 20:00)
        shifts.push({ date: yestStr, shift: 'Night', labelDate: yest });
        shifts.push({ date: todayStr, shift: 'Day', labelDate: now });
      } else {
        // Current: Night. 
        // Production Date determination:
        let prodDate = new Date(now);
        if (currentHour < 7) prodDate.setDate(prodDate.getDate() - 1);
        const prodDateStr = toLocalYMD(prodDate);

        shifts.push({ date: prodDateStr, shift: 'Day', labelDate: prodDate });
        shifts.push({ date: prodDateStr, shift: 'Night', labelDate: prodDate });
      }

      // Debug:
      // console.log('FILLED KEY CHECK:', Array.from(FILLED_ENTRIES));

      // BACKFILL OVERRIDE: If user picked anything other than the CURRENT active shift,
      // replace shifts with just that selection so all 12 slots are available.
      // (Yesterday Night is in shifts[0] during Day shift but still needs all slots shown.)
      if (selectId === 'd-slot') {
        const selDateEl = el('d-date');
        const selShiftEl = el('d-shift');
        if (selDateEl && selShiftEl) {
          const manualDate = selDateEl.value;
          const manualShift = selShiftEl.value;
          // Ignore the "Pick another date…" sentinel — it is not a real date and
          // would parse to "Invalid Date" in the slot labels below.
          if (manualDate && manualDate !== '__pick__' && manualShift) {
            // Current active shift is always the LAST entry in shifts[]
            const currentShift = shifts[shifts.length - 1];
            const isCurrentShift = currentShift &&
              currentShift.date === manualDate &&
              currentShift.shift === manualShift;
            if (!isCurrentShift) {
              // Only enter backfill mode if the selected shift has already STARTED.
              // Day shift starts 07:00, Night shift starts 19:00.
              // If the shift hasn't started yet → it's a future shift → keep future gate active (no isBackfill).
              const manualDateObj = new Date(manualDate + 'T00:00:00');
              const shiftStartH = (manualShift === 'Night') ? 19 : 7;
              const shiftStartMs = new Date(manualDate + 'T00:00:00').setHours(shiftStartH, 0, 0, 0);
              const isBackfill = (now.getTime() >= shiftStartMs);
              shifts = [{ date: manualDate, shift: manualShift, labelDate: manualDateObj, isBackfill }];
            }
          }
        }
      }

      // Returns true if any real saved entry exists chronologically AFTER the given
      // (shiftIdx, slotIdx) — i.e. a later entry that "closes" a Quick Action continuation.
      function hasLaterRealEntry(fromShiftIdx, fromSlotIdx) {
        for (let si = fromShiftIdx; si < shifts.length; si++) {
          const startSlot = (si === fromShiftIdx) ? fromSlotIdx + 1 : 0;
          for (let li = startSlot; li < SLOT_LABELS.length; li++) {
            const k = `${shifts[si].date}_${shifts[si].shift.toUpperCase()}_${SLOT_LABELS[li]}`;
            if (SLOT_STATUS.get(k)) return true;
          }
        }
        return false;
      }

      shifts.forEach((s, shiftIdx) => {
        SLOT_LABELS.forEach(slot => {
          // USER REQUEST: Only show 07-08 from LAST shift for regular supervisors
          // Unless it's an expanded view (Admin or Quick Action)
          // Last shift is always shifts[0]
          // Bypass this limit for backfill entries (user explicitly chose yesterday)
          if (!s.isBackfill && !showAllLastShiftSlots && shiftIdx === 0) return;
          // 1. Calculate Real End Time for this slot
          // Slot format "08-09", "12-01", etc.
          // Map to 24h based on Shift
          const [startStr, endStr] = slot.split('-');
          let endH = parseInt(endStr, 10);
          let realEndTime = new Date(s.labelDate);

          if (s.shift === 'Day') {
            // Day: 07:00 - 19:00
            // Slots 0-4 (07-08 to 11-12): AM/Noon — endH 8..12 is correct as-is
            // Slots 5-11 (12-01 to 06-07): PM — endH 1..7, add 12
            const slotIdx = SLOT_LABELS.indexOf(slot);
            if (slotIdx >= 5) {
              // PM hour (12-01 through 06-07)
              endH += 12;
            }
            // slotIdx 0-4 (07-08 through 11-12): endH already correct (8..12)
            realEndTime.setHours(endH, 0, 0, 0);

          } else { // Night Shift
            // Night: 19:00 - 07:00 (next day)
            // 07-08 -> 20:00 (8 PM same day — first slot)
            // 08-09 -> 21:00 (9 PM)
            // ...
            // 06-07 -> 07:00 (Next Day Morning — last slot)

            if (slot === '07-08') {
              endH = 20; // 8 PM same day (first slot of Night shift)
            } else if (endH >= 8 && endH <= 11) { // 08-09, 09-10, 10-11
              endH += 12; // 20-21, 21-22, 22-23
            } else if (endH === 12) { // 11-12
              endH = 24; // Midnight
            } else if (endH >= 1 && endH <= 7) { // 12-01, 01-02, ..., 06-07
              endH += 24; // Next Day AM
            }

            // Handle overflow > 24 in setHours
            realEndTime.setHours(endH, 0, 0, 0);
          }

          // 2. Future Check (bypass for backfill — yesterday is never future)
          if (!s.isBackfill && now < realEndTime) return;

          // 3. Filled Check
          const key = `${s.date}_${s.shift.toUpperCase()}_${slot}`;
          const currentStatus = SLOT_STATUS.get(key);
          const hasMain = currentStatus ? currentStatus.hasMain : false;
          const hasCC = currentStatus ? currentStatus.hasCC : false;

          let suffix = '';

          // [NEW] Continuity Label Logic
          let suffixFromPrevShift = false; // track if "Continued from" crossed a shift boundary
          let contQuickSameShift = false;  // this empty slot is carried forward by a same-shift Quick Action
          if (!currentStatus) {
            // Find the most recent entry before this slot (in the same or previous shift)
            let foundPrev = false;
            let checkShiftIdx = shiftIdx;
            let checkSlotIdx = SLOT_LABELS.indexOf(slot) - 1;

            while (checkShiftIdx >= 0 && !foundPrev) {
              while (checkSlotIdx >= 0 && !foundPrev) {
                const prevSlot = SLOT_LABELS[checkSlotIdx];
                const prevKey = `${shifts[checkShiftIdx].date}_${shifts[checkShiftIdx].shift.toUpperCase()}_${prevSlot}`;
                const prevStatus = SLOT_STATUS.get(prevKey);
                if (prevStatus) {
                  if (prevStatus.isQuick) {
                    if (checkShiftIdx < shiftIdx) {
                      // Quick Action is from a PREVIOUS shift — do NOT carry it into this shift at all
                      suffixFromPrevShift = true;
                      // suffix stays '' — no label, no hiding
                    } else {
                      suffix = ` (Continued from ${prevStatus.type})`;
                      contQuickSameShift = true;
                    }
                  }
                  foundPrev = true;
                }
                checkSlotIdx--;
              }
              if (!foundPrev) {
                checkShiftIdx--;
                checkSlotIdx = SLOT_LABELS.length - 1;
              }
            }
          }

          if (hideFilled) {
            // Main Dropdown: Hide ONLY the slots that already have an entry —
            //  - a Main entry (don't re-enter Main), or
            //  - a genuine (manually-taken) Quick Action entry (that slot is recorded).
            if (hasMain) return;
            // SYSTEM-AUTOFILL carry-forward placeholders are NOT hidden: the hour stays
            // selectable so the supervisor can enter the real production that ran, which
            // replaces the placeholder server-side. Only a genuine quick action is hidden.
            if (currentStatus && currentStatus.isQuick && !currentStatus.isAutoFill) return;
            if (currentStatus && currentStatus.isAutoFill) {
              suffix = ` (Auto-filled ${currentStatus.type || ''} — tap to enter actual)`;
            }
            // A slot carried forward by a same-shift Quick Action is hidden ONLY when a
            // later real entry closes the range (Quick Action → … empty gap … → Manual entry).
            // The gap slots belong to the continuous entry, so once the range is closed they
            // must not be re-entered. A TRAILING (open-ended) continuation with no later entry
            // stays selectable, so the supervisor can still add Main production after a restart.
            if (contQuickSameShift && hasLaterRealEntry(shiftIdx, SLOT_LABELS.indexOf(slot))) return;
            // NOTE: open-ended "Continued from …" slots are still NOT hidden — see above.
          } else {
            // Colour Change Dropdown: Show All Past. Warn if entries exist.
            const parts = [];
            if (hasMain) parts.push('Main Done');
            if (hasCC) parts.push('CC Done');
            if (currentStatus && currentStatus.isQuick) parts.push(currentStatus.type || 'Quick Action');

            if (parts.length > 0) suffix = ` (${parts.join(', ')})`;
          }

          // Format Label
          const dLabel = s.labelDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
          let timeRange = '';

          // Generate 24h Time Range Label
          // Use 'endH' calculated above (which is the End Hour in 24h format)
          // Start Hour is endH - 1 (handle 0/24 wrapping)

          let displayEnd = endH;
          if (displayEnd > 24) displayEnd -= 24; // e.g. 25 -> 1

          let displayStart = displayEnd - 1;
          if (displayStart < 0) displayStart = 23;

          // Format "HH:00 AM/PM"
          const fmt = h => {
            let suffix = 'AM';
            let hr = h;
            if (hr >= 12) {
              suffix = 'PM';
              if (hr > 12) hr -= 12;
            }
            if (hr === 0) hr = 12;
            return `${String(hr).padStart(2, '0')}:00 ${suffix}`;
          };

          // Special Case Override for display accuracy based on Shift
          // If Night Shift and slot is 12-01 (End 13 or 25 or 1?), we calculated endH effectively.
          // Let's rely on the 'endH' we computed for constraints, but re-compute nice labels.

          if (s.shift === 'Day') {
            // Day Shift (07:00 - 19:00)
            // Slot 07-08 -> 07:00 AM - 08:00 AM  (FIRST slot)
            // Slot 08-09 -> 08:00 AM - 09:00 AM
            // Slot 11-12 -> 11:00 AM - 12:00 PM
            // Slot 12-01 -> 12:00 PM - 01:00 PM
            // Slot 06-07 -> 06:00 PM - 07:00 PM  (LAST slot)

            const firstPart = parseInt(slot.split('-')[0], 10);
            let hStart = firstPart;
            if (hStart === 12) hStart = 12;
            else if (hStart < 7) hStart += 12; // 1->13, 2->14, ..., 6->18 (PM slots)
            // 7, 8, 9, 10, 11, 12 stay as-is (AM/Noon)

            let hEnd = hStart + 1;
            timeRange = `${fmt(hStart)} - ${fmt(hEnd)}`;

          } else {
            // Night Shift (20:00 - 08:00)
            // Slot 08-09 -> 20:00 - 21:00

            const firstPart = parseInt(slot.split('-')[0], 10);
            let hStart = firstPart;

            // Night slot label mapping (slot label → real 24h start hour)
            // 07-08 → 19:00 (first slot, 7 PM)
            // 08-09 → 20:00, 09-10 → 21:00, 10-11 → 22:00, 11-12 → 23:00
            // 12-01 → 00:00 (midnight), 01-02 → 01:00 … 06-07 → 06:00
            if (hStart === 7) hStart = 19;          // 07-08 → 7 PM
            else if (hStart >= 8 && hStart <= 11) hStart += 12; // 8-11 → 20-23
            else if (hStart === 12) hStart = 0;     // 12-01 → midnight
            // 1–6 stay as-is (01-02 → 1 AM … 06-07 → 6 AM)

            let hEnd = hStart + 1;
            timeRange = `${fmt(hStart)} - ${fmt(hEnd)}`;
          }

          const label = `${timeRange} | ${dLabel}${suffix}`;
          const value = `${s.date}|${s.shift}|${slot}`;

          const opt = new Option(label, value);

          if (selectedVal && value.includes(selectedVal)) {
            opt.selected = true;
          }

          sel.add(opt);
        });
      });

      // Add hook to update date/shift on change
      sel.onchange = (e) => {
        const v = e.target.value;
        if (!v) return;
        const [d, sh, sl] = v.split('|');
        const dEl = el('d-date');
        const sEl = el('d-shift');

        // Update selectors if they exist and match
        // Update selectors if they exist and match
        // Note: d-date might be populated? 
        // We can force value if options exist, or add option if missing?
        // Usually d-date has Today/Yesterday.
        if (dEl) {
          // Try set
          dEl.value = d;
          // If not in options, maybe add? 
          // Usually buildDateSelect handles 7 days.
        }
        if (sEl) sEl.value = sh;

        // Update Session/UI without triggering full refresh (which resets this dropdown)
        // loadQueue(); // Optional: if queue depends on selected date/shift? Usually not.
        // loadRecent(); 
      };
    }
    let REJECT_REASONS = [
      ['A', 'Short Moulding'], ['B', 'Shrinkage Mark'], ['C', 'Silver Streak/Colour Variation/Trail'],
      ['D', 'Flow Mark/Weld Line'], ['E', 'Fitment Issue'], ['F', 'Dent Mark/Air Bubble'], ['G', 'Warpage'],
      ['H', 'Black/Water Marks'], ['I', 'Startup Pcs/Color Change Pcs'], ['J', 'Bottom bulging issue'],
      ['K', 'Scratch'], ['L', 'Over Lapping'], ['M', 'Punching Hole Issue'],
      ['OTHER', 'Other (Please Specify)']
    ];
    let DOWNTIME_REASONS = [
      ['1', 'Manpower Shortage'], ['2', 'Mould Change Over'], ['3', 'Accessories Shortage'], ['4', 'Material Shortage'],
      ['5', 'M/C Under Manintaince (Water/Oil/Air Leakage)'], ['6', 'Nozzle Block/Change'], ['7', 'Mould Problem'],
      ['8', 'Power Failure/Pre Heating'], ['9', 'Color Change Time'], ['10', 'Process Setting'], ['11', 'Mould Trial'], ['12', 'Crane/Hrtc'], ['13', 'No Plan'],
      ['OTHER', 'Other (Please Specify)']
    ];

    function getRejName(code) {
      if (code && code.startsWith('OTHER_')) return code.replace('OTHER_', '');
      const found = REJECT_REASONS.find(f => f[0] === code);
      return found ? `${code} - ${found[1]}` : code;
    }
    function getDtName(code) {
      if (code && code.startsWith('OTHER_')) return code.replace('OTHER_', '');
      const found = DOWNTIME_REASONS.find(f => f[0] === code);
      return found ? `${code} - ${found[1]}` : code;
    }
    let OPERATOR_ACTIVITIES = []; // Managed via API
    let appSettings = { geofence_enabled: 'false' };

    /* ---------- Geofence (adjust to your site) ---------- */
    const GEOFENCE = { center: { lat: 20.318738, lng: 72.951258 }, radiusMeters: 15000 };

    /* ==================== Helpers ==================== */
    /* DOM CACHE: faster el() lookups */
    const domCache = {};
    function el(id) {
      if (!domCache[id]) {
        domCache[id] = document.getElementById(id);
      }
      return domCache[id];
    }

    // GLOBAL LOADING HANDLER
    let loadingCount = 0;
    let _loadingWatchdog = null;

    let _overlaySuppressedUntil = 0;

    function _forceHideLoading() {
      loadingCount = 0;
      clearTimeout(_loadingWatchdog);
      _loadingWatchdog = null;
      // Sticky dismiss: after a tap-dismiss (or the watchdog firing) keep the overlay
      // suppressed briefly so a chained request can't re-block the screen the instant
      // the writer dismissed it — that made taps look like they "did nothing".
      _overlaySuppressedUntil = Date.now() + 4000;
      const o = el('loading-overlay');
      if (o) o.classList.add('hidden');
    }
    window._forceHideLoading = _forceHideLoading;

    function showLoading() {
      loadingCount++;
      if (Date.now() < _overlaySuppressedUntil) return; // recently dismissed by hand — stay hidden
      const o = el('loading-overlay');
      if (o) o.classList.remove('hidden');
      // Hard cap: force-hide 10s after the overlay first became visible. Nested
      // showLoading() calls must NOT reset the timer — chained slow requests
      // (submit → refresh → status check) used to extend it forever ("Processing…" stuck).
      if (!_loadingWatchdog) {
        _loadingWatchdog = setTimeout(() => {
          if (loadingCount > 0) _forceHideLoading();
        }, 10000);
      }
    }

    function hideLoading() {
      loadingCount = Math.max(0, loadingCount - 1);
      if (loadingCount === 0) {
        clearTimeout(_loadingWatchdog);
        _loadingWatchdog = null;
        const o = el('loading-overlay');
        if (o) o.classList.add('hidden');
      }
    }
    const show = id => el(id).classList.remove('hidden');
    const hide = id => el(id).classList.add('hidden');

    /* ---- AUTO-UPDATE: reload when the server ships a new version ----
       Factory phones keep this PWA open for days, so a deployed fix never reaches
       them until someone manually reloads. Poll /api/version every 5 min and when
       the app returns to the foreground; if the server version changed, reload —
       but only when it can't destroy work in progress. */
    let _bootAppVersion = null;
    function _safeToReload() {
      if (loadingCount > 0) return false;                                   // request in flight
      const shots = el('d-shots');
      if (shots && String(shots.value || '').trim() !== '') return false;   // mid-entry
      const conf = el('modal-confirm');
      if (conf && !conf.classList.contains('hidden')) return false;         // awaiting a choice
      return true;
    }
    function _checkAppVersion() {
      apiFetch('/api/version')
        .then(r => r.json())
        .then(v => {
          if (!v || !v.version) return;
          if (_bootAppVersion === null) { _bootAppVersion = v.version; return; }
          if (v.version !== _bootAppVersion && _safeToReload()) {
            console.log('[AutoUpdate] server is', v.version, '— reloading (booted with', _bootAppVersion + ')');
            location.reload();
          }
        })
        .catch(() => { /* offline — try again next tick */ });
    }
    setInterval(_checkAppVersion, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) _checkAppVersion(); });
    _checkAppVersion(); // records the booted version

    // ======== RECENT SLOT ENTRIES ========
    async function openRecentSlots() {
      const machine = session.machine;
      const date  = el('d-date') ? el('d-date').value : session.shiftDate;
      const shift = el('d-shift') ? el('d-shift').value : session.shift;
      if (!machine) return;
      el('recent-slots-title').textContent    = '📋 ' + machine;
      el('recent-slots-subtitle').textContent = shift + ' Shift · ' + date;
      el('recent-slots-body').innerHTML = '<div class="muted" style="text-align:center;padding:24px">Loading…</div>';
      show('modal-recent-slots');
      let entries = [];
      try {
        const r = await fetch('/api/dpr/recent?machine=' + encodeURIComponent(machine) + '&date=' + encodeURIComponent(date) + '&shift=' + encodeURIComponent(shift) + '&limit=50');
        const j = await r.json();
        if (j && j.data && Array.isArray(j.data.rows)) entries = j.data.rows;
        else if (j && Array.isArray(j.data)) entries = j.data;
        else if (j && Array.isArray(j.rows)) entries = j.rows;
      } catch (e) {
        el('recent-slots-body').innerHTML = '<div class="muted" style="text-align:center;padding:24px">Failed to load</div>';
        return;
      }
      const SLOTS = ['07-08','08-09','09-10','10-11','11-12','12-01','01-02','02-03','03-04','04-05','05-06','06-07'];
      const bySlot = {};
      for (const e of entries) {
        const s = e.HourSlot || e.slot || e.hour_slot;
        if (s) bySlot[s] = e;
      }
      const TYPE_BADGE = {
        'MAIN':{ icon:'✅', color:'#22c55e' }, 'ColourChange':{ icon:'🎨', color:'#a78bfa' },
        'Maintenance':{ icon:'🔧', color:'#f59e0b' }, 'MouldChange':{ icon:'🔄', color:'#3b82f6' },
        'ManPowerShortage':{ icon:'👷', color:'#ef4444' }, 'NoPlan':{ icon:'⛔', color:'#6b7280' },
      };
      function decodeBreakup(jsonVal, lookupArr) {
        if (!jsonVal) return '';
        let obj = jsonVal;
        if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch(_) { return ''; } }
        return Object.entries(obj).filter(([,v]) => Number(v) > 0).map(([code, val]) => {
          const found = lookupArr.find(r => r[0] === code);
          return (found ? found[1] : code) + ' (' + val + ')';
        }).join(', ');
      }
      const TYPE_COLOR = {
        'MAIN':'#22c55e','ColourChange':'#a78bfa','Maintenance':'#f59e0b',
        'MouldChange':'#3b82f6','ManPowerShortage':'#ef4444','NoPlan':'#6b7280'
      };
      let html = '<div style="display:flex;flex-direction:column;gap:6px">';
      for (const slot of SLOTS) {
        const e = bySlot[slot];
        if (e) {
          const entryType = e.EntryType || e.entry_type || 'Entry';
          const tc = TYPE_COLOR[entryType] || '#94a3b8';
          const qty = e.GoodQty != null ? e.GoodQty : (e.good_qty != null ? e.good_qty : '—');
          const rejTotal = e.RejectQty != null ? e.RejectQty : (e.reject_qty != null ? e.reject_qty : 0);
          const colVal = e.Colour || e.colour || '';
          const rejDetail = decodeBreakup(e.RejectBreakup || e.reject_breakup, REJECT_REASONS);
          const dtDetail  = decodeBreakup(e.DowntimeBreakup || e.downtime_breakup, DOWNTIME_REASONS);
          html += '<div style="border-radius:10px;background:var(--card);border:1px solid var(--line);overflow:hidden">'
            // top row: slot | type pill | qty
            + '<div style="display:flex;align-items:center;gap:8px;padding:9px 12px">'
            + '<span style="font-size:0.72rem;font-weight:700;min-width:34px;color:var(--muted);font-variant-numeric:tabular-nums">' + slot + '</span>'
            + '<span style="flex:1;font-size:0.72rem;font-weight:700;color:' + tc + ';background:' + tc + '18;padding:2px 8px;border-radius:20px;display:inline-block;max-width:fit-content">' + entryType + '</span>'
            + '<span style="font-size:0.88rem;font-weight:800;color:var(--text)">' + qty + '</span>'
            + '<span style="font-size:0.72rem;color:#22c55e;font-weight:700">✓</span>'
            + (Number(rejTotal) > 0 ? '<span style="font-size:0.72rem;color:#ef4444;font-weight:700">' + rejTotal + ' ✗</span>' : '')
            + '</div>'
            // sub-row: colour + reject + downtime details
            + ((colVal || rejDetail || dtDetail) ? '<div style="padding:0 12px 8px 12px;display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line)">'
            + (colVal ? '<span style="font-size:0.7rem;color:var(--muted);padding-top:4px">🎨 <b style="color:var(--text)">' + colVal + '</b></span>' : '')
            + (rejDetail ? '<span style="font-size:0.67rem;color:#ef4444">✗ ' + rejDetail + '</span>' : '')
            + (dtDetail  ? '<span style="font-size:0.67rem;color:#f59e0b">⏱ ' + dtDetail  + '</span>' : '')
            + '</div>' : '')
            + '</div>';
        } else {
          html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px dashed var(--line);opacity:0.4">'
            + '<span style="font-size:0.72rem;font-weight:700;min-width:34px;color:var(--muted);font-variant-numeric:tabular-nums">' + slot + '</span>'
            + '<span style="font-size:0.72rem;color:var(--muted)">— No entry</span>'
            + '</div>';
        }
      }
      html += '</div>';
      el('recent-slots-body').innerHTML = html;
    }
    window.openRecentSlots = openRecentSlots;
    const safe = v => (v === null || v === undefined) ? '' : String(v);
    const fmtDT = v => { try { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString(); } catch (_) { return '' } };
    const fmtD = v => { try { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(); } catch (_) { return '' } };
    function distMeters(a, b) { const R = 6371000, toRad = x => x * Math.PI / 180; const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
    function insideGeofence(lat, lng, acc) { if (lat == null || lng == null) return false; const d = distMeters({ lat, lng }, GEOFENCE.center); const margin = Math.max(50, Math.min(400, Number(acc || 0))); return (d - margin) <= GEOFENCE.radiusMeters; }

    /* ==================== Geo handling ==================== */
    let lastGeo = null;
    function currentGeoObj() { return lastGeo ? { lat: lastGeo.lat, lng: lastGeo.lng, accuracy: lastGeo.acc } : null; }

    function updateGeoUI() {
      const debugEl = el('geo-debug');
      const pillEl = el('geo-pill');
      if (!lastGeo) {
        if (debugEl) debugEl.textContent = 'Location: not available. Allow location to continue.';
        if (pillEl) pillEl.textContent = '';
        return;
      }
      const inside = insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc);
      const accTxt = Math.round(lastGeo.acc || 0);
      const txt = (inside ? 'Inside geofence' : 'Outside geofence') + ` • ~${accTxt} m`;
      if (debugEl) debugEl.textContent = txt;
      if (pillEl) pillEl.textContent = txt;
    }

    function startGeoWatch() {
      if (!('geolocation' in navigator)) return;
      try {
        navigator.geolocation.watchPosition(
          p => {
            lastGeo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: new Date() };
            updateGeoUI();
            validateForm();
          },
          _ => {
            updateGeoUI();
            validateForm();
          },
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 }
        );
      } catch (_) { }
    }

    async function bestGeoFix(n = 3) {
      if (!('geolocation' in navigator)) throw new Error('GEO_UNSUPPORTED');
      let best = null;
      for (let i = 0; i < n; i++) {
        try {
          const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, maximumAge: 0, timeout: 9000 }));
          if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
          lastGeo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: new Date() };
          updateGeoUI();
          if (p.coords.accuracy <= 50) break;
        } catch (e) { }
        await new Promise(r => setTimeout(r, 600));
      }
      if (!best) throw new Error('GEO_DENIED');
      return lastGeo;
    }

    async function recalibrate() {
      const msg = el('login-msg');
      if (msg) msg.textContent = 'Recalibrating location…';
      try {
        await bestGeoFix(4);
        if (lastGeo && insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc)) {
          msg.innerHTML = '<span class="ok">Location locked. You can login now.</span>';
        } else {
          msg.innerHTML = '<span class="warn">Location updated but still outside geofence / low accuracy.</span>';
        }
      } catch (e) {
        msg.innerHTML = '<span class="err">Location unavailable. Check GPS & permissions.</span>';
      }
    }

    /* ==================== Session + bootstrap ==================== */
    const session = { username: null, line: null, machine: null, activeJob: null, factoryId: null, global_access: null };
    let setupDone = false;
    let jobColorsData = {};   // colour → {plan, bal}
    let usedSlots = [];       // locked hour slots
    let sessionDateChoice = null; // 'today' | 'yesterday' — remembered date pick for this page session only (resets on reload)
    let customDateChoice = null;  // ISO date — back-date picked by an all-lines user (this page session only)

    /* All-lines users may back-date entries (up to 30 days). Partial-line users are limited to Today/Yesterday. */
    function isAllLineAccess() {
      const ln = (session.line || '').trim().toLowerCase();
      return ln === 'all' || session.global_access === true;
    }

    /* Roles that may back-date entries (up to 30 days) even without all-line access,
       so PPC/Planner/Admin can complete pending back-dated entries. Keep in sync with
       BACKDATE_ROLES in registerLegacyRoutes.js assertDateEntryAllowed(). */
    const BACKDATE_ROLES = ['ppc_manager', 'ppc_ass_manager', 'planner', 'admin', 'superadmin'];
    function canBackDate() {
      if (isAllLineAccess()) return true;
      return BACKDATE_ROLES.includes(String(session.role_code || '').trim().toLowerCase());
    }

    /* Refresh line access + global_access from the server so a stale cached session
       (e.g. logged in before the feature shipped) still unlocks the date picker
       without forcing a re-login. Fire-and-forget; rebuilds the date select on change. */
    async function refreshUserAccess() {
      if (!session.username) return;
      try {
        const r = await apiFetch(`/api/user/access?username=${encodeURIComponent(session.username)}`);
        const j = await r.json();
        if (!j || !j.ok || !j.data) return;
        const wasAll = canBackDate();
        session.line = j.data.line || session.line;
        session.role_code = j.data.role_code || session.role_code;
        session.global_access = j.data.global_access === true;
        try {
          const raw = JSON.parse(localStorage.getItem('jpsmsSession') || '{}');
          raw.line = session.line;
          raw.role_code = session.role_code;
          raw.global_access = session.global_access;
          localStorage.setItem('jpsmsSession', JSON.stringify(raw));
        } catch (_) { }
        // If access changed and the date select is present, rebuild so the picker appears/hides.
        if (canBackDate() !== wasAll && el('d-date')) buildDateSelect();
      } catch (_) { }
    }

    // [FIX] Factory Isolation Wrapper
    async function apiFetch(url, options = {}) {
      options.headers = options.headers || {};
      if (typeof options.body === 'string' && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }

      // Inject Factory ID from session
      if (session.factoryId) {
        options.headers['X-Factory-ID'] = session.factoryId;
      }

      // 60s Timeout
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 15000); // 15s
      options.signal = controller.signal;

      try {
        const res = await fetch(url, options);
        clearTimeout(id);
        return res;
      } catch (e) {
        clearTimeout(id);
        throw e;
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { const b = document.getElementById('boot'); if (b) b.classList.add('done'); }, 50);

      function realInit() {
        if (location.protocol !== 'https:') { console.warn('Geolocation requires HTTPS on most browsers.'); }
        startGeoWatch();
        updateGeoUI();
        buildDateSelect(); // Ensure dates are populated

        // Load Settings & Reasons in one request
        apiFetch('/api/supervisor/bootstrap').then(r => r.json()).then(res => {
          if (res.ok) {
            if (res.settings) appSettings = res.settings;
            if (res.reasons && res.reasons.length) {
              const r = [], d = [], o = [];
              res.reasons.forEach(x => {
                // Use Code if available (e.g., 'A', '1'), else ID
                const code = x.code || String(x.id);
                if (x.type === 'REJECTION') r.push([code, x.reason]);
                if (x.type === 'DOWNTIME') d.push([code, x.reason]);
                if (x.type === 'OPERATOR_ACTIVITY') o.push([x.reason]); // Only need name
              });
              // Sort arrays by code naturally (1, 2, 10, A, B, C)
              r.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
              d.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));

              // Ensure OTHER is always included at the end
              if (r.length) { r.push(['OTHER', 'Other (Please Specify)']); REJECT_REASONS = r; }
              if (d.length) { d.push(['OTHER', 'Other (Please Specify)']); DOWNTIME_REASONS = d; }
              if (o.length) OPERATOR_ACTIVITIES = o.map(x => x[0]);
            }
          }
        });
        try {
          const raw = localStorage.getItem('jpsmsSession');
          if (raw) {
            const s = JSON.parse(raw);
            if (s && s.line) {
              session.username = s.username || '';
              session.line = s.line;
              session.machine = s.machine || null;
              session.factoryId = s.factoryId || null; // [FIX] Load Factory ID
              session.role_code = s.role_code || null; // [NEW] Load Role Code
              session.global_access = s.global_access || null; // [NEW] All-lines back-date access

              if (session.machine) updateFilledSlots();

              el('line-name').textContent = session.line;
              showAppView(true);
              refreshUserAccess(); // refresh line/global_access from server (no re-login needed)
              loadMachines();   // will respect session.machine if present & call loadQueue+loadRecent
              return;
            }
          }
        } catch (e) { console.error('Session load error', e); }

        // If no session, show login
        show('view-login');
      }

      realInit();
    });

    function showAppView(showing) {
      const login = el('view-login'), app = el('view-app');
      if (showing) { login.classList.add('hidden'); app.classList.remove('hidden'); }
      else { app.classList.add('hidden'); login.classList.remove('hidden'); }
    }

    function showPage(id, btn) {
      document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
      el(id).classList.remove('hidden');
      document.querySelectorAll('.tabs button').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
    }

    function isoDate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }

    function buildDateSelect() {
      const selDate = el('d-date'); selDate.innerHTML = '';
      const selShift = el('d-shift');

      const realNow = new Date();
      const h = realNow.getHours();
      const m = realNow.getMinutes();
      const totalMins = h * 60 + m;

      // LOGIC: Shift Change at 08:10 AM & 08:10 PM (factory handover rule)
      // Day Shift:   08:10 AM (490m) to 08:10 PM (1210m)
      // Night Shift: 08:10 PM (1210m) to 08:10 AM (490m next day)
      // Entries at 08:00–08:09 belong to the outgoing Night shift (Yesterday).
      // Entries at 20:00–20:09 belong to the outgoing Day shift (Today).

      let useDate = new Date(realNow);
      let setShift = 'Day';

      if (totalMins >= 490 && totalMins < 1210) {
        // Day Shift (Today)
        setShift = 'Day';
      } else {
        // Night Shift
        setShift = 'Night';
        if (totalMins < 490) {
          // Early morning (< 08:10) -> Belongs to YESTERDAY'S Night Shift
          useDate.setDate(useDate.getDate() - 1);
        }
        // If >= 20:10 -> Belongs to TODAY'S Night Shift
      }

      // Reset hours for clean date comparison
      useDate.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yest = new Date(today); yest.setDate(today.getDate() - 1);

      selDate.add(new Option('Today (' + fmtD(today) + ')', isoDate(today)));
      selDate.add(new Option('Yesterday (' + fmtD(yest) + ')', isoDate(yest)));

      // All-lines users + PPC/Planner/Admin may back-date up to 30 days. Others: Today/Yesterday only.
      const custom = el('d-date-custom');
      if (canBackDate()) {
        // Re-attach a previously picked custom back-date so it survives shift/job changes.
        if (customDateChoice && customDateChoice !== isoDate(today) && customDateChoice !== isoDate(yest)) {
          const cd = new Date(customDateChoice + 'T00:00:00');
          selDate.add(new Option(fmtD(cd) + ' (picked)', customDateChoice));
        }
        // Show the native date field inline (always visible). No sentinel option,
        // no showPicker() dance — the supervisor just taps the field to back-date.
        if (custom) {
          const minD = new Date(today); minD.setDate(today.getDate() - 30);
          custom.min = isoDate(minD);
          custom.max = isoDate(today);
          custom.classList.remove('hidden');
        }
      } else if (custom) {
        custom.classList.add('hidden');
      }

      // Auto-select calculated date
      selDate.value = isoDate(useDate);

      // Re-apply the supervisor's manual date pick if one was made this session,
      // so switching to Yesterday "sticks" across job opens / refreshes.
      if (customDateChoice && hasOption(selDate, customDateChoice)) {
        selDate.value = customDateChoice;
      } else if (sessionDateChoice === 'yesterday' && hasOption(selDate, isoDate(yest))) {
        selDate.value = isoDate(yest);
      } else if (sessionDateChoice === 'today' && hasOption(selDate, isoDate(today))) {
        selDate.value = isoDate(today);
      }

      // Auto-select calculated shift if element exists
      if (selShift) {
        selShift.value = setShift;
        // Trigger change to refresh slots etc
        if (typeof onShiftChange === 'function') onShiftChange();
      }
    }

    /* UPDATED refreshSlots: BLOCK FUTURE SLOTS */


    function onShiftChange() {
      try {
        const sh = el('d-shift').value || '';
        if (sh) localStorage.setItem('jpsms_last_shift', sh);
      } catch (_) { }

      refreshSlots();
      if (session.activeJob) checkStdStatus();
      validateForm();
      // On Shift Change, strict re-check if user tries to enter DPR
      hasCheckedShiftTeam = false;
    }

    /* ==================== SHIFT TEAM LOGIC ==================== */
    let hasCheckedShiftTeam = false; // Local flag to minimize API calls if already passed
    let shiftTeamData = null; // Store fetched data

    function openShiftTeamModal(isBlocking = false) {
      show('modal-shift-team');
      el('st-msg').innerHTML = '';

      const btnClose = el('btn-close-st');
      if (isBlocking) {
        btnClose.classList.add('hidden');
        el('st-msg').innerHTML = '<span class="warn">Please fill Shift Team details before entering DPR.</span>';
      } else {
        btnClose.classList.remove('hidden');
      }

      const dateVal = el('d-date').value;
      const shiftVal = el('d-shift').value;
      const dateTxt = el('d-date').options[el('d-date').selectedIndex].text;
      el('st-info').textContent = `${shiftVal} Shift • ${dateTxt}`;

      // --- DUAL-FORM LOGIC ---
      const rawLine = session.line || '';
      let targetLines = [];

      if (rawLine.includes(',')) {
        // Explicit multiple lines assigned (e.g. "B -L2,C -L2")
        targetLines = rawLine.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        // Single line -> Strict (No B&F inference)
        targetLines = [rawLine].filter(Boolean);
      }

      // Sort alpha
      targetLines.sort();

      // Store targets
      el('modal-shift-team').dataset.targets = JSON.stringify(targetLines);

      // Render Forms
      const container = el('st-forms-container');
      container.innerHTML = '<div style="text-align:center; padding:20px"><i class="bi bi-arrow-repeat spin"></i> Loading entries...</div>';

      // Fetch Data for ALL targets parallel
      Promise.all(targetLines.map(l =>
        apiFetch(`/api/shift/team?line=${encodeURIComponent(l)}&date=${dateVal}&shift=${shiftVal}`).then(r => r.json())
      )).then(results => {
        container.innerHTML = ''; // Clear loading

        targetLines.forEach((lineKey, idx) => {
          const res = results[idx];
          const d = (res.ok && res.data) ? res.data : {};

          // Create Form Block
          const div = document.createElement('div');
          div.style.cssText = 'background:#f8fafc; padding:16px; border:1px solid #e2e8f0; border-radius:8px';

          div.innerHTML = `
               <div style="font-weight:700; color:#0f172a; margin-bottom:12px; padding-bottom:8px; border-bottom:1px dashed #cbd5e1; display:flex; align-items:center; gap:8px">
                 <span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px; font-size:0.85rem">Assign Line : ${lineKey}</span>
               </div>
               <div class="grid-2">
                 <label>Entry Person <span style="color:red">*</span>
                   <input id="st-entry-${lineKey}" value="${d.entry_person || ''}" placeholder="Required" style="font-weight:600">
                 </label>
                 <label>Prodn Supervisor <span style="color:red">*</span>
                   <input id="st-prod-sup-${lineKey}" value="${d.prod_supervisor || ''}" placeholder="Required">
                 </label>
               </div>
               <div class="grid-3" style="margin-top:12px">
                 <label>QC Supervisor
                   <input id="st-qc-sup-${lineKey}" value="${d.qc_supervisor || ''}" placeholder="Name">
                 </label>
                 <label>Die Setter
                   <input id="st-die-setter-${lineKey}" value="${d.die_setter || ''}" placeholder="Name">
                 </label>
                 <label>Engineer
                   <input id="st-engineer-${lineKey}" value="${d.engineer || ''}" placeholder="Name">
                 </label>
               </div>
             `;
          container.appendChild(div);
        });
      });
    }

    function closeShiftTeamModal() {
      hide('modal-shift-team');
    }

    function saveShiftTeam() {
      const targets = JSON.parse(el('modal-shift-team').dataset.targets || '[]');
      if (!targets.length) {
        // Fallback
        const val = session.line || '';
        if (val.includes(',')) {
          targets.push(...val.split(',').map(s => s.trim()));
        } else {
          targets.push(val);
        }
      }

      const dateVal = el('d-date').value;
      const shiftVal = el('d-shift').value;
      const validPayloads = [];

      // Validate ALL forms
      for (const l of targets) {
        const entry = el(`st-entry-${l}`).value.trim();
        const prod = el(`st-prod-sup-${l}`).value.trim();

        // Reset border colors first
        el(`st-entry-${l}`).style.borderColor = '';
        el(`st-prod-sup-${l}`).style.borderColor = '';

        if (!entry || !prod) {
          el('st-msg').innerHTML = `<span class="err">Line ${l}: Entry Person & Prod Supervisor are required.</span>`;
          // Highlight error
          el(`st-entry-${l}`).style.borderColor = !entry ? 'red' : '';
          el(`st-prod-sup-${l}`).style.borderColor = !prod ? 'red' : '';
          return; // Stop and show error
        }

        validPayloads.push({
          line: l,
          date: dateVal,
          shift: shiftVal,
          entry_person: entry,
          prod_supervisor: prod,
          qc_supervisor: el(`st-qc-sup-${l}`).value.trim(),
          die_setter: el(`st-die-setter-${l}`).value.trim(),
          engineer: el(`st-engineer-${l}`).value.trim()
        });
      }

      el('st-msg').textContent = 'Saving...';
      const btn = document.querySelector('#modal-shift-team button.primary');
      if (btn) btn.disabled = true;

      // Send parallel
      const promises = validPayloads.map(p => {
        return apiFetch('/api/shift/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p)
        }).then(r => r.json());
      });

      Promise.all(promises)
        .then(results => {
          if (results.every(r => r.ok)) {
            el('st-msg').innerHTML = '<span class="ok">All Saved Successfully!</span>';
            hasCheckedShiftTeam = true;
            // Cache just the first one for "Entered By" usage later? 
            // Or keep it simple.
            shiftTeamData = { entry_person: validPayloads[0].entry_person };

            setTimeout(() => {
              closeShiftTeamModal();
              if (btn) btn.disabled = false;
            }, 800);
          } else {
            el('st-msg').innerHTML = '<span class="err">Some saves failed. Please check.</span>';
            if (btn) btn.disabled = false;
          }
        })
        .catch(err => {
          console.error(err);
          el('st-msg').innerHTML = '<span class="err">Network Error</span>';
          if (btn) btn.disabled = false;
        });
    }

    // BLOCKING LOGIC
    async function checkShiftTeamBlocking() {
      // If we already confirmed it for this session/load, skip
      if (hasCheckedShiftTeam) return true;

      // v58: Bypass for 'All' line access
      if (session.line && session.line.toLowerCase() === 'all') return true;

      // --- 1. TIME CHECK (Grace Period) ---
      // Requirement: Enforce only after 08:10 AM (Day) or 08:10 PM (Night).
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const totalMins = h * 60 + m; // 0..1439
      const shift = el('d-shift').value;

      if (shift === 'Day') {
        // Day Shift Start: 08:00
        // Enforce AFTER 08:10 (490 mins)
        // If time is < 08:10, ALLOW (return true)
        if (totalMins < 490) return true;
      } else {
        // Night Shift Start: 20:00 (1200 mins)
        // Enforce AFTER 20:10 (1210 mins)
        // Valid Night Time: 20:00..23:59 OR 00:00..08:00

        // If time is between 20:00 and 20:10, ALLOW.
        // Also need to handle if user opens it way early (e.g. 7 PM)? 
        // Logic: Enforce if (Time >= 20:10) OR (Time < 08:10 AM next day).
        // Conversely: Allow if (Time >= 08:10 AM AND Time < 20:10 PM) -> Wait, that's Day shift time.
        // Let's stick to the "After start" logic.

        // Night Grace Period: 20:00 to 20:10.
        // If current time is >= 20:00 AND < 20:10, ALLOW.
        if (totalMins >= 1200 && totalMins < 1210) return true;

        // Note: If it is 20:15, Block. If it is 02:00 AM, Block.
      }

      let line = session.line || '';
      if (line.includes(',')) {
        line = line.split(',')[0].trim();
      }

      const date = el('d-date').value;

      try {
        const r = await apiFetch(`/api/shift/team?line=${encodeURIComponent(line)}&date=${date}&shift=${shift}`);
        const res = await r.json();

        // FIX: Strict check for empty array/object
        let hasData = false;
        if (res.ok && res.data) {
          if (Array.isArray(res.data)) {
            hasData = res.data.length > 0; // Check array length
          } else {
            // Check object keys (e.g. { entry_person: ... })
            hasData = Object.keys(res.data).length > 0;
          }
        }

        if (hasData) {
          shiftTeamData = Array.isArray(res.data) ? res.data[0] : res.data; // Store first item if array
          hasCheckedShiftTeam = true;
          return true;
        }
      } catch (e) { console.error(e); }

      // Not found -> Block
      alert(`Shift Team Details Missing!\n\nLine: ${line}\nDate: ${date}\nShift: ${shift}\n\nPlease enter Shift Team details first.`);
      openShiftTeamModal(true); // true = isBlocking
      return false;
    }

    // Override showPage to intercept DPR tab
    const originalShowPage = showPage;
    showPage = async function (id, btn) {
      if (id === 'sec-dpr') {
        // Run check
        const allowed = await checkShiftTeamBlocking();
        if (!allowed) return; // Stop navigation
      }
      originalShowPage(id, btn);
    };

    /* ✅ LIVE CAVITY VALIDATION – GLOBAL */
    function validateActCavity() {
      const stdCav = Number(el('std-cavity').value || 0);
      const actCav = Number(el('act-cavity').value || 0);

      // Validation REMOVED
      /*
      if (stdCav > 0 && actCav > stdCav) {
        el('std-msg').innerHTML =
          '<span class="err">ACT Cavity (' + actCav + ') cannot be more than STD Cavity (' + stdCav + ').</span>';
        el('act-cavity').classList.add('input-error');
      } else {
        el('std-msg').innerHTML = '';
        el('act-cavity').classList.remove('input-error');
      }
      */
      // Always clear error
      el('std-msg').innerHTML = '';
      el('act-cavity').classList.remove('input-error');
    }

    /* Article weight ±10% check — WARN ONLY (does not block the save; article
       weight is intentionally saved as-is). Shows a warning when the actual
       article weight deviates more than 10% from STD (either lighter or heavier). */
    function validateActWeight() {
      const warn = el('wt-warn');
      const act = el('act-article');
      if (!warn) return;
      const stdW = parseFloat((el('std-article') && el('std-article').value) || 0);
      // Article ACT may be typed in grams: the save treats a value >= 10 as grams
      // and stores kg (value / 1000). Normalise the same way before comparing to
      // the kg-based STD, or a grams entry would always look wildly off.
      let actW = parseFloat((act && act.value) || 0);
      if (!isNaN(actW) && actW >= 10) actW = actW / 1000;
      if (stdW > 0 && actW > 0) {
        const devPct = Math.abs(actW - stdW) / stdW * 100;
        if (devPct > 10) {
          const lo = (stdW * 0.9), hi = (stdW * 1.1);
          warn.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Weight ${devPct.toFixed(1)}% off STD (${actW} vs ${stdW}). Expected ${lo.toFixed(3)}–${hi.toFixed(3)}. You can still save.`;
          warn.style.display = 'block';
          if (act) act.classList.add('input-warn');
          return;
        }
      }
      warn.style.display = 'none';
      warn.innerHTML = '';
      if (act) act.classList.remove('input-warn');
    }

    function saveStdActual() {
      const job = session.activeJob;
      if (!job) {
        el('std-msg').textContent = 'No job selected.';
        return;
      }

      /* --- VALIDATION ---
         Article weight is deliberately NOT validated against STD (owner's decision).
         Whatever the operator enters is recorded as-is, at any deviation. The
         matching server-side guard was removed with it — leaving that in place
         would have rejected the save anyway and just moved the error later.
         Cavity and runner checks are unchanged. */
      const stdCav = parseFloat(el('std-cavity').value || 0);
      const actCav = parseFloat(el('act-cavity').value || 0);

      const stdRun = parseFloat(el('std-runner').value || 0);
      const actRun = parseFloat(el('act-runner').value || 0);

      // 1. Cavity: Act <= Std
      if (stdCav > 0 && actCav > stdCav) {
        el('std-msg').innerHTML = `<span class="err">Cavity Validation Failed: Actual (${actCav}) cannot be more than Std (${stdCav}).</span>`;
        return;
      }

      // 2. Runner: Act <= 1.5 * Std
      if (stdRun > 0 && actRun > 0) {
        const maxRun = stdRun * 1.5;
        if (actRun > maxRun) {
          el('std-msg').innerHTML = `<span class="err">Runner Validation Failed: Actual (${actRun}) exceeds 1.5x Std (${stdRun}). Max Allowed: ${maxRun.toFixed(3)}</span>`;
          return;
        }
      }
      /* ------------------ */

      const all = job._all || {};
      const orderNo =
        job.OrderNo ||
        all['Order No'] ||
        all['OrderNo'] ||
        all['OR Number'] ||
        all['Order Number'] ||
        '';

      const mouldName =
        job.Mould ||
        all['Mould'] ||
        all['Mould Name'] ||
        all['SFG Name'] ||
        '';

      const payload = {
        PlanID: String(job.PlanID || ''),
        Shift: el('d-shift').value || 'Day',
        DprDate: el('d-date').value || '',
        Machine: job.Machine || session.machine || '',
        OrderNo: orderNo,
        MouldName: mouldName,
        ArticleActual: (() => {
          const v = parseFloat(el('act-article').value);
          return (!isNaN(v) && v >= 10) ? (v / 1000) : el('act-article').value;
        })(),
        RunnerActual: el('act-runner').value,
        CavityActual: el('act-cavity').value,
        CycleActual: el('act-cycle').value,
        PcsHrActual: el('act-pcshr').value,
        ManActual: el('act-man').value,
        EnteredBy: (typeof shiftTeamData !== 'undefined' && shiftTeamData && shiftTeamData.entry_person) ? shiftTeamData.entry_person : (session.username || ''),
        SfgQtyActual: el('act-sfgqty').value,
        OperatorActivities: JSON.stringify({
          mp1: el('act-ops-mp1').value || '',
          mp2: el('act-ops-mp2').value || ''
        })
      };

      el('std-msg').textContent = 'Saving…';
      showLoading();

      apiFetch('/api/std-actual/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: { username: session.username, line: session.line },
          payload,
          geo: currentGeoObj()
        })
      })
        .then(r => r.json())
        .then(r => {
          if (r && r.ok) {
            el('std-msg').innerHTML = '<span class="ok">Saved.</span>';
            setupDone = true;
          } else {
            el('std-msg').innerHTML = '<span class="err">' + ((r && r.error) || 'Failed') + '</span>';
            setupDone = false;
          }
          validateForm();
          renderColorPlanTable(job);
        })
        .catch(err => {
          el('std-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
          setupDone = false;
          validateForm();
        })
        .finally(() => hideLoading());
    }

    function checkStdStatus() {
      const job = session.activeJob;
      if (!job) return;

      const shift = el('d-shift').value || 'Day';
      const dprDate = el('d-date').value || '';

      const all = job._all || {};
      const orderNo =
        job.OrderNo ||
        all['Order No'] ||
        all['OrderNo'] ||
        all['OR Number'] ||
        all['Order Number'] ||
        '';

      const machine = job.Machine || session.machine || '';

      const ids = [
        'act-article', 'act-runner', 'act-cavity',
        'act-cycle', 'act-pcshr', 'act-man',
        'act-sfgqty', 'ops-selector-mp1', 'ops-selector-mp2'
      ];

      show('std-actual-card');
      ids.forEach(id => el(id).disabled = true);
      el('std-msg').textContent = 'Checking…';

      // NOTE: no full-screen showLoading() here — this runs in the background after every
      // submit (buildDateSelect → onShiftChange → checkStdStatus) and was re-showing the
      // blocking "Processing…" overlay right after a save, making submits look stuck.
      // The card has its own inline 'Checking…' state and disabled inputs.

      const url = `/api/std-actual/status?planId=${encodeURIComponent(String(job.PlanID || ''))}` +
        `&shift=${encodeURIComponent(String(shift || ''))}` +
        `&date=${encodeURIComponent(String(dprDate || ''))}` +
        `&machine=${encodeURIComponent(String(machine || ''))}`;

      apiFetch(url)
        .then(r => r.json())
        .then(res => {
          console.log('std-actual/status raw:', res);
          ids.forEach(id => el(id).disabled = false);

          if (!res) {
            el('std-msg').innerHTML =
              '<span class="err">EMPTY_RESPONSE_FROM_std-actual/status (raw was null/undefined)</span>';
            setupDone = false;
            validateForm();
            return;
          }

          if (res.ok === false) {
            el('std-msg').innerHTML =
              '<span class="err">' + (res.error || 'STD status error') + '</span>';
            setupDone = false;
            validateForm();
            return;
          }


          const data = res.data || {};

          // NEW: Populate Standards (fetched from Mould Master via backend)
          if (data.std) {
            const s = data.std;
            el('std-article').value = s.article_std || '';
            el('std-runner').value = s.runner_std || '';
            el('std-cavity').value = s.cavity_std || '';
            el('std-cycle').value = s.cycle_std || '';
            el('std-pcshr').value = s.pcshr_std || '';
            el('std-man').value = s.man_std || '';
            el('std-sfgqty').value = s.sfgqty_std || '';
          } else {
            // Reset if empty, or keep blank
            ['std-article', 'std-runner', 'std-cavity', 'std-cycle', 'std-pcshr', 'std-man'].forEach(i => el(i).value = '');
          }

          if (!data.done) {

            // v60: Auto-Setup for "All" Line Access (User Request)
            // If setup is missing, auto-fill standard values and save immediately.
            if (session.line && session.line.toLowerCase() === 'all' && data.std) {
              console.log('[AutoSetup] All Access detected, applying STD to ACT...');

              // Populate Inputs from STD
              el('act-article').value = data.std.article_std || '';
              el('act-runner').value = data.std.runner_std || '';
              el('act-cavity').value = data.std.cavity_std || '';
              el('act-cycle').value = data.std.cycle_std || '';
              el('act-pcshr').value = data.std.pcshr_std || '';
              el('act-man').value = data.std.man_std || '';
              el('act-sfgqty').value = data.std.sfgqty_std || '';
              // el('act-ops').value = ''; // Keep empty

              // Trigger Save
              el('std-msg').innerHTML = '<span class="warn" style="color:#2563eb">Auto-saving STD values (All Access)...</span>';
              saveStdActual();
              return;
            }

            // ... existing code ...
            el('act-article').value = '';
            el('act-runner').value = '';
            el('act-cavity').value = '';
            el('act-cycle').value = '';
            el('act-pcshr').value = '';
            el('act-man').value = '';
            // el('act-name').value = session.username || ''; // REMOVED
            el('act-sfgqty').value = '';
            el('act-ops-mp1').value = '';
            el('act-ops-mp2').value = '';
            renderOpsChips('mp1');
            renderOpsChips('mp2');

            el('std-msg').innerHTML =
              '<span class="warn">No setup saved — enter ACT values and Save.</span>';
            setupDone = false;
            if (typeof validateActWeight === 'function') validateActWeight(); // clear any stale weight warning
            validateForm();
            return;
          }

          const row = data.row || {};

          const art = row.ArticleACTWeight ?? row.article_act ?? '';
          const run = row.RunnerACTWeight ?? row.runner_act ?? '';
          const cav = row.ACTCavity ?? row.cavity_act ?? '';
          const cyc = row.ACTCycleTime ?? row.cycle_act ?? '';
          const pcs = row.ACTPCS_HR ?? row.pcshr_act ?? '';
          const man = row.ACTMANPOWER ?? row.man_act ?? '';
          const ent = row.EnteredBy ?? row.entered_by ?? session.username ?? '';
          const sfg = row.SfgQtyActual ?? row.SFGQtyActual ?? row.sfgqty_act ?? '';
          const ops = row.OperatorActivities ?? row.operator_activities ?? '';

          el('act-article').value = String(art ?? '');
          el('act-runner').value = String(run ?? '');
          el('act-cavity').value = String(cav ?? '');
          el('act-cycle').value = String(cyc ?? '');
          el('act-pcshr').value = String(pcs ?? '');
          el('act-man').value = String(man ?? '');
          if (typeof validateActWeight === 'function') validateActWeight();
          // el('act-name').value = String(ent ?? ''); // REMOVED
          el('act-sfgqty').value = String(sfg ?? '');
          // Backwards Compat Logic: Try Parse JSON, else String
          let loadedOps = { mp1: '', mp2: '' };
          try {
            const parsed = JSON.parse(ops);
            if (parsed && typeof parsed === 'object') {
              loadedOps.mp1 = parsed.mp1 || '';
              loadedOps.mp2 = parsed.mp2 || '';
            } else {
              loadedOps.mp1 = String(ops || '');
            }
          } catch (e) {
            loadedOps.mp1 = String(ops || '');
          }

          el('act-ops-mp1').value = loadedOps.mp1;
          el('act-ops-mp2').value = loadedOps.mp2;

          renderOpsChips('mp1');
          renderOpsChips('mp2');


          el('std-msg').innerHTML =
            '<span class="ok">Setup loaded — you can submit DPR.</span>';
          setupDone = true;
          validateForm();
        })
        .catch(err => {
          ids.forEach(id => el(id).disabled = false);
          console.error('std-actual/status failure:', err);
          el('std-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
          setupDone = false;
          validateForm();
        });
    }

    function buildColourOptions(job) {
      const sel = el('d-color');
      const selCc = el('cc-colour');
      if (sel) sel.innerHTML = '';
      if (selCc) selCc.innerHTML = '';

      let vals = [];

      // Use logic from jobColorsData if available (populated by fetch)
      if (window.jobColorsData && Object.keys(window.jobColorsData).length > 0) {
        vals = Object.keys(window.jobColorsData).filter(v => {
          const low = v.toLowerCase();
          return !low.includes('other') && !low.includes('unspecified');
        });
      } else {
        // Fallback to legacy REMOVED (User Request: "Don't show generic Mould colors like Roto Black if details missing")
        // If technical requirements change to allow manual entry, we can add a generic list or input.
        // For now, Strict Mode: Only show what is in JC Details.
        vals = [];
      }

      // Ensure Sticky Color is always an option (Plan Specific Only)
      // FIX: Do NOT add sticky color if it's not in the valid list. 
      // This prevents "Ghost" colors (like Roto Black) from appearing just because they were selected once.
      // We only use the sticky value to SELECT if it exists.
      /*
      try {
        const planKey = 'last_color_' + (job.PlanID || '');
        const sticky = localStorage.getItem(planKey);
        if (sticky && !vals.includes(sticky)) {
          vals.push(sticky);
        }
      } catch (_) { }
      */

      const uniq = [...new Set(vals)];

      const update = (s) => {
        if (!s) return;
        // Always add blank placeholder first so browser never auto-selects a colour
        s.add(new Option('— Select colour —', ''));
        if (uniq.length) {
          uniq.forEach(v => s.add(new Option(v, v)));
        }
        s.value = ''; // ensure blank is selected
      };

      update(sel);
      update(selCc);

      // If no colours configured — unlock entry body immediately (colour not required)
      if (!uniq.length) {
        const _eb = el('dpr-entry-body');
        const _cp = el('colour-required-prompt');
        if (_eb) { _eb.style.pointerEvents = ''; _eb.style.opacity = '1'; }
        if (_cp) _cp.style.display = 'none';
      }

      // Populate the visual colour chips panel
      const panel = el('color-picker-panel');
      if (panel) {
        panel.innerHTML = '';
        panel.style.display = 'none'; // always collapsed after rebuild
        if (!uniq.length) {
          panel.innerHTML = '<span style="color:var(--muted);font-size:13px;padding:4px 8px">No colours — entry unlocked</span>';
        } else {
          uniq.forEach(v => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = v;
            chip.dataset.colourChip = v;
            chip.style.cssText = 'padding:8px 18px;border-radius:999px;border:1.5px solid var(--line-bright);background:var(--surface-2);font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background 0.15s,border-color 0.15s,color 0.15s;';
            chip.onclick = () => {
              const s = el('d-color');
              if (s) { s.value = v; s.dispatchEvent(new Event('change')); }
              closeColorPickerPanel();
            };
            panel.appendChild(chip);
          });
        }
      }
    }

    function toggleColorPickerPanel() {
      const panel = el('color-picker-panel');
      const arrow = el('color-picker-arrow');
      if (!panel) return;
      const isOpen = panel.style.display === 'flex';
      panel.style.display = isOpen ? 'none' : 'flex';
      if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
    }
    window.toggleColorPickerPanel = toggleColorPickerPanel;

    function closeColorPickerPanel() {
      const panel = el('color-picker-panel');
      const arrow = el('color-picker-arrow');
      if (panel) panel.style.display = 'none';
      if (arrow) arrow.style.transform = '';
    }

    function getSavedPlanColorRows(job) {
      const raw = job?.colour_details
        ?? job?.ColourDetails
        ?? job?._all?.colour_details
        ?? job?._all?.ColourDetails
        ?? [];

      let rows = raw;
      if (typeof rows === 'string') {
        try {
          rows = JSON.parse(rows || '[]');
        } catch (_) {
          rows = [];
        }
      }

      if (!Array.isArray(rows) || !rows.length) return [];

      const grouped = new Map();
      rows.forEach((row) => {
        const qty = Math.max(0, Number(row?.planQty ?? row?.plan_qty ?? row?.batchQty ?? row?.batch_qty ?? 0) || 0);
        const rawName = String(row?.colourName || row?.itemColour || row?.item_colour || row?.rawItemName || row?.itemName || row?.item_name || 'Unspecified').trim();
        const name = rawName || 'Unspecified';
        const current = grouped.get(name) || { name, qty: 0, bal: 0, produced: 0 };
        current.qty += qty;
        current.bal += qty;
        grouped.set(name, current);
      });

      return Array.from(grouped.values())
        .filter((row) => row.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    async function renderColorPlanTable(job) {
      if (!job) {
        hide('color-plan-card');
        return;
      }

      // ── Clear ALL stale over-production alerts IMMEDIATELY (synchronous, before any fetch).
      //    This runs every time regardless of API outcome, so alerts from other jobs
      //    can never survive a job switch.
      document.querySelectorAll('#over-prod-alert').forEach(n => n.remove());

      // Snapshot the PlanID now — used later to guard against race conditions where
      // loadQueue() changes session.activeJob while this async call is in-flight.
      const _thisPlanId = job.PlanID;

      const tbody = el('color-plan-body');
      if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="muted">Loading colors...</td></tr>';
      show('color-plan-card');

      try {
        // ── ALWAYS call the API first so production (DPR entries) is subtracted from
        //    balance. Only fall back to plan's saved colour_details if the API returns
        //    nothing (e.g. JC details not yet uploaded).
        const orJrNo = job.OrderNo || (job._all ? job._all['Order No'] : '');
        const jcNo   = getJobCardNo(job);
        const mouldNo = job.MouldNo || (job._all ? job._all['Mould No'] : '');
        const planId  = job.PlanID;

        let apiRows = [];
        try {
          const apiUrl = `/api/job/colors?or_jr_no=${encodeURIComponent(orJrNo)}` +
            `&jc_no=${encodeURIComponent(jcNo)}` +
            `&mould_no=${encodeURIComponent(mouldNo)}` +
            `&plan_id=${encodeURIComponent(planId)}`;
          const apiRes  = await apiFetch(apiUrl);
          const apiData = await apiRes.json();
          if (apiData && apiData.ok) apiRows = apiData.data || [];
        } catch (apiErr) {
          console.warn('[Colors] API fetch failed, falling back to plan data:', apiErr);
        }

        // If API gave us results, use them (they include real production balance)
        if (apiRows.length) {
          if (tbody) tbody.innerHTML = '';
          window.jobColorsData = {};
          let sumPlan = 0, sumBal = 0, sumProduced = 0;
          const overProducedList = []; // collect for alert

          apiRows.forEach(r => {
            const q = Math.round(Number(r.qty || 0));
            const b = Math.round(Number(r.bal));           // can be negative
            const p = Math.round(Number(r.produced || 0));
            const isOver = b < 0;
            // balIsLive: this row came from /api/job/colors, so bal already has real
            // production subtracted and (plan - bal) is a trustworthy produced figure.
            // extra/grants: PPC-allowed extra qty beyond the 10% cap (with who/why).
            const extraAllowed = Math.round(Number(r.extra_allowed || 0));
            const extraGrants = Array.isArray(r.extra_grants) ? r.extra_grants : [];
            window.jobColorsData[r.name] = { plan: q, bal: b, balIsLive: true, extra: extraAllowed, grants: extraGrants };
            sumPlan += q; sumBal += b; sumProduced += p;
            if (isOver) overProducedList.push({ name: r.name, qty: q, produced: p, excess: Math.abs(b) });

            const cName = r.name.toLowerCase();
            let badgeClass = 'color-badge';
            if (r.name.includes('Other')) badgeClass = 'color-badge badge-grey';
            else if (cName.includes('red') || cName.includes('maroon') || cName.includes('cherry')) badgeClass += ' badge-red';
            else if (cName.includes('blue') || cName.includes('navy') || cName.includes('cyan')) badgeClass += ' badge-blue';
            else if (cName.includes('green') || cName.includes('lime') || cName.includes('olive')) badgeClass += ' badge-green';
            else if (cName.includes('yellow') || cName.includes('gold') || cName.includes('lemon')) badgeClass += ' badge-yellow';
            else if (cName.includes('black') || cName.includes('dark')) badgeClass += ' badge-black';
            else if (cName.includes('white') || cName.includes('ivory') || cName.includes('milk')) badgeClass += ' badge-white';
            else if (cName.includes('grey') || cName.includes('silver') || cName.includes('ash')) badgeClass += ' badge-grey';
            else if (cName.includes('orange') || cName.includes('amber')) badgeClass += ' badge-orange';
            else if (cName.includes('purple') || cName.includes('violet') || cName.includes('lavender')) badgeClass += ' badge-purple';
            else if (cName.includes('pink') || cName.includes('rose') || cName.includes('magenta')) badgeClass += ' badge-pink';
            else if (cName.includes('brown') || cName.includes('beige') || cName.includes('tan')) badgeClass += ' badge-brown';
            else if (cName.includes('teal') || cName.includes('aqua')) badgeClass += ' badge-teal';

            // Negative balance → red pill with minus sign
            const balHtml = isOver
              ? `<span class="qty-pill" style="background:#fee2e2; color:#dc2626; font-weight:800; border:1px solid #fca5a5">${b}</span>`
              : `<span class="qty-pill">${b}</span>`;

            const tr = document.createElement('tr');
            tr.className = isOver ? 'color-row over-produced-row' : 'color-row';
            if (isOver) tr.style.cssText = 'background:#fff5f5';
            tr.dataset.colorName = r.name;
            // extra_grants come from /api/job/colors ordered oldest-first, so the last
            // element is the newest grant. Built with DOM text APIs — allowed_by and
            // remarks are user-stored strings and must never hit innerHTML raw.
            const lastGrant = extraGrants.length ? extraGrants[extraGrants.length - 1] : null;
            tr.innerHTML = `<td><span class="${badgeClass}">${r.name}${isOver ? ' <span style="font-size:10px;color:#dc2626;font-weight:700">⚠ OVER</span>' : ''}</span></td><td><span class="qty-pill">${q}</span></td><td>${balHtml}</td>`;
            if (extraAllowed > 0) {
              const badge = document.createElement('span');
              badge.style.cssText = 'font-size:10px;background:#f5f3ff;color:#7c3aed;border:1px solid #c4b5fd;border-radius:5px;padding:1px 5px;font-weight:800;white-space:nowrap;margin-left:4px';
              badge.textContent = `+${extraAllowed} by ${lastGrant ? lastGrant.allowed_by : 'PPC'}`;
              badge.title = extraGrants.map(g => `+${g.extra_qty} by ${g.allowed_by} (${g.allowed_role}) — ${g.remarks}`).join('\n');
              tr.cells[0].appendChild(badge);
            }
            tr.onclick = () => { const sel = el('d-color'); if (sel) { sel.value = r.name; sel.dispatchEvent(new Event('change')); } };
            if (tbody) tbody.appendChild(tr);
          });

          // Total row — negative total also in red
          const totalIsOver = sumBal < 0;
          const totalBalHtml = totalIsOver
            ? `<span class="qty-pill" style="background:#fee2e2; color:#dc2626; font-weight:800; border:1px solid #fca5a5">${Math.round(sumBal)}</span>`
            : `<span class="qty-pill" style="font-weight:700">${Math.round(sumBal)}</span>`;
          const trTot = document.createElement('tr');
          trTot.className = 'color-row';
          trTot.innerHTML = `<td><span class="color-badge" style="font-weight:700">Required</span></td><td><span class="qty-pill" style="font-weight:700">${Math.round(sumPlan)}</span></td><td>${totalBalHtml}</td>`;
          if (tbody) tbody.appendChild(trTot);

          // Only add alert if this render is still for the currently active job.
          // Guards against race: loadQueue() may have changed session.activeJob
          // while the async API call was in-flight.
          if (overProducedList.length > 0 && _thisPlanId === (session.activeJob?.PlanID ?? _thisPlanId)) {
            const alertDiv = document.createElement('div');
            alertDiv.id = 'over-prod-alert';
            alertDiv.dataset.planId = String(_thisPlanId); // tag with plan so origin is traceable
            alertDiv.style.cssText = 'margin-top:10px; background:#fef2f2; border:1px solid #fca5a5; border-radius:10px; padding:10px 14px; font-size:12px; color:#b91c1c; font-weight:700';
            alertDiv.innerHTML = `<div style="font-size:13px; margin-bottom:4px">⚠️ OVER PRODUCTION — ${job.Machine || ''}</div>` +
              overProducedList.map(o =>
                `<div>• ${o.name}: Plan ${o.qty} | Produced ${o.produced} | <b>Extra ${o.excess} pcs</b></div>`
              ).join('');
            const card = el('color-plan-card');
            if (card) card.appendChild(alertDiv);
          }

          el('color-plan-note').textContent = 'Source: Plan colours + Live production';
          buildColourOptions(job);
          // Colour must be selected fresh — do NOT auto-fill from localStorage
          return;
        }

        // ── FALLBACK: API returned nothing — use plan's saved colour_details (no production data)
        const savedPlanColors = getSavedPlanColorRows(job);
        if (savedPlanColors.length) {
          if (tbody) tbody.innerHTML = '';
          window.jobColorsData = {};

          let sumPlan = 0;
          let sumBal = 0;

          savedPlanColors.forEach((r) => {
            const q = Math.round(Number(r.qty || 0));
            const b = Math.round(Number(r.bal || 0));

            // No balIsLive flag: this fallback reads the plan's saved colour_details,
            // which carry no production data (bal == qty). (plan - bal) would compute
            // produced as 0, so the client cap must not enforce off this — the server
            // guard in /api/dpr/submit stays authoritative.
            window.jobColorsData[r.name] = { plan: q, bal: b, balIsLive: false };
            sumPlan += q;
            sumBal += b;

            const cName = r.name.toLowerCase();
            let badgeClass = 'color-badge';
            if (r.name.includes('Other')) badgeClass = 'color-badge badge-grey';
            else if (cName.includes('red') || cName.includes('maroon') || cName.includes('cherry')) badgeClass += ' badge-red';
            else if (cName.includes('blue') || cName.includes('navy') || cName.includes('cyan')) badgeClass += ' badge-blue';
            else if (cName.includes('green') || cName.includes('lime') || cName.includes('olive')) badgeClass += ' badge-green';
            else if (cName.includes('yellow') || cName.includes('gold') || cName.includes('lemon')) badgeClass += ' badge-yellow';
            else if (cName.includes('black') || cName.includes('dark')) badgeClass += ' badge-black';
            else if (cName.includes('white') || cName.includes('ivory') || cName.includes('milk')) badgeClass += ' badge-white';
            else if (cName.includes('grey') || cName.includes('silver') || cName.includes('ash')) badgeClass += ' badge-grey';
            else if (cName.includes('orange') || cName.includes('amber')) badgeClass += ' badge-orange';
            else if (cName.includes('purple') || cName.includes('violet') || cName.includes('lavender')) badgeClass += ' badge-purple';
            else if (cName.includes('pink') || cName.includes('rose') || cName.includes('magenta')) badgeClass += ' badge-pink';
            else if (cName.includes('brown') || cName.includes('beige') || cName.includes('tan')) badgeClass += ' badge-brown';
            else if (cName.includes('teal') || cName.includes('aqua')) badgeClass += ' badge-teal';

            const tr = document.createElement('tr');
            tr.className = 'color-row';
            tr.dataset.colorName = r.name;
            tr.innerHTML = `
             <td><span class="${badgeClass}">${r.name}</span></td>
             <td><span class="qty-pill">${q}</span></td>
             <td><span class="qty-pill">${b}</span></td>
           `;
            tr.onclick = () => {
              const sel = el('d-color');
              if (sel) {
                sel.value = r.name;
                sel.dispatchEvent(new Event('change'));
              }
            };
            if (tbody) tbody.appendChild(tr);
          });

          const trTot = document.createElement('tr');
          trTot.className = 'color-row';
          trTot.innerHTML = `
           <td><span class="color-badge" style="font-weight:700">Required</span></td>
           <td><span class="qty-pill" style="font-weight:700">${Math.round(sumPlan)}</span></td>
           <td><span class="qty-pill" style="font-weight:700">${Math.round(sumBal)}</span></td>
         `;
          if (tbody) tbody.appendChild(trTot);

          el('color-plan-note').textContent = 'Source: Saved plan colour breakdown';
          buildColourOptions(job);
          // Colour must be selected fresh — do NOT auto-fill from localStorage
          return;
        }

        // Neither API nor saved plan colours found
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="muted">No color details found in saved plan or JC Report.</td></tr>';
        buildColourOptions(job);
        return;

      } catch (e) {
        console.error('Color fetch error', e);
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="err">Error loading colors.</td></tr>';
      }
    }

    function hasOption(sel, val) {
      if (!sel) return false;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === val) return true;
      }
      return false;
    }

    /* ==================== Factory Selection ==================== */
    function showFactorySelect(factories) {
      const list = el('factory-list');
      list.innerHTML = '';

      factories.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'ghost';
        btn.style.width = '100%';
        btn.style.marginBottom = '8px';
        btn.style.textAlign = 'left';
        btn.innerHTML = `<b>${f.name}</b> <span class="muted" style="font-size:12px">(${f.location || ''})</span>`;
        btn.onclick = () => selectFactory(f.id);
        list.appendChild(btn);
      });

      show('modal-factory-select');
    }

    function selectFactory(fid) {
      hide('modal-factory-select');
      if (session.tempUser) {
        completeSupervisorLogin(session.tempUser, fid);
        delete session.tempUser;
      }
    }

    function completeSupervisorLogin(s, fid) {
      const uEl = el('login-username'); // For fallback if s.username missing
      const username = s.username || (uEl ? uEl.value : '');

      session.username = username;
      session.line = s.line || '';
      session.shift = s.shift || '';
      session.shiftDate = s.shiftDate || '';
      session.machine = null;
      session.factoryId = fid;
      session.role_code = s.role_code || null; // [NEW] Store Role
      session.global_access = s.global_access || null; // [NEW] All-lines back-date access

      try {
        localStorage.setItem('jpsmsSession', JSON.stringify({
          username: session.username,
          line: session.line,
          machine: null,
          factoryId: session.factoryId,
          role_code: session.role_code, // [NEW] Persist Role
          global_access: session.global_access // [NEW] Persist all-lines access
        }));
      } catch (_) { }

      const lineLabel = el('line-name');
      if (lineLabel) lineLabel.textContent = session.line || '—';
      const msg = el('login-msg');
      if (msg) msg.innerHTML = '<span class="ok">Login OK.</span>';

      // Log supervisor login
      _logSupervisorActivity('login', { line: session.line });

      showAppView(true);
      loadMachines();
    }

    async function login() {
      const uEl = el('login-username');
      const pEl = el('login-password');
      const msg = el('login-msg');

      const username = (uEl?.value || '').trim();
      const password = pEl?.value || '';

      if (!username || !password) {
        if (msg) msg.textContent = 'Enter username & password.';
        return;
      }

      if (msg) msg.textContent = 'Checking...';

      if (appSettings.geofence_enabled === 'true') {
        if (!lastGeo || !insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc)) {
          if (msg) msg.innerHTML = '<span class="err">Login blocked: Outside geofence.</span>';
          return;
        }
      }

      try {
        const res = await apiFetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username, password, requested_app: 'supervisor_app',
            geo_lat: lastGeo?.lat, geo_lng: lastGeo?.lng, geo_acc: lastGeo?.acc
          })
        });

        const data = await res.json();

        if (!data.ok) {
          if (msg) msg.textContent = data.error || 'Login failed.';
          return;
        }

        const s = data.data || {};
        const factories = data.factories || [];

        // Save Temp User for Selection
        session.tempUser = s;

        // Factory Logic
        if (factories.length > 1) {
          showFactorySelect(factories); // User picks, then calls selectFactory -> completeSupervisorLogin
        } else if (factories.length === 1) {
          completeSupervisorLogin(s, factories[0].id);
        } else {
          // No factory assigned? Fallback to Global (null)
          completeSupervisorLogin(s, null);
        }
      } catch (err) {
        console.error(err);
        const msg = el('login-msg');
        if (msg) msg.innerHTML = '<span class="err">Cannot reach server.</span>';
      }
    }

    async function loadMachines() {
      const dd = el('dd-machine');
      dd.innerHTML = '';
      dd.add(new Option('Loading…', ''));

      showLoading();

      try {
        const line = session.line || '';
        const dDate = el('d-date').value || '';
        const dShift = el('d-shift').value || 'Day';

        const res = await apiFetch(`/api/machines/supervisor?line=${encodeURIComponent(line)}&date=${encodeURIComponent(dDate)}&shift=${encodeURIComponent(dShift)}`);
        const data = await res.json();

        dd.innerHTML = '';
        const listRaw = (data && data.ok) ? (data.data || []) : [];
        const list = listRaw.map(m => m.machine);

        // [NEW] Store closed plants info
        window.closedPlants = data.closed || [];
        window.machinesInfo = listRaw; // Store full machine objects (with building)

        if (!list.length) {
          dd.add(new Option('No machines', ''));
          return; // finally() below hides the overlay — a second hideLoading() here double-decrements
        }

        const sortedRaw = listRaw.slice().sort((a, b) => {
          const lineA = String(a.line || '').trim();
          const lineB = String(b.line || '').trim();
          const buildA = lineA.charAt(0) || 'Z';
          const buildB = lineB.charAt(0) || 'Z';
          if (buildA !== buildB) return buildA.localeCompare(buildB);
          const lnA = parseInt((lineA.match(/L(\d+)/i) || [0, 0])[1], 10) || 999;
          const lnB = parseInt((lineB.match(/L(\d+)/i) || [0, 0])[1], 10) || 999;
          if (lnA !== lnB) return lnA - lnB;
          const numA = parseInt((a.machine.match(/(\d+)$/) || [0, 0])[1], 10) || 999;
          const numB = parseInt((b.machine.match(/(\d+)$/) || [0, 0])[1], 10) || 999;
          return numA - numB;
        });
        sortedRaw.forEach(m => {
          const linePfx = m.line ? String(m.line).trim() : '';
          const startsWithLine = linePfx && m.machine.replace(/\s+/g, '').toLowerCase().startsWith(linePfx.replace(/\s+/g, '').toLowerCase());
          const label = (linePfx && !m.machine.includes('>') && !startsWithLine) ? linePfx + '>' + m.machine : m.machine;
          dd.add(new Option(label, m.machine));
        });

        if (session.machine && list.includes(session.machine)) {
          dd.value = session.machine;
        } else {
          session.machine = list[0];
          dd.value = session.machine;
        }
        checkPlantClosure();
        updateFilledSlots();

        try {
          localStorage.setItem('jpsmsSession', JSON.stringify({
            username: session.username,
            line: session.line,
            machine: session.machine,
            factoryId: session.factoryId,
            role_code: session.role_code,
            global_access: session.global_access
          }));
        } catch (_) { }

        loadQueue();
        loadRecent();

      } catch (e) {
        console.error('loadMachines error', e);
        dd.innerHTML = '';
        dd.add(new Option('Error loading machines', ''));
      } finally {
        hideLoading();
      }
    }

    /* ── Activity logging helper ──────────────────────────────────────────
       Posts a structured event to the Activity Monitor backend.
       action: 'machine_select' | 'job_open' | 'dpr_entry' | 'quick_action' | etc.
       extra : plain object with any detail fields (machine, slot, colour, etc.)
    ─────────────────────────────────────────────────────────────────────── */
    function _logSupervisorActivity(action, extra) {
      try {
        if (!session.username) return;
        const ua = navigator.userAgent || '';
        fetch('/api/activity/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username:    session.username,
            role_code:   session.role_code || 'supervisor',
            app_id:      'supervisor_app',
            action:      action,
            page:        'supervisor.html',
            device_type: /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop',
            factory_id:  String(session.factoryId || ''),
            extra:       extra || null
          }),
          keepalive: true
        }).catch(function () {});
      } catch (_e) {}
    }

    function onMachineChange() {
      session.machine = el('dd-machine').value;
      // Log machine selection
      _logSupervisorActivity('machine_select', { machine: session.machine, line: session.line });
      checkPlantClosure();
      updateFilledSlots();
      loadQueue();
      loadRecent();
    }

    function checkPlantClosure() {
      const selectedMachine = el('dd-machine').value;
      if (!selectedMachine) return;

      const mInfo = (window.machinesInfo || []).find(m => m.machine === selectedMachine);
      if (!mInfo) return;

      const building = mInfo.building;
      const machineLine = mInfo.line;
      const closure = (window.closedPlants || []).find(c => c.plant === building || c.plant === machineLine || c.plant === 'All');

      const overlay = el('plant-closed-overlay');
      if (closure) {
        let closedTitle = 'FACTORY EXPERIENCING SHUTDOWN';
        if (closure.plant !== 'All') {
          closedTitle = closure.plant.includes('-') ? `LINE ${closure.plant} IS CLOSED` : `PLANT ${closure.plant} IS CLOSED`;
        }
        el('pc-overlay-title').innerText = closedTitle;
        el('pc-overlay-msg').innerText = closure.remarks || 'Entries are restricted by Admin for this shift.';
        overlay.style.display = 'flex';
      } else {
        overlay.style.display = 'none';
      }
    }

    const FIELD_ORDER = [
      { label: 'Client', keys: ['Client', 'Client Name', 'Customer', 'Party'] },
      { label: 'SFG NAME', keys: ['SFG Name', 'Our Name', 'OurName', 'SFG NAME', 'SFGNAME', 'Item Name', 'SFG'] },
      { label: 'FG CODE', keys: ['FG CODE'] },
      { label: 'MOULD CODE', keys: ['Mould Code', 'Mould code', 'Mould No', 'MouldNo', 'Mouldno', 'MOULD CODE'] },
      { label: 'PLANQTY', keys: ['PlanQty', 'Planned Qty', 'Planned Quantity', 'PLANQTY'] },
      { label: 'Jc Target Qty', keys: ['Jc Target Qty', 'JC Targeted Qty', 'JC Target Qty', 'Target Qty', 'TargetQty'] },
      { label: 'STD Sfg Qty', keys: ['SFG Qty', 'Sfg Qty', 'STD SFG Qty'] },
      { label: 'Mixing Ratio', keys: ['Mixing Ratio', 'MIXING RATIO', 'Mix Ratio'] },
      { label: 'Or Remarks', keys: ['OR Remarks', 'Or Remarks', 'Order Remarks'] },
      { label: 'Special Remarks', keys: ['Special Remarks', 'Special Remark'] },
      { label: 'Operator Activities', keys: ['Operator Activities', 'Operator Activity', 'Ops Activities'] }
    ];

    function lookup(all, job, keys) {
      for (const k of keys) {
        if (job && k in job && job[k] != null && String(job[k]).trim() !== '') return job[k];
        if (all && k in all && all[k] != null && String(all[k]).trim() !== '') return all[k];
      }
      return '';
    }

    function getJobCardNo(job) {
      if (!job) return '';
      const all = job._all || {};
      return String(
        job.JobCardNo ||
        all['Job Card Number'] ||
        all['JobCard Number'] ||
        all['JobCardNo'] ||
        all['JC No'] ||
        all['JC Number'] ||
        ''
      ) || '';
    }

    function getJobMouldNo(job) {
      if (!job) return '';
      const all = job._all || {};
      return String(
        job.MouldNo ||
        job['Mould No'] ||
        job['Mould Code'] ||
        all['Mould No'] ||
        all['Mould Code'] ||
        all['MouldNo'] ||
        all['MouldNo '] ||
        ''
      ).trim();
    }

    function orderedDetails(job) {
      const all = job ? (job._all || {}) : {};
      let html = '<div class="card" style="padding:8px">';
      FIELD_ORDER.forEach(f => {
        const val = lookup(all, job, f.keys);
        html += `<div class="inline" style="justify-content:space-between;border-bottom:1px dashed var(--line);padding:6px 0">
               <span class="muted" style="margin-right:8px">${f.label}</span>
               <span>${safe(val)}</span>
             </div>`;
      });
      html += '</div>';
      return html;
    }
    function getJobStatus(job) {
      const all = job && job._all ? job._all : {};
      const raw = job.Status || all.Status || all['Plan Status'] || all['Job Status'] || all['Status '] || all['STATUS'] || '';
      return String(raw || '').trim();
    }

    // [KAN-84] Inline refresh indicator — replaces the full-screen "Processing…" overlay
    // for queue loads so the screen stays usable while jobs are fetched on slow WiFi.
    function _setQueueRefreshing(on) {
      const jobsDiv = el('jobs');
      if (!jobsDiv) return;
      jobsDiv.style.opacity = on ? '0.55' : '';
      let chip = el('queue-refreshing-chip');
      if (on) {
        if (!chip) {
          chip = document.createElement('div');
          chip.id = 'queue-refreshing-chip';
          chip.className = 'muted';
          chip.style.cssText = 'text-align:center;font-size:12px;padding:6px;font-weight:700';
          chip.textContent = '⏳ Refreshing jobs…';
          jobsDiv.parentNode.insertBefore(chip, jobsDiv);
        }
      } else if (chip) {
        chip.remove();
      }
    }

    function loadQueue() {
      const jobsDiv = el('jobs');
      // [KAN-84] Keep the previously rendered job cards visible (dimmed) while the fresh
      // list loads in the background, instead of blanking the screen behind an overlay.
      el('no-jobs').classList.add('hidden');

      // Reset DPR area — clear any stale over-production alerts from the previous job
      document.querySelectorAll('#over-prod-alert').forEach(n => n.remove());
      session.activeJob = null;
      hide('dpr-form');
      hide('std-actual-card');
      hide('color-plan-card');
      el('active-job').innerHTML = 'Open Queue → <b>Fill DPR</b> on the first job.';
      el('job-summary').innerHTML = '';

      _setQueueRefreshing(true);

      const line = session.line || '';
      const machine = session.machine || el('dd-machine').value || '';

      apiFetch(`/api/queue?line=${encodeURIComponent(line)}&machine=${encodeURIComponent(machine)}`)
        .then(r => r.json())
        .then(r => {
          if (!r || !r.ok) {
            console.warn('Queue load failed:', r);
            jobsDiv.innerHTML = '';
            el('no-jobs').classList.remove('hidden');
            el('no-jobs').textContent = (r && r.error) || 'Failed to load jobs.';
            _setQueueRefreshing(false);
            return;
          }

          const rows = r.data || [];
          console.log('Queue loaded:', rows.length, 'jobs', rows);

          if (!rows.length) {
            jobsDiv.innerHTML = '';
            el('no-jobs').classList.remove('hidden');
            el('no-jobs').textContent = 'No jobs found for this machine.';
            _setQueueRefreshing(false);
            return;
          }

          // Map, filter out completed, add priority
          const mapped = rows
            .map((job, originalIndex) => {
              const statusRaw = getJobStatus(job);
              const statusNorm = statusRaw.toUpperCase();

              // Drop fully done jobs (if backend didn't already)
              if (['DONE', 'COMPLETED', 'CLOSED'].includes(statusNorm)) return null;

              let pri = 4;
              if (statusNorm.startsWith('RUN')) pri = 1;
              else if (statusNorm.startsWith('WAIT') || statusNorm === 'PLANNED') pri = 2; // Handle 'PLANNED' explicitly
              else if (statusNorm.startsWith('POST')) pri = 3;

              return { job, originalIndex, statusRaw, statusNorm, pri };
            })
            .filter(Boolean);


          if (!mapped.length) {
            jobsDiv.innerHTML = '';
            el('no-jobs').classList.remove('hidden');
            _setQueueRefreshing(false);
            return;
          }

          // Sort: RUN first, then WAIT, POST, etc., then original index
          mapped.sort((a, b) => {
            if (a.pri !== b.pri) return a.pri - b.pri;
            return a.originalIndex - b.originalIndex;
          });

          // ✅ NEW: first visible row is ALWAYS the active job
          const activeIndex = 0;
          // Clear stale over-production alerts whenever the active job changes
          if (!session.activeJob || session.activeJob.PlanID !== (mapped[activeIndex].job || {}).PlanID) {
            document.querySelectorAll('#over-prod-alert').forEach(n => n.remove());
          }
          session.activeJob = mapped[activeIndex].job || null;

          jobsDiv.innerHTML = '';
          const frag = document.createDocumentFragment();

          mapped.forEach((item, idx) => {
            const job = item.job;
            const all = job._all || {};

            const st = fmtDT(job.StartDateTime) || '—';

            // Compute Plan End Date client-side: Start + (planQty × CT / cavity)
            // Exp End Date: NOW + (balQty × CT / cavity)  [for running], Start + balQty time [for queued]
            const _svCt    = Number(job.CycleTime || job.cycleTime || all['Cycle Time'] || 120);
            const _svCav   = Number(job.Cavity || job.cavity || all['Cavity'] || 1);
            const _svQty   = Number(job.PlanQty || job.planQty || all['Plan Qty'] || 0);
            const _svBal   = Number(job.BalQty || job.balQty || all['Bal Qty'] || _svQty);
            const _svPcsHr = (_svCt > 0) ? (3600 / _svCt) * _svCav : 30;
            const _svStartTs = job.StartDateTime ? new Date(job.StartDateTime).getTime() : null;
            const _svEndTs   = _svStartTs ? (_svStartTs + (_svQty * 3600000) / _svPcsHr) : null;
            const _svExpTs   = item.statusNorm && item.statusNorm.startsWith('RUN')
              ? (Date.now() + (Math.max(0, _svBal) * 3600000) / _svPcsHr)
              : (_svStartTs ? (_svStartTs + (Math.max(0, _svBal) * 3600000) / _svPcsHr) : null);
            const _fmtTs = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
            const planEndStr = _fmtTs(_svEndTs);
            const planExpStr = _fmtTs(_svExpTs);
            const showExp = _svExpTs && _svEndTs && Math.abs(_svExpTs - _svEndTs) > 60000;

            // Duration badge: running → remaining time; queued → full plan duration
            const _svDurMs = item.statusNorm && item.statusNorm.startsWith('RUN')
              ? Math.max(0, (_svExpTs || 0) - Date.now())
              : (_svEndTs && _svStartTs ? _svEndTs - _svStartTs : 0);
            const _svDurFmt = (() => {
              const ms = _svDurMs; if (!ms) return '';
              const d = Math.floor(ms/86400000), h = Math.floor((ms%86400000)/3600000), mi = Math.floor((ms%3600000)/60000);
              if (d > 0) return `${d}d ${h}h`; if (h > 0) return `${h}h ${mi}m`; return `${mi}m`;
            })();

            const orderNo = safe(job.OrderNo || all['Order No'] || all['ORDER NO'] || '');
            const orderDate = safe(all['Order Date'] || all['ORDER DATE'] || '');
            const jcNo = safe(job.JobCardNo || all['JobCardNo'] || '');
            const mouldName = safe(
              job.Mould ||
              all['Mould'] ||
              all['Mould Name'] ||
              all['SFG Name'] ||
              ''
            );

            const statusLabel = item.statusRaw || 'Waiting';
            const isActiveFirst = (idx === activeIndex);
            // ONLY show Fill DPR if it is Running
            const isRunning = item.statusNorm && item.statusNorm.startsWith('RUN');
            const showButton = isActiveFirst && isRunning;

            // P1-P4 priority badge
            const machinePri = job.machinePriority || job['MachinePriority'] || null;
            const _priColors = { P1: '#2563eb', P2: '#16a34a', P3: '#f59e0b', P4: '#dc2626' };
            const priBadge = machinePri
              ? `<span style="display:inline-block;font-size:0.62rem;font-weight:900;color:#fff;padding:1px 6px;border-radius:4px;background:${_priColors[machinePri] || '#64748b'};margin-left:5px;vertical-align:middle;">${machinePri}</span>`
              : '';

            const card = document.createElement('div');
            card.className = 'job';
            card.innerHTML = `
          <div class="inline" style="justify-content:space-between;align-items:flex-start">
            <div class="row" style="gap:6px">
              <div style="font-weight:700">
                ${orderNo}${priBadge}
                ${orderDate
                ? ` <span class="muted">•</span> <span style="font-weight:700">${orderDate}</span>`
                : ''
              }
              </div>
              <div style="font-weight:700">
                ${jcNo}
              </div>
              <div style="font-weight:700">
                ${mouldName}
              </div>
            </div>

            ${showButton
                ? '<button class="small primary" onclick="goFillDPR()">Fill DPR</button>'
                : `<span class="pill muted" style="background:#f1f5f9; color:#64748b; font-size:13px; font-weight:600">${statusLabel}</span>`
              }
          </div>

          <div class="grid-2" style="font-size:var(--fs-sm);margin-top:8px">
            <div><small class="muted">Start</small><br>${st}</div>
            <div><small class="muted">Plan End</small><br><strong style="color:#334155">${planEndStr}</strong></div>
          </div>
          ${showExp ? `<div style="font-size:var(--fs-sm);margin-top:4px;padding:4px 8px;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">
            <small class="muted">Exp. End (remaining)</small><br><strong style="color:#2563eb">${planExpStr}</strong>
            ${_svDurFmt ? `<span style="float:right;font-size:0.72rem;font-weight:800;color:#16a34a"><i class="bi bi-clock-fill"></i> ${_svDurFmt}</span>` : ''}
          </div>` : _svDurFmt ? `<div style="font-size:0.72rem;margin-top:4px;font-weight:800;color:${isRunning?'#16a34a':'#3b82f6'}"><i class="bi bi-clock-fill"></i> ${_svDurFmt}</div>` : ''}
        `;

            frag.appendChild(card);
          });

          jobsDiv.appendChild(frag);
          _setQueueRefreshing(false);
        })
        .catch(err => {
          console.error(err);
          jobsDiv.innerHTML = '<span class="err">Failed to load queue.</span>';
          _setQueueRefreshing(false);
        });
    }

    /* NEW goFillDPR with Debugging */
    async function goFillDPR() {
      try {
        if (!session.activeJob) return;

        const job = session.activeJob;

        // Log job open
        _logSupervisorActivity('job_open', {
          machine:  job.Machine || session.machine,
          plan_id:  job.PlanID,
          order_no: job.OrderNo,
          mould:    job.MouldNo || job.Mould || '',
          item:     job.ItemName || job.item_name || ''
        });

        // START in Main Entry Mode
        setDPRMode('Main');

        renderDPRBind(job);
        renderJobSummary(job);
        buildDateSelect();

        // Enforce Shift Team Check immediately
        const allowed = await checkShiftTeamBlocking();
        if (!allowed) return;

        // SMART SHIFT DEFAULT: Handled by buildDateSelect() with 08:10 cutoff logic
        // No override needed here.

        buildColourOptions(job);
        renderColorPlanTable(job);

        // Colour is always blank on job load — user must select it each time
        const colorSel = el('d-color');
        if (colorSel) { colorSel.value = ''; }
        closeColorPickerPanel();

        // Lock entry body immediately — colour must be chosen before any entry
        const _eb = el('dpr-entry-body');
        const _cp = el('colour-required-prompt');
        if (_eb) { _eb.style.pointerEvents = 'none'; _eb.style.opacity = '0.35'; }
        if (_cp) _cp.style.display = 'block';

        onColorChange();

        rejItems = []; dtItems = []; renderRejItems(); renderDtItems();
        el('rej-total').textContent = '0';
        el('dt-total').textContent = '0';

        el('d-shots').value = '';
        el('d-good').value = '';
        validateForm();

        el('d-date').onchange = () => {
          onDateShiftChange();
          refreshSlots();
          if (session.activeJob) checkStdStatus();
          validateForm();
        };

        el('d-slot').onchange = validateForm;
        el('d-color').onchange = function () {
          onColorChange();
          validateForm();
        };
        el('d-remarks').oninput = validateForm;

        refreshSlots();

        setupDone = false;
        checkStdStatus();
        loadUsedSlots();
        show('dpr-form');
        showPage('sec-dpr', el('tab-dpr'));
        // [KAN-83] Scroll to the Colour Breakdown (colour picker) so the writer picks a
        // colour first, instead of jumping straight to the entry inputs.
        setTimeout(() => {
          const _colourBlock = el('color-picker-btn') || el('dpr-form') || el('d-slot') || el('sec-dpr');
          if (_colourBlock) _colourBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      } catch (e) { alert('Error opening DPR Form: ' + e.message); console.error(e); }
    }

    function renderDPRBind(job) {
      el('active-job').innerHTML = `<span class="pill">PlanID: ${safe(job.PlanID)}</span> <span class="pill">Machine: ${safe(job.Machine || job.machine)}</span>`;
    }
    function renderJobSummary(job) {
      const box = el('job-summary');
      const mouldName = safe((job.Mould) || (job._all && (job._all['Mould'] || job._all['Mould Name'] || job._all['SFG Name'])));
      box.innerHTML = `
    <div class="inline" style="justify-content:space-between; align-items: flex-start;">
      <div>
        <div style="font-weight: 800; font-size: 1.1rem; color: var(--ink);">${safe(job.OrderNo)}</div>
        <div class="muted" style="font-size: 12px; margin-top: 2px;">
          ${job.JobCardNo ? (job.JobCardNo) : ''}${mouldName ? (' • ' + mouldName) : ''}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
        <span class="tag" style="margin-right:0; font-weight: 700;">${safe(job.MouldNo)}</span>
        <button class="small primary" onclick="openJobSummaryModal()" style="padding: 6px 10px; font-size: 12px; border-radius: 8px; min-height: 0;">View Summary</button>
      </div>
    </div>
    <div style="font-size:var(--fs-sm);margin-top:10px; padding-top:10px; border-top: 1px dashed var(--line);">${orderedDetails(job)}</div>`;
      const all = job._all || {};
      el('std-article').value = safe(all['Article STD Weight'] || all['Article Std Weight'] || '');
      el('std-runner').value = safe(all['Runner STD Weight'] || all['Runner Std Weight'] || '');
      el('std-cavity').value = safe(all['STD Cavity'] || '');
      el('std-cycle').value = safe(all['STD Cycle Time'] || '');
      el('std-pcshr').value = safe(all['STD PCS/HR'] || all['STD PCS per HR'] || '');
      el('std-man').value = safe(all['STD MAN POWER'] || all['STD Man Power'] || '');
      el('std-sfgqty').value = safe(all['SFG Qty'] || all['Sfg Qty'] || all['STD SFG Qty'] || '');
    }

    /* JOB COMPLIANCE SUMMARY LOGIC */
    function openJobSummaryModal() {
      show('modal-job-summary');
      loadJobSummary();
    }

    function openJobSummaryModalByJC(jc) {
      show('modal-job-summary');
      loadJobSummary(jc);
    }

    async function loadJobSummary(targetJC = null) {
      // If targetJC is provided, we need to find the job data in recent history if it's not active
      const job = session.activeJob;
      const jcToUse = targetJC || (job && job.JobCardNo);
      if (!jcToUse) return;

      const jsSnapshot = el('js-snapshot');
      const jsTimeline = el('js-timeline');
      jsSnapshot.innerHTML = '<div class="muted">Loading summary...</div>';
      jsTimeline.innerHTML = '';

      try {
        const res = await apiFetch(`/api/dpr/recent?limit=300&machine=${encodeURIComponent(session.machine)}`);
        const json = await res.json();
        const recent = json.data?.rows || [];
        
        const jobEntries = recent.filter(r => r.JobCardNo === jcToUse);
        
        // Find job details from entries if not active job
        let jobMeta = job && job.JobCardNo === jcToUse ? job : null;
        if (!jobMeta && jobEntries.length > 0) {
          const first = jobEntries[0];
          jobMeta = {
            OrderNo: first.OrderNo,
            JobCardNo: first.JobCardNo,
            MouldNo: first.MouldNo,
            Mould: first.Mould,
            Client: first.Client,
            _all: { 'Total Order Qty': first.JobQty || 0 } // Fallback
          };
        }

        if (!jobMeta) {
          jsSnapshot.innerHTML = '<div class="err">Job details not found.</div>';
          return;
        }

        let qcChecks = [];
        try {
          const qcRes = await apiFetch(`/api/qc/job-checks?jobCardNo=${encodeURIComponent(jcToUse)}&machine=${encodeURIComponent(session.machine || '')}&limit=20`);
          const qcJson = await qcRes.json();
          qcChecks = (qcJson && qcJson.ok && Array.isArray(qcJson.data)) ? qcJson.data : [];
        } catch (_) { qcChecks = []; }

        // Calculate Compliance
        const target = parseFloat(jobMeta.JobQty || (jobMeta._all && (jobMeta._all['Total Order Qty'] || jobMeta._all['Order Qty'])) || 0);
        const actual = jobEntries.reduce((sum, r) => sum + (parseFloat(r.GoodQty) || 0), 0);
        const compliance = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
        const latestQc = qcChecks[0] || {};
        const supervisorActual = jobEntries.find(r => r.ArticleACTWeight)?.ArticleACTWeight || document.getElementById('act-article')?.value || '-';
        const qcWeights = qcChecks
          .flatMap(r => [r.qc_weight_1, r.qc_weight_2, r.qc_weight_3])
          .filter(v => v !== null && v !== undefined && String(v) !== '')
          .slice(0, 3);
        const fpaRecord = qcChecks.find(r => r.fpa_form_image || (Array.isArray(r.product_images) && r.product_images.length));
        const fpaImages = fpaRecord ? [fpaRecord.fpa_form_image, ...((Array.isArray(fpaRecord.product_images) ? fpaRecord.product_images : []))].filter(Boolean) : [];

        // Render Snapshot
        jsSnapshot.innerHTML = `
          <div class="premium-card" style="padding: 20px; display: flex; align-items: center; gap: 20px; background: #f8fbff; border: none;">
            <div class="donut-container">
              <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
                <circle class="donut-ring" cx="18" cy="18" r="15.915"></circle>
                <circle class="donut-segment" cx="18" cy="18" r="15.915" stroke-dasharray="${compliance} ${100 - compliance}" stroke-dashoffset="25"></circle>
              </svg>
              <div class="donut-text">${compliance}%</div>
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 700; color: var(--muted);">Job Progress</div>
              <div style="font-size: 20px; font-weight: 800; color: var(--ink);">${actual} / ${target}</div>
              <div class="muted" style="font-size: 12px;">Good Pcs Produced</div>
            </div>
          </div>
          <div class="premium-card" style="padding:16px; margin-top:12px; background:#fff; border:1px solid #e2e8f0;">
            <div style="font-weight:800; margin-bottom:10px; color:var(--ink);">QC Weight & FPA Evidence</div>
            <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;">
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                <div class="muted" style="font-size:11px; font-weight:700;">Supervisor ACT</div>
                <div style="font-weight:800;">${safe(supervisorActual)}</div>
              </div>
              ${[0,1,2].map(i => `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px;">
                  <div class="muted" style="font-size:11px; font-weight:700;">QC Weight ${i + 1}</div>
                  <div style="font-weight:800;">${safe(qcWeights[i] || '-')}</div>
                </div>
              `).join('')}
            </div>
            ${fpaImages.length ? `
              <div style="font-weight:800; margin:12px 0 8px; color:var(--ink);">FPA Images</div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(86px,1fr)); gap:8px;">
                ${fpaImages.map((src, i) => `<a href="${src}" target="_blank"><img src="${src}" alt="FPA image ${i + 1}" style="width:100%; height:96px; object-fit:cover; border-radius:10px; border:1px solid #e2e8f0;"></a>`).join('')}
              </div>
            ` : '<div class="muted" style="font-size:12px; margin-top:10px;">No FPA images saved yet.</div>'}
          </div>
        `;

        // Render Timeline (Last 12 slots)
        // We can get slots from the entries, but better to show a fixed or relevant range.
        // For simplicity, showing entries found for this job.
        if (jobEntries.length === 0) {
          jsTimeline.innerHTML = '<div class="no-jobs">No entries found for this job yet.</div>';
          return;
        }

        // Sort by date/slot reverse
        const sorted = jobEntries.sort((a,b) => new Date(b.DateTime) - new Date(a.DateTime));
        
        sorted.forEach(e => {
          const div = document.createElement('div');
          div.className = 'timeline-item filled';
          
          const dt = new Date(e.DateTime);
          const timeLabel = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dateLabel = dt.toLocaleDateString([], { day: '2-digit', month: 'short' });

          const rejections = Object.keys(e.RejectBreakup || {}).map(k => ({ reason: k, qty: e.RejectBreakup[k] }));
          const downtimes = Object.keys(e.DowntimeBreakup || {}).map(k => ({ reason: k, min: e.DowntimeBreakup[k] }));

          div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 700; font-size: 14px;">Slot: ${e.HourSlot || 'N/A'}</div>
                <div class="muted" style="font-size: 12px;">${dateLabel} • ${timeLabel}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; font-size: 14px; color: var(--ok);">${e.GoodQty} Good</div>
                <div class="muted" style="font-size: 11px;">Shots: ${e.Shots} | Rej: ${e.RejectQty}</div>
              </div>
            </div>
            ${rejections.length || downtimes.length ? `
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                ${rejections.map(r => `<span style="font-size: 11px; color: var(--err); font-weight: 500; background: #fee2e2; padding: 2px 8px; border-radius: 99px;">Rej: ${getRejName(r.reason)} (${r.qty})</span>`).join('')}
                ${downtimes.map(d => `<span style="font-size: 11px; color: #9a3412; font-weight: 500; background: #fff7ed; padding: 2px 8px; border-radius: 99px;">Downtime: ${getDtName(d.reason)} (${d.min}m)</span>`).join('')}
              </div>
            ` : ''}
          `;
          jsTimeline.appendChild(div);
        });

      } catch (err) {
        jsSnapshot.innerHTML = `<div class="err">Failed to load summary: ${err.message}</div>`;
      }
    }

    /* OPS Activity Logic */
    function populateOpsSelector() {
      ['mp1', 'mp2'].forEach(k => {
        const s = el(`ops-selector-${k}`);
        if (!s) return;
        // Check if populated
        if (s.options.length > 1) return;

        s.innerHTML = `<option value="" disabled selected>Select Activity (${k.toUpperCase()})...</option>`;
        OPERATOR_ACTIVITIES.forEach(a => s.add(new Option(a, a)));
      });
    }

    function addOpsActivity(val, mpKey) {
      if (!val) return;
      const input = el(`act-ops-${mpKey}`);
      let current = input.value ? input.value.split(',').map(x => x.trim()).filter(Boolean) : [];
      if (!current.includes(val)) {
        current.push(val);
        input.value = current.join(', ');
        renderOpsChips(mpKey);
      }
      el(`ops-selector-${mpKey}`).value = ''; // Reset
    }

    function removeOpsActivity(val, mpKey) {
      const input = el(`act-ops-${mpKey}`);
      let current = input.value ? input.value.split(',').map(x => x.trim()).filter(Boolean) : [];
      current = current.filter(x => x !== val);
      input.value = current.join(', ');
      renderOpsChips(mpKey);
    }

    function renderOpsChips(mpKey) {
      const wrap = el(`ops-chips-${mpKey}`);
      const input = el(`act-ops-${mpKey}`);
      populateOpsSelector();
      if (!wrap || !input) return;
      wrap.innerHTML = '';

      const current = input.value ? input.value.split(',').map(x => x.trim()).filter(Boolean) : [];
      current.forEach(c => {
        const div = document.createElement('div');
        div.className = 'chip';
        div.style.cssText = 'background:#f1f5f9; color:#334155; padding:2px 8px; border-radius:12px; font-size:12px; display:flex; align-items:center; gap:4px; border:1px solid #cbd5e1';

        const span = document.createElement('span');
        span.textContent = c;
        div.appendChild(span);

        // Removal "Cross" (Standard HTML Entity, no external fonts required)
        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'cursor:pointer; font-size:16px; font-weight:700; color:#ef4444; line-height:1; padding:0 2px';
        closeBtn.onclick = () => removeOpsActivity(c, mpKey);
        div.appendChild(closeBtn);

        wrap.appendChild(div);
      });
    }

    let rejItems = [], dtItems = [];
    // Initialize with empty string instead of 0
    function addRejItem() { rejItems.push({ qty: '', code: REJECT_REASONS[0][0], text: REJECT_REASONS[0][1], otherText: '' }); renderRejItems(); }
    function addDtItem() { dtItems.push({ min: '', code: DOWNTIME_REASONS[0][0], text: DOWNTIME_REASONS[0][1], otherText: '' }); renderDtItems(); }
    function renderRejItems() {
      const wrap = el('rej-items'); wrap.innerHTML = '';
      rejItems.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'chip';
        const row = document.createElement('div'); row.className = 'chip-row';
        const q = document.createElement('input');
        q.type = 'number'; q.min = '0'; q.className = 'chip-qty';
        q.value = (it.qty === '' || it.qty === null || it.qty === undefined) ? '' : it.qty;
        q.inputMode = 'numeric'; q.placeholder = 'Qty';
        q.oninput = () => { it.qty = q.value; recalcAndValidate(); };
        const s = document.createElement('select'); s.className = 'chip-select';
        REJECT_REASONS.forEach(([c, t]) => s.add(new Option(`${c} – ${t}`, c))); s.value = it.code || '';
        const rm = document.createElement('button');
        rm.className = 'small chip-rm'; rm.textContent = '✕';
        rm.onclick = () => { rejItems.splice(i, 1); renderRejItems(); };
        const oInp = document.createElement('input');
        oInp.type = 'text'; oInp.placeholder = 'Please specify...'; oInp.className = 'chip-other';
        oInp.value = it.otherText || '';
        oInp.oninput = () => { it.otherText = oInp.value; recalcAndValidate(); };
        oInp.style.display = it.code === 'OTHER' ? 'block' : 'none';
        s.onchange = () => {
          const f = REJECT_REASONS.find(r => r[0] === s.value);
          it.code = s.value; it.text = f ? f[1] : '';
          oInp.style.display = it.code === 'OTHER' ? 'block' : 'none';
        };
        row.append(q, s, rm); d.append(row, oInp); wrap.appendChild(d);
      });
      recalcAndValidate();
    }
    function renderDtItems() {
      const wrap = el('dt-items'); wrap.innerHTML = '';
      dtItems.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'chip';
        const row = document.createElement('div'); row.className = 'chip-row';
        const q = document.createElement('input');
        q.type = 'number'; q.min = '0'; q.className = 'chip-qty';
        q.value = (it.min === '' || it.min === null || it.min === undefined) ? '' : it.min;
        q.inputMode = 'numeric'; q.placeholder = 'Min';
        q.oninput = () => { it.min = q.value; recalcAndValidate(); };
        const s = document.createElement('select'); s.className = 'chip-select';
        DOWNTIME_REASONS.forEach(([c, t]) => s.add(new Option(`${c} – ${t}`, c))); s.value = it.code || '';
        const rm = document.createElement('button');
        rm.className = 'small chip-rm'; rm.textContent = '✕';
        rm.onclick = () => { dtItems.splice(i, 1); renderDtItems(); };
        const oInp = document.createElement('input');
        oInp.type = 'text'; oInp.placeholder = 'Please specify...'; oInp.className = 'chip-other';
        oInp.value = it.otherText || '';
        oInp.oninput = () => { it.otherText = oInp.value; recalcAndValidate(); };
        oInp.style.display = it.code === 'OTHER' ? 'block' : 'none';
        s.onchange = () => {
          const f = DOWNTIME_REASONS.find(r => r[0] === s.value);
          it.code = s.value; it.text = f ? f[1] : '';
          oInp.style.display = it.code === 'OTHER' ? 'block' : 'none';
        };
        row.append(q, s, rm); d.append(row, oInp); wrap.appendChild(d);
      });
      recalcAndValidate();
    }
    function onShotsChange() { recalcAndValidate(); }

    function recalc() {
      recalcAndValidate();
    }

    function recalcAndValidate() {
      const shots = Number(el('d-shots').value || 0);
      const rej = rejItems.reduce((s, i) => s + Number(i.qty || 0), 0);
      const dt = dtItems.reduce((s, i) => s + Number(i.min || 0), 0);
      el('rej-total').textContent = String(rej);
      el('dt-total').textContent = String(dt);
      el('d-good').value = Math.max(0, shots - rej);
      validateForm();
    }

    function firstTruthy(arr) { return arr.find(Boolean) || ''; }

    function onColorChange() {
      const sel = el('d-color');
      if (!sel) return;
      const val = sel.value;

      // Colour is NOT persisted — user must always select it fresh each entry

      const dat = jobColorsData[val];
      if (dat && Number(dat.plan) > 0 && dat.balIsLive) {
        const plan = Number(dat.plan);
        const produced = plan - Number(dat.bal);
        const cap = Math.floor(plan * COLOUR_OVERPROD_FACTOR);
        const remaining = Math.max(0, cap - produced);
        el('color-bal-display').textContent =
          `Bal: ${dat.bal} / Plan: ${plan} · Max ${remaining} more (cap ${cap})`;
      } else {
        el('color-bal-display').textContent = dat ? `Bal: ${dat.bal} / Plan: ${dat.plan}` : '';
      }

      // Update the visual picker button
      const lbl = el('color-picker-label');
      const btn = el('color-picker-btn');
      if (lbl) {
        if (val) {
          lbl.textContent = val;
          lbl.style.fontWeight = '800';
          lbl.style.color = 'var(--ink)';
          if (btn) btn.style.borderColor = 'var(--primary)';
        } else {
          lbl.textContent = 'Tap to select colour';
          lbl.style.fontWeight = '';
          lbl.style.color = '';
          if (btn) btn.style.borderColor = '';
        }
      }

      // Highlight the selected chip inside the panel
      document.querySelectorAll('[data-colour-chip]').forEach(chip => {
        const isSelected = chip.dataset.colourChip === val;
        chip.style.background = isSelected ? 'var(--primary)' : '';
        chip.style.color = isSelected ? '#fff' : '';
        chip.style.borderColor = isSelected ? 'var(--primary)' : '';
      });

      // Visual Selection — colour table rows
      const rows = document.querySelectorAll('.color-row');
      rows.forEach(r => {
        if (r.dataset.colorName === val) {
          r.classList.add('selected');
          r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          r.classList.remove('selected');
        }
      });

      // Lock / unlock the entry body based on whether a colour is chosen
      const entryBody = el('dpr-entry-body');
      const prompt = el('colour-required-prompt');
      // If no colours configured (select has only the blank placeholder), always unlock
      const colourOptCount = el('d-color')?.options?.length || 0;
      const hasColours = colourOptCount > 1;
      if (!hasColours || val) {
        if (entryBody) { entryBody.style.pointerEvents = ''; entryBody.style.opacity = '1'; }
        if (prompt) prompt.style.display = 'none';
      } else {
        if (entryBody) { entryBody.style.pointerEvents = 'none'; entryBody.style.opacity = '0.35'; }
        if (prompt) prompt.style.display = 'block';
      }

      // Always re-evaluate submit eligibility when colour changes
      validateForm();
    }

    // Colour over-production cap: cumulative produced for a colour may not exceed
    // 110% of that colour's plan qty. produced is derived as (plan - bal), where
    // bal already has all existing DPR entries subtracted by /api/job/colors.
    // Returns an error string, or '' when within the cap / not applicable.
    const COLOUR_OVERPROD_FACTOR = 1.10;
    function colourCapError(colourName, goodQty) {
      const dat = (window.jobColorsData || {})[colourName];
      // Unplanned colours ("Other") and jobs with no colour plan are not capped.
      if (!dat || !(Number(dat.plan) > 0)) return '';
      // Without live balance data, produced would compute as 0 and we'd wrongly
      // offer the full cap on a colour that is already maxed. Defer to the server.
      if (!dat.balIsLive) return '';
      const plan = Number(dat.plan);
      const produced = plan - Number(dat.bal);
      // PPC-granted extra allowance lifts the 110% cap for this colour
      const extra = Number(dat.extra || 0);
      const cap = Math.floor(plan * COLOUR_OVERPROD_FACTOR) + extra;
      const total = produced + Number(goodQty || 0);
      if (total <= cap) return '';
      const remaining = Math.max(0, cap - produced);
      const lastGrant = (dat.grants || []).length ? dat.grants[dat.grants.length - 1] : null;
      const extraNote = extra > 0 && lastGrant
        ? ` (incl. ${extra} extra allowed by ${lastGrant.allowed_by})`
        : '';
      const advice = remaining > 0
        ? `Enter ${remaining} or less.`
        : `This colour has reached its limit — ask PPC to allow extra qty from the Machine Timeline.`;
      return `${colourName}: Plan ${plan}, already produced ${produced}. ` +
             `This entry of ${goodQty} would total ${total}, over the cap of ${cap}${extraNote}. ` +
             advice;
    }

    function validateForm() {
      const errs = [];
      el('submit-errors').textContent = '';

      const shots = Number(el('d-shots')?.value || 0);
      const rej = rejItems.reduce((s, i) => s + Number(i.qty || 0), 0);
      const dt = dtItems.reduce((s, i) => s + Number(i.min || 0), 0);
      const slotVal = (el('d-slot')?.value || '').trim();

      if (!session.activeJob) {
        errs.push('No active job selected.');
      } else if (!setupDone) {
        errs.push('Fill & save Setup (ACT values) first for this PlanID / Shift / Machine.');
      }

      if (!slotVal) errs.push('Select an Hour Slot.');
      const colourVal = (el('d-color')?.value || '').trim();
      const colourOptCount2 = el('d-color')?.options?.length || 0;
      if (colourOptCount2 > 1 && !colourVal) errs.push('Select a Colour before submitting.');
      if (rej > shots) errs.push('Rejection Qty exceeds Shots.');
      {
        const capErr = colourCapError(colourVal, Math.max(0, shots - rej));
        if (capErr) errs.push(capErr);
      }
      if (dt > 60) errs.push('Downtime exceeds 60 minutes.');

      if (appSettings.geofence_enabled === 'true') {
        if (lastGeo && !insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc)) errs.push('Outside geofence (move inside factory or improve accuracy).');
      }

      /* Slot 07-08 in Day Shift is now the FIRST slot (7 AM - 8 AM) — no warning needed */

      el('form-errors').innerHTML = errs.map(e => `<span class="err">• ${e}</span>`).join('');

      const disabled = errs.length > 0;
      const firstReason = firstTruthy(errs);
      const btn = el('btn-submit');
      if (!btn) return;
      btn.disabled = disabled;
      btn.setAttribute('aria-disabled', String(disabled));
      btn.title = disabled ? `Cannot submit: ${firstReason}` : 'Submit DPR';
    }

    // Wired to <select id="d-date">. Handles the all-lines "Pick another date…" option,
    // otherwise behaves exactly like the normal date/shift change.
    function onDatePickChange() {
      const sel = el('d-date');
      // User picked a quick option (Today / Yesterday / a previously-picked date).
      // Drop any sticky custom back-date unless they re-selected it.
      if (sel && sel.value !== customDateChoice) customDateChoice = null;
      onDateShiftChange();
    }

    // Wired to the inline <input type="date" id="d-date-custom"> — commits an
    // all-lines back-date pick straight into the d-date <select>.
    function onCustomDatePick() {
      const custom = el('d-date-custom');
      const sel = el('d-date');
      if (!custom || !custom.value) return;

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const minD = new Date(today); minD.setDate(today.getDate() - 30);
      const picked = new Date(custom.value + 'T00:00:00');

      // Guard: only allow the last 30 days (matches server enforcement).
      if (isNaN(picked.getTime()) || picked > today || picked < minD) {
        alert('You can only pick a date within the last 30 days.');
        custom.value = customDateChoice || '';
        return;
      }

      customDateChoice = custom.value;
      // Inject/select the picked date as a real option so all el('d-date').value reads work.
      if (sel) {
        if (!hasOption(sel, customDateChoice)) {
          sel.add(new Option(fmtD(picked) + ' (picked)', customDateChoice));
        }
        sel.value = customDateChoice;
      }
      onDateShiftChange();
    }

    window.onDatePickChange = onDatePickChange;
    window.onCustomDatePick = onCustomDatePick;

    function onDateShiftChange() {
      // Remember the supervisor's relative date pick (Today/Yesterday) for this
      // page session so it isn't wiped when buildDateSelect() re-runs. Session
      // only: resets on page reload, so a stale "Yesterday" never carries over.
      try {
        const v = el('d-date').value;
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const y = new Date(t); y.setDate(t.getDate() - 1);
        if (v === isoDate(t)) sessionDateChoice = 'today';
        else if (v === isoDate(y)) sessionDateChoice = 'yesterday';
      } catch (_) { }

      loadUsedSlots();
      loadRecent();
    }

    /* Fetches used slots from backend */
    function loadUsedSlots() {
      const pid = session.activeJob ? session.activeJob.PlanID : '';
      if (!pid) return;

      const dt = el('d-date').value;
      const sh = el('d-shift').value;

      const span = el('slot-loader');
      if (span) span.textContent = '...';

      const url = `/api/dpr/used-slots?planId=${encodeURIComponent(pid)}` +
        `&date=${encodeURIComponent(dt)}` +
        `&shift=${encodeURIComponent(sh)}`;

      apiFetch(url)
        .then(r => r.json())
        .then(r => {
          if (span) span.textContent = '';
          // Backend returns [{ slot: '07-08', type: 'MAIN' }]
          usedSlots = (r && r.ok && Array.isArray(r.used)) ? r.used : [];
          // Merge into SLOT_STATUS so fillHourSlotSelect can hide filled slots
          // (SLOT_STATUS only has last-50 entries; this fills gaps for any selected date)
          const QUICK_TYPES_SET = new Set(['Maintenance','ManPowerShortage','MouldChangeover','MouldTrial','MouldMaintenance','NoPlan','PowerCut','MouldChange']);
          usedSlots.forEach(us => {
            const k = `${dt}_${String(sh).toUpperCase()}_${us.slot}`;
            let st = SLOT_STATUS.get(k) || { hasMain: false, hasCC: false, count: 0, isQuick: false, type: us.type };
            st.count = st.count || 1;
            if (us.type === 'MAIN' || us.type === 'Main') st.hasMain = true;
            if (us.type === 'ColourChange') st.hasCC = true;
            if (QUICK_TYPES_SET.has(us.type)) { st.isQuick = true; st.type = us.type; }
            SLOT_STATUS.set(k, st);
          });
          refreshSlots();
          checkPendingEntries(); // Trigger alert check
        })
        .catch(_ => {
          if (span) span.textContent = '';
          usedSlots = [];
          refreshSlots();
        });
    }

    /* Override refreshSlots – greys out locked slots AND blocks future slots */
    let dprEntryMode = 'Main'; // 'Main' or 'ColourChange'

    function setDPRMode(mode) {
      dprEntryMode = mode;

      // Update UI Tabs
      if (mode === 'Main') {
        el('mode-main').className = 'active';
        el('mode-cc').className = '';
        el('btn-submit').textContent = 'Submit DPR';
        el('btn-submit').className = 'primary';
      } else {
        el('mode-main').className = '';
        el('mode-cc').className = 'active';
        el('btn-submit').textContent = 'Submit Colour Change';
        el('btn-submit').className = 'primary'; // Could change color if needed
      }

      // Refresh slots with new blocking logic
      refreshSlots();
    }

    function refreshSlots() {
      // Use the new Dynamic 24h logic
      // If Mode is Main, hideFilled=true. If ColourChange, hideFilled=false.
      const shouldHide = (dprEntryMode === 'Main');
      fillHourSlotSelect('d-slot', null, shouldHide);
    }

    /* >>>>>>>>>>>>>>> OPTIMIZED SUBMIT <<<<<<<<<<<<<<< */
    // [KAN-82] Submit click-lock: disable the button the instant Submit is tapped so a
    // fast double/triple tap cannot create duplicate DPR entries. Minimum lock ~3s;
    // always re-enabled after the server responds so a failed save can be retried.
    let _submitLockedAt = 0;
    function lockSubmitBtn() {
      const b = el('btn-submit');
      if (b) {
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        _submitLockedAt = Date.now();
      }
    }
    function unlockSubmitBtn() {
      const b = el('btn-submit');
      if (!b) return;
      const wait = Math.max(0, 3000 - (Date.now() - _submitLockedAt));
      setTimeout(() => {
        b.disabled = false;
        b.setAttribute('aria-disabled', 'false');
      }, wait);
    }

    function submitDPR(e) {
      if (e) e.preventDefault();
      // 1. Validation & Preparation
      const btn = el('btn-submit');
      if (btn && btn.disabled) return; // [KAN-82] second tap does nothing
      lockSubmitBtn();                 // [KAN-82] lock immediately on first tap
      el('submit-errors').textContent = '';

      if (!session.activeJob) {
        el('dpr-msg').textContent = 'Select a job first.';
        unlockSubmitBtn();
        return;
      }

      if (appSettings.geofence_enabled === 'true') {
        if (!lastGeo || !insideGeofence(lastGeo.lat, lastGeo.lng, lastGeo.acc)) {
          el('submit-errors').textContent = 'Blocked: device is outside geofence. Recalibrate and try again.';
          unlockSubmitBtn();
          return;
        }
      }

      /* --- TOTAL SHOTS VALIDATION --- */
      const inputShots = Number(el('d-shots').value || 0);

      // Validation Removed as per user request (Was checking 2x limit)
      // The logic below is commented out / removed.
      /* ------------------------------ */

      /* --- COLOUR 110% CAP (hard block) --- */
      {
        const _rej = rejItems.reduce((s, i) => s + Number(i.qty || 0), 0);
        const capErr = colourCapError((el('d-color').value || '').trim(), Math.max(0, inputShots - _rej));
        if (capErr) {
          el('submit-errors').textContent = 'Blocked — over production: ' + capErr;
          unlockSubmitBtn();
          return;
        }
      }
      /* ----------------------------------- */

      // 2. CHECK FOR PREVIOUS SHIFT
      const selDate = el('d-date').value;
      const selShift = el('d-shift').value;

      // If the user explicitly chose "Yesterday" from the date picker, skip the
      // confirmation dialog — the backfill is intentional.
      if (sessionDateChoice === 'yesterday') {
        proceedSubmitDPR();
        return;
      }

      // [FIX] Compute the CURRENT expected shift/date from the browser clock at submit time.
      // Previously we used session.shiftDate (set at login) which is stale: an operator who
      // opens a job before 8 AM (Night shift → yesterday) would NEVER see the "last shift?"
      // warning when submitting at 10 AM, because the stale session date still matched.
      // Result: 10 AM entries silently went to yesterday's date and disappeared from today's summary.
      {
        const _now = new Date();
        const _mins = _now.getHours() * 60 + _now.getMinutes();
        const curShift = (_mins >= 490 && _mins < 1210) ? 'Day' : 'Night';
        const _dateObj = new Date(_now); _dateObj.setHours(0, 0, 0, 0);
        if (curShift === 'Night' && _mins < 490) _dateObj.setDate(_dateObj.getDate() - 1);
        const curDate = isoDate(_dateObj);

        if (selDate !== curDate || selShift !== curShift) {
          // Mismatch: form shows a different date/shift than "now"
          const msg = `Form is set to <b>${selShift} shift — ${selDate}</b> but the current shift is <b>${curShift} — ${curDate}</b>.<br><br>
                       <span style="color:#dc2626; font-weight:600">Click YES to update to today's shift, or NO to submit as-is (backfill).</span>`;

          el('confirm-msg').innerHTML = msg;

          // YES → auto-refresh to current shift/date, then submit
          el('btn-confirm-yes').onclick = function () {
            hide('modal-confirm');
            sessionDateChoice = 'today'; // user chose to update to current shift — don't let a sticky "Yesterday" override the reset
            buildDateSelect(); // reset to current shift date
            proceedSubmitDPR();
          };

          // NO → submit with the currently selected (previous shift) date
          el('btn-confirm-no').onclick = function () {
            hide('modal-confirm');
            proceedSubmitDPR();
          };

          show('modal-confirm');
          return; // wait for user choice
        }
      }

      // No mismatch — proceed directly
      proceedSubmitDPR();
    }

    function proceedSubmitDPR() {
      // Original logic moved here
      el('submit-errors').textContent = '';
      const btn = el('btn-submit');

      const colorSel = el('d-color').value || '';

      // Strings for Remarks (legacy format)
      const getFinalCode = (i) => i.code === 'OTHER' && i.otherText ? `OTHER_${i.otherText.trim()}` : i.code;

      const rejParts = rejItems
        .filter(i => Number(i.qty) > 0)
        .map(i => `${getFinalCode(i)}:${i.qty}`);
      const dtParts = dtItems
        .filter(i => Number(i.min) > 0)
        .map(i => `${getFinalCode(i)}:${i.min}`);

      // Objects for DB (JSONB)
      const rejObj = {};
      rejItems.filter(i => Number(i.qty) > 0).forEach(i => rejObj[getFinalCode(i)] = Number(i.qty));

      const dtObj = {};
      dtItems.filter(i => Number(i.min) > 0).forEach(i => dtObj[getFinalCode(i)] = Number(i.min));

      const breakdowns = [];
      if (colorSel) breakdowns.push(`Color=${colorSel}`);
      if (rejParts.length) breakdowns.push(`Rej[${rejParts.join('|')}]`);
      if (dtParts.length) breakdowns.push(`DT[${dtParts.join('|')}]`);

      const remarksBase = el('d-remarks').value || '';
      const Remarks = breakdowns.length
        ? (remarksBase ? remarksBase + ' | ' + breakdowns.join(' | ') : breakdowns.join(' | '))
        : remarksBase;

      const shots = Number(el('d-shots').value || 0);
      const rej = rejItems.reduce((s, i) => s + Number(i.qty || 0), 0);
      const dt = dtItems.reduce((s, i) => s + Number(i.min || 0), 0);
      const good = Math.max(0, shots - rej);



      // Parse Slot Value (Format: Date|Shift|Slot)
      const slotRaw = el('d-slot').value;
      let useDate = el('d-date').value;
      let useShift = el('d-shift').value;
      let useSlot = slotRaw;

      if (slotRaw && slotRaw.includes('|')) {
        const parts = slotRaw.split('|');
        if (parts.length === 3) {
          useDate = parts[0];
          useShift = parts[1];
          useSlot = parts[2];
        }
      }

      const entry = {
        Date: useDate,
        Shift: useShift,
        HourSlot: useSlot,
        Shots: shots,
        GoodQty: good,
        RejectQty: rej,
        DowntimeMin: dt,
        Remarks,

        PlanID: session.activeJob.PlanID || '',
        Machine: session.activeJob.Machine || '',
        OrderNo: session.activeJob.OrderNo || '',
        MouldNo: getJobMouldNo(session.activeJob),
        JobCardNo: getJobCardNo(session.activeJob),

        Colour: colorSel,
        RejectBreakup: rejObj,       // Send Object
        DowntimeBreakup: dtObj,      // Send Object
        EntryType: dprEntryMode,     // 'Main' or 'ColourChange'
        Supervisor: (shiftTeamData && shiftTeamData.entry_person) ? shiftTeamData.entry_person : ''
      };

      el('dpr-msg').textContent = 'Saving…';
      lockSubmitBtn(); // [KAN-82] idempotent — covers direct calls that skipped submitDPR

      showLoading();
      apiFetch('/api/dpr/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: { username: session.username, line: session.line },
          entry,
          geo: currentGeoObj()
        })
      })
        .then(r => r.json())
        .then(r => {
          if (r && r.ok) {
            el('dpr-msg').innerHTML = '<span class="ok">Saved.</span>';
            // Log DPR entry to Activity Monitor
            _logSupervisorActivity('dpr_entry', {
              machine:      entry.Machine,
              plan_id:      entry.PlanID,
              order_no:     entry.OrderNo,
              mould:        entry.MouldNo,
              slot:         entry.HourSlot,
              shift:        entry.Shift,
              date:         entry.Date,
              colour:       entry.Colour,
              shots:        entry.Shots,
              good_qty:     entry.GoodQty,
              reject_qty:   entry.RejectQty,
              downtime_min: entry.DowntimeMin
            });
            // Reset to Main Entry for next time
            setDPRMode('Main');

            // [FIX] Refresh date/shift selector after each save so the form always shows
            // the current shift, even if a shift boundary (8 AM / 8 PM) passed since job open.
            buildDateSelect();

            loadQueue();
            loadRecent();
            loadUsedSlots();
            updateFilledSlots();

            // Refresh colour balance table immediately so operator sees updated balance
            // (including any negative/over-produced values after this entry)
            if (session.activeJob) {
              renderColorPlanTable(session.activeJob);
            }
          } else {
            el('submit-errors').textContent =
              (r && r.error) ? String(r.error) : 'Save failed due to an unknown error.';
          }
        })
        .catch(err => {
          el('dpr-msg').textContent = '';
          // AbortError = our 15s network timeout — tell the writer what to do, not "AbortError".
          // Re-submitting is safe: the server duplicate-guard returns the same entry if it saved.
          el('submit-errors').textContent = (err && err.name === 'AbortError')
            ? 'Network slow — could not confirm the save. Tap 📋 to check this slot, then Submit again if missing.'
            : String(err);
        })
        .finally(() => {
          hideLoading();
          // [KAN-82] Always re-enable (min 3s after tap) — success, error, or network
          // failure — so the writer can retry and the button never stays stuck disabled.
          unlockSubmitBtn();
        });
    }

    /* ==================== PENDING ENTRIES ALERT ==================== */
    // Run every 2 hours
    setInterval(() => checkPendingEntries(), 2 * 60 * 60 * 1000);

    function checkPendingEntries() {
      if (!session.activeJob) return; // Only check if job active

      // We need usedSlots. If not loaded, we can't check.
      if (!usedSlots) return;

      const missing = [];
      const dateVal = el('d-date').value;
      const shiftVal = el('d-shift').value;
      const now = new Date();
      const [y, m, d] = dateVal.split('-').map(Number);
      const baseDate = new Date(y, m - 1, d, 0, 0, 0, 0);

      // Re-use Calc Logic
      const calcEndTime = (slotStr) => {
        const parts = slotStr.split('-');
        const endH = parseInt(parts[1], 10);
        const shiftDate = new Date(baseDate);
        let h = endH;

        if (shiftVal === 'Day') {
          if (h <= 7) h += 12; // 1-7 PM
        } else {
          if (h === 8) h = 20;
          else if (h === 12) h = 24;
          else if (h <= 7) h += 24;
          else h += 12;
        }
        shiftDate.setHours(h, 0, 0, 0);
        return shiftDate;
      };

      // 1. Pre-process usedSlots to calculate Auto-Fill propagation
      const filledByStatus = {};
      let activeMaint = false;

      SLOT_LABELS.forEach(s => {
        const entry = usedSlots.find(u => u.slot === s);
        if (entry) {
          // If valid entry exists
          if (['Maintenance', 'MouldChangeover', 'ManPowerShortage', 'MouldTrial', 'MouldMaintenance', 'NoPlan'].includes(entry.type)) {
            activeMaint = true;
            filledByStatus[s] = true;
          } else {
            activeMaint = false; // Real production breaks chain
            filledByStatus[s] = true;
          }
        } else if (activeMaint) {
          // Auto-filled by previous status
          filledByStatus[s] = true;
        }
      });

      SLOT_LABELS.forEach(s => {
        const endT = calcEndTime(s);
        // If slot has passed
        if (endT <= now) {
          if (!filledByStatus[s]) missing.push(s);
        }
      });

      const btn = el('btn-pending');
      if (missing.length > 0) {
        btn.classList.remove('hidden');
        btn.style.display = 'inline-block';
        btn.textContent = `⚠ ${missing.length} Pending`;
        btn.onclick = () => alert("Missing Entries for:\n" + missing.join(', '));
      } else {
        btn.classList.add('hidden');
        btn.style.display = 'none';
      }
    }

    // Hook into existing flow: Run check after slots loaded
    // Hook into existing flow: Run check after slots loaded
    // (We added the call in loadUsedSlots promise)




    /* ==================== COLOUR CHANGE (Original) ==================== */
    let ccRej = [];
    let ccDt = [];

    function openColourChange() {
      ccRej = [];
      ccDt = [];

      el('cc-shots').value = '';
      el('cc-good').value = '';
      el('cc-rej').innerHTML = '';
      el('cc-dt').innerHTML = '';
      el('cc-rej-total').textContent = '0';
      el('cc-dt-total').textContent = '0';
      el('cc-errors').innerHTML = '';
      el('cc-msg').textContent = '';

      el('cc-colour').innerHTML = el('d-color').innerHTML;
      el('cc-colour').value = el('d-color').value;

      const mainSlot = el('d-slot') ? el('d-slot').value : '';
      fillHourSlotSelect('cc-slot', mainSlot, false);
      // Wait for UI to render then select value
      setTimeout(() => {
        if (el('cc-slot').value !== mainSlot) el('cc-slot').value = mainSlot;
      }, 50);
    }

    function showMachineCheck(entry) {
      show('modal-machine-check');
      const mainSlot = el('d-slot').value;
      fillHourSlotSelect('mc-slot', mainSlot, false);
    }

    function closeCc() {
      hide('modal-cc');
    }

    function ccAddRej() {
      // Init empty
      ccRej.push({ qty: '', code: REJECT_REASONS[0][0], text: REJECT_REASONS[0][1], otherText: '' });
      ccRenderRej();
    }

    function ccAddDt() {
      // Init empty
      ccDt.push({ min: '', code: DOWNTIME_REASONS[0][0], text: DOWNTIME_REASONS[0][1], otherText: '' });
      ccRenderDt();
    }

    /* ==================== MOULD CHANGE ==================== */
    let mcDt = [];
    let currentMcEntryType = 'MouldChange';

    function openMouldChange() {
      currentMcEntryType = 'MouldChange';
      const mainSlot = el('d-slot') ? el('d-slot').value : '';
      fillHourSlotSelect('mc-slot', mainSlot);

      mcDt = [];
      el('mc-dt').innerHTML = '';
      el('mc-dt-total').textContent = '0';
      el('mc-errors').innerHTML = '';
      el('mc-msg').textContent = '';

      show('modal-mc');
    }

    function closeMc() {
      hide('modal-mc');
    }

    function mcAddDt() {
      mcDt.push({ min: 0, code: DOWNTIME_REASONS[1][0], text: DOWNTIME_REASONS[1][1], otherText: '' });
      mcRender();
    }

    function mcRender() {
      const w = el('mc-dt');
      w.innerHTML = '';

      mcDt.forEach((it, i) => {
        const d = document.createElement('div');
        d.className = 'chip';

        const q = document.createElement('input');
        q.type = 'number';
        q.min = '0';
        q.value = it.min || 0;
        q.inputMode = 'numeric';
        q.oninput = () => {
          it.min = Number(q.value || 0);
          mcRecalc();
        };

        const s = document.createElement('select');
        DOWNTIME_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c)));
        s.value = it.code || '';

        const oInp = document.createElement('input');
        oInp.type = 'text'; oInp.placeholder = 'Please specify...'; oInp.style.width = '120px';
        oInp.value = it.otherText || '';
        oInp.oninput = () => { it.otherText = oInp.value; mcRecalc(); };
        oInp.style.display = it.code === 'OTHER' ? 'inline-block' : 'none';

        s.onchange = () => {
          const f = DOWNTIME_REASONS.find(r => r[0] === s.value);
          it.code = s.value;
          it.text = f ? f[1] : '';
          oInp.style.display = it.code === 'OTHER' ? 'inline-block' : 'none';
        };

        const rm = document.createElement('button');
        rm.className = 'small';
        rm.textContent = '✕';
        rm.onclick = () => {
          mcDt.splice(i, 1);
          mcRender();
        };

        d.append(q, s, oInp, rm);
        w.appendChild(d);
      });

      mcRecalc();
    }

    function mcRecalc() {
      const dt = mcDt.reduce((s, i) => s + Number(i.min || 0), 0);
      el('mc-dt-total').textContent = String(dt);

      const errs = [];

      if (!el('mc-slot').value) {
        errs.push('Select Hour Slot.');
      }
      if (dt > 60) {
        errs.push('Downtime exceeds 60.');
      }

      el('mc-errors').innerHTML = errs.map(e => `<span class="err">• ${e}</span>`).join('');
    }

    function mcSave() {
      const job = session.activeJob || {};
      const machine = job.Machine || session.machine;
      if (!machine) {
        alert("Please select a machine first.");
        return;
      }

      const slotRaw = el('mc-slot').value;
      let useDate = el('d-date').value;
      let useShift = el('d-shift').value;
      let useSlot = slotRaw;

      if (slotRaw && slotRaw.includes('|')) {
        const parts = slotRaw.split('|');
        if (parts.length === 3) {
          useDate = parts[0];
          useShift = parts[1];
          useSlot = parts[2];
        }
      }

      const dt = mcDt.reduce((s, i) => s + Number(i.min || 0), 0);

      mcRecalc();
      if (!useSlot || dt > 60) {
        return;
      }

      // Quick-action / downtime entries are NOT blocked for a missing colour — if the operator
      // hasn't picked one, the backend auto-fills the LAST running colour of this job so the
      // entry still sits under the right colour instead of the "Default" bucket. We pass through
      // whatever colour is selected (if any); the server handles the empty case.

      const getFinalCode = (i) => i.code === 'OTHER' && i.otherText ? `OTHER_${i.otherText.trim()}` : i.code;

      const dtObj = {};
      mcDt.filter(i => Number(i.min) > 0).forEach(i => {
        dtObj[getFinalCode(i)] = Number(i.min);
      });

      const entry = {
        Date: useDate,
        Shift: useShift,
        HourSlot: useSlot,
        Shots: 0,
        GoodQty: 0,
        RejectQty: 0,
        DowntimeMin: dt,
        Remarks: 'Mould Change',

        PlanID: job.PlanID || '',
        Machine: machine,
        OrderNo: job.OrderNo || '',
        MouldNo: getJobMouldNo(job),
        JobCardNo: (typeof getJobCardNo === 'function' ? getJobCardNo(job) : '') || '',

        Colour: el('d-color').value || '',
        RejectBreakup: {},
        DowntimeBreakup: dtObj,
        EntryType: currentMcEntryType
      };

      el('mc-msg').textContent = 'Saving…';
      showLoading();

      apiFetch('/api/dpr/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: { username: session.username, line: session.line },
          entry,
          geo: currentGeoObj()
        })
      })
        .then(r => r.json())
        .then(r => {
          if (r && r.ok) {
            el('mc-msg').innerHTML = '<span class="ok">Saved.</span>';
            // Log quick action to Activity Monitor
            _logSupervisorActivity('quick_action', {
              machine:      entry.Machine,
              plan_id:      entry.PlanID,
              order_no:     entry.OrderNo,
              slot:         entry.HourSlot,
              shift:        entry.Shift,
              date:         entry.Date,
              action_type:  currentMcEntryType,
              downtime_min: dt
            });
            closeMc();
            loadRecent();
            loadUsedSlots();
            // Refresh slot selector so Quick Action slot + its continuations are hidden
            updateFilledSlots();
          } else {
            el('mc-msg').innerHTML = '<span class="err">' + ((r && r.error) || 'Failed') + '</span>';
          }
        })
        .catch(err => {
          el('mc-msg').innerHTML = '<span class="err">' + String(err) + '</span>';
        })
        .finally(() => hideLoading());
    }

    /* Helper to parse remarks: "Color=Red | Rej[Dirty:5|Warped:1] | DT[NoPower:10]" */
    function parseReasons(rem) {
      const res = { rejections: [], downtimes: [] };
      if (!rem) return res;

      const rejMatch = rem.match(/Rej\[(.*?)\]/);
      if (rejMatch && rejMatch[1]) {
        rejMatch[1].split('|').forEach(s => {
          const [reason, qty] = s.split(':');
          if (reason && qty) res.rejections.push({ reason, qty });
        });
      }

      const dtMatch = rem.match(/DT\[(.*?)\]/);
      if (dtMatch && dtMatch[1]) {
        dtMatch[1].split('|').forEach(s => {
          const [reason, min] = s.split(':');
          if (reason && min) res.downtimes.push({ reason, min });
        });
      }
      return res;
    }

    /* ==================== VIEW ENTRIES v2 — Active Jobs / All Jobs (3-level nav) ==================== */

    let currentRecentFilter = 'active'; // 'active' | 'all'
    let _recentLevel = 1;               // 1=list  2=drilldown  3=hourly
    let _recentJobsList  = null;        // cached Level-1 API result
    let _recentJobData   = null;        // selected job from Level 1
    let _recentDrilldown = null;        // cached plan-drilldown result
    let _recentShiftDate = null;
    let _recentShiftName = null;

    function toggleRecentFilter(mode, btn) {
      currentRecentFilter = mode;
      _recentLevel     = 1;
      _recentJobsList  = null; // invalidate cache so fresh data is fetched
      _recentJobData   = null;
      _recentDrilldown = null;

      const container = document.getElementById('recent-filter-container');
      if (container) {
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        else {
          const idx = mode === 'active' ? 0 : 1;
          if (container.children[idx]) container.children[idx].classList.add('active');
        }
      }
      loadRecent();
    }

    async function loadRecent() {
      const wrap = el('recent');
      if (!wrap) return;
      const mach = session.machine;
      if (!mach) {
        wrap.innerHTML = '<div class="no-jobs" style="padding:32px;text-align:center;">Please select a machine first.</div>';
        return;
      }
      if (_recentLevel === 1) await _rvL1(wrap, mach);
      else if (_recentLevel === 2) await _rvL2(wrap, mach);
      else if (_recentLevel === 3) await _rvL3(wrap, mach);
    }

    /* ── LEVEL 1: Job Cards List ── */
    async function _rvL1(wrap, mach) {
      wrap.innerHTML = '<div style="padding:36px;text-align:center;color:var(--muted);"><i class="bi bi-arrow-repeat spin"></i> Loading jobs…</div>';
      const curDate  = el('d-date').value;
      const curShift = el('d-shift').value;
      try {
        if (!_recentJobsList) {
          const res = await (await apiFetch(
            `/api/planning/machine-jobs?machine=${encodeURIComponent(mach)}&date=${encodeURIComponent(curDate)}&shift=${encodeURIComponent(curShift)}`
          )).json();
          if (!res.ok) throw new Error(res.error || 'Failed');
          _recentJobsList = res.data || [];
        }

        let jobs = _recentJobsList;
        if (currentRecentFilter === 'active') jobs = jobs.filter(j => j.has_today_entry);

        if (!jobs.length) {
          wrap.innerHTML = `
            <div style="padding:40px;text-align:center;background:#f8fbff;border-radius:18px;">
              <div style="font-size:2.2rem;margin-bottom:10px;">${currentRecentFilter === 'active' ? '🏭' : '📋'}</div>
              <div style="font-size:0.9rem;font-weight:700;color:#475569;margin-bottom:4px;">
                ${currentRecentFilter === 'active' ? 'No entries in this shift yet' : 'No jobs on this machine'}
              </div>
              <div style="font-size:0.72rem;color:#94a3b8;">${safe(curDate)} · ${safe(curShift)} Shift</div>
            </div>`;
          return;
        }

        wrap.innerHTML = '';
        jobs.forEach(job => {
          const card = document.createElement('div');
          card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);cursor:pointer;';
          const si  = _rvStatusInfo(job.status);
          const cols = _rvParseColours(job.colour_details, job.colour_produced, job.plan_qty);

          card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="flex:1;min-width:0;padding-right:8px;">
                <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin-bottom:2px;">
                  <span style="font-size:0.6rem;color:#94a3b8;font-weight:600;text-transform:uppercase;padding-top:2px;white-space:nowrap;">OR No.</span>
                  <span style="font-weight:800;font-size:0.9rem;color:#1e3a5f;word-break:break-all;">${safe(job.order_no||'—')}</span>
                  <span style="font-size:0.6rem;color:#94a3b8;font-weight:600;text-transform:uppercase;padding-top:2px;white-space:nowrap;">JC No.</span>
                  <span style="font-weight:800;font-size:0.9rem;color:#1d4ed8;word-break:break-all;">${safe(job.job_card_no||'—')}</span>
                  <span style="font-size:0.6rem;color:#94a3b8;font-weight:600;text-transform:uppercase;padding-top:2px;white-space:nowrap;">Mould</span>
                  <span style="font-weight:700;font-size:0.8rem;color:#334155;word-break:break-all;">${safe(job.mould_name||'—')}</span>
                  <span style="font-size:0.6rem;color:#94a3b8;font-weight:600;text-transform:uppercase;padding-top:2px;white-space:nowrap;">Client</span>
                  <span style="font-weight:700;font-size:0.8rem;color:#15803d;word-break:break-all;">${safe(job.client_name||'—')}</span>
                </div>
              </div>
              <div style="flex-shrink:0;text-align:right;">
                <span style="font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:20px;background:${si.bg};color:${si.color};white-space:nowrap;">${si.icon} ${si.label}</span>
                ${job.has_today_entry?'<div style="font-size:0.6rem;color:#0284c7;margin-top:4px;">● Entry today</div>':''}
              </div>
            </div>
            <div style="border-top:1px solid #f1f5f9;padding-top:8px;">
              <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 8px;font-size:0.6rem;color:#94a3b8;font-weight:700;text-transform:uppercase;padding:2px 0 5px;">
                <div>Colour</div><div style="text-align:right;">Plan</div><div style="text-align:right;">Prod</div><div style="text-align:right;">Bal</div>
              </div>
              ${cols.slice(0,5).map(c=>`
                <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 8px;font-size:0.72rem;padding:3px 0;border-bottom:1px solid #f8fafc;">
                  <div style="font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safe(c.colour)}</div>
                  <div style="text-align:right;color:#64748b;">${c.planQty.toLocaleString()}</div>
                  <div style="text-align:right;color:#0284c7;font-weight:700;">${c.produced.toLocaleString()}</div>
                  <div style="text-align:right;font-weight:700;color:${c.bal<=0?'#15803d':'#ea580c'};">${c.bal.toLocaleString()}</div>
                </div>`).join('')}
              ${cols.length>5?`<div style="font-size:0.62rem;color:#94a3b8;padding-top:3px;">+${cols.length-5} more colours</div>`:''}
              <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:2px 8px;font-size:0.73rem;padding:5px 0 2px;border-top:1.5px solid #e2e8f0;font-weight:800;margin-top:2px;">
                <div style="color:#1e293b;">TOTAL</div>
                <div style="text-align:right;color:#334155;">${(job.plan_qty||0).toLocaleString()}</div>
                <div style="text-align:right;color:#0284c7;">${(job.produced_qty||0).toLocaleString()}</div>
                <div style="text-align:right;color:${(job.balance_qty||0)<=0?'#15803d':'#ea580c'};">${(job.balance_qty||0).toLocaleString()}</div>
              </div>
            </div>
            <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #f1f5f9;text-align:right;">
              <span style="font-size:0.72rem;color:#2563eb;font-weight:700;">📊 View Details →</span>
            </div>`;

          card.addEventListener('click', () => {
            _recentJobData   = job;
            _recentDrilldown = null;
            _recentLevel     = 2;
            _rvL2(el('recent'), mach);
          });
          wrap.appendChild(card);
        });
      } catch (e) {
        wrap.innerHTML = `<div class="err" style="padding:16px;">Error: ${safe(e.message)}</div>`;
      }
    }

    /* ── LEVEL 2: Colour × Shift drilldown table ── */
    async function _rvL2(wrap, mach) {
      wrap.innerHTML = '<div style="padding:36px;text-align:center;color:var(--muted);"><i class="bi bi-arrow-repeat spin"></i> Loading details…</div>';
      const curDate  = el('d-date').value;
      const curShift = el('d-shift').value;
      const job = _recentJobData;
      if (!job) { _recentLevel=1; _rvL1(wrap,mach); return; }

      try {
        if (!_recentDrilldown || _recentDrilldown._pid !== job.plan_id) {
          const res = await (await apiFetch(`/api/dpr/plan-drilldown?planId=${encodeURIComponent(job.plan_id)}`)).json();
          if (!res.ok) throw new Error(res.error || 'Failed');
          _recentDrilldown = { ...res.data, _pid: job.plan_id };
        }
        const dd = _recentDrilldown;
        const si = _rvStatusInfo(job.status);

        let html = `
          <button onclick="window._rvBack()" style="background:none;border:none;color:#2563eb;font-size:0.8rem;font-weight:700;padding:6px 0 12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
            <i class="bi bi-arrow-left"></i> Back to Jobs
          </button>

          <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:14px;padding:14px 16px;margin-bottom:14px;color:#fff;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div style="font-weight:800;font-size:0.92rem;word-break:break-all;padding-right:8px;">${safe(job.order_no||'—')}</div>
              <span style="font-size:0.62rem;font-weight:700;padding:2px 8px;border-radius:20px;background:${si.bg};color:${si.color};flex-shrink:0;">${si.icon} ${si.label}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;">
              <div><div style="font-size:0.58rem;color:rgba(255,255,255,0.45);font-weight:600;margin-bottom:1px;">JC NO</div><div style="font-size:0.78rem;font-weight:700;word-break:break-all;">${safe(job.job_card_no||'—')}</div></div>
              <div><div style="font-size:0.58rem;color:rgba(255,255,255,0.45);font-weight:600;margin-bottom:1px;">MOULD</div><div style="font-size:0.78rem;font-weight:600;word-break:break-all;">${safe(job.mould_name||'—')}</div></div>
              <div><div style="font-size:0.58rem;color:rgba(255,255,255,0.45);font-weight:600;margin-bottom:1px;">CLIENT</div><div style="font-size:0.78rem;font-weight:600;word-break:break-all;">${safe(dd.clientName||job.client_name||'—')}</div></div>
              <div><div style="font-size:0.58rem;color:rgba(255,255,255,0.45);font-weight:600;margin-bottom:1px;">TOTAL PLAN</div><div style="font-size:0.78rem;font-weight:700;">${(job.plan_qty||0).toLocaleString()} pcs</div></div>
            </div>
          </div>

          <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:8px;">📊 Colour × Shift Breakdown</div>
          <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px;border:1px solid #e2e8f0;background:#fff;">
            <table style="width:100%;min-width:340px;border-collapse:collapse;font-size:0.72rem;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:9px 10px;text-align:left;color:#64748b;font-weight:700;font-size:0.6rem;border-bottom:2px solid #e2e8f0;white-space:nowrap;min-width:100px;">COLOUR / PLAN</th>
                  <th style="padding:9px 8px;text-align:right;color:#0284c7;font-weight:700;font-size:0.6rem;border-bottom:2px solid #e2e8f0;white-space:nowrap;">PROD.</th>
                  <th style="padding:9px 8px;text-align:right;color:#64748b;font-weight:700;font-size:0.6rem;border-bottom:2px solid #e2e8f0;white-space:nowrap;">BAL.</th>
                  <th style="padding:9px 8px;text-align:center;color:#64748b;font-weight:700;font-size:0.6rem;border-bottom:2px solid #e2e8f0;white-space:nowrap;">DATE</th>
                  <th style="padding:9px 8px;text-align:center;color:#64748b;font-weight:700;font-size:0.6rem;border-bottom:2px solid #e2e8f0;white-space:nowrap;">SHIFT</th>
                </tr>
              </thead>
              <tbody>`;

        const colours = dd.colours || [];
        colours.forEach((c) => {
          const shifts = (c.shifts || []).slice().sort((a,b)=>{
            if (a.date!==b.date) return a.date<b.date?-1:1;
            return a.shift==='Day'?-1:1;
          });
          let runBal = c.planQty || 0;

          if (!shifts.length) {
            html += `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px;vertical-align:top;">
                <div style="font-weight:700;color:#1e293b;font-size:0.78rem;">${safe(c.colour)}</div>
                <div style="font-size:0.82rem;font-weight:800;color:#475569;margin-top:2px;">${(c.planQty||0).toLocaleString()} <span style="font-size:0.58rem;font-weight:600;color:#94a3b8;">PLAN</span></div>
              </td>
              <td colspan="4" style="padding:10px 8px;text-align:center;color:#94a3b8;font-style:italic;font-size:0.68rem;">No entries yet</td>
            </tr>`;
          } else {
            shifts.forEach((s, si) => {
              const isCur = s.date===curDate && s.shift===curShift;
              runBal -= (s.goodQty||0);
              const balNeg = runBal < 0;
              const rowBg  = isCur ? '#f0fdf4' : (si%2===0?'#fff':'#fafafa');
              const dl     = s.date ? s.date.split('-').reverse().join('-') : '—';
              html += `
                <tr onclick="window._rvOpenShift('${safe(job.plan_id)}','${safe(s.date)}','${safe(s.shift)}')"
                    style="background:${rowBg};${isCur?'border-left:3px solid #22c55e;outline:1.5px solid #bbf7d0;':''}cursor:pointer;border-bottom:1px solid #f1f5f9;"
                    onmouseenter="this.style.background='${isCur?'#dcfce7':'#f0f9ff'}'"
                    onmouseleave="this.style.background='${rowBg}'">
                  <td style="padding:${si===0?'10px':'6px'} 10px ${si===0&&shifts.length>1?'2px':'8px'};vertical-align:top;">
                    ${si===0?`<div style="font-weight:700;color:#1e293b;font-size:0.78rem;">${safe(c.colour)}</div>
                              <div style="font-size:0.82rem;font-weight:800;color:#475569;margin-top:2px;">${(c.planQty||0).toLocaleString()} <span style="font-size:0.58rem;font-weight:600;color:#94a3b8;">PLAN</span></div>`:''}
                  </td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:#0284c7;">${(s.goodQty||0).toLocaleString()}</td>
                  <td style="padding:8px;text-align:right;font-weight:700;color:${balNeg?'#dc2626':runBal===0?'#15803d':'#334155'};">${runBal.toLocaleString()}</td>
                  <td style="padding:8px;text-align:center;color:#475569;white-space:nowrap;font-size:0.68rem;">${safe(dl)}</td>
                  <td style="padding:8px;text-align:center;white-space:nowrap;">
                    ${isCur
                      ?`<span style="font-size:0.6rem;font-weight:700;background:#dcfce7;color:#15803d;padding:2px 7px;border-radius:20px;">${safe(s.shift)} ✓</span>`
                      :`<span style="font-size:0.68rem;color:#64748b;">${safe(s.shift)}</span>`}
                  </td>
                </tr>`;
            });
          }
        });

        if (!colours.length) {
          html += `<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8;font-style:italic;font-size:0.78rem;">No colour data found</td></tr>`;
        }

        html += `</tbody></table></div>
          <div style="margin-top:8px;font-size:0.62rem;color:#94a3b8;text-align:center;">Tap any row to view hourly entries</div>`;

        wrap.innerHTML = html;

        window._rvOpenShift = function(planId, date, shift) {
          _recentShiftDate = date;
          _recentShiftName = shift;
          _recentLevel = 3;
          _rvL3(el('recent'), mach);
        };
      } catch (e) {
        wrap.innerHTML = `<div class="err" style="padding:16px;">Error: ${safe(e.message)}</div>`;
      }
    }

    /* ── LEVEL 3: Hourly entries for a shift ── */
    async function _rvL3(wrap, mach) {
      wrap.innerHTML = '<div style="padding:36px;text-align:center;color:var(--muted);"><i class="bi bi-arrow-repeat spin"></i> Loading entries…</div>';
      const date  = _recentShiftDate;
      const shift = _recentShiftName;
      const job   = _recentJobData;
      const curDate  = el('d-date').value;
      const curShift = el('d-shift').value;
      const isCur = (date===curDate && shift===curShift);
      if (!job || !date || !shift) { _recentLevel=2; _rvL2(wrap,mach); return; }

      try {
        const res = await (await apiFetch(
          `/api/dpr/recent?machine=${encodeURIComponent(mach)}&planId=${encodeURIComponent(job.plan_id)}&date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}&limit=50`
        )).json();
        if (!res||!res.ok) throw new Error((res&&res.error)||'Failed');

        const rows = (res.data&&(Array.isArray(res.data)?res.data:res.data.rows))||[];
        const dl   = date?date.split('-').reverse().join('-'):'—';
        const icon = shift==='Day'?'☀️':'🌙';
        const shiftTotal = rows.reduce((s,r)=>s+Number(r.GoodQty||0),0);

        let html = `
          <button onclick="window._rvBack()" style="background:none;border:none;color:#2563eb;font-size:0.8rem;font-weight:700;padding:6px 0 12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
            <i class="bi bi-arrow-left"></i> Back to Details
          </button>
          <div style="background:${isCur?'linear-gradient(135deg,#14532d,#16a34a)':'linear-gradient(135deg,#1e293b,#334155)'};border-radius:12px;padding:12px 14px;margin-bottom:12px;color:#fff;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:0.62rem;color:rgba(255,255,255,0.6);margin-bottom:2px;">${safe(job.order_no)}</div>
              <div style="font-weight:800;font-size:1rem;">${icon} ${safe(shift)} Shift</div>
              <div style="font-size:0.72rem;color:rgba(255,255,255,0.7);margin-top:2px;">${dl}</div>
            </div>
            ${isCur?'<span style="font-size:0.68rem;font-weight:700;background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:20px;">● Current</span>':''}
          </div>`;

        if (rows.length) {
          html += `<div style="background:#f0f9ff;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.72rem;color:#0284c7;font-weight:700;">${icon} Shift Total</span>
            <span style="font-size:1.1rem;font-weight:800;color:#0284c7;">${shiftTotal.toLocaleString()} <span style="font-size:0.65rem;font-weight:600;color:#94a3b8;">GOOD</span></span>
          </div>`;

          rows.forEach((r, i) => {
            const dt  = new Date(r.DateTime);
            const tm  = dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
            const { rejections, downtimes } = parseReasons(r.Remarks);
            const canEdit = isCur && (i===0);
            const sRem = (r.Remarks||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
            const rBk = r.RejectBreakup?JSON.stringify(r.RejectBreakup).replace(/"/g,'&quot;'):'{}';
            const dBk = r.DowntimeBreakup?JSON.stringify(r.DowntimeBreakup).replace(/"/g,'&quot;'):'{}';

            html += `
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,0.04);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                  <div>
                    <div style="font-weight:800;font-size:0.85rem;color:#1e293b;display:flex;align-items:center;gap:6px;">
                      <span style="background:#0f172a;color:#fff;padding:1px 7px;border-radius:5px;font-size:0.7rem;">${safe(r.HourSlot)}</span>
                      <span>${tm}</span>
                      ${r.Colour?`<span style="font-size:0.63rem;color:#64748b;">${safe(r.Colour)}</span>`:''}
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                    ${canEdit?`<div style="display:flex;gap:6px;">
                      <button style="padding:6px;border:1.5px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;cursor:pointer;" onclick="openEdit('${r.UniqueID}',${r.Shots},${r.RejectQty},${r.DowntimeMin},'${sRem}','${r.Colour||''}','${rBk}','${dBk}','${r.PlanID||''}','${r.OrderNo||''}','${r.MouldNo||''}')"><i class="bi bi-pencil" style="font-size:14px;"></i></button>
                      <button style="padding:6px;border:1.5px solid #fecaca;border-radius:8px;background:#fff;color:#dc2626;cursor:pointer;" onclick="deleteEntry('${r.UniqueID}')"><i class="bi bi-trash" style="font-size:14px;"></i></button>
                    </div>`:''}
                    <div style="text-align:right;">
                      <div style="font-weight:800;font-size:1.1rem;color:#16a34a;">${r.GoodQty} <span style="font-size:0.62rem;font-weight:600;color:#94a3b8;">GOOD</span></div>
                      <div style="font-size:0.63rem;color:#94a3b8;">Shots:${r.Shots} Rej:${r.RejectQty}</div>
                    </div>
                  </div>
                </div>
                ${rejections.length||downtimes.length?`
                  <div style="display:flex;flex-wrap:wrap;gap:5px;padding-top:7px;border-top:1px dashed #e2e8f0;margin-top:4px;">
                    ${rejections.map(x=>`<span style="font-size:0.63rem;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:1px 6px;border-radius:20px;"><i class="bi bi-x-circle"></i> ${getRejName(x.reason)} (${x.qty})</span>`).join('')}
                    ${downtimes.map(x=>`<span style="font-size:0.63rem;background:#fff7ed;color:#9a3412;border:1px solid #ffedd5;padding:1px 6px;border-radius:20px;"><i class="bi bi-clock-history"></i> ${getDtName(x.reason)} (${x.min}m)</span>`).join('')}
                  </div>`:''}
                ${r.OtherRemarks?`<div style="font-size:0.68rem;color:#64748b;margin-top:6px;font-style:italic;border-left:2px solid #e2e8f0;padding-left:8px;">"${safe(r.OtherRemarks)}"</div>`:''}
              </div>`;
          });
        } else {
          html += '<div style="padding:32px;text-align:center;color:#94a3b8;font-size:0.82rem;">No entries found for this shift.</div>';
        }

        wrap.innerHTML = html;
      } catch (e) {
        wrap.innerHTML = `<div class="err" style="padding:16px;">Error: ${safe(e.message)}</div>`;
      }
    }

    /* ── Back navigation ── */
    window._rvBack = function() {
      const mach = session.machine;
      if (_recentLevel === 3) { _recentLevel = 2; _rvL2(el('recent'), mach); }
      else if (_recentLevel === 2) { _recentLevel = 1; _rvL1(el('recent'), mach); }
    };

    /* ── Status badge ── */
    function _rvStatusInfo(status) {
      const s = (status||'').toUpperCase();
      if (s==='RUNNING')   return { label:'Running',   icon:'🟢', bg:'#dcfce7', color:'#15803d' };
      if (s==='COMPLETED') return { label:'Completed', icon:'⚫', bg:'#f1f5f9', color:'#475569' };
      return                      { label:'Planned',   icon:'🔵', bg:'#dbeafe', color:'#1d4ed8' };
    }

    /* ── Colour data parser ── */
    function _rvParseColours(colourDetails, colourProduced, totalPlanQty) {
      const planMap = {};
      try {
        const cd = typeof colourDetails==='string'?JSON.parse(colourDetails):(colourDetails||[]);
        if (Array.isArray(cd)) cd.forEach(c=>{
          const n=((c.colourName||c.itemColour||c.colour||c.color||c.name||'')).trim()||'Default';
          planMap[n]=(planMap[n]||0)+Number(c.planQty??c.useQty??c.batchQty??c.qty??0);
        });
      } catch(_){}
      const prodMap = {};
      try {
        const cp = typeof colourProduced==='string'?JSON.parse(colourProduced||'[]'):(colourProduced||[]);
        if (Array.isArray(cp)) cp.forEach(c=>{ prodMap[c.colour||'Default']=(prodMap[c.colour||'Default']||0)+Number(c.produced||0); });
      } catch(_){}
      if (!Object.keys(planMap).length) planMap['Default']=totalPlanQty||0;
      const all=new Set([...Object.keys(planMap),...Object.keys(prodMap)]);
      return Array.from(all).map(colour=>({
        colour,
        planQty:planMap[colour]||0,
        produced:prodMap[colour]||0,
        bal:Math.max(0,(planMap[colour]||0)-(prodMap[colour]||0))
      })).sort((a,b)=>a.colour.localeCompare(b.colour));
    }

    /* ==================== EDIT LOGIC (Detailed) ==================== */
    let editRejItems = [];
    let editDtItems = [];

    async function openEdit(uid, s, r, d, rem, col, rBkStr, dBkStr, planId, orderNo, mouldNo) {
      el('edit-id').value = uid;
      el('edit-shots').value = s;
      el('edit-remarks').value = rem;
      el('edit-error').textContent = '';

      // Colour Logic
      const cSel = el('edit-colour');
      cSel.innerHTML = '<option value="">Loading...</option>';

      let colorsLoaded = false;

      // 1. Check if same as active job (Optimization)
      if (session.activeJob && (planId === session.activeJob.PlanID)) {
        // Copy from main d-color (which is already loaded)
        if (el('d-color').innerHTML) {
          cSel.innerHTML = el('d-color').innerHTML;
          colorsLoaded = true;
        }
      }

      // 2. If not loaded (different job or d-color empty), fetch
      if (!colorsLoaded) {
        try {
          const url = `/api/job/colors?plan_id=${encodeURIComponent(planId)}&or_jr_no=${encodeURIComponent(orderNo)}&mould_no=${encodeURIComponent(mouldNo)}`;
          const res = await apiFetch(url);
          const json = await res.json();

          cSel.innerHTML = ''; // limited cleanup
          if (json.ok && json.data && json.data.length) {
            json.data.forEach(c => {
              // Format: "Red" or "Red - ItemCode"
              const name = c.name || c.code;
              cSel.add(new Option(name, name));
            });
          } else {
            // Fallback: If legacy data has a colour but no API result, add it
            if (col) cSel.add(new Option(col, col));
            else cSel.add(new Option('Default', ''));
          }
        } catch (e) {
          console.error('Edit Color Fetch Error', e);
          cSel.innerHTML = '<option value="">Error loading colors</option>';
          if (col) cSel.add(new Option(col, col));
        }
      }

      // Set value (must verify if option exists, otherwise simple set might fail if strict?) 
      // HTML Select will accept value setting even if not in list? No, it selects empty.
      // So we ensure the 'col' exists if it's not in the list.
      // Actually, after populate, just set it.

      let found = false;
      for (let i = 0; i < cSel.options.length; i++) {
        if (cSel.options[i].value === col) found = true;
      }
      if (!found && col) {
        // Add it as preserved option
        const op = new Option(col + ' (Preserved)', col);
        cSel.add(op, 0); // Add at top
      }
      cSel.value = col || '';

      // Rejections
      editRejItems = [];
      try {
        const rb = JSON.parse(rBkStr || '{}');
        Object.keys(rb).forEach(k => {
          let code = k;
          let otherText = '';
          if (k.startsWith('OTHER_')) {
            code = 'OTHER';
            otherText = k.replace('OTHER_', '');
          }
          // Find text map
          const f = REJECT_REASONS.find(x => x[0] === code);
          editRejItems.push({ code: code, qty: rb[k], text: f ? f[1] : '', otherText });
        });
      } catch (e) { console.error(e); }
      // If none but qty exists? (Legacy). Just add generic?
      if (editRejItems.length === 0 && Number(r) > 0) {
        editRejItems.push({ code: REJECT_REASONS[0][0], qty: Number(r), text: REJECT_REASONS[0][1], otherText: '' });
      }
      renderEditRej();

      // Downtime
      editDtItems = [];
      try {
        const db = JSON.parse(dBkStr || '{}');
        Object.keys(db).forEach(k => {
          let code = k;
          let otherText = '';
          if (k.startsWith('OTHER_')) {
            code = 'OTHER';
            otherText = k.replace('OTHER_', '');
          }
          const f = DOWNTIME_REASONS.find(x => x[0] === code);
          editDtItems.push({ code: code, min: db[k], text: f ? f[1] : '', otherText });
        });
      } catch (e) { console.error(e); }
      if (editDtItems.length === 0 && Number(d) > 0) {
        editDtItems.push({ code: DOWNTIME_REASONS[0][0], min: Number(d), text: DOWNTIME_REASONS[0][1], otherText: '' });
      }
      renderEditDt();

      recalcEdit();
      show('modal-edit');
    }

    async function deleteEntry(uid) {
      if (!confirm('Are you sure you want to delete this hourly entry? It will be removed from all reports.')) return;
      try {
        const res = await apiFetch('/api/dpr/delete', {
          method: 'POST',
          body: JSON.stringify({ id: uid, session: { username: session.username } })
        });
        const json = await res.json();
        if (json.ok) {
          showNotify('Entry deleted successfully', 'success');
          loadRecent(); // Refresh list
          // Also refresh summary modal if open
          if (!el('modal-job-summary').classList.contains('hidden')) {
            loadJobSummary();
          }
        } else {
          showNotify('Delete failed: ' + json.error, 'error');
        }
      } catch (e) {
        showNotify('Network error: ' + e.message, 'error');
      }
    }

    function addEditRejItem() {
      editRejItems.push({ qty: '', code: REJECT_REASONS[0][0], text: REJECT_REASONS[0][1], otherText: '' });
      renderEditRej();
    }

    function addEditDtItem() {
      editDtItems.push({ min: '', code: DOWNTIME_REASONS[0][0], text: DOWNTIME_REASONS[0][1], otherText: '' });
      renderEditDt();
    }

    function renderEditRej() {
      const wrap = el('edit-rej-list'); wrap.innerHTML = '';
      editRejItems.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'chip';
        // Qty
        const q = document.createElement('input');
        q.type = 'number'; q.className = 'short'; q.style.width = '70px';
        q.value = it.qty; q.placeholder = 'Qty';
        q.oninput = () => { it.qty = q.value; recalcEdit(); };

        // Select
        const s = document.createElement('select');
        REJECT_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c)));
        s.value = it.code || '';

        const oInp = document.createElement('input');
        oInp.type = 'text'; oInp.placeholder = 'Please specify...'; oInp.style.width = '120px';
        oInp.value = it.otherText || '';
        oInp.oninput = () => { it.otherText = oInp.value; recalcEdit(); };
        oInp.style.display = it.code === 'OTHER' ? 'inline-block' : 'none';

        s.onchange = () => {
          it.code = s.value;
          oInp.style.display = it.code === 'OTHER' ? 'inline-block' : 'none';
        };

        // Remove
        const rm = document.createElement('button'); rm.className = 'small'; rm.textContent = '✕';
        rm.onclick = () => { editRejItems.splice(i, 1); renderEditRej(); };

        d.append(q, s, oInp, rm); wrap.appendChild(d);
      });
      recalcEdit();
    }

    function renderEditDt() {
      const wrap = el('edit-dt-list'); wrap.innerHTML = '';
      editDtItems.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'chip';
        // Min
        const q = document.createElement('input');
        q.type = 'number'; q.className = 'short'; q.style.width = '70px';
        q.value = it.min; q.placeholder = 'Min';
        q.oninput = () => { it.min = q.value; recalcEdit(); };

        const s = document.createElement('select');
        DOWNTIME_REASONS.forEach(([c, t]) => s.add(new Option(`${c} - ${t}`, c)));
        s.value = it.code || '';

        const oInp = document.createElement('input');
        oInp.type = 'text'; oInp.placeholder = 'Please specify...'; oInp.style.width = '120px';
        oInp.value = it.otherText || '';
        oInp.oninput = () => { it.otherText = oInp.value; recalcEdit(); };
        oInp.style.display = it.code === 'OTHER' ? 'inline-block' : 'none';

        s.onchange = () => {
          it.code = s.value;
          oInp.style.display = it.code === 'OTHER' ? 'inline-block' : 'none';
        };

        const rm = document.createElement('button'); rm.className = 'small'; rm.textContent = '✕';
        rm.onclick = () => { editDtItems.splice(i, 1); renderEditDt(); };

        d.append(q, s, oInp, rm); wrap.appendChild(d);
      });
      recalcEdit();
    }

    function recalcEdit() {
      const shots = Number(el('edit-shots').value || 0);
      const rej = editRejItems.reduce((acc, i) => acc + Number(i.qty || 0), 0);
      const dt = editDtItems.reduce((acc, i) => acc + Number(i.min || 0), 0);

      el('edit-rej-total').textContent = rej;
      el('edit-dt-total').textContent = dt;

      el('edit-good').value = Math.max(0, shots - rej);
    }

    function saveEdit() {
      const shots = el('edit-shots').value;
      const rej = el('edit-rej-total').textContent; // Calculated
      const dt = el('edit-dt-total').textContent;   // Calculated

      // Build Breakup Objects
      const getFinalCode = (i) => i.code === 'OTHER' && i.otherText ? `OTHER_${i.otherText.trim()}` : i.code;

      const rejObj = {};
      editRejItems.forEach(i => { if (Number(i.qty) > 0) rejObj[getFinalCode(i)] = Number(i.qty); });

      const dtObj = {};
      editDtItems.forEach(i => { if (Number(i.min) > 0) dtObj[getFinalCode(i)] = Number(i.min); });

      const p = {
        uniqueId: el('edit-id').value,
        newShots: shots,
        newReject: rej,
        newDowntime: dt,
        newRemarks: el('edit-remarks').value,
        newColour: el('edit-colour').value,
        newRejBreakup: rejObj,
        newDtBreakup: dtObj
      };

      const btn = document.querySelector('#modal-edit .primary');
      const txt = btn.innerText; btn.innerText = 'Updating...'; btn.disabled = true;

      apiFetch('/api/dpr/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: { username: session.username, line: session.line },
          payload: p
        })
      })
        .then(r => r.json())
        .then(r => {
          btn.innerText = txt; btn.disabled = false;
          if (r && r.ok) { hide('modal-edit'); loadRecent(); }
          else { el('edit-error').textContent = (r && r.error) || 'Update failed.'; }
        })
        .catch(err => {
          btn.innerText = txt; btn.disabled = false;
          el('edit-error').textContent = String(err);
        });
    }

    /* ==================== Utils ==================== */
    async function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }

    function openCameraForComplete() {
      const input = el('complete-img');
      if (!input) return;
      input.click();
    }

    document.addEventListener('DOMContentLoaded', () => {
      const completeImg = el('complete-img');
      if (completeImg) {
        completeImg.addEventListener('change', () => {
          const span = el('complete-file-name');
          if (!span) return;
          const f = completeImg.files && completeImg.files[0];
          span.textContent = f ? ('Selected: ' + f.name) : '';
        });
      }
    });

    async function completeJob() {
      const job = session.activeJob;
      const msgEl = el('complete-msg');
      msgEl.textContent = '';

      if (!job) {
        msgEl.innerHTML = '<span class="err">Open Queue and select the first job.</span>';
        return;
      }

      if (!confirm('Are you sure you want to Complete this Job? It will be sent for Approval.')) return;

      msgEl.textContent = 'Completing job...';
      showLoading();

      // Robust PlanID lookup
      const planId = job.PlanID || job.plan_id || job.id || (job._all && job._all.plan_id);

      if (!planId) {
        msgEl.innerHTML = '<span class="err">Error: Job ID (PlanID) is missing on technical object. Reload queue.</span>';
        console.error('Missing PlanID in job:', job);
        hideLoading(); // early return must not leave "Processing…" stuck on screen
        return;
      }

      // New Endpoint: /api/job/supervisor-complete
      // Payload: { planId, username }
      apiFetch('/api/job/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: String(planId),
          PlanID: String(planId), // Redundant key for safety
          username: session.username
        })
      })
        .then(r => r.json())
        .then(r => {
          if (r && r.ok) {
            msgEl.innerHTML = '<span class="ok">Job Completed. Pending Approval.</span>';
            el('complete-action').value = '';
            // el('complete-img').value = '';

            // Refresh everything immediately via a strict page reload
            window.location.reload();
          } else {
            msgEl.innerHTML = '<span class="err">' + ((r && r.error) || 'Failed to complete job.') + '</span>';
          }
        })
        .catch(err => {
          msgEl.innerHTML = '<span class="err">' + String(err) + '</span>';
        })
        .finally(() => hideLoading());
    }

    /* SWITCH JOB — cycles through P1→P2→P3→P4→P1 priority plans on this machine */
    function switchJob() {
      const machine = session.machine || (el('dd-machine') && el('dd-machine').value) || '';
      const msgEl = el('complete-msg');
      msgEl.textContent = '';

      if (!machine) {
        msgEl.innerHTML = '<span class="err">No machine selected.</span>';
        return;
      }
      if (!confirm('Switch to the next priority job (P1→P2→P3→P4→P1) on this machine?')) return;

      msgEl.textContent = 'Switching job...';
      showLoading();

      apiFetch('/api/planning/switch-priority-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine })
      })
        .then(r => r.json())
        .then(r => {
          if (r && r.ok) {
            const p = r.activated || {};
            msgEl.innerHTML = `<span class="ok">Switched to ${p.machine_priority || 'next job'}: ${p.order_no || ''}.</span>`;
            loadQueue();
          } else {
            msgEl.innerHTML = `<span class="err">${(r && r.error) || 'Failed to switch job.'}</span>`;
          }
        })
        .catch(err => { msgEl.innerHTML = `<span class="err">${String(err)}</span>`; })
        .finally(() => hideLoading());
    }

    /* MACHINE MAINTENANCE */
    /* MAINTENANCE & SHORTAGE */
    function openMaintenanceMenu() {
      show('modal-quick-actions');
    }

    function handleQuickAction(type) {
      hide('modal-quick-actions');
      openDowntimeModal(type);
    }

    function openDowntimeModal(type) {
      currentMcEntryType = type;
      mcDt = [];
      const isAdmin = (session.role_code === 'admin' || session.role_code === 'superadmin' || session.username === 'admin');
      const dSlot = el('d-slot');
      const mcSlot = el('mc-slot');

      // Populate mc-slot explicitly
      // For Admins or ALL Quick Actions, we now show yesterday's slots
      // Also, we disable hiding filled slots (hideFilled = false) to ensure all historical context is selectable
      fillHourSlotSelect('mc-slot', (dSlot ? dSlot.value : null), false);

      if (dSlot && mcSlot) {
        // If mc-slot was filled, it should already have the value from dSlot if it exists
        // But let's ensure it copies the value if fillHourSlotSelect didn't handle it
        if (!mcSlot.value && dSlot.value) mcSlot.value = dSlot.value;
      }

      // Determine Code
      let reasonCode = DOWNTIME_REASONS[0][0];
      // We need to match text or assuming codes
      // Let's try to find them by text content
      if (type === 'Maintenance') {
        const f = DOWNTIME_REASONS.find(r => r[1].toLowerCase().includes('maintenance'));
        if (f) reasonCode = f[0];
      } else if (type === 'ManPowerShortage') {
        const f = DOWNTIME_REASONS.find(r => r[1].toLowerCase().includes('man power') || r[1].includes('Shortage'));
        if (f) reasonCode = f[0];
      } else if (type === 'MouldChangeover') {
        const f = DOWNTIME_REASONS.find(r => r[1].toLowerCase().includes('mould change') || r[1].toLowerCase().includes('tool change'));
        if (f) reasonCode = f[0];
      } else if (type === 'MouldTrial') {
        const f = DOWNTIME_REASONS.find(r => r[0] === '11' || r[1].toLowerCase().includes('mould trial'));
        if (f) reasonCode = f[0];
      } else if (type === 'MouldMaintenance') {
        reasonCode = '7'; // Mapped to Mould Problem
      } else if (type === 'PowerCut') {
        reasonCode = '8'; // Mapped to Power Failure/Pre Heating
      } else if (type === 'NoPlan') {
        reasonCode = '13'; // Now mapped to 13
      }

      mcDt.push({ min: 60, code: reasonCode, text: type, otherText: '' });
      mcRender();

      el('mc-dt-total').textContent = '60';
      el('mc-errors').innerHTML = '';
      el('mc-msg').textContent = '';

      const titleEl = el('mc-title');
      if (titleEl) {
        if (type === 'Maintenance') titleEl.textContent = 'Record Maintenance';
        else if (type === 'ManPowerShortage') titleEl.textContent = 'Record MP Shortage';
        else if (type === 'MouldChangeover') titleEl.textContent = 'Record Mould Changeover';
        else if (type === 'MouldTrial') titleEl.textContent = 'Record Mould Trial';
        else if (type === 'MouldMaintenance') titleEl.textContent = 'Record Mould Maintenance';
        else if (type === 'NoPlan') titleEl.textContent = 'Record No Plan Status';
      }

      show('modal-mc');
    }

    /* Global JS error surface */
    window.addEventListener('error', e => {
      const s = el('submit-errors'); if (s) { s.textContent = 'Script error: ' + e.message; }
    });

    /* ---- Live Tab Sync -------------------------------------------------- */
    // Throttle: ignore events that arrive within 30 s of the last refresh.
    // Rapid DPR saves by coworkers used to fire loadMachines() every few seconds,
    // clearing the machine dropdown and resetting the active job — very disruptive.
    var _liveRefreshLastAt = 0;
    var _LIVE_REFRESH_MIN_MS = 30000; // at most once every 30 s

    window.addEventListener('jpsms:live-refresh', function (e) {
      var mod = (e.detail || {}).module;
      if (['planning', 'dpr', 'qc'].indexOf(mod) === -1) return;

      var now = Date.now();
      if (now - _liveRefreshLastAt < _LIVE_REFRESH_MIN_MS) return; // throttle
      _liveRefreshLastAt = now;

      // Do NOT call loadMachines() — it clears the machine dropdown to "Loading…",
      // resets session.activeJob, and hides the DPR form mid-entry.
      // Only refresh the recent-entries panel (non-disruptive) unless a modal is open.
      var dprForm = document.getElementById('dpr-form');
      var formVisible = dprForm && !dprForm.classList.contains('hidden');
      if (!formVisible && typeof loadRecent === 'function') {
        loadRecent();
      }
    });
    /* --------------------------------------------------------------------- */