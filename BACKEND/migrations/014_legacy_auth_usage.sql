-- Counts of API requests that still identify the user the legacy way (X-User-Name
-- header or body session.username) WITHOUT a verified login session. Read-only
-- evidence for deciding when login can be required everywhere; see
-- src/app/legacyAuthUsage.js. One row per day + endpoint + claimed user + client type.
-- Not a sync table (stays on each server). Rows older than 30 days are removed by the
-- daily retention job.
CREATE TABLE IF NOT EXISTS legacy_auth_usage (
  day        date        NOT NULL,
  method     text        NOT NULL,
  path       text        NOT NULL,
  username   text        NOT NULL,
  client     text        NOT NULL,
  hits       integer     NOT NULL DEFAULT 0,
  last_seen  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, method, path, username, client)
);
