'use strict';

/**
 * NPD role / stage access rules (src/modules/npd/registerNpdRoutes.js).
 * Pure helpers only — no DB.
 */

const {
  STAGES,
  DEPT_ROLES,
  ADMIN_ROLES,
  SHEET_ROLES,
  STAGE_STATES,
  PRODUCT_STATUSES,
  cleanStages,
  roleDepts,
  norm,
  editableStageKeys,
  canEditSheet,
  canAddItems,
  isNpdAdmin,
  isNpdSuperadmin
} = require('../src/modules/npd/registerNpdRoutes');

describe('NPD stage catalogue', () => {
  test('every stage has a unique key, type and department list', () => {
    const keys = STAGES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of STAGES) {
      expect(['status', 'date']).toContain(s.type);
      expect(Array.isArray(s.depts)).toBe(true);
      expect(s.depts.length).toBeGreaterThan(0);
      expect(s.label).toBeTruthy();
    }
  });

  test('known department roles cover Tool Room through Packing', () => {
    expect(Object.keys(DEPT_ROLES)).toEqual(
      expect.arrayContaining(['Tool Room', 'Moulding', 'Planning', 'QC', 'Packing'])
    );
  });
});

describe('NPD cleanStages', () => {
  test('keeps only known keys with valid values', () => {
    expect(cleanStages({
      mould_received: 'complete',
      mould_trials: 'nope',
      jc_start_date: '2026-10-30',
      jc_end_date: '',
      unknown: 'complete'
    })).toEqual({
      mould_received: 'complete',
      jc_start_date: '2026-10-30',
      jc_end_date: ''
    });
  });

  test('rejects non-objects', () => {
    expect(cleanStages(null)).toEqual({});
    expect(cleanStages('x')).toEqual({});
  });

  test('stage states and product statuses are the documented sets', () => {
    expect([...STAGE_STATES].sort()).toEqual(['complete', 'in_progress', 'na', 'pending'].sort());
    expect(PRODUCT_STATUSES.has('Launched')).toBe(true);
    expect(PRODUCT_STATUSES.has('Bogus')).toBe(false);
  });
});

describe('NPD role access', () => {
  const user = (role_code, role_label = '') => ({ username: 'u', role_code, role_label });

  test('norm strips punctuation so role labels match codes', () => {
    expect(norm('Sr. PPC Manager')).toBe('srppcmanager');
    expect(norm('sr__ppc_manager')).toBe('srppcmanager');
  });

  test('admin / superadmin edit the whole sheet (and delete)', () => {
    expect(isNpdAdmin(user('admin'))).toBe(true);
    expect(isNpdAdmin(user('superadmin'))).toBe(true);
    expect(isNpdSuperadmin(user('admin'))).toBe(false);
    expect(isNpdSuperadmin(user('superadmin'))).toBe(true);
    expect(canEditSheet(user('admin'))).toBe(true);
    expect(ADMIN_ROLES.has('admin')).toBe(true);
    expect(SHEET_ROLES.has('ppcmanager')).toBe(true);
  });

  test('PPC managers can edit the sheet; operators cannot', () => {
    expect(canEditSheet(user('ppcmanager'))).toBe(true);
    expect(canEditSheet(user('ppcassmanager'))).toBe(true);
    expect(canEditSheet(user('operator'))).toBe(false);
    expect(canEditSheet(null)).toBe(false);
  });

  test('department roles only get their own stages', () => {
    expect(roleDepts(user('toolroommanager'))).toEqual(['Tool Room']);
    // Moulding managers also cover Production (printing / tufting) stages.
    expect(roleDepts(user('mouldingmanager'))).toEqual(['Moulding', 'Production']);
    expect(roleDepts(user('quality'))).toEqual(['QC']);
    expect(roleDepts(user('packingmanager'))).toEqual(['Packing']);

    const toolKeys = editableStageKeys(user('toolroommanager'));
    expect(toolKeys).toContain('mould_received');
    expect(toolKeys).not.toContain('mass_moulding');
    expect(toolKeys).not.toContain('price_final');

    const mouldKeys = editableStageKeys(user('mouldingmanager'));
    expect(mouldKeys).toEqual(expect.arrayContaining(['mould_trials', 'mass_moulding', 'rm_colour', 'pilot_drop_test']));
    expect(editableStageKeys(user('quality_ass__manager'))).toContain('pilot_drop_test');
    expect(mouldKeys).not.toContain('mould_received');

    const adminKeys = editableStageKeys(user('admin'));
    expect(adminKeys).toEqual(STAGES.map((s) => s.key));
  });

  test('Purchase / HO / Production / W/H stages stay admin-only for dept users', () => {
    const qc = new Set(editableStageKeys(user('quality')));
    expect(qc.has('or_jr_erp')).toBe(false);
    expect(qc.has('packing_receiving')).toBe(false);
    expect(qc.has('mass_printing')).toBe(false);
    expect(qc.has('fg_receiving')).toBe(false);
    expect(qc.has('samples_ho')).toBe(true);
  });
});

