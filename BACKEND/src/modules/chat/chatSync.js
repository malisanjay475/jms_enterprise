'use strict';

// JMS Chat phase 3: chat replicates between MAIN and every factory LOCAL within seconds.
//
// The general sync engine (services/sync.service.js) runs every 5 minutes, which is far
// too slow for chat, so chat has its own small loop:
//
//  * Every chat row carries sync_seq, stamped from one sequence by a trigger on every
//    insert/update. It is a cursor that never goes backwards and never ties, unlike
//    updated_at (clocks differ between servers, and bulk writes share one timestamp).
//  * One worker per LOCAL (an advisory lock picks it) runs the loop every 3 s, and at
//    once after a local chat write: push rows whose sync_seq passed the push cursor to
//    MAIN, then pull MAIN's rows whose sync_seq passed the pull cursor.
//  * Rows a LOCAL applies from MAIN get no new sync_seq (session flag jms.chat_apply =
//    'pull'), so they are never pushed back.
//  * Upserts are by sync_id. A newer updated_at wins, except columns that only move one
//    way: last_read_at / last_message_at keep the later time, receipt times the first.
//  * Rows that can be created on two servers at once get the same sync_id everywhere:
//    a direct chat from its dm_key, a member from chat + username, a receipt from
//    message + username (deterministicId below).
//  * Attachment files: the LOCAL that received a file pushes it to MAIN; any server
//    missing a file fetches it from MAIN when someone opens it.
//
// Typing indicators and "online" dots stay per server.

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sniffAttachment } = require('./attachmentType');

const TABLES = ['chat_conversations', 'chat_members', 'chat_messages', 'chat_attachments', 'chat_receipts'];
const MERGE = {
  chat_conversations: { greatest: ['last_message_at'] },
  chat_members: { greatest: ['last_read_at'] },
  chat_receipts: { first: ['delivered_at', 'read_at'] }
};
const NATURAL = {
  chat_members: { cols: ['conversation_sync_id', 'username'], lower: 'username' },
  chat_receipts: { cols: ['message_sync_id', 'username'], lower: 'username' },
  chat_conversations: { cols: ['dm_key'] }
};
const BATCH = 500;
const LOOP_MS = 3000;
const OVERLAP_MS = 10000; // re-read rows whose sync_seq was handed out in the last 10 s
const LEADER_LOCK = 'jms_chat_sync_leader';
const MAX_FILE = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- runtime (server type, MAIN url, factory, sync key) from the sync service ----
function runtime() {
  try {
    const svc = require('../../../services/sync.service');
    if (typeof svc.getRuntime === 'function') return { ...svc.getRuntime(), keyValid: svc.syncKeyValid };
  } catch (_e) { /* not loaded (tests) */ }
  return {
    serverType: process.env.SERVER_TYPE || 'STANDALONE',
    mainUrl: process.env.MAIN_SERVER_URL || '',
    factoryId: parseInt(process.env.LOCAL_FACTORY_ID || '', 10) || null,
    apiKey: process.env.SYNC_API_KEY || '',
    keyValid: (k) => Boolean(process.env.SYNC_API_KEY) && k === process.env.SYNC_API_KEY
  };
}

function isLocal() { return runtime().serverType === 'LOCAL'; }

// SQL for the shared sync_id of rows two servers may create independently.
function deterministicIdSql(kind, ...parts) {
  return `md5(concat_ws('|', '${kind}', ${parts.join(', ')}))::uuid`;
}

