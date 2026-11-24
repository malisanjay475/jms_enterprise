'use strict';

// Serialises writes to one DPR machine + date + shift + hour slot.
//
// The duplicate checks ("is there already such a row?") and the INSERT that follows
// were separate statements, so two requests arriving together both saw no row and both
// inserted. withDprSlotLock runs the check and the insert in one transaction holding an
// advisory lock: the second request waits, then sees the first one's committed row.

const LOCK_WAIT = '15s';

function dprSlotKey(factoryId, machine, date, shift, slot) {
  return ['dpr-slot', factoryId ?? 1, machine, String(date ?? '').slice(0, 10), shift, slot]
    .map((v) => String(v ?? '').trim().toLowerCase()).join('|');
}

// fn receives the locked client's query function: (sql, params) => rows.
async function withDprSlotLock(pool, key, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_WAIT}'`);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { dprSlotKey, withDprSlotLock };
