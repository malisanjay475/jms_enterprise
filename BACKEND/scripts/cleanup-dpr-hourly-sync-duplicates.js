#!/usr/bin/env node
'use strict';

/**
 * Remove duplicate dpr_hourly rows on a LOCAL server that sync created.
 *
 * Symptom: on a LOCAL, produced qty is ~2x MAIN's and plan balances on the Machine
 * Timeline go negative ("OVER"). Cause: the same hourly entry exists twice locally —
 * the LOCAL's own row (a global_id MAIN does not know) and the copy pulled back from
 * MAIN (MAIN's global_id). Both share the natural key and the exact created_at.
 *
 * What it does (LOCAL only):
 *   1. Pulls the full list of this factory's dpr_hourly global_ids from MAIN (read-only,
 *      the same /api/sync/pull endpoint the sync uses).
 *   2. Groups local live rows by natural key + created_at (ms). In a group that holds
 *      at least one row MAIN has AND rows MAIN does not have, the rows MAIN does not
 *      have are the duplicates. Nothing else is touched: rows MAIN lacks with no twin
 *      (e.g. entries not yet pushed) stay, and so do groups where MAIN has every row.
 *   3. --apply: backs the rows up (table dpr_hourly_dup_backup_<stamp> + a JSON file),
 *      moves QC links (qc_verifications / qc_holds) to the kept row, then deletes the
 *      duplicates in one transaction. Their delete tombstones name global_ids MAIN does
 *      not have, so MAIN loses nothing.
 *
 * Usage (from the BACKEND folder of the LOCAL server):
 *   node scripts/cleanup-dpr-hourly-sync-duplicates.js            # dry run, changes nothing
 *   node scripts/cleanup-dpr-hourly-sync-duplicates.js --apply    # back up + delete
 *
 * Rollback (restores every deleted row exactly):
 *   INSERT INTO dpr_hourly SELECT * FROM dpr_hourly_dup_backup_<stamp>;
 *   DELETE FROM sync_deletions WHERE table_name = 'dpr_hourly'
 *     AND record_pk IN (SELECT global_id::text FROM dpr_hourly_dup_backup_<stamp>);
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  port: process.env.DB_PORT || process.env.PGPORT || 5432,
  user: process.env.DB_USER || process.env.PGUSER,
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
  database: process.env.DB_NAME || process.env.PGDATABASE
});

async function serverConfig() {
  const r = await pool.query(`SELECT key, value FROM server_config
                              WHERE key IN ('SERVER_TYPE','MAIN_SERVER_URL','LOCAL_FACTORY_ID','SYNC_API_KEY')`);
  const cfg = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  return {
    serverType: process.env.SERVER_TYPE || cfg.SERVER_TYPE || '',
    mainUrl: String(cfg.MAIN_SERVER_URL || process.env.MAIN_SERVER_URL || '').replace(/\/+$/, ''),
    factoryId: parseInt(cfg.LOCAL_FACTORY_ID || process.env.LOCAL_FACTORY_ID, 10),
    apiKey: process.env.SYNC_API_KEY || cfg.SYNC_API_KEY || ''
  };
}

async function fetchMainGlobalIds({ mainUrl, factoryId, apiKey }) {
  const ids = new Set();
  let afterId = null;
  for (let page = 1; ; page++) {
    let url = `${mainUrl}/api/sync/pull?table=dpr_hourly&since=${encodeURIComponent('1970-01-01T00:00:00.000Z')}&factoryId=${factoryId}`;
    if (afterId !== null) url += `&afterId=${afterId}`;
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(url, { headers: { 'x-sync-api-key': apiKey } });
        if (res.ok) break;
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        if (attempt >= 4) throw new Error(`MAIN pull page ${page} failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    const rows = (await res.json()).data || [];
    for (const r of rows) if (r.global_id) ids.add(String(r.global_id).toLowerCase());
    if (page % 20 === 0) console.log(`  ...${ids.size} MAIN rows so far`);
    if (rows.length < 1000) break;
    const lastId = Math.max(...rows.map((r) => Number(r.id) || 0));
    if (afterId !== null && lastId <= afterId) break;
    afterId = lastId;
  }
  return ids;
}

async function columnsOf(table) {
  const r = await pool.query(`SELECT column_name FROM information_schema.columns
                              WHERE table_schema='public' AND table_name=$1`, [table]);
  return new Set(r.rows.map((x) => x.column_name));
}

(async () => {
  const cfg = await serverConfig();
  console.log(`Server: ${cfg.serverType || '?'} | factory ${cfg.factoryId} | MAIN ${cfg.mainUrl || '?'} | mode ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (String(cfg.serverType).toUpperCase() !== 'LOCAL') throw new Error('Run this only on a LOCAL server.');
  if (!cfg.mainUrl || !cfg.factoryId || !cfg.apiKey) throw new Error('MAIN_SERVER_URL / LOCAL_FACTORY_ID / SYNC_API_KEY missing.');

  console.log('Reading MAIN dpr_hourly global_ids (read-only)...');
  const mainIds = await fetchMainGlobalIds(cfg);
  console.log(`MAIN has ${mainIds.size} dpr_hourly rows for factory ${cfg.factoryId}.`);

  const cols = await columnsOf('dpr_hourly');
  const keyCols = ['machine', 'dpr_date', 'shift', 'hour_slot', 'plan_id', 'colour', 'entry_type'].filter((c) => cols.has(c));
  const local = (await pool.query(
    `SELECT id, global_id::text AS global_id, good_qty, plan_id,
            concat_ws('|', ${keyCols.map((c) => `COALESCE(${c}::text, '')`).join(', ')},
                      to_char(date_trunc('milliseconds', created_at), 'YYYY-MM-DD HH24:MI:SS.MS')) AS k
       FROM dpr_hourly
      WHERE COALESCE(is_deleted, false) = false
        AND (factory_id = $1 OR factory_id IS NULL)`, [cfg.factoryId])).rows;

  const onMainLocal = local.filter((r) => mainIds.has(String(r.global_id).toLowerCase())).length;
  console.log(`LOCAL has ${local.length} live rows; ${onMainLocal} of them are on MAIN.`);
  // Safety: if MAIN knows almost none of our rows the pull was incomplete — stop.
  if (mainIds.size === 0 || onMainLocal < local.length * 0.3) {
    throw new Error('MAIN returned too few matching rows — aborting, nothing changed.');
  }

  const groups = new Map();
  for (const r of local) {
    if (!groups.has(r.k)) groups.set(r.k, []);
    groups.get(r.k).push(r);
  }
  const remove = []; // { row, keep }
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const onMain = rows.filter((r) => mainIds.has(String(r.global_id).toLowerCase()));
    const extra = rows.filter((r) => !mainIds.has(String(r.global_id).toLowerCase()));
    if (!onMain.length || !extra.length) continue;
    const keep = onMain.sort((a, b) => a.id - b.id)[0];
    for (const r of extra) remove.push({ row: r, keep });
  }

  const qty = remove.reduce((s, x) => s + Number(x.row.good_qty || 0), 0);
  const byPlan = {};
  for (const { row } of remove) byPlan[row.plan_id || '(none)'] = (byPlan[row.plan_id || '(none)'] || 0) + Number(row.good_qty || 0);
  console.log(`\nDuplicates to remove: ${remove.length} rows (good_qty ${qty}).`);
  console.log('Top plans by duplicated qty:');
  console.table(Object.entries(byPlan).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([plan, q]) => ({ plan, dup_good_qty: q })));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply to back up and remove these rows.');
    return;
  }
  if (!remove.length) { console.log('Nothing to remove.'); return; }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const backupTable = `dpr_hourly_dup_backup_${stamp}`;
  const ids = remove.map((x) => x.row.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE ${backupTable} AS SELECT * FROM dpr_hourly WHERE id = ANY($1::bigint[])`, [ids]);
    const backupRows = (await client.query(`SELECT * FROM ${backupTable}`)).rows;
    fs.writeFileSync(path.join(__dirname, '..', `${backupTable}.json`), JSON.stringify(backupRows));

    // Move QC links from each removed row to the row that stays.
    let qcMoved = 0;
    for (const qcTable of ['qc_verifications', 'qc_holds']) {
      const qcCols = await columnsOf(qcTable);
      if (!qcCols.has('dpr_entry_id')) continue;
      for (const { row, keep } of remove) {
        await client.query('SAVEPOINT qc_move');
        try {
          const r = qcCols.has('dpr_global_id')
            ? await client.query(
              `UPDATE ${qcTable} SET dpr_entry_id = $1, dpr_global_id = $2::uuid
                WHERE dpr_entry_id = $3 OR dpr_global_id = $4::uuid`,
              [keep.id, keep.global_id, row.id, row.global_id])
            : await client.query(`UPDATE ${qcTable} SET dpr_entry_id = $1 WHERE dpr_entry_id = $2`, [keep.id, row.id]);
          qcMoved += r.rowCount;
          await client.query('RELEASE SAVEPOINT qc_move');
        } catch (e) {
          // The kept row already has its own QC record — leave this one as it is.
          await client.query('ROLLBACK TO SAVEPOINT qc_move');
        }
      }
    }

    const del = await client.query(
      `DELETE FROM dpr_hourly WHERE id = ANY($1::bigint[]) AND NOT (global_id::text = ANY($2::text[]))`,
      [ids, [...mainIds]]
    );
    await client.query('COMMIT');
    console.log(`\nDONE. Deleted ${del.rowCount} duplicate rows; ${qcMoved} QC link(s) moved.`);
    console.log(`Backup: table ${backupTable} and file ${backupTable}.json in the BACKEND folder.`);
    console.log('Rollback:');
    console.log(`  INSERT INTO dpr_hourly SELECT * FROM ${backupTable};`);
    console.log(`  DELETE FROM sync_deletions WHERE table_name='dpr_hourly' AND record_pk IN (SELECT global_id::text FROM ${backupTable});`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
})()
  .catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
