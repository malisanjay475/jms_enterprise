'use strict';

// JMS Chat security and organising (phase D):
//  * Disappearing messages: per chat, 24 h / 7 days / 90 days. Messages sent after it was
//    turned on are deleted for everyone once they are older than that (one worker, every
//    minute). Set by a group admin, either person in a direct chat, or a superadmin.
//  * Protected chat: no screenshots in the app (FLAG_SECURE), no download, save, share or
//    forward of its messages and files. Same people can set it.
//  * Devices: every chat-app sign-in is a device (the app sends a stable device id). People
//    see their devices and sign any of them out ("remote sign-out"), or all others at once.
//    With "approve new devices" on (superadmin setting), a new phone or browser must be
//    approved by an admin before it can sign in.
//  * Folders: each person's own chat folders ("Line 3", "Suppliers", ...), chips over the
//    chat list.
// MAIN only for the device rules: chat-app sessions are only issued on MAIN.

const crypto = require('crypto');
const { isSuperadmin, isAdminLike } = require('../../app/auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DISAPPEAR = { 0: 'Off', 86400: '24 hours', 604800: '7 days', 7776000: '90 days' };
const MAX_FOLDERS = 12;
const LOCK = 'jms_chat_secure';
const CHECK_CACHE_MS = 20 * 1000;

let schemaReady = null;
function ensureSecureSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_conv_settings (
        conversation_sync_id UUID PRIMARY KEY,
        disappear_seconds INTEGER NOT NULL DEFAULT 0,
        disappear_since TIMESTAMPTZ,
        protected BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chat_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL,
        device_key TEXT NOT NULL,
        name TEXT,
        platform TEXT,
        ip TEXT,
        approved BOOLEAN NOT NULL DEFAULT TRUE,
        approved_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        signed_in_at TIMESTAMPTZ,
        signed_out_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_devices_user_key ON chat_devices (LOWER(username), device_key);
      CREATE TABLE IF NOT EXISTS chat_signout (
        username_lower TEXT PRIMARY KEY,
        before_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username_lower TEXT NOT NULL,
        name TEXT NOT NULL,
        conversations UUID[] NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders (username_lower);
      CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT);
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// ---------------- per-chat settings ----------------
async function settingsFor(pool, convIds) {
  const out = new Map();
  if (!convIds.length) return out;
  await ensureSecureSchema(pool);
  const { rows } = await pool.query(
    'SELECT conversation_sync_id, disappear_seconds, protected FROM chat_conv_settings WHERE conversation_sync_id = ANY($1::uuid[])', [convIds]
  );
  for (const r of rows) out.set(r.conversation_sync_id, { disappear_seconds: r.disappear_seconds, protected: r.protected });
  return out;
}

async function isProtected(pool, convId) {
  return Boolean((await settingsFor(pool, [convId])).get(convId)?.protected);
}

// ---------------- devices / sign-out ----------------
async function approvalOn(pool) {
  await ensureSecureSchema(pool);
  const { rows: [r] } = await pool.query("SELECT value FROM server_config WHERE key = 'CHAT_DEVICE_APPROVAL'");
  return !!r && r.value === '1';
}

function platformOf(ua) {
  if (/JMSChatApp\/[^ ]* \(macOS\)/i.test(ua)) return 'mac-app';
  if (/JMSChat|okhttp/i.test(ua)) return 'android-app';
  if (/android/i.test(ua)) return 'android-web';
  if (/iphone|ipad/i.test(ua)) return 'iphone-web';
  return 'web';
}

// Called by the chat-app login after the password checked out.
// -> { id, approved }  (approved false: waiting for an admin)
async function registerDevice(pool, user, req) {
  await ensureSecureSchema(pool);
  const b = req.body || {};
  const key = DEVICE_KEY_RE.test(String(b.device_id || '')) ? String(b.device_id) : crypto.randomUUID().replace(/-/g, '');
  const ua = String(req.headers['user-agent'] || '');
  const name = String(b.device_name || '').trim().slice(0, 60) || ua.slice(0, 60) || 'Device';
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 60);
  const needApproval = await approvalOn(pool);
  // The first device of a person is trusted; later ones wait when approval is on.
  const { rows: [has] } = await pool.query(
    'SELECT 1 FROM chat_devices WHERE LOWER(username) = LOWER($1) AND approved LIMIT 1', [user.username]
  );
  const startApproved = !needApproval || !has;
  const { rows: [d] } = await pool.query(
    `INSERT INTO chat_devices (username, device_key, name, platform, ip, approved, signed_in_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (LOWER(username), device_key) DO UPDATE
       SET name = EXCLUDED.name, platform = EXCLUDED.platform, ip = EXCLUDED.ip, signed_in_at = NOW(), last_seen_at = NOW()
     RETURNING id, approved`,
    [user.username, key, name, platformOf(ua), ip, startApproved]
  );
  checkCache.delete(d.id);
  return d;
}

// auth.js asks this for every chat-app token: still signed in on this device?
const checkCache = new Map(); // key -> { ok, at }
async function tokenStillValid(pool, payload) {
  const sat = Number(payload.sat) || Number(payload.iat) * 1000 || 0;
  const key = payload.did ? `d:${payload.did}` : `u:${String(payload.sub).toLowerCase()}`;
  const hit = checkCache.get(key);
  let rec = hit && Date.now() - hit.at < CHECK_CACHE_MS ? hit.rec : null;
  if (!rec) {
    await ensureSecureSchema(pool);
    if (payload.did) {
      const { rows: [d] } = await pool.query('SELECT approved, signed_out_at FROM chat_devices WHERE id = $1', [payload.did]);
      rec = d ? { approved: d.approved, cutoff: d.signed_out_at ? new Date(d.signed_out_at).getTime() : 0 } : { gone: true };
      if (d) pool.query('UPDATE chat_devices SET last_seen_at = NOW() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL \'5 minutes\')', [payload.did]).catch(() => {});
    } else {
      // older app versions: no device id; "sign out all" still reaches them
      const { rows: [s] } = await pool.query('SELECT before_at FROM chat_signout WHERE username_lower = LOWER($1)', [payload.sub]);
      rec = { approved: true, cutoff: s ? new Date(s.before_at).getTime() : 0 };
    }
    checkCache.set(key, { rec, at: Date.now() });
  }
  if (rec.gone || !rec.approved) return false;
  return !(rec.cutoff && sat < rec.cutoff);
}

async function signOutDevices(pool, username, ids) {
  const { rows } = await pool.query(
    `UPDATE chat_devices SET signed_out_at = NOW() WHERE LOWER(username) = LOWER($1) AND id = ANY($2::uuid[]) RETURNING id`, [username, ids]
  );
  for (const r of rows) checkCache.delete(`d:${r.id}`);
  if (rows.length) {
    await pool.query('DELETE FROM chat_fcm_devices WHERE device_id = ANY($1::uuid[])', [rows.map((r) => r.id)]).catch(() => {});
  }
  return rows.length;
}

function deviceOut(d, currentId) {
  return {
    id: d.id, name: d.name, platform: d.platform, ip: d.ip, approved: d.approved,
    signed_in: !!d.signed_in_at && (!d.signed_out_at || new Date(d.signed_out_at) < new Date(d.signed_in_at)),
    signed_in_at: d.signed_in_at, last_seen_at: d.last_seen_at, created_at: d.created_at,
    username: d.username, current: !!currentId && d.id === currentId
  };
}

// ---------------- disappearing messages job ----------------
async function purgeExpired(db) {
  const { rows } = await db.query(
    `UPDATE chat_messages SET deleted_at = NOW(), updated_at = NOW()
      WHERE id IN (SELECT x.id FROM chat_messages x JOIN chat_conv_settings s ON s.conversation_sync_id = x.conversation_sync_id
                    WHERE s.disappear_seconds > 0 AND s.disappear_since IS NOT NULL
                      AND x.deleted_at IS NULL AND x.kind <> 'system'
                      AND x.server_ts >= s.disappear_since
                      AND x.server_ts < NOW() - make_interval(secs => s.disappear_seconds)
                    LIMIT 500)
     RETURNING id`
  );
  return rows.length;
}

function start(pool) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    const client = await pool.connect().catch(() => null);
    if (!client) { running = false; return; }
    let locked = false;
    try {
      const { rows: [l] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK]);
      locked = l.ok;
      if (!locked) return;
      await ensureSecureSchema(client);
      await purgeExpired(client);
    } catch (err) {
      console.warn('[chat-secure]', err.message);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {});
      client.release();
      running = false;
    }
  }
  const every = setInterval(tick, 60 * 1000);
  if (every.unref) every.unref();
}

