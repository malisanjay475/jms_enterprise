'use strict';

// Hard locks for endpoints that could wipe, leak or take over the system.
//
// Everywhere else the app still accepts the legacy (unverified) identity while
// clients move to session cookies. These routes do not: they need a verified
// session (see auth.js) with the right role, or they answer 401/403 before the
// legacy handler runs. The handlers keep their own checks as a second layer.
//
// Found open in the Sep-2026 audit: anyone on the internet could download or
// restore the whole database, wipe DPR data, create admin users or reset
// passwords by sending a made-up X-User-Name header or body username.

const { isAdminLike, isSuperadmin, hasDataWipe, canManageUsers } = require('./auth');

const ACCESS = {
  session: { allow: (auth) => Boolean(auth), label: 'a logged-in user' },
  admin: { allow: isAdminLike, label: 'Admin or Superadmin' },
  superadmin: { allow: isSuperadmin, label: 'Superadmin' },
  dataWipe: { allow: hasDataWipe, label: 'Admin or the Data Wipe permission' },
  manageUsers: { allow: canManageUsers, label: 'User Management access' }
};

// method '*' matches any method. Paths are matched against the full URL path.
const GUARDED_ROUTES = [
  // Whole-database download (includes password hashes) and restore (runs pg_restore
  // --clean / psql on an uploaded file).
  { method: 'GET', path: /^\/api\/admin\/backup\/?$/, need: 'admin' },
  // Who still uses the legacy (unverified) identity — lists usernames and endpoints.
  { method: 'GET', path: /^\/api\/admin\/legacy-auth-usage\/?$/, need: 'admin' },
  { method: 'POST', path: /^\/api\/admin\/restore\/?$/, need: 'superadmin' },
  // Bulk wipes.
  { method: 'POST', path: /^\/api\/admin\/clear-data\/?$/, need: 'dataWipe' },
  { method: 'POST', path: /^\/api\/admin\/clear-std-actual\/?$/, need: 'dataWipe' },
  { method: 'POST', path: /^\/api\/dpr\/hourly\/clear\/?$/, need: 'admin' },
  // User and password management.
  { method: '*', path: /^\/api\/admin\/users(\/|$)/, need: 'admin' },
  { method: 'POST', path: /^\/api\/users\/(save|delete|password)\/?$/, need: 'manageUsers' },
  // Force-logout of any account.
  { method: 'POST', path: /^\/api\/logout-all\/?$/, need: 'session' },
  // AI endpoints call a paid model and /ask ran model-written SQL.
  { method: '*', path: /^\/api\/ai(\/|$)/, need: 'session' },
  // Points the Modbus collector at factory-LAN IPs.
  { method: 'PUT', path: /^\/api\/machine-data\/config\/[^/]+\/?$/, need: 'admin' },
  // DPR data changes. These handlers took the actor's role from the request body
  // (session.username, or callerRole for set-qty), so anyone could rewrite or delete
  // production records. set-qty trims/deletes rows to hit a target quantity.
  { method: 'POST', path: /^\/api\/dpr\/superadmin-set-qty\/?$/, need: 'superadmin' },
  { method: 'POST', path: /^\/api\/dpr\/edit\/?$/, need: 'admin' },
  { method: 'POST', path: /^\/api\/dpr\/setup\/clear\/?$/, need: 'admin' },
  // The desktop installer bundles the whole server; only admins provision servers.
  { method: 'GET', path: /^\/api\/local-servers\/desktop-installer\/download\/?$/, need: 'admin' },
  // Makes a LOCAL check MAIN for a release and restart to apply it.
  { method: 'POST', path: /^\/api\/update\/force-check\/?$/, need: 'session' },
  // Per-entry deletes: the handler keeps its own role check (supervisor+, or the DPR
  // delete roles); with a verified session its session.username is the real user.
  { method: 'POST', path: /^\/api\/dpr\/(delete|delete-entry|delete-quick|delete-setup)\/?$/, need: 'session' },
  // Vendor master + purchase orders (list, create, delete vendors and their logins).
  // The handlers had no check at all ("TODO: Add Admin Check"). Purchase staff use
  // these pages, so a verified login is required rather than the Admin role.
  { method: '*', path: /^\/api\/vendor\/admin(\/|$)/, need: 'session' }
];

function findGuard(method, path) {
  const m = String(method || '').toUpperCase();
  return GUARDED_ROUTES.find((rule) => (rule.method === '*' || rule.method === m) && rule.path.test(path)) || null;
}

function routeGuardMiddleware(req, res, next) {
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  const rule = findGuard(req.method, path);
  if (!rule) return next();

  const access = ACCESS[rule.need];
  if (!req.auth) {
    return res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Please log in again to use this feature (your login needs to be refreshed).'
    });
  }
  if (!access.allow(req.auth)) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: `This action needs ${access.label}.` });
  }
  return next();
}

module.exports = { routeGuardMiddleware, GUARDED_ROUTES, findGuard };
