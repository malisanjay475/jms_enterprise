'use strict';

const loadConfig = require('../src/config/loadConfig');

describe('loadConfig', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5432',
    DB_USER: 'jms_v1',
    DB_PASSWORD: 'secret',
    DB_NAME: 'jms_v1',
    SERVER_TYPE: 'STANDALONE',
    LOCAL_FACTORY_ID: '1',
    SYNC_API_KEY: 'test-key'
  };

  it('loads valid config without throwing', () => {
    expect(() => loadConfig(baseEnv)).not.toThrow();
  });

  it('maps PORT to config.port as number', () => {
    const config = loadConfig({ ...baseEnv, PORT: '4000' });
    expect(config.port).toBe(4000);
  });

  it('maps DB_HOST to config.db.host', () => {
    const config = loadConfig({ ...baseEnv, DB_HOST: 'mydbhost' });
    expect(config.db.host).toBe('mydbhost');
  });

  it('maps DB_NAME to config.db.database', () => {
    const config = loadConfig({ ...baseEnv, DB_NAME: 'my_database' });
    expect(config.db.database).toBe('my_database');
  });

  it('maps NODE_ENV to config.nodeEnv', () => {
    const config = loadConfig({ ...baseEnv, NODE_ENV: 'production' });
    expect(config.nodeEnv).toBe('production');
  });

  it('throws when DB config is missing and ALLOW_LEGACY_DB_DEFAULTS not set', () => {
    const envWithoutDb = { NODE_ENV: 'test', PORT: '3000' };
    expect(() => loadConfig(envWithoutDb)).toThrow(/Missing database environment/);
  });

  it('defaults PORT to 3000 when not set', () => {
    const config = loadConfig({ ...baseEnv, PORT: undefined });
    expect(config.port).toBe(3000);
  });

  it('sets sentryDsn when SENTRY_DSN is provided', () => {
    const dsn = 'https://abc@sentry.io/123';
    const config = loadConfig({ ...baseEnv, SENTRY_DSN: dsn });
    expect(config.sentryDsn).toBe(dsn);
  });

  it('sentryDsn is empty string when SENTRY_DSN not set', () => {
    const config = loadConfig(baseEnv);
    expect(config.sentryDsn).toBe('');
  });
});
