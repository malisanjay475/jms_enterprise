/*
 * backfill-dpr-colours.js
 * ------------------------------------------------------------------
 * One-time, idempotent repair for DPR hourly entries that were saved
 * WITHOUT a colour. Colourless entries leak into a separate "Default"
 * bucket in the per-colour drill-down, so a machine's real total
 * (e.g. 701) shows as a smaller per-colour figure (e.g. 460).
 *
 * Strategy (safe, deterministic):
 *   - Plan has exactly 1 configured colour  -> assign that colour to
 *     every colourless entry of the plan.
 *   - Plan has >1 configured colours        -> assign the single distinct
 *     colour already used on the SAME machine+date+shift, but only when
 *     that is unambiguous. Otherwise the entry is left for manual review.
 *   - Plan has 0 configured colours          -> left as-is (legitimately
 *     colourless; nothing to attribute to).
 *
 * DRY RUN by default. Pass --apply to write changes.
 *
 *   node scripts/backfill-dpr-colours.js            # preview only
 *   node scripts/backfill-dpr-colours.js --apply    # perform update
 * ------------------------------------------------------------------
 */
require('dotenv').config({ path: '.env' });
const path = require('path');
const loadConfig = require(path.join(__dirname, '..', 'src', 'config', 'loadConfig'));
const createDbPool = require(path.join(__dirname, '..', 'src', 'db', 'createDbPool'));

const APPLY = process.argv.includes('--apply');

// Reuse the app's own DB config so this script always targets the same database
// the server connects to (DB_* env vars), never a stale hardcoded fallback.
const pool = createDbPool(loadConfig());

function parseColourNames(colourDetails) {
  let cd = colourDetails;
  if (!cd) return [];
  if (typeof cd === 'string') {
    try { cd = JSON.parse(cd); } catch (_) { return []; }
  }
  if (!Array.isArray(cd)) return [];
  const names = [];
  for (const c of cd) {
    const n = String(
      c.colourName || c.itemColour || c.item_colour || c.colour || c.color || c.name || ''
    ).trim();
    if (n) names.push(n);
  }
  // de-duplicate, preserve order
  return [...new Set(names)];
}

async function main() {
  console.log(`\n=== DPR colour backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // 1. All colourless, non-deleted entries grouped by plan.
  const { rows: colourless } = await pool.query(`
    SELECT id, plan_id, order_no, machine, dpr_date::text AS dpr_date, shift, good_qty
    FROM dpr_hourly
    WHERE is_deleted = false
      AND (colour IS NULL OR TRIM(colour) = '')
    ORDER BY plan_id, machine, dpr_date, shift, id
  `);

  if (colourless.length === 0) {
    console.log('No colourless entries found. Nothing to do.\n');
    return;
  }

  // Group by plan_id
  const byPlan = new Map();
  for (const r of colourless) {
    const key = String(r.plan_id || '');
    if (!byPlan.has(key)) byPlan.set(key, []);
    byPlan.get(key).push(r);
  }

  const audit = ` [colour-backfill ${new Date().toISOString().slice(0, 10)}]`;
  let planned = 0;       // rows we will update
  let skippedAmbig = 0;  // rows we cannot safely attribute
  let skippedNoCfg = 0;  // rows on plans with no configured colours
  const updates = [];    // { id, colour }
  const reviewRows = []; // rows left for manual review

  for (const [planId, entries] of byPlan) {
    // Look up configured colours for this plan (id or plan_id).
    const { rows: pb } = await pool.query(
      `SELECT colour_details FROM plan_board
       WHERE CAST(id AS TEXT) = $1 OR CAST(plan_id AS TEXT) = $1 LIMIT 1`,
      [planId]
    );
    const configured = pb.length ? parseColourNames(pb[0].colour_details) : [];

    if (configured.length === 1) {
      // Single-colour plan — unambiguous.
      for (const e of entries) updates.push({ id: e.id, colour: configured[0] });
      planned += entries.length;
      continue;
    }

    if (configured.length === 0) {
      skippedNoCfg += entries.length;
      continue;
    }

    // Multi-colour plan — try same machine+date+shift disambiguation.
    for (const e of entries) {
      const { rows: sib } = await pool.query(
        `SELECT DISTINCT TRIM(colour) AS colour
         FROM dpr_hourly
         WHERE is_deleted = false
           AND plan_id = $1 AND machine = $2 AND dpr_date = $3 AND shift = $4
           AND colour IS NOT NULL AND TRIM(colour) <> ''`,
        [e.plan_id, e.machine, e.dpr_date, e.shift]
      );
      if (sib.length === 1) {
        updates.push({ id: e.id, colour: sib[0].colour });
        planned++;
      } else {
        skippedAmbig++;
        reviewRows.push({ ...e, configured: configured.join(', '), siblingColours: sib.map(s => s.colour).join(', ') || '(none)' });
      }
    }
  }

  // Report
  console.log(`Colourless entries found : ${colourless.length}`);
  console.log(`  -> will assign colour  : ${planned}`);
  console.log(`  -> skipped (no colours configured on plan) : ${skippedNoCfg}`);
  console.log(`  -> skipped (ambiguous, needs manual review): ${skippedAmbig}\n`);

  if (reviewRows.length) {
    console.log('Rows needing manual review (multi-colour plan, could not disambiguate):');
    for (const r of reviewRows.slice(0, 50)) {
      console.log(`  id=${r.id} plan=${r.plan_id} machine=${r.machine} ${r.dpr_date} ${r.shift} good=${r.good_qty} | plan colours: ${r.configured} | siblings: ${r.siblingColours}`);
    }
    if (reviewRows.length > 50) console.log(`  ...and ${reviewRows.length - 50} more`);
    console.log('');
  }

  if (!APPLY) {
    console.log('DRY RUN — no changes written. Re-run with --apply to perform the backfill.\n');
    return;
  }

  if (updates.length === 0) {
    console.log('Nothing to update.\n');
    return;
  }

  // Apply in a single transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        `UPDATE dpr_hourly
         SET colour = $2,
             remarks = COALESCE(remarks, '') || $3,
             updated_at = NOW()
         WHERE id = $1`,
        [u.id, u.colour, audit]
      );
    }
    await client.query('COMMIT');
    console.log(`APPLIED — updated ${updates.length} row(s).\n`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Backfill failed, rolled back:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
