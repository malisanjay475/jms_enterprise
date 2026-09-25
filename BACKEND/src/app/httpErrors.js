'use strict';

// Centralised 500 responder that does NOT leak internal error detail (SQL text,
// stack traces, DB driver messages) to API clients. The Sep-2026 audit found
// dozens of handlers echoing `String(e.message)` straight back in the response,
// which exposed table/column names and query fragments to anyone hitting the API.
//
// The full error is always logged server-side. The response carries a generic
// message in production; set EXPOSE_ERRORS=1 (or run outside production, e.g. a
// dev box) to include the detail in the body for local debugging.

const EXPOSE_ERRORS = process.env.EXPOSE_ERRORS === '1' || process.env.NODE_ENV !== 'production';

function errorDetail(e) {
  return String((e && e.message) || e || 'error');
}

// Log the real error and reply with a safe body. Keeps the { ok:false, error }
// shape every existing caller and the frontend already expect.
function sendServerError(res, e, status = 500) {
  try { console.error('[api-error]', (e && e.stack) || e); } catch (_) { /* logging must never throw */ }
  const error = EXPOSE_ERRORS ? errorDetail(e) : 'Internal server error';
  try { return res.status(status).json({ ok: false, error }); } catch (_) { return res; }
}

module.exports = { sendServerError, errorDetail, EXPOSE_ERRORS };
