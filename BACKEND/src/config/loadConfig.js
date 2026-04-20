'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const RUNTIME_RELEASE_PATH = path.resolve(__dirname, '..', '..', 'runtime-release.json');

function emptyStringToUndefined(value) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  return value;
}

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  GEMINI_API_KEY: z.string().optional(),
  APP_GIT_SHA: z.string().optional(),
  ALLOW_LEGACY_DB_DEFAULTS: z.string().optional(),
  LOCAL_FACTORY_ID: z.string().optional(),
  SERVER_TYPE: z.string().optional(),
  MAIN_SERVER_URL: z.string().optional(),
  LOCAL_SERVER_AGENT_ENABLED: z.string().optional(),
  LOCAL_SERVER_NODE_ID: z.string().optional(),
  LOCAL_SERVER_NODE_KEY: z.string().optional(),
  LOCAL_SERVER_PUBLIC_IP: z.string().optional(),
  LOCAL_SERVER_HEARTBEAT_INTERVAL_MS: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional()
  ),
  DB_HOST: z.string().optional(),
  PGHOST: z.string().optional(),
  DB_PORT: z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().optional()),
  PGPORT: z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().optional()),
  DB_USER: z.string().optional(),
  PGUSER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  PGDATABASE: z.string().optional()
});

function hasExplicitDbConfig(values) {
  return Boolean(
    values.DB_HOST ||
    values.PGHOST ||
    values.DB_PORT ||
    values.PGPORT ||
    values.DB_USER ||
    values.PGUSER ||
    values.DB_PASSWORD ||
    values.PGPASSWORD ||
    values.DB_NAME ||
    values.PGDATABASE
  );
}

function readRuntimeRelease() {
  try {
    if (!fs.existsSync(RUNTIME_RELEASE_PATH)) return {};
    return JSON.parse(fs.readFileSync(RUNTIME_RELEASE_PATH, 'utf8'));
  } catch (error) {
    return {};
  }
}

function loadConfig(env = process.env) {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  const values = parsed.data;
  const runtimeRelease = readRuntimeRelease();
  const allowLegacyDbDefaults = ['1', 'true', 'yes'].includes(
    String(values.ALLOW_LEGACY_DB_DEFAULTS || '').toLowerCase()
  );
  const explicitDbConfig = hasExplicitDbConfig(values);

  if (!explicitDbConfig && !allowLegacyDbDefaults) {
    throw new Error(
      'Missing database environment. Create BACKEND/.env from BACKEND/.env.local-v1.example ' +
      'and set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME. ' +
      'Legacy jpsms defaults are now disabled to prevent connecting to the wrong database.'
    );
  }

  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    geminiApiKey: values.GEMINI_API_KEY || '',
    appGitSha: runtimeRelease.commit || values.APP_GIT_SHA || '',
    localFactoryId: values.LOCAL_FACTORY_ID || null,
    serverType: values.SERVER_TYPE || '',
    mainServerUrl: values.MAIN_SERVER_URL || '',
    localServer: {
      agentEnabled: values.LOCAL_SERVER_AGENT_ENABLED || '',
      nodeId: values.LOCAL_SERVER_NODE_ID || '',
      nodeKey: values.LOCAL_SERVER_NODE_KEY || '',
      publicIp: values.LOCAL_SERVER_PUBLIC_IP || '',
      heartbeatIntervalMs: values.LOCAL_SERVER_HEARTBEAT_INTERVAL_MS || null
    },
    db: {
      host: values.DB_HOST || values.PGHOST || 'localhost',
      port: values.DB_PORT || values.PGPORT || 5432,
      user: values.DB_USER || values.PGUSER || (allowLegacyDbDefaults ? 'postgres' : 'jms_v1'),
      password: values.DB_PASSWORD || values.PGPASSWORD || (allowLegacyDbDefaults ? 'Sanjay@541##' : ''),
      database: values.DB_NAME || values.PGDATABASE || (allowLegacyDbDefaults ? 'jpsms' : 'jms_v1')
    }
  };
}

module.exports = loadConfig;
