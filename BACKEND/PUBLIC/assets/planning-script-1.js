  (function () {
    'use strict';

    /* ── column constants (keep in sync with JS below) ── */
    const MACH_W = 190; /* machine column px */
    const SLOT_W = 210; /* each slot column px — wider so full OR numbers fit */

    /* ── CSS — LIGHT THEME ───────────────────────────────────────────── */
    const css = `
      /* ════════════════════════════════════════════════════════════════
         EXCEL VIEW TIMELINE  —  Clean Light Theme
         Width fix: table pixel width set in JS (MACH_W + N*SLOT_W)
      ════════════════════════════════════════════════════════════════ */

      #etv-wrap {
        font-family: -apple-system, "Segoe UI Variable", Inter, "Segoe UI", sans-serif;
        background: #f4f7fb;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid #dce4f0;
        box-shadow: 0 4px 24px rgba(15,23,42,.08);
      }

      /* ── Filter bar ── */
      #etv-filters {
        position: sticky;
        top: 0;
        z-index: 200;
        background: #fff;
        border-bottom: 2px solid #e8eef8;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 9px;
        box-shadow: 0 2px 8px rgba(15,23,42,.06);
      }
      #etv-filters .etv-row { display: flex; align-items: center; gap: 8px; }
      #etv-filters .etv-row-title { justify-content: space-between; }

      /* Smart Suggestions button */
      #etv-smart-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer;
        font-size: .72rem; font-weight: 800; letter-spacing: .03em; color: #fff;
        background: linear-gradient(90deg, #7c3aed 0%, #2563eb 100%);
        box-shadow: 0 2px 6px rgba(124,58,237,.25); transition: filter .15s, transform .1s;
      }
      #etv-smart-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
      #etv-smart-btn:active { transform: translateY(0); }
      #etv-smart-badge {
        background: #fff; color: #7c3aed; border-radius: 10px;
        font-size: .62rem; font-weight: 900; padding: 1px 7px; margin-left: 2px;
      }

      /* Create Priority / Saved Priorities buttons */
      #etv-priority-btn, #etv-saved-priority-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer;
        font-size: .72rem; font-weight: 800; letter-spacing: .03em; color: #fff;
        transition: filter .15s, transform .1s;
      }
      #etv-priority-btn { background: linear-gradient(90deg, #16a34a 0%, #0d9488 100%); box-shadow: 0 2px 6px rgba(13,148,136,.25); }
      #etv-saved-priority-btn { background: #475569; box-shadow: 0 2px 6px rgba(71,85,105,.22); }
      #etv-priority-btn:hover, #etv-saved-priority-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
      #etv-priority-btn:active, #etv-saved-priority-btn:active { transform: translateY(0); }
      #etv-priority-btn.active { background: linear-gradient(90deg, #dc2626 0%, #b45309 100%); }

      /* Priority selection mode: pickable plan cards + order badge */
      #etv-table.etv-priority-mode .etv-plan-cell:not(.etv-empty) { cursor: copy; }
      #etv-table.etv-priority-mode .etv-plan-cell:not(.etv-empty):hover .etv-card { outline: 2px dashed #0d9488; outline-offset: -2px; }
      .etv-card.etv-prio-picked { outline: 2.5px solid #16a34a !important; outline-offset: -2px; box-shadow: 0 0 12px rgba(22,163,74,.45) !important; }
      .etv-prio-order-badge {
        position: absolute; top: -8px; left: -8px; z-index: 5;
        min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px;
        background: #16a34a; color: #fff; font-size: .68rem; font-weight: 900;
        display: inline-flex; align-items: center; justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,.3);
      }

      /* Priority side panel */
      #etv-prio-panel {
        position: fixed; top: 0; right: 0; bottom: 0; width: 360px; z-index: 6100;
        background: #fff; box-shadow: -4px 0 24px rgba(15,23,42,.18);
        display: flex; flex-direction: column; transform: translateX(100%); transition: transform .25s;
      }
      #etv-prio-panel.open { transform: translateX(0); }
      #etv-prio-panel .pp-head { padding: 14px 16px; background: #0f172a; color: #fff; }
      #etv-prio-panel .pp-head h3 { margin: 0; font-size: .95rem; font-weight: 800; display: flex; align-items: center; gap: 8px; }
      #etv-prio-panel .pp-head .pp-sub { font-size: .72rem; color: #cbd5e1; margin-top: 4px; }
      #etv-prio-panel .pp-body { flex: 1; overflow-y: auto; padding: 10px 12px; }
      #etv-prio-panel .pp-foot { padding: 12px 16px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
      .pp-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 7px; background: #fff; }
      .pp-item .pp-sr { width: 22px; height: 22px; border-radius: 50%; background: #16a34a; color: #fff; font-size: .7rem; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
      .pp-item .pp-info { flex: 1; min-width: 0; }
      .pp-item .pp-mach { font-size: .76rem; font-weight: 800; color: #1e293b; }
      .pp-item .pp-mould { font-size: .68rem; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pp-item .pp-mp { font-size: .72rem; font-weight: 800; color: #0d9488; flex: 0 0 auto; }
      .pp-item .pp-moveup, .pp-item .pp-movedn, .pp-item .pp-rm { border: none; background: #f1f5f9; color: #475569; border-radius: 6px; cursor: pointer; width: 22px; height: 22px; font-size: .72rem; display: inline-flex; align-items: center; justify-content: center; }
      .pp-item .pp-rm:hover { background: #fee2e2; color: #dc2626; }
      .pp-total { display: flex; justify-content: space-between; align-items: center; font-size: .85rem; font-weight: 800; color: #1e293b; margin-bottom: 10px; }
      .pp-total strong { color: #0d9488; font-size: 1.05rem; }
      .pp-btn { width: 100%; padding: 9px; border-radius: 8px; border: none; cursor: pointer; font-weight: 800; font-size: .8rem; margin-top: 6px; }
      .pp-btn.save { background: #2563eb; color: #fff; }
      .pp-btn.savepdf { background: #16a34a; color: #fff; }
      .pp-btn.cancel { background: #e2e8f0; color: #475569; }
      .pp-btn:disabled { opacity: .5; cursor: not-allowed; }

      /* Generic priority modal (date/shift + saved list) */
      #etv-prio-modal { position: fixed; inset: 0; z-index: 6200; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
      #etv-prio-modal .pm-box { background: #fff; border-radius: 12px; width: 100%; max-width: 560px; max-height: 86vh; overflow: hidden; display: flex; flex-direction: column; }
      #etv-prio-modal .pm-head { padding: 14px 18px; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: space-between; }
      #etv-prio-modal .pm-head h3 { margin: 0; font-size: 1rem; font-weight: 800; }
      #etv-prio-modal .pm-body { padding: 18px; overflow-y: auto; }
      #etv-prio-modal label { display: block; font-size: .78rem; font-weight: 700; color: #475569; margin-bottom: 5px; }
      #etv-prio-modal input, #etv-prio-modal select { width: 100%; padding: 9px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: .85rem; margin-bottom: 14px; }
      #etv-prio-modal .pm-close { background: transparent; border: none; color: #fff; font-size: 1.3rem; cursor: pointer; }
      .pm-saved-row { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px; }
      .pm-saved-row .pm-saved-info { flex: 1; min-width: 0; }
      .pm-saved-row .pm-saved-title { font-size: .8rem; font-weight: 800; color: #1e293b; }
      .pm-saved-row .pm-saved-meta { font-size: .7rem; color: #64748b; }

      /* Smart Suggestions overlay */
      #etv-suggest-overlay {
        position: fixed; inset: 0; z-index: 6000; background: rgba(15,23,42,.45);
        display: flex; align-items: flex-start; justify-content: center; padding: 5vh 16px;
      }
      #etv-suggest-modal {
        background: #fff; width: 100%; max-width: 640px; max-height: 86vh; overflow: hidden;
        border-radius: 14px; box-shadow: 0 20px 60px rgba(15,23,42,.35);
        display: flex; flex-direction: column;
      }
      .etv-sg-head {
        padding: 14px 18px; background: linear-gradient(90deg, #7c3aed 0%, #2563eb 100%); color: #fff;
        display: flex; align-items: center; justify-content: space-between;
      }
      .etv-sg-head h3 { margin: 0; font-size: .98rem; font-weight: 900; letter-spacing: .03em; display:flex; align-items:center; gap:8px; }
      .etv-sg-head button { background: rgba(255,255,255,.2); border: none; color: #fff; width: 28px; height: 28px; border-radius: 7px; cursor: pointer; font-size: 1rem; font-weight: 800; }
      .etv-sg-sub { padding: 10px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: .76rem; color: #475569; display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .etv-sg-body { padding: 12px 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
      .etv-sg-card {
        border: 1px solid #e2e8f0; border-left: 4px solid #7c3aed; border-radius: 10px; padding: 11px 13px;
        display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; background: #fff;
      }
      .etv-sg-card.cross { border-left-color: #2563eb; }
      .etv-sg-card.reorder { border-left-color: #f59e0b; }
      .etv-sg-card .sg-txt { flex: 1; min-width: 0; }
      .etv-sg-card .sg-mould { font-weight: 800; color: #1e293b; font-size: .82rem; }
      .etv-sg-card .sg-detail { font-size: .73rem; color: #475569; margin-top: 3px; line-height: 1.4; }
      .etv-sg-card .sg-save { display:inline-block; margin-top:5px; font-size: .66rem; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 1px 7px; border-radius: 6px; }
      .etv-sg-apply { flex-shrink: 0; align-self: center; padding: 6px 13px; border-radius: 7px; border: none; cursor: pointer; font-size: .72rem; font-weight: 800; color: #fff; background: #2563eb; }
      .etv-sg-apply:hover { filter: brightness(1.08); }
      .etv-sg-apply:disabled { opacity: .5; cursor: default; }
      .etv-sg-foot { padding: 12px 18px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; gap: 10px; background:#f8fafc; }
      .etv-sg-applyall { padding: 8px 18px; border-radius: 8px; border: none; cursor: pointer; font-size: .78rem; font-weight: 800; color: #fff; background: linear-gradient(90deg, #7c3aed 0%, #2563eb 100%); }
      .etv-sg-applyall:hover { filter: brightness(1.08); }
      .etv-sg-empty { padding: 30px 18px; text-align: center; color: #16a34a; font-weight: 700; font-size: .88rem; }
      .etv-sg-empty i { font-size: 2rem; display: block; margin-bottom: 8px; }
      .etv-sg-joybtn { flex-shrink:0; padding: 5px 12px; border-radius: 7px; border: none; cursor: pointer; font-size: .72rem; font-weight: 800; color: #fff; background: linear-gradient(90deg,#7c3aed,#2563eb); display:inline-flex; align-items:center; gap:5px; }
      .etv-sg-joybtn:hover { filter: brightness(1.08); }
      .etv-sg-joybtn:disabled { opacity: .6; cursor: default; }
      .etv-joy-box { margin: 0 16px 4px; padding: 11px 13px; background: linear-gradient(135deg,#faf5ff,#eff6ff); border: 1px solid #ddd6fe; border-radius: 10px; }
      .etv-joy-box .joy-loading { font-size: .8rem; color: #7c3aed; font-weight: 700; display:flex; align-items:center; gap:7px; }
      .etv-joy-box .joy-head { margin-bottom: 5px; }
      .etv-joy-box .joy-tag { font-size: .66rem; font-weight: 800; color: #6d28d9; background: #ede9fe; border: 1px solid #ddd6fe; padding: 1px 8px; border-radius: 20px; }
      .etv-joy-box .joy-tag.local { color: #475569; background: #f1f5f9; border-color: #cbd5e1; }
      .etv-joy-box .joy-msg { font-size: .78rem; color: #334155; line-height: 1.5; }
      #etv-filters .etv-row-filters { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
      #etv-filters .etv-row-filters::-webkit-scrollbar { height: 0; }
      #etv-filters .etv-title {
        font-size: .8rem;
        font-weight: 900;
        letter-spacing: .09em;
        text-transform: uppercase;
        color: #1d4ed8;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 13px;
        background: linear-gradient(135deg,#eff6ff,#dbeafe);
        border: 1.5px solid #93c5fd;
        border-radius: 8px;
        flex-shrink: 0;
      }
      #etv-filters .etv-title i { font-size: .92rem; }
      #etv-filters input,
      #etv-filters select {
        border: 1px solid #d4dce9;
        border-radius: 7px;
        padding: 0 9px;
        font-size: .8rem;
        color: #1e293b;
        background: #fff;
        outline: none;
        height: 32px;
        transition: border-color .15s, box-shadow .15s;
        flex-shrink: 0;
      }
      #etv-filters input:focus,
      #etv-filters select:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59,130,246,.12);
      }
      #etv-filters .etv-search-wrap {
        position: relative;
        width: 220px;
        flex-shrink: 0;
      }
      #etv-filters .etv-search-wrap i {
        position: absolute;
        left: 9px;
        top: 50%;
        transform: translateY(-50%);
        color: #94a3b8;
        font-size: .8rem;
        pointer-events: none;
      }
      #etv-filters .etv-search-wrap input { width: 100%; padding-left: 28px; }
      .etv-btn {
        border: 1px solid #d4dce9;
        background: #f8fafc;
        color: #475569;
        border-radius: 7px;
        padding: 0 10px;
        height: 32px;
        font-size: .76rem;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all .14s;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .etv-btn:hover { background: #e8eef8; border-color: #93a8c4; color: #0f172a; }
      .etv-btn.primary {
        background: #2563eb;
        color: #fff;
        border-color: transparent;
        box-shadow: 0 1px 6px rgba(37,99,235,.28);
      }
      .etv-btn.primary:hover { background: #1d4ed8; }

      /* ── Multi-select checkbox filter ── */
      .etv-ms { position: relative; flex-shrink: 0; }
      .etv-ms-btn {
        border: 1px solid #d4dce9;
        background: #fff;
        color: #475569;
        border-radius: 7px;
        padding: 0 10px;
        height: 32px;
        font-size: .76rem;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        transition: all .14s;
      }
      .etv-ms-btn:hover { background: #f1f5f9; border-color: #93a8c4; }
      .etv-ms-btn .etv-ms-count { color: #2563eb; font-weight: 800; }
      .etv-ms-btn .bi-chevron-down { font-size: .6rem; opacity: .6; }
      .etv-ms-panel {
        position: fixed;
        z-index: 4000;
        min-width: 180px;
        max-height: 320px;
        overflow-y: auto;
        background: #fff;
        border: 1px solid #d4dce9;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(15,23,42,.16);
        padding: 6px;
      }
      .etv-ms-opt-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 8px;
        font-size: .8rem;
        color: #334155;
        font-weight: 600;
        border-radius: 5px;
        cursor: pointer;
        margin: 0;
        white-space: nowrap;
      }
      .etv-ms-opt-row:hover { background: #f1f5f9; }
      .etv-ms-opt-row input { width: 15px; height: 15px; cursor: pointer; flex-shrink: 0; }
      .etv-ms-all { border-bottom: 1px solid #e2e8f0; margin-bottom: 4px; padding-bottom: 7px; color: #1e293b; }
      #etv-count {
        margin-left: auto;
        font-size: .72rem;
        font-weight: 700;
        color: #2563eb;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        padding: 3px 10px;
        border-radius: 20px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* ── Scroll area ── */
      #etv-scroll {
        overflow: auto;
        max-height: calc(100vh - 155px);
      }
      #etv-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
      #etv-scroll::-webkit-scrollbar-track { background: #f4f7fb; }
      #etv-scroll::-webkit-scrollbar-thumb { background: #c2cfe0; border-radius: 4px; }
      #etv-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

      /* ══════════════════════════════════════════════════════════════
         TABLE: width set in JS as (MACH_W + cols×SLOT_W)px
      ══════════════════════════════════════════════════════════════ */
      #etv-table {
        border-collapse: collapse;
        table-layout: fixed;
        background: #fff;
      }

      /* ── Building / Line group separator ── */
      .etv-group-hdr td {
        background: linear-gradient(90deg, #1e3a8a 0%, #2563eb 100%);
        color: #fff;
        font-size: .64rem;
        font-weight: 800;
        letter-spacing: .12em;
        text-transform: uppercase;
        padding: 7px 16px;
        border-top: 1px solid rgba(255,255,255,.12);
        border-bottom: 2px solid #1e40af;
        box-shadow: inset 4px 0 0 #60a5fa;
      }

      /* ── Sticky column header row ── */
      .etv-col-hdr th {
        background: linear-gradient(180deg,#f8fafc,#eef2f9);
        border-bottom: 2px solid #cbd5e1;
        border-right: 1px solid #e8eef8;
        padding: 0;
        height: 42px;
        vertical-align: middle;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .etv-col-hdr th.etv-mach-col {
        background: linear-gradient(180deg,#eef3fc,#e2eafa);
        position: sticky;
        left: 0;
        z-index: 20;
        border-right: 2px solid #2563eb;
      }
      .etv-col-inner {
        padding: 5px 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .etv-col-seq-label {
        font-size: .68rem;
        font-weight: 800;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: #1e293b;
      }
      .etv-col-seq-sub {
        font-size: .56rem;
        color: #64748b;
        font-weight: 600;
        letter-spacing: .02em;
      }

      /* ── Frozen machine column ── */
      .etv-mach-cell {
        background: #f0f5ff;
        padding: 0;
        position: sticky;
        left: 0;
        z-index: 5;
        border-right: 2px solid #2563eb;
        border-bottom: 1px solid #dce4f0;
        vertical-align: middle;
        cursor: pointer;
        transition: background .12s;
        overflow: hidden;
      }
      .etv-mach-cell:hover { background: #dbeafe; }
      .etv-mach-inner {
        padding: 5px 9px;
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-height: 50px;
        justify-content: center;
      }
      .etv-mach-code {
        font-size: .77rem;
        font-weight: 800;
        color: #1d4ed8;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .etv-mach-meta {
        font-size: .57rem;
        color: #6b7280;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: .06em;
      }
      .etv-mach-plans {
        font-size: .56rem;
        color: #9ca3af;
        font-weight: 500;
      }
      .etv-mach-load {
        display: inline-block;
        margin-top: 2px;
        font-size: .56rem;
        font-weight: 700;
        color: #1e40af;
        background: #dbeafe;
        border: 1px solid #93c5fd;
        padding: 1px 5px;
        border-radius: 4px;
        max-width: calc(100% - 4px);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .etv-mach-load.etv-mach-load-over {
        color: #b91c1c;
        background: #fee2e2;
        border-color: #fca5a5;
      }
      .etv-load-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-top: 3px;
        font-size: .54rem;
        font-weight: 800;
        color: #fff;
        background: #dc2626;
        border-radius: 4px;
        padding: 1px 5px;
        letter-spacing: .02em;
        animation: etvLoadPulse 1.6s ease-in-out infinite;
      }
      @keyframes etvLoadPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }

      /* ── Plan data cell ── */
      .etv-plan-cell {
        vertical-align: top;
        padding: 3px;
        border-right: 1px solid #edf2fa;
        border-bottom: 1px solid #edf2fa;
        background: #fff;
        cursor: pointer;
        transition: background .1s;
        overflow: hidden;
      }
      .etv-plan-cell:hover { background: #f0f6ff; }
      .etv-plan-cell.etv-empty { background: #fafbfd; cursor: default; }
      .etv-plan-cell.etv-empty:hover { background: #fafbfd; }

      /* ── Plan card ── */
      .etv-card {
        border-radius: 7px;
        padding: 7px 9px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        border: 1px solid #e5eaf3;
        border-left: 4px solid #cbd5e1;
        background: #fff;
        min-height: 64px;
        position: relative;
        transition: background 0.2s, border-color 0.2s, box-shadow .12s, transform .1s;
      }
      .etv-plan-cell:hover .etv-card { box-shadow: 0 4px 14px rgba(15,23,42,.12); transform: translateY(-1px); }
      .etv-card[draggable="true"] { cursor: grab; }
      .etv-card.etv-dragging { opacity: .4; cursor: grabbing; }
      /* slot-position badge (top-right of each card / empty cell) */
      .etv-slot-num {
        position: absolute; top: 3px; right: 4px;
        min-width: 15px; height: 15px; padding: 0 3px;
        display: inline-flex; align-items: center; justify-content: center;
        background: #1e3a8a; color: #fff; font-size: .55rem; font-weight: 800;
        border-radius: 8px; line-height: 1; z-index: 2; pointer-events: none;
      }
      .etv-empty-inner { position: relative; }
      .etv-empty-inner .etv-slot-num { background: #94a3b8; }
      /* P1-P4 machine priority buttons and badge on ETV cards */
      .etv-mp-badge {
        display: inline-block; font-size: 0.58rem; font-weight: 900;
        color: #fff; padding: 1px 5px; border-radius: 3px; margin-bottom: 2px;
      }
      .etv-mp-btns { display:flex; gap:2px; padding-top:3px; }
      .etv-mp-btn {
        flex: 1; font-size: 0.6rem; font-weight: 800; border-radius: 3px;
        padding: 2px 0; cursor: pointer; border-width: 1.5px; border-style: solid;
        background: #fff; transition: all 0.15s; line-height: 1;
      }
      .etv-mp-btn:hover { opacity: 0.8; }
      /* drop-target highlight while dragging */
      .etv-plan-cell.etv-drop-hot { background: #ecfdf5 !important; box-shadow: inset 0 0 0 2px #16a34a; }
      .etv-plan-cell.etv-drop-hot .etv-slot-num { background: #16a34a; transform: scale(1.15); transition: transform .1s; }
      .etv-card.running   { border-left-color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
      .etv-card.stopped   { border-left-color: #dc2626; background: #fef2f2; border-color: #fecaca; }
      .etv-card.planned   { border-left-color: #2563eb; background: #eff6ff; border-color: #bfdbfe; }
      .etv-card.completed { border-left-color: #7c3aed; background: #f5f3ff; border-color: #ddd6fe; }
      .etv-card.chg       { border-left-color: #c2410c; background: #fff3e6; border-color: #fdba74; }
      .etv-card-row1 { display:flex; justify-content:space-between; align-items:flex-start; gap:3px; }
      .etv-card-order {
        font-size: .8rem;
        font-weight: 800;
        color: #111827;
        overflow-wrap: anywhere;
        white-space: normal;
        flex: 1;
        min-width: 0;
        line-height: 1.25;
      }
      .etv-card-status {
        font-size: .53rem;
        font-weight: 800;
        text-transform: uppercase;
        padding: 1px 5px;
        border-radius: 4px;
        white-space: nowrap;
        flex-shrink: 0;
        letter-spacing: .04em;
      }
      .etv-card-status.running   { background: #dcfce7; color: #15803d; }
      .etv-card-status.stopped   { background: #fee2e2; color: #991b1b; }
      .etv-card-status.planned   { background: #dbeafe; color: #1d4ed8; }
      .etv-card-status.completed { background: #ede9fe; color: #6d28d9; }
      .etv-card-mould {
        font-size: .65rem;
        color: #374151;
        font-weight: 600;
        line-height: 1.25;
        /* wrap mould name nicely over up to 2 lines instead of cutting it off */
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        overflow-wrap: anywhere;
        word-break: break-word;
        white-space: normal;
      }
      .etv-card-client {
        font-size: .6rem;
        color: #6b7280;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .etv-card-qty {
        display: flex;
        gap: 6px;
        font-size: .6rem;
        font-weight: 600;
        color: #6b7280;
        margin-top: 1px;
      }
      .etv-card-qty .bal-pos  { color: #b45309; }
      .etv-card-qty .bal-done { color: #15803d; }
      .etv-card-chg-badge {
        position: absolute;
        top: 2px;
        right: 3px;
        font-size: .5rem;
        font-weight: 900;
        background: #fed7aa;
        color: #7c2d12;
        padding: 1px 3px;
        border-radius: 3px;
        letter-spacing: .04em;
      }
      .etv-card-time {
        font-size: .58rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 2px;
        margin-top: 1px;
      }
      .etv-card-est {
        font-size: .56rem;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-top: 2px;
        padding: 1px 5px;
        border-radius: 5px;
        line-height: 1.5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        cursor: help;
      }
      .etv-card-change {
        font-size: .62rem;
        font-weight: 800;
        color: #7c2d12;
        background: #ffedd5;
        border: 1px solid #fdba74;
        border-radius: 5px;
        padding: 2px 5px;
        margin-top: 2px;
        display: flex;
        align-items: center;
        gap: 4px;
        line-height: 1.2;
      }
      .etv-card-change strong { font-weight: 900; }
      .etv-card-urgent {
        animation: etvUrgentPulse 1.1s ease-in-out infinite;
      }
      @keyframes etvUrgentPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
        50%      { box-shadow: 0 0 0 3px rgba(220,38,38,.35); }
      }
      .etv-empty-inner {
        min-height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #e2e8f0;
        font-size: .56rem;
        letter-spacing: .1em;
        font-weight: 600;
      }

      /* ── Zebra stripes ── */
      #etv-table tbody tr:nth-child(even) .etv-plan-cell       { background: #f8faff; }
      #etv-table tbody tr:nth-child(even) .etv-plan-cell.etv-empty { background: #f6f8fc; }
      #etv-table tbody tr:nth-child(even) .etv-mach-cell        { background: #e8f0ff; }
      #etv-table tbody tr:nth-child(even) .etv-plan-cell:hover  { background: #eaf3ff; }

      /* ── Legend ── */
      #etv-legend {
        display: flex;
        gap: 14px;
        align-items: center;
        padding: 7px 14px;
        background: #fff;
        border-top: 1px solid #e8eef8;
        flex-wrap: wrap;
      }
      .etv-legend-dot {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: .69rem;
        font-weight: 600;
        color: #4b5563;
      }
      .etv-legend-dot::before {
        content: '';
        display: block;
        width: 9px;
        height: 9px;
        border-radius: 2px;
        flex-shrink: 0;
      }
      .etv-legend-dot.running::before  { background: #16a34a; }
      .etv-legend-dot.stopped::before  { background: #dc2626; }
      .etv-legend-dot.planned::before  { background: #2563eb; }
      .etv-legend-dot.chg::before      { background: #c2410c; }
      .etv-legend-dot.empty::before    { background: #e2e8f0; border: 1px solid #cbd5e1; }
    `;
    const styleEl = document.createElement('style');
    styleEl.id = 'etv-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    /* ── Helpers ─────────────────────────────────────────────────────── */
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    // Strip "BUILDING -L{n}>" prefix from machine codes so display is always clean
    // e.g. "B -L1>AKAR-150-4" → "AKAR-150-4"; "AKAR-150-4" → "AKAR-150-4" (no-op)
    const stripMachPfx = s => { const t = String(s || '').trim(); return t.includes('>') ? t.split('>').pop().trim() : t; };
    const fmt = ms => {
      if (!Number.isFinite(ms) || ms <= 0) return '';
      const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
      if (d > 0) return `${d}d ${h}h`; if (h > 0) return `${h}h ${m}m`; return `${Math.max(1,m)}m`;
    };
    const fmtQty = n => Number(n || 0).toLocaleString();
    /* normalized mould identifier — tolerant to mouldNo/mould_code/mouldName variants */
    const mouldKey = p => String((p && (p.mouldNo || p.mould_code || p.mouldName || p.mould_name)) || '').trim().toUpperCase();
    const getProcFilter = () => (typeof window.getPlanningProcessFilter === 'function') ? window.getPlanningProcessFilter() : 'Moulding';
    const getApi = () => (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : window.api;
    /* Look up the recency-weighted cycle-time prediction for a plan.
       Prefers the exact mould+machine pair, falls back to a mould-only average. */
    const etvSimp = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    function etvPred(p, machCode) {
      const cp = window._etvCyclePred; if (!cp) return null;
      const mk = etvSimp((p && (p.mouldNo || p.mould_code || p.mouldName || p.mould_name)) || '');
      if (!mk) return null;
      const mc = etvSimp(stripMachPfx(machCode || (p && p.machine) || ''));
      return (mc && cp.pair[mk + '||' + mc]) || cp.mould[mk] || null;
    }

    /* ── State ───────────────────────────────────────────────────────── */
    let etvMachines = [];  // [{code, _finalBuilding, _finalLine, ...}]
    let etvGroups   = {};  // { machineCode: plans[] }

    /* ── Main loader ─────────────────────────────────────────────────── */
    window.loadExcelTimeline = async function () {
      const wrap = document.getElementById('excelTimelineView');
      if (!wrap) return;

      // Render skeleton immediately
      wrap.innerHTML = `
        <div id="etv-wrap">
          <div id="etv-filters" style="justify-content:center; padding:20px;">
            <div class="spinner-border text-primary spinner-border-sm"></div>
            <span style="margin-left:10px; color:#64748b; font-size:.9rem; font-weight:600">Loading Excel View…</span>
          </div>
        </div>`;

      try {
        const api = getApi();
        const proc = getProcFilter();
        const q = `process=${encodeURIComponent(proc)}`;
        const [mRes, pRes, mouldRes] = await Promise.all([
          api.get(`/masters/machines?${q}`),
          api.get(`/planning/board?${q}`),
          api.get(`/masters/moulds`).catch(() => null)
        ]);

        /* ── Build manpower lookup from Mould Master (by mould name + number) ── */
        try {
          window.etvManpowerMap = {};
          const simpKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const moulds = (mouldRes && mouldRes.data) ? mouldRes.data : [];
          moulds.forEach(md => {
            const mp = (md.manpower == null || md.manpower === '') ? null : Number(md.manpower);
            if (mp == null || Number.isNaN(mp)) return;
            const byName = simpKey(md.mould_name);
            const byNo   = simpKey(md.mould_number);
            if (byName) window.etvManpowerMap['N:' + byName] = mp;
            if (byNo)   window.etvManpowerMap['#:' + byNo] = mp;
          });
        } catch (e) { console.warn('[ExcelTimeline] manpower map failed', e); }

        /* ── Reuse superLoadTimeline data if already loaded ── */
        if (window.timelineMachines && window.timelineMachines.length &&
            window.timelineGroups && Object.keys(window.timelineGroups).length) {
          etvMachines = window.timelineMachines;
          etvGroups   = window.timelineGroups;
        } else {
          /* ── Build from scratch (same logic as superLoadTimeline) ── */
          const rawMachines = ((mRes && mRes.data) ? mRes.data : []);
          const plans = ((pRes && pRes.data && pRes.data.plans) ? pRes.data.plans : []);

          const simplify = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
          const machMap = {};
          rawMachines.forEach(m => {
            // Use the stripped code as the map key so that plans referencing either the
            // prefixed form ("B -L1>AKAR-150-4") or the clean form ("AKAR-150-4") both
            // land in the same machine bucket.
            const rawCode = m.machine || m.code || '';
            const code = stripMachPfx(rawCode);
            machMap[code] = { code, building: m.building || proc, line: m.line || 'Machines', machine_process: m.machine_process || proc, is_active: m.is_active !== false };
          });

          /* group plans */
          const byMach = {};
          plans.filter(p => p.machine && p.machine.trim() !== '-').forEach(p => {
            const raw = String(p.machine||'').trim();
            const parts = raw.split('>');
            const mName = parts.pop().trim();
            const simM = simplify(mName);
            let key = '';
            for (const k of Object.keys(machMap)) {
              if (simplify(k) === simM || simplify(k) === simplify(raw)) { key = k; break; }
            }
            if (!key) { key = mName; if (!machMap[key]) machMap[key] = { code:key, building:'?', line:'?', machine_process:proc }; }
            p._excelMachKey = key;
            if (!byMach[key]) byMach[key] = [];
            byMach[key].push(p);
          });

          /* ripple dates */
          const now = Date.now();
          Object.keys(byMach).forEach(code => {
            byMach[code].sort((a,b) => {
              if ((a.status||'').toUpperCase()==='RUNNING') return -1;
              if ((b.status||'').toUpperCase()==='RUNNING') return 1;
              const _priOrd = {P1:1,P2:2,P3:3,P4:4};
              const _pa = _priOrd[a.machinePriority]||999, _pb = _priOrd[b.machinePriority]||999;
              if (_pa !== _pb) return _pa - _pb;
              return (Number(a.seq||0)-Number(b.seq||0)) || (Number(a.id||0)-Number(b.id||0));
            });
            let cursor = now;
            byMach[code].forEach((p,i) => {
              const st=(p.status||'').toUpperCase(); const isRun=st==='RUNNING';
              const ct=Number(p.cycleTime||120), cav=Number(p.cavity||1);
              const pcsHr=(ct>0)?(3600/ct)*cav:30;
              const qty=Number(p.planQty||0), bal=Math.max(0,qty-Number(p.producedQty||0));
              p.balQty=bal;
              // End Date = start + full planQty time (constant)
              const durFull=(qty*3600000)/pcsHr;
              // Exp Date = based on remaining balQty (changes with production)
              const durBal=(bal*3600000)/pcsHr;
              let start, endFixed, endExp;
              if(isRun){
                start=p.firstDprEntry?new Date(p.firstDprEntry).getTime():(p.startDate?new Date(p.startDate).getTime():now);
                endFixed=start+durFull;    // constant: start + total qty
                endExp=now+durBal;         // live: now + remaining bal
              } else {
                start=(i===0)?now:cursor;
                endFixed=start+durFull;    // queued: start + full qty
                endExp=start+durBal;       // queued: same initially, shrinks as produced
              }
              p._rippledStartRaw=new Date(start);
              p._rippledEndRaw=new Date(endFixed);   // End Date — constant
              p._rippledExpRaw=new Date(endExp);     // Exp Date — changes with production
              cursor=endFixed;                        // ripple next plan from End Date
            });
          });

          etvGroups = byMach;
          etvMachines = Object.values(machMap).map(m => {
            /* infer building/line from code */
            const lMatch = m.code.match(/\bL[-\s]?(\d+)\b/i);
            const bMatch = /^[A-F][- ]/.test(m.code) ? m.code.charAt(0).toUpperCase() : null;
            return {
              code: m.code,
              building: (m.building && m.building !== '?') ? m.building : (bMatch || proc),
              line: (m.line && m.line !== '?') ? m.line : (lMatch ? 'L'+lMatch[1] : 'Machines'),
              machine_process: m.machine_process,
              is_active: m.is_active,
              _finalBuilding: String(m.building || bMatch || proc || '?').trim().toUpperCase(),
              _finalLine: String(m.line || (lMatch?'L'+lMatch[1]:'MACHINES')).trim().toUpperCase()
            };
          });
        }

        /* ── Enrich each machine with tonnage from machine master (works for both
              the reuse path and the build-from-scratch path) ── */
        try {
          const tonMap = {};
          const simp = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
          ((mRes && mRes.data) ? mRes.data : []).forEach(m => {
            const code = simp(stripMachPfx(m.machine || m.code || ''));
            if (code && m.tonnage != null && String(m.tonnage).trim() !== '') {
              tonMap[code] = String(m.tonnage).trim();
            }
          });
          etvMachines.forEach(m => {
            let t = tonMap[simp(stripMachPfx(m.code || ''))];
            if (t == null) {
              // fallback: parse tonnage from code, e.g. AKAR-150-4 → 150 (2nd-to-last numeric group)
              const nums = String(m.code || '').match(/\d+/g);
              if (nums && nums.length >= 2) t = nums[nums.length - 2];
            }
            m._tonnage = (t == null || t === '') ? '' : String(t).trim();
          });
        } catch (e) { console.warn('[ExcelTimeline] tonnage enrich failed', e); }

        /* ── Fix 3: Ensure window.allMachines is populated so the "Change Machine"
              picker in the Order Modal works even when Machine Timeline hasn't
              been loaded yet (ETV-first navigation). ── */
        if (!window.allMachines || window.allMachines.length === 0) {
          window.allMachines = etvMachines.map(m => ({
            code:            m.code,
            name:            m.code,
            machine:         m.code,
            line:            m._finalLine  || m.line     || '',
            building:        m._finalBuilding || m.building || '',
            tonnage:         m._tonnage    || m.tonnage  || '',
            machine_process: m.machine_process || 'Moulding'
          }));
        }

        /* ── Cycle-time prediction: realistic output learned from history ── */
        window._etvCyclePred = { pair: {}, mould: {} };
        try {
          const simp = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const cp = await api.get('/planning/cycle-prediction?days=120');
          if (cp && cp.ok) {
            (cp.byMould || []).forEach(r => { const k = simp(r.mouldNo); if (k) window._etvCyclePred.mould[k] = r; });
            (cp.byPair || []).forEach(r => { const k = simp(r.mouldNo) + '||' + simp(stripMachPfx(r.machine || '')); if (k) window._etvCyclePred.pair[k] = r; });
          }
        } catch (e) { console.warn('[ExcelTimeline] cycle prediction failed', e); }

        renderExcelView(wrap);
        /* Fix 5: stamp last-refreshed time and start the "X min ago" ticker */
        window._etvLastRefresh = Date.now();
        window._etvUpdateRefreshLabel();
      } catch (e) {
        console.error('[ExcelTimeline]', e);
        document.getElementById('excelTimelineView').innerHTML =
          `<div style="padding:40px;text-align:center;color:#dc2626;font-weight:700"><i class="bi bi-exclamation-triangle-fill"></i> Failed to load: ${esc(e.message)}</div>`;
      }
    };

    /* Fix 5: "last refreshed X ago" label — updates every 30 s */
    window._etvLastRefresh = 0;
    window._etvUpdateRefreshLabel = function () {
      clearInterval(window._etvRefreshTicker);
      const tick = () => {
        const el = document.getElementById('etv-refresh-label');
        if (!el || !window._etvLastRefresh) return;
        const sec = Math.round((Date.now() - window._etvLastRefresh) / 1000);
        if (sec < 10)        el.textContent = 'Just now';
        else if (sec < 60)   el.textContent = sec + 's ago';
        else if (sec < 3600) el.textContent = Math.floor(sec/60) + ' min ago';
        else                 el.textContent = Math.floor(sec/3600) + ' hr ago';
      };
      tick();
      window._etvRefreshTicker = setInterval(tick, 30000);
    };

    /* ── Render full view ────────────────────────────────────────────── */
    /* Reusable multi-select checkbox dropdown markup */
    function etvMsHtml(key, label, opts) {
      const rows = opts.map(o => `
        <label class="etv-ms-opt-row">
          <input type="checkbox" value="${esc(o.value)}" onchange="window.etvMsChanged('${key}')"> ${esc(o.text)}
        </label>`).join('');
      return `
        <div class="etv-ms" data-key="${key}">
          <button type="button" class="etv-ms-btn" onclick="window.etvToggleMs('${key}',event)">
            <span>${esc(label)}</span>
            <span class="etv-ms-count" id="etv-ms-count-${key}"></span>
            <i class="bi bi-chevron-down"></i>
          </button>
          <div class="etv-ms-panel" id="etv-ms-panel-${key}" style="display:none">
            <label class="etv-ms-opt-row etv-ms-all">
              <input type="checkbox" onchange="window.etvMsAll('${key}',this.checked)"> <strong>Select All</strong>
            </label>
            <div class="etv-ms-opts">${rows || '<div style="padding:6px 8px;color:#94a3b8;font-size:.78rem">No options</div>'}</div>
          </div>
        </div>`;
    }

    function renderExcelView(wrap) {
      /* remove any filter panels reparented to <body> from a previous render
         (avoids stale duplicate-id panels lingering after a refresh) */
      document.querySelectorAll('body > .etv-ms-panel').forEach(p => p.remove());

      /* Build filter dropdowns from machines */
      const bldgs = new Set(), lines = new Set(), tons = new Set();
      etvMachines.forEach(m => {
        if (m._finalBuilding && m._finalBuilding !== '?') bldgs.add(m._finalBuilding);
        if (m._finalLine    && m._finalLine    !== '?') lines.add(m._finalLine);
        if (m._tonnage) tons.add(m._tonnage);
      });
      const proc = getProcFilter();

      /* reset multi-select selections on each (re)render */
      window.etvMs = { tonnage: new Set(), bldg: new Set(), line: new Set() };

      const tonOpts  = [...tons].sort((a,b)=>Number(a)-Number(b)).map(t=>({value:t,text:t+' T'}));
      const bldgOpts = [...bldgs].sort().map(b=>({value:b,text:proc==='Moulding'?'Bldg '+b:b}));
      const lineOpts = [...lines].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(l=>({value:l,text:l==='MACHINES'?'Machines':'Line '+l}));

      wrap.innerHTML = `
        <div id="etv-wrap">
          <!-- Filter bar (Row 1: title, Row 2: filters) -->
          <div id="etv-filters">
            <div class="etv-row etv-row-title">
              <div class="etv-title"><i class="bi bi-grid-3x3-gap-fill"></i> Excel View Timeline</div>
              <div style="display:flex;align-items:center;gap:12px">
                <button id="etv-smart-btn" type="button" onclick="window.etvSmartSuggest()" title="Find ways to reduce mould changes by grouping the same mould together">
                  <i class="bi bi-stars"></i> Smart Suggestions
                  <span id="etv-smart-badge" style="display:none"></span>
                </button>
                <button id="etv-priority-btn" type="button" onclick="window.etvCreatePriority()" title="Create an ordered MC/MP schedule by picking plan cards one by one" style="display:none">
                  <i class="bi bi-list-ol"></i> MC/MP SCH
                </button>
                <button id="etv-saved-priority-btn" type="button" onclick="window.etvOpenSavedPriorities()" title="View saved MC/MP schedules" style="display:none">
                  <i class="bi bi-clock-history"></i> Saved MC/MP SCH
                </button>
                <div id="etv-count">0 machines</div>
                <!-- Fix 7: Refresh button + Fix 5: last-refreshed label -->
                <button id="etv-refresh-btn" type="button" onclick="window.loadExcelTimeline()" title="Refresh all data from server" style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-weight:700;font-size:.8rem;cursor:pointer;white-space:nowrap">
                  <i class="bi bi-arrow-clockwise"></i> Refresh
                </button>
                <span id="etv-refresh-label" style="font-size:.72rem;color:#94a3b8;white-space:nowrap;min-width:56px;text-align:right"></span>
              </div>
            </div>

            <div class="etv-row etv-row-filters">
              <div class="etv-search-wrap">
                <i class="bi bi-search"></i>
                <input id="etv-search" type="text" placeholder="Search machine, order, mould, client…" oninput="window.etvFilter()">
              </div>

              <!-- Process pills -->
              <div id="etv-proc" style="display:flex;gap:6px;flex-shrink:0;"></div>

              ${etvMsHtml('tonnage', 'Tonnage', tonOpts)}
              ${etvMsHtml('bldg', proc === 'Moulding' ? 'Buildings' : proc, bldgOpts)}
              ${etvMsHtml('line', 'Lines', lineOpts)}
              <!-- Fix 6: Priority filter -->
              <select id="etv-priority-filter" onchange="window.etvFilter()" style="min-width:140px;border-color:#2563eb;color:#1d4ed8;font-weight:700">
                <option value="">Priority: All</option>
                <option value="any">⭐ Has Priority</option>
                <option value="P1">🔵 P1 Only</option>
                <option value="P2">🟢 P2 Only</option>
                <option value="P3">🟡 P3 Only</option>
                <option value="P4">🔴 P4 Only</option>
                <option value="none">— No Priority</option>
              </select>
              <select id="etv-status" onchange="window.etvFilter()" style="min-width:130px">
                <option value="">All Statuses</option>
                <option value="Running">🟢 Running</option>
                <option value="Stopped">🔴 Stopped</option>
                <option value="Planned">🔵 Has Plans</option>
                <option value="Empty">⬜ No Plans</option>
                <option value="MouldChange">🟠 Mould Change</option>
              </select>
              <select id="etv-forecast" onchange="window.etvFilter()" style="min-width:140px;border-color:#f59e0b;color:#b45309;font-weight:700">
                <option value="">Forecast: Off</option>
                <option value="24">⏱ Next 24 Hours</option>
                <option value="48">⏱ Next 48 Hours</option>
              </select>
            </div>
          </div>

          <!-- Scrollable table area -->
          <div id="etv-scroll">
            <table id="etv-table">
              <colgroup id="etv-colgroup"></colgroup>
              <thead id="etv-thead"></thead>
              <tbody id="etv-tbody"></tbody>
            </table>
          </div>

          <!-- Legend -->
          <div id="etv-legend">
            <span style="font-size:.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-right:4px">Legend:</span>
            <span class="etv-legend-dot running">Running</span>
            <span class="etv-legend-dot stopped">Stopped</span>
            <span class="etv-legend-dot planned">Planned</span>
            <span class="etv-legend-dot chg">Mould Change</span>
            <span class="etv-legend-dot empty">Empty Slot</span>
          </div>
        </div>`;

      /* Process pills */
      const procDiv = document.getElementById('etv-proc');
      if (procDiv) {
        ['Moulding','Printing','Tuffting','Labour Job'].forEach(opt => {
          const active = opt === proc;
          const btn = document.createElement('button');
          btn.className = 'etv-btn' + (active ? ' primary' : '');
          btn.textContent = opt;
          btn.onclick = () => window.setPlanningProcessFilter && window.setPlanningProcessFilter(opt);
          procDiv.appendChild(btn);
        });
      }

      window.etvFilter();
      if (typeof window.etvUpdateSmartBadge === 'function') window.etvUpdateSmartBadge();
      if (typeof window.etvApplyPriorityRole === 'function') window.etvApplyPriorityRole();
    }

    /* ── Create Priority: role gating ───────────────────────────────────
       Visible only to PPC managers and superadmin. */
    window.etvApplyPriorityRole = function () {
      const allowed = ['ppc_ass_manager', 'ppc_manager', 'superadmin'];
      let role = '';
      try { role = String((window.JPSMS && window.JPSMS.auth.getUser().role_code) || '').toLowerCase(); } catch (_) {}
      const show = allowed.includes(role);
      ['etv-priority-btn', 'etv-saved-priority-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? 'inline-flex' : 'none';
      });
    };

    /* ════════════════════════════════════════════════════════════════════
       CREATE PRIORITY — build an ordered priority sheet from plan cards
    ════════════════════════════════════════════════════════════════════ */
    window.etvPrioritySelecting = false;
    window.etvPriorityCtx = null; // { date, shift, process, items:[{_key,machine,mouldName,mouldNo,manpower}] }

    const prioEsc = s => String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    window.etvPriorityKey = function (code, i, p) {
      const pid = (p && (p.planId || p.plan_id || p.id)) || '';
      return pid ? ('P:' + pid) : (code + '|' + i + '|' + ((p && p.orderNo) || ''));
    };

    window.etvManpowerFor = function (p) {
      if (!p || !window.etvManpowerMap) return null;
      const k = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const byNo = k(p.mouldNo), byName = k(p.mouldName);
      if (byNo && window.etvManpowerMap['#:' + byNo] != null) return window.etvManpowerMap['#:' + byNo];
      if (byName && window.etvManpowerMap['N:' + byName] != null) return window.etvManpowerMap['N:' + byName];
      return null;
    };

    /* Step 1: ask Date + Shift */
    window.etvCreatePriority = function () {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const defShift = (now.getHours() >= 20 || now.getHours() < 8) ? 'Night' : 'Day';
      const host = document.createElement('div');
      host.id = 'etv-prio-modal';
      host.innerHTML = `
        <div class="pm-box">
          <div class="pm-head">
            <h3><i class="bi bi-list-ol"></i> MC/MP SCH</h3>
            <button class="pm-close" onclick="document.getElementById('etv-prio-modal').remove()">&times;</button>
          </div>
          <div class="pm-body">
            <label>Date</label>
            <input type="date" id="etv-prio-date" value="${today}">
            <label>Shift</label>
            <select id="etv-prio-shift">
              <option value="Day"${defShift==='Day'?' selected':''}>Day</option>
              <option value="Night"${defShift==='Night'?' selected':''}>Night</option>
            </select>
            <button class="pp-btn savepdf" onclick="window.etvPriorityStart()">
              <i class="bi bi-check2-circle"></i> Start Selecting Plans
            </button>
          </div>
        </div>`;
      host.addEventListener('click', e => { if (e.target === host) host.remove(); });
      document.body.appendChild(host);
    };

    window.etvPriorityStart = function () {
      const date = document.getElementById('etv-prio-date').value;
      const shift = document.getElementById('etv-prio-shift').value;
      if (!date) { alert('Please select a date.'); return; }
      const modal = document.getElementById('etv-prio-modal');
      if (modal) modal.remove();
      window.etvPriorityCtx = { date, shift, process: (typeof getProcFilter === 'function' ? getProcFilter() : ''), items: [] };
      window.etvPrioritySelecting = true;
      const btn = document.getElementById('etv-priority-btn');
      if (btn) { btn.classList.add('active'); btn.innerHTML = '<i class="bi bi-x-circle"></i> Cancel Priority'; btn.setAttribute('onclick', 'window.etvPriorityCancel()'); }
      window.etvRenderPriorityPanel();
      if (typeof window.etvFilter === 'function') window.etvFilter();
    };

    window.etvPriorityCancel = function () {
      window.etvPrioritySelecting = false;
      window.etvPriorityCtx = null;
      const btn = document.getElementById('etv-priority-btn');
      if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="bi bi-list-ol"></i> Create Priority'; btn.setAttribute('onclick', 'window.etvCreatePriority()'); }
      const panel = document.getElementById('etv-prio-panel');
      if (panel) panel.remove();
      if (typeof window.etvFilter === 'function') window.etvFilter();
    };

    /* Step 2: pick / unpick a plan card */
    window.etvPriorityPick = function (code, i) {
      if (!window.etvPrioritySelecting || !window.etvPriorityCtx) return;
      const plans = (window.etvGroups && window.etvGroups[code]) ? window.etvGroups[code] : (typeof etvGroups !== 'undefined' ? etvGroups[code] : null);
      const list = plans || [];
      const p = list[i];
      if (!p) return;
      const key = window.etvPriorityKey(code, i, p);
      const items = window.etvPriorityCtx.items;
      const at = items.findIndex(it => it._key === key);
      if (at >= 0) {
        items.splice(at, 1); // toggle off
      } else {
        items.push({
          _key: key,
          machine: (typeof stripMachPfx === 'function' ? stripMachPfx(code) : code),
          mouldName: p.mouldName || '-',
          mouldNo: p.mouldNo || '',
          manpower: window.etvManpowerFor(p)
        });
      }
      window.etvRenderPriorityPanel();
      if (typeof window.etvFilter === 'function') window.etvFilter();
    };

    window.etvPriorityMove = function (idx, dir) {
      const items = window.etvPriorityCtx && window.etvPriorityCtx.items;
      if (!items) return;
      const j = idx + dir;
      if (j < 0 || j >= items.length) return;
      const tmp = items[idx]; items[idx] = items[j]; items[j] = tmp;
      window.etvRenderPriorityPanel();
      if (typeof window.etvFilter === 'function') window.etvFilter();
    };

    window.etvPriorityRemove = function (idx) {
      const items = window.etvPriorityCtx && window.etvPriorityCtx.items;
      if (!items) return;
      items.splice(idx, 1);
      window.etvRenderPriorityPanel();
      if (typeof window.etvFilter === 'function') window.etvFilter();
    };

    /* Side panel */
    window.etvRenderPriorityPanel = function () {
      let panel = document.getElementById('etv-prio-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'etv-prio-panel';
        document.body.appendChild(panel);
      }
      const ctx = window.etvPriorityCtx || { items: [], date: '', shift: '' };
      const items = ctx.items || [];
      const total = items.reduce((s, it) => s + (Number.isFinite(it.manpower) ? it.manpower : 0), 0);
      const dateTxt = ctx.date ? new Date(ctx.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

      const rows = items.length ? items.map((it, idx) => `
        <div class="pp-item">
          <span class="pp-sr">${idx + 1}</span>
          <div class="pp-info">
            <div class="pp-mach">${prioEsc(it.machine)}</div>
            <div class="pp-mould" title="${prioEsc(it.mouldName)}">${prioEsc(it.mouldName)}</div>
          </div>
          <span class="pp-mp">${it.manpower == null ? '–' : it.manpower}</span>
          <button class="pp-moveup" title="Move up" onclick="window.etvPriorityMove(${idx},-1)"><i class="bi bi-chevron-up"></i></button>
          <button class="pp-movedn" title="Move down" onclick="window.etvPriorityMove(${idx},1)"><i class="bi bi-chevron-down"></i></button>
          <button class="pp-rm" title="Remove" onclick="window.etvPriorityRemove(${idx})"><i class="bi bi-x-lg"></i></button>
        </div>`).join('') : `<div style="padding:24px 8px;text-align:center;color:#94a3b8;font-size:.8rem">Click plan cards in the grid to add them in priority order.</div>`;

      panel.innerHTML = `
        <div class="pp-head">
          <h3><i class="bi bi-list-ol"></i> Priority — ${prioEsc(ctx.shift)} Shift</h3>
          <div class="pp-sub">${prioEsc(dateTxt)} · ${items.length} machine${items.length===1?'':'s'} selected</div>
        </div>
        <div class="pp-body">${rows}</div>
        <div class="pp-foot">
          <div class="pp-total"><span>Total Manpower</span><strong>${total}</strong></div>
          <button class="pp-btn savepdf" ${items.length?'':'disabled'} onclick="window.etvPrioritySave(true)"><i class="bi bi-file-earmark-pdf"></i> Save &amp; Generate PDF</button>
          <button class="pp-btn save" ${items.length?'':'disabled'} onclick="window.etvPrioritySave(false)"><i class="bi bi-save"></i> Save MC/MP SCH</button>
          <button class="pp-btn cancel" onclick="window.etvPriorityCancel()">Cancel</button>
        </div>`;
      requestAnimationFrame(() => panel.classList.add('open'));
    };

    /* Save (+ optional PDF) */
    window.etvPrioritySave = async function (withPdf) {
      const ctx = window.etvPriorityCtx;
      if (!ctx || !ctx.items.length) return;
      let createdBy = '';
      try { createdBy = (window.JPSMS && window.JPSMS.auth.getUser().username) || ''; } catch (_) {}
      const payload = {
        priorityDate: ctx.date,
        shift: ctx.shift,
        process: ctx.process,
        createdBy,
        items: ctx.items.map(it => ({ machine: it.machine, mouldName: it.mouldName, mouldNo: it.mouldNo, manpower: it.manpower }))
      };
      try {
        const api = getApi();
        const res = await api.post('/planning/priority', payload);
        const data = (res && res.data) ? res.data : res;
        const title = (data && data.title) || window.etvPriorityTitle(ctx.date, ctx.shift);
        const total = ctx.items.reduce((s, it) => s + (Number.isFinite(it.manpower) ? it.manpower : 0), 0);
        if (withPdf) {
          window.etvPriorityPdf({ title, items: ctx.items.map((it, i) => ({ sr: i + 1, machine: it.machine, mouldName: it.mouldName, manpower: it.manpower })), totalManpower: total });
        }
        window.etvPriorityCancel();
        if (!withPdf) alert('Priority list saved.');
      } catch (e) {
        console.error('priority save', e);
        alert('Failed to save priority list: ' + (e && e.message ? e.message : e));
      }
    };

    window.etvPriorityTitle = function (date, shift) {
      let dd = '';
      try { dd = new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-'); } catch (_) { dd = String(date || ''); }
      return `TODAY PRIORITY FOR ${String(shift || '').toUpperCase()} SHIFT OF ${dd}`;
    };

    /* PDF — matches the attached format: title box, green header, Sr/Machine/Mould Name/Manp, total */
    window.etvPriorityPdf = function (data) {
      const items = data.items || [];
      const body = items.map(it => `
        <tr>
          <td class="c">${it.sr}</td>
          <td>${prioEsc(it.machine)}</td>
          <td>${prioEsc(it.mouldName)}</td>
          <td class="c">${it.manpower == null ? '–' : it.manpower}</td>
        </tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${prioEsc(data.title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; margin: 18px; color: #111; }
          .ttl { border: 3px solid #000; text-align: center; font-weight: 800; font-size: 18px; padding: 10px; margin-bottom: 12px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #000; padding: 5px 8px; font-size: 13px; }
          thead th { background: #16a34a; color: #fff; text-align: center; font-weight: 800; }
          td.c { text-align: center; }
          col.sr { width: 8%; } col.mp { width: 14%; } col.mc { width: 32%; }
          tfoot td { font-weight: 800; background: #f1f5f9; }
          @media print { body { margin: 0; } }
        </style></head><body>
        <div class="ttl">${prioEsc(data.title)}</div>
        <table>
          <colgroup><col class="sr"><col class="mc"><col><col class="mp"></colgroup>
          <thead><tr><th>Sr</th><th>Machine</th><th>Mould Name</th><th>Manp</th></tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><td class="c" colspan="3" style="text-align:right">Total Manpower</td><td class="c">${data.totalManpower}</td></tr></tfoot>
        </table>
        <script>window.onload=function(){window.print();}<\/script>
        </body></html>`;
      const w = window.open('', '_blank');
      if (!w) { alert('Please allow pop-ups to generate the PDF.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    };

    /* Saved Priorities list */
    window.etvOpenSavedPriorities = async function () {
      const host = document.createElement('div');
      host.id = 'etv-prio-modal';
      host.innerHTML = `
        <div class="pm-box">
          <div class="pm-head">
            <h3><i class="bi bi-clock-history"></i> Saved Priorities</h3>
            <button class="pm-close" onclick="document.getElementById('etv-prio-modal').remove()">&times;</button>
          </div>
          <div class="pm-body" id="etv-prio-saved-body">
            <div style="text-align:center;color:#64748b;padding:20px"><span class="spinner-border spinner-border-sm"></span> Loading…</div>
          </div>
        </div>`;
      host.addEventListener('click', e => { if (e.target === host) host.remove(); });
      document.body.appendChild(host);
      try {
        const api = getApi();
        const proc = (typeof getProcFilter === 'function' ? getProcFilter() : '');
        const res = await api.get('/planning/priority' + (proc ? ('?process=' + encodeURIComponent(proc)) : ''));
        const list = ((res && res.data) ? res.data : res) || [];
        const isSuper = (() => { try { return String(window.JPSMS.auth.getUser().role_code || '').toLowerCase() === 'superadmin'; } catch (_) { return false; } })();
        const body = document.getElementById('etv-prio-saved-body');
        if (!list.length) { body.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px">No saved priorities yet.</div>'; return; }
        body.innerHTML = list.map(r => {
          const dt = r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="pm-saved-row">
              <div class="pm-saved-info">
                <div class="pm-saved-title">${prioEsc(r.title)}</div>
                <div class="pm-saved-meta">${r.itemCount || 0} machines · Total MP: ${r.totalManpower == null ? '–' : r.totalManpower} · ${prioEsc(r.createdBy || '')} · ${prioEsc(dt)}</div>
              </div>
              <button class="pp-btn savepdf" style="width:auto;margin:0;padding:7px 12px" onclick="window.etvPriorityReprint(${r.id})"><i class="bi bi-file-earmark-pdf"></i> PDF</button>
              ${isSuper ? `<button class="pp-btn cancel" style="width:auto;margin:0;padding:7px 10px" onclick="window.etvPriorityDelete(${r.id}, this)"><i class="bi bi-trash"></i></button>` : ''}
            </div>`;
        }).join('');
      } catch (e) {
        const body = document.getElementById('etv-prio-saved-body');
        if (body) body.innerHTML = '<div style="text-align:center;color:#dc2626;padding:20px">Failed to load: ' + prioEsc(String(e && e.message || e)) + '</div>';
      }
    };

    window.etvPriorityReprint = async function (id) {
      try {
        const api = getApi();
        const res = await api.get('/planning/priority/' + id);
        const d = (res && res.data) ? res.data : res;
        const items = (d.items || []).map((it, i) => ({ sr: i + 1, machine: it.machine, mouldName: it.mouldName, manpower: it.manpower }));
        window.etvPriorityPdf({ title: d.title || window.etvPriorityTitle(d.priorityDate, d.shift), items, totalManpower: d.totalManpower });
      } catch (e) {
        alert('Failed to load priority: ' + (e && e.message ? e.message : e));
      }
    };

    window.etvPriorityDelete = async function (id, btn) {
      if (!confirm('Delete this saved priority list?')) return;
      try {
        const api = getApi();
        await api.delete('/planning/priority/' + id);
        const row = btn.closest('.pm-saved-row');
        if (row) row.remove();
      } catch (e) {
        alert('Failed to delete: ' + (e && e.message ? e.message : e));
      }
    };

    /* ── Filter ──────────────────────────────────────────────────────── */
    window.etvFilter = function () {
      const q     = ((document.getElementById('etv-search')?.value || '')).toLowerCase();
      const sVal  = document.getElementById('etv-status')?.value || '';
      const fVal  = document.getElementById('etv-forecast')?.value || '';
      const pVal  = document.getElementById('etv-priority-filter')?.value || ''; /* Fix 6 */
      const norm  = v => String(v||'').trim().toUpperCase();

      const ms    = window.etvMs || { tonnage:new Set(), bldg:new Set(), line:new Set() };
      const tSet  = ms.tonnage, bSet = ms.bldg, lSet = ms.line;

      const now        = Date.now();
      const cutoffTime = fVal ? (now + parseInt(fVal,10) * 3600000) : 0;

      const filtered = etvMachines.filter(m => {
        const b = m._finalBuilding || '?';
        const l = m._finalLine    || '?';
        if (bSet.size && !bSet.has(norm(b))) return false;
        if (lSet.size && !lSet.has(norm(l))) return false;
        if (tSet.size && !tSet.has(String(m._tonnage || ''))) return false;

        const mPlans = etvGroups[m.code] || [];

        /* Fix 6: priority filter — check any plan on this machine */
        if (pVal === 'any'  && !mPlans.some(p => p.machinePriority)) return false;
        if (pVal === 'none' &&  mPlans.some(p => p.machinePriority)) return false;
        if (pVal === 'P1' || pVal === 'P2' || pVal === 'P3' || pVal === 'P4') {
          if (!mPlans.some(p => p.machinePriority === pVal)) return false;
        }

        /* ── FORECAST: keep only machines whose mould change / new job starts within the window ── */
        if (cutoffTime > 0) {
          const hasChangeInWindow = mPlans.some((p,i) => {
            if (!p._rippledStartRaw) return false;
            const start = p._rippledStartRaw.getTime();
            if (start <= now || start >= cutoffTime) return false; // not starting inside the window
            if (i === 0) return true;                              // first plan starting in window = new job
            return mouldKey(p) !== mouldKey(mPlans[i-1]);          // mould change
          });
          if (!hasChangeInWindow) return false;
        }

        if (sVal === 'Running'     && !mPlans.some(p=>(p.status||'').toLowerCase()==='running')) return false;
        if (sVal === 'Stopped'     && mPlans.length > 0) return false;
        if (sVal === 'Planned'     && mPlans.length === 0) return false;
        if (sVal === 'Empty'       && mPlans.length > 0) return false;
        if (sVal === 'MouldChange' && !mPlans.some((p,i)=>i>0&&(p.mouldNo||''!==(mPlans[i-1].mouldNo||'')))) return false;

        if (q) {
          if (m.code.toLowerCase().includes(q)) return true;
          return mPlans.some(p =>
            (p.orderNo||'').toLowerCase().includes(q) ||
            (p.mouldName||'').toLowerCase().includes(q) ||
            (p.mouldNo||'').toLowerCase().includes(q) ||
            (p.clientName||'').toLowerCase().includes(q) ||
            (p.jcNo||p.job_card_no||'').toLowerCase().includes(q)
          );
        }
        return true;
      });

      renderExcelGrid(filtered, cutoffTime);
    };

    /* ── Multi-select checkbox dropdown behaviour ── */
    window.etvToggleMs = function (key, ev) {
      if (ev) ev.stopPropagation();
      document.querySelectorAll('.etv-ms-panel').forEach(p => {
        if (p.id !== 'etv-ms-panel-' + key) p.style.display = 'none';
      });
      const panel = document.getElementById('etv-ms-panel-' + key);
      if (!panel) return;
      const willOpen = (panel.style.display === 'none' || !panel.style.display);
      if (willOpen) {
        // The filter bar (and its ancestors) use overflow + transforms, which both
        // clip and offset a position:fixed child. Reparent the panel to <body> so it
        // is positioned relative to the viewport, then anchor it to its trigger button.
        const btn = document.querySelector('.etv-ms[data-key="' + key + '"] .etv-ms-btn');
        if (panel.parentElement !== document.body) document.body.appendChild(panel);
        panel.style.display = 'block'; // show first so we can measure width
        if (btn) {
          const r = btn.getBoundingClientRect();
          const panelW = panel.offsetWidth || 180;
          let left = r.left;
          if (left + panelW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - panelW - 8);
          panel.style.left = left + 'px';
          panel.style.top  = (r.bottom + 4) + 'px';
        }
      } else {
        panel.style.display = 'none';
      }
    };

    window.etvMsAll = function (key, checked) {
      document.querySelectorAll('#etv-ms-panel-' + key + ' .etv-ms-opts input[type=checkbox]')
        .forEach(cb => { cb.checked = checked; });
      window.etvMsChanged(key);
    };

    window.etvMsChanged = function (key) {
      const set = new Set();
      const boxes = [...document.querySelectorAll('#etv-ms-panel-' + key + ' .etv-ms-opts input[type=checkbox]')];
      boxes.forEach(cb => { if (cb.checked) set.add(cb.value); });
      window.etvMs = window.etvMs || { tonnage:new Set(), bldg:new Set(), line:new Set() };
      window.etvMs[key] = set;

      const cnt = document.getElementById('etv-ms-count-' + key);
      if (cnt) cnt.textContent = set.size ? '(' + set.size + ')' : '';

      const allCb = document.querySelector('#etv-ms-panel-' + key + ' .etv-ms-all input');
      if (allCb) {
        allCb.checked = boxes.length > 0 && boxes.every(b => b.checked);
        allCb.indeterminate = !allCb.checked && boxes.some(b => b.checked);
      }
      window.etvFilter();
    };

    /* close any open multi-select panel when clicking outside (registered once) */
    if (!window._etvMsOutsideBound) {
      window._etvMsOutsideBound = true;
      document.addEventListener('click', function (e) {
        // panels may be reparented to <body>, so allow clicks inside a panel too
        if (!e.target.closest('.etv-ms') && !e.target.closest('.etv-ms-panel')) {
          document.querySelectorAll('.etv-ms-panel').forEach(p => p.style.display = 'none');
        }
      });
    }

    window.etvReset = function () {
      ['etv-search','etv-status','etv-forecast','etv-priority-filter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      window.etvMs = { tonnage:new Set(), bldg:new Set(), line:new Set() };
      document.querySelectorAll('.etv-ms-panel input[type=checkbox]').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
      document.querySelectorAll('.etv-ms-count').forEach(c => c.textContent = '');
      window.etvFilter();
    };

    /* ── Grid renderer ───────────────────────────────────────────────── */
    function renderExcelGrid(machines, cutoffTime) {
      cutoffTime = cutoffTime || 0;
      const nowMs = Date.now();
      const searchVal = (document.getElementById('etv-search')?.value || '').trim().toLowerCase();
      const thead = document.getElementById('etv-thead');
      const tbody = document.getElementById('etv-tbody');
      const countEl = document.getElementById('etv-count');
      if (!thead || !tbody) return;

      if (countEl) countEl.textContent = machines.length + ' machine' + (machines.length===1?'':'s');

      if (machines.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="2" style="padding:40px;text-align:center;color:#94a3b8;font-weight:600;font-size:.9rem"><i class="bi bi-search" style="font-size:1.5rem;display:block;margin-bottom:8px;opacity:.4"></i>No machines match the filters</td></tr>`;
        return;
      }

      /* sort: building → line → machine code */
      if (typeof window.tlMachineSort === 'function') {
        // Shared comparator: Building → Line → Machine Number (matches Machine Timeline)
        machines.sort(window.tlMachineSort);
      } else {
        machines.sort((a,b) => {
          const ba = a._finalBuilding||'?', bb = b._finalBuilding||'?';
          if (ba !== bb) return ba.localeCompare(bb, undefined, {numeric:true});
          const la = a._finalLine||'?', lb = b._finalLine||'?';
          if (la !== lb) return la.localeCompare(lb, undefined, {numeric:true});
          return (a.code||'').localeCompare(b.code||'', undefined, {numeric:true});
        });
      }

      /* visible plans per machine — when forecast is on, drop plans starting beyond the cutoff
         (keep RUNNING/started plans so the active job stays in view) */
      const visiblePlans = (code) => {
        const all = etvGroups[code] || [];
        const filtered = cutoffTime ? all.filter(p => {
          const start = p._rippledStartRaw ? p._rippledStartRaw.getTime() : 0;
          return start < cutoffTime;
        }) : all;
        // Push plans with BAL ≤ 0 (fully/over-produced) to the end.
        // Running plans are exempt — they stay in position even if bal is 0.
        return filtered.slice().sort((a, b) => {
          const aLast = (Number(a.balQty) || 0) <= 0 && (a.status || '').toLowerCase() !== 'running';
          const bLast = (Number(b.balQty) || 0) <= 0 && (b.status || '').toLowerCase() !== 'running';
          if (aLast !== bLast) return aLast ? 1 : -1;
          return 0; // preserve original seq order within each group
        });
      };

      /* max plan slots */
      const maxSlots = Math.max(0, ...machines.map(m => visiblePlans(m.code).length));
      const cols = Math.max(maxSlots, 1); /* at least 1 empty col */

      /* ── DEFINITIVE WIDTH FIX ──────────────────────────────────────────
         table-layout:fixed only works correctly with an explicit pixel
         width. Without it the browser falls back to proportional sizing
         (container width ÷ columns) which balloons the machine column.
         We own the width here: machineCol + N slotCols.
      ────────────────────────────────────────────────────────────────── */
      const tableEl = document.getElementById('etv-table');
      if (tableEl) {
        tableEl.style.width = (MACH_W + cols * SLOT_W) + 'px';
        tableEl.classList.toggle('etv-priority-mode', !!window.etvPrioritySelecting);
      }

      /* ── COLGROUP (belt-and-suspenders column sizing) ── */
      const cgEl = document.getElementById('etv-colgroup');
      if (cgEl) cgEl.innerHTML =
        `<col style="width:${MACH_W}px">` +
        Array.from({length: cols}, () => `<col style="width:${SLOT_W}px">`).join('');

      /* ── THEAD ── */
      thead.innerHTML = `
        <tr class="etv-col-hdr">
          <th class="etv-mach-col">
            <div class="etv-col-inner">
              <span style="color:#1e293b;font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase">MACHINE</span>
              <span style="color:#64748b;font-size:.56rem;font-weight:600">${machines.length} shown</span>
            </div>
          </th>
          ${Array.from({length: cols}, (_,i) => `
            <th class="etv-seq-col">
              <div class="etv-col-inner">
                <span class="etv-col-seq-label">${i===0 ? '▶ Current' : `Slot ${i+1}`}</span>
                <span class="etv-col-seq-sub">${i===0 ? 'Active / next plan' : `Queue #${i+1}`}</span>
              </div>
            </th>`).join('')}
        </tr>`;

      /* ── TBODY ── */
      let lastGroup = null;
      const rows = [];

      machines.forEach(m => {
        const group = `${m._finalBuilding||'?'} · Line ${m._finalLine||'?'}`;
        if (group !== lastGroup) {
          lastGroup = group;
          const proc = getProcFilter();
          const label = proc === 'Moulding'
            ? `Building ${m._finalBuilding||'?'}  ·  Line ${m._finalLine||'?'}`
            : `${m._finalBuilding||'?'}  ·  ${m._finalLine||'?'}`;
          rows.push(`<tr class="etv-group-hdr"><td colspan="${cols+1}">
            <span style="color:#bfdbfe;margin-right:8px"><i class="bi bi-building-fill"></i></span>${esc(label)}<span style="margin-left:12px;color:rgba(255,255,255,.78);font-size:.58rem;font-weight:700;letter-spacing:.06em">${machines.filter(x=>(x._finalBuilding||'?')===m._finalBuilding&&(x._finalLine||'?')===m._finalLine).length} machines</span>
          </td></tr>`);
        }

        const plans = visiblePlans(m.code);

        /* load calc — time from NOW until the machine finishes its FULL queue.
           Plans ripple contiguously from now, so load = (latest plan end) − now.
           (Summing end−start would wrongly include the running plan's already-
           elapsed time, overstating the load vs the per-card "finishes in" badges.) */
        const allMachinePlans = etvGroups[m.code] || [];
        const _nowTs = Date.now();
        let _maxEnd = 0;
        allMachinePlans.forEach(p => {
          const en = p._rippledEndRaw ? p._rippledEndRaw.getTime() : 0;
          if (Number.isFinite(en) && en > _maxEnd) _maxEnd = en;
        });
        const totalMs = _maxEnd > _nowTs ? (_maxEnd - _nowTs) : 0;
        const loadLabel = fmt(totalMs);
        const loadDays = totalMs / 86400000;
        const isOverloaded = loadDays > 30;

        /* machine cell — show clean stripped name; machMap keys are already stripped */
        const zeroBalCount = (etvGroups[m.code] || []).filter(p =>
          (Number(p.balQty) || 0) <= 0 && (p.status || '').toLowerCase() !== 'running'
        ).length;
        const machCell = `
          <td class="etv-mach-cell" onclick="window.etvMachineClick('${esc(m.code)}')" title="${esc(m.code)} — click to filter">
            <div class="etv-mach-inner">
              <div class="etv-mach-code" title="${esc(m.code)}">${esc(stripMachPfx(m.code))}${zeroBalCount > 0 ? `<span style="margin-left:5px;background:#fef3c7;color:#b45309;font-size:.58rem;font-weight:800;border-radius:999px;padding:1px 6px;vertical-align:middle" title="${zeroBalCount} plan(s) with zero/negative balance — sorted to end">(${zeroBalCount})</span>` : ''}</div>
              <div class="etv-mach-meta">${(m.machine_process||'').toLowerCase() === 'labour job' && m.partyName
                ? `<i class="bi bi-people-fill" style="color:#b45309"></i> ${esc(m.partyName)}`
                : `${esc(m._finalBuilding||'?')} · Line ${esc(m._finalLine||'?')}`}</div>
              ${plans.length > 0 ? `<div class="etv-mach-plans">${plans.length} plan${plans.length>1?'s':''} queued</div>` : `<div class="etv-mach-plans" style="color:#2d3f55">No plans</div>`}
              ${loadLabel ? `<div class="etv-mach-load${isOverloaded ? ' etv-mach-load-over' : ''}" title="Total queued run-time${isOverloaded ? ' — over 30 days of load' : ''}"><i class="bi bi-clock" style="font-size:.5rem"></i> Load: ${esc(loadLabel)}</div>` : ''}
              ${isOverloaded ? `<div class="etv-load-badge" title="This machine has more than 30 days of planned load"><i class="bi bi-exclamation-triangle-fill"></i> 30+ days load</div>` : ''}
            </div>
          </td>`;

        /* plan slot cells */
        const planCells = Array.from({length: cols}, (_,i) => {
          const p = plans[i];
          if (!p) return `<td class="etv-plan-cell etv-empty" data-machine="${esc(m.code)}" data-slot="${i}" data-slot-pid="" ondragover="window.etvDragOverCell(event, this)" ondragleave="window.etvDragLeaveCell(event, this)" ondrop="window.etvDropCell(event, this)"><div class="etv-empty-inner"><span class="etv-slot-num">${i+1}</span><span style="letter-spacing:.05em;opacity:.5">empty</span></div></td>`;

          const st   = (p.status||'').toLowerCase();
          const isPrevMould = i > 0 && mouldKey(p) !== mouldKey(plans[i-1]);

          /* ── Forecast: how soon is this mould change / new job coming? ── */
          const changeStartMs = p._rippledStartRaw ? p._rippledStartRaw.getTime() : 0;
          const changeInMs    = changeStartMs - nowMs;
          const isNewJob      = i === 0 && changeStartMs > nowMs;
          const isUpcomingChange = (isPrevMould || isNewJob) && changeStartMs > nowMs &&
                                   (cutoffTime ? changeStartMs < cutoffTime : true);
          const isUrgentChange   = isUpcomingChange && changeInMs <= 7200000; // within 2h
          let changeBadge = '';
          if (cutoffTime && isUpcomingChange) {
            changeBadge = `<div class="etv-card-change" style="${isUrgentChange ? 'background:#fee2e2;color:#b91c1c;border-color:#fca5a5' : ''}">
              <i class="bi bi-arrow-repeat"></i> ${isNewJob ? 'New Job in' : 'Mould Change in'} <strong>${fmt(changeInMs)}</strong>
            </div>`;
          }

          const cardClass = isPrevMould ? 'chg' : (st==='running'?'running':st==='stopped'?'stopped':st==='completed'?'completed':'planned');
          const statusClass = st==='running'?'running':st==='stopped'?'stopped':st==='completed'?'completed':'planned';

          const isMatched = searchVal && (
            (p.orderNo||'').toLowerCase().includes(searchVal) ||
            (p.mouldName||'').toLowerCase().includes(searchVal) ||
            (p.mouldNo||'').toLowerCase().includes(searchVal) ||
            (p.clientName||'').toLowerCase().includes(searchVal) ||
            ((p.jcNo||p.jc_no||p.job_card_no||'').toLowerCase().includes(searchVal))
          );

          let cardStyle = '';
          if (isMatched) {
            let leftBorderColor = '#cbd5e1';
            if (st === 'running') leftBorderColor = '#16a34a';
            else if (st === 'stopped') leftBorderColor = '#dc2626';
            else if (st === 'planned') leftBorderColor = '#2563eb';
            else if (st === 'completed') leftBorderColor = '#7c3aed';
            else if (isPrevMould) leftBorderColor = '#ea580c';
            
            cardStyle = `background: #fef9c3 !important; border-color: #eab308 !important; border-left-color: ${leftBorderColor} !important; border-width: 2.5px !important; box-shadow: 0 0 16px rgba(234, 179, 8, 0.75) !important;`;
          }

          /* time duration/remaining badge + end date rows */
          const fmtDt = (d) => d ? d.toLocaleString('en-GB', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
          let timeBadge = '';
          if (p._rippledEndRaw) {
            // Duration badge: running → time remaining (exp-based); queued → full plan duration
            let msDiff = 0, pfx = '', col = '#2563eb';
            if (st === 'running') {
              msDiff = (p._rippledExpRaw || p._rippledEndRaw).getTime() - Date.now();
              col = msDiff < 0 ? '#dc2626' : '#16a34a';
              if (msDiff < 0) { pfx = 'OD '; msDiff = Math.abs(msDiff); }
            } else {
              msDiff = p._rippledEndRaw.getTime() - (p._rippledStartRaw ? p._rippledStartRaw.getTime() : Date.now());
            }
            const tStr = fmt(Math.abs(msDiff));
            if (tStr) timeBadge = `<div class="etv-card-time" style="color:${col}"><i class="bi bi-clock" style="font-size:.6rem"></i>${pfx}${tStr}</div>`;
          }
          // End Date / Exp Date rows shown on every card
          const endDateStr = fmtDt(p._rippledEndRaw);
          const expDateStr = fmtDt(p._rippledExpRaw);
          const showExpRow = p._rippledExpRaw && p._rippledEndRaw && Math.abs(p._rippledExpRaw.getTime() - p._rippledEndRaw.getTime()) > 60000;
          const dateBadge = `<div style="font-size:.58rem;color:#64748b;line-height:1.4;margin-top:2px;border-top:1px dashed #e2e8f0;padding-top:2px;">
            <span style="color:#94a3b8">End:</span> <span style="font-weight:700;color:#334155">${endDateStr}</span>${showExpRow ? `<br><span style="color:#2563eb">Exp:</span> <span style="font-weight:700;color:#2563eb">${expDateStr}</span>` : ''}
          </div>`;

          /* ── Cycle-time estimate badge: realistic output learned from history vs standard ── */
          let estBadge = '';
          const pred = etvPred(p, m.code);
          if (pred && pred.predPcsHr > 0) {
            const stdCt = Number(p.cycleTime || 0), stdCav = Number(p.cavity || 1);
            const stdPcsHr = stdCt > 0 ? Math.round((3600 / stdCt) * stdCav) : 0;
            const deltaPct = stdPcsHr > 0 ? Math.round((pred.predPcsHr / stdPcsHr - 1) * 100) : null;
            const HPD = 22; // productive hours/day assumption for the day estimate
            const estDays = (Number(p.balQty) > 0) ? (Number(p.balQty) / (pred.predPcsHr * HPD)) : 0;
            const slow = (deltaPct !== null && deltaPct < -5);
            const fast = (deltaPct !== null && deltaPct > 5);
            const col = slow ? '#b91c1c' : (fast ? '#047857' : '#475569');
            const bg = slow ? '#fee2e2' : (fast ? '#ecfdf5' : '#f1f5f9');
            const arrow = (deltaPct === null || deltaPct === 0) ? '' : (deltaPct < 0 ? '▼' : '▲');
            const deltaTxt = (deltaPct === null) ? '' : ` ${arrow}${Math.abs(deltaPct)}%`;
            const daysTxt = estDays ? (estDays < 1 ? '<1 day' : (Math.ceil(estDays) + ' day' + (Math.ceil(estDays) > 1 ? 's' : ''))) : '';
            const tip = 'Realistic estimate from history (' + pred.confidence + ', ' + pred.n + ' runs)&#10;'
              + 'Predicted: ' + pred.predPcsHr + '/h @ ' + pred.predCycle + 's cycle&#10;'
              + 'Standard: ' + (stdPcsHr ? (stdPcsHr + '/h') : 'n/a') + (stdCt ? (' @ ' + stdCt + 's') : '') + '&#10;'
              + 'Reject ~' + pred.rejectRate + '%' + (daysTxt ? ('&#10;~' + daysTxt + ' to finish @ ' + HPD + 'h/day') : '');
            estBadge = '<div class="etv-card-est" style="color:' + col + ';background:' + bg + '" title="' + tip + '">'
              + '<i class="bi bi-graph-up" style="font-size:.58rem"></i> ~' + pred.predPcsHr + '/h' + deltaTxt
              + (daysTxt ? (' · ' + daysTxt) : '') + '</div>';
          }

          const orderDisp = (p.orderNo||'-');
          const mouldDisp = (p.mouldName || '-');
          const clientDisp = (p.clientName||'').length > 18 ? (p.clientName||'').slice(0,17)+'…' : (p.clientName||'');
          const stLabel = st === 'running' ? 'RUN' : st === 'stopped' ? 'STOP' : st === 'completed' ? 'DONE' : 'PLAN';

          const etvPid = String(p.id || p.planId || p.plan_id || '');

          /* ── Priority selection: pick key, order badge, picked highlight ──
             When selecting, the cell click adds/removes a priority item and
             drag is disabled so it doesn't fight with the click. */
          const pickKey = window.etvPriorityKey ? window.etvPriorityKey(m.code, i, p) : '';
          const prioIdx = (window.etvPrioritySelecting && window.etvPriorityCtx)
            ? window.etvPriorityCtx.items.findIndex(it => it._key === pickKey) : -1;
          const prioBadge = (prioIdx >= 0) ? `<span class="etv-prio-order-badge">${prioIdx + 1}</span>` : '';
          const prioPickedClass = (prioIdx >= 0) ? ' etv-prio-picked' : '';
          const cellOnClick = window.etvPrioritySelecting
            ? `window.etvPriorityPick('${esc(m.code)}', ${i})`
            : `window.openOrderModal('${esc(p.orderNo)}', '${esc(p.planId || p.plan_id || p.id || '')}')`;
          const cardDraggable = window.etvPrioritySelecting ? 'false' : 'true';

          return `
            <td class="etv-plan-cell" data-prio-key="${esc(pickKey)}" data-machine="${esc(m.code)}" data-slot="${i}" data-slot-pid="${esc(etvPid)}" ondragover="window.etvDragOverCell(event, this)" ondragleave="window.etvDragLeaveCell(event, this)" ondrop="window.etvDropCell(event, this)" onclick="${cellOnClick}" title="Order: ${esc(p.orderNo)}&#10;Mould: ${esc(p.mouldName)}&#10;Client: ${esc(p.clientName)}&#10;Qty: ${fmtQty(p.planQty)} | Bal: ${fmtQty(p.balQty)}">
              <div class="etv-card ${cardClass}${isUrgentChange ? ' etv-card-urgent' : ''}${prioPickedClass}" draggable="${cardDraggable}" data-pid="${esc(etvPid)}" data-machine="${esc(m.code)}" ondragstart="window.etvDragStart(event, this)" ondragend="window.etvDragEnd(event, this)" style="position:relative;${cardStyle}">
                <span class="etv-slot-num" title="Position ${i+1} on this machine">${i+1}</span>
                ${prioBadge}
                ${isPrevMould ? '<span class="etv-card-chg-badge">CHG</span>' : ''}
                ${changeBadge}
                ${p.machinePriority ? `<span class="etv-mp-badge" style="background:${'P1'===p.machinePriority?'#2563eb':'P2'===p.machinePriority?'#16a34a':'P3'===p.machinePriority?'#f59e0b':'#dc2626'}">${p.machinePriority}</span>` : ''}
                <div class="etv-card-row1">
                  <div class="etv-card-order">${esc(orderDisp)}</div>
                  <div class="etv-card-status ${statusClass}">${stLabel}</div>
                </div>
                <div class="etv-card-mould" title="${esc(p.mouldName || '')}">${esc(mouldDisp)}</div>
                ${clientDisp ? `<div style="font-size:.6rem;color:#64748b;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(clientDisp)}</div>` : ''}
                <div class="etv-card-qty">
                  <span>P:<strong>${fmtQty(p.planQty)}</strong></span>
                  <span class="${p.balQty > 0 ? 'bal-pos' : 'bal-done'}">B:<strong>${fmtQty(p.balQty)}</strong></span>
                </div>
                ${estBadge}
                ${(p.jcNo || p.jc_no || p.job_card_no) ? `<div onclick="if(window.openJcDrilldown)window.openJcDrilldown('${esc(p.jcNo||p.jc_no||p.job_card_no||'')}','${esc(p.jcNo||p.jc_no||p.job_card_no||'')}','${esc(p.planId||p.plan_id||'')}','${esc(p.orderNo||'')}'); event.stopPropagation();" style="font-size:.62rem;font-family:monospace;color:#2563eb;font-weight:700;text-decoration:underline;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px" title="Click: Colour/Shift/Hourly drill-down">JC: ${esc(p.jcNo||p.jc_no||p.job_card_no||'')} ↗</div>` : ''}
                ${dateBadge}
                ${timeBadge}
                <!-- P1-P4 MACHINE PRIORITY BUTTONS -->
                <div class="etv-mp-btns" onclick="event.stopPropagation()">
                  ${['P1','P2','P3','P4'].map(px => {
                    const isAct = p.machinePriority === px;
                    const cols = {P1:'#2563eb',P2:'#16a34a',P3:'#f59e0b',P4:'#dc2626'};
                    const c = cols[px];
                    return `<button class="etv-mp-btn${isAct?' etv-mp-btn-active':''}" data-color="${c}" style="${isAct?`background:${c};color:#fff;border-color:${c};`:`color:${c};border-color:${c};`}" onclick="window.etvSetMachinePriority('${esc(String(p.id||p.planId||p.plan_id||''))}','${esc(m.code)}','${px}',${isAct}); event.stopPropagation();" title="${isAct?'Clear '+px:'Set as '+px}">${px}</button>`;
                  }).join('')}
                </div>
              </div>
            </td>`;
        }).join('');

        rows.push(`<tr>${machCell}${planCells}</tr>`);
      });

      tbody.innerHTML = rows.join('');
    }

    /* ── Set / clear P1-P4 machine priority ─────────────────────────── */
    /* In-flight guard: planId → true while a save is in progress (Fix 3: race protection) */
    window._etvMpInFlight = window._etvMpInFlight || {};

    window.etvSetMachinePriority = async function (planId, machineCode, priority, isActive) {
      const key = String(planId) + '|' + machineCode;
      if (window._etvMpInFlight[key]) return; // Fix 3: block double-click

      /* Fix 8: visual save feedback — dim the button row while saving */
      const cardEl = document.querySelector(`.etv-plan-cell[data-slot-pid="${CSS.escape(String(planId))}"] .etv-mp-btns`);
      if (cardEl) { cardEl.style.opacity = '0.4'; cardEl.style.pointerEvents = 'none'; }

      window._etvMpInFlight[key] = true;
      const newPriority = isActive ? null : priority; // toggle: clear if already active

      try {
        const res = await fetch('/api/planning/machine-priority', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId, machine: machineCode, priority: newPriority })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to set priority');

        /* Fix 1: patch in-memory data — no API reload needed */
        const queue = (typeof etvGroups !== 'undefined' ? etvGroups : window.etvGroups || {})[machineCode];
        if (queue) {
          const pid = String(planId);
          const plan = queue.find(p => String(p.id||p.planId||p.plan_id||'') === pid);
          if (plan) {
            plan.machinePriority = newPriority || undefined;

            /* Fix 4: re-sort queue by new priority and recalculate ripple dates */
            queue.sort((a, b) => {
              if ((a.status||'').toUpperCase() === 'RUNNING') return -1;
              if ((b.status||'').toUpperCase() === 'RUNNING') return 1;
              const _o = {P1:1,P2:2,P3:3,P4:4};
              const pa = _o[a.machinePriority]||999, pb = _o[b.machinePriority]||999;
              if (pa !== pb) return pa - pb;
              return (Number(a.seq||0) - Number(b.seq||0)) || (Number(a.id||0) - Number(b.id||0));
            });
            const nowMs = Date.now();
            let cursor = nowMs;
            queue.forEach((p, i) => {
              const st = (p.status||'').toUpperCase(), isRun = st === 'RUNNING';
              const ct = Number(p.cycleTime||120), cav = Number(p.cavity||1);
              const pcsHr = ct > 0 ? (3600/ct)*cav : 30;
              const qty = Number(p.planQty||0), bal = Math.max(0, qty - Number(p.producedQty||0));
              p.balQty = bal;
              const durFull = (qty * 3600000) / pcsHr;
              const durBal  = (bal  * 3600000) / pcsHr;
              let start, endFixed, endExp;
              if (isRun) {
                start    = p.firstDprEntry ? new Date(p.firstDprEntry).getTime() : (p.startDate ? new Date(p.startDate).getTime() : nowMs);
                endFixed = start + durFull;
                endExp   = nowMs + durBal;
              } else {
                start    = (i === 0) ? nowMs : cursor;
                endFixed = start + durFull;
                endExp   = start + durBal;
              }
              p._rippledStartRaw = new Date(start);
              p._rippledEndRaw   = new Date(endFixed);
              p._rippledExpRaw   = new Date(endExp);
              cursor = endFixed;
            });
          }
        }

        /* Fix 2: re-render from memory — instant, zero API calls */
        if (typeof window.etvFilter === 'function') window.etvFilter();

        /* Fix 8: brief green flash on the saved card */
        const savedCard = document.querySelector(`.etv-plan-cell[data-slot-pid="${CSS.escape(String(planId))}"] .etv-card`);
        if (savedCard) {
          savedCard.style.transition = 'outline 0.15s';
          savedCard.style.outline = '2px solid #16a34a';
          setTimeout(() => { if (savedCard) savedCard.style.outline = ''; }, 600);
        }

      } catch (e) {
        console.error('[ETV priority]', e);
        /* Fix 2: rollback — re-enable buttons, no UI state change */
        if (cardEl) { cardEl.style.opacity = ''; cardEl.style.pointerEvents = ''; }
        /* Brief red toast */
        let toast = document.getElementById('etv-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'etv-toast';
          toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#dc2626;color:#fff;padding:10px 20px;border-radius:8px;font-weight:700;font-size:.85rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none;transition:opacity .3s';
          document.body.appendChild(toast);
        }
        toast.textContent = '✕ Couldn\'t save priority — ' + (e.message || 'try again');
        toast.style.opacity = '1';
        clearTimeout(window._etvToastTimer);
        window._etvToastTimer = setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 3000);
      } finally {
        delete window._etvMpInFlight[key];
        /* Fix 8: always restore button interactivity */
        if (cardEl) { cardEl.style.opacity = ''; cardEl.style.pointerEvents = ''; }
      }
    };

    /* ── Click machine name to search ───────────────────────────────── */
    window.etvMachineClick = function (code) {
      const inp = document.getElementById('etv-search');
      if (inp) { inp.value = code; window.etvFilter(); }
    };

    /* ── Smart Suggestions: mould-consolidation engine ───────────────────
       Goal: reduce unnecessary mould changes by grouping the SAME mould
       together. Two opportunity types:
         (1) cross   — same mould running/planned on machine A AND planned on
                       machine B → move B's plan onto A (next to A's block).
         (2) reorder — same mould appears non-adjacent on ONE machine → reorder
                       so the duplicates sit together.
       Constraints: never move a RUNNING plan; enforce tonnage compatibility
       (only consolidate onto a machine of the same tonnage class).            */

    const etvPlanId = p => String((p && (p.id || p.planId || p.plan_id)) || '').trim();
    const etvIsRunning = p => String((p && p.status) || '').toLowerCase() === 'running';
    const etvMachByCode = code => etvMachines.find(m => m.code === code) || null;
    const etvTon = code => { const m = etvMachByCode(code); return m ? String(m._tonnage || '').trim() : ''; };

    function etvBuildSuggestions() {
      const suggestions = [];
      const codes = Object.keys(etvGroups);

      /* index: mouldKey -> [{ code, idx, plan, running }] (skip blanks) */
      const index = {};
      codes.forEach(code => {
        (etvGroups[code] || []).forEach((p, idx) => {
          const k = mouldKey(p);
          if (!k || k === '-') return;
          (index[k] = index[k] || []).push({ code, idx, plan: p, running: etvIsRunning(p) });
        });
      });

      /* (1) CROSS-MACHINE consolidation */
      Object.keys(index).forEach(k => {
        const occ = index[k];
        const machinesWith = [...new Set(occ.map(o => o.code))];
        if (machinesWith.length < 2) return;

        /* anchor = machine that is RUNNING this mould (preferred), else the one
           with the earliest/most occurrences */
        let anchor = occ.find(o => o.running)?.code;
        if (!anchor) {
          const counts = {};
          occ.forEach(o => counts[o.code] = (counts[o.code] || 0) + 1);
          anchor = machinesWith.sort((a, b) => (counts[b] - counts[a]))[0];
        }
        const anchorTon = etvTon(anchor);

        machinesWith.filter(c => c !== anchor).forEach(srcCode => {
          /* only move PLANNED (non-running) occurrences from the source machine */
          const movable = occ.filter(o => o.code === srcCode && !o.running);
          if (!movable.length) return;
          /* enforce tonnage: source machine class must match the anchor class */
          if (anchorTon && etvTon(srcCode) && etvTon(srcCode) !== anchorTon) return;

          movable.forEach(o => {
            const pid = etvPlanId(o.plan);
            if (!pid) return;
            /* drop right after the anchor's same-mould block so it sits adjacent */
            const anchorPlans = etvGroups[anchor] || [];
            let afterIdx = -1;
            for (let i = 0; i < anchorPlans.length; i++) { if (mouldKey(anchorPlans[i]) === k) afterIdx = i; }
            const dropBeforePlan = (afterIdx >= 0 && anchorPlans[afterIdx + 1]) ? anchorPlans[afterIdx + 1] : null;
            suggestions.push({
              type: 'cross',
              mould: o.plan.mouldName || o.plan.mouldNo || k,
              fromCode: srcCode,
              toCode: anchor,
              rowId: pid,
              targetMachine: (anchorPlans[0] && anchorPlans[0].machine) || anchor,
              dropBeforeId: dropBeforePlan ? etvPlanId(dropBeforePlan) : null,
              order: o.plan.orderNo || '',
              saved: 1,
              reason: `Mould "${o.plan.mouldName || o.plan.mouldNo || k}" is already on ${stripMachPfx(anchor)} but also planned on ${stripMachPfx(srcCode)}. Move it onto ${stripMachPfx(anchor)} to avoid a separate setup.`
            });
          });
        });
      });

      /* (2) SAME-MACHINE non-adjacent reorder */
      codes.forEach(code => {
        const plans = etvGroups[code] || [];
        if (plans.length < 3) return;
        const seen = {};       // mouldKey -> first index
        let hasGap = false;
        plans.forEach((p, i) => {
          const k = mouldKey(p); if (!k || k === '-') return;
          if (seen[k] === undefined) seen[k] = i;
          else if (i > seen[k] + 1) hasGap = true; // duplicate not adjacent to its group
        });
        if (!hasGap) return;

        /* Build a grouped order: keep first appearance order of each mould, but
           pull every later duplicate up next to its group. Running stays first. */
        const runningIds = plans.filter(etvIsRunning).map(etvPlanId);
        const groupsOrder = [];          // mouldKeys in first-seen order
        const buckets = {};              // mouldKey -> [plans]
        plans.forEach(p => {
          const k = mouldKey(p);
          if (!buckets[k]) { buckets[k] = []; groupsOrder.push(k); }
          buckets[k].push(p);
        });
        const orderedIds = [];
        groupsOrder.forEach(k => buckets[k].forEach(p => orderedIds.push(etvPlanId(p))));
        /* ensure running plans remain at the very front */
        const finalIds = [...runningIds, ...orderedIds.filter(id => !runningIds.includes(id))];

        /* count how many adjacency-breaks we fix */
        let saved = 0;
        plans.forEach((p, i) => { if (i > 0 && mouldKey(p) !== mouldKey(plans[i - 1])) saved++; });
        let savedAfter = 0;
        finalIds.forEach((id, i) => {
          if (i === 0) return;
          const a = plans.find(p => etvPlanId(p) === finalIds[i - 1]);
          const b = plans.find(p => etvPlanId(p) === id);
          if (a && b && mouldKey(a) !== mouldKey(b)) savedAfter++;
        });
        const delta = saved - savedAfter;
        if (delta <= 0) return;

        suggestions.push({
          type: 'reorder',
          mould: '',
          toCode: code,
          machine: (plans[0] && plans[0].machine) || code,
          orderedIds: finalIds,
          saved: delta,
          reason: `On ${stripMachPfx(code)}, the same mould is planned in non-adjacent slots. Re-group them to remove ${delta} extra mould change${delta > 1 ? 's' : ''}.`
        });
      });

      /* highest savings first */
      suggestions.sort((a, b) => (b.saved - a.saved));
      return suggestions;
    }

    /* ── Smart Suggestions: panel ──────────────────────────────────────── */
    window.etvSmartSuggest = function () {
      const list = etvBuildSuggestions();
      window._etvSuggestions = list;

      const cards = list.map((s, i) => {
        const cls = s.type === 'cross' ? 'cross' : 'reorder';
        const title = s.type === 'cross'
          ? `Move "${esc(s.mould)}" → ${esc(stripMachPfx(s.toCode))}`
          : `Re-group moulds on ${esc(stripMachPfx(s.toCode))}`;
        return `
          <div class="etv-sg-card ${cls}" id="etv-sg-card-${i}">
            <div class="sg-txt">
              <div class="sg-mould">${title}</div>
              <div class="sg-detail">${esc(s.reason)}</div>
              <span class="sg-save"><i class="bi bi-arrow-down-circle"></i> Saves ${s.saved} mould change${s.saved > 1 ? 's' : ''}</span>
            </div>
            <button class="etv-sg-apply" onclick="window.etvApplySuggestion(${i}, this)">Apply</button>
          </div>`;
      }).join('');

      const body = list.length
        ? cards
        : `<div class="etv-sg-empty"><i class="bi bi-check2-circle"></i>Your plan is already optimal — no mould changes to reduce right now.</div>`;

      const totalSaved = list.reduce((s, x) => s + (x.saved || 0), 0);

      const html = `
        <div id="etv-suggest-overlay" onclick="if(event.target===this)window.etvCloseSuggest()">
          <div id="etv-suggest-modal">
            <div class="etv-sg-head">
              <h3><i class="bi bi-stars"></i> Smart Suggestions</h3>
              <button onclick="window.etvCloseSuggest()" title="Close">&times;</button>
            </div>
            <div class="etv-sg-sub">
              <span><strong>${list.length}</strong> suggestion${list.length === 1 ? '' : 's'} found</span>
              ${list.length ? `<span style="color:#047857;font-weight:800">Total: ${totalSaved} mould change${totalSaved === 1 ? '' : 's'} saved</span>` : ''}
              <button class="etv-sg-joybtn" onclick="window.etvAskJoy(this)" title="Let Joy explain these suggestions in plain language"><i class="bi bi-stars"></i> Ask Joy</button>
            </div>
            <div class="etv-joy-box" id="etv-joy-box" style="display:none"></div>
            <div class="etv-sg-body" id="etv-sg-body">${body}</div>
            ${list.length ? `
              <div class="etv-sg-foot">
                <span style="font-size:.72rem;color:#64748b">Applying changes the live plan and re-sequences machines.</span>
                <button class="etv-sg-applyall" onclick="window.etvApplyAll(this)"><i class="bi bi-shuffle"></i> Apply All (Shuffle)</button>
              </div>` : ''}
          </div>
        </div>`;

      const old = document.getElementById('etv-suggest-overlay');
      if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
    };

    window.etvCloseSuggest = function () {
      const o = document.getElementById('etv-suggest-overlay');
      if (o) o.remove();
    };

    /* ── Ask Joy: natural-language explanation of the suggestions ───────── */
    window.etvAskJoy = async function (btn) {
      const box = document.getElementById('etv-joy-box');
      if (!box) return;
      const list = window._etvSuggestions || [];
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Thinking…'; }
      box.style.display = 'block';
      box.innerHTML = '<div class="joy-loading"><i class="bi bi-stars"></i> Joy is thinking…</div>';
      try {
        const payload = list.map(s => ({
          type: s.type, mould: s.mould || '', fromCode: stripMachPfx(s.fromCode || ''),
          toCode: stripMachPfx(s.toCode || ''), saved: s.saved || 0, reason: s.reason || ''
        }));
        let user = '';
        try { user = (window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.getUser && (window.JPSMS.auth.getUser().username || window.JPSMS.auth.getUser().name)) || ''; } catch (e) {}
        const res = await getApi().post('/ai/explain-suggestions', { suggestions: payload, username: user });
        if (res && res.ok && res.answer) {
          const text = String(res.answer);
          const htmlText = esc(text).replace(/\n/g, '<br>');
          const tag = res.source === 'joy' ? '<span class="joy-tag">⚡️ Joy</span>' : '<span class="joy-tag local">📋 Summary</span>';
          box.innerHTML = `<div class="joy-head">${tag}</div><div class="joy-msg">${htmlText}</div>`;
        } else {
          box.innerHTML = '<div class="joy-msg">Joy could not explain right now. Please try again.</div>';
        }
      } catch (e) {
        box.innerHTML = '<div class="joy-msg">Joy is unavailable right now. Please try again.</div>';
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-stars"></i> Ask Joy'; }
      }
    };

    /* update the count badge on the Smart Suggestions button */
    window.etvUpdateSmartBadge = function () {
      const badge = document.getElementById('etv-smart-badge');
      if (!badge) return;
      try {
        const n = etvBuildSuggestions().length;
        if (n > 0) { badge.textContent = n; badge.style.display = 'inline-block'; }
        else { badge.style.display = 'none'; }
      } catch (e) { badge.style.display = 'none'; }
    };

    /* perform ONE suggestion's API call (no reload) */
    async function etvDoSuggestion(s) {
      const api = getApi();
      if (s.type === 'cross') {
        return api.post('/planning/move', { rowId: s.rowId, targetMachine: s.targetMachine, dropBeforeId: s.dropBeforeId || null });
      }
      return api.post('/planning/reseq', { machine: s.machine, orderedIds: s.orderedIds });
    }

    window.etvApplySuggestion = async function (i, btn) {
      const s = (window._etvSuggestions || [])[i];
      if (!s) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
      try {
        const res = await etvDoSuggestion(s);
        if (res && res.ok) {
          if (btn) { btn.textContent = 'Done ✓'; btn.style.background = '#16a34a'; }
          const card = document.getElementById('etv-sg-card-' + i);
          if (card) card.style.opacity = '.5';
          // reload the timeline data so subsequent suggestions stay valid
          if (typeof window.loadExcelTimeline === 'function') window.loadExcelTimeline();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
          alert('Could not apply: ' + ((res && res.error) || 'unknown error'));
        }
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
        alert('Request failed: ' + e.message);
      }
    };

    window.etvApplyAll = async function (btn) {
      const list = window._etvSuggestions || [];
      if (!list.length) return;
      if (!confirm('Apply all ' + list.length + ' suggestions? This will move and re-sequence plans.')) return;
      if (btn) { btn.disabled = true; btn.innerHTML = 'Applying…'; }
      let okCount = 0, failCount = 0;
      /* apply sequentially; skip ones whose plan id no longer exists is handled server-side */
      for (const s of list) {
        try { const res = await etvDoSuggestion(s); if (res && res.ok) okCount++; else failCount++; }
        catch (e) { failCount++; }
      }
      window.etvCloseSuggest();
      if (typeof window.loadExcelTimeline === 'function') window.loadExcelTimeline();
      if (window.JPSMS && window.JPSMS.toast) {
        window.JPSMS.toast(`Applied ${okCount} suggestion${okCount === 1 ? '' : 's'}${failCount ? ', ' + failCount + ' skipped' : ''}.`);
      } else {
        alert(`Applied ${okCount} suggestion(s).` + (failCount ? ` ${failCount} skipped.` : ''));
      }
    };

    /* ── Excel View: drag-to-slot reorder ──────────────────────────────────
       Mirror the Machine Timeline drag UX inside the grid. Each plan card is
       draggable; every cell (filled or empty) is a numbered drop slot. Dropping
       on slot N reorders/moves the plan to position N on that machine. The shared
       window.confirmMove(planData, targetMachine, dropBeforeId, position) drives
       the confirm modal + executeMove (which is now Excel-View aware).          */
    function etvFindPlan(machine, pid) {
      const list = (etvGroups && etvGroups[machine]) || [];
      return list.find(p => String(p.id || p.planId || p.plan_id || '') === String(pid)) || null;
    }

    window.etvDragStart = function (e, cardEl) {
      if (!JPSMS.auth.can('planning', 'edit')) { e.preventDefault(); JPSMS.toast('Read Only Mode: You cannot move plans.', 'error'); return; }
      const machine = cardEl.dataset.machine;
      const pid = cardEl.dataset.pid;
      const plan = etvFindPlan(machine, pid);
      if (!plan) { e.preventDefault(); return; }
      window.draggedPlan = Object.assign({}, plan, {
        id: String(plan.id || plan.planId || plan.plan_id || pid),
        machine: machine,
        el: cardEl
      });
      cardEl.classList.add('etv-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pid); } catch (_) {}
    };

    window.etvDragEnd = function (e, cardEl) {
      if (cardEl) cardEl.classList.remove('etv-dragging');
      document.querySelectorAll('.etv-plan-cell.etv-drop-hot').forEach(td => td.classList.remove('etv-drop-hot'));
      window.draggedPlan = null;
    };

    window.etvDragOverCell = function (e, td) {
      if (!window.draggedPlan) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      // No-op highlight if hovering the dragged card's own slot
      if (String(td.dataset.slotPid || '') === String(window.draggedPlan.id)) return;
      td.classList.add('etv-drop-hot');
    };

    window.etvDragLeaveCell = function (e, td) {
      td.classList.remove('etv-drop-hot');
    };

    window.etvDropCell = function (e, td) {
      e.preventDefault();
      e.stopPropagation();
      td.classList.remove('etv-drop-hot');
      if (!window.draggedPlan) return;
      if (!JPSMS.auth.can('planning', 'edit')) { JPSMS.toast('Read Only Mode: You cannot move plans.', 'error'); return; }

      const targetMachine = td.dataset.machine;
      const slot = parseInt(td.dataset.slot, 10) || 0;
      const slotPid = td.dataset.slotPid || '';

      // Dropping onto its own slot → no-op
      if (slotPid && String(slotPid) === String(window.draggedPlan.id)) return;

      // dropBeforeId = the plan currently occupying this slot (insert before it).
      // Empty slot (no slotPid) → append to end (dropBeforeId null).
      const dropBeforeId = slotPid || null;
      // Position shown in the confirm modal. When inserting before a real card the
      // slot index is the final position. When appending to a trailing empty slot the
      // final position is the actual plan count (+1), since the backend appends to the
      // end rather than the column index. Exclude the dragged plan if it already lives
      // on the target machine (it is removed before re-insertion).
      let position;
      if (dropBeforeId) {
        position = slot + 1;
      } else {
        const machineList = (etvGroups && etvGroups[targetMachine]) || [];
        const draggedOnTarget = machineList.some(p => String(p.id || p.planId || p.plan_id || '') === String(window.draggedPlan.id));
        position = machineList.length + (draggedOnTarget ? 0 : 1);
      }
      window.confirmMove(window.draggedPlan, targetMachine, dropBeforeId, position);
    };

  })();

  /* ---- Live Tab Sync ---------------------------------------------------- */
  // Throttle: at most once every 30 s — prevents rapid-fire coworker saves from
  // reloading the plan board repeatedly and disrupting the current view.
  var _planLiveRefreshLastAt = 0;
  var _PLAN_LIVE_REFRESH_MIN_MS = 30000;

  window.addEventListener('jpsms:live-refresh', function (e) {
    var mod = (e.detail || {}).module;
    if (mod !== 'planning' && mod !== 'dpr') return;
    // Don't reload if the Create Plan modal is open — would disrupt an in-progress plan
    var cpModal = document.getElementById('newCreatePlanModal');
    if (cpModal && cpModal.classList && cpModal.classList.contains('show')) return;
    var now = Date.now();
    if (now - _planLiveRefreshLastAt < _PLAN_LIVE_REFRESH_MIN_MS) return; // throttle
    _planLiveRefreshLastAt = now;
    if (typeof window.loadMasterPlan === 'function') window.loadMasterPlan();
  });
  /* ----------------------------------------------------------------------- */