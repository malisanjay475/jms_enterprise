/**
 * fix_misfiled_factory_orders.js — move OR/JR rows filed under the wrong factory.
 *
 * Another plant's orders (e.g. JR/JP/... = Kachigam) were imported into Dungra because the
 * ERP reported them under Dungra's factoryID. This moves `or_jr_report` and `orders` rows to
 * the factory whose plant_codes owns the OR/JR prefix (factories.plant_codes).
 *
 * Run ON a server with DB access (VPS / MAIN — LOCAL servers pull orders from MAIN):
 *   node -r dotenv/config scripts/fix_misfiled_factory_orders.js            # dry run (default)
 *   node -r dotenv/config scripts/fix_misfiled_factory_orders.js --apply    # move rows
 *   node -r dotenv/config scripts/fix_misfiled_factory_orders.js --rollback <backup.json>
 *
 * Safety:
 *   - Orders that already have plan_board rows are NOT moved (listed for manual review).
 *   - An order whose order_no already exists in the target factory is NOT moved.
 *   - --apply runs in one transaction and writes a backup JSON (ids + old factory_id)
 *     which --rollback restores.
 * DB connection from DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rollbackIdx = args.indexOf('--rollback');
const ROLLBACK_FILE = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;

const conn = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    };

// Rows whose OR/JR plant code belongs to a different factory than their factory_id.
const MISFILED_CTE = (table, noCol) => `
  SELECT t.id, t.${noCol} AS order_no, t.factory_id AS old_factory_id, pf.id AS new_factory_id
    FROM ${table} t
    JOIN factories pf
      ON UPPER(SPLIT_PART(TRIM(COALESCE(t.${noCol}, '')), '/', 2))
         = ANY(string_to_array(UPPER(REPLACE(COALESCE(pf.plant_codes, ''), ' ', '')), ','))
   WHERE pf.id <> COALESCE(t.factory_id, 0)`;

async function rollback(client) {
  const backup = JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'));
  await client.query('BEGIN');
  for (const r of backup.or_jr_report) {
    await client.query('UPDATE or_jr_report SET factory_id = $1 WHERE id = $2', [r.old_factory_id, r.id]);
  }
  for (const r of backup.orders) {
    await client.query('UPDATE orders SET factory_id = $1, updated_at = NOW() WHERE id = $2', [r.old_factory_id, r.id]);
  }
  await client.query('COMMIT');
  console.log(`Rolled back ${backup.or_jr_report.length} or_jr_report + ${backup.orders.length} orders rows.`);
}

async function main() {
  const client = new Client(conn);
  await client.connect();
  try {
    if (ROLLBACK_FILE) return await rollback(client);

    const factories = (await client.query('SELECT id, name, plant_codes FROM factories ORDER BY id')).rows;
    const fname = id => (factories.find(f => Number(f.id) === Number(id)) || {}).name || `#${id}`;

    const orjr = (await client.query(MISFILED_CTE('or_jr_report', 'or_jr_no'))).rows;
    const orders = (await client.query(`
      WITH m AS (${MISFILED_CTE('orders', 'order_no')})
      SELECT m.*,
        EXISTS (SELECT 1 FROM plan_board p
                 WHERE TRIM(p.order_no) = TRIM(m.order_no)
                   AND COALESCE(p.factory_id, 0) = COALESCE(m.old_factory_id, 0)) AS has_plans,
        EXISTS (SELECT 1 FROM orders o2
                 WHERE TRIM(o2.order_no) = TRIM(m.order_no)
                   AND COALESCE(o2.factory_id, 0) = m.new_factory_id) AS exists_in_target
      FROM m`)).rows;

    const movable = orders.filter(o => !o.has_plans && !o.exists_in_target);
    const blocked = orders.filter(o => o.has_plans || o.exists_in_target);

    const summary = {};
    for (const r of orjr) {
      const k = `${fname(r.old_factory_id)} -> ${fname(r.new_factory_id)}`;
      summary[k] = summary[k] || { or_jr_report: 0, orders: 0 };
      summary[k].or_jr_report++;
    }
    for (const r of movable) {
      const k = `${fname(r.old_factory_id)} -> ${fname(r.new_factory_id)}`;
      summary[k] = summary[k] || { or_jr_report: 0, orders: 0 };
      summary[k].orders++;
    }
    console.log('Misfiled rows to move:');
    console.table(summary);
    if (blocked.length) {
      console.log(`\n${blocked.length} order(s) NOT moved (review manually):`);
      for (const b of blocked) {
        console.log(`  ${b.order_no}  in ${fname(b.old_factory_id)}  ${b.has_plans ? '[has plans]' : ''}${b.exists_in_target ? '[already in target]' : ''}`);
      }
    }

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to move the rows.');
      return;
    }

    const backupFile = path.join(__dirname, `misfiled-orders-backup-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
      or_jr_report: orjr.map(r => ({ id: r.id, old_factory_id: r.old_factory_id })),
      orders: movable.map(r => ({ id: r.id, old_factory_id: r.old_factory_id })),
    }, null, 2));

    await client.query('BEGIN');
    for (const r of orjr) {
      await client.query('UPDATE or_jr_report SET factory_id = $1 WHERE id = $2', [r.new_factory_id, r.id]);
    }
    for (const r of movable) {
      await client.query('UPDATE orders SET factory_id = $1, updated_at = NOW() WHERE id = $2', [r.new_factory_id, r.id]);
    }
    await client.query('COMMIT');
    console.log(`\nMoved ${orjr.length} or_jr_report + ${movable.length} orders rows.`);
    console.log(`Rollback: node -r dotenv/config scripts/fix_misfiled_factory_orders.js --rollback "${backupFile}"`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
