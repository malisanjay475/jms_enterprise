'use strict';

const {
  STATUS,
  PlanTransferError,
  canManageTransfers,
  mouldFamilyKey,
  validateSendRequest,
  assertTransition,
  buildPlanFromTransfer
} = require('../src/modules/planning/planTransfer');

describe('factory transfer roles', () => {
  test.each([
    ['superadmin'], ['admin'], ['planner'], ['ppc_manager'], ['sr__ppc_manager'], ['ppc_ass_manager'], ['planning_manager']
  ])('%s may manage transfers', (role) => {
    expect(canManageTransfers({ role_code: role })).toBe(true);
  });

  test('a role label with PPC counts too', () => {
    expect(canManageTransfers({ role_code: 'custom_7', role_label: 'Sr. PPC Manager' })).toBe(true);
  });

  test.each([['operator'], ['supervisor'], ['quality'], ['']])('%s may not', (role) => {
    expect(canManageTransfers({ role_code: role })).toBe(false);
  });

  test('no user may not', () => {
    expect(canManageTransfers(null)).toBe(false);
  });
});

describe('mouldFamilyKey', () => {
  test('drops the variant number and upper-cases', () => {
    expect(mouldFamilyKey(' abc-10  2 ')).toBe('ABC-10');
    expect(mouldFamilyKey('ABC-10')).toBe('ABC-10');
  });
});

describe('validateSendRequest', () => {
  const base = { fromFactoryId: 1, toFactoryId: 3, orderNo: 'OR-1', mouldNo: 'M-1', qty: 500, remainingQty: 2000 };

  test('accepts a good request', () => {
    expect(validateSendRequest(base)).toEqual({ fromFactoryId: 1, toFactoryId: 3, orderNo: 'OR-1', mouldNo: 'M-1', qty: 500 });
  });

  test('works between any two factories', () => {
    expect(validateSendRequest({ ...base, fromFactoryId: 4, toFactoryId: 2 }).toFactoryId).toBe(2);
  });

  test.each([
    [{ fromFactoryId: null }, /Select one factory/],
    [{ toFactoryId: '' }, /Choose the factory/],
    [{ toFactoryId: 1 }, /own factory/],
    [{ orderNo: ' ' }, /Order number/],
    [{ mouldNo: '' }, /Mould number/],
    [{ qty: 0 }, /more than 0/],
    [{ qty: 'abc' }, /more than 0/],
    [{ qty: 2001 }, /more than the balance 2000/]
  ])('rejects %o', (patch, msg) => {
    expect(() => validateSendRequest({ ...base, ...patch })).toThrow(msg);
  });

  test('qty equal to the balance is fine', () => {
    expect(validateSendRequest({ ...base, qty: 2000 }).qty).toBe(2000);
  });
});

describe('assertTransition', () => {
  const t = (status) => ({ id: 9, status, from_factory_id: 1, to_factory_id: 3, qty: 1000 });

  test('receiving factory accepts and rejects a waiting transfer', () => {
    expect(assertTransition(t('WAITING'), 'accept', { factoryId: 3 })).toBe(STATUS.ACCEPTED);
    expect(assertTransition(t('WAITING'), 'reject', { factoryId: 3 })).toBe(STATUS.REJECTED);
  });

  test('sending factory cannot accept its own transfer', () => {
    expect(() => assertTransition(t('WAITING'), 'accept', { factoryId: 1 })).toThrow(PlanTransferError);
  });

  test('cannot accept twice', () => {
    expect(() => assertTransition(t('ACCEPTED'), 'accept', { factoryId: 3 })).toThrow(/already accepted/);
  });

  test('assign needs an accepted transfer in the receiving factory', () => {
    expect(assertTransition(t('ACCEPTED'), 'assign', { factoryId: 3 })).toBe(STATUS.PLANNED);
    expect(() => assertTransition(t('WAITING'), 'assign', { factoryId: 3 })).toThrow(/Accept the transfer/);
    expect(() => assertTransition(t('PLANNED'), 'assign', { factoryId: 3 })).toThrow(/already planned/);
    expect(() => assertTransition(t('ACCEPTED'), 'assign', { factoryId: 2 })).toThrow(/receiving factory/);
  });

  test('sending factory cancels while waiting or accepted only', () => {
    expect(assertTransition(t('WAITING'), 'cancel', { factoryId: 1 })).toBe(STATUS.CANCELLED);
    expect(assertTransition(t('ACCEPTED'), 'cancel', { factoryId: 1 })).toBe(STATUS.CANCELLED);
    expect(() => assertTransition(t('PLANNED'), 'cancel', { factoryId: 1 })).toThrow(/cannot be cancelled/);
    expect(() => assertTransition(t('WAITING'), 'cancel', { factoryId: 3 })).toThrow(/sending factory/);
  });

  test('superadmin may act for any factory', () => {
    const user = { role_code: 'superadmin' };
    expect(assertTransition(t('WAITING'), 'accept', { factoryId: null, user })).toBe(STATUS.ACCEPTED);
  });

  test('missing transfer is a 404', () => {
    try { assertTransition(null, 'accept', { factoryId: 3 }); } catch (e) { expect(e.status).toBe(404); return; }
    throw new Error('expected a throw');
  });
});

