/**
 * JMS Machine Data collector.
 *
 * Runs on the LOCAL factory server (it must reach the machines' private IPs).
 * Loop:
 *   1. Fetch the list of enabled machines + their Modbus config from the backend
 *      (GET /api/machine-data/config/enabled, guarded by MACHINE_INGEST_KEY).
 *   2. For each machine, connect over Modbus TCP, read the profile's register
 *      span (chunked to respect the 125-register limit), decode with the shared
 *      profile, and POST the decoded values to /api/machine-data/ingest.
 *
 * It only READS holding registers — it never writes to the machines.
 *
 *   cd MACHINE_COLLECTOR
 *   npm install
 *   MACHINE_INGEST_KEY=... BACKEND_URL=http://localhost:3001 node collector.js
 *
 * Env:
 *   BACKEND_URL         default http://localhost:3001
 *   MACHINE_INGEST_KEY  shared secret; must match the backend's env
 *   REFRESH_MS          how often to re-read config from backend (default 30000)
 */

const ModbusRTU = require('modbus-serial');
const keba = require('../BACKEND/src/modules/machineData/kebaProfile');

const PROFILES = { [keba.PROFILE_ID]: keba };

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
const INGEST_KEY = process.env.MACHINE_INGEST_KEY || '';
const REFRESH_MS = parseInt(process.env.REFRESH_MS || '30000', 10);
const MAX_READ = 60; // registers per Modbus read (< 125 limit; smaller = more
                     // resilient when a controller only maps part of the range)

if (!INGEST_KEY) {
  console.error('MACHINE_INGEST_KEY is required (must match the backend env).');
  process.exit(1);
}

// machine_id -> { timer, cfg } so we can reconcile on each config refresh.
const active = new Map();

async function fetchJson(path, opts = {}) {
  const res = await fetch(BACKEND_URL + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-ingest-key': INGEST_KEY, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`${path} -> ${res.status} ${body.error || ''}`);
  }
  return body;
}

async function readSpan(client, unitId, profile, wordOrder) {
  const { startOffset, count } = profile.span();
  const words = new Array(count).fill(0);
  client.setID(unitId);
  let anyOk = false;
  // Some controllers only map part of the documented range and reject a read
  // that runs past their last register. Read in chunks and keep the ones that
  // succeed rather than failing the whole poll.
  for (let i = 0; i < count; i += MAX_READ) {
    const len = Math.min(MAX_READ, count - i);
    try {
      const { data } = await client.readHoldingRegisters(startOffset + i, len);
      for (let j = 0; j < data.length; j++) words[i + j] = data[j];
      anyOk = true;
    } catch (e) {
      // Illegal-address/value on an unmapped tail is expected — skip this chunk.
      const msg = String(e && e.message || e);
      if (!/Illegal data (address|value)/i.test(msg)) throw e; // real fault: bubble up
    }
  }
  if (!anyOk) throw new Error('no readable registers');
  return profile.decodeBlock(words, startOffset, wordOrder);
}

async function pollMachine(cfg) {
  const profile = PROFILES[cfg.profile_id] || keba;
  const client = new ModbusRTU();
  try {
    await client.connectTCP(cfg.ip, { port: cfg.port || 502 });
    client.setTimeout(3000);
    const values = await readSpan(client, cfg.unit_id || 1, profile, cfg.word_order || 'ABCD');
    await fetchJson('/api/machine-data/ingest', {
      method: 'POST',
      body: JSON.stringify({ machine_id: cfg.machine_id, values }),
    });
    console.log(`[${new Date().toISOString()}] ${cfg.machine_name} (${cfg.ip}) good=${values.good_shots} bad=${values.bad_shots} cyc=${values.cycle_time_act}s run=${values.machine_running}`);
  } catch (e) {
    console.error(`[poll] ${cfg.machine_name} (${cfg.ip}): ${e.message}`);
  } finally {
    try { client.close(() => {}); } catch (_) {}
  }
}

function scheduleMachine(cfg) {
  const key = cfg.machine_id;
  const existing = active.get(key);
  if (existing) clearInterval(existing.timer);
  const pollMs = Math.max(1000, cfg.poll_ms || 5000);
  // Poll immediately, then on the machine's own interval.
  pollMachine(cfg);
  const timer = setInterval(() => pollMachine(cfg), pollMs);
  active.set(key, { timer, cfg });
}

async function refreshConfig() {
  let machines;
  try {
    ({ machines } = await fetchJson('/api/machine-data/config/enabled'));
  } catch (e) {
    console.error('[config] ' + e.message);
    return;
  }
  const wanted = new Set(machines.map(m => m.machine_id));
  // Stop machines no longer enabled
  for (const [id, entry] of active) {
    if (!wanted.has(id)) {
      clearInterval(entry.timer);
      active.delete(id);
      console.log(`[config] stopped polling machine ${id}`);
    }
  }
  // (Re)schedule current machines
  for (const cfg of machines) scheduleMachine(cfg);
}

async function main() {
  console.log(`JMS Machine Collector starting. backend=${BACKEND_URL}`);
  await refreshConfig();
  setInterval(refreshConfig, REFRESH_MS);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
