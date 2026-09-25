'use strict';

const bcrypt = require('bcryptjs');

// Old accounts once stored passwords as plain text, and /api/login compared them
// directly (then re-hashed on the next successful login). Every password-writing path
// now stores a bcrypt hash and, on 25-Sep-2026, all 60 accounts were already hashed, so
// login no longer accepts plain text. This one-time pass hashes any plain-text password
// that is still left (e.g. restored from an old backup) so that account keeps working.
// It runs at startup, touches only rows that are not already bcrypt hashes, and is a
// no-op when there are none.
async function hashLegacyPlaintextPasswords(pool, { rounds = 12, log = console } = {}) {
  const { rows } = await pool.query(
    `SELECT id, password FROM users
      WHERE password IS NOT NULL AND password <> '' AND password NOT LIKE '$2%'`
  );
  let upgraded = 0;
  for (const row of rows) {
    const hash = await bcrypt.hash(String(row.password), rounds);
    // Guarded on the old value so a password changed meanwhile is never overwritten.
    const result = await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 AND password = $3`,
      [hash, row.id, row.password]
    );
    upgraded += result.rowCount || 0;
  }
  if (upgraded) log.log(`[Security] Hashed ${upgraded} legacy plain-text password(s).`);
  return upgraded;
}

module.exports = { hashLegacyPlaintextPasswords };