// ---------------- routes ----------------
function registerSecureRoutes(app, pool, h) {
  const { ready, fail, membership, localFactoryId } = h;

  async function systemLine(convId, actor, text) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, factory_id) VALUES ($1, $2, $3, 'system', $4) RETURNING server_ts`,
      [convId, actor, text, localFactoryId()]
    );
    await pool.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [convId, m.server_ts]);
  }

  // PUT /api/chat/conversations/:id/security  { disappear_seconds?, protected? }
  app.put('/api/chat/conversations/:id/security', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const convId = String(req.params.id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const { rows: [c] } = await pool.query('SELECT type FROM chat_conversations WHERE sync_id = $1', [convId]);
      if (!c) return res.status(404).json({ ok: false, error: 'Chat not found.' });
      const me = req.auth.username;
      const member = await membership(pool, convId, me);
      const allowed = isSuperadmin(req.auth) || (member && (c.type !== 'group' || member.role === 'admin'));
      if (!allowed) return res.status(403).json({ ok: false, error: 'Only a group admin can change this.' });
      const b = req.body || {};
      const { rows: [cur] } = await pool.query('SELECT * FROM chat_conv_settings WHERE conversation_sync_id = $1', [convId]);
      let secs = cur ? cur.disappear_seconds : 0;
      let prot = cur ? cur.protected : false;
      const lines = [];
      if (b.disappear_seconds !== undefined) {
        const v = Number(b.disappear_seconds);
        if (!(v in DISAPPEAR)) return res.status(400).json({ ok: false, error: 'Pick Off, 24 hours, 7 days or 90 days.' });
        if (v !== secs) lines.push(v ? `⏳ ${me} turned on disappearing messages: new messages disappear after ${DISAPPEAR[v]}.` : `⏳ ${me} turned off disappearing messages.`);
        secs = v;
      }
      if (b.protected !== undefined) {
        const v = b.protected === true;
        if (v !== prot) lines.push(v ? `🔒 ${me} made this a protected chat: no screenshots, downloads or forwarding.` : `🔓 ${me} turned off protected chat.`);
        prot = v;
      }
      await pool.query(
        `INSERT INTO chat_conv_settings (conversation_sync_id, disappear_seconds, disappear_since, protected, updated_by, updated_at)
         VALUES ($1, $2, CASE WHEN $2 > 0 THEN NOW() END, $3, $4, NOW())
         ON CONFLICT (conversation_sync_id) DO UPDATE SET
           disappear_since = CASE WHEN EXCLUDED.disappear_seconds = 0 THEN NULL
                                  WHEN chat_conv_settings.disappear_seconds = 0 THEN NOW()
                                  ELSE chat_conv_settings.disappear_since END,
           disappear_seconds = EXCLUDED.disappear_seconds, protected = EXCLUDED.protected,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [convId, secs, prot, me]
      );
      for (const t of lines) await systemLine(convId, me, t);
      res.json({ ok: true, disappear_seconds: secs, protected: prot });
    } catch (err) { fail(res, err, 'chat security'); }
  });

  // ---- my devices ----
  app.get('/api/chat/devices', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const { rows } = await pool.query(
        'SELECT * FROM chat_devices WHERE LOWER(username) = LOWER($1) ORDER BY last_seen_at DESC NULLS LAST LIMIT 50', [req.auth.username]
      );
      res.json({ ok: true, devices: rows.map((d) => deviceOut(d, req.auth.deviceId)), approval: await approvalOn(pool) });
    } catch (err) { fail(res, err, 'devices'); }
  });

  app.post('/api/chat/devices/:id/signout', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad device id.' });
      const n = await signOutDevices(pool, req.auth.username, [id]);
      if (!n) return res.status(404).json({ ok: false, error: 'Device not found.' });
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'device sign-out'); }
  });

  // Sign out every other device (and older app versions without a device id).
  app.post('/api/chat/devices/signout-others', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const me = req.auth.username;
      const { rows } = await pool.query(
        'SELECT id FROM chat_devices WHERE LOWER(username) = LOWER($1) AND id IS DISTINCT FROM $2::uuid', [me, req.auth.deviceId || null]
      );
      const n = await signOutDevices(pool, me, rows.map((r) => r.id));
      await pool.query(
        `INSERT INTO chat_signout (username_lower, before_at) VALUES (LOWER($1), NOW())
         ON CONFLICT (username_lower) DO UPDATE SET before_at = NOW()`, [me]
      );
      checkCache.delete(`u:${me.toLowerCase()}`);
      res.json({ ok: true, signed_out: n });
    } catch (err) { fail(res, err, 'sign out others'); }
  });

  // ---- admin: approve / block / sign out anyone's devices ----
  function adminOnly(req, res) {
    if (isSuperadmin(req.auth) || isAdminLike(req.auth)) return true;
    res.status(403).json({ ok: false, error: 'Only an admin can manage devices.' });
    return false;
  }

  app.get('/api/chat/admin/devices', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureSecureSchema(pool);
      const pending = req.query.pending === '1';
      const { rows } = await pool.query(
        `SELECT * FROM chat_devices ${pending ? 'WHERE NOT approved' : ''} ORDER BY approved, last_seen_at DESC NULLS LAST LIMIT 300`
      );
      res.json({ ok: true, devices: rows.map((d) => deviceOut(d)), approval: await approvalOn(pool) });
    } catch (err) { fail(res, err, 'admin devices'); }
  });

  app.post('/api/chat/admin/devices/:id', async (req, res) => {
    try {
      if (!(await ready(req, res)) || !adminOnly(req, res)) return;
      await ensureSecureSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad device id.' });
      const action = String((req.body || {}).action || '');
      let q;
      if (action === 'approve') q = 'UPDATE chat_devices SET approved = TRUE, approved_by = $2 WHERE id = $1 RETURNING *';
      else if (action === 'block') q = 'UPDATE chat_devices SET approved = FALSE, approved_by = $2, signed_out_at = NOW() WHERE id = $1 RETURNING *';
      else if (action === 'signout') q = 'UPDATE chat_devices SET signed_out_at = NOW() WHERE id = $1 AND $2::text IS NOT NULL RETURNING *';
      else return res.status(400).json({ ok: false, error: 'Unknown action.' });
      const { rows: [d] } = await pool.query(q, [id, req.auth.username]);
      if (!d) return res.status(404).json({ ok: false, error: 'Device not found.' });
      checkCache.delete(`d:${id}`);
      if (action !== 'approve') await pool.query('DELETE FROM chat_fcm_devices WHERE device_id = $1', [id]).catch(() => {});
      res.json({ ok: true, device: deviceOut(d) });
    } catch (err) { fail(res, err, 'admin device'); }
  });

  // superadmin: turn "approve new devices" on/off
  app.put('/api/chat/admin/device-approval', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      if (!isSuperadmin(req.auth)) return res.status(403).json({ ok: false, error: 'Only a superadmin can change this.' });
      await ensureSecureSchema(pool);
      const on = (req.body || {}).on === true;
      await pool.query(
        `INSERT INTO server_config (key, value) VALUES ('CHAT_DEVICE_APPROVAL', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [on ? '1' : '0']
      );
      res.json({ ok: true, approval: on });
    } catch (err) { fail(res, err, 'device approval'); }
  });

  // ---- folders ----
  async function myFolders(me) {
    const { rows } = await pool.query(
      'SELECT id, name, conversations FROM chat_folders WHERE username_lower = LOWER($1) ORDER BY position, created_at', [me]
    );
    return rows;
  }
  function cleanConvs(list) {
    return [...new Set((Array.isArray(list) ? list : []).map(String))].filter((x) => UUID_RE.test(x)).slice(0, 300);
  }

  app.get('/api/chat/folders', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      res.json({ ok: true, folders: await myFolders(req.auth.username) });
    } catch (err) { fail(res, err, 'folders'); }
  });

  app.post('/api/chat/folders', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const me = req.auth.username;
      const name = String((req.body || {}).name || '').trim().slice(0, 30);
      if (!name) return res.status(400).json({ ok: false, error: 'Give the folder a name.' });
      const have = await myFolders(me);
      if (have.length >= MAX_FOLDERS) return res.status(400).json({ ok: false, error: `At most ${MAX_FOLDERS} folders.` });
      const { rows: [f] } = await pool.query(
        'INSERT INTO chat_folders (username_lower, name, conversations, position) VALUES (LOWER($1), $2, $3::uuid[], $4) RETURNING id, name, conversations',
        [me, name, cleanConvs(req.body.conversations), have.length]
      );
      res.json({ ok: true, folder: f });
    } catch (err) { fail(res, err, 'folder add'); }
  });

  app.put('/api/chat/folders/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad folder id.' });
      const b = req.body || {};
      const name = b.name === undefined ? null : String(b.name).trim().slice(0, 30);
      if (name === '') return res.status(400).json({ ok: false, error: 'Give the folder a name.' });
      const convs = b.conversations === undefined ? null : cleanConvs(b.conversations);
      const { rows: [f] } = await pool.query(
        `UPDATE chat_folders SET name = COALESCE($3, name), conversations = COALESCE($4::uuid[], conversations)
          WHERE id = $1 AND username_lower = LOWER($2) RETURNING id, name, conversations`,
        [id, req.auth.username, name, convs]
      );
      if (!f) return res.status(404).json({ ok: false, error: 'Folder not found.' });
      res.json({ ok: true, folder: f });
    } catch (err) { fail(res, err, 'folder save'); }
  });

  app.delete('/api/chat/folders/:id', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureSecureSchema(pool);
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad folder id.' });
      await pool.query('DELETE FROM chat_folders WHERE id = $1 AND username_lower = LOWER($2)', [id, req.auth.username]);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'folder delete'); }
  });
}

module.exports = {
  ensureSecureSchema, settingsFor, isProtected, registerDevice, tokenStillValid, registerSecureRoutes, start,
  DISAPPEAR, __test: { platformOf, deviceOut, checkCache }
};
