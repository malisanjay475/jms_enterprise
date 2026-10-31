'use strict';

// JMS Chat welcome message (MAIN only, one worker at a time).
//
// Every active user gets one welcome from the verified "JMS" sender: existing users once,
// after this ships, and new users within a minute of being created / approved. It opens a
// small group "JMS Team · <name>" with just the person. The superadmins join it only when
// the person replies (addTeamOnReply, called on send), so they are not sent every welcome.
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

async function welcomeOne(db, user) {
  const name = user.display_name || user.username;
  const { rows: [c] } = await db.query(
    `INSERT INTO chat_conversations (type, title, created_by, last_message_at)
     VALUES ('group', $1, $2, NOW()) RETURNING sync_id`,
    [`JMS Team · ${String(name).slice(0, 60)}`, SENDER]
  );
  await addMember(db, c.sync_id, user.username, 'member');
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

// the person already has a welcome group (made here, or synced in from a factory server)
const HAS_GROUP = `SELECT 1 FROM chat_conversations c JOIN chat_members m ON m.conversation_sync_id = c.sync_id
                    WHERE c.type = 'group' AND c.created_by = 'JMS' AND LOWER(m.username) = LOWER(u.username)`;

// v1.159.0 also ran on the factory (LOCAL) servers, which greeted everyone again. Keep each
// person's oldest welcome group and take everyone out of the others (unless the person has
// written in one), so the copies leave every chat list.
async function removeDuplicates(db) {
  const { rowCount } = await db.query(
    `WITH g AS (
       SELECT c.sync_id, ROW_NUMBER() OVER (PARTITION BY LOWER(m.username) ORDER BY c.created_at, c.sync_id) AS rn
         FROM chat_conversations c JOIN chat_members m ON m.conversation_sync_id = c.sync_id
        WHERE c.type = 'group' AND c.created_by = $1 AND m.role = 'member'
     )
     UPDATE chat_members cm SET left_at = NOW(), updated_at = NOW()
       FROM g
      WHERE cm.conversation_sync_id = g.sync_id AND g.rn > 1 AND cm.left_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.conversation_sync_id = g.sync_id
                         AND x.sender <> $1 AND x.kind <> 'system')`, [SENDER]
  );
  return rowCount;
}

async function run(db) {
  await ensureWelcomeSchema(db);
  const dups = await removeDuplicates(db);
  if (dups) console.log(`[chat-welcome] removed ${dups} member(s) from duplicate welcome groups`);
  if (!cleaned) {
    // v1.159.0 put every superadmin in every welcome group, so each welcome reached them
    // too. Take them out again wherever the person has not replied yet.
    await db.query(
      `UPDATE chat_members m SET left_at = NOW(), updated_at = NOW()
         FROM chat_welcome w
        WHERE m.conversation_sync_id = w.conversation_sync_id AND m.left_at IS NULL
          AND LOWER(m.username) <> w.username_lower
          AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.conversation_sync_id = w.conversation_sync_id
                           AND x.sender <> $1 AND x.kind <> 'system')`, [SENDER]
    );
    cleaned = true;
  }
  // a chat sign-up's real name, when there is one
  const { rows: todo } = await db.query(
    `SELECT u.username,
            (SELECT s.name FROM chat_signups s WHERE LOWER(s.username) = LOWER(u.username) ORDER BY s.id DESC LIMIT 1) AS display_name
       FROM users u
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND LOWER(COALESCE(u.role_code, '')) <> 'superadmin'
        AND NOT EXISTS (SELECT 1 FROM chat_welcome w WHERE w.username_lower = LOWER(u.username))
        AND NOT EXISTS (${HAS_GROUP})
      ORDER BY u.id LIMIT $1`, [BATCH]
  ).catch(() => db.query(
    `SELECT u.username, NULL AS display_name FROM users u
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND LOWER(COALESCE(u.role_code, '')) <> 'superadmin'
        AND NOT EXISTS (SELECT 1 FROM chat_welcome w WHERE w.username_lower = LOWER(u.username))
        AND NOT EXISTS (${HAS_GROUP})
      ORDER BY u.id LIMIT $1`, [BATCH]
  )); // no chat_signups table yet
  let sent = 0;
  for (const u of todo) {
    await db.query('BEGIN');
    try {
      await welcomeOne(db, u);
      await db.query('COMMIT');
      sent++;
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      console.warn('[chat-welcome]', u.username, err.message);
    }
  }
  return sent;
}

let cleaned = false;

// A reply in a welcome group brings in the JMS Team (the active superadmins), before the
// message is stored so they are notified of it.
async function addTeamOnReply(pool, convId, sender) {
  if (String(sender).toLowerCase() === SENDER.toLowerCase()) return;
  const { rows: [c] } = await pool.query(
    `SELECT 1 FROM chat_conversations WHERE sync_id = $1 AND type = 'group' AND created_by = $2`, [convId, SENDER]
  );
  if (!c) return;
  const { rows: admins } = await pool.query(
    `SELECT username FROM users WHERE LOWER(role_code) = 'superadmin' AND COALESCE(is_active, TRUE) = TRUE`
  );
  for (const a of admins) {
    await pool.query(
      `INSERT INTO chat_members (sync_id, conversation_sync_id, username, role)
       VALUES (${MEMBER_ID}, $1, $2, 'admin')
       ON CONFLICT (conversation_sync_id, (LOWER(username)))
       DO UPDATE SET left_at = NULL, updated_at = NOW() WHERE chat_members.left_at IS NOT NULL`,
      [convId, a.username]
    );
  }
}

function start(pool) {
  if (chatSync.isLocal()) return;
  let running = false;
  async function tick() {
    // the server type can be known only after start-up (sync settings), so check every time
    if (running || chatSync.isLocal()) return;
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

module.exports = { start, welcomeText, addTeamOnReply, SENDER, __test: { run, ensureWelcomeSchema, removeDuplicates } };
