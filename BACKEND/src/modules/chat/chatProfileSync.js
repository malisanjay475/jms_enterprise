'use strict';

// Chat profiles between MAIN and the factory LOCALs (names, About, designation /
// department, photos, name requests).
//
// MAIN owns profiles; this rides beside the chat sync (chatSync.js) instead of in it,
// because profiles are keyed by username, not by a sync_id with a sync_seq cursor.
//
//  * Pull: one worker per LOCAL (advisory lock) asks MAIN every 30 s, and right after
//    a forwarded write, for chat_profiles rows changed since its cursor (MAIN's own
//    updated_at, re-read with a 10 s overlap; the upsert is idempotent) plus the name
//    history. A changed photo is fetched from MAIN into the LOCAL's avatars folder.
//  * Forward: on a LOCAL, profile writes (fields, name request / withdraw, photo,
//    approve / reject) go to MAIN as POST /api/sync/chat/profile-op with the sync key.
//    MAIN runs the same code (chatProfiles createProfileOps) as that user, with the
//    role from MAIN's users table, so the approval rules hold.
//  * The cursor is kept in server_config (CHAT_PROFILES_PULL).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const chatSync = require('./chatSync');
const chatProfiles = require('./chatProfiles');
const { sniffAttachment } = require('./attachmentType');

const LOOP_MS = 30 * 1000;
const OVERLAP_MS = 10 * 1000;
const BATCH = 500;
const LOCK = 'jms_chat_profile_pull';
const CURSOR_KEY = 'CHAT_PROFILES_PULL';
const OPS = ['saveFields', 'cancelName', 'setPhoto', 'removePhoto', 'decide'];

function mainUrl() { return String(chatSync.runtime().mainUrl || '').trim().replace(/\/$/, ''); }
function headers() { return { 'x-sync-api-key': chatSync.runtime().apiKey }; }

// ---- MAIN side ----
function registerProfileSyncRoutes(app, pool, { uploadRoot, notice }) {
  const ops = chatProfiles.createProfileOps(pool, { uploadRoot, notice });

  function guard(req, res) {
    const rt = chatSync.runtime();
    if (rt.serverType === 'LOCAL') { res.status(404).json({ ok: false, error: 'Not a MAIN server.' }); return false; }
    if (!rt.keyValid || !rt.keyValid(req.get('x-sync-api-key') || '')) { res.status(403).json({ ok: false, error: 'Invalid Key' }); return false; }
    return true;
  }

  // Profiles and name history changed since ?since=<ISO time>.
  app.get('/api/sync/chat/profiles', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      await chatProfiles.ensureProfileSchema(pool);
      const since = new Date(String(req.query.since || '1970-01-01'));
      const from = Number.isNaN(since.getTime()) ? new Date(0) : since;
      const { rows: profiles } = await pool.query(
        `SELECT username_lower, about, display_name, pending_name, pending_at, name_note, designation, department,
                photo_mime, photo_updated_at, updated_at
           FROM chat_profiles WHERE updated_at >= $1 ORDER BY updated_at LIMIT $2`, [from, BATCH]
      );
      const { rows: history } = await pool.query(
        `SELECT username_lower, old_name, new_name, status, reviewed_by, note, at
           FROM chat_name_history WHERE at >= $1 ORDER BY at LIMIT $2`, [from, BATCH]
      );
      const max = profiles.length ? profiles[profiles.length - 1].updated_at : null;
      res.json({ ok: true, profiles, history, max, more: profiles.length === BATCH });
    } catch (err) {
      console.error('[chat-profiles] feed failed:', err);
      res.status(500).json({ ok: false, error: 'Profile feed failed.' });
    }
  });

  app.get('/api/sync/chat/profiles/photo/:username', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const { rows: [p] } = await pool.query(
        'SELECT photo_storage, photo_mime FROM chat_profiles WHERE username_lower = LOWER($1)', [String(req.params.username || '')]
      );
      if (!p || !p.photo_storage) return res.status(404).end();
      res.setHeader('Content-Type', p.photo_mime || 'image/jpeg');
      fs.createReadStream(path.join(ops.avatarDir, path.basename(p.photo_storage)))
        .on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); }).pipe(res);
    } catch (err) {
      console.error('[chat-profiles] photo failed:', err);
      res.status(500).end();
    }
  });

  // A LOCAL forwards one of its user's profile writes. Body: { op, username, args }.
  app.post('/api/sync/chat/profile-op', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const b = req.body || {};
      const op = String(b.op || '');
      if (!OPS.includes(op)) return res.status(400).json({ ok: false, error: 'Unknown operation.' });
      const { rows: [u] } = await pool.query(
        `SELECT username, role_code FROM users WHERE LOWER(username) = LOWER($1) AND COALESCE(is_active, TRUE) = TRUE LIMIT 1`,
        [String(b.username || '')]
      );
      if (!u) return res.status(404).json({ ok: false, error: 'User not found on the main server.' });
      const user = { username: u.username, role: String(u.role_code || '').toLowerCase() };
      const args = Array.isArray(b.args) ? b.args : [];
      let out;
      if (op === 'setPhoto') {
        const buf = Buffer.from(String(args[0] || ''), 'base64');
        if (!buf.length || buf.length > chatProfiles.MAX_PHOTO) return res.status(413).json({ ok: false, error: 'Photo is too big (max 5 MB).' });
        out = await ops.setPhoto(user, buf);
      } else if (op === 'decide') {
        out = await ops.decide(user, String(args[0] || ''), String(args[1] || ''), args[2]);
      } else {
        out = await ops[op](user, args[0]);
      }
      res.json({ ok: true, ...(out || {}) });
    } catch (err) {
      if (err && err.status && err.status < 500) return res.status(err.status).json({ ok: false, error: err.message });
      console.error('[chat-profiles] op failed:', err);
      res.status(500).json({ ok: false, error: 'Profile change failed on the main server.' });
    }
  });
}

