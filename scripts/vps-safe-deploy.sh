#!/usr/bin/env bash
set -euo pipefail

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: missing required environment variable: $name" >&2
    exit 1
  fi
}

write_env_file() {
  local image_ref="$1"

  cat > .env <<EOF
APP_IMAGE=${image_ref}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
V1_HTTP_PORT=${V1_HTTP_PORT}
GEMINI_API_KEY=${GEMINI_API_KEY:-}
APP_GIT_SHA=${DEPLOY_GIT_SHA:-}
SERVER_TYPE=${SERVER_TYPE:-MAIN}
MAIN_SERVER_URL=${MAIN_SERVER_URL:-}
LOCAL_FACTORY_ID=${LOCAL_FACTORY_ID:-}
SYNC_API_KEY=${SYNC_API_KEY:-}
LOCAL_SERVER_AGENT_ENABLED=${LOCAL_SERVER_AGENT_ENABLED:-}
LOCAL_SERVER_NODE_ID=${LOCAL_SERVER_NODE_ID:-}
LOCAL_SERVER_NODE_KEY=${LOCAL_SERVER_NODE_KEY:-}
LOCAL_SERVER_PUBLIC_IP=${LOCAL_SERVER_PUBLIC_IP:-}
LOCAL_SERVER_HEARTBEAT_INTERVAL_MS=${LOCAL_SERVER_HEARTBEAT_INTERVAL_MS:-}
AUTO_IMPORT_DB_PATH=${AUTO_IMPORT_DB_PATH:-}
AUTO_IMPORT_DB_FORCE=${AUTO_IMPORT_DB_FORCE:-0}
EOF
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
      echo "[deploy] waiting for app container id (${i}/${attempts})"
      sleep "$sleep_seconds"
      continue
    fi

    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    echo "[deploy] app container status: ${status:-unknown} (${i}/${attempts})"

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

require_var DEPLOY_PROJECT
require_var DEPLOY_COMPOSE_FILE
require_var APP_IMAGE
require_var DB_USER
require_var DB_PASSWORD
require_var DB_NAME
require_var V1_HTTP_PORT

DC="$(choose_compose)"
DEPLOY_META_DIR=".deploy"
mkdir -p "$DEPLOY_META_DIR"

PREVIOUS_IMAGE=""
if [[ -f "$DEPLOY_META_DIR/last_successful_app_image" ]]; then
  PREVIOUS_IMAGE="$(tr -d '\r' < "$DEPLOY_META_DIR/last_successful_app_image")"
elif [[ -f .env ]]; then
  PREVIOUS_IMAGE="$(sed -n 's/^APP_IMAGE=//p' .env | tail -n 1 | tr -d '\r')"
fi

backup_before_deploy() {
  local backup_enabled="${DB_BACKUP_BEFORE_DEPLOY:-1}"
  if [[ "$backup_enabled" != "1" ]]; then
    echo "[deploy] database backup skipped because DB_BACKUP_BEFORE_DEPLOY=$backup_enabled"
    return 0
  fi

  local db_container_id
  db_container_id="$($DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" ps -q db 2>/dev/null || true)"
  if [[ -z "$db_container_id" ]]; then
    if [[ -n "$PREVIOUS_IMAGE" ]]; then
      echo "[deploy] no running db container found; refusing deploy without backup" >&2
      echo "[deploy] set DB_BACKUP_BEFORE_DEPLOY=0 to bypass explicitly" >&2
      return 1
    fi

    echo "[deploy] no existing db container found; treating this as first deploy and skipping backup"
    return 0
  fi

  local backup_dir="$DEPLOY_META_DIR/backups"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local backup_name="${DEPLOY_ENVIRONMENT:-production}-${timestamp}-${DEPLOY_GIT_SHA:-manual}.dump"
  local container_backup="/tmp/${backup_name}"
  mkdir -p "$backup_dir"

  echo "[deploy] creating database backup $backup_name"
  docker exec \
    "$db_container_id" \
    sh -eu -c '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      exec pg_dump \
        -U "$POSTGRES_USER" \
        -d "${POSTGRES_DB:-$POSTGRES_USER}" \
        -Fc \
        -f "$1"
    ' sh "$container_backup"
  docker cp "${db_container_id}:${container_backup}" "${backup_dir}/${backup_name}"
  docker exec "$db_container_id" rm -f "$container_backup"

  printf '%s\n' "${backup_dir}/${backup_name}" > "$DEPLOY_META_DIR/last_database_backup"
  echo "[deploy] database backup saved to ${backup_dir}/${backup_name}"
}

write_env_file "$APP_IMAGE"

if [[ -n "${GHCR_PULL_TOKEN:-}" ]]; then
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-${GITHUB_REPOSITORY%%/*}}" --password-stdin
fi

backup_before_deploy

$DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" pull app || true
$DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" up -d db
$DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" up -d app

if wait_for_app_health "$DC" "$DEPLOY_COMPOSE_FILE" "$DEPLOY_PROJECT"; then
  printf '%s\n' "$APP_IMAGE" > "$DEPLOY_META_DIR/last_successful_app_image"
  printf '%s\n' "${DEPLOY_GIT_SHA:-unknown}" > "$DEPLOY_META_DIR/last_successful_git_sha"
  printf '%s\n' "${DEPLOY_ENVIRONMENT:-production}" > "$DEPLOY_META_DIR/last_successful_environment"
  echo "[deploy] deploy succeeded with image $APP_IMAGE"
  exit 0
fi

echo "[deploy] new image failed health checks: $APP_IMAGE" >&2
$DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" logs --tail=200 app || true

if [[ -n "$PREVIOUS_IMAGE" && "$PREVIOUS_IMAGE" != "$APP_IMAGE" ]]; then
  echo "[deploy] attempting rollback to $PREVIOUS_IMAGE"
  write_env_file "$PREVIOUS_IMAGE"
  $DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" pull app || true
  $DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" up -d app

  if wait_for_app_health "$DC" "$DEPLOY_COMPOSE_FILE" "$DEPLOY_PROJECT" 24 10; then
    echo "[deploy] rollback succeeded"
  else
    echo "[deploy] rollback failed" >&2
    $DC -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" logs --tail=200 app || true
  fi
else
  echo "[deploy] no previous successful image recorded; rollback skipped" >&2
fi

exit 1
