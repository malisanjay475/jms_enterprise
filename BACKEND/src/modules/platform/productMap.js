'use strict';

/**
 * Product map for JMS Enterprise.
 *
 * This is the contract the redesign builds toward. It does not move routes
 * and it does not change shop-floor behaviour. Every later module extraction
 * should match an id in MODULES, hang off plan_id + factory_id, and keep the
 * preserve notes. GET /api/platform/map serves getProductMap() as JSON.
 *
 * Spine: requirement → plan → run → quality → move → dispatch.
 * Support modules (people, stores, sync, identity) sit beside the spine.
 */

const STAGES = [
  { id: 'requirement', name: 'Requirement', question: 'What must the plant make?' },
  { id: 'plan', name: 'Plan', question: 'Which machine, mould, and shift?' },
  { id: 'run', name: 'Run', question: 'What did this hour actually produce?' },
  { id: 'quality', name: 'Quality', question: 'May this job move?' },
  { id: 'move', name: 'Move', question: 'Where is the batch now?' },
  { id: 'dispatch', name: 'Dispatch', question: 'What left, and what is still open?' }
];

const MODULES = [
  {
    id: 'orders',
    name: 'Orders',
    stageId: 'requirement',
    purpose: 'Commercial orders and ERP job requirements that planning consumes.',
    target: 'One order record. or_jr_no and order_no hang off the plan; the floor never retypes them.',
    primaryHref: 'order_tracker.html',
    primaryLabel: 'Open order tracker',
    clients: ['web'],
    preserve: ['Orders sync on order_no + factory_id'],
    pages: [
      { href: 'order_tracker.html', name: 'Order tracker', disposition: 'keep' },
      { href: 'raw_material_jobwise.html', name: 'Jobwise raw material', disposition: 'keep' }
    ]
  },
  {
    id: 'npd',
    name: 'New product',
    stageId: 'requirement',
    purpose: 'Stage tracker for a mould or product that is not yet a running job.',
    target: 'NPD ends by creating a plan. It does not grow a second production log.',
    primaryHref: 'npd.html',
    primaryLabel: 'Open NPD',
    clients: ['web'],
    preserve: [],
    pages: [
      { href: 'npd.html', name: 'NPD tracker', disposition: 'keep' }
    ]
  },
  {
    id: 'planning',
    name: 'Planning',
    stageId: 'plan',
    purpose: 'Which job runs on which machine, in which shift.',
    target: 'One planning board. plan_id is the id every later module stores.',
    primaryHref: 'planning.html',
    primaryLabel: 'Open planning board',
    clients: ['web'],
    preserve: ['GET /api/planning/board keeps DISTINCT ON (pb.id) so duplicate machine rows cannot double-render'],
    pages: [
      { href: 'planning.html', name: 'Planning board', disposition: 'keep' }
    ]
  },
  {
    id: 'masters',
    name: 'Masters',
    stageId: 'plan',
    purpose: 'Machines, moulds, products, clients, and shifting locations.',
    target: 'Reference data only. Production numbers are never typed here.',
    primaryHref: 'masters.html',
    primaryLabel: 'Open masters',
    clients: ['web'],
    preserve: ['Moulds sync on mould_number + factory_id', 'Machines sync on machine + factory_id'],
    pages: [
      { href: 'masters.html', name: 'Masters', disposition: 'keep' }
    ]
  },
  {
    id: 'production',
    name: 'Production',
    stageId: 'run',
    purpose: 'Hourly good, reject, and downtime against the running plan.',
    target: 'One hour-entry task. DPR, the supervisor portal, and reports all read the same dpr_hourly rows.',
    primaryHref: 'dpr.html',
    primaryLabel: 'Open DPR',
    clients: ['web', 'android-qc'],
    preserve: ['dpr_hourly syncs on global_id, not serial id', 'Change counts stay in src/modules/dpr/changeCounts.js'],
    pages: [
      { href: 'dpr.html', name: 'Daily production report', disposition: 'keep' },
      { href: 'dpr_daily_report.html', name: 'Daily report', disposition: 'keep' },
      { href: 'supervisor.html', name: 'Moulding supervisor portal', disposition: 'keep' },
      { href: 'production_dashboard.html', name: 'Production dashboard', disposition: 'keep' },
      { href: 'job_summary.html', name: 'Job summary', disposition: 'keep' }
    ]
  },
  {
    id: 'machines',
    name: 'Machines',
    stageId: 'run',
    purpose: 'Live machine state from the hourly log and from the KEBA collector.',
    target: 'A stopped machine is visible in the same shift window the supervisor is entering.',
    primaryHref: 'pulse.html',
    primaryLabel: 'Open live machines',
    clients: ['web', 'collector'],
    preserve: ['Ingest stays on POST /api/machine-data/ingest with the ingest key', 'Collector register map stays shared with kebaProfile.js'],
    pages: [
      { href: 'pulse.html', name: 'Pulse live tracker', disposition: 'keep' },
      { href: 'machine_monitor.html', name: 'Machine monitor', disposition: 'keep' },
      { href: 'machine_data.html', name: 'Machine data', disposition: 'keep' },
      { href: 'machine_data_all.html', name: 'All machine data', disposition: 'keep' }
    ]
  },
  {
    id: 'quality',
    name: 'Quality',
    stageId: 'quality',
    purpose: 'Setup, in-process checks, holds, and first-piece approval.',
    target: 'Quality can hold a plan_id before shifting will accept it. Desktop and phone use one API.',
    primaryHref: 'Quality.html',
    primaryLabel: 'Open quality',
    clients: ['web', 'android-qc'],
    preserve: ['QC slot identity stays machine + dpr_date + shift + slot'],
    pages: [
      { href: 'Quality.html', name: 'Quality dashboard', disposition: 'keep' },
      { href: 'QCSupervisor.html', name: 'QC supervisor portal', disposition: 'keep' },
      { href: 'fpa.html', name: 'First piece approval', disposition: 'keep' },
      { href: 'qc_memo.html', name: 'QC memo', disposition: 'keep' },
      { href: 'qc_setup_report.html', name: 'Setup report', disposition: 'keep' },
      { href: 'qc-app-publish.html', name: 'QC app publish', disposition: 'keep' }
    ]
  },
  {
    id: 'assembly',
    name: 'Assembly and grinding',
    stageId: 'move',
    purpose: 'Secondary operations and packing scans after moulding.',
    target: 'A scan posts a quantity against the plan. It does not open a new job.',
    primaryHref: 'assembly.html',
    primaryLabel: 'Open assembly',
    clients: ['web', 'bridge'],
    preserve: ['POST /api/assembly/device-scan stays on the device key', 'Scanner bridge stays on WebSocket port 8999'],
    pages: [
      { href: 'assembly.html', name: 'Assembly planning', disposition: 'keep' },
      { href: 'grinding.html', name: 'Grinding', disposition: 'keep' },
      { href: 'packing_settings.html', name: 'Packing settings', disposition: 'keep' },
      { href: 'scanning.html', name: 'Production scanning', disposition: 'keep' },
      { href: 'scanning_list.html', name: 'Scanning list', disposition: 'keep' },
      { href: 'scanning_dashboard.html', name: 'Scanning dashboard', disposition: 'keep' },
      { href: 'label-scan.html', name: 'Label scan', disposition: 'keep' },
      { href: 'barcode_printer.html', name: 'Barcode printer', disposition: 'keep' }
    ]
  },
  {
    id: 'shifting',
    name: 'Shifting and WIP',
    stageId: 'move',
    purpose: 'Where each batch physically is, moved by scan or by a supervisor entry.',
    target: 'One movement log. The phone portal and the live report read shifting_records.',
    primaryHref: 'shifting_reports.html',
    primaryLabel: 'Open live shifting',
    clients: ['web', 'android-shifting'],
    preserve: ['shifting_records sync on sync_id', 'Destinations come from shifting_locations, edited on MAIN'],
    pages: [
      { href: 'shifting_reports.html', name: 'Live shifting', disposition: 'keep' },
      { href: 'shifting_supervisor.html', name: 'Shifting supervisor portal', disposition: 'keep' },
      { href: 'shifting_manual_entry.html', name: 'Manual entry', disposition: 'keep' },
      { href: 'shifting_shift_report.html', name: 'Shift report', disposition: 'keep' },
      { href: 'shifting_summary.html', name: 'Shifting summary', disposition: 'keep' },
      { href: 'shifting_logs.html', name: 'Shifting logs', disposition: 'keep' },
      { href: 'shifting.html', name: 'Retired shifting entry', disposition: 'retire' },
      { href: 'wip.html', name: 'WIP', disposition: 'keep' },
      { href: 'wip_supervisor.html', name: 'WIP supervisor portal', disposition: 'keep' }
    ]
  },
  {
    id: 'reports',
    name: 'Reports',
    stageId: 'dispatch',
    purpose: 'What the plant made, held, moved, and still owes.',
    target: 'Reports are projections of plan, DPR, QC, and shifting. They are not a second place to type output.',
    primaryHref: 'reports.html',
    primaryLabel: 'Open reports',
    clients: ['web'],
    preserve: [],
    pages: [
      { href: 'reports.html', name: 'Reports', disposition: 'keep' },
      { href: 'analyze.html', name: 'Analyze', disposition: 'keep' }
    ]
  },
  {
    id: 'purchasing',
    name: 'Purchasing',
    stageId: 'support',
    purpose: 'Vendors, purchase orders, and goods receipt.',
    target: 'Material arrives against a PO and can be named on the job that consumes it.',
    primaryHref: 'purchase_orders.html',
    primaryLabel: 'Open purchase orders',
    clients: ['web'],
    preserve: [],
    pages: [
      { href: 'purchase_orders.html', name: 'Purchase orders', disposition: 'keep' },
      { href: 'purchase_vendors.html', name: 'Vendors', disposition: 'keep' },
      { href: 'purchase_grn.html', name: 'Goods receipt', disposition: 'keep' },
      { href: 'vendor/dashboard.html', name: 'Vendor dashboard', disposition: 'keep' },
      { href: 'vendor/my_orders.html', name: 'Vendor orders', disposition: 'keep' },
      { href: 'vendor/dispatch.html', name: 'Vendor dispatch', disposition: 'keep' },
      { href: 'vendor/login.html', name: 'Vendor login', disposition: 'keep' }
    ]
  },
  {
    id: 'hr',
    name: 'People',
    stageId: 'support',
    purpose: 'Employees, attendance context, performance, and interviews.',
    target: 'One employee record. Labour on a DPR hour points at it; hr_new.html folds back into hr.html.',
    primaryHref: 'hr.html',
    primaryLabel: 'Open HR',
    clients: ['web'],
    preserve: [],
    pages: [
      { href: 'hr.html', name: 'HR', disposition: 'keep' },
      { href: 'hr_new.html', name: 'HR (parallel page)', disposition: 'merge' },
      { href: 'hr_performance.html', name: 'Performance', disposition: 'keep' },
      { href: 'hr_interview_panel.html', name: 'Interview panel', disposition: 'keep' }
    ]
  },
  {
    id: 'maintenance',
    name: 'Maintenance',
    stageId: 'support',
    purpose: 'Mould and machine work that explains downtime on the hour log.',
    target: 'A maintenance reason on the hour is the same event Pulse and the supervisor portal show.',
    primaryHref: 'maintenance.html',
    primaryLabel: 'Open maintenance',
    clients: ['web'],
    preserve: [],
    pages: [
      { href: 'maintenance.html', name: 'Maintenance', disposition: 'keep' }
    ]
  },
  {
    id: 'chat',
    name: 'Chat',
    stageId: 'support',
    purpose: 'Plant messaging. Not a production record.',
    target: 'Chat stays a separate product with its own session. It never becomes the system of record for a job.',
    primaryHref: 'chat_app.html',
    primaryLabel: 'Open chat',
    clients: ['web', 'android-chat', 'mac-chat'],
    preserve: ['Chat session stays scoped away from the ERP session'],
    pages: [
      { href: 'chat_app.html', name: 'Chat', disposition: 'keep' },
      { href: 'chat_admin.html', name: 'Chat admin', disposition: 'keep' },
      { href: 'chat_users.html', name: 'Chat users', disposition: 'keep' }
    ]
  },
  {
    id: 'sync',
    name: 'Factory sync',
    stageId: 'support',
    purpose: 'LOCAL keeps producing when the internet drops, then reconciles to MAIN.',
    target: 'HTTP sync with natural keys and tombstones stays. Database replication between sites does not replace it.',
    primaryHref: 'sync_monitor.html',
    primaryLabel: 'Open sync monitor',
    clients: ['web', 'desktop-local'],
    preserve: [
      'CONFLICT_KEYS and sync_deletions stay the sync algebra',
      'Startup order stays wait-postgres, then auto-import, then the server'
    ],
    pages: [
      { href: 'sync_monitor.html', name: 'Sync monitor', disposition: 'keep' },
      { href: 'download-local-server.html', name: 'Download local server', disposition: 'keep' }
    ]
  },
  {
    id: 'identity',
    name: 'Access',
    stageId: 'support',
    purpose: 'Login, roles, factories, and settings.',
    target: 'One session. Floor portals and the office shell read the same user and the same factory scope.',
    primaryHref: 'users.html',
    primaryLabel: 'Open users',
    clients: ['web'],
    preserve: ['Factory scope stays X-Factory-Id and LOCAL_FACTORY_ID', 'Superadmin matches role_code or username superadmin'],
    pages: [
      { href: 'login.html', name: 'Login', disposition: 'keep' },
      { href: 'users.html', name: 'Users', disposition: 'keep' },
      { href: 'settings.html', name: 'Settings', disposition: 'keep' },
      { href: 'management.html', name: 'Management', disposition: 'keep' },
      { href: 'notifications.html', name: 'Notifications', disposition: 'keep' },
      { href: 'activity-monitor.html', name: 'Activity monitor', disposition: 'keep' },
      { href: 'joy.html', name: 'Training', disposition: 'keep' }
    ]
  }
];

