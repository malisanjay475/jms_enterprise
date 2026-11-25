'use strict';

const sync = require('../services/sync.service');

const dup = () => Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'users_username_key' });

function setup(SERVER_TYPE, { retryFails = false } = {}) {
  let inserts = 0;
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      const text = String(sql);
      if (text.includes('INSERT INTO users')) {
        inserts += 1;
        if (inserts === 1 || retryFails) throw dup();
        return { rows: [{ inserted: true }] };
      }
      if (text.includes('UPDATE users SET username')) return { rows: [{ id: 125 }] };
      return { rows: [] };
    })
  };
  const pool = {
    connect: async () => client,
    query: jest.fn(async () => ({ rows: ['id', 'username', 'updated_at'].map((column_name) => ({ column_name })), rowCount: 3 }))
  };
  sync.__test.setRuntimeForTests({ pool, SERVER_TYPE, LOCAL_FACTORY_ID: 1 });
  return client;
}
const sqlOf = (client) => client.query.mock.calls.map((c) => String(c[0])).join('\n');
const row = () => ({ id: 128, username: 'U1 L2', updated_at: '2026-11-25T08:39:26Z' });

describe('a user re-created on MAIN', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('replaces the old copy on a LOCAL, which is switched off and not deleted', async () => {
    const client = setup('LOCAL');
    const stats = await sync.__test.upsertData('users', [row()]);
    expect(stats).toMatchObject({ created: 1, failed: 0 });
    const move = client.query.mock.calls.find((c) => String(c[0]).includes('UPDATE users SET username'));
    expect(move[1]).toEqual(['U1 L2', 128]);
    expect(move[0]).toContain('is_active = FALSE');
    expect(move[0]).not.toContain('updated_at');
    expect(sqlOf(client)).not.toMatch(/DELETE FROM users/);
  });

  it('undoes the rename when the row still cannot be saved', async () => {
    const client = setup('LOCAL', { retryFails: true });
    expect(await sync.__test.upsertData('users', [row()])).toMatchObject({ failed: 1 });
    expect(sqlOf(client)).toContain('ROLLBACK TO SAVEPOINT sync_username');
  });

  it('MAIN never renames its own users', async () => {
    const client = setup('MAIN');
    expect(await sync.__test.upsertData('users', [row()])).toMatchObject({ failed: 1 });
    expect(sqlOf(client)).not.toContain('UPDATE users SET username');
  });
});