describe('NPD Sales Co-ordinator (add only)', () => {
  const u = (role_code, role_label) => ({ role_code, role_label });

  test('Sales Co-ordinator can add products but not edit the sheet or stages', () => {
    for (const s of [u('sales_coordinator'), u('x', 'Sales Co-ordinator'), u('sales_coord')]) {
      expect(canAddItems(s)).toBe(true);
      expect(canEditSheet(s)).toBe(false);
      expect(editableStageKeys(s)).toEqual([]);
      expect(isNpdSuperadmin(s)).toBe(false);
    }
  });

  test('sheet owners can still add; other roles cannot', () => {
    expect(canAddItems(u('ppc_manager'))).toBe(true);
    expect(canAddItems(u('admin'))).toBe(true);
    expect(canAddItems(u('moulding_manager'))).toBe(false);
    expect(canAddItems(u('sales_manager'))).toBe(false);
    expect(canAddItems(null)).toBe(false);
  });
});

describe('NPD product / mould levels', () => {
  const { STAGE_LEVEL, rollupStage } = require('../src/modules/npd/registerNpdRoutes');
  const m = (stages) => ({ stages });

  test('every stage is product or mould level; printing and tufting are separate product stages', () => {
    for (const s of STAGES) expect(['product', 'mould']).toContain(s.level);
    expect(STAGE_LEVEL.get('mass_moulding')).toBe('mould');
    expect(STAGE_LEVEL.get('mass_printing')).toBe('product');
    expect(STAGE_LEVEL.get('mass_tufting')).toBe('product');
    expect(STAGE_LEVEL.get('mass_packaging')).toBe('product');
    const keys = STAGES.map((s) => s.key);
    expect(keys.indexOf('mass_tufting')).toBe(keys.indexOf('mass_printing') + 1);
  });

  test('status roll-up from moulds', () => {
    expect(rollupStage('mould_trials', [])).toBe('pending');
    expect(rollupStage('mould_trials', [m({}), m({})])).toBe('pending');
    expect(rollupStage('mould_trials', [m({ mould_trials: 'complete' }), m({})])).toBe('in_progress');
    expect(rollupStage('mould_trials', [m({ mould_trials: 'complete' }), m({ mould_trials: 'na' })])).toBe('complete');
    expect(rollupStage('mould_trials', [m({ mould_trials: 'na' }), m({ mould_trials: 'na' })])).toBe('na');
  });

  test('date roll-up: earliest job card start, latest end', () => {
    const ks = [m({ jc_start_date: '2026-11-10', jc_end_date: '2026-11-20' }), m({ jc_start_date: '2026-11-05', jc_end_date: '2026-11-25' }), m({})];
    expect(rollupStage('jc_start_date', ks)).toBe('2026-11-05');
    expect(rollupStage('jc_end_date', ks)).toBe('2026-11-25');
    expect(rollupStage('jc_end_date', [m({})])).toBe('');
  });
});

