'use strict';

// "Make sure a unique index on these columns exists" instead of "create this name".
//
// Several boot paths each created their own uniquely-named index on the same column
// (idx_<t>_sync_id in the legacy bootstrap, uq_sync_id_<t> and uq_sync_conflict_<t> in the
// sync service, <t>_sync_id_key constraints from table definitions), so most sync tables
// carried 2-3 identical unique indexes (Sep-2026 audit: 94 duplicates on factory-1). ON
// CONFLICT only needs one. This skips creation when any valid, non-partial unique index
// already covers exactly these columns in this order; otherwise it creates `name`.

const PLAIN_COLUMNS_RE = /^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/i;

function parseColumns(columns) {
  const list = Array.isArray(columns) ? columns.join(',') : String(columns || '');
  if (!PLAIN_COLUMNS_RE.test(list.trim())) return null; // expressions: can't compare, just create
  return list.split(',').map((c) => c.trim().toLowerCase());
}

// `query(text, params)` must resolve to rows (array) or a pg result ({ rows }).
async function hasEquivalentUniqueIndex(query, table, columns) {
  const res = await query(
    `SELECT 1
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND i.indisunique
        AND i.indisvalid
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND ARRAY(
              SELECT a.attname::text
                FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
               ORDER BY k.ord
            ) = $2::text[]
      LIMIT 1`,
    [table, columns]
  );
  const rows = Array.isArray(res) ? res : (res && res.rows) || [];
  return rows.length > 0;
}

// Returns true when it created `name`, false when an equivalent unique index already existed.
async function ensureUniqueIndex(query, { table, columns, name }) {
  const cols = parseColumns(columns);
  if (cols && await hasEquivalentUniqueIndex(query, table, cols)) return false;
  const colSql = Array.isArray(columns) ? columns.join(', ') : columns;
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table} (${colSql})`);
  return true;
}

module.exports = { ensureUniqueIndex, hasEquivalentUniqueIndex, parseColumns };
