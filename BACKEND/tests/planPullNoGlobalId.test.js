'use strict';

const sync = require('../services/sync.service');

// A factory server whose plan_board has no global_id column must still save pulled plans.
async function pull(columns) {
  const sql = [];
  const client = {
    release() {},
    query: jest.fn(async (text) => {
      sql.push(String(text));
      if (String(text).includes('SELECT global_id FROM plan_board') && !columns.includes('global_id')) {
        throw new Error('column "global_id" does not exist');
      }
      if (String(text).includes('INSERT INTO plan_board')) return { rows: [{ inserted: true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    })
  };
  const pool = {
    connect: async () => client,
    query: jest.fn(async () => ({ rows: columns.map((column_name) => ({ column_name, data_type: 'text' })), rowCount: columns.length }))
  };
  sync.__test.setRuntimeForTests({ pool, SERVER_TYPE: 'LOCAL', LOCAL_FACTORY_ID: 2 });
  const stats = await sync.__test.upsertData('plan_board', [
    { plan_id: 'PLN-1', factory_id: 2, global_id: 'g-1', status: 'Planned' }
  ]);
  return { stats, sql: sql.join('\n') };
}

it('saves plans without the column, and still checks them where it exists', async () => {
  const without = await pull(['plan_id', 'factory_id', 'status']);
  expect(without.stats).toMatchObject({ created: 1, failed: 0 });
  expect(without.sql).not.toContain('global_id');

  const withColumn = await pull(['plan_id', 'factory_id', 'status', 'global_id']);
  expect(withColumn.stats).toMatchObject({ created: 1, failed: 0 });
  expect(withColumn.sql).toContain('SELECT global_id FROM plan_board');
});
