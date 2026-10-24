'use strict';

// JMS Chat team features (phase C):
//  * Team groups: besides "<Factory> – All staff" (chatAuto.js), one group per production
//    line ("<Factory> – Line 3", from users.line) and per department ("<Factory> – QC team",
//    from the role code), kept in sync the same way. MAIN only, run from chatAuto's job.
//  * @team mentions: "@Line3", "@QC", "@PPC", "@Moulding", "@Maintenance" in any chat notify
//    the members of that team who are in the chat, even if they muted it (like @name).
//  * Shift handover note: a structured message the next shift confirms with "✓ Read".
//  * Check-in: "📍 checked in" with the distance to the nearest factory.
//  * Translate (English / हिंदी / ગુજરાતી) and voice-to-text, with Gemini (GEMINI_API_KEY),
//    cached in chat_translations.

const fs = require('fs');
const path = require('path');
const chatSync = require('./chatSync');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_ID = chatSync.deterministicIdSql('chat-member', '$1::uuid', 'LOWER($2::text)');
const BOT = 'JMS Alerts';
const MAX_LINES_PER_FACTORY = 30;

// department -> role-code test
const DEPARTMENTS = {
  moulding: { label: 'Moulding team', test: (r) => /mould|molding|supervisor|operator|setter/.test(r) },
  qc: { label: 'QC team', test: (r) => /(^|_)qc|quality|inspector/.test(r) },
  ppc: { label: 'PPC team', test: (r) => /ppc|planner|planning/.test(r) },
  maintenance: { label: 'Maintenance team', test: (r) => /maint|toolroom|electric|mechanic/.test(r) }
};
const LANGS = { en: 'English', hi: 'Hindi (हिंदी)', gu: 'Gujarati (ગુજરાતી)' };