// ---- LOCAL side ----
function createProfileSync(pool, { uploadRoot }) {
  const avatarDir = path.join(uploadRoot, 'avatars');
  let timer = null;
  let running = false;
  let again = false;

  async function cursor() {
    await pool.query('CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT)');
    const { rows: [r] } = await pool.query('SELECT value FROM server_config WHERE key = $1', [CURSOR_KEY]);
    return r && r.value ? r.value : '1970-01-01T00:00:00.000Z';
  }

  async function saveCursor(iso) {
    await pool.query(
      `INSERT INTO server_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CURSOR_KEY, iso]
    );
  }

  async function fetchPhoto(key) {
    const r = await fetch(`${mainUrl()}/api/sync/chat/profiles/photo/${encodeURIComponent(key)}`, {
      headers: headers(), signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const type = sniffAttachment(buf);
    if (!type || type.kind !== 'image') return null;
    await fs.promises.mkdir(avatarDir, { recursive: true });
    const name = `${crypto.randomUUID()}${type.ext}`;
    await fs.promises.writeFile(path.join(avatarDir, name), buf, { flag: 'wx' });
    return { name, mime: type.mime };
  }

  async function applyProfile(p) {
    const { rows: [cur] } = await pool.query(
      'SELECT photo_storage, photo_updated_at FROM chat_profiles WHERE username_lower = $1', [p.username_lower]
    );
    let storage = cur ? cur.photo_storage : null;
    let mime = p.photo_mime;
    const samePhoto = cur && String(cur.photo_updated_at && new Date(cur.photo_updated_at).getTime()) ===
      String(p.photo_updated_at && new Date(p.photo_updated_at).getTime());
    let oldFile = null;
    if (!p.photo_updated_at) {
      oldFile = storage; storage = null; mime = null;
    } else if (!samePhoto || !storage) {
      const got = await fetchPhoto(p.username_lower).catch(() => null);
      if (got) { oldFile = storage; storage = got.name; mime = got.mime; } else if (!storage) mime = null;
    }
    await pool.query(
      `INSERT INTO chat_profiles (username_lower, about, display_name, pending_name, pending_at, name_note,
                                  designation, department, photo_storage, photo_mime, photo_updated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (username_lower) DO UPDATE SET about = EXCLUDED.about, display_name = EXCLUDED.display_name,
         pending_name = EXCLUDED.pending_name, pending_at = EXCLUDED.pending_at, name_note = EXCLUDED.name_note,
         designation = EXCLUDED.designation, department = EXCLUDED.department, photo_storage = EXCLUDED.photo_storage,
         photo_mime = EXCLUDED.photo_mime, photo_updated_at = EXCLUDED.photo_updated_at, updated_at = EXCLUDED.updated_at`,
      [p.username_lower, p.about, p.display_name, p.pending_name, p.pending_at, p.name_note, p.designation,
        p.department, storage, storage ? mime : null, storage ? p.photo_updated_at : null, p.updated_at]
    );
    if (oldFile && oldFile !== storage) fs.promises.unlink(path.join(avatarDir, path.basename(oldFile))).catch(() => {});
  }

  async function applyHistory(h) {
    await pool.query(
      `INSERT INTO chat_name_history (username_lower, old_name, new_name, status, reviewed_by, note, at)
       SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (
         SELECT 1 FROM chat_name_history WHERE username_lower = $1 AND new_name = $3 AND at = $7)`,
      [h.username_lower, h.old_name, h.new_name, h.status, h.reviewed_by, h.note, h.at]
    );
  }

  async function pullOnce() {
    await chatProfiles.ensureProfileSchema(pool);
    let since = await cursor();
    for (let round = 0; round < 20; round++) {
      const from = new Date(new Date(since).getTime() - OVERLAP_MS).toISOString();
      const r = await fetch(`${mainUrl()}/api/sync/chat/profiles?since=${encodeURIComponent(from)}`, {
        headers: headers(), signal: AbortSignal.timeout(30000)
      });
      if (!r.ok) throw new Error(`profiles HTTP ${r.status}`);
      const d = await r.json();
      for (const p of d.profiles || []) await applyProfile(p);
      for (const h of d.history || []) await applyHistory(h);
      if (d.max) {
        const next = new Date(d.max).toISOString();
        if (next > since) { since = next; await saveCursor(since); }
      }
      if (!d.more) return;
    }
  }

  async function cycle() {
    if (running) { again = true; return; }
    running = true;
    const client = await pool.connect();
    try {
      const { rows: [l] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK]);
      if (!l.ok) return;
      try { await pullOnce(); } finally { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {}); }
    } catch (err) {
      console.warn('[chat-profiles] pull:', err.message);
    } finally {
      client.release();
      running = false;
      if (again) { again = false; setTimeout(cycle, 500); }
    }
  }

  function start() {
    if (timer || !mainUrl() || !chatSync.runtime().apiKey) return;
    timer = setInterval(cycle, LOOP_MS);
    setTimeout(cycle, 5000);
  }

  // Send one write to MAIN; refresh this server's copy right after.
  async function forward(op, username, args) {
    if (!mainUrl() || !chatSync.runtime().apiKey) {
      throw new chatProfiles.HttpError(503, 'Profile changes need the main server, which is not set up on this server.');
    }
    const body = { op, username, args: op === 'setPhoto' ? [Buffer.from(args[0]).toString('base64')] : args };
    let r;
    try {
      r = await fetch(`${mainUrl()}/api/sync/chat/profile-op`, {
        method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
      });
    } catch (_e) {
      throw new chatProfiles.HttpError(503, 'Could not reach the main server. Try again in a minute.');
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new chatProfiles.HttpError(r.status >= 500 ? 502 : (r.status || 502), d.error || 'The main server refused the change.');
    await cycle();
    return d;
  }

  return { start, forward, pullNow: cycle, __test: { applyProfile, applyHistory } };
}

module.exports = { registerProfileSyncRoutes, createProfileSync };
