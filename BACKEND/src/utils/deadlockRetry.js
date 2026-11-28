'use strict';

// Run fn(client) in a transaction. Postgres rolls back the loser of a deadlock
// (40P01) completely, so running it again is safe; any other error is thrown at once.
async function withTransactionDeadlockRetry(pool, fn, { attempts = 3, delayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (!e || e.code !== '40P01' || attempt >= attempts) throw e;
      console.warn(`[DB] deadlock (attempt ${attempt}/${attempts}), retrying:`, e.detail || e.message);
    } finally {
      client.release();
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }
}

module.exports = { withTransactionDeadlockRetry };