let schemaReady = null;
function ensureTeamSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS chat_translations (
        message_sync_id UUID NOT NULL,
        lang TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_sync_id, lang)
      );
    `).catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function normLine(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 30) return null;
  const m = /^(?:line[\s-]*)?([a-z0-9][a-z0-9-]{0,9})$/i.exec(s);
  return m ? m[1].toUpperCase() : null;
}

// ---------------- team groups ----------------
async function ensureGroup(db, key, title) {
  let { rows: [g] } = await db.query('SELECT conversation_sync_id FROM chat_auto_groups WHERE key = $1', [key]);
  let convId = g && g.conversation_sync_id;
  if (convId) {
    const { rows: [c] } = await db.query('SELECT sync_id FROM chat_conversations WHERE sync_id = $1', [convId]);
    if (!c) convId = null;
  }
  if (!convId) {
    const { rows: [c] } = await db.query(
      `INSERT INTO chat_conversations (type, title, created_by, last_message_at) VALUES ('group', $1, $2, NOW()) RETURNING sync_id`, [title, BOT]
    );
    convId = c.sync_id;
    await db.query(
      `INSERT INTO chat_auto_groups (key, conversation_sync_id) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET conversation_sync_id = EXCLUDED.conversation_sync_id`, [key, convId]
    );
    await db.query(`INSERT INTO chat_messages (conversation_sync_id, sender, body, kind) VALUES ($1, $2, $3, 'system')`,
      [convId, BOT, `${title}: members are kept up to date from JMS Users.`]);
  }
  await db.query('UPDATE chat_conversations SET title = $2, updated_at = NOW() WHERE sync_id = $1 AND title IS DISTINCT FROM $2', [convId, title]);
  return convId;
}

async function syncMembers(db, convId, people) {
  const want = new Map(people.map((p) => [p.username.toLowerCase(), p]));
  const { rows: current } = await db.query('SELECT username, role, left_at FROM chat_members WHERE conversation_sync_id = $1', [convId]);
  const have = new Map(current.map((m) => [m.username.toLowerCase(), m]));
  for (const [k, p] of want) {
    const m = have.get(k);
    const role = p.superadmin ? 'admin' : 'member';
    if (!m || m.left_at || m.role !== role) {
      await db.query(
        `INSERT INTO chat_members (sync_id, conversation_sync_id, username, role) VALUES (${MEMBER_ID}, $1, $2, $3)
         ON CONFLICT (conversation_sync_id, (LOWER(username))) DO UPDATE SET left_at = NULL, role = EXCLUDED.role, updated_at = NOW()`,
        [convId, p.username, role]
      );
    }
  }
  for (const [k, m] of have) {
    if (!m.left_at && !want.has(k)) {
      await db.query('UPDATE chat_members SET left_at = NOW(), updated_at = NOW() WHERE conversation_sync_id = $1 AND LOWER(username) = $2 AND left_at IS NULL', [convId, k]);
    }
  }
}

async function syncTeamGroups(db) {
  const { rows: factories } = await db.query('SELECT id, name FROM factories WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY id');
  const { rows: users } = await db.query(
    `SELECT DISTINCT u.username, COALESCE(u.line, '') AS line, LOWER(COALESCE(u.role_code, '')) AS role, u.factory_id AS home, uf.factory_id AS extra
       FROM users u LEFT JOIN user_factories uf ON uf.user_id = u.id
      WHERE COALESCE(u.is_active, TRUE) = TRUE`
  ).catch(async () => (await db.query(
    `SELECT DISTINCT u.username, COALESCE(u.line, '') AS line, LOWER(COALESCE(u.role_code, '')) AS role, NULL AS home, uf.factory_id AS extra
       FROM users u LEFT JOIN user_factories uf ON uf.user_id = u.id WHERE COALESCE(u.is_active, TRUE) = TRUE`
  )));
  let made = 0;
  for (const f of factories) {
    const fid = Number(f.id);
    const inF = new Map();
    for (const u of users) if (Number(u.home) === fid || Number(u.extra) === fid) inF.set(u.username.toLowerCase(), u);
    const supers = users.filter((u) => u.role === 'superadmin').map((u) => ({ username: u.username, superadmin: true }));
    const fname = String(f.name || `Factory ${fid}`).slice(0, 50);
    // lines
    const byLine = new Map();
    for (const u of inF.values()) {
      const l = normLine(u.line);
      if (!l) continue;
      if (!byLine.has(l)) byLine.set(l, []);
      byLine.get(l).push({ username: u.username });
    }
    for (const [l, people] of [...byLine].slice(0, MAX_LINES_PER_FACTORY)) {
      if (people.length < 2) continue;
      const conv = await ensureGroup(db, `line:${fid}:${l}`, `${fname} – Line ${l}`);
      await syncMembers(db, conv, people.concat(supers));
      made++;
    }
    // departments
    for (const [k, d] of Object.entries(DEPARTMENTS)) {
      const people = [...inF.values()].filter((u) => d.test(u.role)).map((u) => ({ username: u.username }));
      if (people.length < 2) continue;
      const conv = await ensureGroup(db, `dept:${fid}:${k}`, `${fname} – ${d.label}`);
      await syncMembers(db, conv, people.concat(supers));
      made++;
    }
  }
  return made;
}

// ---------------- @team mentions ----------------
/** Usernames (lower) of the teams @mentioned in this text ("@Line3", "@QC", ...). */
async function teamMentions(pool, body) {
  const text = String(body || '').slice(0, 4000);
  const keys = new Set();
  for (const m of text.matchAll(/@line\s?([a-z0-9-]{1,10})\b/gi)) keys.add(`line:%:${m[1].toUpperCase()}`);
  for (const m of text.matchAll(/@(qc|ppc|moulding|molding|maintenance)\b/gi)) keys.add(`dept:%:${m[1].toLowerCase().replace('molding', 'moulding')}`);
  if (!keys.size) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT LOWER(mb.username) AS u FROM chat_auto_groups g
       JOIN chat_members mb ON mb.conversation_sync_id = g.conversation_sync_id AND mb.left_at IS NULL
      WHERE g.key LIKE ANY($1::text[])`, [[...keys]]
  ).catch(() => ({ rows: [] }));
  return new Set(rows.map((r) => r.u));
}

