#!/usr/bin/env node
'use strict';

/*
 * JMS Chat load test. Runs the real chat routes in N forked "worker" processes (like
 * PM2 cluster) against a THROWAWAY PostgreSQL, opens one SSE stream per simulated user,
 * sends messages at a steady rate and has every receiver react the way chat-widget.js
 * does (badge refresh, or list refresh + mark-read when the panel is open).
 *
 *   node scripts/chat-load-test.js --pg postgres://postgres@localhost:55432/chatload
 *        [--users 200] [--rate 1000] [--duration 60] [--workers 2] [--groups 10]
 *
 * Reports send latency (p50/p95/p99), SSE delivery delay (send -> arrival at the
 * receiver), DB pool use and worker memory. Login is faked with an x-user header inside
 * the test workers only; nothing here talks to a real JMS server.
 *
 * Safety: refuses port 5432 (the factory/live PostgreSQL) and creates its own tables in
 * the database it is given. Use an empty, disposable database.
 */

const http = require('http');
const path = require('path');
const { fork } = require('child_process');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PG = arg('pg', process.env.CHAT_LOAD_PG || '');
const USERS = parseInt(arg('users', '200'), 10);
const RATE = parseInt(arg('rate', '1000'), 10); // messages per minute
const DURATION = parseInt(arg('duration', '60'), 10); // seconds
const WORKERS = parseInt(arg('workers', '2'), 10);
const GROUPS = parseInt(arg('groups', '10'), 10);
const BASE_PORT = parseInt(arg('port', '3960'), 10);
const OPEN_SHARE = 0.3; // share of users with the chat panel open

function guardDb(url) {
  let u;
  try { u = new URL(url); } catch (_e) { throw new Error('--pg must be a postgres:// URL to a throwaway database'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('--pg must be a postgres:// URL');
  if ((u.port || '5432') === '5432') throw new Error('Refusing port 5432: that is the live/factory PostgreSQL. Use a throwaway server (e.g. 55432).');
  return u;
}

// ---------------- worker (one simulated app process) ----------------
async function runWorker(port) {
  process.env.SERVER_TYPE = 'MAIN';
  const express = require('express');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: PG, max: parseInt(process.env.CHAT_LOAD_POOL || '10', 10) });
  const { registerChatRoutes } = require(path.join(__dirname, '../src/modules/chat/registerChatRoutes'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.headers['x-user'];
    if (u) req.auth = { username: String(u), role: u === 'loadadmin' ? 'superadmin' : 'operator' };
    next();
  });
  registerChatRoutes(app, pool);
  let peakWaiting = 0;
  let peakTotal = 0;
  setInterval(() => {
    peakWaiting = Math.max(peakWaiting, pool.waitingCount);
    peakTotal = Math.max(peakTotal, pool.totalCount);
  }, 50).unref();
  app.get('/__stats', (_req, res) => {
    const m = process.memoryUsage();
    res.json({ pid: process.pid, pool_total: pool.totalCount, pool_idle: pool.idleCount, pool_waiting: pool.waitingCount,
      peak_waiting: peakWaiting, peak_total: peakTotal, rss_mb: Math.round(m.rss / 1048576), heap_mb: Math.round(m.heapUsed / 1048576) });
  });
  app.post('/__reset', (_req, res) => { peakWaiting = 0; peakTotal = 0; res.json({ ok: true }); });
  http.createServer({ keepAlive: true }, app).listen(port, () => process.send && process.send({ ready: port }));
}

// ---------------- driver ----------------
const agent = new http.Agent({ keepAlive: true, maxSockets: 512 });

function request(port, user, method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: url, agent,
      headers: { 'x-user': user, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch (_e) { json = null; }
        resolve({ status: res.statusCode, data: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function openStream(port, user, onEvent) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/chat/stream', headers: { 'x-user': user } }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c.toString();
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (line.startsWith('data: ')) {
            try { onEvent(JSON.parse(line.slice(6))); } catch (_e) { /* ignore */ }
          }
        }
      });
      resolve(req);
    });
    req.end();
  });
}

