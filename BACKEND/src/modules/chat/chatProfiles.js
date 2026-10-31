'use strict';

// JMS Chat profiles and presence.
//
//  * Profile photo + "About" line per user (chat_profiles). Photos are sniffed like
//    attachments (images only, max 5 MB), stored under the private chat upload folder
//    (avatars/), and served by GET /api/chat/avatars/:username to any chat user.
//    `photo_v` (a timestamp) changes with every new photo, so clients cache by URL.
//  * Last seen: chat_presence.last_seen_at is touched when a live stream opens and on
//    its 20-second heartbeat, and once more when it closes. "Online" = a stream on this
//    worker OR a touch in the last 50 s, so it holds across PM2 workers.
//  * Display name: a user may ask for a new name (chat_profiles.pending_name); it is
//    shown to others only after an admin / superadmin approves it. Admins always see
//    the login name and the earlier names (chat_name_history). A superadmin's own
//    change applies at once. Admins hear about new requests, and the user about the
//    decision (live event + phone push, through `notice`).
//  * MAIN owns profiles. A factory LOCAL pulls them from MAIN and forwards its users'
//    edits, requests and decisions to MAIN (chatProfileSync.js), so names, photos and
//    About read the same everywhere. Presence stays per server.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sniffAttachment } = require('./attachmentType');
const { isAdminLike, isSuperadmin } = require('../../app/auth');

const MAX_PHOTO = 5 * 1024 * 1024;
const MAX_ABOUT = 140;
const MAX_NAME = 40;
const MIN_NAME = 2;
const ONLINE_MS = 50 * 1000;
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO, files: 1, fields: 5 } });

