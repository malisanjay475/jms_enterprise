'use strict';

// JMS Chat kill switch and staged rollout.
//
//   CHAT_ENABLED    0 / false / off = chat off everywhere (widget hidden, /api/chat/* 404)
//   CHAT_FACTORIES  "all" (default) or a list of factory ids, e.g. "1" or "1,3":
//                   who gets chat during a staged rollout.
//
// Where the value comes from, first match wins:
//   1. the server's environment (CHAT_ENABLED / CHAT_FACTORIES), for an emergency switch;
//   2. on a factory LOCAL: MAIN's settings, received with every chat sync pull, so a
//      rollout is steered from one place;
//   3. server_config (CHAT_ENABLED / CHAT_FACTORIES), set by a superadmin in Settings.
//
// Who is in: superadmins always (so they can test a rollout). On MAIN, a user whose home
// factory (users.factory_id) or any assigned factory (user_factories) is on the list. On
// a LOCAL, everyone when the LOCAL's own factory is on the list.

const chatSync = require('./chatSync');

const CACHE_MS = 30000;
let cache = { at: 0, value: null };
const userCache = new Map(); // username -> { at, ok }

function parseEnabled(v) {
  if (v == null || v === '') return null;
  return !/^(0|false|off|no)$/i.test(String(v).trim());
}

function parseFactories(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'all' || s === '*') return 'all';
  const ids = s.split(/[\s,]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

async function readConfig(pool, key) {
  try {
    const { rows: [r] } = await pool.query('SELECT value FROM server_config WHERE key = $1', [key]);
    return r ? r.value : null;
  } catch (_e) { return null; }
}

async function mainSettings(pool) {
  try {
    const { rows: [r] } = await pool.query("SELECT value FROM chat_sync_state WHERE name = 'main_chat_settings'");
    return r ? JSON.parse(r.value) : null;
  } catch (_e) { return null; }
}

// The settings this server stores itself (what MAIN hands to LOCALs).
async function ownSettings(pool) {
  const enabled = parseEnabled(await readConfig(pool, 'CHAT_ENABLED'));
  const factories = parseFactories(await readConfig(pool, 'CHAT_FACTORIES'));
  return { enabled: enabled == null ? true : enabled, factories: factories || 'all' };
}

// Effective settings, with where each came from.
async function settings(pool, { fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  const own = await ownSettings(pool);
  const fromMain = chatSync.isLocal() ? await mainSettings(pool) : null;
  const envEnabled = parseEnabled(process.env.CHAT_ENABLED);
  const envFactories = parseFactories(process.env.CHAT_FACTORIES);
  const value = {
    enabled: envEnabled != null ? envEnabled : (fromMain && typeof fromMain.enabled === 'boolean' ? fromMain.enabled : own.enabled),
    factories: envFactories || (fromMain && fromMain.factories) || own.factories,
    source: {
      enabled: envEnabled != null ? 'env' : (fromMain ? 'main' : 'settings'),
      factories: envFactories ? 'env' : (fromMain ? 'main' : 'settings')
    }
  };
  cache = { at: Date.now(), value };
  return value;
}

function clearCache() { cache = { at: 0, value: null }; userCache.clear(); }

async function userFactories(pool, username) {
  const ids = new Set();
  try {
    const { rows } = await pool.query(
      `SELECT u.factory_id AS f FROM users u WHERE LOWER(u.username) = LOWER($1) AND u.factory_id IS NOT NULL
       UNION
       SELECT uf.factory_id FROM user_factories uf JOIN users u ON u.id = uf.user_id WHERE LOWER(u.username) = LOWER($1)`,
      [username]
    );
    rows.forEach((r) => ids.add(Number(r.f)));
  } catch (_e) { /* schema without these columns/tables: no factory */ }
  return ids;
}

// { ok, reason } for a signed-in user.
async function access(pool, auth) {
  const s = await settings(pool);
  if (!s.enabled) return { ok: false, reason: 'off' };
  if (s.factories === 'all') return { ok: true };
  if (auth && auth.role === 'superadmin') return { ok: true };
  if (chatSync.isLocal()) {
    const f = parseInt(chatSync.runtime().factoryId, 10);
    return s.factories.includes(f) ? { ok: true } : { ok: false, reason: 'factory' };
  }
  if (!auth || !auth.username) return { ok: true }; // the session check answers these
  const key = auth.username.toLowerCase();
  const hit = userCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok ? { ok: true } : { ok: false, reason: 'factory' };
  const mine = await userFactories(pool, auth.username);
  const ok = s.factories.some((f) => mine.has(f));
  userCache.set(key, { at: Date.now(), ok });
  return ok ? { ok: true } : { ok: false, reason: 'factory' };
}

// /api/chat/* answers 404 when chat is off (or not yet on for this user's factory).
function middleware(pool) {
  return async function chatGate(req, res, next) {
    try {
      const a = await access(pool, req.auth);
      if (a.ok) return next();
      return res.status(404).json({ ok: false, code: 'CHAT_DISABLED', error: 'Chat is not available.' });
    } catch (err) {
      console.warn('[chat] gate check failed, allowing:', err.message);
      return next();
    }
  };
}

module.exports = { settings, ownSettings, access, middleware, clearCache, parseEnabled, parseFactories };
