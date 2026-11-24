'use strict';

// Remove leaked copies of other units' plans from a LOCAL server.
//
// Until v1.197.1 MAIN sent plans that had no factory to every LOCAL server. MAIN puts the
// factory back on its own row at startup, but a LOCAL copy of another unit's plan cannot be
// corrected there (that unit's machines and orders are not on this server).
//
// Removed: plan_board rows with factory_id NULL whose machine is not in this factory's
// machine master, with no DPR entry. The delete is NOT synced (its tombstone is dropped in
// the same transaction), so MAIN and the owning unit keep the plan.
//
//   node scripts/cleanup-null-factory-plans.js            dry run, lists the rows
//   node scripts/cleanup-null-factory-plans.js --apply    deletes them (JSON backup first)
//
// Rollback: re-insert the rows from backups/null-factory-plans-<time>.json.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');

async function main() {
  const apply = process.argv.includes('--apply');
  const factoryId = Number(process.env.LOCAL_FACTORY_ID);
  if (String(process.env.SERVER_TYPE || '').toUpperCase() !== 'LOCAL' || !Number.isInteger(factoryId) || factoryId <= 0) {
    throw new Error('Run this on a LOCAL server only (SERVER_TYPE=LOCAL and LOCAL_FACTORY_ID in .env).');
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows: own } = await client.query('SELECT COUNT(*)::int AS n FROM machines WHERE factory_id = $1', [factoryId]);
    if (!own[0].n) throw new Error(`Factory ${factoryId} has no machines in the machine master; nothing is removed.`);

    const { rows } = await client.query(
      `SELECT pb.*
         FROM plan_board pb
        WHERE pb.factory_id IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM machines m
                 WHERE m.factory_id = $1
                   AND LOWER(TRIM(m.machine)) IN (LOWER(TRIM(pb.machine)), LOWER(TRIM(SPLIT_PART(pb.machine, '>', 2)))))
          AND NOT EXISTS (
                SELECT 1 FROM dpr_hourly d
                 WHERE d.plan_id = pb.plan_id AND d.factory_id IS NULL)
        ORDER BY pb.id
          FOR UPDATE`,
      [factoryId]
    );
    console.log(`${rows.length} leaked plan(s) on factory ${factoryId}:`);
    rows.forEach((r) => console.log(`  ${r.plan_id}  ${r.machine}  ${r.order_no || '-'}  ${r.status}`));

    if (!apply || !rows.length) {
      await client.query('ROLLBACK');
      if (rows.length) console.log('Dry run. Add --apply to remove them.');
      return;
    }

    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `null-factory-plans-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));

    // Keep tombstones that were there before; drop only the ones this delete writes.
    const { rows: before } = await client.query('SELECT COALESCE(MAX(id), 0) AS id FROM sync_deletions');
    const del = await client.query('DELETE FROM plan_board WHERE id = ANY($1::int[]) AND factory_id IS NULL', [rows.map((r) => r.id)]);
    await client.query(
      `DELETE FROM sync_deletions
        WHERE id > $1 AND table_name = 'plan_board' AND factory_id IS NULL
          AND (record_pk = ANY($2::text[]) OR (left(record_pk, 1) = '{' AND record_pk::jsonb->>'plan_id' = ANY($2::text[])))`,
      [before[0].id, rows.map((r) => r.plan_id)]
    );
    await client.query('COMMIT');
    console.log(`Removed ${del.rowCount}. Backup: ${file}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