// ---- schema ----
async function ensureSyncSchema(pool) {
  await pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('jms_chat_sync_schema'));
    CREATE SEQUENCE IF NOT EXISTS chat_sync_seq;
    CREATE TABLE IF NOT EXISTS chat_sync_state (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_file_pushed (
      attachment_sync_id UUID PRIMARY KEY,
      pushed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT
    );
    CREATE OR REPLACE FUNCTION chat_sync_stamp() RETURNS trigger AS $$
    BEGIN
      IF COALESCE(current_setting('jms.chat_apply', true), '') = 'pull' THEN
        -- applied from MAIN: never pushed back; an unsent local change keeps its place
        IF TG_OP = 'UPDATE' THEN NEW.sync_seq := OLD.sync_seq; ELSE NEW.sync_seq := NULL; END IF;
      ELSE
        NEW.sync_seq := nextval('chat_sync_seq');
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE OR REPLACE FUNCTION chat_notify() RETURNS trigger AS $$
    DECLARE
      send BOOLEAN := TG_OP = 'INSERT';
      local BOOLEAN := COALESCE(current_setting('jms.chat_apply', true), '') <> 'pull';
      payload JSONB;
    BEGIN
      IF TG_TABLE_NAME = 'chat_messages' THEN
        IF TG_OP = 'UPDATE' THEN
          send := OLD.body IS DISTINCT FROM NEW.body OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at;
        END IF;
        payload := jsonb_build_object('s', NEW.sync_id, 'c', NEW.conversation_sync_id);
      ELSIF TG_TABLE_NAME = 'chat_receipts' THEN
        IF TG_OP = 'UPDATE' THEN
          send := OLD.read_at IS DISTINCT FROM NEW.read_at OR OLD.delivered_at IS DISTINCT FROM NEW.delivered_at;
        END IF;
        payload := jsonb_build_object('c', NEW.conversation_sync_id, 'm', NEW.message_sync_id, 'u', NEW.username,
                                      'k', CASE WHEN NEW.read_at IS NULL THEN 'delivered' ELSE 'read' END);
      ELSIF TG_TABLE_NAME = 'chat_members' THEN
        IF TG_OP = 'UPDATE' THEN
          send := OLD.left_at IS DISTINCT FROM NEW.left_at OR OLD.role IS DISTINCT FROM NEW.role;
        END IF;
        payload := jsonb_build_object('c', NEW.conversation_sync_id, 'u', NEW.username);
      ELSIF TG_TABLE_NAME = 'chat_conversations' THEN
        IF TG_OP = 'UPDATE' THEN send := OLD.title IS DISTINCT FROM NEW.title; END IF;
        payload := jsonb_build_object('c', NEW.sync_id);
      ELSE
        payload := '{}'::jsonb;
      END IF;
      -- 'l' = written on this server (the LOCAL sync leader pushes those at once)
      IF send OR local THEN
        PERFORM pg_notify('jms_chat', (payload || jsonb_build_object(
          't', TG_TABLE_NAME, 'op', TG_OP, 'l', local, 'e', send))::text);
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql;
  `);
  for (const t of TABLES) {
    await pool.query(`
      SELECT pg_advisory_xact_lock(hashtext('jms_chat_sync_schema'));
      ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS sync_seq BIGINT;
      CREATE INDEX IF NOT EXISTS idx_${t}_sync_seq ON ${t} (sync_seq) WHERE sync_seq IS NOT NULL;
      DROP TRIGGER IF EXISTS trg_${t}_sync_stamp ON ${t};
      CREATE TRIGGER trg_${t}_sync_stamp BEFORE INSERT OR UPDATE ON ${t}
        FOR EACH ROW EXECUTE FUNCTION chat_sync_stamp();
      DROP TRIGGER IF EXISTS trg_${t}_notify ON ${t};
      CREATE TRIGGER trg_${t}_notify AFTER INSERT OR UPDATE ON ${t}
        FOR EACH ROW EXECUTE FUNCTION chat_notify();
    `);
  }
  await migrateDeterministicIds(pool);
}

// Phase 1/2 rows got random sync_ids. Give direct chats, members and receipts the shared
// id once, so a LOCAL and MAIN that both hold "the chat between A and B" agree on it.
async function migrateDeterministicIds(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jms_chat_sync_schema'))");
    const { rows: [done] } = await client.query("SELECT 1 FROM chat_sync_state WHERE name = 'ids_v1'");
    if (!done) {
      const { rows: convs } = await client.query(
        `SELECT sync_id AS old, ${deterministicIdSql('chat-dm', 'dm_key')} AS new
           FROM chat_conversations
          WHERE dm_key IS NOT NULL AND sync_id <> ${deterministicIdSql('chat-dm', 'dm_key')}`
      );
      for (const c of convs) {
        for (const t of ['chat_members', 'chat_messages', 'chat_attachments', 'chat_receipts', 'chat_audit_views']) {
          await client.query(`UPDATE ${t} SET conversation_sync_id = $2 WHERE conversation_sync_id = $1`, [c.old, c.new]);
        }
        await client.query('UPDATE chat_conversations SET sync_id = $2 WHERE sync_id = $1', [c.old, c.new]);
      }
      await client.query(
        `UPDATE chat_members SET sync_id = ${deterministicIdSql('chat-member', 'conversation_sync_id', 'LOWER(username)')}
          WHERE sync_id <> ${deterministicIdSql('chat-member', 'conversation_sync_id', 'LOWER(username)')}`
      );
      await client.query(
        `UPDATE chat_receipts SET sync_id = ${deterministicIdSql('chat-receipt', 'message_sync_id', 'LOWER(username)')}
          WHERE sync_id <> ${deterministicIdSql('chat-receipt', 'message_sync_id', 'LOWER(username)')}`
      );
      await client.query("INSERT INTO chat_sync_state (name, value) VALUES ('ids_v1', 'done')");
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- reading and applying rows ----
const columnCache = new Map();
async function tableColumns(db, table) {
  if (!columnCache.has(table)) {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1`, [table]
    );
    columnCache.set(table, new Set(rows.map((r) => r.column_name)));
  }
  return columnCache.get(table);
}