// ---------------- Gemini ----------------
let model = null;
function gemini() {
  if (model) return model;
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  model = new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-flash-latest' });
  return model;
}

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function registerTeamRoutes(app, pool, h) {
  const { ready, fail, membership, decorate, localFactoryId, uploadRoot } = h;
  const { isSuperadmin } = require('../../app/auth');

  async function postAs(convId, sender, body, meta) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO chat_messages (conversation_sync_id, sender, body, kind, factory_id, meta) VALUES ($1, $2, $3, 'text', $4, $5) RETURNING *`,
      [convId, sender, body.slice(0, 4000), localFactoryId(), JSON.stringify(meta)]
    );
    await pool.query('UPDATE chat_conversations SET last_message_at = $2, updated_at = NOW() WHERE sync_id = $1', [convId, m.server_ts]);
    await pool.query('UPDATE chat_members SET last_read_at = $3, updated_at = NOW() WHERE conversation_sync_id = $1 AND LOWER(username) = LOWER($2)', [convId, sender, m.server_ts]);
    return (await decorate(pool, [m], sender))[0];
  }

  async function checkConv(req, res) {
    const convId = String((req.body && req.body.conversation_sync_id) || '');
    if (!UUID_RE.test(convId)) { res.status(400).json({ ok: false, error: 'Bad chat id.' }); return null; }
    if (!(await membership(pool, convId, req.auth.username))) { res.status(403).json({ ok: false, error: 'You are not in this chat.' }); return null; }
    return convId;
  }

  // shift handover note: { running, problems, pending_qc, notes }
  app.post('/api/chat/handover', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const convId = await checkConv(req, res);
      if (!convId) return;
      const b = req.body || {};
      const f = (k) => String(b[k] || '').trim().slice(0, 800);
      if (!f('running') && !f('problems') && !f('pending_qc') && !f('notes')) return res.status(400).json({ ok: false, error: 'Fill at least one part of the handover.' });
      const istH = new Date(Date.now() + 330 * 60000).getUTCHours();
      const shift = istH >= 8 && istH < 20 ? 'Day' : 'Night';
      const body = [
        `🔁 SHIFT HANDOVER · ${shift} shift · by ${req.auth.username}`,
        f('running') && `▶ Running jobs:\n${f('running')}`,
        f('problems') && `⚠ Problems:\n${f('problems')}`,
        f('pending_qc') && `🧪 Pending QC:\n${f('pending_qc')}`,
        f('notes') && `📝 Notes:\n${f('notes')}`
      ].filter(Boolean).join('\n\n');
      res.json({ ok: true, message: await postAs(convId, req.auth.username, body, { alert: { kind: 'handover' } }) });
    } catch (err) { fail(res, err, 'handover'); }
  });

  // check-in with location: { lat, lng, acc, note }
  app.post('/api/chat/checkin', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const convId = await checkConv(req, res);
      if (!convId) return;
      const lat = Number(req.body && req.body.lat), lng = Number(req.body && req.body.lng), acc = Number(req.body && req.body.acc) || null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ ok: false, error: 'Location not available.' });
      const { rows: fs2 } = await pool.query('SELECT id, name, latitude, longitude, COALESCE(geofence_radius_m, 300) AS r FROM factories WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND COALESCE(is_active, TRUE)')
        .catch(() => ({ rows: [] }));
      let best = null;
      for (const f of fs2) {
        const d = distanceM(lat, lng, Number(f.latitude), Number(f.longitude));
        if (!best || d < best.d) best = { d, f };
      }
      const where = !best ? ''
        : best.d - (acc || 0) <= Number(best.f.r) ? ` · inside ${best.f.name} (${Math.round(best.d)} m)`
          : ` · ${best.d >= 1000 ? (best.d / 1000).toFixed(1) + ' km' : Math.round(best.d) + ' m'} from ${best.f.name}`;
      const note = String((req.body && req.body.note) || '').trim().slice(0, 200);
      const body = `📍 ${req.auth.username} checked in${where}${note ? '\n' + note : ''}`;
      res.json({ ok: true, message: await postAs(convId, req.auth.username, body, {
        checkin: { lat, lng, acc, factory: best ? best.f.name : null, dist: best ? Math.round(best.d) : null } }) });
    } catch (err) { fail(res, err, 'check-in'); }
  });

  async function messageInMyChat(req, res) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) { res.status(400).json({ ok: false, error: 'Bad message id.' }); return null; }
    const { rows: [m] } = await pool.query('SELECT * FROM chat_messages WHERE sync_id = $1', [id]);
    if (!m || m.deleted_at) { res.status(404).json({ ok: false, error: 'Message not found.' }); return null; }
    if (!(await membership(pool, m.conversation_sync_id, req.auth.username)) && !isSuperadmin(req.auth)) {
      res.status(403).json({ ok: false, error: 'You are not in this chat.' });
      return null;
    }
    return m;
  }

  async function cached(id, lang) {
    await ensureTeamSchema(pool);
    const { rows: [t] } = await pool.query('SELECT text FROM chat_translations WHERE message_sync_id = $1 AND lang = $2', [id, lang]);
    return t ? t.text : null;
  }
  async function store(id, lang, text) {
    await pool.query(
      `INSERT INTO chat_translations (message_sync_id, lang, text) VALUES ($1, $2, $3)
       ON CONFLICT (message_sync_id, lang) DO UPDATE SET text = EXCLUDED.text`, [id, lang, text]
    );
  }

  // translate: { to: 'en' | 'hi' | 'gu' }
  app.post('/api/chat/messages/:id/translate', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const m = await messageInMyChat(req, res);
      if (!m) return;
      const to = Object.prototype.hasOwnProperty.call(LANGS, String(req.body && req.body.to)) ? String(req.body.to) : 'en';
      const src = String(m.body || '').trim();
      if (!src) return res.status(400).json({ ok: false, error: 'Nothing to translate.' });
      const hit = await cached(m.sync_id, to);
      if (hit) return res.json({ ok: true, text: hit, lang: to });
      const ai = gemini();
      if (!ai) return res.status(503).json({ ok: false, error: 'Translation is not set up on this server.' });
      const r = await ai.generateContent(
        `Translate this factory chat message into ${LANGS[to]}. Keep machine names, numbers, codes and names as they are. ` +
        `Reply with the translation only.\n\n${src.slice(0, 3000)}`
      );
      const text = String(r.response.text() || '').trim().slice(0, 4000);
      if (!text) return res.status(502).json({ ok: false, error: 'No translation came back.' });
      await store(m.sync_id, to, text);
      res.json({ ok: true, text, lang: to });
    } catch (err) { fail(res, err, 'translate'); }
  });

  // voice note → text
  app.post('/api/chat/messages/:id/transcribe', async (req, res) => {
    try {
      if (!(await ready(req, res))) return;
      const m = await messageInMyChat(req, res);
      if (!m) return;
      const hit = await cached(m.sync_id, 'transcript');
      if (hit) return res.json({ ok: true, text: hit });
      const { rows: [a] } = await pool.query('SELECT * FROM chat_attachments WHERE message_sync_id = $1', [m.sync_id]);
      if (!a || a.kind !== 'audio') return res.status(400).json({ ok: false, error: 'Not a voice message.' });
      const ai = gemini();
      if (!ai) return res.status(503).json({ ok: false, error: 'Voice-to-text is not set up on this server.' });
      const base = path.resolve(uploadRoot);
      const full = path.resolve(base, a.storage_name);
      if (!full.startsWith(base + path.sep)) return res.status(404).json({ ok: false, error: 'File not found.' });
      const data = await fs.promises.readFile(full).catch(() => null);
      if (!data) return res.status(503).json({ ok: false, error: 'The voice file is not on this server yet. Try again in a minute.' });
      const r = await ai.generateContent([
        { inlineData: { mimeType: a.mime || 'audio/ogg', data: data.toString('base64') } },
        'Write down exactly what is said in this voice message (it may be Hindi, Gujarati or English; keep the language). Reply with the text only.'
      ]);
      const text = String(r.response.text() || '').trim().slice(0, 4000);
      if (!text) return res.status(502).json({ ok: false, error: 'Could not understand the voice message.' });
      await store(m.sync_id, 'transcript', text);
      res.json({ ok: true, text });
    } catch (err) { fail(res, err, 'transcribe'); }
  });
}

module.exports = { ensureTeamSchema, syncTeamGroups, teamMentions, registerTeamRoutes, normLine, distanceM, DEPARTMENTS, LANGS };
