'use strict';

// Change-aware response cache.
//
// For heavy read-only answers built from a few SMALL tables that change rarely.
// A cached body is reused only while every source table still has the same change
// signature: row count + sum of each row's xmin (the id of the transaction that
// last wrote the row). Any INSERT, UPDATE or DELETE changes it - from any PM2
// worker, from sync, or from a long import that commits late - so a reused answer
// is never stale and no invalidation calls are needed. Checking costs one scan of
// the source tables (~6 ms for orders + or_jr_report on factory-1) instead of a
// full rebuild.
//
// Not for big tables: the check is a full scan. pg_stat_user_tables counters were
// tested and rejected on 28-Sep-2026: PostgreSQL 14 reports them only when a
// connection goes idle, so a busy connection's writes can stay invisible.

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

function createChangeAwareCache(query, { maxEntries = 50 } = {}) {
  const entries = new Map(); // key -> { sig, text }

  // `tables` must be literal table names from code, never request input.
  async function signature(tables) {
    for (const t of tables) {
      if (!TABLE_NAME.test(t)) throw new Error(`changeAwareCache: bad table name ${t}`);
    }
    const parts = tables.map((t) => `(SELECT count(*)::text || ':' || COALESCE(SUM(xmin::text::bigint), 0)::text FROM ${t})`);
    const rows = await query(`SELECT ${parts.join(` || '/' || `)} AS sig`);
    return String((rows && rows[0] && rows[0].sig) || '');
  }

  function get(key, sig) {
    const hit = entries.get(key);
    return hit && sig && hit.sig === sig ? hit.text : undefined;
  }

  function set(key, sig, text) {
    if (!sig) return;
    if (entries.size >= maxEntries && !entries.has(key)) entries.clear();
    entries.set(key, { sig, text });
  }

  return { signature, get, set };
}

module.exports = { createChangeAwareCache };
