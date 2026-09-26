'use strict';

// Evidence for switching login from "soft" to "required".
//
// Today a request without a verified session still works if it names a user in the
// X-User-Name header or in the body's session.username (auth.js falls back to it).
// Before that fallback can be removed we need to know who still depends on it: an old
// browser tab, the Android app, a scanner/bridge script, a page that never got the
// session cookie. This module only COUNTS such requests — per day, endpoint, claimed
// user and client type — and never changes how a request is handled.
//
// Counts are kept in memory and written to legacy_auth_usage once a minute (one upsert
// per distinct key), so the cost per request is a Map update. Admins read the summary
// at GET /api/admin/legacy-auth-usage.

const { isPublicApi } = require('./sessionPolicy');

const FLUSH_INTERVAL_MS = 60 * 1000;
const MAX_KEYS = 5000; // per flush window; beyond this new keys are dropped (counted)

let pool = null;
let timer = null;
let pending = new Map();
let droppedKeys = 0;

function setPool(dbPool) {
  pool = dbPool;
}

/** Collapse ids/order numbers so /api/orders/JR-123/x and /api/orders/JR-456/x group. */
function normalizePath(path) {
  return String(path || '')
    .split('/')
    .map((seg) => (/\d/.test(seg) || seg.length > 40 ? ':x' : seg))
    .join('/')
    .slice(0, 200);
}

function classifyClient(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'no-user-agent';
  if (/okhttp|dart|dalvik|android/i.test(ua) && !/mozilla/i.test(ua)) return 'android-app';
  if (/mozilla/i.test(ua)) return /mobile|android|iphone|ipad/i.test(ua) ? 'mobile-browser' : 'browser';
  if (/node|undici|axios|got\//i.test(ua)) return 'node-script';
  if (/curl|wget|python|powershell|postman/i.test(ua)) return 'tool';
  return 'other';
}

function claimedUsername(req) {
  const header = String((req.headers && req.headers['x-user-name']) || '').trim();
  if (header) return header;
  const body = req.body;
  if (body && typeof body.session === 'object' && body.session && body.session.username) {
    return String(body.session.username).trim();
  }
  return '';
}

function istDay(date = new Date()) {
  return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Call after the session check. Counts every /api request that has no verified session
 * and is not a public endpoint (sessionPolicy.js) — exactly what AUTH_REQUIRE_SESSION=1
 * would refuse. Requests naming a user (header/body) are counted under that user;
 * requests with no identity at all under "(none)".
 */
function recordLegacyUse(req) {
  if (req.auth) return;
  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (!fullPath.startsWith('/api') || isPublicApi(fullPath)) return;
  const username = claimedUsername(req) || '(none)';

  const entry = {
    day: istDay(),
    method: String(req.method || '').toUpperCase(),
    path: normalizePath(fullPath),
    username: username.toLowerCase().slice(0, 100),
    client: classifyClient(req.headers && req.headers['user-agent'])
  };
  const key = `${entry.day}|${entry.method}|${entry.path}|${entry.username}|${entry.client}`;
  const existing = pending.get(key);
  if (existing) {
    existing.hits += 1;
    existing.lastSeen = new Date();
  } else if (pending.size < MAX_KEYS) {
    pending.set(key, { ...entry, hits: 1, lastSeen: new Date() });
  } else {
    droppedKeys += 1;
  }
  ensureTimer();
}

function ensureTimer() {
  if (timer || !pool) return;
  timer = setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

async function flush() {
  if (!pool || pending.size === 0) return 0;
  const batch = [...pending.values()];
  pending = new Map();
  if (droppedKeys) {
    console.warn(`[LegacyAuth] ${droppedKeys} request(s) not counted (more than ${MAX_KEYS} distinct keys in a minute).`);
    droppedKeys = 0;
  }
  try {
    await pool.query(
      `INSERT INTO legacy_auth_usage (day, method, path, username, client, hits, last_seen)
       SELECT * FROM UNNEST($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::timestamptz[])
       ON CONFLICT (day, method, path, username, client)
       DO UPDATE SET hits = legacy_auth_usage.hits + EXCLUDED.hits,
                     last_seen = GREATEST(legacy_auth_usage.last_seen, EXCLUDED.last_seen)`,
      [
        batch.map((b) => b.day), batch.map((b) => b.method), batch.map((b) => b.path),
        batch.map((b) => b.username), batch.map((b) => b.client), batch.map((b) => b.hits),
        batch.map((b) => b.lastSeen.toISOString())
      ]
    );
    return batch.length;
  } catch (err) {
    // Reporting only — never let it affect the app. The table may not exist yet on an
    // old database; the counts for this minute are simply lost.
    console.warn('[LegacyAuth] could not save usage counts:', err.message);
    return 0;
  }
}

/** Summary for the admin report. */
async function getReport(dbPool, { days = 7 } = {}) {
  const d = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 30);
  const since = istDay(new Date(Date.now() - (d - 1) * 24 * 60 * 60 * 1000));
  const rows = (await dbPool.query(
    `SELECT method, path, username, client, SUM(hits)::int AS hits, MAX(last_seen) AS last_seen
       FROM legacy_auth_usage WHERE day >= $1
      GROUP BY method, path, username, client
      ORDER BY hits DESC LIMIT 500`, [since])).rows;
  const sum = (key) => {
    const m = new Map();
    for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + r.hits);
    return [...m.entries()].map(([k, hits]) => ({ [key]: k, hits })).sort((a, b) => b.hits - a.hits);
  };
  return {
    since,
    days: d,
    totalHits: rows.reduce((s, r) => s + r.hits, 0),
    byClient: sum('client'),
    byUser: sum('username').slice(0, 100),
    byPath: sum('path').slice(0, 100),
    rows
  };
}

function _resetForTests() {
  pending = new Map();
  droppedKeys = 0;
  if (timer) clearInterval(timer);
  timer = null;
  pool = null;
}

module.exports = {
  setPool,
  recordLegacyUse,
  flush,
  getReport,
  normalizePath,
  classifyClient,
  _pendingForTests: () => [...pending.values()],
  _resetForTests
};
