#!/usr/bin/env bash
# Run ON THE VPS only (Hostinger web terminal or SSH). No PC workflow.
#
# One line:
#   curl -fsSL https://raw.githubusercontent.com/malisanjay475/jms_enterprise/main/scripts/vps-one-command-install.sh | sudo bash
#
# With DB password:
#   export DB_PASSWORD='your_secret_here'
#   curl -fsSL https://raw.githubusercontent.com/malisanjay475/jms_enterprise/main/scripts/vps-one-command-install.sh | sudo -E bash
#
# Env: JMS_INSTALL_DIR, JMS_BRANCH, V1_HTTP_PORT (optional; otherwise picks first free 9091–9120)

set -euo pipefail

REPO_URL="${JMS_REPO_URL:-https://github.com/malisanjay475/jms_enterprise.git}"
INSTALL_DIR="${JMS_INSTALL_DIR:-/opt/jms-enterprise}"
BRANCH="${JMS_BRANCH:-main}"
COMPOSE_PROJECT="jms-enterprise-v1"
COMPOSE_FILE="docker-compose.vps-v1-upload-only.yml"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Re-run with sudo so Docker and /opt can be used."
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates iproute2 >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y git curl iproute >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y git curl iproute >/dev/null
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Installing via get.docker.com ..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || true
fi

if ! docker compose version >/dev/null 2>&1 && ! docker-compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose not available after Docker install."
  exit 1
fi

mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(docker-compose)
fi

# Stop this project first (frees our own old port bind)
"${DC[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down 2>/dev/null || true

# Pick a free TCP port for the app (9091..9120) unless V1_HTTP_PORT is already set
pick_http_port() {
  if [ -n "${V1_HTTP_PORT:-}" ]; then
    echo "$V1_HTTP_PORT"
    return
  fi
  local p=9091
  while [ "$p" -le 9120 ]; do
    if ! ss -tln 2>/dev/null | grep -qE ":${p}\\b"; then
      echo "$p"
      return
    fi
    p=$((p + 1))
  done
  echo "9091"
}

HTTP_PORT="$(pick_http_port)"
export V1_HTTP_PORT="$HTTP_PORT"

umask 077
PW="${DB_PASSWORD:-${VPS_POSTGRES_PASSWORD:-}}"
{
  echo "DB_USER=${DB_USER:-jms_v1}"
  if [ -n "$PW" ]; then
    echo "DB_PASSWORD=$PW"
  else
    echo "# DB_PASSWORD not set — compose file defaults apply"
  fi
  echo "DB_NAME=${DB_NAME:-jms_v1}"
  echo "V1_HTTP_PORT=$HTTP_PORT"
  echo "GEMINI_API_KEY=${GEMINI_API_KEY:-}"
  echo "SERVER_TYPE=${SERVER_TYPE:-MAIN}"
} > .env

if [ -z "$PW" ]; then
  echo "Note: DB_PASSWORD not set; compose defaults are used for Postgres (OK for a quick test)."
fi

"${DC[@]}" -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d --build

IP="$(curl -fsS --connect-timeout 3 https://api.ipify.org 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "=== JMS v1 stack started ==="
echo "URL: http://${IP}:${HTTP_PORT}"
echo "Open TCP ${HTTP_PORT} in the VPS firewall if the page does not load."
echo ""
