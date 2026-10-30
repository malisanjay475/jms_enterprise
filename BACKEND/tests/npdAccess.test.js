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

  test('admin / superadmin edit the whole sheet; only superadmin deletes', () => {
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
    expect(roleDepts(user('mouldingmanager'))).toEqual(['Moulding']);
    expect(roleDepts(user('quality'))).toEqual(['QC']);
    expect(roleDepts(user('packingmanager'))).toEqual(['Packing']);

    const toolKeys = editableStageKeys(user('toolroommanager'));
    expect(toolKeys).toContain('mould_received');
    expect(toolKeys).not.toContain('mass_moulding');
    expect(toolKeys).not.toContain('price_final');

    const mouldKeys = editableStageKeys(user('mouldingmanager'));
    expect(mouldKeys).toEqual(expect.arrayContaining(['mould_trials', 'mass_moulding', 'rm_colour', 'pilot_drop_test']));
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
