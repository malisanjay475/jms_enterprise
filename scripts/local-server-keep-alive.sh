#!/usr/bin/env bash
# ============================================================
# JMS Enterprise — LOCAL Server Keep-Alive & Auto-Recovery
# ============================================================
# Run via cron every 1 minute on the LOCAL factory server.
# Checks if the JMS Docker container is running and healthy.
# If not, restarts it automatically.
#
# Install cron (run once):
#   bash /opt/jms-enterprise/scripts/local-server-setup-cron.sh
#
# Manual run:
#   bash /opt/jms-enterprise/scripts/local-server-keep-alive.sh
# ============================================================

set -uo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/jms-enterprise}"
LOG_FILE="${LOG_FILE:-/var/log/jms-keep-alive.log}"
APP_CONTAINER="${APP_CONTAINER:-jms-enterprise-v1-app-1}"
COMPOSE_FILE="$DEPLOY_PATH/docker-compose.yml"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
MAX_LOG_LINES=2000   # rotate log to prevent disk fill

# ── Logging ──────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Log rotation ─────────────────────────────────────────────
rotate_log() {
  if [ -f "$LOG_FILE" ]; then
    local lines
    lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$lines" -gt "$MAX_LOG_LINES" ]; then
      tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
  fi
}
rotate_log

# ── Check 1: Is Docker daemon running? ───────────────────────
if ! docker info > /dev/null 2>&1; then
  log "❌ Docker daemon is not running! Attempting to start..."
  systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
  sleep 5
  if ! docker info > /dev/null 2>&1; then
    log "❌ CRITICAL: Docker daemon could not be started. Manual intervention needed."
    exit 1
  fi
  log "✅ Docker daemon started successfully."
fi

# ── Check 2: Is the app container running? ───────────────────
CONTAINER_STATUS=$(docker inspect --format='{{.State.Status}}' "$APP_CONTAINER" 2>/dev/null || echo "missing")

if [ "$CONTAINER_STATUS" = "running" ]; then
  # ── Check 3: HTTP health check ─────────────────────────────
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    # All good — silent success (no log spam when healthy)
    exit 0
  else
    log "⚠️  Container running but HTTP health check returned ${HTTP_CODE}. Restarting container..."
    docker restart "$APP_CONTAINER" >> "$LOG_FILE" 2>&1 || true
    log "🔄 Container restart triggered."
  fi
elif [ "$CONTAINER_STATUS" = "exited" ] || [ "$CONTAINER_STATUS" = "dead" ]; then
  log "❌ Container '$APP_CONTAINER' is ${CONTAINER_STATUS}. Restarting via docker-compose..."
  cd "$DEPLOY_PATH" && docker compose up -d --no-build >> "$LOG_FILE" 2>&1
  log "🔄 docker compose up triggered."
elif [ "$CONTAINER_STATUS" = "missing" ]; then
  log "❌ Container '$APP_CONTAINER' not found. Running docker compose up..."
  cd "$DEPLOY_PATH" && docker compose up -d --no-build >> "$LOG_FILE" 2>&1
  log "🔄 docker compose up triggered."
else
  log "ℹ️  Container status: ${CONTAINER_STATUS} — no action taken."
fi

# Wait and verify recovery
sleep 15
FINAL_STATUS=$(docker inspect --format='{{.State.Status}}' "$APP_CONTAINER" 2>/dev/null || echo "missing")
FINAL_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
log "Recovery check: container=${FINAL_STATUS}, http=${FINAL_HTTP}"
