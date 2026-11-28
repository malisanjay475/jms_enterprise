'use strict';

/**
 * Order Hold - the "Hold" button on the Planning Excel View Timeline and the
 * Machine Timeline.
 *
 * Planning managers put ONE MOULD of an order (OR no + mould) on hold; only the
 * plan cards of that mould in that order then show HOLD with the reason. The
 * other moulds of the same order stay as they are. Only superadmin, admin, PPC
 * Ass. Manager, PPC Manager and Sr. PPC Manager may hold, edit the reason or
 * release. Everyone who opens the board sees what is on hold. Superadmin also
 * sees the history of every hold / edit / release.
 *
 * Holds made before v1.217.0 had no mould: they are kept as WHOLE-ORDER holds
 * (mould_no = '') and still cover every mould of the order until someone
 * releases them or swaps them for a hold on one mould (replace_whole_order).
 * New whole-order holds can no longer be made.
 *
 * Tables (both sync MAIN <-> every LOCAL, no factory_id, so every server has all):
 *   order_holds         one row per order + mould (natural key order_no, mould_no).
 *                       Releasing sets active = FALSE; rows are never deleted, so
 *                       a release cannot be undone by the sync bringing the row back.
 *   order_hold_history  append-only log (sync_id), one row per HOLD / EDIT / RELEASE.
 */

const { getRequestUsername } = require('../../app/requestContext');
const { sendServerError } = require('../../app/httpErrors');

/* Role codes / labels with everything but letters and digits removed, so
   'sr__ppc_manager', 'sr_ppc_manager' and 'Sr. PPC Manager' all match. */
const HOLD_ROLES = new Set(['superadmin', 'admin', 'ppcassmanager', 'ppcasstmanager', 'ppcmanager', 'srppcmanager']);
const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function canManageHolds(u) {
  if (!u) return false;
  return HOLD_ROLES.has(norm(u.role_code)) || HOLD_ROLES.has(norm(u.role_label));
}
function canSeeHoldHistory(u) {
  return !!u && norm(u.role_code) === 'superadmin';
}
/* Same order number however it was typed: trimmed, upper case. */
function orderKey(v) {
  return String(v == null ? '' : v).trim().toUpperCase().slice(0, 100);
}
/* Mould code as the board shows it, trimmed and upper case. '-' (the board's
   "no mould") counts as no mould. */
