'use strict';

/**
 * Factory Transfers - one factory sends part of an order's qty to another factory
 * whose Mould Master has the mould. The other factory accepts (or rejects with a
 * reason) and then assigns one of its own machines, which creates a normal plan
 * on its board tagged "Transfer from <factory>".
 *
 *   WAITING  -> ACCEPTED -> PLANNED
 *   WAITING  -> REJECTED
 *   WAITING / ACCEPTED -> CANCELLED (by the sending factory)
 *
 * While WAITING or ACCEPTED the qty is reserved in the sending factory's order
 * balance. Once PLANNED the plan itself counts (plan_board rows of the order count
 * across factories), so the reservation stops.
 *
 * Everything here is pure (no DB) so it can be unit tested; the routes live in
 * src/legacy/registerLegacyRoutes.js next to /api/planning/create.
 */

const STATUS = Object.freeze({
  WAITING: 'WAITING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  PLANNED: 'PLANNED',
  CANCELLED: 'CANCELLED'
});

/* Statuses whose qty is still held back from the sending factory's balance. */
const RESERVING_STATUSES = Object.freeze([STATUS.WAITING, STATUS.ACCEPTED]);

class PlanTransferError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PlanTransferError';
    this.status = status;
  }
}

const normRole = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* All planners (any PPC / planning role, or the plain "planner" role), admin and superadmin. */
function canManageTransfers(user) {
  if (!user) return false;
  const codes = [normRole(user.role_code), normRole(user.role_label)].filter(Boolean);
  return codes.some((c) => c === 'superadmin' || c === 'admin' || c === 'planner'
    || c.includes('ppc') || c.includes('planning'));
}

function isSuperadmin(user) {
  return !!user && (normRole(user.role_code) === 'superadmin' || String(user.username || '').toLowerCase() === 'superadmin');
}

