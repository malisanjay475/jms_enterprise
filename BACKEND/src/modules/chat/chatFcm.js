'use strict';

// JMS Chat push to the native Android app through Firebase Cloud Messaging (HTTP v1).
//
// MAIN only. The Firebase service-account key comes from the environment, never the repo:
//   FCM_SERVICE_ACCOUNT       the key JSON itself, or the same base64-encoded
//   FCM_SERVICE_ACCOUNT_FILE  or a path to the key file
// Empty = FCM off (the app still works, it just gets no push while closed).
//
// Devices register their FCM token with POST /api/chat/fcm/register; tokens Firebase
// reports as gone (404 / UNREGISTERED) are deleted. Messages are data-only, so the app
// builds the notification itself (sender, text, reply from the notification).

const fs = require('fs');
const jwt = require('jsonwebtoken');
const chatSync = require('./chatSync');

let account; // undefined = not read yet, null = not configured
let tokenCache = { value: null, exp: 0 };

function readAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    let raw = String(process.env.FCM_SERVICE_ACCOUNT || '').trim();
    const file = String(process.env.FCM_SERVICE_ACCOUNT_FILE || '').trim();
    if (!raw && file) raw = fs.readFileSync(file, 'utf8');
    if (!raw) return account;
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    const a = JSON.parse(raw);
    if (a.client_email && a.private_key && a.project_id) account = a;
    else console.warn('[chat-fcm] FCM service account is missing client_email / private_key / project_id');
  } catch (err) {
    console.warn('[chat-fcm] cannot read the FCM service account:', err.message);
  }
  return account;
}

function enabled() {
  return !chatSync.isLocal() && Boolean(readAccount());
}

async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const a = readAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({
    iss: a.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }, a.private_key, { algorithm: 'RS256' });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`FCM auth failed (${r.status} ${d.error || ''})`);
  tokenCache = { value: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return tokenCache.value;
}

async function ensureFcmSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_fcm_devices (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      app_version TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_ok_at TIMESTAMPTZ,
      failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chat_fcm_user ON chat_fcm_devices (LOWER(username));
  `);
}

// Send one data message to every device of these users. `data` values must be strings.
async function sendToUsers(pool, usernames, data) {
  if (!enabled() || !usernames.length) return { sent: 0 };
  const { rows: devices } = await pool.query(
    'SELECT id, token FROM chat_fcm_devices WHERE LOWER(username) = ANY($1::text[])',
    [usernames.map((u) => String(u).toLowerCase())]
  );
  if (!devices.length) return { sent: 0 };
  const token = await accessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${readAccount().project_id}/messages:send`;
  // All devices at once: a busy group must not wait for each phone in turn.
  const results = await Promise.all(devices.map(async (dev) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: dev.token,
            data,
            android: { priority: 'HIGH', ttl: '3600s', collapse_key: data.conversation_sync_id || 'chat' }
          }
        })
      });
      if (r.ok) {
        pool.query('UPDATE chat_fcm_devices SET last_ok_at = NOW(), failures = 0 WHERE id = $1', [dev.id]).catch(() => {});
        return 1;
      }
      const body = await r.text();
      if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(body)) {
        await pool.query('DELETE FROM chat_fcm_devices WHERE id = $1', [dev.id]); // app removed / token rotated
      } else {
        await pool.query('UPDATE chat_fcm_devices SET failures = failures + 1 WHERE id = $1', [dev.id]).catch(() => {});
        console.warn(`[chat-fcm] send failed (${r.status})`);
      }
    } catch (err) {
      console.warn('[chat-fcm] send failed:', err.message);
    }
    return 0;
  }));
  return { sent: results.reduce((a, b) => a + b, 0) };
}

function registerFcmRoutes(app, pool, { ready, fail }) {
  app.post('/api/chat/fcm/register', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const token = String((req.body && req.body.token) || '').trim();
      if (!token || token.length > 4096) return res.status(400).json({ ok: false, error: 'Bad device token.' });
      await ensureFcmSchema(pool);
      await pool.query(
        `INSERT INTO chat_fcm_devices (username, token, app_version) VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET username = EXCLUDED.username, app_version = EXCLUDED.app_version, failures = 0`,
        [req.auth.username, token, String((req.body && req.body.app_version) || '').slice(0, 40)]
      );
      res.json({ ok: true, push: enabled() });
    } catch (err) { fail(res, err, 'fcm register'); }
  });

  app.post('/api/chat/fcm/unregister', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await ensureFcmSchema(pool);
      await pool.query('DELETE FROM chat_fcm_devices WHERE token = $1 AND LOWER(username) = LOWER($2)',
        [String((req.body && req.body.token) || ''), req.auth.username]);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'fcm unregister'); }
  });
}

module.exports = {
  enabled, ensureFcmSchema, sendToUsers, registerFcmRoutes,
  __test: { reset() { account = undefined; tokenCache = { value: null, exp: 0 }; } }
};
