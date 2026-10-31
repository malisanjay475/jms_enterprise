'use strict';

const chatProfiles = require('../src/modules/chat/chatProfiles');
const chatProfileSync = require('../src/modules/chat/chatProfileSync');

// A tiny stand-in for pg: rows come from `answer(sql, params)`, every query is recorded.
function fakePool(answer = () => []) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql: String(sql), params: params || [] });
    return { rows: answer(String(sql), params || []) || [] };
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}

const ran = (pool, re) => pool.calls.some((c) => re.test(c.sql));
const tick = () => new Promise((r) => setImmediate(r));

describe('chat profile names', () => {
  test('cleanName trims, collapses spaces, drops control characters and <>, and checks length', () => {
    expect(chatProfiles.cleanName('  Ravi    Kumar ')).toBe('Ravi Kumar');
    expect(chatProfiles.cleanName('Ravi <b>K</b>')).toBe('Ravi bK/b');
    expect(chatProfiles.cleanName('R')).toBe('');
    expect(chatProfiles.cleanName('x'.repeat(41))).toBe('');
    expect(chatProfiles.cleanName('')).toBe('');
  });

  test('shownName is the approved name, else the login', () => {
    expect(chatProfiles.shownName('ravi', 'Ravi Kumar')).toBe('Ravi Kumar');
    expect(chatProfiles.shownName('ravi', null)).toBe('ravi');
  });
});