function pct(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

async function main() {
  guardDb(PG);
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: PG, max: 2 });
  // users table the chat module reads (created only if absent: this is a throwaway DB)
  await admin.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT, role_code TEXT, line TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  const names = Array.from({ length: USERS }, (_, i) => `load${String(i + 1).padStart(3, '0')}`);
  await admin.query(`INSERT INTO users (username, role_code)
                     SELECT u, 'operator' FROM unnest($1::text[]) u
                      WHERE NOT EXISTS (SELECT 1 FROM users x WHERE x.username = u)`, [names]);
  await admin.query(`INSERT INTO users (username, role_code) SELECT 'loadadmin', 'superadmin'
                      WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'loadadmin')`);

  // start workers
  const ports = Array.from({ length: WORKERS }, (_, i) => BASE_PORT + i);
  const kids = await Promise.all(ports.map((port) => new Promise((resolve, reject) => {
    const k = fork(__filename, ['--serve', String(port), ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    k.on('message', (m) => { if (m && m.ready) resolve(k); });
    k.on('exit', (code) => reject(new Error(`worker ${port} exited ${code}`)));
  })));
  const portOf = (i) => ports[i % ports.length];
  await new Promise((r) => setTimeout(r, 1500)); // schema + listeners

  // conversations: each user gets ~3 direct chats; GROUPS groups of 20
  const convsOf = new Map(names.map((n) => [n, []]));
  const membersOf = new Map();
  for (let i = 0; i < USERS; i++) {
    for (const step of [1, 7, 31]) {
      const a = names[i]; const b = names[(i + step) % USERS];
      const r = await request(portOf(i), a, 'POST', '/api/chat/conversations', { username: b });
      const id = r.data.conversation.sync_id;
      if (!membersOf.has(id)) { membersOf.set(id, [a, b]); convsOf.get(a).push(id); convsOf.get(b).push(id); }
    }
  }
  for (let g = 0; g < GROUPS; g++) {
    const mem = Array.from({ length: 20 }, (_, k) => names[(g * 17 + k * 9) % USERS]);
    const uniq = [...new Set(mem)];
    const r = await request(portOf(g), uniq[0], 'POST', '/api/chat/groups', { title: `Load group ${g + 1}`, members: uniq.slice(1) });
    const id = r.data.conversation.sync_id;
    membersOf.set(id, uniq);
    uniq.forEach((u) => convsOf.get(u).push(id));
  }

  // streams (users spread over the workers), plus one superadmin stream (fan-out copies)
  const sentAt = new Map(); // message sync_id -> send start
  const delays = [];
  const sendMs = [];
  let delivered = 0;
  let adminCopies = 0;
  let errors = 0;
  let reactions = 0;
  const reactMs = [];
  const streams = [];
  for (let i = 0; i < USERS; i++) {
    const user = names[i];
    const port = portOf(i);
    const panelOpen = i < USERS * OPEN_SHARE;
    streams.push(await openStream(port, user, (ev) => {
      if (ev.type !== 'message' || ev.message.sender === user) return;
      const t0 = sentAt.get(ev.message.body);
      if (t0) { delays.push(Date.now() - t0); delivered += 1; }
      // what the widget does on a new message
      const start = Date.now();
      const work = panelOpen
        ? Promise.all([request(port, user, 'GET', '/api/chat/conversations'), request(port, user, 'POST', '/api/chat/read', { conversation_sync_id: ev.message.conversation_sync_id })])
        : request(port, user, 'GET', '/api/chat/unread');
      work.then(() => { reactions += 1; reactMs.push(Date.now() - start); }).catch(() => { errors += 1; });
    }));
  }
  streams.push(await openStream(ports[0], 'loadadmin', (ev) => { if (ev.adminCopy) adminCopies += 1; }));
  await new Promise((r) => setTimeout(r, 1000));
  await Promise.all(ports.map((p) => request(p, 'x', 'POST', '/__reset')));

  // steady sending
  const total = Math.round((RATE * DURATION) / 60);
  const gap = 60000 / RATE;
  let expected = 0;
  let sent = 0;
  const t0 = Date.now();
  const statSamples = [];
  const sampler = setInterval(async () => {
    try { statSamples.push(await Promise.all(ports.map((p) => request(p, 'x', 'GET', '/__stats').then((r) => r.data)))); } catch (_e) { /* ignore */ }
  }, 2000);
  console.log(`[load] ${USERS} users on ${WORKERS} workers, ${membersOf.size} chats, sending ${total} messages at ${RATE}/min for ${DURATION}s`);
  await new Promise((resolve) => {
    let n = 0;
    const tick = setInterval(() => {
      if (n >= total) { clearInterval(tick); resolve(); return; }
      n += 1;
      const ui = Math.floor(Math.random() * USERS);
      const user = names[ui];
      const conv = convsOf.get(user)[Math.floor(Math.random() * convsOf.get(user).length)];
      expected += membersOf.get(conv).length - 1;
      const body = `load ${n} ${Math.random().toString(36).slice(2, 8)}`;
      const start = Date.now();
      sentAt.set(body, start);
      request(portOf(ui), user, 'POST', '/api/chat/messages', { conversation_sync_id: conv, body })
        .then((r) => { if (r.status !== 200) errors += 1; else { sent += 1; sendMs.push(Date.now() - start); } })
        .catch(() => { errors += 1; });
    }, gap);
  });
  await new Promise((r) => setTimeout(r, 5000)); // drain
  clearInterval(sampler);
  const elapsed = (Date.now() - t0) / 1000;

  const lastStats = statSamples.length ? statSamples[statSamples.length - 1] : [];
  const peakRss = Math.max(0, ...statSamples.flat().map((s) => s.rss_mb));
  const peakPool = Math.max(0, ...statSamples.flat().map((s) => s.peak_total));
  const peakWait = Math.max(0, ...statSamples.flat().map((s) => s.peak_waiting));
  const { rows: [db] } = await admin.query(`SELECT numbackends, xact_commit FROM pg_stat_database WHERE datname = current_database()`);
  const report = {
    users: USERS, workers: WORKERS, chats: membersOf.size, duration_s: Math.round(elapsed),
    messages_sent: sent, send_errors_and_failed_reactions: errors,
    send_ms: { p50: pct(sendMs, 50), p95: pct(sendMs, 95), p99: pct(sendMs, 99), max: Math.max(0, ...sendMs) },
    delivery_ms: { p50: pct(delays, 50), p95: pct(delays, 95), p99: pct(delays, 99), max: Math.max(0, ...delays) },
    delivered: delivered, expected_deliveries: expected, delivered_pct: expected ? Math.round((delivered / expected) * 1000) / 10 : null,
    receiver_reaction_ms: { p50: pct(reactMs, 50), p95: pct(reactMs, 95), count: reactions },
    superadmin_copies: adminCopies,
    pool: { per_worker_max: parseInt(process.env.CHAT_LOAD_POOL || '10', 10), peak_in_use: peakPool, peak_waiting: peakWait },
    memory_mb: { peak_rss_per_worker: peakRss, last: lastStats.map((s) => ({ rss: s.rss_mb, heap: s.heap_mb })) },
    db_backends_now: db.numbackends
  };
  console.log(JSON.stringify(report, null, 2));
  streams.forEach((s) => s.destroy());
  kids.forEach((k) => k.kill());
  await admin.end();
  process.exit(0);
}

if (process.argv.includes('--serve')) {
  runWorker(parseInt(process.argv[process.argv.indexOf('--serve') + 1], 10)).catch((e) => { console.error(e); process.exit(1); });
} else {
  main().catch((e) => { console.error('[load] failed:', e.message); process.exit(1); });
}
