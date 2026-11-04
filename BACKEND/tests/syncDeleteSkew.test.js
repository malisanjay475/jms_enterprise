'use strict';

const { __test } = require('../services/sync.service');
const keep = __test.shouldKeepRowOverDeletion;

const del = { deleted_at: '2026-10-23T09:23:20.889Z' };
const at = (ms) => new Date(Date.parse(del.deleted_at) + ms).toISOString();

describe('shouldKeepRowOverDeletion', () => {
  test('clock skew: row a few seconds "newer" than the delete is still deleted', () => {
    expect(keep('plan_board', { status: 'Planned', updated_at: at(316) }, del)).toBe(false);
    expect(keep('moulds', { updated_at: at(15000) }, del)).toBe(false);
  });

  test('plan_board: Stopped/Planned plan restamped hours later is still deleted', () => {
    expect(keep('plan_board', { status: 'Stopped', updated_at: at(3 * 3600e3) }, del)).toBe(false);
    expect(keep('plan_board', { status: 'PLANNED', updated_at: at(3 * 3600e3) }, del)).toBe(false);
  });

  test('plan_board: plan Running well after the delete is kept', () => {
    expect(keep('plan_board', { status: 'Running', updated_at: at(10 * 60e3) }, del)).toBe(true);
  });

  test('other tables: row edited well after the delete is kept', () => {
    expect(keep('moulds', { updated_at: at(10 * 60e3) }, del)).toBe(true);
  });

  test('missing timestamps never block a delete', () => {
    expect(keep('plan_board', { status: 'Running' }, del)).toBe(false);
    expect(keep('moulds', { updated_at: at(10 * 60e3) }, {})).toBe(false);
  });
});