const WORKSPACES = [
  {
    id: 'planning',
    name: 'Planning',
    promise: 'Put the right job on the right machine before the shift starts.',
    primaryHref: 'planning.html',
    primaryLabel: 'Open the planning board',
    roles: ['planning', 'planner'],
    stageId: 'plan',
    moduleIds: ['orders', 'npd', 'planning', 'masters', 'reports']
  },
  {
    id: 'moulding',
    name: 'Moulding floor',
    promise: 'Record this hour at the machine. Large targets, no office menu.',
    primaryHref: 'supervisor.html',
    primaryLabel: 'Open hourly entry',
    roles: ['supervisor'],
    stageId: 'run',
    moduleIds: ['production', 'machines', 'quality']
  },
  {
    id: 'quality',
    name: 'Quality floor',
    promise: 'Pass, hold, or reject the running job before it moves.',
    primaryHref: 'QCSupervisor.html',
    primaryLabel: 'Open QC entry',
    roles: ['qc_supervisor', 'quality'],
    stageId: 'quality',
    moduleIds: ['quality', 'production', 'reports']
  },
  {
    id: 'shifting',
    name: 'Movement floor',
    promise: 'Scan the batch into its next location. One movement, one record.',
    primaryHref: 'shifting_supervisor.html',
    primaryLabel: 'Open shifting entry',
    roles: ['shifting_supervisor'],
    stageId: 'move',
    moduleIds: ['shifting', 'assembly', 'production']
  },
  {
    id: 'people',
    name: 'People',
    promise: 'Keep the employee record that labour hours point at.',
    primaryHref: 'hr.html',
    primaryLabel: 'Open HR',
    roles: ['hr'],
    stageId: 'support',
    moduleIds: ['hr', 'identity']
  },
  {
    id: 'stores',
    name: 'Stores',
    promise: 'Receive material against a purchase order.',
    primaryHref: 'purchase_orders.html',
    primaryLabel: 'Open purchase orders',
    roles: ['purchase', 'purchaser', 'stores'],
    stageId: 'support',
    moduleIds: ['purchasing', 'orders', 'masters']
  },
  {
    id: 'plant',
    name: 'Plant command',
    promise: 'See the job from requirement to dispatch, then open the module that needs a decision.',
    primaryHref: 'pulse.html',
    primaryLabel: 'Open live machines',
    roles: ['admin', 'superadmin', 'manager'],
    stageId: 'run',
    moduleIds: ['planning', 'production', 'machines', 'quality', 'shifting', 'reports'],
    fallback: true
  }
];

