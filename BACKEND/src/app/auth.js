'use strict';

// Server-verified login sessions.
//
// Before this module the server trusted whoever the browser said it was: the
// X-User-Name header came straight from localStorage, so any client could send
// "X-User-Name: superadmin". Login now also sets a signed, HttpOnly session cookie
// (and native clients may send the same token as "Authorization: Bearer ...").
// This middleware verifies it on every request, and when it is valid it overwrites
// X-User-Name with the verified username, so every existing handler that reads
// getRequestUsername()/getRequestActor() sees the real user.
//
// Rollout is soft: a request WITHOUT a session still falls back to the legacy
// header, so nothing that works today breaks. The most dangerous endpoints are
// hard-locked separately (routeGuards.js) and need a real session right away.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const legacyAuthUsage = require('./legacyAuthUsage');

const COOKIE_NAME = 'jms_session';
const TOKEN_TYPE = 'session';
// JMS Chat app sessions (chatAppAuth.js): issued on MAIN to any active user, without the
// geofence or global access. They identify the user ONLY on /api/chat/* — everywhere
// else the request is treated as having no session.
const CHAT_COOKIE_NAME = 'jms_chat_session';
const CHAT_TOKEN_TYPE = 'chat';
const CHAT_SCOPE_RE = /^\/api\/chat(\/|$)/i;

function isChatScope(req) {
  return CHAT_SCOPE_RE.test(String(req.originalUrl || req.url || '').split('?')[0]);
}

function readPositiveIntEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// 7 days, sliding: a session used after half its life gets a fresh cookie, so an
// active user is never logged out mid-shift, while an idle device expires.
const SESSION_TTL_MS = readPositiveIntEnv('AUTH_SESSION_TTL_HOURS', 7 * 24) * 3600 * 1000;
const REFRESH_AFTER_MS = Math.floor(SESSION_TTL_MS / 2);
// Deactivation / "log out other devices" take effect within this window.
const USER_CACHE_MS = 30 * 1000;

let secretPromise = null;

// Session signing key. JWT_SECRET is set on MAIN (GitHub secret) and in LOCAL .env
// files; a purpose-specific key is derived from it so a vendor-portal JWT (same
// JWT_SECRET) can never be replayed as a staff session. Without JWT_SECRET, a random
// key is created once in server_config and shared by every worker, instead of a
// guessable built-in default.
async function getSigningKey(pool) {
  if (!secretPromise) {
    secretPromise = (async () => {
      let base = process.env.JWT_SECRET || '';
      if (!base) {
        await pool.query(
          `INSERT INTO server_config (key, value) VALUES ('AUTH_SESSION_SECRET', $1)
           ON CONFLICT (key) DO NOTHING`,
          [crypto.randomBytes(32).toString('hex')]
        );
        const r = await pool.query(`SELECT value FROM server_config WHERE key = 'AUTH_SESSION_SECRET'`);
        base = r.rows[0]?.value || '';
      }
      if (!base) throw new Error('no session signing key available');
      return crypto.createHmac('sha256', base).update('jms-staff-session-v1').digest('hex');
    })().catch((err) => {
      secretPromise = null; // retry on the next request
      throw err;
    });
  }
  return secretPromise;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || out[name] !== undefined) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[name] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function readToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const cookie = cookies[COOKIE_NAME];
  if (cookie) return { token: cookie, fromCookie: true };
  // The chat cookie only counts where a chat token is accepted.
  if (cookies[CHAT_COOKIE_NAME] && isChatScope(req)) {
    return { token: cookies[CHAT_COOKIE_NAME], fromCookie: true, chatCookie: true };
  }
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    // The old frontend sent a literal placeholder; it is not a session.
    if (token && token !== 'dummy-token-for-now') return { token, fromCookie: false };
  }
  return null;
}

// Behind Traefik the app sees plain HTTP; the proxy reports the original scheme.
function isSecureRequest(req) {
  if (req.secure) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}

function cookieOptions(req, maxAgeMs) {
  const opts = { httpOnly: true, sameSite: 'lax', path: '/', secure: isSecureRequest(req) };
  if (maxAgeMs !== undefined) opts.maxAge = maxAgeMs;
  return opts;
}

// `issuedAtMs` is stored in the token so "log out other devices" can revoke every
// session issued before a cutoff with millisecond precision (JWT `iat` is seconds).
async function signSession(pool, user, issuedAtMs = Date.now(), typ = TOKEN_TYPE, extra = {}) {
  const key = await getSigningKey(pool);
  return jwt.sign(
    { ...extra, typ, sub: String(user.username), uid: user.id ?? null, sat: issuedAtMs },
    key,
    { algorithm: 'HS256', expiresIn: Math.floor(SESSION_TTL_MS / 1000) }
  );
}

async function issueSession(pool, req, res, user, issuedAtMs) {
  const token = await signSession(pool, user, issuedAtMs);
  res.cookie(COOKIE_NAME, token, cookieOptions(req, SESSION_TTL_MS));
  return token;
}

