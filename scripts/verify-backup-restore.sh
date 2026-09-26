#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — Backup Restore Verification
# ============================================================
# Proves the latest backups are actually restorable. Runs on the VPS, called by
# .github/workflows/backup-restore-test.yml over SSH (or manually):
#   BACKUP_ROOT=/opt/jms-backups bash scripts/verify-backup-restore.sh
#
# For the newest dump of EACH kind the VPS keeps —
#   backup_*.sql.gz  (host cron, every 30 min)
#   jms_db_*.sql.gz  (scheduled cloud backup, every 6 h)
# it:
#   1. checks the gzip is intact
#   2. restores it into a THROWAWAY postgres container (never touches production)
#   3. FAILS on any psql ERROR during the restore
#   4. FAILS unless the restored DB has the same number of tables as production and
#      the key tables hold at least MIN_ROW_RATIO of production's rows (read-only
#      comparison; the dump is at most a few hours older than production)
#   5. tears the throwaway container down (always)
#
# Exit 0 = every dump verified restorable. Exit 1 = verification FAILED (alerts).
# A backup you have never restored is a hope, not a backup — this makes it real.
# ============================================================
set -uo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/jms-backups}"
DUMP_DIR="$BACKUP_ROOT/dumps"
PG_IMAGE="${PG_IMAGE:-postgres:14-alpine}"
PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-jms-enterprise-v1-db-1}"
DB_USER="${DB_USER:-jms_v1}"
DB_NAME="${DB_NAME:-jms_v1}"
KEY_TABLES="${KEY_TABLES:-orders or_jr_report plan_board dpr_hourly users factories machines}"
MIN_ROW_RATIO="${MIN_ROW_RATIO:-0.90}"
MIN_TABLES="${MIN_TABLES:-50}"
TEST_PREFIX="jms-restore-test-$$"

FAILED=0
log()  { echo "[verify-restore] $*"; }
bad()  { echo "[verify-restore][ERROR] $*" >&2; FAILED=1; }

cleanup() { docker ps -aq --filter "name=$TEST_PREFIX" | xargs -r docker rm -f >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { bad "docker not found."; exit 1; }
[ -d "$DUMP_DIR" ] || { bad "Dump dir '$DUMP_DIR' does not exist — no backups to verify."; exit 1; }

# Production baseline, read-only. If the prod DB container is not there (manual run
# elsewhere), fall back to the absolute MIN_TABLES floor only.
prod_sql() {
  docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$PROD_DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -Atc "$1" 2>/dev/null
}
PROD_TABLES="$(prod_sql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -dc '0-9')"
if [ -n "$PROD_TABLES" ]; then log "Production baseline: $PROD_TABLES tables"; else log "Production DB not reachable — using MIN_TABLES=$MIN_TABLES only"; fi

verify_dump() {
  local dump="$1" c="$TEST_PREFIX-$2"
  local size_kb; size_kb="$(du -k "$dump" | cut -f1)"
  log "=== $(basename "$dump") (${size_kb} KB, $(stat -c %y "$dump" | cut -c1-16))"
  [ "${size_kb:-0}" -ge 1024 ] || { bad "$(basename "$dump") is suspiciously small (${size_kb} KB)."; return; }
  gzip -t "$dump" 2>/dev/null || { bad "$(basename "$dump") is not a valid gzip file."; return; }

  docker run -d --name "$c" -e POSTGRES_PASSWORD=restore_test_pw -e POSTGRES_USER="$DB_USER" -e POSTGRES_DB="$DB_NAME" \
    "$PG_IMAGE" >/dev/null || { bad "Could not start throwaway postgres container."; return; }
  local ready=0
  for _ in $(seq 1 30); do
    docker exec "$c" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && { ready=1; break; }
    sleep 2
  done
  [ "$ready" = 1 ] || { bad "Throwaway postgres did not become ready."; docker rm -f "$c" >/dev/null 2>&1; return; }

  local errfile; errfile="$(mktemp)"
  local t0; t0=$(date +%s)
  gunzip -c "$dump" | docker exec -i "$c" psql -U "$DB_USER" -d "$DB_NAME" -q -v ON_ERROR_STOP=0 >/dev/null 2>"$errfile"
  local errors; errors="$(grep -c 'ERROR' "$errfile" || true)"
  log "restored in $(( $(date +%s) - t0 )) s, psql errors: ${errors:-0}"
  if [ "${errors:-0}" -gt 0 ]; then
    bad "${errors} error(s) while restoring $(basename "$dump"):"
    grep 'ERROR' "$errfile" | head -5 >&2
  fi
  rm -f "$errfile"

  r_sql() { docker exec "$c" psql -U "$DB_USER" -d "$DB_NAME" -Atc "$1" 2>/dev/null; }
  local tables; tables="$(r_sql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -dc '0-9')"
  log "tables: ${tables:-0}${PROD_TABLES:+ (production $PROD_TABLES)}"
  [ "${tables:-0}" -ge "$MIN_TABLES" ] || bad "Only ${tables:-0} tables restored (expected >= $MIN_TABLES)."
  if [ -n "$PROD_TABLES" ] && [ "${tables:-0}" -ne "$PROD_TABLES" ]; then
    bad "Restored ${tables:-0} tables but production has $PROD_TABLES."
  fi

  local t got want
  for t in $KEY_TABLES; do
    got="$(r_sql "SELECT count(*) FROM $t" | tr -dc '0-9')"
    want="$(prod_sql "SELECT count(*) FROM $t" | tr -dc '0-9')"
    log "  $t: ${got:-missing}${want:+ (production $want)}"
    [ -n "$got" ] || { bad "Table $t missing from the restored backup."; continue; }
    if [ -n "$want" ] && [ "$want" -gt 0 ]; then
      awk -v g="$got" -v w="$want" -v r="$MIN_ROW_RATIO" 'BEGIN { exit (g >= w * r) ? 0 : 1 }' \
        || bad "$t has $got rows in the backup vs $want in production (< ${MIN_ROW_RATIO} of production)."
    fi
  done
  docker rm -f "$c" >/dev/null 2>&1
}

found=0
for pattern in 'backup_*.sql.gz' 'jms_db_*.sql.gz'; do
  # shellcheck disable=SC2012
  dump="$(ls -t "$DUMP_DIR"/$pattern 2>/dev/null | head -1)"
  if [ -z "$dump" ]; then
    log "No $pattern dump found in $DUMP_DIR (skipped)."
    continue
  fi
  found=$((found + 1))
  verify_dump "$dump" "$found"
done
[ "$found" -gt 0 ] || bad "No dumps found in $DUMP_DIR at all."

if [ "$FAILED" = 0 ]; then
  log "SUCCESS: every checked backup restored cleanly and matches production."
  exit 0
fi
log "FAILED: at least one backup could not be verified — see errors above."
exit 1
