'use strict';

/**
 * Order Hold role rules (src/modules/orderHold/registerOrderHoldRoutes.js).
 */
const {
  canManageHolds,
  canSeeHoldHistory,
  orderKey
} = require('../src/modules/orderHold/registerOrderHoldRoutes');

describe('order hold access', () => {
  test.each([
    ['superadmin'], ['admin'], ['ppc_ass_manager'], ['ppc_manager'], ['sr_ppc_manager'], ['sr__ppc_manager']
  ])('%s can hold, edit and release', role => {
    expect(canManageHolds({ role_code: role })).toBe(true);
  });

  test('role label also counts (Sr. PPC Manager)', () => {
    expect(canManageHolds({ role_code: 'custom_x', role_label: 'Sr. PPC Manager' })).toBe(true);
  });

  test.each([
    ['operator'], ['supervisor'], ['moulding_manager'], ['general_manager'], ['ppc'], ['']
  ])('%s cannot hold', role => {
    expect(canManageHolds({ role_code: role })).toBe(false);
  });

  test('no user cannot hold', () => {
    expect(canManageHolds(null)).toBe(false);
  });

  test('only superadmin sees the history', () => {
    expect(canSeeHoldHistory({ role_code: 'superadmin' })).toBe(true);
    expect(canSeeHoldHistory({ role_code: 'admin' })).toBe(false);
    expect(canSeeHoldHistory({ role_code: 'sr_ppc_manager' })).toBe(false);
    expect(canSeeHoldHistory(null)).toBe(false);
  });

  test('order numbers match however typed', () => {
    expect(orderKey('  jpsor/25-26/123 ')).toBe('JPSOR/25-26/123');
    expect(orderKey(null)).toBe('');
  });
});
