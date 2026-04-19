#!/usr/bin/env bash
set -euo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: missing required environment variable: $name" >&2
    exit 1
  fi
}

choose_compose() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi

  if docker-compose version >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi

  echo "ERROR: docker compose not found on VPS." >&2
  exit 1
}

wait_for_app_health() {
  local compose_cmd="$1"
  local compose_file="$2"
  local project_name="$3"
  local attempts="${4:-36}"
  local sleep_seconds="${5:-10}"

  for ((i = 1; i <= attempts; i++)); do
    local container_id
    container_id="$($compose_cmd -p "$project_name" -f "$compose_file" ps -q app 2>/dev/null || true)"

    if [[ -z "$container_id" ]]; then
      echo "[staging-refresh] waiting for app container id (${i}/${attempts})"
      sleep "$sleep_seconds"
      continue
    fi

    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    echo "[staging-refresh] app container status: ${status:-unknown} (${i}/${attempts})"

    if [[ "$status" == "healthy" ]]; then
      return 0
    fi

    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      break
    fi

    sleep "$sleep_seconds"
  done

  return 1
}

require_var DEPLOY_PROJECT
require_var DEPLOY_COMPOSE_FILE

DC="$(choose_compose)"

LIVE_DB_CONTAINER="${LIVE_DB_CONTAINER:-jpsms-db}"
LIVE_DB_USER="${LIVE_DB_USER:-postgres}"
LIVE_DB_NAME="${LIVE_DB_NAME:-jpsms}"
STAGING_DB_USER="${STAGING_DB_USER:-${DB_USER:-jms_v1}}"
STAGING_DB_NAME="${STAGING_DB_NAME:-${DB_NAME:-jms_v1}}"
STAGING_HTTP_PORT="${STAGING_HTTP_PORT:-${V1_HTTP_PORT:-9093}}"

timestamp="$(date +%Y%m%d-%H%M%S)"
refresh_root=".deploy/staging-refresh"
work_dir="${refresh_root}/${timestamp}"
mkdir -p "$work_dir"

staging_db_container="$($DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" ps -q db 2>/dev/null || true)"
if [[ -z "$staging_db_container" ]]; then
  echo "ERROR: staging db container not found for project ${DEPLOY_PROJECT}" >&2
  exit 1
fi

staging_app_container="$($DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" ps -q app 2>/dev/null || true)"
if [[ -z "$staging_app_container" ]]; then
  echo "ERROR: staging app container not found for project ${DEPLOY_PROJECT}" >&2
  exit 1
fi

echo "[staging-refresh] source live db: ${LIVE_DB_CONTAINER}/${LIVE_DB_NAME}"
echo "[staging-refresh] target staging db container: ${staging_db_container}"
echo "[staging-refresh] refresh workspace: ${work_dir}"

python3 - "$LIVE_DB_CONTAINER" "$LIVE_DB_USER" "$LIVE_DB_NAME" "$staging_db_container" "$STAGING_DB_USER" "$STAGING_DB_NAME" "$work_dir" <<'PY'
import json
import pathlib
import subprocess
import sys

live_container, live_user, live_db, staging_container, staging_user, staging_db, work_dir = sys.argv[1:]
work = pathlib.Path(work_dir)

SQL = """
select c.relname as table_name,
       a.attname as column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as type_name
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attnum
"""

def fetch_schema(container: str, user: str, db: str) -> dict[str, list[tuple[str, str]]]:
    cmd = [
        "docker", "exec", container,
        "psql", "-U", user, "-d", db,
        "-AtF", "|", "-c", SQL,
    ]
    out = subprocess.check_output(cmd, text=True)
    data: dict[str, list[tuple[str, str]]] = {}
    for raw in out.splitlines():
        table_name, column_name, type_name = raw.split("|", 2)
        data.setdefault(table_name, []).append((column_name, type_name))
    return data

live = fetch_schema(live_container, live_user, live_db)
staging = fetch_schema(staging_container, staging_user, staging_db)

staging_only_tables = sorted(set(staging) - set(live))
(work / "staging_only_tables.txt").write_text("\n".join(staging_only_tables) + ("\n" if staging_only_tables else ""), encoding="utf-8")

