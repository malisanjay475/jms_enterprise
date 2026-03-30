-- Enable Row-Level Security (RLS) on critical operational tables
ALTER TABLE "job_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- JobCards Policy:
-- A user can only see JobCards where the factory_id matches the session variable
-- 'app.current_factory_id'. If the variable is not set (e.g., standard Prisma query without context),
-- the query returns zero rows.
CREATE POLICY "factory_isolation_jobcards" 
ON "job_cards"
FOR ALL 
USING (
   factory_id::text = current_setting('app.current_factory_id', true)
   OR 
   current_setting('app.bypass_rls', true) = 'true'
);

-- SyncQueue Policy:
CREATE POLICY "factory_isolation_syncqueue" 
ON "sync_queue"
FOR ALL 
USING (
   factory_id::text = current_setting('app.current_factory_id', true)
   OR 
   current_setting('app.bypass_rls', true) = 'true'
);

-- AuditLogs Policy:
CREATE POLICY "factory_isolation_auditlogs" 
ON "audit_logs"
FOR ALL 
USING (
   factory_id::text = current_setting('app.current_factory_id', true)
   OR 
   current_setting('app.bypass_rls', true) = 'true'
);

-- Note:
-- The NestJS Prisma Middleware will wrap queries in a transaction:
-- await prisma.$transaction([
--    prisma.$executeRaw`SET LOCAL app.current_factory_id = ${user.factoryId};`,
--    prisma.jobCard.findMany()
-- ])