const PRINCIPLES = [
  { id: 'spine', text: 'plan_id plus factory_id is the job. Orders, DPR, quality, and shifting hang off that pair.' },
  { id: 'one-entry', text: 'A quantity is typed once, on the floor, in the hour it happens. Reports only read it.' },
  { id: 'two-shells', text: 'The office uses one shell. The floor uses one phone shell. They are not 64 separate designs.' },
  { id: 'offline', text: 'The factory LOCAL server keeps running without the internet, then syncs with natural keys and tombstones.' },
  { id: 'no-rewrite', text: 'Extract one legacy area at a time. Do not replace Express, and do not replace HTTP sync with database replication.' }
];

const GAPS = [
  { id: 'legacy-api', text: 'Most HTTP handlers still live in one legacy route file. New work goes in src/modules, and a touched legacy route leaves that file.' },
  { id: 'runtime-ddl', text: 'Schema still changes at boot with ALTER TABLE beside the numbered migrations. New columns belong in migrations only.' },
  { id: 'missing-purchase-report', text: 'The menu links to purchase_reports.html and that file does not exist.' },
  { id: 'pack-scan-id', text: 'Three packing menu items share the id pack_scan, so permissions cannot tell them apart.' },
  { id: 'parallel-hr', text: 'hr_new.html duplicates hr.html and is not in the menu. Fold it back; do not add a third HR page.' }
];

function workspaceForRole(roleCode) {
  const role = String(roleCode || '').trim().toLowerCase();
  return WORKSPACES.find((workspace) => workspace.roles.includes(role))
    || WORKSPACES.find((workspace) => workspace.fallback)
    || WORKSPACES[0];
}

function getProductMap() {
  return {
    ok: true,
    version: 1,
    stages: STAGES,
    modules: MODULES,
    workspaces: WORKSPACES,
    principles: PRINCIPLES,
    gaps: GAPS
  };
}

module.exports = {
  STAGES,
  MODULES,
  WORKSPACES,
  PRINCIPLES,
  GAPS,
  workspaceForRole,
  getProductMap
};
