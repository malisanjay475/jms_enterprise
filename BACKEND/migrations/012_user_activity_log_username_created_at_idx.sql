-- Index for the Activity Monitor's "latest event per user" lookups
-- (GET /api/activity/monitor). They used DISTINCT ON over the whole
-- user_activity_log, sorting every row (1.87M on factory-1, ~2 s) on each 30 s
-- refresh; they now read one row per user from this index.
-- Built here, before the server accepts requests, so the new queries never run
-- without it (without it they are slower than the old ones: 18-57 s measured).
-- No traffic reaches the table while migrations run, so a plain CREATE INDEX is
-- safe (CONCURRENTLY is not allowed inside the migration transaction).
-- Guarded: on a fresh DB user_activity_log is created later by the inline schema
-- bootstrap, which also creates this index (registerLegacyRoutes.js).
DO $$
BEGIN
  IF to_regclass('public.user_activity_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_ual_username_created_at
      ON user_activity_log (username, created_at DESC);
  END IF;
END
$$;
