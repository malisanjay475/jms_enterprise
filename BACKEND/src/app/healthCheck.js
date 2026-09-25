'use strict';

// Readiness check: can this server actually answer requests that need the database?
//
// GET /health (liveness) stays a plain "process is up" answer: Docker's healthcheck
// uses it, and Traefik stops routing to an unhealthy container, so tying it to the DB
// would turn a short DB hiccup into the whole site disappearing.
// GET /api/health and /health/ready run `SELECT 1` (with a timeout) and report pool
// pressure, for deploy checks and uptime monitors. The result is cached for a few
// seconds so a monitor polling hard can't load the DB.

const DB_TIMEOUT_MS = 3000;
const CACHE_MS = 5000;

function createReadinessCheck(pool, { timeoutMs = DB_TIMEOUT_MS, cacheMs = CACHE_MS } = {}) {
  let cached = null;
  let inFlight = null;
  // The SELECT 1 itself. A timeout ends the probe but not the query, so a hung
  // database would otherwise collect one stuck query (and pool connection) per
  // probe. While one is still running, later probes report a timeout instead of
  // starting another.
  let pendingQuery = null;

  async function probe() {
    const started = Date.now();
    if (pendingQuery) {
      console.warn('[Health] previous database check still running; reporting timeout');
      return { ok: false, latencyMs: 0, error: 'timeout' };
    }
    pendingQuery = Promise.resolve()
      .then(() => pool.query('SELECT 1'))
      .finally(() => { pendingQuery = null; });
    pendingQuery.catch(() => {}); // settled below or abandoned after a timeout
    let timer;
    try {
      await Promise.race([
        pendingQuery,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const timeout = new Error(`database did not answer within ${timeoutMs} ms`);
            timeout.code = 'HEALTH_TIMEOUT';
            reject(timeout);
          }, timeoutMs);
        })
      ]);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      // Detail (which can include internal addresses) goes to the log, not the response.
      const message = String(error && error.message || error);
      console.warn(`[Health] database check failed: ${message}`);
      return { ok: false, latencyMs: Date.now() - started, error: error && error.code === 'HEALTH_TIMEOUT' ? 'timeout' : 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  return async function check() {
    if (cached && Date.now() - cached.at < cacheMs) return cached.result;
    if (!inFlight) {
      inFlight = probe().then((db) => {
        const result = {
          ok: db.ok,
          db,
          pool: {
            total: pool.totalCount ?? null,
            idle: pool.idleCount ?? null,
            waiting: pool.waitingCount ?? null
          },
          checkedAt: new Date().toISOString()
        };
        cached = { at: Date.now(), result };
        return result;
      }).finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}

module.exports = { createReadinessCheck };