describe('buildPlanFromTransfer', () => {
  const transfer = {
    id: 9, order_no: 'OR-1', mould_no: 'M-1', mould_name: 'Cap', item_code: 'IC-1', item_name: 'Bottle',
    qty: '1000', colour_details: '[{"colourName":"Red","planQty":1000}]'
  };

  test('builds the plan with the transfer link and full qty', () => {
    const plan = buildPlanFromTransfer(transfer, { machine: 'B-07', plant: 'PREMIER', line: '2', startDate: '2026-11-28T08:00:00Z' });
    expect(plan).toMatchObject({
      transferId: 9, machine: 'B-07', plant: 'PREMIER', orderNo: 'OR-1', mouldCode: 'M-1', mouldName: 'Cap',
      planQty: 1000, startDate: '2026-11-28T08:00:00Z'
    });
    expect(plan.colourDetails).toEqual([{ colourName: 'Red', planQty: 1000 }]);
  });

  test('plan qty cannot go over the transferred qty', () => {
    expect(() => buildPlanFromTransfer(transfer, { machine: 'B-07', planQty: 1001 })).toThrow(/cannot be more/);
  });

  test('needs a machine', () => {
    expect(() => buildPlanFromTransfer(transfer, {})).toThrow(/Choose a machine/);
  });
});

describe('colour split', () => {
  const { normaliseColourSplit, scaleColourSplit } = require('../src/modules/planning/planTransfer');

  test('none given is fine', () => {
    expect(normaliseColourSplit(undefined, 400)).toEqual([]);
    expect(normaliseColourSplit([], 400)).toEqual([]);
  });

  test('keeps colours with qty and checks the total', () => {
    const out = normaliseColourSplit([{ colourName: ' Red ', planQty: 300 }, { colourName: 'Blue', planQty: '100' }, { colourName: 'Green', planQty: 0 }], 400);
    expect(out.map((c) => [c.colourName, c.planQty, c.batchQty])).toEqual([['Red', 300, 300], ['Blue', 100, 100]]);
  });

  test.each([
    [[{ colourName: 'Red', planQty: 300 }], /add up to 300/],
    [[{ colourName: '', planQty: 400 }], /colour name/],
    [[{ colourName: 'Red', planQty: 500 }, { colourName: 'Blue', planQty: -100 }], /below 0/],
    [[{ colourName: 'Red', planQty: 200 }, { colourName: 'red', planQty: 200 }], /listed twice/],
    ['Red', /must be a list/]
  ])('rejects %j', (list, msg) => {
    expect(() => normaliseColourSplit(list, 400)).toThrow(msg);
  });

  test('scales to a part plan in whole pieces, rest on the largest colour', () => {
    const cols = [{ colourName: 'Red', planQty: 300 }, { colourName: 'Blue', planQty: 100 }];
    expect(scaleColourSplit(cols, 400, 200).map((c) => c.planQty)).toEqual([150, 50]);
    expect(scaleColourSplit(cols, 400, 333).map((c) => c.planQty)).toEqual([250, 83]);
    expect(scaleColourSplit(cols, 400, 400)).toEqual(cols);
    expect(scaleColourSplit([], 400, 100)).toEqual([]);
  });

  test('buildPlanFromTransfer scales the colours to the plan qty', () => {
    const plan = buildPlanFromTransfer({ id: 1, order_no: 'OR-1', mould_no: 'M-1', qty: 400, colour_details: [{ colourName: 'Red', planQty: 400 }] },
      { machine: 'C-1', planQty: 100 });
    expect(plan.colourDetails).toEqual([{ colourName: 'Red', planQty: 100, batchQty: 100 }]);
  });
});
