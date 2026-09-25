'use strict';

/* ============================================================
   BRUTE-FORCE PROTECTION
   In-memory tracker, two levels:
   - username + client IP: 5 failures → 15-min lockout for that pair. Keyed on the
     IP too so that someone guessing from one machine can't lock the real user out
     of every other machine (it used to be username only).
   - username alone: 50 failures from any mix of IPs → 15-min lockout, so spreading
     guesses over many addresses doesn't give unlimited tries.
   Resets on successful login. Each PM2 worker has its own map,
   which is acceptable for factory intranet use — Redis would be
   needed for perfect cross-worker coordination.
============================================================ */
const _loginAttempts = new Map(); // key → { count, firstFailAt, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_MAX_USER_ATTEMPTS = 50;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_WINDOW_MS  = 15 * 60 * 1000; // reset window

function _loginKeys(username, ip) {
  const user = String(username || '').toLowerCase().trim();
  return { pair: `ip:${String(ip || '')}|u:${user}`, user: `u:${user}` };
}

function _lockMessage(key, now) {
  const entry = _loginAttempts.get(key);
  if (!entry || !entry.lockedUntil) return null;
  if (now < entry.lockedUntil) {
    const remainingMin = Math.ceil((entry.lockedUntil - now) / 60000);
    return `Too many failed attempts. Account locked for ${remainingMin} more minute(s).`;
  }
  _loginAttempts.delete(key); // lock expired
  return null;
}

function _checkBruteForce(username, ip) {
  const keys = _loginKeys(username, ip);
  const now = Date.now();
  return _lockMessage(keys.pair, now) || _lockMessage(keys.user, now);
}

function _bumpFailure(key, max, now) {
  let entry = _loginAttempts.get(key) || { count: 0, firstFailAt: now, lockedUntil: null };
  // Reset window if first failure was long ago
  if (now - entry.firstFailAt > LOGIN_WINDOW_MS) {
    entry = { count: 0, firstFailAt: now, lockedUntil: null };
  }
  entry.count += 1;
  if (entry.count >= max && !entry.lockedUntil) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    console.warn(`[Security] Login locked for "${key}" after ${entry.count} failures.`);
  }
  _loginAttempts.set(key, entry);
}

function _recordLoginFailure(username, ip) {
  const keys = _loginKeys(username, ip);
  const now = Date.now();
  _bumpFailure(keys.pair, LOGIN_MAX_ATTEMPTS, now);
  _bumpFailure(keys.user, LOGIN_MAX_USER_ATTEMPTS, now);
}

function _clearLoginFailures(username, ip) {
  // A correct password clears this machine's count. The username-wide count is left to
  // expire, so a guesser elsewhere doesn't get a fresh 50 every time the real user logs in.
  _loginAttempts.delete(_loginKeys(username, ip).pair);
}

// Purge stale entries every 30 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _loginAttempts) {
    if (!entry.lockedUntil && now - entry.firstFailAt > LOGIN_WINDOW_MS) _loginAttempts.delete(key);
    else if (entry.lockedUntil && now > entry.lockedUntil + 60000) _loginAttempts.delete(key);
  }
}, 30 * 60 * 1000).unref();

module.exports = {
  checkBruteForce: _checkBruteForce,
  recordLoginFailure: _recordLoginFailure,
  clearLoginFailures: _clearLoginFailures,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_MAX_USER_ATTEMPTS,
  _resetForTests: () => _loginAttempts.clear()
};
