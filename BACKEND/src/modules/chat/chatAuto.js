'use strict';

// JMS Chat automatic groups and alerts (MAIN only; one worker at a time).
//
//  * Auto groups: one "<Factory> – All staff" group per active factory. Members are kept
//    equal to the active users of that factory (users.factory_id or user_factories) every
//    10 minutes; superadmins are in every group as admins. Recorded in chat_auto_groups.
//  * Alerts (switched off: the All staff groups get no automated messages): every minute, new QC holds / releases and machine stops / restarts are
//    posted into that factory's group by "JMS Alerts" (normal messages, so they ring like
//    any other; people can mute the group). Rows synced in from the factory servers are
//    seen too, since this reads MAIN's tables. The first run only remembers where it is,
//    so turning this on never floods old events.
//
// Off by default (groups are made by admins / superadmins): CHAT_AUTO_GROUPS=1 (env or
// server_config) switches it back on. While off, existing auto groups are left as they are.

const chatSync = require('./chatSync');

const BOT = 'JMS Alerts';
const LOCK = 'jms_chat_auto';
const GROUP_EVERY_MS = 10 * 60 * 1000;
const ALERT_EVERY_MS = 60 * 1000;

const MEMBER_ID = chatSync.deterministicIdSql('chat-member', '$1::uuid', 'LOWER($2::text)');

async function enabled(pool) {
  if (chatSync.isLocal()) return false;
  const env = String(process.env.CHAT_AUTO_GROUPS || '').trim();
  if (env) return !/^(0|false|off|no)$/i.test(env);
  try {
    const { rows: [r] } = await pool.query("SELECT value FROM server_config WHERE key = 'CHAT_AUTO_GROUPS'");
    if (r && r.value != null && String(r.value).trim() !== '') return !/^(0|false|off|no)$/i.test(String(r.value));
  } catch (_e) { /* no server_config */ }
  return false;
}