describe('profile writes (createProfileOps)', () => {
  test('a user asking for a new name gets a pending request and admins are told', async () => {
    const pool = fakePool((sql) => {
      if (/SELECT display_name FROM chat_profiles/.test(sql)) return [{ display_name: null }];
      if (/role_code\) IN \('admin', 'superadmin'\)/.test(sql)) return [{ username: 'boss' }, { username: 'ravi' }];
      return [];
    });
    const notice = jest.fn(async () => {});
    const ops = chatProfiles.createProfileOps(pool, { uploadRoot: '/tmp', notice });
    const r = await ops.saveFields({ username: 'ravi', role: 'operator' }, { name: 'Ravi Kumar' });
    expect(r.message).toMatch(/approval/i);
    expect(ran(pool, /pending_name, pending_at\) VALUES/)).toBe(true);
    expect(ran(pool, /SET display_name = EXCLUDED/)).toBe(false);
    await tick();
    expect(notice).toHaveBeenCalledTimes(1);
    const [who, n] = notice.mock.calls[0];
    expect(who).toEqual(['boss']); // never the requester, even if an admin
    expect(n.kind).toBe('name_request');
  });

  test("a superadmin's own new name applies at once and is logged", async () => {
    const pool = fakePool((sql) => (/SELECT display_name FROM chat_profiles/.test(sql) ? [{ display_name: 'Old' }] : []));
    const ops = chatProfiles.createProfileOps(pool, { uploadRoot: '/tmp' });
    const r = await ops.saveFields({ username: 'sa', role: 'superadmin' }, { name: 'Sanjay Mali' });
    expect(r.message).toBe('Name updated.');
    expect(ran(pool, /SET display_name = EXCLUDED/)).toBe(true);
    expect(ran(pool, /INSERT INTO chat_name_history/)).toBe(true);
  });

  test('a bad name is a 400, nothing written', async () => {
    const pool = fakePool();
    const ops = chatProfiles.createProfileOps(pool, { uploadRoot: '/tmp' });
    await expect(ops.saveFields({ username: 'ravi', role: 'operator' }, { name: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(ran(pool, /INSERT INTO chat_profiles/)).toBe(false);
  });

  test('designation / department are stored with markup stripped', async () => {
    const pool = fakePool();
    const ops = chatProfiles.createProfileOps(pool, { uploadRoot: '/tmp' });
    await ops.saveFields({ username: 'ravi', role: 'operator' }, { designation: ' Senior  <i>Operator</i> ' });
    const c = pool.calls.find((x) => /INSERT INTO chat_profiles \(username_lower, designation\)/.test(x.sql));
    expect(c.params).toEqual(['ravi', 'Senior iOperator/i']);
  });

  test('only admins may approve or reject', async () => {
    const ops = chatProfiles.createProfileOps(fakePool(), { uploadRoot: '/tmp' });
    await expect(ops.decide({ username: 'ravi', role: 'operator' }, 'sita', 'approve')).rejects.toMatchObject({ status: 403 });
    await expect(ops.decide({ username: 'boss', role: 'admin' }, 'sita', 'maybe')).rejects.toMatchObject({ status: 400 });
  });

  test('approving moves the pending name to the display name and tells the person', async () => {
    const pool = fakePool((sql) => {
      if (/FOR UPDATE/.test(sql)) return [{ display_name: null, pending_name: 'Sita Devi' }];
      if (/SELECT username FROM users WHERE LOWER\(username\) = \$1/.test(sql)) return [{ username: 'Sita' }];
      if (/COUNT\(\*\)::int AS n/.test(sql)) return [{ n: 0 }];
      return [];
    });
    const notice = jest.fn(async () => {});
    const ops = chatProfiles.createProfileOps(pool, { uploadRoot: '/tmp', notice });
    const r = await ops.decide({ username: 'boss', role: 'admin' }, 'Sita', 'approve');
    expect(r.remaining).toBe(0);
    expect(ran(pool, /SET display_name = pending_name/)).toBe(true);
    const hist = pool.calls.find((x) => /INSERT INTO chat_name_history/.test(x.sql));
    expect(hist.params.slice(0, 4)).toEqual(['sita', 'Sita', 'Sita Devi', 'approved']);
    expect(notice).toHaveBeenCalledWith(['Sita'], expect.objectContaining({ kind: 'name_decision', status: 'approved' }));
  });

  test('a request already reviewed is a 404', async () => {
    const pool = fakePool((sql) => (/FOR UPDATE/.test(sql) ? [{ display_name: 'X', pending_name: null }] : []));
    const ops = chatProfiles.createProfileOps(pool, { uploadRoot: '/tmp' });
    await expect(ops.decide({ username: 'boss', role: 'admin' }, 'sita', 'reject')).rejects.toMatchObject({ status: 404 });
  });

  test('a photo that is not an image is refused', async () => {
    const ops = chatProfiles.createProfileOps(fakePool(), { uploadRoot: '/tmp' });
    await expect(ops.setPhoto({ username: 'ravi' }, Buffer.from('not an image'))).rejects.toMatchObject({ status: 415 });
  });
});

describe('look-alike names', () => {
  test('sameNameUsers asks for other active users with that shown name', async () => {
    const pool = fakePool(() => [{ username: 'sanjay2', display_name: 'Sanjay Mali' }]);
    expect(await chatProfiles.sameNameUsers(pool, ' Sanjay Mali ', 'ravi')).toEqual(['sanjay2']);
    expect(pool.calls[0].params).toEqual(['sanjay mali', 'ravi']);
    expect(await chatProfiles.sameNameUsers(pool, '', 'ravi')).toEqual([]);
  });
});

describe('profile sync on a factory LOCAL', () => {
  test('a write cannot be forwarded without a main server; it says so', async () => {
    jest.isolateModules(() => {});
    const sync = chatProfileSync.createProfileSync(fakePool(), { uploadRoot: '/tmp' });
    const saved = { url: process.env.MAIN_SERVER_URL };
    delete process.env.MAIN_SERVER_URL;
    await expect(sync.forward('saveFields', 'ravi', [{ about: 'hi' }])).rejects.toMatchObject({ status: 503 });
    if (saved.url !== undefined) process.env.MAIN_SERVER_URL = saved.url;
  });

  test('pulled name history is inserted only once', async () => {
    const pool = fakePool();
    const sync = chatProfileSync.createProfileSync(pool, { uploadRoot: '/tmp' });
    await sync.__test.applyHistory({ username_lower: 'ravi', old_name: 'ravi', new_name: 'Ravi K', status: 'approved', reviewed_by: 'boss', note: null, at: '2026-10-31T00:00:00Z' });
    const c = pool.calls[0];
    expect(c.sql).toMatch(/WHERE NOT EXISTS/);
    expect(c.params[2]).toBe('Ravi K');
  });

  test('a pulled profile with its photo removed clears the photo here', async () => {
    const pool = fakePool((sql) => (/SELECT photo_storage, photo_updated_at/.test(sql) ? [{ photo_storage: 'a.jpg', photo_updated_at: new Date() }] : []));
    const sync = chatProfileSync.createProfileSync(pool, { uploadRoot: '/tmp/nowhere' });
    await sync.__test.applyProfile({ username_lower: 'ravi', display_name: 'Ravi K', photo_updated_at: null, updated_at: new Date() });
    const up = pool.calls.find((x) => /INSERT INTO chat_profiles/.test(x.sql));
    expect(up.params[2]).toBe('Ravi K');
    expect(up.params[8]).toBeNull(); // photo_storage
    expect(up.params[10]).toBeNull(); // photo_updated_at
  });
});
