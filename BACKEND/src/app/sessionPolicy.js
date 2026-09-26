'use strict';

// Which API requests may run WITHOUT a verified login session, and the switch that
// makes a session required everywhere else.
//
// Today login is "soft": without a session, auth.js falls back to the X-User-Name
// header / body session.username. legacyAuthUsage.js counts every request that
// would be refused if that fallback were removed, and GET /api/admin/legacy-auth-usage
// shows them. When that report is (nearly) empty, set AUTH_REQUIRE_SESSION=1 and
// restart: non-public /api requests without a session then get 401 AUTH_REQUIRED
// (pages send the user to log in). Rollback: unset AUTH_REQUIRE_SESSION and restart.
//
// Public = the login flow itself, health/version, and endpoints that check their own
// credentials (sync / node / ingest / device keys, the vendor portal's own token, the
// QC APK publish form's username+password).

const PUBLIC_API = [
  /^\/api\/(login|logout|logout-all|session|version|health)\/?$/,
  /^\/api\/sync(\/|$)/,                 // x-sync-api-key (LOCAL ↔ MAIN)
  /^\/api\/sync-alert(\/|$)/,           // SYNC_API_KEY (GitHub Action)
  /^\/api\/local-servers(\/|$)/,        // x-node-key (node routes); admin routes keep their own checks
  /^\/api\/update(\/|$)/,               // x-node-key (release download / check)
  /^\/api\/machine-data\/(ingest|cycle-ingest|config\/enabled)\/?$/, // x-ingest-key (collector)
  /^\/api\/assembly\/device-scan\/?$/,  // x-device-key (ESP32 scanner)
  /^\/api\/vendor\/(auth|data|action)(\/|$)/, // vendor portal JWT
  /^\/api\/qc-app\/publish\/?$/         // username + password in the form
];

function isPublicApi(fullPath) {
  const p = String(fullPath || '');
  return PUBLIC_API.some((re) => re.test(p));
}

function sessionRequired(env = process.env) {
  return ['1', 'true', 'on', 'yes'].includes(String(env.AUTH_REQUIRE_SESSION || '').toLowerCase());
}

/** Mount on /api after the session middleware. A no-op unless AUTH_REQUIRE_SESSION is on. */
function requireSessionMiddleware(req, res, next) {
  if (!sessionRequired() || req.auth) return next();
  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (isPublicApi(fullPath)) return next();
  return res.status(401).json({
    ok: false,
    code: 'AUTH_REQUIRED',
    error: 'Please log in again to continue.'
  });
}

module.exports = { PUBLIC_API, isPublicApi, sessionRequired, requireSessionMiddleware };
