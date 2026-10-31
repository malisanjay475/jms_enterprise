'use strict';

// JMS Chat welcome message (MAIN only, one worker at a time).
//
// Every active user gets one welcome from the verified "JMS" sender: existing users once,
// after this ships, and new users within a minute of being created / approved. It opens a
// small group "JMS Team · <name>" with the person and every superadmin, so a reply reaches
// the JMS Team. The group is archived for the superadmins so their chat list stays clean.
// chat_welcome remembers who was greeted, so nobody gets it twice.

const chatSync = require('./chatSync');

const SENDER = 'JMS';
const LOCK = 'jms_chat_welcome';
const BATCH = 25; // per minute, so greeting everyone at once does not flood the server
const MEMBER_ID = chatSync.deterministicIdSql('chat-member', '$1::uuid', 'LOWER($2::text)');

function welcomeText(name) {
  return [
    `🙏 Namaste ${name}!`,
    '',
    'Welcome to JMS Chat, the official messaging app of JMS.',
    'You can now chat with your team, share photos and files, and make voice calls, all in one place.',
    '',
    'Need help? Just reply here and the JMS Team will help you.',
    '',
    '— Team JMS ✓'
  ].join('\n');
}

async function ensureWelcomeSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_welcome (
      username_lower TEXT PRIMARY KEY,
      conversation_sync_id UUID,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function addMember(db, convId, username, role) {
  await db.query(
    `INSERT INTO chat_members (sync_id, conversation_sync_id, username, role)
     VALUES (${MEMBER_ID}, $1, $2, $3)
     ON CONFLICT (conversation_sync_id, (LOWER(username))) DO NOTHING`,
    [convId, username, role]
  );
}

async function welcomeOne(db, user, superadmins) {
  const name = user.display_name || user.username;
  const { rows: [c] } = await db.query(
    `INSERT INTO chat_conversations (type, title, created_by, last_message_at)
     VALUES ('group', $1, $2, NOW()) RETURNING sync_id`,
    [`JMS Team · ${String(name).slice(0, 60)}`, SENDER]
  );
  await addMember(db, c.sync_id, user.username, 'member');
  for (const s of superadmins) {
    await addMember(db, c.sync_id, s, 'admin');
    // chat_user_prefs comes from chatExtras; a savepoint keeps the welcome if it is missing
    await db.query('SAVEPOINT pref');
    await db.query(
      `INSERT INTO chat_user_prefs (username_lower, conversation_sync_id, archived_at) VALUES (LOWER($1), $2, NOW())
       ON CONFLICT (username_lower, conversation_sync_id) DO UPDATE SET archived_at = NOW()`,
      [s, c.sync_id]
    ).then(() => db.query('RELEASE SAVEPOINT pref'), () => db.query('ROLLBACK TO SAVEPOINT pref'));
  }
  const { rows: [m] } = await db.query(
    `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, meta)
     VALUES ($1, $2, $3, 'text', $4) RETURNING server_ts`,
    [c.sync_id, SENDER, welcomeText(name), JSON.stringify({ verified: true, welcome: true })]
  );
  await db.query('UPDATE chat_conversations SET last_message_at = $2 WHERE sync_id = $1', [c.sync_id, m.server_ts]);
  await db.query(
    'INSERT INTO chat_welcome (username_lower, conversation_sync_id) VALUES (LOWER($1), $2) ON CONFLICT DO NOTHING',
    [user.username, c.sync_id]
  );
}

async function run(db) {
  await ensureWelcomeSchema(db);
  const { rows: admins } = await db.query(
    `SELECT username FROM users WHERE LOWER(role_code) = 'superadmin' AND COALESCE(is_active, TRUE) = TRUE`
  );
  const superadmins = admins.map((a) => a.username);
  // a chat sign-up's real name, when there is one
  const { rows: todo } = await db.query(
    `SELECT u.username,
            (SELECT s.name FROM chat_signups s WHERE LOWER(s.username) = LOWER(u.username) ORDER BY s.id DESC LIMIT 1) AS display_name
       FROM users u
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND LOWER(COALESCE(u.role_code, '')) <> 'superadmin'
        AND NOT EXISTS (SELECT 1 FROM chat_welcome w WHERE w.username_lower = LOWER(u.username))
      ORDER BY u.id LIMIT $1`, [BATCH]
  ).catch(() => db.query(
    `SELECT u.username, NULL AS display_name FROM users u
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND LOWER(COALESCE(u.role_code, '')) <> 'superadmin'
        AND NOT EXISTS (SELECT 1 FROM chat_welcome w WHERE w.username_lower = LOWER(u.username))
      ORDER BY u.id LIMIT $1`, [BATCH]
  )); // no chat_signups table yet
  let sent = 0;
  for (const u of todo) {
    await db.query('BEGIN');
    try {
      await welcomeOne(db, u, superadmins);
      await db.query('COMMIT');
      sent++;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      console.warn('[chat-welcome]', u.username, err.message);
    }
  }
  return sent;
}

function start(pool) {
  if (chatSync.isLocal()) return;
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
      const n = await run(client);
      if (n) console.log(`[chat-welcome] greeted ${n} user(s)`);
    } catch (err) {
      console.warn('[chat-welcome]', err.message);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {});
      client.release();
      running = false;
    }
  }
  const first = setTimeout(tick, 60 * 1000);
  const every = setInterval(tick, 60 * 1000);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
}

module.exports = { start, welcomeText, SENDER, __test: { run, ensureWelcomeSchema } };
