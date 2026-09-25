'use strict';

// Minimum length for NEW or CHANGED passwords. Existing passwords keep working;
// the rule applies when a password is set. PASSWORD_MIN_LENGTH in .env overrides
// the default of 8 (never below 4).
function passwordMinLength() {
  return Math.max(4, Number.parseInt(process.env.PASSWORD_MIN_LENGTH || '', 10) || 8);
}

/** Returns an error message when the password is too short, otherwise null. */
function passwordLengthError(password) {
  const min = passwordMinLength();
  if (String(password || '').length >= min) return null;
  return `Password must be at least ${min} characters.`;
}

module.exports = { passwordMinLength, passwordLengthError };
