-- Rename the "Quality Manager" role's display label to "QC HOD" at the owner's request.
-- The role CODE stays 'quality', so every user already assigned it keeps their access
-- and simply shows as "QC HOD" wherever the role label is displayed (e.g. the User
-- Management role dropdown, which looks the label up by code). No user rows change.
-- Runs on MAIN and each LOCAL at startup; roles also pull-sync, so it stays consistent.
UPDATE roles SET label = 'QC HOD' WHERE code = 'quality';
