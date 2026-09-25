'use strict';

// Daily clean-up of tables that only ever grew. Measured on factory-1 (24-Sep-2026):
// notifications 225K rows (112K unread "approval" notices), user_activity_log 1.87M rows
// (~18K heartbeats/day), sync_deletions 222K tombstones, machine_readings 1.5M rows
// (1.8 GB). On the VPS (25-Sep-2026) local_server_heartbeats was the biggest table:
// 725 MB / 694K rows, never deleted. Retention periods agreed with the owner on
// 24/25-Sep-2026; each can be
// overridden with an env var (days, 0 = never delete).
//
// Deletes run in small batches with a pause between them so they never hold long locks
// or starve the app, once a day on one worker at a time (advisory lock). Every server
// (MAIN and each LOCAL) trims its own copy by the same rule, so nothing extra travels
// over sync.
//
// "Once a day" is tracked in server_config, not by a per-process timer: every worker
// checks every 30 minutes and runs only if the last completed run is 24 h old. A timer
// in one worker never fired on the VPS (25-Sep-2026) because PM2 restarted that worker
// for memory every ~7 minutes, before its 10-minute first run.

const RETENTION_LOCK_KEY = 918273647;
const BATCH_SIZE = 5000;
const BATCH_PAUSE_MS = 200;
const MAX_RUN_MS_PER_RULE = 10 * 60 * 1000; // leftover backlog continues the next day
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const RUN_EVERY_MS = 24 * 60 * 60 * 1000;
const LAST_RUN_KEY = 'DATA_RETENTION_LAST_RUN_AT';

function readDaysEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function retentionDays() {
  return {
    notificationsRead: readDaysEnv('RETENTION_NOTIFICATIONS_READ_DAYS', 90),
    activityLog: readDaysEnv('RETENTION_ACTIVITY_LOG_DAYS', 180),
    syncDeletions: readDaysEnv('RETENTION_SYNC_DELETIONS_DAYS', 30),
    machineReadings: readDaysEnv('RETENTION_MACHINE_READINGS_DAYS', 90),
    legacyAuthUsage: readDaysEnv('RETENTION_LEGACY_AUTH_USAGE_DAYS', 30),
    localServerHeartbeats: readDaysEnv('RETENTION_LOCAL_SERVER_HEARTBEATS_DAYS', 30)
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tableExists(pool, table) {
  const r = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return r.rows[0]?.ok === true;
}

// Deletes rows matching `where` (params $1..) in batches until none are left or the
// time budget runs out. `extraSql` runs in the same transaction after each batch.
async function deleteInBatches(pool, { table, where, params, extraSql = null, deadline }) {
  let total = 0;
  for (;;) {
    if (Date.now() > deadline) return { total, finished: false };
    const client = await pool.connect();
    let removed = 0;
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${where} LIMIT ${BATCH_SIZE})`,
        params
      );
      removed = r.rowCount || 0;
      if (removed > 0 && extraSql) await client.query(extraSql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    total += removed;
    if (removed < BATCH_SIZE) return { total, finished: true };
    await sleep(BATCH_PAUSE_MS);
  }
}

const RULES = [
  {
    name: 'notifications (read)',
    table: 'notifications',
    days: (d) => d.notificationsRead,
    async run(pool, cutoff, deadline) {
      // notifications is a synced table: its delete trigger writes a sync tombstone per
      // row. Every server applies this same rule itself, so those tombstones are dropped
      // in the same transaction (they carry this transaction's NOW(), which no other
      // transaction shares) instead of fanning 100K+ deletes out through sync.
      return deleteInBatches(pool, {
        table: 'notifications',
        where: 'is_read = TRUE AND created_at < $1',
        params: [cutoff],
        extraSql: `DELETE FROM sync_deletions WHERE table_name = 'notifications' AND deleted_at = NOW()`,
        deadline
      });
    }
  },
  {
    name: 'user_activity_log',
    table: 'user_activity_log',
    days: (d) => d.activityLog,
    run: (pool, cutoff, deadline) => deleteInBatches(pool, {
      table: 'user_activity_log', where: 'created_at < $1', params: [cutoff], deadline
    })
  },
  {
    name: 'legacy_auth_usage',
    table: 'legacy_auth_usage',
    days: (d) => d.legacyAuthUsage,
    run: (pool, cutoff, deadline) => deleteInBatches(pool, {
      table: 'legacy_auth_usage', where: 'day < $1::date', params: [cutoff], deadline
    })
  },
  {
    name: 'sync_deletions',
    table: 'sync_deletions',
    days: (d) => d.syncDeletions,
    run: (pool, cutoff, deadline) => deleteInBatches(pool, {
      table: 'sync_deletions', where: 'deleted_at < $1', params: [cutoff], deadline
    })
  },
  {
    name: 'machine_readings',
    table: 'machine_readings',
    days: (d) => d.machineReadings,
    async run(pool, cutoff, deadline) {
      // One machine at a time so every batch uses the (machine_id, recorded_at) index;
      // a plain "recorded_at < $1" would scan the whole 1.8 GB table per batch.
      const machines = await pool.query('SELECT id FROM machines');
      let total = 0;
      for (const { id } of machines.rows) {
        const r = await deleteInBatches(pool, {
          table: 'machine_readings', where: 'machine_id = $1 AND recorded_at < $2', params: [id, cutoff], deadline
        });
        total += r.total;
        if (!r.finished) return { total, finished: false };
      }
      return { total, finished: true };
    }
  },
  {
    name: 'local_server_heartbeats',
    table: 'local_server_heartbeats',
    days: (d) => d.localServerHeartbeats,
    async run(pool, cutoff, deadline) {
      // Only the newest 10 per server are ever read (GET /api/local-servers/:id), so
      // those are always kept — even for a server that has been silent for longer than
      // the retention period. One server at a time so each batch uses the
      // (local_server_id, created_at DESC) index. Not a synced table: no tombstones.
      const servers = await pool.query('SELECT id FROM local_servers');
      let total = 0;
      for (const { id } of servers.rows) {
        const r = await deleteInBatches(pool, {
          table: 'local_server_heartbeats',
          where: `local_server_id = $1 AND created_at < $2 AND id NOT IN (
            SELECT id FROM local_server_heartbeats WHERE local_server_id = $1 ORDER BY created_at DESC LIMIT 10)`,
          params: [id, cutoff],
          deadline
        });
        total += r.total;
        if (!r.finished) return { total, finished: false };
      }
      return { total, finished: true };
    }
  }
];

async function readLastRunAt(client) {
  const r = await client.query('SELECT value FROM server_config WHERE key = $1', [LAST_RUN_KEY]);
  const t = Date.parse(r.rows[0]?.value || '');
  return Number.isFinite(t) ? t : null;
}

// onlyIfDue: skip unless the last completed run (any worker) is RUN_EVERY_MS old.
// The check happens under the lock, so two workers can never both decide to run.
async function runRetentionOnce(pool, { now = Date.now(), onlyIfDue = false } = {}) {
  const client = await pool.connect();
  let locked = false;
  const summary = [];
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [RETENTION_LOCK_KEY]);
    locked = lock.rows[0]?.ok === true;
    if (!locked) return { skipped: 'another worker is running retention', summary };

    if (onlyIfDue) {
      const lastRunAt = await readLastRunAt(client);
      if (lastRunAt !== null && now - lastRunAt < RUN_EVERY_MS) return { skipped: 'not due', summary };
    }

    const days = retentionDays();
    for (const rule of RULES) {
      const keepDays = rule.days(days);
      if (!keepDays) { summary.push({ rule: rule.name, skipped: 'disabled' }); continue; }
      try {
        if (!(await tableExists(pool, rule.table))) { summary.push({ rule: rule.name, skipped: 'no table' }); continue; }
        const cutoff = new Date(now - keepDays * 24 * 60 * 60 * 1000).toISOString();
        const result = await rule.run(pool, cutoff, Date.now() + MAX_RUN_MS_PER_RULE);
        summary.push({ rule: rule.name, keepDays, deleted: result.total, finished: result.finished });
      } catch (err) {
        summary.push({ rule: rule.name, error: err.message });
      }
    }
    // Recorded only after the rules ran: a worker killed mid-run leaves it unset, so
    // another worker picks the run up at its next check.
    await client.query(
      `INSERT INTO server_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [LAST_RUN_KEY, new Date(now).toISOString()]
    );
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [RETENTION_LOCK_KEY]).catch(() => {});
    client.release();
  }
  const text = summary.map((s) => s.error ? `${s.rule}: ERROR ${s.error}`
    : s.skipped ? `${s.rule}: ${s.skipped}`
      : `${s.rule}: ${s.deleted} deleted (keep ${s.keepDays}d${s.finished ? '' : ', more next run'})`).join('; ');
  console.log(`[Retention] ${text}`);
  return { summary };
}

// Every worker checks; the advisory lock + server_config stamp make sure the rules run
// once a day in total, whichever worker happens to be alive.
function startDataRetention(pool) {
  if (process.env.RETENTION_ENABLED === '0') return null;
  const tick = () => runRetentionOnce(pool, { onlyIfDue: true })
    .catch((err) => console.warn('[Retention] run failed:', err.message));
  const first = setTimeout(tick, FIRST_CHECK_DELAY_MS);
  const check = setInterval(tick, CHECK_INTERVAL_MS);
  if (first.unref) first.unref();
  if (check.unref) check.unref();
  return { stop() { clearTimeout(first); clearInterval(check); } };
}

module.exports = { startDataRetention, runRetentionOnce, retentionDays, RULES };
