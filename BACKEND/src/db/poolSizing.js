'use strict';

const os = require('os');

// How many connections each Node process may open.
//
// Postgres allows max_connections (100 by default, also on the VPS) for EVERYONE:
// every PM2 worker, pg_dump backups, psql/pgAdmin. The pool used to be a fixed 50 per
// process, and production runs PM2 in cluster mode with one worker per CPU (4 on the
// VPS) — up to 200 app connections against a limit of 100, so a load spike ended in
// "sorry, too many clients already" errors.
//
// Now a total budget (default 80, leaving room for backups and admin tools) is split
// across the workers. A single-process server (the factory LOCAL servers) keeps 50.
//   DB_POOL_MAX            fixed size per process (overrides everything)
//   DB_CONNECTION_BUDGET   total for all workers (default 80)
//   DB_POOL_WORKERS        worker count, if it can't be detected
const DEFAULT_BUDGET = 80;
const MAX_PER_PROCESS = 50;
const MIN_PER_PROCESS = 5;

function positiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Number of processes sharing the database, as seen from inside one of them. */
function detectWorkerCount(env = process.env, cpuCount = os.cpus().length) {
  const explicit = positiveInt(env.DB_POOL_WORKERS);
  if (explicit) return explicit;
  // PM2 copies its process settings into each worker's environment. In cluster mode
  // exec_mode is 'cluster_mode' and instances is the count, or 0 for 'max' (= CPUs).
  if (env.exec_mode === 'cluster_mode') {
    return positiveInt(env.instances) || Math.max(1, cpuCount);
  }
  return 1;
}

function computePoolMax(env = process.env, cpuCount = os.cpus().length) {
  const fixed = positiveInt(env.DB_POOL_MAX);
  if (fixed) return { max: fixed, workers: detectWorkerCount(env, cpuCount), source: 'DB_POOL_MAX' };
  const workers = detectWorkerCount(env, cpuCount);
  const budget = positiveInt(env.DB_CONNECTION_BUDGET) || DEFAULT_BUDGET;
  const max = Math.min(MAX_PER_PROCESS, Math.max(MIN_PER_PROCESS, Math.floor(budget / workers)));
  return { max, workers, budget, source: 'budget' };
}

module.exports = { computePoolMax, detectWorkerCount };
