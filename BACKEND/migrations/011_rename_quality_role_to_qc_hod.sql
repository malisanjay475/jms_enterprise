-- Rename the "Quality Manager" role's display label to "QC HOD" at the owner's request.
-- The role CODE stays 'quality', so every user already assigned it keeps their access
-- and simply shows as "QC HOD" wherever the role label is displayed (e.g. the User
-- Management role dropdown, which looks the label up by code). No user rows change.
-- Runs on MAIN and each LOCAL at startup; roles also pull-sync, so it stays consistent.
-- Guarded: on a fresh DB the `roles` table is created later by the inline schema
-- bootstrap (which already seeds 'quality' → 'QC HOD'), so only rename when it exists.
DO $$
BEGIN
  IF to_regclass('public.roles') IS NOT NULL THEN
    UPDATE roles SET label = 'QC HOD' WHERE code = 'quality';
  END IF;
END $$;
