#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — Backup Restore Verification
# ============================================================
# Proves the latest backup is actually restorable. Runs on the VPS, called by
# .github/workflows/backup-restore-test.yml over SSH (or manually):
#   BACKUP_ROOT=/opt/jms-backups bash scripts/verify-backup-restore.sh
#
# Steps:
#   1. Pick the newest jms_db_*.sql.gz dump under $BACKUP_ROOT/dumps
#   2. Spin up a THROWAWAY postgres container (never touches production)
#   3. Restore the dump into it
#   4. Assert the DB has tables AND a non-trivial row count
#   5. Tear the throwaway container down (always)
#
# Exit 0 = backup verified restorable. Exit 1 = verification FAILED (alerts).
# A backup you have never restored is a hope, not a backup — this makes it real.
# ============================================================
set -uo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/jms-backups}"
DUMP_DIR="$BACKUP_ROOT/dumps"
PG_IMAGE="${PG_IMAGE:-postgres:14}"
TEST_CONTAINER="${TEST_CONTAINER:-jms-restore-test-$$}"
TEST_DB="${TEST_DB:-jms_restore_test}"
TEST_USER="${TEST_USER:-postgres}"
TEST_PASSWORD="${TEST_PASSWORD:-restore_test_pw}"
MIN_TABLES="${MIN_TABLES:-10}"
MIN_ROWS="${MIN_ROWS:-100}"

log()  { echo "[verify-restore] $*"; }
fail() { echo "[verify-restore][ERROR] $*" >&2; cleanup; exit 1; }

cleanup() {
  docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker not found."
[ -d "$DUMP_DIR" ] || fail "Dump dir '$DUMP_DIR' does not exist — no backups to verify."

DUMP="$(find "$DUMP_DIR" -name 'jms_db_*.sql.gz' -type f 2>/dev/null | sort | tail -1)"
[ -n "$DUMP" ] || fail "No jms_db_*.sql.gz dump found in $DUMP_DIR."
SIZE_KB="$(du -k "$DUMP" | cut -f1)"
[ "${SIZE_KB:-0}" -ge 5 ] || fail "Latest dump '$DUMP' is suspiciously small (${SIZE_KB} KB)."
log "Verifying latest dump: $(basename "$DUMP") (${SIZE_KB} KB)"

log "Starting throwaway postgres ($PG_IMAGE)..."
docker run -d --name "$TEST_CONTAINER" \
  -e "POSTGRES_PASSWORD=$TEST_PASSWORD" \
  -e "POSTGRES_USER=$TEST_USER" \
  -e "POSTGRES_DB=$TEST_DB" \
  "$PG_IMAGE" >/dev/null || fail "Could not start throwaway postgres container."

log "Waiting for postgres to accept connections..."
for i in $(seq 1 30); do
  if docker exec "$TEST_CONTAINER" pg_isready -U "$TEST_USER" -d "$TEST_DB" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" -eq 30 ] && fail "Postgres did not become ready in time."
done

log "Restoring dump into throwaway DB..."
if ! gunzip -c "$DUMP" | docker exec -i \
       -e "PGPASSWORD=$TEST_PASSWORD" "$TEST_CONTAINER" \
       psql -U "$TEST_USER" -d "$TEST_DB" -v ON_ERROR_STOP=0 >/dev/null 2>&1; then
  log "WARN: psql reported errors during restore (often harmless ownership/role notices). Continuing to row checks."
fi

log "Counting tables and rows..."
TABLE_COUNT="$(docker exec -e "PGPASSWORD=$TEST_PASSWORD" "$TEST_CONTAINER" \
  psql -U "$TEST_USER" -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -dc '0-9')"
TABLE_COUNT="${TABLE_COUNT:-0}"
log "Restored tables in public schema: $TABLE_COUNT"
[ "$TABLE_COUNT" -ge "$MIN_TABLES" ] || fail "Only $TABLE_COUNT tables restored (expected >= $MIN_TABLES). Backup may be incomplete."

# Sum live row estimates across all public tables (fast, uses planner stats after ANALYZE).
docker exec -e "PGPASSWORD=$TEST_PASSWORD" "$TEST_CONTAINER" \
  psql -U "$TEST_USER" -d "$TEST_DB" -c "ANALYZE" >/dev/null 2>&1 || true
ROW_EST="$(docker exec -e "PGPASSWORD=$TEST_PASSWORD" "$TEST_CONTAINER" \
  psql -U "$TEST_USER" -d "$TEST_DB" -tAc \
  "SELECT COALESCE(SUM(n_live_tup),0)::bigint FROM pg_stat_user_tables" 2>/dev/null | tr -dc '0-9')"
ROW_EST="${ROW_EST:-0}"
log "Estimated total rows across restored tables: $ROW_EST"
[ "$ROW_EST" -ge "$MIN_ROWS" ] || fail "Only ~$ROW_EST rows restored (expected >= $MIN_ROWS). Backup may be empty/corrupt."

log "SUCCESS: backup '$(basename "$DUMP")' is restorable — $TABLE_COUNT tables, ~$ROW_EST rows."
exit 0
