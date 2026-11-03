/* Machine status names and colours shared by DPR Compliance Summary (dpr-script-1.js)
   and the Planning Machine Grid (planning-script-3.js). Change a reason here and both
   pages follow. Keys are dpr_hourly entry_type values. */
(function () {
  // DPR quick-action reasons (stoppages)
  window.JMS_QUICK_ACTION_META = {
    Maintenance:      { label: 'Machine Maintenance', short: 'M/C Maint',   code: 'M/C',     icon: 'bi-tools',                 color: '#713f12', bg: '#fde047', bd: '#eab308' },
    ManPowerShortage: { label: 'Manpower Shortage',   short: 'MP Short',    code: 'MP',      icon: 'bi-person-slash',          color: '#b91c1c', bg: '#fee2e2', bd: '#fca5a5' },
    NoPlan:           { label: 'No Plan',             short: 'No Plan',     code: 'No Plan', icon: 'bi-calendar-x',            color: '#e11d48', bg: '#fff1f2', bd: '#fda4af' },
    MouldMaintenance: { label: 'Mould Maintenance',   short: 'Mould Maint', code: 'Mould',   icon: 'bi-wrench-adjustable',     color: '#a16207', bg: '#fefce8', bd: '#fde047' },
    MouldTrial:       { label: 'Mould Trial',         short: 'Trial',       code: 'Trial',   icon: 'bi-clipboard2-pulse',      color: '#7c3aed', bg: '#f5f3ff', bd: '#ddd6fe' },
    PowerCut:         { label: 'Power Cut',           short: 'Power Cut',   code: 'Power',   icon: 'bi-lightning-charge-fill', color: '#1e40af', bg: '#eff6ff', bd: '#bfdbfe' },
    MouldChangeover:  { label: 'Mould Changeover',    short: 'Mould C/O',   code: 'C/O',     icon: 'bi-arrow-repeat',          color: '#b91c1c', bg: '#fee2e2', bd: '#fca5a5' }
  };
  // Grid-only states that are not DPR reasons
  window.JMS_MACHINE_STATE_META = {
    Running:  { label: 'Running',      short: 'Running',   icon: 'bi-play-circle-fill', color: '#166534', bg: '#dcfce7', bd: '#86efac' },
    Planned:  { label: 'Planned',      short: 'Planned',   icon: 'bi-calendar-check',   color: '#0369a1', bg: '#e0f2fe', bd: '#7dd3fc' },
    Stopped:  { label: 'Stopped',      short: 'Stopped',   icon: 'bi-stop-circle-fill', color: '#b91c1c', bg: '#fee2e2', bd: '#fca5a5' },
    Off:      { label: 'Off',          short: 'Off',       icon: 'bi-power',            color: '#475569', bg: '#f1f5f9', bd: '#cbd5e1' },
    PlantOff: { label: 'Plant off',    short: 'Plant off', icon: 'bi-moon-stars',       color: '#475569', bg: '#f1f5f9', bd: '#cbd5e1' }
  };
})();
