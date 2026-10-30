'use strict';

const chatSignup = require('../src/modules/chat/chatSignup');
const { isPublicApi } = require('../src/app/sessionPolicy');

const { normalizeMobile, usernameFrom, suggestUsername, rateOk, recent } = chatSignup.__test;

describe('chat sign-up', () => {
  test('mobile numbers: 10 digits, +91 / 0 prefixes dropped, junk refused', () => {
    expect(normalizeMobile('98765 43210')).toBe('9876543210');
    expect(normalizeMobile('+91-98765-43210')).toBe('9876543210');
    expect(normalizeMobile('09876543210')).toBe('9876543210');
    expect(normalizeMobile('12345')).toBeNull();
    expect(normalizeMobile('1234567890')).toBeNull(); // Indian mobiles start 6-9
    expect(normalizeMobile('')).toBeNull();
  });

  test('username from the name keeps only safe characters', () => {
    expect(usernameFrom('  Ravi   Kumar ')).toBe('Ravi Kumar');
    expect(usernameFrom('Anil <script>')).toBe('Anil script');
    expect(usernameFrom('!')).toBe('');
  });

  test('suggested username: the name, else + last 4 of the mobile, else + a number', async () => {
    const taken = new Set(['ravi kumar', 'ravi kumar 3210']);
    const db = { query: jest.fn(async (_sql, [u]) => ({ rows: taken.has(u.toLowerCase()) ? [{}] : [] })) };
    expect(await suggestUsername(db, { name: 'Anil', mobile: '9876543210' })).toBe('Anil');
    taken.delete('ravi kumar 3210');
    expect(await suggestUsername(db, { name: 'Ravi Kumar', mobile: '9876543210' })).toBe('Ravi Kumar 3210');
    taken.add('ravi kumar 3210');
    expect(await suggestUsername(db, { name: 'Ravi Kumar', mobile: '9876543210' })).toBe('Ravi Kumar 2');
  });

  test('the request form is rate limited per address', () => {
    recent.clear();
    let ok = 0;
    for (let i = 0; i < 60; i++) if (rateOk('10.0.0.1')) ok++;
    expect(ok).toBe(40);
    expect(rateOk('10.0.0.2')).toBe(true);
  });

  test('sign-up, status and first password work without a session; admin routes do not', () => {
    expect(isPublicApi('/api/chat-app/signup')).toBe(true);
    expect(isPublicApi('/api/chat-app/signup/status')).toBe(true);
    expect(isPublicApi('/api/chat-app/set-password')).toBe(true);
    expect(isPublicApi('/api/chat/signups')).toBe(false);
  });
});