let schemaReady = null;
function ensureProfileSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_profiles (
        username_lower TEXT PRIMARY KEY,
        about TEXT,
        photo_storage TEXT,
        photo_mime TEXT,
        photo_updated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chat_presence (
        username_lower TEXT PRIMARY KEY,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
      ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS pending_name TEXT;
      ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ;
      ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS name_note TEXT;
      ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS designation TEXT;
      ALTER TABLE chat_profiles ADD COLUMN IF NOT EXISTS department TEXT;
      CREATE TABLE IF NOT EXISTS chat_name_history (
        id BIGSERIAL PRIMARY KEY,
        username_lower TEXT NOT NULL,
        old_name TEXT,
        new_name TEXT NOT NULL,
        status TEXT NOT NULL,
        reviewed_by TEXT,
        note TEXT,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_name_history_user ON chat_name_history (username_lower, at DESC);
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ---- presence ----
const touched = new Map(); // username lower -> ms of the last write from this worker

async function touch(pool, username, force = false) {
  const key = String(username || '').toLowerCase();
  if (!key) return;
  const now = Date.now();
  if (!force && now - (touched.get(key) || 0) < 15000) return;
  touched.set(key, now);
  try {
    await ensureProfileSchema(pool);
    await pool.query(
      `INSERT INTO chat_presence (username_lower, last_seen_at) VALUES ($1, NOW())
       ON CONFLICT (username_lower) DO UPDATE SET last_seen_at = NOW()`, [key]
    );
  } catch (err) {
    console.warn('[chat] presence:', err.message);
  }
}

function isRecent(ts) {
  return Boolean(ts) && Date.now() - new Date(ts).getTime() < ONLINE_MS;
}

/** Map username lower -> { about, photo_v, last_seen_at, display_name } for these users. */
async function lookup(pool, usernames) {
  const keys = [...new Set((usernames || []).map((u) => String(u || '').toLowerCase()).filter(Boolean))];
  const out = new Map();
  if (!keys.length) return out;
  await ensureProfileSchema(pool);
  const { rows } = await pool.query(
    `SELECT k AS username_lower, p.about, p.photo_updated_at, p.display_name, s.last_seen_at
       FROM unnest($1::text[]) AS k
       LEFT JOIN chat_profiles p ON p.username_lower = k
       LEFT JOIN chat_presence s ON s.username_lower = k`, [keys]
  );
  for (const r of rows) {
    out.set(r.username_lower, {
      about: r.about || '',
      photo_v: r.photo_updated_at ? String(new Date(r.photo_updated_at).getTime()) : null,
      last_seen_at: r.last_seen_at || null,
      display_name: r.display_name || ''
    });
  }
  return out;
}

/** Trimmed, single-spaced name; '' when it is not usable. */
function cleanName(v) {
  const s = String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= MIN_NAME && s.length <= MAX_NAME ? s : '';
}

/** The name shown to others: the approved display name, or the login name. */
function shownName(username, displayName) {
  return displayName || username;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Profile writes, shared by the routes (MAIN) and by MAIN's handler for edits a LOCAL
 * forwards (chatProfileSync.js). `user` is { username, role }.
 * `notice(usernames, { kind, title, body, ... })` tells people (live + push).
 */
function createProfileOps(pool, { uploadRoot, notice = async () => {} }) {
  const avatarDir = path.join(uploadRoot, 'avatars');

  async function adminNames() {
    const { rows } = await pool.query(
      `SELECT username FROM users WHERE COALESCE(is_active, TRUE) = TRUE AND LOWER(role_code) IN ('admin', 'superadmin')`
    );
    return rows.map((r) => r.username);
  }

  async function saveFields(user, body) {
    await ensureProfileSchema(pool);
    body = body || {};
    const key = user.username.toLowerCase();
    let message = '';
    if (body.about !== undefined) {
      const about = String(body.about || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ABOUT);
      await pool.query(
        `INSERT INTO chat_profiles (username_lower, about) VALUES ($1, $2)
         ON CONFLICT (username_lower) DO UPDATE SET about = EXCLUDED.about, updated_at = NOW()`,
        [key, about]
      );
    }
    for (const field of ['designation', 'department']) { // fixed list: safe to interpolate
      if (body[field] === undefined) continue;
      const v = String(body[field] || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
      await pool.query(
        `INSERT INTO chat_profiles (username_lower, ${field}) VALUES ($1, $2)
         ON CONFLICT (username_lower) DO UPDATE SET ${field} = EXCLUDED.${field}, updated_at = NOW()`, [key, v]
      );
    }
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) throw new HttpError(400, `Name must be ${MIN_NAME} to ${MAX_NAME} characters.`);
      const { rows: [cur] } = await pool.query('SELECT display_name FROM chat_profiles WHERE username_lower = $1', [key]);
      const shown = shownName(user.username, cur && cur.display_name);
      if (name === shown) {
        await pool.query('UPDATE chat_profiles SET pending_name = NULL, pending_at = NULL, updated_at = NOW() WHERE username_lower = $1', [key]);
      } else if (isSuperadmin(user)) {
        await pool.query(
          `INSERT INTO chat_profiles (username_lower, display_name) VALUES ($1, $2)
           ON CONFLICT (username_lower) DO UPDATE SET display_name = EXCLUDED.display_name,
             pending_name = NULL, pending_at = NULL, name_note = NULL, updated_at = NOW()`, [key, name]
        );
        await pool.query(
          `INSERT INTO chat_name_history (username_lower, old_name, new_name, status, reviewed_by)
           VALUES ($1, $2, $3, 'approved', $4)`, [key, shown, name, user.username]
        );
        message = 'Name updated.';
      } else {
        await pool.query(
          `INSERT INTO chat_profiles (username_lower, pending_name, pending_at) VALUES ($1, $2, NOW())
           ON CONFLICT (username_lower) DO UPDATE SET pending_name = EXCLUDED.pending_name,
             pending_at = NOW(), name_note = NULL, updated_at = NOW()`, [key, name]
        );
        message = 'Sent for approval. Others keep seeing your current name until an admin approves it.';
        const admins = (await adminNames()).filter((a) => a.toLowerCase() !== key);
        notice(admins, {
          kind: 'name_request', username: user.username,
          title: 'New name request', body: `${shown} wants to be called "${name}". Tap to review.`
        }).catch(() => {});
      }
    }
    return { message };
  }

  async function cancelName(user) {
    await ensureProfileSchema(pool);
    await pool.query(
      'UPDATE chat_profiles SET pending_name = NULL, pending_at = NULL, updated_at = NOW() WHERE username_lower = $1',
      [user.username.toLowerCase()]
    );
    return {};
  }

  async function setPhoto(user, buffer) {
    const type = sniffAttachment(buffer);
    if (!type || type.kind !== 'image') throw new HttpError(415, 'Only JPG, PNG, GIF or WebP photos.');
    if (buffer.length > MAX_PHOTO) throw new HttpError(413, 'Photo is too big (max 5 MB).');
    await ensureProfileSchema(pool);
    await fs.promises.mkdir(avatarDir, { recursive: true });
    const name = `${crypto.randomUUID()}${type.ext}`;
    await fs.promises.writeFile(path.join(avatarDir, name), buffer, { flag: 'wx' });
    const key = user.username.toLowerCase();
    const { rows: [old] } = await pool.query('SELECT photo_storage FROM chat_profiles WHERE username_lower = $1', [key]);
    await pool.query(
      `INSERT INTO chat_profiles (username_lower, photo_storage, photo_mime, photo_updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (username_lower) DO UPDATE SET photo_storage = EXCLUDED.photo_storage,
         photo_mime = EXCLUDED.photo_mime, photo_updated_at = NOW(), updated_at = NOW()`,
      [key, name, type.mime]
    );
    if (old && old.photo_storage) fs.promises.unlink(path.join(avatarDir, path.basename(old.photo_storage))).catch(() => {});
    return {};
  }

  async function removePhoto(user) {
    await ensureProfileSchema(pool);
    const key = user.username.toLowerCase();
    const { rows: [old] } = await pool.query(
      `UPDATE chat_profiles p SET photo_storage = NULL, photo_mime = NULL, photo_updated_at = NULL, updated_at = NOW()
         FROM (SELECT photo_storage FROM chat_profiles WHERE username_lower = $1) o
        WHERE p.username_lower = $1 RETURNING o.photo_storage`, [key]
    );
    if (old && old.photo_storage) fs.promises.unlink(path.join(avatarDir, path.basename(old.photo_storage))).catch(() => {});
    return {};
  }

  async function pendingCount() {
    await ensureProfileSchema(pool);
    const { rows: [r] } = await pool.query('SELECT COUNT(*)::int AS n FROM chat_profiles WHERE pending_name IS NOT NULL');
    return r.n;
  }

  // action 'approve' | 'reject'
  async function decide(reviewer, username, action, note) {
    if (!isAdminLike(reviewer)) throw new HttpError(403, 'Only an admin or superadmin can review names.');
    if (action !== 'approve' && action !== 'reject') throw new HttpError(400, 'Choose approve or reject.');
    await ensureProfileSchema(pool);
    note = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;
    const key = String(username || '').toLowerCase();
    let target = key;
    let old = null;
    let wanted = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [p] } = await client.query(
        'SELECT display_name, pending_name FROM chat_profiles WHERE username_lower = $1 FOR UPDATE', [key]
      );
      if (!p || !p.pending_name) {
        await client.query('ROLLBACK');
        throw new HttpError(404, 'No pending name for this user (already reviewed?).');
      }
      const { rows: [u] } = await client.query('SELECT username FROM users WHERE LOWER(username) = $1 LIMIT 1', [key]);
      target = u ? u.username : key;
      old = shownName(target, p.display_name);
      wanted = p.pending_name;
      if (action === 'approve') {
        await client.query(
          `UPDATE chat_profiles SET display_name = pending_name, pending_name = NULL, pending_at = NULL,
             name_note = NULL, updated_at = NOW() WHERE username_lower = $1`, [key]
        );
      } else {
        await client.query(
          `UPDATE chat_profiles SET pending_name = NULL, pending_at = NULL, name_note = $2, updated_at = NOW()
            WHERE username_lower = $1`, [key, note || 'Name change was not approved.']
        );
      }
      await client.query(
        `INSERT INTO chat_name_history (username_lower, old_name, new_name, status, reviewed_by, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [key, old, wanted, action === 'approve' ? 'approved' : 'rejected', reviewer.username, note]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    notice([target], action === 'approve'
      ? { kind: 'name_decision', status: 'approved', title: 'Name approved ✅', body: `Everyone now sees you as "${wanted}".` }
      : { kind: 'name_decision', status: 'rejected', title: 'Name not approved', body: `"${wanted}" was not approved${note ? `: ${note}` : '.'}` }
    ).catch(() => {});
    return { remaining: await pendingCount() };
  }

  return { saveFields, cancelName, setPhoto, removePhoto, decide, pendingCount, avatarDir };
}

/**
 * Other users already shown with this name (case-insensitive): login names, or
 * approved display names. A hint for admins against look-alike names.
 */
async function sameNameUsers(pool, name, exceptKey) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return [];
  const { rows } = await pool.query(
    `SELECT u.username, p.display_name FROM users u
       LEFT JOIN chat_profiles p ON p.username_lower = LOWER(u.username)
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND LOWER(u.username) <> $2
        AND LOWER(COALESCE(p.display_name, u.username)) = $1
      LIMIT 5`, [n, exceptKey]
  );
  return rows.map((r) => r.username);
}

/**
 * `forward(op, username, args)` is set on a LOCAL: writes then go to MAIN (which owns
 * profiles) and come back through the profile pull; null on MAIN.
 */
function registerProfileRoutes(app, pool, { ready, fail, uploadRoot, isOnline, activeUser, notice, forward = null }) {
  const ops = createProfileOps(pool, { uploadRoot, notice });
  const avatarDir = ops.avatarDir;

  async function run(op, auth, ...args) {
    if (forward) return forward(op, auth.username, args);
    if (op === 'decide') return ops.decide(auth, ...args);
    return ops[op]({ username: auth.username, role: auth.role }, ...args);
  }

  function sendError(res, err, what) {
    if (err && err.status && err.status < 500) return res.status(err.status).json({ ok: false, error: err.message });
    return fail(res, err, what);
  }

  async function history(key, limit = 10) {
    const { rows } = await pool.query(
      `SELECT old_name, new_name, status, reviewed_by, note, at FROM chat_name_history
        WHERE username_lower = $1 ORDER BY at DESC LIMIT $2`, [key, limit]
    );
    return rows;
  }

  // `viewer` decides what is shown: self sees the pending request, admins see the login
  // name, the pending request and the earlier names; everyone else the shown name only.
  async function profileOut(username, viewer) {
    await ensureProfileSchema(pool);
    const key = username.toLowerCase();
    const p = (await lookup(pool, [username])).get(key) || {};
    const { rows: [u] } = await pool.query(
      'SELECT username, role_code, line FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]
    );
    const { rows: [n] } = await pool.query(
      'SELECT pending_name, pending_at, name_note, designation, department FROM chat_profiles WHERE username_lower = $1', [key]
    );
    // Designation / department: what the user set, else their chat sign-up form, else role / line.
    const su = await pool.query(
      `SELECT designation, department, mobile FROM chat_signups
        WHERE LOWER(username) = $1 ORDER BY created_at DESC LIMIT 1`, [key]
    ).then((r) => r.rows[0] || null).catch(() => null); // table exists only once sign-ups were used
    const login = u ? u.username : username;
    const self = Boolean(viewer) && viewer.username.toLowerCase() === key;
    const admin = isAdminLike(viewer);
    const out = {
      username: login,
      display_name: shownName(login, p.display_name),
      role: (u && u.role_code) || '',
      line: (u && u.line) || '',
      designation: (n && n.designation) || (su && su.designation) || String((u && u.role_code) || '').replace(/_/g, ' '),
      department: (n && n.department) || (su && su.department) || (u && u.line) || '',
      about: p.about || '',
      photo_v: p.photo_v || null,
      last_seen_at: p.last_seen_at || null,
      online: isOnline(username) || isRecent(p.last_seen_at)
    };
    if (self || admin) {
      out.pending_name = (n && n.pending_name) || null;
      out.pending_at = (n && n.pending_at) || null;
      out.name_note = (n && n.name_note) || null;
    }
    if ((self || admin) && su && su.mobile) out.mobile = su.mobile;
    if (admin) { out.admin_view = true; out.name_history = await history(key); }
    if (self) {
      out.can_approve_names = admin;
      if (admin) out.name_requests = await ops.pendingCount();
    }
    return out;
  }

  app.get('/api/chat/profile', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { fail(res, err, 'profile'); }
  });

  app.get('/api/chat/profile/:username', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const name = await activeUser(pool, String(req.params.username || ''));
      if (!name) return res.status(404).json({ ok: false, error: 'User not found.' });
      res.json({ ok: true, profile: await profileOut(name, req.auth) });
    } catch (err) { fail(res, err, 'profile'); }
  });

  // Body: { about, designation, department } and / or { name }. A new name waits for an
  // admin's approval (a superadmin's own applies at once); sending the shown name again
  // drops the request.
  app.put('/api/chat/profile', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const r = await run('saveFields', req.auth, req.body || {});
      res.json({ ok: true, message: (r && r.message) || '', profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { sendError(res, err, 'profile save'); }
  });

  // Withdraw my pending name request.
  app.delete('/api/chat/profile/name', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await run('cancelName', req.auth);
      res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { sendError(res, err, 'name request'); }
  });

  app.post('/api/chat/profile/photo', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
    } catch (err) { return fail(res, err, 'photo'); }
    photoUpload.single('photo')(req, res, async (upErr) => {
      try {
        if (upErr) {
          const big = upErr.code === 'LIMIT_FILE_SIZE';
          return res.status(big ? 413 : 400).json({ ok: false, error: big ? 'Photo is too big (max 5 MB).' : 'Could not read the photo.' });
        }
        if (!req.file) return res.status(400).json({ ok: false, error: 'No photo attached.' });
        await run('setPhoto', req.auth, req.file.buffer);
        res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
      } catch (err) { sendError(res, err, 'photo'); }
    });
  });

  app.delete('/api/chat/profile/photo', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await run('removePhoto', req.auth);
      res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { sendError(res, err, 'photo remove'); }
  });

  // Any signed-in chat user may see anyone's profile photo (like WhatsApp contacts).
  app.get('/api/chat/avatars/:username', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureProfileSchema(pool);
      const { rows: [p] } = await pool.query(
        'SELECT photo_storage, photo_mime FROM chat_profiles WHERE username_lower = LOWER($1)', [String(req.params.username || '')]
      );
      if (!p || !p.photo_storage) return res.status(404).json({ ok: false, error: 'No photo.' });
      const file = path.join(avatarDir, path.basename(p.photo_storage));
      res.setHeader('Content-Type', p.photo_mime || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=604800'); // the URL carries ?v=<photo time>
      res.setHeader('X-Content-Type-Options', 'nosniff');
      fs.createReadStream(file).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); }).pipe(res);
    } catch (err) { fail(res, err, 'avatar'); }
  });

  // ---- name approvals (admin / superadmin) ----
  function adminOnly(req, res) {
    if (isAdminLike(req.auth)) return true;
    res.status(403).json({ ok: false, error: 'Only an admin or superadmin can review names.' });
    return false;
  }

  app.get('/api/chat/name-requests', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureProfileSchema(pool);
      const { rows } = await pool.query(
        `SELECT COALESCE(u.username, p.username_lower) AS username, u.role_code, u.line,
                p.display_name, p.pending_name, p.pending_at, p.photo_updated_at
           FROM chat_profiles p
           LEFT JOIN users u ON LOWER(u.username) = p.username_lower
          WHERE p.pending_name IS NOT NULL
          ORDER BY p.pending_at ASC NULLS LAST`
      );
      const { rows: recent } = await pool.query(
        `SELECT COALESCE(u.username, h.username_lower) AS username, h.old_name, h.new_name, h.status, h.reviewed_by, h.note, h.at
           FROM chat_name_history h
           LEFT JOIN users u ON LOWER(u.username) = h.username_lower
          ORDER BY h.at DESC LIMIT 30`
      );
      const requests = [];
      for (const r of rows) {
        requests.push({
          username: r.username,
          role: r.role_code || '',
          line: r.line || '',
          current_name: shownName(r.username, r.display_name),
          requested_name: r.pending_name,
          requested_at: r.pending_at,
          photo_v: r.photo_updated_at ? String(new Date(r.photo_updated_at).getTime()) : null,
          // other people already called this (warn before approving a look-alike)
          same_name: await sameNameUsers(pool, r.pending_name, String(r.username).toLowerCase())
        });
      }
      res.json({ ok: true, requests, recent });
    } catch (err) { fail(res, err, 'name requests'); }
  });

  // Body: { action: 'approve' | 'reject', note? }
  app.post('/api/chat/name-requests/:username', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      const b = req.body || {};
      const r = await run('decide', req.auth, String(req.params.username || ''), String(b.action || ''), b.note);
      res.json({ ok: true, remaining: r && r.remaining != null ? r.remaining : undefined });
    } catch (err) { sendError(res, err, 'name review'); }
  });
}

module.exports = {
  ensureProfileSchema, touch, lookup, isRecent, shownName, cleanName, sameNameUsers,
  createProfileOps, registerProfileRoutes, HttpError, MAX_PHOTO
};
