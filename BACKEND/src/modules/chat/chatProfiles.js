'use strict';

// JMS Chat profiles and presence (MAIN and LOCAL each keep their own; not synced).
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
//    change applies at once.

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

function registerProfileRoutes(app, pool, { ready, fail, uploadRoot, isOnline, activeUser }) {
  const avatarDir = path.join(uploadRoot, 'avatars');

  async function pendingCount() {
    const { rows: [r] } = await pool.query('SELECT COUNT(*)::int AS n FROM chat_profiles WHERE pending_name IS NOT NULL');
    return r.n;
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
      'SELECT pending_name, pending_at, name_note FROM chat_profiles WHERE username_lower = $1', [key]
    );
    const login = u ? u.username : username;
    const self = Boolean(viewer) && viewer.username.toLowerCase() === key;
    const admin = isAdminLike(viewer);
    const out = {
      username: login,
      display_name: shownName(login, p.display_name),
      role: (u && u.role_code) || '',
      line: (u && u.line) || '',
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
    if (admin) { out.admin_view = true; out.name_history = await history(key); }
    if (self) {
      out.can_approve_names = admin;
      if (admin) out.name_requests = await pendingCount();
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

  // Body: { about } and / or { name }. A new name waits for an admin's approval
  // (a superadmin's own applies at once); sending the shown name again drops the request.
  app.put('/api/chat/profile', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureProfileSchema(pool);
      const body = req.body || {};
      const key = req.auth.username.toLowerCase();
      let message = '';
      if (body.about !== undefined) {
        const about = String(body.about || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ABOUT);
        await pool.query(
          `INSERT INTO chat_profiles (username_lower, about) VALUES ($1, $2)
           ON CONFLICT (username_lower) DO UPDATE SET about = EXCLUDED.about, updated_at = NOW()`,
          [key, about]
        );
      }
      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (!name) return res.status(400).json({ ok: false, error: `Name must be ${MIN_NAME} to ${MAX_NAME} characters.` });
        const { rows: [cur] } = await pool.query('SELECT display_name FROM chat_profiles WHERE username_lower = $1', [key]);
        const shown = shownName(req.auth.username, cur && cur.display_name);
        if (name === shown) {
          await pool.query('UPDATE chat_profiles SET pending_name = NULL, pending_at = NULL, updated_at = NOW() WHERE username_lower = $1', [key]);
        } else if (isSuperadmin(req.auth)) {
          await pool.query(
            `INSERT INTO chat_profiles (username_lower, display_name) VALUES ($1, $2)
             ON CONFLICT (username_lower) DO UPDATE SET display_name = EXCLUDED.display_name,
               pending_name = NULL, pending_at = NULL, name_note = NULL, updated_at = NOW()`, [key, name]
          );
          await pool.query(
            `INSERT INTO chat_name_history (username_lower, old_name, new_name, status, reviewed_by)
             VALUES ($1, $2, $3, 'approved', $4)`, [key, shown, name, req.auth.username]
          );
          message = 'Name updated.';
        } else {
          await pool.query(
            `INSERT INTO chat_profiles (username_lower, pending_name, pending_at) VALUES ($1, $2, NOW())
             ON CONFLICT (username_lower) DO UPDATE SET pending_name = EXCLUDED.pending_name,
               pending_at = NOW(), name_note = NULL, updated_at = NOW()`, [key, name]
          );
          message = 'Sent for approval. Others keep seeing your current name until an admin approves it.';
        }
      }
      res.json({ ok: true, message, profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { fail(res, err, 'profile save'); }
  });

  // Withdraw my pending name request.
  app.delete('/api/chat/profile/name', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureProfileSchema(pool);
      await pool.query(
        'UPDATE chat_profiles SET pending_name = NULL, pending_at = NULL, updated_at = NOW() WHERE username_lower = $1',
        [req.auth.username.toLowerCase()]
      );
      res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { fail(res, err, 'name request'); }
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
      res.json({
        ok: true,
        requests: rows.map((r) => ({
          username: r.username,
          role: r.role_code || '',
          line: r.line || '',
          current_name: shownName(r.username, r.display_name),
          requested_name: r.pending_name,
          requested_at: r.pending_at,
          photo_v: r.photo_updated_at ? String(new Date(r.photo_updated_at).getTime()) : null
        })),
        recent
      });
    } catch (err) { fail(res, err, 'name requests'); }
  });

  // Body: { action: 'approve' | 'reject', note? }
  app.post('/api/chat/name-requests/:username', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureProfileSchema(pool);
      const action = String((req.body && req.body.action) || '');
      if (action !== 'approve' && action !== 'reject') return res.status(400).json({ ok: false, error: 'Choose approve or reject.' });
      const note = String((req.body && req.body.note) || '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;
      const key = String(req.params.username || '').toLowerCase();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [p] } = await client.query(
          'SELECT display_name, pending_name FROM chat_profiles WHERE username_lower = $1 FOR UPDATE', [key]
        );
        if (!p || !p.pending_name) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: 'No pending name for this user (already reviewed?).' });
        }
        const { rows: [u] } = await client.query('SELECT username FROM users WHERE LOWER(username) = $1 LIMIT 1', [key]);
        const old = shownName(u ? u.username : key, p.display_name);
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
          [key, old, p.pending_name, action === 'approve' ? 'approved' : 'rejected', req.auth.username, note]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      res.json({ ok: true, remaining: await pendingCount() });
    } catch (err) { fail(res, err, 'name review'); }
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
        const type = sniffAttachment(req.file.buffer);
        if (!type || type.kind !== 'image') return res.status(415).json({ ok: false, error: 'Only JPG, PNG, GIF or WebP photos.' });
        await ensureProfileSchema(pool);
        await fs.promises.mkdir(avatarDir, { recursive: true });
        const name = `${crypto.randomUUID()}${type.ext}`;
        await fs.promises.writeFile(path.join(avatarDir, name), req.file.buffer, { flag: 'wx' });
        const key = req.auth.username.toLowerCase();
        const { rows: [old] } = await pool.query('SELECT photo_storage FROM chat_profiles WHERE username_lower = $1', [key]);
        await pool.query(
          `INSERT INTO chat_profiles (username_lower, photo_storage, photo_mime, photo_updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (username_lower) DO UPDATE SET photo_storage = EXCLUDED.photo_storage,
             photo_mime = EXCLUDED.photo_mime, photo_updated_at = NOW(), updated_at = NOW()`,
          [key, name, type.mime]
        );
        if (old && old.photo_storage) fs.promises.unlink(path.join(avatarDir, path.basename(old.photo_storage))).catch(() => {});
        res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
      } catch (err) { fail(res, err, 'photo'); }
    });
  });

  app.delete('/api/chat/profile/photo', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureProfileSchema(pool);
      const key = req.auth.username.toLowerCase();
      const { rows: [old] } = await pool.query(
        `UPDATE chat_profiles p SET photo_storage = NULL, photo_mime = NULL, photo_updated_at = NULL, updated_at = NOW()
           FROM (SELECT photo_storage FROM chat_profiles WHERE username_lower = $1) o
          WHERE p.username_lower = $1 RETURNING o.photo_storage`, [key]
      );
      if (old && old.photo_storage) fs.promises.unlink(path.join(avatarDir, path.basename(old.photo_storage))).catch(() => {});
      res.json({ ok: true, profile: await profileOut(req.auth.username, req.auth) });
    } catch (err) { fail(res, err, 'photo remove'); }
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
}

module.exports = { ensureProfileSchema, touch, lookup, isRecent, shownName, registerProfileRoutes };