// Rows of a table past a sync_seq cursor, as JSON (to_jsonb keeps microseconds).
async function readSince(db, table, since, limit = BATCH) {
  const { rows } = await db.query(
    `SELECT to_jsonb(t) - 'id' - 'sync_seq' AS r, t.sync_seq::text AS seq
       FROM ${table} t WHERE t.sync_seq > $1 ORDER BY t.sync_seq LIMIT $2`,
    [String(since || 0), limit]
  );
  return { rows: rows.map((x) => x.r), max: rows.length ? rows[rows.length - 1].seq : null, more: rows.length === limit };
}

function upsertSql(table, cols) {
  const merge = MERGE[table] || {};
  const greatest = new Set(merge.greatest || []);
  const first = new Set(merge.first || []);
  const sets = [];
  const changed = ['EXCLUDED.updated_at > t.updated_at'];
  for (const c of cols) {
    if (c === 'sync_id') continue;
    if (c === 'updated_at') sets.push('updated_at = GREATEST(t.updated_at, EXCLUDED.updated_at)');
    else if (greatest.has(c)) {
      sets.push(`${c} = GREATEST(t.${c}, EXCLUDED.${c})`);
      changed.push(`EXCLUDED.${c} > COALESCE(t.${c}, '-infinity')`);
    } else if (first.has(c)) {
      sets.push(`${c} = COALESCE(t.${c}, EXCLUDED.${c})`);
      changed.push(`(t.${c} IS NULL AND EXCLUDED.${c} IS NOT NULL)`);
    } else {
      sets.push(`${c} = CASE WHEN EXCLUDED.updated_at > t.updated_at THEN EXCLUDED.${c} ELSE t.${c} END`);
    }
  }
  const list = cols.join(', ');
  return `INSERT INTO ${table} AS t (${list})
          SELECT ${list} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)
          ON CONFLICT (sync_id) DO UPDATE SET ${sets.join(', ')}
          WHERE ${changed.join(' OR ')}`;
}

// A row whose natural key already exists here under another sync_id (made before ids
// were shared): adopt the incoming id so both servers converge, then retry.
async function adoptNaturalKey(db, table, row) {
  const nat = NATURAL[table];
  if (!nat || nat.cols.some((c) => row[c] == null)) return false;
  const where = nat.cols.map((c, i) => (c === nat.lower ? `LOWER(${c}) = LOWER($${i + 2})` : `${c} = $${i + 2}`));
  const { rows: [old] } = await db.query(
    `SELECT sync_id FROM ${table} WHERE ${where.join(' AND ')} AND sync_id <> $1`,
    [row.sync_id, ...nat.cols.map((c) => row[c])]
  );
  if (!old) return false;
  if (table === 'chat_conversations') {
    for (const t of ['chat_members', 'chat_messages', 'chat_attachments', 'chat_receipts', 'chat_audit_views']) {
      await db.query(`UPDATE ${t} SET conversation_sync_id = $2 WHERE conversation_sync_id = $1`, [old.sync_id, row.sync_id]);
    }
  }
  await db.query(`UPDATE ${table} SET sync_id = $2 WHERE sync_id = $1`, [old.sync_id, row.sync_id]);
  return true;
}

