'use strict';

// JMS Chat phase 4: notifications.
//
//  * Bell / notifications.html: a trigger on chat_messages keeps ONE row per user and
//    chat in the existing notifications table (type 'CHAT', newest message as text),
//    flipped back to unread by each new message and marked read when the chat is
//    opened. The row's sync_id comes from user + chat, so the copies that MAIN and a
//    LOCAL write for the same message are one row in the general sync.
//  * Mute (8 hours / 1 week / always) lives on chat_members.muted_until and syncs with
//    the chat. A muted chat makes no bell row, push, pop-up or sound, except when the
//    message @mentions you (or @all in a group).
//  * Web Push for closed tabs: MAIN only (it is the HTTPS site; factory LOCALs run plain
//    HTTP, where browsers have no push). VAPID keys come from the environment
//    (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) and are never stored in the
//    repo. One worker (advisory lock) sends, so a message is pushed once.

const chatSync = require('./chatSync');

const PUSH_LOCK = 'jms_chat_push_sender';
const MUTE_FOR = { '8h': "NOW() + INTERVAL '8 hours'", '1w': "NOW() + INTERVAL '7 days'", always: "'infinity'::timestamptz", off: 'NULL' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// node-pg reads timestamptz 'infinity' (mute "always") as the number Infinity, which JSON
// turns into null; send a far-future date instead.
function muteOut(v) {
  if (v === Infinity || v === 'infinity') return '9999-12-31T23:59:59.000Z';
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d <= new Date() ? null : d.toISOString();
}

function notifIdSql(user, conv) {
  return chatSync.deterministicIdSql('chat-notif', `LOWER(${user})`, conv);
}

async function ensureNotifySchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('jms_chat_schema'));
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      target_user TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      title TEXT,
      message TEXT,
      link TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    -- the general sync adds these too (same names), so either may run first
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sync_id UUID DEFAULT gen_random_uuid();
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_id_notifications ON notifications (sync_id);
    ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_ok_at TIMESTAMPTZ,
      failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chat_push_user ON chat_push_subscriptions (LOWER(username));

    -- @name (or @all / @everyone) as a whole word
    CREATE OR REPLACE FUNCTION chat_mentions(body TEXT, uname TEXT) RETURNS BOOLEAN AS $$
      SELECT COALESCE(body, '') ~* ('(^|[^[:alnum:]_.@])@(all|everyone|'
        || regexp_replace(uname, '([^[:alnum:]_])', '\\\\\\1', 'g') || ')($|[^[:alnum:]_])')
    $$ LANGUAGE sql IMMUTABLE;

    CREATE OR REPLACE FUNCTION chat_message_notify() RETURNS trigger AS $$
    DECLARE
      conv RECORD;
      label TEXT;
      preview TEXT;
    BEGIN
      IF NEW.kind = 'system' OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
      SELECT type, title INTO conv FROM chat_conversations WHERE sync_id = NEW.conversation_sync_id;
      label := CASE NEW.kind WHEN 'image' THEN '📷 Photo' WHEN 'pdf' THEN '📄 PDF'
                             WHEN 'xlsx' THEN '📊 Excel file' WHEN 'audio' THEN '🎤 Audio' END;
      preview := CASE WHEN label IS NULL THEN NEW.body
                      WHEN COALESCE(NEW.body, '') = '' THEN label
                      ELSE label || ': ' || NEW.body END;
      INSERT INTO notifications (sync_id, target_user, type, title, message, link, is_read, created_by, created_at, updated_at)
      SELECT ${notifIdSql('m.username', 'NEW.conversation_sync_id')}, m.username, 'CHAT',
             CASE WHEN conv.type = 'group' THEN NEW.sender || ' in ' || COALESCE(conv.title, 'Group') ELSE NEW.sender END,
             left(preview, 300), '/index.html?chat=' || NEW.conversation_sync_id, FALSE, NEW.sender, NEW.server_ts, NOW()
        FROM chat_members m
       WHERE m.conversation_sync_id = NEW.conversation_sync_id AND m.left_at IS NULL
         AND LOWER(m.username) <> LOWER(NEW.sender)
         AND (m.last_read_at IS NULL OR m.last_read_at < NEW.server_ts)
         AND (m.muted_until IS NULL OR m.muted_until < NOW() OR chat_mentions(NEW.body, m.username))
      ON CONFLICT (sync_id) DO UPDATE
         SET title = EXCLUDED.title, message = EXCLUDED.message, link = EXCLUDED.link, is_read = FALSE,
             created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at, updated_at = NOW()
       WHERE notifications.created_at IS NULL OR notifications.created_at <= EXCLUDED.created_at;
      RETURN NULL;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_chat_messages_bell ON chat_messages;
    CREATE TRIGGER trg_chat_messages_bell AFTER INSERT ON chat_messages
      FOR EACH ROW EXECUTE FUNCTION chat_message_notify();
  `);
}

// Opening a chat clears its bell row.
async function markChatNotificationRead(db, username, convId) {
  await db.query(
    `UPDATE notifications SET is_read = TRUE, updated_at = NOW()
      WHERE sync_id = ${notifIdSql('$1::text', '$2::uuid')} AND is_read = FALSE`,
    [username, convId]
  );
}

// ---- web push ----
function vapid() {
  const pub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const priv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || '').trim() || 'mailto:admin@example.com';
  return pub && priv ? { pub, priv, subject } : null;
}

function pushEnabled() {
  return !chatSync.isLocal() && Boolean(vapid());
}

let webpush = null;
function client() {
  const v = vapid();
  if (!v) return null;
  if (!webpush) webpush = require('web-push');
  webpush.setVapidDetails(v.subject, v.pub, v.priv);
  return webpush;
}

// Push one new message to every subscribed member who should hear about it.
async function sendPushForMessage(pool, messageSyncId) {
  const wp = client();
  if (!wp) return { sent: 0 };
  const { rows: [m] } = await pool.query(
    `SELECT x.*, c.type AS conv_type, c.title AS conv_title FROM chat_messages x
       JOIN chat_conversations c ON c.sync_id = x.conversation_sync_id
      WHERE x.sync_id = $1 AND x.kind <> 'system' AND x.deleted_at IS NULL
        AND x.server_ts > NOW() - INTERVAL '10 minutes'`,
    [messageSyncId]
  );
  if (!m) return { sent: 0 };
  const { rows: subs } = await pool.query(
    `SELECT s.*, chat_mentions($3, mb.username) AS mentioned
       FROM chat_members mb
       JOIN chat_push_subscriptions s ON LOWER(s.username) = LOWER(mb.username)
      WHERE mb.conversation_sync_id = $1 AND mb.left_at IS NULL AND LOWER(mb.username) <> LOWER($2)
        AND (mb.muted_until IS NULL OR mb.muted_until < NOW() OR chat_mentions($3, mb.username))`,
    [m.conversation_sync_id, m.sender, m.body]
  );
  const label = { image: '📷 Photo', pdf: '📄 PDF', xlsx: '📊 Excel file', audio: '🎤 Audio' }[m.kind];
  const body = label ? (m.body ? `${label}: ${m.body}` : label) : m.body;
  let sent = 0;
  for (const s of subs) {
    const payload = JSON.stringify({
      type: 'chat',
      title: m.conv_type === 'group' ? `${m.sender} in ${m.conv_title || 'Group'}` : m.sender,
      body: (s.mentioned ? '@ ' : '') + String(body || '').slice(0, 200),
      conversation_sync_id: m.conversation_sync_id,
      message_sync_id: m.sync_id
    });
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: 3600, urgency: 'high', topic: String(m.conversation_sync_id).replace(/-/g, '').slice(0, 32) });
      sent += 1;
      await pool.query('UPDATE chat_push_subscriptions SET last_ok_at = NOW(), failures = 0 WHERE id = $1', [s.id]);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM chat_push_subscriptions WHERE id = $1', [s.id]); // browser dropped it
      } else {
        await pool.query(
          'UPDATE chat_push_subscriptions SET failures = failures + 1 WHERE id = $1', [s.id]
        ).catch(() => {});
        console.warn(`[chat-push] send failed (${err.statusCode || err.message})`);
      }
    }
  }
  return { sent };
}

// ---- routes ----
function registerNotifyRoutes(app, pool, { ready, membership, fail }) {
  // Mute a chat: { for: '8h' | '1w' | 'always' | 'off' }
  app.post('/api/chat/conversations/:id/mute', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const convId = String(req.params.id || '');
      if (!UUID_RE.test(convId)) return res.status(400).json({ ok: false, error: 'Bad chat id.' });
      const how = String((req.body && req.body.for) || '');
      if (!MUTE_FOR[how]) return res.status(400).json({ ok: false, error: 'Pick 8 hours, 1 week, always or off.' });
      if (!(await membership(pool, convId, req.auth.username))) {
        return res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      }
      const { rows: [r] } = await pool.query(
        `UPDATE chat_members SET muted_until = ${MUTE_FOR[how]}, updated_at = NOW()
          WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2) AND left_at IS NULL
          RETURNING muted_until`,
        [convId, req.auth.username]
      );
      res.json({ ok: true, muted_until: r ? muteOut(r.muted_until) : null });
    } catch (err) { fail(res, err, 'mute'); }
  });

  // Is push available here, and with which public key?
  app.get('/api/chat/push/config', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const v = vapid();
      res.json({ ok: true, enabled: pushEnabled(), publicKey: pushEnabled() ? v.pub : null });
    } catch (err) { fail(res, err, 'push config'); }
  });

  app.post('/api/chat/push/subscribe', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      if (!pushEnabled()) return res.status(404).json({ ok: false, error: 'Push is not available on this server.' });
      const sub = (req.body && req.body.subscription) || {};
      const endpoint = String(sub.endpoint || '');
      const keys = sub.keys || {};
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !keys.p256dh || !keys.auth) {
        return res.status(400).json({ ok: false, error: 'Bad subscription.' });
      }
      await pool.query(
        `INSERT INTO chat_push_subscriptions (username, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET username = EXCLUDED.username, p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, failures = 0`,
        [req.auth.username, endpoint, String(keys.p256dh).slice(0, 200), String(keys.auth).slice(0, 100),
          String(req.get('user-agent') || '').slice(0, 300)]
      );
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'push subscribe'); }
  });

  app.post('/api/chat/push/unsubscribe', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      await pool.query(
        'DELETE FROM chat_push_subscriptions WHERE endpoint = $1 AND LOWER(username) = LOWER($2)',
        [String((req.body && req.body.endpoint) || ''), req.auth.username]
      );
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'push unsubscribe'); }
  });
}

module.exports = {
  PUSH_LOCK,
  ensureNotifySchema,
  markChatNotificationRead,
  sendPushForMessage,
  pushEnabled,
  muteOut,
  registerNotifyRoutes
};