function toPositiveInt(v) {
  const n = Number(String(v == null ? '' : v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toQty(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function cleanText(v, max = 500) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Mould number without the trailing " 2" variant suffix, upper case: "ABC-10 2" -> "ABC-10". */
function mouldFamilyKey(v) {
  return cleanText(v, 255).replace(/\s+\d+$/, '').toUpperCase();
}

/**
 * Checks a send request. `remainingQty` is the family balance of the mould in the
 * sending factory (already net of plans and of other open transfers).
 * Returns the cleaned values or throws PlanTransferError.
 */
function validateSendRequest({ fromFactoryId, toFactoryId, orderNo, mouldNo, qty, remainingQty }) {
  const from = toPositiveInt(fromFactoryId);
  const to = toPositiveInt(toFactoryId);
  if (!from) throw new PlanTransferError('Select one factory before sending a transfer. The All Factories view cannot send.');
  if (!to) throw new PlanTransferError('Choose the factory to send to.');
  if (from === to) throw new PlanTransferError('You cannot send a transfer to your own factory.');
  const order = cleanText(orderNo, 255);
  const mould = cleanText(mouldNo, 255);
  if (!order) throw new PlanTransferError('Order number is required.');
  if (!mould) throw new PlanTransferError('Mould number is required.');
  const q = toQty(qty);
  if (!Number.isFinite(q) || q <= 0) throw new PlanTransferError('Enter the qty to send (more than 0).');
  const rem = toQty(remainingQty);
  if (Number.isFinite(rem) && q > rem) {
    throw new PlanTransferError(`Qty ${q} is more than the balance ${Math.max(0, rem)} of this mould.`);
  }
  return { fromFactoryId: from, toFactoryId: to, orderNo: order, mouldNo: mould, qty: q };
}

/**
 * Who may move a transfer to `action`, given the factory the user is working in.
 *  accept / reject / assign: the receiving factory.
 *  cancel: the sending factory.
 * Superadmin may act for any factory. Throws PlanTransferError when not allowed.
 */
function assertTransition(transfer, action, { factoryId, user } = {}) {
  if (!transfer) throw new PlanTransferError('Transfer not found.', 404);
  const status = String(transfer.status || '').toUpperCase();
  const fid = toPositiveInt(factoryId);
  const superadmin = isSuperadmin(user);
  const receiving = superadmin || fid === Number(transfer.to_factory_id);
  const sending = superadmin || fid === Number(transfer.from_factory_id);

  if (action === 'accept' || action === 'reject') {
    if (!receiving) throw new PlanTransferError('Only the receiving factory can accept or reject this transfer. Switch to that factory.', 403);
    if (status !== STATUS.WAITING) throw new PlanTransferError(`This transfer is already ${status.toLowerCase()}.`, 409);
    return action === 'accept' ? STATUS.ACCEPTED : STATUS.REJECTED;
  }
  if (action === 'assign') {
    if (!receiving) throw new PlanTransferError('Only the receiving factory can assign a machine. Switch to that factory.', 403);
    if (status !== STATUS.ACCEPTED) throw new PlanTransferError(status === STATUS.WAITING ? 'Accept the transfer before assigning a machine.' : `This transfer is already ${status.toLowerCase()}.`, 409);
    return STATUS.PLANNED;
  }
  if (action === 'cancel') {
    if (!sending) throw new PlanTransferError('Only the sending factory can cancel this transfer.', 403);
    if (!RESERVING_STATUSES.includes(status)) throw new PlanTransferError(`This transfer is already ${status.toLowerCase()} and cannot be cancelled.`, 409);
    return STATUS.CANCELLED;
  }
  throw new PlanTransferError('Unknown action.');
}

/**
 * Colour split sent with a transfer: [{ colourName, planQty, itemCode?, itemName? }].
 * Rows with no qty are dropped. When any colour is given, the colours must add up
 * to the transfer qty. Returns the cleaned list ([] when none) or throws.
 */
function normaliseColourSplit(list, qty) {
  if (list == null || list === '') return [];
  if (!Array.isArray(list)) throw new PlanTransferError('Colour split must be a list.');
  const seen = new Set();
  const out = [];
  list.forEach((c) => {
    const q = toQty(c && (c.planQty ?? c.qty));
    if (!Number.isFinite(q) || q === 0) return;
    const name = cleanText(c.colourName || c.itemColour || c.colour, 120);
    if (!name) throw new PlanTransferError('Every colour with a qty needs a colour name.');
    if (q < 0) throw new PlanTransferError(`Qty of ${name} cannot be below 0.`);
    const k = name.toUpperCase() + '|' + cleanText(c.itemCode, 120).toUpperCase();
    if (seen.has(k)) throw new PlanTransferError(`${name} is listed twice.`);
    seen.add(k);
    out.push({ colourName: name, planQty: q, batchQty: q, itemCode: cleanText(c.itemCode, 120) || undefined, itemName: cleanText(c.itemName, 255) || undefined });
  });
  if (out.length) {
    const sum = out.reduce((s, c) => s + c.planQty, 0);
    if (Math.abs(sum - Number(qty)) > 0.001) {
      throw new PlanTransferError(`The colours add up to ${sum}, but the qty to send is ${Number(qty)}.`);
    }
  }
  return out;
}

/* Colour split for a plan of `planQty` out of a transfer of `transferQty`:
   the full qty keeps the split, a part scales it (whole pieces, rest on the largest). */
function scaleColourSplit(colours, transferQty, planQty) {
  const list = Array.isArray(colours) ? colours : [];
  const total = Number(transferQty);
  const want = Number(planQty);
  if (!list.length || !(total > 0) || !(want > 0) || want === total) return list.map((c) => ({ ...c }));
  const out = list.map((c) => {
    const q = Math.floor(Number(c.planQty || 0) * want / total);
    return { ...c, planQty: q, batchQty: q };
  });
  const rest = want - out.reduce((s, c) => s + c.planQty, 0);
  if (rest) {
    const big = out.reduce((b, c, i) => (Number(list[i].planQty) > Number(list[b].planQty) ? i : b), 0);
    out[big].planQty += rest;
    out[big].batchQty = out[big].planQty;
  }
  return out.filter((c) => c.planQty > 0);
}

/* Plan payload for /api/planning/create built from an accepted transfer. */
function buildPlanFromTransfer(transfer, { machine, plant, building, line, startDate, planQty } = {}) {
  const qty = planQty == null || planQty === '' ? Number(transfer.qty) : toQty(planQty);
  if (!Number.isFinite(qty) || qty <= 0) throw new PlanTransferError('Enter a valid plan qty.');
  if (qty > Number(transfer.qty)) throw new PlanTransferError(`Plan qty ${qty} cannot be more than the transferred qty ${Number(transfer.qty)}.`);
  if (!cleanText(machine)) throw new PlanTransferError('Choose a machine.');
  let colours = transfer.colour_details;
  if (typeof colours === 'string') { try { colours = JSON.parse(colours); } catch (_) { colours = []; } }
  return {
    transferId: Number(transfer.id),
    plant: cleanText(plant, 100) || 'PLANT',
    building: cleanText(building, 100),
    line: cleanText(line, 50),
    machine: cleanText(machine, 255),
    orderNo: transfer.order_no,
    itemCode: transfer.item_code || transfer.mould_no,
    itemName: transfer.item_name || null,
    mouldName: transfer.mould_name || transfer.mould_no,
    mouldCode: transfer.mould_no,
    planQty: qty,
    balQty: qty,
    batchQty: qty,
    mouldItemQty: Number(transfer.qty),
    colourDetails: scaleColourSplit(Array.isArray(colours) ? colours : [], transfer.qty, qty),
    startDate: startDate || new Date().toISOString()
  };
}

module.exports = {
  STATUS,
  RESERVING_STATUSES,
  PlanTransferError,
  canManageTransfers,
  isSuperadmin,
  mouldFamilyKey,
  validateSendRequest,
  assertTransition,
  normaliseColourSplit,
  scaleColourSplit,
  buildPlanFromTransfer
};