async function ensureAutoSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_auto_groups (
      key TEXT PRIMARY KEY,
      conversation_sync_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_auto_state (
      name TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getState(db, name) {
  const { rows: [r] } = await db.query('SELECT value FROM chat_auto_state WHERE name = $1', [name]);
  return r ? r.value : null;
}

async function setState(db, name, value) {
  await db.query(
    `INSERT INTO chat_auto_state (name, value) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [name, String(value)]
  );
}

// ---------------- auto groups ----------------
async function factoryUsers(db, factoryId) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.username, LOWER(COALESCE(u.role_code, '')) = 'superadmin' AS superadmin
       FROM users u
       LEFT JOIN user_factories uf ON uf.user_id = u.id
      WHERE COALESCE(u.is_active, TRUE) = TRUE
        AND (u.factory_id = $1 OR uf.factory_id = $1 OR LOWER(COALESCE(u.role_code, '')) = 'superadmin')`,
    [factoryId]
  ).catch(async () => (await db.query(
    // schemas without users.factory_id
    `SELECT DISTINCT u.username, LOWER(COALESCE(u.role_code, '')) = 'superadmin' AS superadmin
       FROM users u LEFT JOIN user_factories uf ON uf.user_id = u.id
      WHERE COALESCE(u.is_active, TRUE) = TRUE AND (uf.factory_id = $1 OR LOWER(COALESCE(u.role_code, '')) = 'superadmin')`,
    [factoryId]
  )));
  return rows;
}

async function syncGroups(db) {
  const { rows: factories } = await db.query('SELECT id, name FROM factories WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY id');
  const out = new Map(); // factory id -> conversation id
  for (const f of factories) {
    const key = `factory:${f.id}`;
    const title = `${String(f.name || `Factory ${f.id}`).slice(0, 60)} – All staff`;
    let { rows: [g] } = await db.query('SELECT conversation_sync_id FROM chat_auto_groups WHERE key = $1', [key]);
    let convId = g && g.conversation_sync_id;
    if (convId) {
      const { rows: [c] } = await db.query('SELECT sync_id FROM chat_conversations WHERE sync_id = $1', [convId]);
      if (!c) convId = null; // deleted by retention or by hand: make it again
    }
    if (!convId) {
      const { rows: [c] } = await db.query(
        `INSERT INTO chat_conversations (type, title, created_by, last_message_at)
         VALUES ('group', $1, $2, NOW()) RETURNING sync_id`, [title, BOT]
      );
      convId = c.sync_id;
      await db.query(
        `INSERT INTO chat_auto_groups (key, conversation_sync_id) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET conversation_sync_id = EXCLUDED.conversation_sync_id`, [key, convId]
      );
    }
    const people = await factoryUsers(db, f.id);
    const want = new Map(people.map((p) => [p.username.toLowerCase(), p]));
    const { rows: current } = await db.query(
      'SELECT username, role, left_at FROM chat_members WHERE conversation_sync_id = $1', [convId]
    );
    const have = new Map(current.map((m) => [m.username.toLowerCase(), m]));
    for (const [k, p] of want) {
      const m = have.get(k);
      const role = p.superadmin ? 'admin' : 'member';
      if (!m || m.left_at || m.role !== role) {
        await db.query(
          `INSERT INTO chat_members (sync_id, conversation_sync_id, username, role)
           VALUES (${MEMBER_ID}, $1, $2, $3)
           ON CONFLICT (conversation_sync_id, (LOWER(username)))
           DO UPDATE SET left_at = NULL, role = EXCLUDED.role, updated_at = NOW()`,
          [convId, p.username, role]
        );
      }
    }
    for (const [k, m] of have) {
      if (!m.left_at && !want.has(k)) {
        await db.query(
          `UPDATE chat_members SET left_at = NOW(), updated_at = NOW()
            WHERE conversation_sync_id = $1 AND LOWER(username) = $2 AND left_at IS NULL`, [convId, k]
        );
      }
    }
    await db.query('UPDATE chat_conversations SET title = $2, updated_at = NOW() WHERE sync_id = $1 AND title IS DISTINCT FROM $2', [convId, title]);
    out.set(Number(f.id), convId);
  }
  return out;
}

async function groupFor(db, factoryId) {
  if (factoryId == null) return null;
  const { rows: [g] } = await db.query('SELECT conversation_sync_id FROM chat_auto_groups WHERE key = $1', [`factory:${factoryId}`]);
  return g ? g.conversation_sync_id : null;
}

async function post(db, convId, text, meta) {
  const { rows: [m] } = await db.query(
    `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, meta) VALUES ($1, $2, $3, 'text', $4) RETURNING server_ts`,
    [convId, BOT, text.slice(0, 4000), meta ? JSON.stringify(meta) : null]
  );
  await db.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [convId, m.server_ts]);
}

// ---------------- alerts ----------------
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function holdText(h) {
  return [
    `🛑 QC HOLD · Machine ${h.machine}`,
    h.job_card_no ? `JC ${h.job_card_no}` : null,
    h.qty_on_hold ? `Qty ${h.qty_on_hold}` : null,
    `${fmtDate(h.dpr_date)} ${h.shift || ''} ${h.slot || ''}`.trim(),
    `Reason: ${h.reason}`,
    h.remarks ? `Note: ${h.remarks}` : null,
    `By ${h.hold_by}`
  ].filter(Boolean).join('\n');
}

function releaseText(h) {
  return [
    `✅ QC hold released · Machine ${h.machine}`,
    h.job_card_no ? `JC ${h.job_card_no}` : null,
    h.release_remarks ? `Note: ${h.release_remarks}` : null,
    h.released_by ? `By ${h.released_by}` : null
  ].filter(Boolean).join('\n');
}

async function alerts(db) {
  const sent = { holds: 0, releases: 0, stops: 0, restarts: 0 };
  // QC holds (new) -------------------------------------------------------
  const lastHold = await getState(db, 'qc_hold_id');
  if (lastHold == null) {
    const { rows: [r] } = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM qc_holds').catch(() => ({ rows: [{ id: 0 }] }));
    await setState(db, 'qc_hold_id', r.id);
  } else {
    const { rows } = await db.query('SELECT * FROM qc_holds WHERE id > $1 ORDER BY id LIMIT 50', [Number(lastHold)]).catch(() => ({ rows: [] }));
    for (const h of rows) {
      const g = await groupFor(db, h.factory_id);
      if (g) { await post(db, g, holdText(h), { alert: { kind: 'qc_hold', ref: h.id } }); sent.holds++; }
      await setState(db, 'qc_hold_id', h.id);
    }
  }
  // QC holds (released) --------------------------------------------------
  const lastRel = await getState(db, 'qc_release_at');
  if (lastRel == null) {
    await setState(db, 'qc_release_at', new Date().toISOString());
  } else {
    const { rows } = await db.query(
      'SELECT * FROM qc_holds WHERE released_at > $1 ORDER BY released_at LIMIT 50', [lastRel]
    ).catch(() => ({ rows: [] }));
    for (const h of rows) {
      const g = await groupFor(db, h.factory_id);
      if (g) { await post(db, g, releaseText(h)); sent.releases++; }
      await setState(db, 'qc_release_at', new Date(h.released_at).toISOString());
    }
  }
  // Machine stops (new rows in machine_status_logs) ----------------------
  const lastStop = await getState(db, 'machine_log_id');
  if (lastStop == null) {
    const { rows: [r] } = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM machine_status_logs').catch(() => ({ rows: [{ id: 0 }] }));
    await setState(db, 'machine_log_id', r.id);
  } else {
    const { rows } = await db.query('SELECT * FROM machine_status_logs WHERE id > $1 ORDER BY id LIMIT 50', [Number(lastStop)])
      .catch(() => ({ rows: [] }));
    for (const s of rows) {
      const g = await groupFor(db, s.factory_id);
      if (g) {
        await post(db, g, `🔧 Machine ${s.machine} stopped · ${String(s.status || 'MAINTENANCE').replace(/_/g, ' ')}\nFrom ${fmtDate(s.start_date)} ${s.start_slot || ''}`.trim(),
          { alert: { kind: 'machine_stop', ref: s.id } });
        sent.stops++;
      }
      await setState(db, 'machine_log_id', s.id);
    }
  }
  // Machine restarts: stops closed in the last 2 days that were not announced yet
  // (machine_status_logs has no updated_at, so the announced ids are remembered).
  const { rows: closed } = await db.query(
    `SELECT * FROM machine_status_logs
      WHERE is_active = FALSE AND end_date IS NOT NULL AND end_date >= CURRENT_DATE - 2
      ORDER BY id LIMIT 500`
  ).catch(() => ({ rows: [] }));
  const seenRaw = await getState(db, 'machine_closed_ids');
  const seen = new Set(seenRaw ? JSON.parse(seenRaw) : []);
  if (seenRaw != null) {
    for (const s of closed) {
      if (seen.has(s.id)) continue;
      const g = await groupFor(db, s.factory_id);
      if (g) { await post(db, g, `▶️ Machine ${s.machine} running again\nStopped ${fmtDate(s.start_date)} ${s.start_slot || ''} → ${fmtDate(s.end_date)} ${s.end_slot || ''}`.trim()); sent.restarts++; }
    }
  }
  await setState(db, 'machine_closed_ids', JSON.stringify(closed.map((s) => s.id)));
  return sent;
}

// ---------------- runner ----------------
function start(pool) {
  let lastGroups = 0;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    const client = await pool.connect().catch(() => null);
    if (!client) { running = false; return; }
    let locked = false;
    try {
      if (!(await enabled(pool))) return;
      const { rows: [l] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK]);
      locked = l.ok;
      if (!locked) return; // another worker does it
      await ensureAutoSchema(client);
      if (Date.now() - lastGroups > GROUP_EVERY_MS) {
        const groups = await syncGroups(client);
        // line and department groups (chatTeam.js)
        await require('./chatTeam').syncTeamGroups(client).catch((err) => console.warn('[chat-auto] team groups:', err.message));
        lastGroups = Date.now();
        if (groups.size) console.log(`[chat-auto] factory groups in sync (${groups.size})`);
      }
      // No automated messages in the "All staff" groups: alerts() is no longer run.
    } catch (err) {
      console.warn('[chat-auto]', err.message);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {});
      client.release();
      running = false;
    }
  }
  const first = setTimeout(tick, 45 * 1000);
  const every = setInterval(tick, ALERT_EVERY_MS);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
}

module.exports = { start, enabled, holdText, releaseText, BOT, __test: { syncGroups, alerts, ensureAutoSchema } };
