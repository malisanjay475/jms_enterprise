'use strict';

function normalizeFactoryId(value) {
  if (value === undefined || value === null || value === '') return null;

  const num = Number(String(value).trim());
  return Number.isInteger(num) && num > 0 ? num : null;
}

function getFactoryId(req) {
  const fid = req.headers['x-factory-id'];

  if (fid !== undefined) {
    const normalized = String(fid).trim().toLowerCase();
    if (normalized === 'all' || normalized === '*') return null;
    return parseInt(normalized, 10);
  }

  if (process.env.LOCAL_FACTORY_ID) return parseInt(process.env.LOCAL_FACTORY_ID, 10);
  return null;
}

function getWriteFactoryHeaderState(req) {
  const raw = req.headers['x-write-factory-id'];

  if (raw !== undefined) {
    const normalized = String(raw).trim().toLowerCase();
    return {
      requestedAll: normalized === 'all' || normalized === '*',
      factoryId: normalized === 'all' || normalized === '*' ? null : normalizeFactoryId(normalized)
    };
  }

  return {
    requestedAll: false,
    factoryId: getFactoryId(req)
  };
}

function getRequestUsername(req) {
  return String(req.headers['x-user-name'] || '').trim() || null;
}

module.exports = {
  getFactoryId,
  getRequestUsername,
  getWriteFactoryHeaderState,
  normalizeFactoryId
};
