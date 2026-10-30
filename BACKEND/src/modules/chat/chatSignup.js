'use strict';

// JMS Chat app sign-up (MAIN only).
//
//  1. Someone new opens the chat app and sends a request: name, mobile, designation,
//     department and HOD name (POST /api/chat-app/signup). The phone keeps a random
//     request token; only its SHA-256 is stored.
//  2. Admins and superadmins see the waiting requests in the chat (GET /api/chat/signups,
//     live event 'signup_request') and approve or reject them.
//  3. Approve creates a chat user (role chat_user, no password, no JMS permissions) with
//     the username the admin confirmed. The app polls GET /api/chat-app/signup/status and
//     tells the person they were approved and which username to use.
//  4. First sign-in sets the password (POST /api/chat-app/set-password). It needs the
//     request token from the phone that asked, or the mobile number from the request, so
//     knowing someone's name alone is not enough to take the account.
//  Rejected requests: the app quietly forgets the request.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { isAdminLike } = require('../../app/auth');
const lockout = require('../../app/loginLockout');
const chatSync = require('./chatSync');
const chatSecure = require('./chatSecure');
const chatProfiles = require('./chatProfiles');

const ROLE = 'chat_user';
const TOKEN_RE = /^[a-f0-9]{48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,39}$/;
const MIN_PASSWORD = 6;
const PER_IP_PER_HOUR = 40; // a whole factory may share one Wi-Fi address