// Apply rows from the other server. `fromMain` (on a LOCAL) keeps them out of the push.
async function applyRows(pool, payload, { fromMain }) {
  const client = await pool.connect();
  const stats = { applied: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    if (fromMain) await client.query("SELECT set_config('jms.chat_apply', 'pull', true)");
    for (const table of TABLES) {
      const incoming = Array.isArray(payload[table]) ? payload[table] : [];
      if (!incoming.length) continue;
      const have = await tableColumns(client, table);
      const bySync = new Map();
      for (const r of incoming) if (r && UUID_RE.test(String(r.sync_id || ''))) bySync.set(r.sync_id, r);
      const rows = [...bySync.values()];
      if (!rows.length) continue;
      const keys = new Set();
      rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
      const cols = [...keys].filter((k) => have.has(k) && k !== 'id' && k !== 'sync_seq');
      if (!cols.includes('sync_id') || !cols.includes('updated_at')) { stats.failed += rows.length; continue; }
      const sql = upsertSql(table, cols);
      await client.query('SAVEPOINT batch');
      try {
        await client.query(sql, [JSON.stringify(rows)]);
        await client.query('RELEASE SAVEPOINT batch');
        stats.applied += rows.length;
      } catch (_batchErr) {
        // One bad row must not hold back the rest: go row by row.
        await client.query('ROLLBACK TO SAVEPOINT batch');
        for (const row of rows) {
          await client.query('SAVEPOINT one');
          try {
            await client.query(sql, [JSON.stringify([row])]);
            stats.applied += 1;
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT one');
            let ok = false;
            if (err.code === '23505') {
              try {
                if (await adoptNaturalKey(client, table, row)) {
                  await client.query(sql, [JSON.stringify([row])]);
                  ok = true;
                  stats.applied += 1;
                }
              } catch (_e) {
                await client.query('ROLLBACK TO SAVEPOINT one');
              }
            }
            if (!ok) {
              stats.failed += 1;
              console.warn(`[chat-sync] ${table} ${row.sync_id} not applied: ${err.message}`);
            }
          }
          await client.query('RELEASE SAVEPOINT one');
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return stats;
}

// ---- cursors (persisted per LOCAL; re-read the last 10 s to catch late commits) ----
// A transaction that took its sync_seq earlier can commit after a later one was already
// read; the cursor therefore only counts as safe once it is OVERLAP_MS old.
function makeCursor(pool, name) {
  let safe = null;
  let saved = null;
  const history = []; // { seq, at }
  async function save() {
    if (safe === saved) return;
    await pool.query(
      `INSERT INTO chat_sync_state (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [name, safe]
    );
    saved = safe;
  }
  return {
    async since() {
      if (safe === null) {
        const { rows: [r] } = await pool.query('SELECT value FROM chat_sync_state WHERE name = $1', [name]);
        safe = r ? r.value : '0';
        saved = safe;
      }
      const now = Date.now();
      while (history.length && now - history[0].at >= OVERLAP_MS) safe = history.shift().seq;
      await save();
      return safe;
    },
    latest() { return history.length ? history[history.length - 1].seq : safe; },
    async advance(seq) {
      if (seq == null) return;
      history.push({ seq: String(seq), at: Date.now() });
    }
  };
}

// ---- LOCAL loop ----
function syncHeaders() {
  return { 'x-sync-api-key': runtime().apiKey };
}

function mainUrl() { return String(runtime().mainUrl || '').trim().replace(/\/$/, ''); }

function createLoop(pool, { uploadRoot }) {
  const pushCur = {};
  const pullCur = {};
  for (const t of TABLES) { pushCur[t] = makeCursor(pool, `push:${t}`); pullCur[t] = makeCursor(pool, `pull:${t}`); }
  let timer = null;
  let running = false;
  let again = false;
  let stopped = false;
  let failures = 0;

  // Each cycle starts at the safe cursor (re-reading the overlap); later pages of the
  // same cycle continue from the previous page.
  async function pushOnce() {
    const cur = {};
    for (const t of TABLES) cur[t] = await pushCur[t].since();
    for (let round = 0; round < 20; round++) {
      const payload = {};
      const maxes = {};
      let more = false;
      let any = false;
      for (const t of TABLES) {
        const page = await readSince(pool, t, cur[t]);
        if (page.rows.length) { payload[t] = page.rows; maxes[t] = page.max; any = true; }
        if (page.more) more = true;
      }
      if (!any) return;
      const r = await fetch(`${mainUrl()}/api/sync/chat/push`, {
        method: 'POST',
        headers: { ...syncHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: payload }),
        signal: AbortSignal.timeout(30000)
      });
      if (!r.ok) throw new Error(`push HTTP ${r.status}`);
      for (const t of Object.keys(maxes)) { cur[t] = maxes[t]; await pushCur[t].advance(maxes[t]); }
      if (!more) return;
    }
  }

  async function pullOnce() {
    const cur = {};
    for (const t of TABLES) cur[t] = await pullCur[t].since();
    for (let round = 0; round < 20; round++) {
      const r = await fetch(`${mainUrl()}/api/sync/chat/pull?c=${encodeURIComponent(JSON.stringify(cur))}`, {
        headers: syncHeaders(), signal: AbortSignal.timeout(30000)
      });
      if (!r.ok) throw new Error(`pull HTTP ${r.status}`);
      const d = await r.json();
      const payload = {};
      let any = false;
      for (const t of TABLES) {
        const page = d.tables && d.tables[t];
        if (page && page.rows && page.rows.length) { payload[t] = page.rows; any = true; }
      }
      if (any) await applyRows(pool, payload, { fromMain: true });
      for (const t of TABLES) {
        const page = d.tables && d.tables[t];
        if (page && page.max) { cur[t] = page.max; await pullCur[t].advance(page.max); }
      }
      if (!d.more) return;
    }
  }

  // Files of attachments sent on this LOCAL go up to MAIN once their row is there.
  async function pushFiles() {
    const { rows } = await pool.query(
      `SELECT a.sync_id, a.storage_name FROM chat_attachments a
        WHERE a.factory_id = $1 AND a.sync_seq IS NOT NULL AND a.sync_seq <= $2::bigint
          AND NOT EXISTS (SELECT 1 FROM chat_file_pushed p WHERE p.attachment_sync_id = a.sync_id)
        ORDER BY a.sync_seq LIMIT 3`,
      [runtime().factoryId, String(pushCur.chat_attachments.latest() || 0)]
    );
    for (const a of rows) {
      const full = path.join(uploadRoot, a.storage_name);
      let buf;
      try { buf = await fs.promises.readFile(full); } catch (_e) {
        await pool.query('INSERT INTO chat_file_pushed (attachment_sync_id, note) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [a.sync_id, 'missing on this server']);
        continue;
      }
      const form = new FormData();
      form.append('attachment_sync_id', a.sync_id);
      form.append('file', new Blob([buf]), path.basename(a.storage_name));
      const r = await fetch(`${mainUrl()}/api/sync/chat/file`, {
        method: 'POST', headers: syncHeaders(), body: form, signal: AbortSignal.timeout(120000)
      });
      if (r.ok) {
        await pool.query('INSERT INTO chat_file_pushed (attachment_sync_id) VALUES ($1) ON CONFLICT DO NOTHING', [a.sync_id]);
      } else if (r.status !== 409) {
        console.warn(`[chat-sync] MAIN refused file ${a.sync_id}: HTTP ${r.status}`);
      }
    }
  }

  async function cycle() {
    if (running) { again = true; return; }
    if (!mainUrl() || !runtime().apiKey) return;
    running = true;
    try {
      await pushOnce();
      await pullOnce();
      await pushFiles();
      if (failures) console.log('[chat-sync] MAIN reachable again');
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures === 1 || failures % 100 === 0) console.warn(`[chat-sync] cycle failed (${failures}x): ${err.message}`);
    } finally {
      running = false;
      schedule(again ? 50 : Math.min(LOOP_MS * Math.max(1, failures), 60000));
      again = false;
    }
  }

  function schedule(ms) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; cycle(); }, ms);
    if (timer.unref) timer.unref();
  }

  return {
    start() { stopped = false; schedule(500); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; },
    kick() { if (running) again = true; else schedule(300); },
    cycle
  };
}

// ---- MAIN endpoints (sync key, under /api/sync so no login session is needed) ----
function registerSyncRoutes(app, pool, { uploadRoot, ensureSchema }) {
  function guard(req, res) {
    const rt = runtime();
    if (rt.serverType === 'LOCAL') { res.status(404).json({ ok: false, error: 'Not a MAIN server.' }); return false; }
    const key = req.get('x-sync-api-key') || '';
    if (!rt.keyValid(key)) { res.status(403).json({ ok: false, error: 'Invalid Key' }); return false; }
    return true;
  }

  app.post('/api/sync/chat/push', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      await ensureSchema();
      const tables = (req.body && req.body.tables) || {};
      const stats = await applyRows(pool, tables, { fromMain: false });
      res.json({ ok: true, ...stats });
    } catch (err) {
      console.error('[chat-sync] push failed:', err);
      res.status(500).json({ ok: false, error: 'Chat push failed.' });
    }
  });

  app.get('/api/sync/chat/pull', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      await ensureSchema();
      let since = {};
      try { since = JSON.parse(String(req.query.c || '{}')) || {}; } catch (_e) { since = {}; }
      const out = {};
      let more = false;
      for (const t of TABLES) {
        const s = /^\d{1,19}$/.test(String(since[t] || '0')) ? String(since[t] || '0') : '0';
        const page = await readSince(pool, t, s);
        out[t] = { rows: page.rows, max: page.max };
        if (page.more) more = true;
      }
      res.json({ ok: true, tables: out, more });
    } catch (err) {
      console.error('[chat-sync] pull failed:', err);
      res.status(500).json({ ok: false, error: 'Chat pull failed.' });
    }
  });

  const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1, fields: 5 } });

  // A LOCAL hands MAIN the file of an attachment whose row MAIN already has.
  app.post('/api/sync/chat/file', (req, res) => {
    if (!guard(req, res)) return;
    fileUpload.single('file')(req, res, async (upErr) => {
      try {
        if (upErr) return res.status(400).json({ ok: false, error: 'Could not read the file.' });
        const id = String((req.body && req.body.attachment_sync_id) || '');
        if (!UUID_RE.test(id) || !req.file) return res.status(400).json({ ok: false, error: 'Bad request.' });
        const { rows: [a] } = await pool.query('SELECT * FROM chat_attachments WHERE sync_id = $1', [id]);
        if (!a) return res.status(409).json({ ok: false, error: 'Attachment row not here yet.' });
        const type = sniffAttachment(req.file.buffer);
        if (!type || type.mime !== a.mime) return res.status(415).json({ ok: false, error: 'File does not match.' });
        await saveFile(uploadRoot, a.storage_name, req.file.buffer);
        res.json({ ok: true });
      } catch (err) {
        console.error('[chat-sync] file push failed:', err);
        res.status(500).json({ ok: false, error: 'Could not save the file.' });
      }
    });
  });

  // A LOCAL fetches a file it does not have.
  app.get('/api/sync/chat/file/:id', async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const id = String(req.params.id || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Bad id.' });
      const { rows: [a] } = await pool.query('SELECT storage_name, mime FROM chat_attachments WHERE sync_id = $1', [id]);
      if (!a || !(await fileExists(uploadRoot, a.storage_name))) return res.status(404).json({ ok: false, error: 'Not here.' });
      res.sendFile(a.storage_name, { root: path.resolve(uploadRoot), headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (err) {
      console.error('[chat-sync] file fetch failed:', err);
      res.status(500).json({ ok: false, error: 'Could not read the file.' });
    }
  });
}

// ---- files ----
function safeStoragePath(uploadRoot, storageName) {
  const base = path.resolve(uploadRoot);
  const full = path.resolve(base, String(storageName || ''));
  return full.startsWith(base + path.sep) ? full : null;
}

async function fileExists(uploadRoot, storageName) {
  const full = safeStoragePath(uploadRoot, storageName);
  if (!full) return false;
  try { await fs.promises.access(full); return true; } catch (_e) { return false; }
}

async function saveFile(uploadRoot, storageName, buf) {
  const full = safeStoragePath(uploadRoot, storageName);
  if (!full) throw new Error('bad storage name');
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  try {
    await fs.promises.writeFile(full, buf, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// On a LOCAL: get a missing attachment file from MAIN (checked against the row's type).
async function fetchFileFromMain(uploadRoot, att) {
  if (!isLocal() || !mainUrl() || !runtime().apiKey) return false;
  const r = await fetch(`${mainUrl()}/api/sync/chat/file/${encodeURIComponent(att.sync_id)}`, {
    headers: syncHeaders(), signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) return false;
  const buf = Buffer.from(await r.arrayBuffer());
  const type = sniffAttachment(buf);
  if (!type || type.mime !== att.mime) return false;
  await saveFile(uploadRoot, att.storage_name, buf);
  return true;
}

module.exports = {
  TABLES,
  deterministicIdSql,
  ensureSyncSchema,
  applyRows,
  readSince,
  createLoop,
  registerSyncRoutes,
  fileExists,
  fetchFileFromMain,
  runtime,
  isLocal,
  LEADER_LOCK,
  __test: { upsertSql, makeCursor }
};
