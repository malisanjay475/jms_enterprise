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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sniffAttachment } = require('./attachmentType');

const MAX_PHOTO = 5 * 1024 * 1024;
const MAX_ABOUT = 140;
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

/** Map username lower -> { about, photo_v, last_seen_at } for these users. */
async function lookup(pool, usernames) {
  const keys = [...new Set((usernames || []).map((u) => String(u || '').toLowerCase()).filter(Boolean))];
  const out = new Map();
  if (!keys.length) return out;
  await ensureProfileSchema(pool);
  const { rows } = await pool.query(
    `SELECT k AS username_lower, p.about, p.photo_updated_at, s.last_seen_at
       FROM unnest($1::text[]) AS k
       LEFT JOIN chat_profiles p ON p.username_lower = k
       LEFT JOIN chat_presence s ON s.username_lower = k`, [keys]
  );
  for (const r of rows) {
    out.set(r.username_lower, {
      about: r.about || '',
      photo_v: r.photo_updated_at ? String(new Date(r.photo_updated_at).getTime()) : null,
      last_seen_at: r.last_seen_at || null
    });
  }
  return out;
}

function registerProfileRoutes(app, pool, { ready, fail, uploadRoot, isOnline, activeUser }) {
  const avatarDir = path.join(uploadRoot, 'avatars');

  async function profileOut(username) {
    const p = (await lookup(pool, [username])).get(username.toLowerCase()) || {};
    const { rows: [u] } = await pool.query(
      'SELECT username, role_code, line FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]
    );
    return {
      username: u ? u.username : username,
      role: (u && u.role_code) || '',
      line: (u && u.line) || '',
      about: p.about || '',
      photo_v: p.photo_v || null,
      last_seen_at: p.last_seen_at || null,
      online: isOnline(username) || isRecent(p.last_seen_at)
    };
  }

  app.get('/api/chat/profile', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      res.json({ ok: true, profile: await profileOut(req.auth.username) });
    } catch (err) { fail(res, err, 'profile'); }
  });

  app.get('/api/chat/profile/:username', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const name = await activeUser(pool, String(req.params.username || ''));
      if (!name) return res.status(404).json({ ok: false, error: 'User not found.' });
      res.json({ ok: true, profile: await profileOut(name) });
    } catch (err) { fail(res, err, 'profile'); }
  });

  app.put('/api/chat/profile', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureProfileSchema(pool);
      const about = String((req.body && req.body.about) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ABOUT);
      await pool.query(
        `INSERT INTO chat_profiles (username_lower, about) VALUES ($1, $2)
         ON CONFLICT (username_lower) DO UPDATE SET about = EXCLUDED.about, updated_at = NOW()`,
        [req.auth.username.toLowerCase(), about]
      );
      res.json({ ok: true, profile: await profileOut(req.auth.username) });
    } catch (err) { fail(res, err, 'profile save'); }
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
        res.json({ ok: true, profile: await profileOut(req.auth.username) });
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
      res.json({ ok: true, profile: await profileOut(req.auth.username) });
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

module.exports = { ensureProfileSchema, touch, lookup, isRecent, registerProfileRoutes };