function mouldKey(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase().slice(0, 100);
  return s === '-' ? '' : s;
}
function cleanReason(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 500);
}
function cleanName(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function ensureOrderHoldSchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('order_hold_schema'));
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS order_holds (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL,
      mould_no TEXT NOT NULL DEFAULT '',
      mould_name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      reason TEXT NOT NULL DEFAULT '',
      held_by TEXT,
      held_at TIMESTAMPTZ,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE order_holds ADD COLUMN IF NOT EXISTS mould_no TEXT NOT NULL DEFAULT '';
    ALTER TABLE order_holds ADD COLUMN IF NOT EXISTS mould_name TEXT NOT NULL DEFAULT '';
    DROP INDEX IF EXISTS uq_order_holds_order_no;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_order_holds_order_mould ON order_holds(order_no, mould_no);
    CREATE TABLE IF NOT EXISTS order_hold_history (
      id SERIAL PRIMARY KEY,
      sync_id UUID DEFAULT gen_random_uuid(),
      order_no TEXT NOT NULL,
      mould_no TEXT NOT NULL DEFAULT '',
      mould_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      old_reason TEXT,
      done_by TEXT,
      done_role TEXT,
      done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE order_hold_history ADD COLUMN IF NOT EXISTS mould_no TEXT NOT NULL DEFAULT '';
    ALTER TABLE order_hold_history ADD COLUMN IF NOT EXISTS mould_name TEXT NOT NULL DEFAULT '';
    UPDATE order_hold_history SET sync_id = gen_random_uuid() WHERE sync_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_order_hold_history ON order_hold_history(sync_id);
    CREATE INDEX IF NOT EXISTS idx_order_hold_history_order ON order_hold_history(order_no, done_at DESC);
  `);
}

function registerOrderHoldRoutes(app, pool) {
  let ready = null;
  function ensureTables() {
    if (!ready) ready = ensureOrderHoldSchema(pool).catch(err => { ready = null; throw err; });
    return ready;
  }
  /* LOCAL: send the change to MAIN now instead of waiting for the next cycle */
  const pushNow = () => {
    if (String(process.env.SERVER_TYPE || '').toUpperCase() !== 'LOCAL') return;
    try { require('../../../services/sync.service').triggerSync(); } catch (_) { /* sync not loaded */ }
  };

  async function loadUser(username) {
    if (!username) return null;
    const r = await pool.query(
      `SELECT u.id, u.username, u.role_code, r.label AS role_label
         FROM users u LEFT JOIN roles r ON r.code = u.role_code
        WHERE u.username = $1 LIMIT 1`, [username]);
    return r.rows[0] || null;
  }
  /* Reading: any signed-in user. Changing and history: a verified session only,
     so a request that only claims a user name in a header cannot hold an order. */
  const viewer = req => loadUser((req.auth && req.auth.username) || getRequestUsername(req));
  async function requireManager(req, res) {
    const u = req.auth && req.auth.username ? await loadUser(req.auth.username) : null;
    if (!u) { res.status(401).json({ ok: false, error: 'Please sign in again' }); return null; }
    if (!canManageHolds(u)) {
      res.status(403).json({ ok: false, error: 'Only superadmin, admin, PPC Ass. Manager, PPC Manager and Sr. PPC Manager can hold orders' });
      return null;
    }
    return u;
  }
  const roleOf = u => u.role_label || u.role_code || '';
  const addHistory = (client, h) => client.query(
    `INSERT INTO order_hold_history (order_no, mould_no, mould_name, action, reason, old_reason, done_by, done_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [h.order_no, h.mould_no, h.mould_name || '', h.action, h.reason || '', h.old_reason == null ? null : h.old_reason, h.done_by, h.done_role]);

  /* Holds in place now (the board shows these), plus what this user may do.
     mould_no '' = an old whole-order hold. */
  app.get('/api/order-holds', async (req, res) => {
    try {
      await ensureTables();
      const [u, rows] = await Promise.all([
        viewer(req),
        pool.query(`SELECT order_no, mould_no, mould_name, reason, held_by, held_at, updated_by, updated_at
                      FROM order_holds WHERE active ORDER BY held_at DESC NULLS LAST`)
      ]);
      res.json({ ok: true, can_edit: canManageHolds(u), can_history: canSeeHoldHistory(u), data: rows.rows });
    } catch (err) { sendServerError(res, err); }
  });

  /* Put one mould of an order on hold, or change the reason of a hold already in place.
     replace_whole_order: also release the old whole-order hold of this order, so only
     this mould stays held. mould_no '' is only accepted to edit an old whole-order hold. */
  app.post('/api/order-holds', async (req, res) => {
    try {
      await ensureTables();
      const u = await requireManager(req, res);
      if (!u) return;
      const body = req.body || {};
      const orderNo = orderKey(body.order_no);
      const mouldNo = mouldKey(body.mould_no);
      const mouldName = cleanName(body.mould_name);
      const reason = cleanReason(body.reason);
      const replaceWhole = !!body.replace_whole_order && !!mouldNo;
      if (!orderNo) return res.status(400).json({ ok: false, error: 'Order number is required' });
      if (!reason) return res.status(400).json({ ok: false, error: 'Please write the reason for the hold' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = (await client.query(
          'SELECT active, reason, mould_name FROM order_holds WHERE order_no = $1 AND mould_no = $2 FOR UPDATE',
          [orderNo, mouldNo])).rows[0];
        const wasActive = !!(cur && cur.active);
        if (!mouldNo && !wasActive) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Choose the mould to hold' });
        }
        /* Old whole-order hold to swap for this mould hold */
        let whole = null;
        if (replaceWhole) {
          whole = (await client.query(
            `UPDATE order_holds SET active = FALSE, updated_by = $2, updated_at = NOW()
              WHERE order_no = $1 AND mould_no = '' AND active RETURNING reason`, [orderNo, u.username])).rows[0] || null;
        }
        if (wasActive && cur.reason === reason && !whole) {
          await client.query('ROLLBACK');
          return res.json({ ok: true, unchanged: true });
        }
        let row;
        if (!(wasActive && cur.reason === reason)) {
          row = (await client.query(
            `INSERT INTO order_holds (order_no, mould_no, mould_name, active, reason, held_by, held_at, updated_by, updated_at)
             VALUES ($1, $2, $3, TRUE, $4, $5, NOW(), $5, NOW())
             ON CONFLICT (order_no, mould_no) DO UPDATE SET
               active = TRUE,
               reason = EXCLUDED.reason,
               mould_name = CASE WHEN EXCLUDED.mould_name <> '' THEN EXCLUDED.mould_name ELSE order_holds.mould_name END,
               held_by = CASE WHEN order_holds.active THEN order_holds.held_by ELSE EXCLUDED.held_by END,
               held_at = CASE WHEN order_holds.active THEN order_holds.held_at ELSE NOW() END,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()
             RETURNING order_no, mould_no, mould_name, reason, held_by, held_at, updated_by, updated_at`,
            [orderNo, mouldNo, mouldName, reason, u.username])).rows[0];
          await addHistory(client, {
            order_no: orderNo, mould_no: mouldNo, mould_name: row.mould_name,
            action: wasActive ? 'EDIT' : 'HOLD', reason, old_reason: wasActive ? cur.reason : null,
            done_by: u.username, done_role: roleOf(u)
          });
        }
        if (whole) {
          await addHistory(client, {
            order_no: orderNo, mould_no: '', mould_name: '',
            action: 'RELEASE', reason: `Now only mould ${mouldNo}${mouldName ? ' (' + mouldName + ')' : ''} is on hold`,
            old_reason: whole.reason, done_by: u.username, done_role: roleOf(u)
          });
        }
        await client.query('COMMIT');
        pushNow();
        res.json({ ok: true, data: row || null, released_whole_order: !!whole });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (err) { sendServerError(res, err); }
  });

  /* Take a hold off: one mould of an order, or (mould_no '') an old whole-order hold. */
  app.post('/api/order-holds/release', async (req, res) => {
    try {
      await ensureTables();
      const u = await requireManager(req, res);
      if (!u) return;
      const body = req.body || {};
      const orderNo = orderKey(body.order_no);
      const mouldNo = mouldKey(body.mould_no);
      const note = cleanReason(body.note);
      if (!orderNo) return res.status(400).json({ ok: false, error: 'Order number is required' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = (await client.query(
          `UPDATE order_holds SET active = FALSE, updated_by = $3, updated_at = NOW()
            WHERE order_no = $1 AND mould_no = $2 AND active RETURNING reason, mould_name`,
          [orderNo, mouldNo, u.username])).rows[0];
        if (!cur) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: mouldNo ? 'This mould is not on hold' : 'This order is not on hold' });
        }
        await addHistory(client, {
          order_no: orderNo, mould_no: mouldNo, mould_name: cur.mould_name,
          action: 'RELEASE', reason: note, old_reason: cur.reason, done_by: u.username, done_role: roleOf(u)
        });
        await client.query('COMMIT');
        pushNow();
        res.json({ ok: true });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (err) { sendServerError(res, err); }
  });

  /* Superadmin: every hold / edit / release, newest first; ?order_no= narrows to one order. */
  app.get('/api/order-holds/history', async (req, res) => {
    try {
      await ensureTables();
      const u = req.auth && req.auth.username ? await loadUser(req.auth.username) : null;
      if (!u) return res.status(401).json({ ok: false, error: 'Please sign in again' });
      if (!canSeeHoldHistory(u)) return res.status(403).json({ ok: false, error: 'Only superadmin can see the hold history' });
      const orderNo = orderKey(req.query.order_no);
      const r = await pool.query(
        `SELECT order_no, mould_no, mould_name, action, reason, old_reason, done_by, done_role, done_at
           FROM order_hold_history
          WHERE ($1 = '' OR order_no = $1)
          ORDER BY done_at DESC, id DESC
          LIMIT 1000`, [orderNo]);
      res.json({ ok: true, data: r.rows });
    } catch (err) { sendServerError(res, err); }
  });
}

module.exports = {
  registerOrderHoldRoutes,
  ensureOrderHoldSchema,
  canManageHolds,
  canSeeHoldHistory,
  orderKey,
  mouldKey
};