describe('NPD remarks line', () => {
  const { remarkLine } = require('../src/modules/npd/registerNpdRoutes');

  test('every department in sheet order, latest remark per department, joined with "- "', () => {
    const line = remarkLine({
      bom_approval: { remarks: 'P-1, Please Check WIP Stock', at: '2026-11-10T00:00:00Z' },
      production_planning: { remarks: 'As Discussed With NKB Sir.', at: '2026-11-12T00:00:00Z' },
      mould_trials: { remarks: 'ok', at: '2026-11-01T00:00:00Z' }
    });
    expect(line).toBe('(Tool Room)- (Moulding)ok- (Planning)As Discussed With NKB Sir.- (QC)- (H.O)- (Packing)- (Purchase)- (W/H)- (Production)');
  });

  test('no remarks still lists every department', () => {
    expect(remarkLine(null).split('- ')).toHaveLength(9);
  });

  test('launch date column is named Launch Date, H.O', () => {
    const s = STAGES.find((x) => x.key === 'launch_date_ho');
    expect(s.label).toBe('Launch Date (HO)');
    expect(s.depts).toEqual(['HO']);
  });
});

describe('NPD pilot run is set product wise by QC', () => {
  const { STAGE_LEVEL } = require('../src/modules/npd/registerNpdRoutes');
  const user = (role_code, role_label = '') => ({ username: 'u', role_code, role_label });

  test('pilot run & drop test is a product stage', () => {
    expect(STAGE_LEVEL.get('pilot_drop_test')).toBe('product');
  });

  test('QC HOD and Quality Ass. Manager can edit it', () => {
    expect(editableStageKeys(user('quality', 'QC HOD'))).toContain('pilot_drop_test');
    expect(editableStageKeys(user('quality_ass__manager', 'Quality Ass. Manager'))).toContain('pilot_drop_test');
    expect(editableStageKeys(user('toolroommanager'))).not.toContain('pilot_drop_test');
  });
});

describe('NPD factory scope', () => {
  const { scopeProducts } = require('../src/modules/npd/registerNpdRoutes');
  const rows = [
    { sync_id: 'a', factory: 'Dungra Unit 1', created_by: 'x' },
    { sync_id: 'a1', parent_sync_id: 'a', factory: '' },
    { sync_id: 'b', factory: 'JOYO PLASTICS', created_by: 'x' },
    { sync_id: 'b1', parent_sync_id: 'b', factory: 'dungra unit 1 ' },
    { sync_id: 'c', factory: '', created_by: 'pc' },
    { sync_id: 'c1', parent_sync_id: 'c', factory: '' }
  ];
  const ids = (r) => r.map((x) => x.sync_id);
  const plain = { username: 'pc', role_code: 'ppcmanager' };

  test('single factory user sees blocks of that factory (product or any mould) and their own unassigned ones', () => {
    expect(ids(scopeProducts(rows, { all: false, names: ['Dungra Unit 1'] }, plain))).toEqual(['a', 'a1', 'b', 'b1', 'c', 'c1']);
    expect(ids(scopeProducts(rows, { all: false, names: ['Dungra Unit 1'] }, { username: 'zz', role_code: 'quality' }))).toEqual(['a', 'a1', 'b', 'b1']);
    expect(ids(scopeProducts(rows, { all: false, names: ['Other'] }, { username: 'zz', role_code: 'quality' }))).toEqual([]);
  });

  test('all factory user sees everything; one factory narrows', () => {
    const all = { all: true, names: ['Dungra Unit 1', 'JOYO PLASTICS'] };
    expect(ids(scopeProducts(rows, all, { username: 'sa', role_code: 'superadmin' }))).toHaveLength(6);
    expect(ids(scopeProducts(rows, all, { username: 'sa', role_code: 'superadmin' }, 'JOYO PLASTICS'))).toEqual(['b', 'b1']);
  });
});