let schemaReady = null;
function ensureSignupSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_signups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        designation TEXT NOT NULL,
        department TEXT NOT NULL,
        hod_name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        username TEXT,
        factory_id INTEGER,
        password_set BOOLEAN NOT NULL DEFAULT FALSE,
        decided_by TEXT,
        decided_at TIMESTAMPTZ,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_signups_status ON chat_signups (status, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_signups_user ON chat_signups (LOWER(username));
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Indian mobile: 10 digits, a leading +91 / 91 / 0 is dropped. null when not valid. */
function normalizeMobile(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "Ravi  kumar!" -> "Ravi kumar": letters, digits, space, dot, dash, underscore. */
function usernameFrom(name) {
  const s = String(name || '').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return s.length >= 2 ? s : '';
}

async function usernameTaken(db, username) {
  const { rows } = await db.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
  return rows.length > 0;
}

/** A free username for this request: the name, else the name + last 4 of the mobile, else + a number. */
async function suggestUsername(db, r) {
  const base = usernameFrom(r.name) || 'user';
  if (!(await usernameTaken(db, base))) return base;
  const withMobile = `${base.slice(0, 34)} ${r.mobile.slice(-4)}`;
  if (!(await usernameTaken(db, withMobile))) return withMobile;
  for (let i = 2; i < 50; i++) {
    const c = `${base.slice(0, 36)} ${i}`;
    if (!(await usernameTaken(db, c))) return c;
  }
  return `${base.slice(0, 30)} ${crypto.randomBytes(3).toString('hex')}`;
}

// Simple per-IP limit for the public request form.
const recent = new Map(); // ip -> [timestamps]
function rateOk(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (list.length >= PER_IP_PER_HOUR) { recent.set(ip, list); return false; }
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 60);
}

function out(r) {
  return {
    id: r.id, name: r.name, mobile: r.mobile, designation: r.designation, department: r.department,
    hod_name: r.hod_name, status: r.status, username: r.username, factory_id: r.factory_id,
    decided_by: r.decided_by, decided_at: r.decided_at, created_at: r.created_at
  };
}

async function adminUsernames(pool) {
  const { rows } = await pool.query(
    `SELECT username FROM users WHERE COALESCE(is_active, TRUE) = TRUE AND LOWER(role_code) IN ('admin', 'superadmin')`
  );
  return rows.map((r) => r.username);
}

/**
 * Public routes (no session): request, status, first password.
 * completeLogin(req, res, user) signs the person in exactly like /api/chat-app/login.
 */
function registerSignupPublicRoutes(app, pool, { completeLogin, pushTo }) {
  function mainOnly(res) {
    if (!chatSync.isLocal()) return true;
    res.status(400).json({ ok: false, error: 'Sign-up works on the main JMS server only.' });
    return false;
  }

  app.post('/api/chat-app/signup', async (req, res) => {
    try {
      if (!mainOnly(res)) return;
      await ensureSignupSchema(pool);
      const b = req.body || {};
      const r = {
        name: clean(b.name, 60), mobile: normalizeMobile(b.mobile), designation: clean(b.designation, 60),
        department: clean(b.department, 60), hod_name: clean(b.hod_name, 60)
      };
      if (r.name.length < 2) return res.status(400).json({ ok: false, error: 'Enter your full name.' });
      if (!r.mobile) return res.status(400).json({ ok: false, error: 'Enter a valid 10-digit mobile number.' });
      if (!r.designation) return res.status(400).json({ ok: false, error: 'Enter your designation.' });
      if (!r.department) return res.status(400).json({ ok: false, error: 'Enter your department.' });
      if (!r.hod_name) return res.status(400).json({ ok: false, error: "Enter your HOD's name." });
      const ip = clientIp(req);
      if (!rateOk(ip)) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });

      const { rows: [dup] } = await pool.query(
        `SELECT status FROM chat_signups WHERE mobile = $1 AND status IN ('pending', 'approved')
          ORDER BY created_at DESC LIMIT 1`, [r.mobile]
      );
      if (dup && dup.status === 'pending') {
        return res.status(409).json({ ok: false, error: 'A request for this mobile number is already waiting for approval.' });
      }
      if (dup && dup.status === 'approved') {
        return res.status(409).json({ ok: false, error: 'This mobile number already has an account. Please sign in.' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      const { rows: [row] } = await pool.query(
        `INSERT INTO chat_signups (name, mobile, designation, department, hod_name, token_hash, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [r.name, r.mobile, r.designation, r.department, r.hod_name, sha(token), ip]
      );
      // Admins with the chat open see it straight away.
      adminUsernames(pool).then((names) => pushTo(names, { type: 'signup_request', request: out(row) })).catch(() => {});
      res.json({ ok: true, token, status: 'pending' });
    } catch (err) {
      console.error('[chat] signup:', err);
      res.status(500).json({ ok: false, error: 'Could not send the request. Please try again.' });
    }
  });

  // The app asks while it waits. Unknown token: 'unknown' (treated like rejected).
  app.get('/api/chat-app/signup/status', async (req, res) => {
    try {
      if (!mainOnly(res)) return;
      await ensureSignupSchema(pool);
      const token = String(req.query.token || '');
      res.setHeader('Cache-Control', 'no-store');
      if (!TOKEN_RE.test(token)) return res.json({ ok: true, status: 'unknown' });
      const { rows: [r] } = await pool.query(
        'SELECT status, username, name, password_set FROM chat_signups WHERE token_hash = $1', [sha(token)]
      );
      if (!r) return res.json({ ok: true, status: 'unknown' });
      if (r.status !== 'approved') return res.json({ ok: true, status: r.status, name: r.name });
      res.json({ ok: true, status: 'approved', name: r.name, username: r.username, password_set: r.password_set });
    } catch (err) {
      console.error('[chat] signup status:', err);
      res.status(500).json({ ok: false, error: 'Please try again.' });
    }
  });

  // First sign-in of an approved person: set the password, then sign in.
  app.post('/api/chat-app/set-password', async (req, res) => {
    try {
      if (!mainOnly(res)) return;
      await ensureSignupSchema(pool);
      const b = req.body || {};
      const username = clean(b.username, 40);
      const password = String(b.password || '');
      const token = String(b.token || '');
      const mobile = normalizeMobile(b.mobile);
      if (!username) return res.status(400).json({ ok: false, error: 'Enter your username.' });
      if (password.length < MIN_PASSWORD) {
        return res.status(400).json({ ok: false, error: `Use at least ${MIN_PASSWORD} characters for the password.` });
      }
      const lockMsg = lockout.checkBruteForce(username, req.ip);
      if (lockMsg) return res.status(429).json({ ok: false, error: lockMsg });

      const { rows: [s] } = await pool.query(
        `SELECT id, mobile, token_hash FROM chat_signups
          WHERE LOWER(username) = LOWER($1) AND status = 'approved' AND NOT password_set
          ORDER BY decided_at DESC LIMIT 1`, [username]
      );
      const proven = !!s && ((TOKEN_RE.test(token) && sha(token) === s.token_hash) || (!!mobile && mobile === s.mobile));
      if (!proven) {
        lockout.recordLoginFailure(username, req.ip);
        return res.status(401).json({
          ok: false, need_mobile: !!s && !TOKEN_RE.test(token),
          error: s ? 'That mobile number does not match the request.' : 'No new account waiting for a password with that username.'
        });
      }
      const hash = await bcrypt.hash(password, 12);
      const { rows: [u] } = await pool.query(
        `UPDATE users SET password = $2, updated_at = NOW()
          WHERE LOWER(username) = LOWER($1) AND COALESCE(is_active, TRUE) = TRUE AND (password IS NULL OR password = '')
          RETURNING id, username, role_code`,
        [username, hash]
      );
      if (!u) return res.status(409).json({ ok: false, error: 'This account already has a password. Please sign in.' });
      await pool.query('UPDATE chat_signups SET password_set = TRUE WHERE id = $1', [s.id]);
      lockout.clearLoginFailures(username, req.ip);
      await completeLogin(req, res, u);
    } catch (err) {
      console.error('[chat] set password:', err);
      res.status(500).json({ ok: false, error: 'Could not set the password. Please try again.' });
    }
  });
}

/** Login of an approved user who has no password yet: tell the app to ask for one. */
async function needsFirstPassword(pool, username) {
  await ensureSignupSchema(pool);
  const { rows } = await pool.query(
    `SELECT 1 FROM chat_signups WHERE LOWER(username) = LOWER($1) AND status = 'approved' AND NOT password_set LIMIT 1`, [username]
  );
  return rows.length > 0;
}

/** Admin routes (chat session; admin or superadmin). */
function registerSignupAdminRoutes(app, pool, { ready, fail, pushTo, isOnline = () => false }) {
  function adminOnly(req, res) {
    if (isAdminLike(req.auth)) return true;
    res.status(403).json({ ok: false, error: 'Only an admin can manage sign-up requests.' });
    return false;
  }

  async function factories() {
    try {
      const { rows } = await pool.query('SELECT id, name FROM factories WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name');
      return rows;
    } catch (_e) { return []; }
  }

  app.get('/api/chat/signups', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureSignupSchema(pool);
      const all = req.query.status === 'all';
      const { rows } = await pool.query(
        `SELECT * FROM chat_signups ${all ? '' : "WHERE status = 'pending'"} ORDER BY created_at DESC LIMIT 200`
      );
      const list = [];
      for (const r of rows) {
        const o = out(r);
        if (r.status === 'pending') o.suggested_username = await suggestUsername(pool, r);
        list.push(o);
      }
      res.json({ ok: true, requests: list, factories: await factories() });
    } catch (err) { fail(res, err, 'signups'); }
  });

  // Chat users page (chat_users.html): every JMS user with chat last seen, devices and
  // how they joined.
  app.get('/api/chat/admin/people', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await Promise.all([ensureSignupSchema(pool), chatSecure.ensureSecureSchema(pool), chatProfiles.ensureProfileSchema(pool)]);
      const { rows } = await pool.query(`
        WITH dev AS (
          SELECT LOWER(username) AS k, COUNT(*)::int AS devices,
                 BOOL_OR(platform = 'android-app') AS android_app,
                 BOOL_OR(platform = 'mac-app') AS mac_app,
                 BOOL_OR(platform = 'iphone-web') AS iphone,
                 MAX(last_seen_at) AS device_seen_at, MIN(created_at) AS first_device_at,
                 (ARRAY_AGG(platform ORDER BY last_seen_at DESC NULLS LAST))[1] AS last_platform,
                 (ARRAY_AGG(name ORDER BY last_seen_at DESC NULLS LAST))[1] AS last_device,
                 (ARRAY_AGG(ip ORDER BY last_seen_at DESC NULLS LAST))[1] AS last_ip
            FROM chat_devices GROUP BY 1),
        su AS (
          SELECT DISTINCT ON (LOWER(username)) LOWER(username) AS k, mobile, designation, department, hod_name,
                 decided_by AS approved_by, decided_at AS approved_at, created_at AS requested_at, password_set
            FROM chat_signups WHERE status = 'approved' AND username IS NOT NULL
           ORDER BY LOWER(username), decided_at DESC)
        SELECT u.username, u.role_code, u.line, COALESCE(u.is_active, TRUE) AS active,
               p.last_seen_at, dev.devices, dev.android_app, dev.mac_app, dev.iphone, dev.device_seen_at, dev.first_device_at,
               dev.last_platform, dev.last_device, dev.last_ip,
               su.mobile, su.designation, su.department, su.hod_name, su.approved_by, su.approved_at, su.requested_at, su.password_set
          FROM users u
          LEFT JOIN chat_presence p ON p.username_lower = LOWER(u.username)
          LEFT JOIN dev ON dev.k = LOWER(u.username)
          LEFT JOIN su ON su.k = LOWER(u.username)
         ORDER BY GREATEST(p.last_seen_at, dev.device_seen_at) DESC NULLS LAST, LOWER(u.username)
         LIMIT 3000`);
      res.json({
        ok: true,
        people: rows.map((r) => ({
          ...r,
          devices: r.devices || 0,
          online: Boolean(r.active) && (isOnline(r.username) || chatProfiles.isRecent(r.last_seen_at)),
          via_signup: !!r.approved_at
        }))
      });
    } catch (err) { fail(res, err, 'chat people'); }
  });

  app.post('/api/chat/signups/:id/approve', async (req, res) => {
    const client = await pool.connect();
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureSignupSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad request id.' });
      const b = req.body || {};
      await client.query('BEGIN');
      const { rows: [r] } = await client.query('SELECT * FROM chat_signups WHERE id = $1 FOR UPDATE', [id]);
      if (!r) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Request not found.' }); }
      if (r.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: `This request was already ${r.status}.` });
      }
      const username = b.username ? clean(b.username, 40) : await suggestUsername(client, r);
      if (!USERNAME_RE.test(username)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Username: 2-40 letters, digits, spaces, dots, dashes or underscores.' });
      }
      if (await usernameTaken(client, username)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: `The username "${username}" is already taken. Pick another.` });
      }
      const factoryId = Number.isInteger(Number(b.factory_id)) && Number(b.factory_id) > 0 ? Number(b.factory_id) : null;
      const { rows: [u] } = await client.query(
        `INSERT INTO users (username, password, line, role_code, permissions, is_active, global_access)
         VALUES ($1, NULL, $2, $3, '{}'::jsonb, TRUE, FALSE) RETURNING id`,
        [username, r.department, ROLE]
      );
      if (factoryId) {
        await client.query(
          `INSERT INTO user_factories (user_id, factory_id, role_code) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
          [u.id, factoryId]
        );
      }
      // Their "About" line in the chat: designation · department.
      await client.query('SAVEPOINT about');
      try {
        await client.query(
          `INSERT INTO chat_profiles (username_lower, about) VALUES (LOWER($1), $2)
           ON CONFLICT (username_lower) DO UPDATE SET about = EXCLUDED.about, updated_at = NOW()`,
          [username, `${r.designation} · ${r.department}`.slice(0, 140)]
        );
      } catch (_e) { await client.query('ROLLBACK TO SAVEPOINT about'); }
      const { rows: [done] } = await client.query(
        `UPDATE chat_signups SET status = 'approved', username = $2, factory_id = $3, decided_by = $4, decided_at = NOW()
          WHERE id = $1 RETURNING *`, [id, username, factoryId, req.auth.username]
      );
      await client.query('COMMIT');
      adminUsernames(pool).then((names) => pushTo(names, { type: 'signup_update', request: out(done) })).catch(() => {});
      res.json({ ok: true, request: out(done) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      fail(res, err, 'signup approve');
    } finally {
      client.release();
    }
  });

  app.post('/api/chat/signups/:id/reject', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureSignupSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad request id.' });
      const { rows: [r] } = await pool.query(
        `UPDATE chat_signups SET status = 'rejected', decided_by = $2, decided_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING *`, [id, req.auth.username]
      );
      if (!r) return res.status(409).json({ ok: false, error: 'This request is not waiting any more.' });
      adminUsernames(pool).then((names) => pushTo(names, { type: 'signup_update', request: out(r) })).catch(() => {});
      res.json({ ok: true, request: out(r) });
    } catch (err) { fail(res, err, 'signup reject'); }
  });
}

module.exports = {
  ensureSignupSchema, registerSignupPublicRoutes, registerSignupAdminRoutes, needsFirstPassword,
  ROLE, __test: { normalizeMobile, usernameFrom, suggestUsername, rateOk, recent }
};