statements: list[str] = []
for table_name in sorted(set(live) & set(staging)):
    live_cols = {name for name, _ in live[table_name]}
    for column_name, type_name in staging[table_name]:
        if column_name not in live_cols:
            statements.append(
                f'ALTER TABLE public."{table_name}" ADD COLUMN IF NOT EXISTS "{column_name}" {type_name};'
            )

(work / "restore_staging_columns.sql").write_text("\n".join(statements) + ("\n" if statements else ""), encoding="utf-8")

summary = {
    "staging_only_tables": staging_only_tables,
    "missing_column_count": len(statements),
}
(work / "schema_diff_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
PY

echo "[staging-refresh] backing up current staging database"
docker exec "$staging_db_container" pg_dump -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -Fc > "${work_dir}/staging-before-refresh.dump"

echo "[staging-refresh] dumping live production database"
docker exec "$LIVE_DB_CONTAINER" pg_dump -U "$LIVE_DB_USER" -d "$LIVE_DB_NAME" --no-owner --no-privileges > "${work_dir}/live-production.sql"

staging_table_args=()
if [[ -s "${work_dir}/staging_only_tables.txt" ]]; then
  while IFS= read -r table_name; do
    [[ -z "$table_name" ]] && continue
    staging_table_args+=("-t" "public.${table_name}")
  done < "${work_dir}/staging_only_tables.txt"
fi

if (( ${#staging_table_args[@]} > 0 )); then
  echo "[staging-refresh] preserving staging-only tables"
  docker exec "$staging_db_container" pg_dump -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" --schema-only "${staging_table_args[@]}" > "${work_dir}/staging-only-schema.sql"
  docker exec "$staging_db_container" pg_dump -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" --data-only --inserts "${staging_table_args[@]}" > "${work_dir}/staging-only-data.sql"
else
  : > "${work_dir}/staging-only-schema.sql"
  : > "${work_dir}/staging-only-data.sql"
fi

echo "[staging-refresh] stopping staging app"
$DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" stop app

cleanup() {
  echo "[staging-refresh] ensuring staging app is running"
  $DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" up -d app >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[staging-refresh] resetting staging public schema"
cat <<SQL | docker exec -i "$staging_db_container" psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO ${STAGING_DB_USER};
GRANT ALL ON SCHEMA public TO public;
SQL

echo "[staging-refresh] restoring live production dump into staging"
cat "${work_dir}/live-production.sql" | docker exec -i "$staging_db_container" psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1

if [[ -s "${work_dir}/staging-only-schema.sql" ]]; then
  echo "[staging-refresh] restoring staging-only table schema"
  cat "${work_dir}/staging-only-schema.sql" | docker exec -i "$staging_db_container" psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1
fi

if [[ -s "${work_dir}/restore_staging_columns.sql" ]]; then
  echo "[staging-refresh] restoring staging-only columns on shared tables"
  cat "${work_dir}/restore_staging_columns.sql" | docker exec -i "$staging_db_container" psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1
fi

if [[ -s "${work_dir}/staging-only-data.sql" ]]; then
  echo "[staging-refresh] restoring staging-only table data"
  cat "${work_dir}/staging-only-data.sql" | docker exec -i "$staging_db_container" psql -U "$STAGING_DB_USER" -d "$STAGING_DB_NAME" -v ON_ERROR_STOP=1
fi

echo "[staging-refresh] starting staging app"
$DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" up -d app

if ! wait_for_app_health "$DC" "$DEPLOY_COMPOSE_FILE" "$DEPLOY_PROJECT" 36 10; then
  echo "[staging-refresh] app did not become healthy after refresh" >&2
  $DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" logs --tail=200 app || true
  exit 1
fi

echo "[staging-refresh] verifying staging health endpoint"
curl -fsS "http://127.0.0.1:${STAGING_HTTP_PORT}/health" > "${work_dir}/health.json"
curl -fsS "http://127.0.0.1:${STAGING_HTTP_PORT}/api/health" > "${work_dir}/api-health.json"

printf '%s\n' "${work_dir}/staging-before-refresh.dump" > "${refresh_root}/last_staging_backup"
printf '%s\n' "${work_dir}" > "${refresh_root}/last_refresh_run"

echo "[staging-refresh] completed successfully"
echo "[staging-refresh] staging backup: ${work_dir}/staging-before-refresh.dump"
echo "[staging-refresh] health snapshot: ${work_dir}/health.json"