function clearSession(req, res) {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// `deviceId` (chatSecure.js) ties the session to one signed-in device, for remote sign-out.
async function issueChatSession(pool, req, res, user, issuedAtMs, deviceId) {
  const token = await signSession(pool, user, issuedAtMs, CHAT_TOKEN_TYPE, deviceId ? { did: deviceId } : {});
  res.cookie(CHAT_COOKIE_NAME, token, cookieOptions(req, SESSION_TTL_MS));
  return token;
}

function clearChatSession(req, res) {
  res.clearCookie(CHAT_COOKIE_NAME, cookieOptions(req));
}

const userCache = new Map();

// chatSecure.js plugs in here: is this chat-app token still signed in on its device?
let chatTokenCheck = null;
function setChatTokenCheck(fn) { chatTokenCheck = fn; }

function invalidateUserCache(username) {
  if (username === undefined) userCache.clear();
  else userCache.delete(String(username).toLowerCase());
}

async function loadSessionUser(pool, username) {
  const cacheKey = String(username).toLowerCase();
  const hit = userCache.get(cacheKey);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;
  const r = await pool.query(
    `SELECT id, username, role_code, permissions, global_access,
            COALESCE(is_active, TRUE) AS is_active,
            logout_all_after
       FROM users
      WHERE username = $1
      LIMIT 1`,
    [username]
  );
  const user = r.rows[0] || null;
  userCache.set(cacheKey, { user, at: Date.now() });
  return user;
}

function createAuthMiddleware(pool) {
  legacyAuthUsage.setPool(pool);
  return async function authMiddleware(req, res, next) {
    req.auth = null;
    const found = readToken(req);
    if (!found) {
      // Count (only count) requests that still rely on the legacy identity.
      legacyAuthUsage.recordLegacyUse(req);
      return next();
    }

    try {
      const key = await getSigningKey(pool);
      const payload = jwt.verify(found.token, key, { algorithms: ['HS256'] });
      if (!payload.sub) throw new Error('not a session token');
      const chatToken = payload.typ === CHAT_TOKEN_TYPE;
      if (!chatToken && payload.typ !== TOKEN_TYPE) throw new Error('not a session token');
      // A chat-app token outside /api/chat: valid, just not here. No session, keep it.
      if (chatToken && !isChatScope(req)) {
        legacyAuthUsage.recordLegacyUse(req);
        return next();
      }

      const user = await loadSessionUser(pool, payload.sub);
      if (!user || user.is_active === false) throw new Error('user missing or inactive');
      const cutoff = user.logout_all_after ? new Date(user.logout_all_after).getTime() : 0;
      const issuedAt = Number(payload.sat) || Number(payload.iat) * 1000 || 0;
      if (cutoff && issuedAt < cutoff) throw new Error('session revoked');
      if (chatToken && chatTokenCheck && !(await chatTokenCheck(pool, payload))) throw new Error('device signed out');

      req.auth = {
        id: user.id,
        username: user.username,
        role: String(user.role_code || '').toLowerCase(),
        permissions: (user.permissions && typeof user.permissions === 'object') ? user.permissions : {},
        globalAccess: user.global_access === true,
        scope: chatToken ? 'chat' : 'full',
        deviceId: chatToken && payload.did ? String(payload.did) : null
      };
      // The verified identity wins over whatever the client claimed.
      req.headers['x-user-name'] = user.username;
      // Many legacy handlers read the actor from a JSON body field `session.username`
      // (DPR edit/delete/clear, date guards, ...) and look its role up in the DB. Bind
      // it to the verified user too, so a logged-in operator can't claim to be an admin
      // in the body. (JSON bodies are parsed before this middleware; multipart forms
      // are parsed later by their route and are not covered here.)
      if (req.body && typeof req.body.session === 'object' && req.body.session !== null) {
        req.body.session.username = user.username;
      }

      if (found.fromCookie && Date.now() - issuedAt > REFRESH_AFTER_MS) {
        const reissue = found.chatCookie ? issueChatSession : issueSession;
        await reissue(pool, req, res, user, undefined, found.chatCookie ? payload.did : undefined).catch(() => {});
      }
    } catch (err) {
      // Expired, tampered, revoked or unknown: stop the browser sending it. The
      // request continues as an unauthenticated (legacy) request.
      if (found.chatCookie) clearChatSession(req, res);
      else if (found.fromCookie) clearSession(req, res);
    }
    legacyAuthUsage.recordLegacyUse(req);
    return next();
  };
}

// ---- Role checks (mirror the legacy helpers so rules stay identical) ----

function isAdminLike(auth) {
  return auth?.role === 'admin' || auth?.role === 'superadmin';
}

function isSuperadmin(auth) {
  return auth?.role === 'superadmin';
}

function hasDataWipe(auth) {
  const perms = auth?.permissions || {};
  return isAdminLike(auth) || Boolean(perms.critical_ops && perms.critical_ops.data_wipe === true);
}

// Server-side counterpart of the Users page access: admins, anyone given the
// "users" app, or an explicit users add/edit/delete grant. (The browser's can()
// defaults to true when no permission is set; the server must not.)
function canManageUsers(auth) {
  if (isAdminLike(auth)) return true;
  const p = auth?.permissions || {};
  const apps = p.__apps || p.app_access || {};
  if (apps && typeof apps === 'object' && apps.users === true) return true;
  for (const action of ['add', 'edit', 'delete', 'other']) {
    if (p[`users_${action}`] === true) return true;
    if (p.users && typeof p.users === 'object' && p.users[action] === true) return true;
  }
  return false;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createAuthMiddleware,
  issueSession,
  clearSession,
  CHAT_COOKIE_NAME,
  issueChatSession,
  clearChatSession,
  isChatScope,
  setChatTokenCheck,
  signSession,
  invalidateUserCache,
  parseCookies,
  isAdminLike,
  isSuperadmin,
  hasDataWipe,
  canManageUsers,
  __test: {
    resetForTests() {
      secretPromise = null;
      userCache.clear();
    }
  }
};
