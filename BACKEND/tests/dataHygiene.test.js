'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('data retention', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  // Fake pool: every table exists; DELETE batches return `batchSizes` in order per table.
  function makePool({ lock = true, batches = {} } = {}) {
    const calls = [];
    const remaining = Object.fromEntries(Object.entries(batches).map(([t, list]) => [t, [...list]]));
    const clientFactory = () => ({
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql);
        calls.push({ text, params });
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ ok: lock }] };
        const m = text.match(/^DELETE FROM (\w+) WHERE ctid IN/);
        if (m) {
          const next = (remaining[m[1]] || []).shift() || 0;
          return { rowCount: next, rows: [] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn()
    });
    const pool = {
      calls,
      connect: jest.fn(async () => clientFactory()),
      query: jest.fn(async (sql) => {
        const text = String(sql);
        calls.push({ text, params: [] });
        if (text.includes('to_regclass')) return { rows: [{ ok: true }] };
        if (text.startsWith('SELECT id FROM machines')) return { rows: [{ id: 7 }, { id: 9 }] };
        return { rows: [], rowCount: 0 };
      })
    };
    return pool;
  }

  it('uses the agreed retention periods by default', () => {
    const { retentionDays } = require('../src/app/dataRetention');
    expect(retentionDays()).toEqual({ notificationsRead: 90, activityLog: 180, syncDeletions: 30, machineReadings: 90 });
  });

  it('deletes in batches until a short batch, and drops notification tombstones in the same transaction', async () => {
    const { runRetentionOnce } = require('../src/app/dataRetention');
    const pool = makePool({ batches: { notifications: [5000, 1200], sync_deletions: [300] } });

    const { summary } = await runRetentionOnce(pool, { now: Date.parse('2026-09-24T00:00:00Z') });

    const notif = summary.find((s) => s.rule === 'notifications (read)');
    expect(notif).toMatchObject({ deleted: 6200, finished: true, keepDays: 90 });
    const deletes = pool.calls.filter((c) => c.text.startsWith('DELETE FROM notifications'));
    expect(deletes).toHaveLength(2);
    expect(deletes[0].text).toContain('is_read = TRUE AND created_at < $1');
    expect(deletes[0].params[0]).toBe('2026-06-26T00:00:00.000Z'); // 90 days before now
    // Tombstone clean-up follows each notification batch, scoped to this transaction's NOW().
    const tombstoneCleanups = pool.calls.filter((c) => c.text.includes("table_name = 'notifications' AND deleted_at = NOW()"));
    expect(tombstoneCleanups).toHaveLength(2);
    expect(summary.find((s) => s.rule === 'sync_deletions')).toMatchObject({ deleted: 300, keepDays: 30 });
  });

  it('trims machine readings one machine at a time (index-friendly)', async () => {
    const { runRetentionOnce } = require('../src/app/dataRetention');
    const pool = makePool({ batches: { machine_readings: [10, 0] } });

    await runRetentionOnce(pool);

    const deletes = pool.calls.filter((c) => c.text.startsWith('DELETE FROM machine_readings'));
    expect(deletes.map((d) => d.params[0])).toEqual([7, 9]);
    expect(deletes[0].text).toContain('machine_id = $1 AND recorded_at < $2');
  });

  it('does nothing when another worker holds the lock', async () => {
    const { runRetentionOnce } = require('../src/app/dataRetention');
    const pool = makePool({ lock: false });

    const result = await runRetentionOnce(pool);

    expect(result.skipped).toBeDefined();
    expect(pool.calls.some((c) => c.text.startsWith('DELETE'))).toBe(false);
  });

  it('a rule set to 0 days is never run', async () => {
    process.env.RETENTION_MACHINE_READINGS_DAYS = '0';
    try {
      const { runRetentionOnce } = require('../src/app/dataRetention');
      const pool = makePool();
      const { summary } = await runRetentionOnce(pool);
      expect(summary.find((s) => s.rule === 'machine_readings')).toMatchObject({ skipped: 'disabled' });
      expect(pool.calls.some((c) => c.text.startsWith('DELETE FROM machine_readings'))).toBe(false);
    } finally {
      delete process.env.RETENTION_MACHINE_READINGS_DAYS;
    }
  });
});

describe('daily access log', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jms-logs-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const endStream = (s) => new Promise((resolve) => s.end(resolve));

  it('writes one file per day', async () => {
    const { DailyLogStream } = require('../src/app/dailyLogStream');
    let now = new Date(2026, 8, 24, 23, 59);
    const stream = new DailyLogStream({ dir, keepDays: 14, now: () => now });
    await new Promise((r) => stream.write('first\n', r));
    now = new Date(2026, 8, 25, 0, 1);
    await new Promise((r) => stream.write('second\n', r));
    await endStream(stream);

    expect(fs.readFileSync(path.join(dir, 'access-2026-09-24.log'), 'utf8')).toBe('first\n');
    expect(fs.readFileSync(path.join(dir, 'access-2026-09-25.log'), 'utf8')).toBe('second\n');
  });

  it('deletes access logs older than keepDays, including the old unrotated access.log', () => {
    const { pruneOldLogs } = require('../src/app/dailyLogStream');
    const now = Date.parse('2026-09-24T12:00:00Z');
    const old = (now - 20 * 864e5) / 1000;
    for (const name of ['access.log', 'access-2026-09-01.log', 'access-2026-09-20.log', 'pm2-error.log']) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    fs.utimesSync(path.join(dir, 'access.log'), old, old);
    fs.utimesSync(path.join(dir, 'access-2026-09-01.log'), old, old);
    fs.utimesSync(path.join(dir, 'pm2-error.log'), old, old);

    const removed = pruneOldLogs(dir, 14, now);

    expect(removed).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(['access-2026-09-20.log', 'pm2-error.log']);
  });
});
