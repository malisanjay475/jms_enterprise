'use strict';

const { z } = require('zod');

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  GEMINI_API_KEY: z.string().optional(),
  LOCAL_FACTORY_ID: z.string().optional(),
  SERVER_TYPE: z.string().optional(),
  MAIN_SERVER_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  PGHOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  PGPORT: z.coerce.number().int().positive().optional(),
  DB_USER: z.string().optional(),
  PGUSER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  PGDATABASE: z.string().optional()
});

function loadConfig(env = process.env) {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  const values = parsed.data;

  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    geminiApiKey: values.GEMINI_API_KEY || '',
    localFactoryId: values.LOCAL_FACTORY_ID || null,
    serverType: values.SERVER_TYPE || '',
    mainServerUrl: values.MAIN_SERVER_URL || '',
    db: {
      host: values.DB_HOST || values.PGHOST || 'localhost',
      port: values.DB_PORT || values.PGPORT || 5432,
      user: values.DB_USER || values.PGUSER || 'postgres',
      password: values.DB_PASSWORD || values.PGPASSWORD || 'Sanjay@541##',
      database: values.DB_NAME || values.PGDATABASE || 'jpsms'
    }
  };
}

module.exports = loadConfig;
