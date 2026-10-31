'use strict';

// JMS Chat welcome message (MAIN only, one worker at a time).
//
// Every active user gets one welcome from the verified "JMS" sender in a direct chat
// ("JMS ✓" for them): existing users once, new users within a minute of being created or
// approved. Only the welcome viewers (CHAT_WELCOME_VIEWERS in server_config or the
// environment, usernames, comma separated) are also in these chats, as admins, to read the
// welcomes and answer replies; nobody else sees them. chat_welcome remembers who was greeted.
//
// Clean-up of the first versions (runs every time, does nothing once tidy): they made a
// "JMS Team · <name>" group per person, with every superadmin, and the factory servers
// made more copies. Each person keeps one chat (the oldest, turned into the direct chat);
// everyone leaves the other copies, so they vanish from every chat list.

const chatSync = require('./chatSync');

const SENDER = 'JMS';
const LOCK = 'jms_chat_welcome';
const BATCH = 25; // per minute, so greeting everyone at once does not flood the server
const DEFAULT_VIEWERS = 'Sanjay,Hitesh Joshi,admin,Earth Patel';
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

const dmKey = (username) => `jms-welcome|${String(username).toLowerCase()}`;

async function ensureWelcomeSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_welcome (
      username_lower TEXT PRIMARY KEY,
      conversation_sync_id UUID,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/** The viewers' exact usernames (only active users). */
async function viewers(db) {
  let list = String(process.env.CHAT_WELCOME_VIEWERS || '').trim();
  if (!list) {
    const { rows: [r] } = await db.query("SELECT value FROM server_config WHERE key = 'CHAT_WELCOME_VIEWERS'")
      .catch(() => ({ rows: [] }));
    list = (r && String(r.value || '').trim()) || DEFAULT_VIEWERS;
  }
  const wanted = list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const { rows } = await db.query(
    'SELECT username FROM users WHERE LOWER(username) = ANY($1::text[]) AND COALESCE(is_active, TRUE) = TRUE', [wanted]
  );
  return rows.map((r) => r.username);
}

// The greeted person of a JMS chat: the member who is neither JMS nor an admin.
const GREETED = `SELECT m.username FROM chat_members m
                  WHERE m.conversation_sync_id = c.sync_id AND m.role = 'member' AND LOWER(m.username) <> LOWER('${SENDER}')
                  ORDER BY m.id LIMIT 1`;
const RANKED = `SELECT c.sync_id, c.type, c.dm_key, (${GREETED}) AS person,
                       ROW_NUMBER() OVER (PARTITION BY LOWER((${GREETED})) ORDER BY c.created_at, c.sync_id) AS rn
                  FROM chat_conversations c
                 WHERE c.created_by = $1 AND (${GREETED}) IS NOT NULL`;

const tidied = new Map(); // chat id -> viewer list it was set up with (this process)

async function tidy(db, viewerNames) {
  // 1. one chat per person: everyone leaves every copy but the oldest
  const { rowCount: removed } = await db.query(
    `WITH g AS (${RANKED})
     UPDATE chat_members cm SET left_at = NOW(), updated_at = NOW()
       FROM g WHERE cm.conversation_sync_id = g.sync_id AND g.rn > 1 AND cm.left_at IS NULL`, [SENDER]
  );
  // 2. the kept chat becomes the direct "JMS" chat with the person, JMS and the viewers only
  const { rows: kept } = await db.query(`WITH g AS (${RANKED}) SELECT sync_id, type, dm_key, person FROM g WHERE rn = 1`, [SENDER]);
  let converted = 0;
  const sig = viewerNames.map((v) => v.toLowerCase()).sort().join(',');
  for (const k of kept) {
    if (k.type === 'direct' && k.dm_key === dmKey(k.person) && tidied.get(k.sync_id) === sig) continue; // already done
    if (k.type !== 'direct' || k.dm_key !== dmKey(k.person)) {
      await db.query(
        `UPDATE chat_conversations SET type = 'direct', dm_key = $2, title = $3, updated_at = NOW() WHERE sync_id = $1`,
        [k.sync_id, dmKey(k.person), `JMS · ${k.person}`]
      );
      converted++;
    }
    await db.query(
      `UPDATE chat_members SET left_at = NOW(), updated_at = NOW()
        WHERE conversation_sync_id = $1 AND left_at IS NULL AND NOT (LOWER(username) = ANY($2::text[]))`,
      [k.sync_id, [k.person, SENDER, ...viewerNames].map((u) => u.toLowerCase())]
    );
    await setMembers(db, k.sync_id, k.person, viewerNames);
    await db.query(
      'INSERT INTO chat_welcome (username_lower, conversation_sync_id) VALUES (LOWER($1), $2) ON CONFLICT DO NOTHING',
      [k.person, k.sync_id]
    );
    tidied.set(k.sync_id, sig);
  }
  return { removed, converted };
}

async function upsertMember(db, convId, username, role) {
  await db.query(
    `INSERT INTO chat_members (sync_id, conversation_sync_id, username, role)
     VALUES (${MEMBER_ID}, $1, $2, $3)
     ON CONFLICT (conversation_sync_id, (LOWER(username)))
     DO UPDATE SET left_at = NULL, role = EXCLUDED.role, updated_at = NOW()
     WHERE chat_members.left_at IS NOT NULL OR chat_members.role IS DISTINCT FROM EXCLUDED.role`,
    [convId, username, role]
  );
}

async function setMembers(db, convId, person, viewerNames) {
  await upsertMember(db, convId, person, 'member');
  await upsertMember(db, convId, SENDER, 'member');
  for (const v of viewerNames) {
    if (v.toLowerCase() === String(person).toLowerCase()) continue;
    await upsertMember(db, convId, v, 'admin');
  }
}

async function welcomeOne(db, user, viewerNames) {
  const name = user.display_name || user.username;
  const { rows: [c] } = await db.query(
    `INSERT INTO chat_conversations (type, dm_key, title, created_by, last_message_at)
     VALUES ('direct', $1, $2, $3, NOW()) ON CONFLICT DO NOTHING RETURNING sync_id`,
    [dmKey(user.username), `JMS · ${String(name).slice(0, 60)}`, SENDER]
  );
  if (!c) return false; // already has one
  await setMembers(db, c.sync_id, user.username, viewerNames);
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
  return true;
}

async function run(db) {
  await ensureWelcomeSchema(db);
  const viewerNames = await viewers(db);
  const t = await tidy(db, viewerNames);
  if (t.removed || t.converted) console.log(`[chat-welcome] tidied: ${t.removed} member(s) out of copies, ${t.converted} chat(s) made direct`);
  const excluded = viewerNames.map((v) => v.toLowerCase());
  const pending = (withName) => db.query(
    `SELECT u.username, ${withName
      ? '(SELECT s.name FROM chat_signups s WHERE LOWER(s.username) = LOWER(u.username) ORDER BY s.id DESC LIMIT 1)'
      : 'NULL'} AS display_name
       FROM users u
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND LOWER(COALESCE(u.role_code, '')) <> 'superadmin'
        AND NOT (LOWER(u.username) = ANY($2::text[]))
        AND NOT EXISTS (SELECT 1 FROM chat_welcome w WHERE w.username_lower = LOWER(u.username))
      ORDER BY u.id LIMIT $1`, [BATCH, excluded]
  );
  const { rows: todo } = await pending(true).catch(() => pending(false)); // no chat_signups table yet
  let sent = 0;
  for (const u of todo) {
    await db.query('BEGIN');
    try {
      if (await welcomeOne(db, u, viewerNames)) sent++;
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      console.warn('[chat-welcome]', u.username, err.message);
    }
  }
  return sent;
}

function start(pool) {
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

module.exports = { start, welcomeText, SENDER, __test: { run, tidy, viewers, ensureWelcomeSchema } };
