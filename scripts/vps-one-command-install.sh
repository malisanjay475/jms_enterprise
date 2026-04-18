#!/usr/bin/env bash
# Run ON THE VPS only (Hostinger web terminal or SSH). No PC workflow.
#
# One line (defaults: install under /opt/jms-enterprise, branch main):
#   curl -fsSL https://raw.githubusercontent.com/malisanjay475/jms_enterprise/main/scripts/vps-one-command-install.sh | sudo bash
#
# Optional env vars (prefix the curl line, or export before piping):
#   JMS_INSTALL_DIR=/opt/jms-enterprise
#   JMS_BRANCH=main
#   DB_PASSWORD=your_db_password_here   (otherwise compose defaults apply)
#   V1_HTTP_PORT=9091

set -euo pipefail

REPO_URL="${JMS_REPO_URL:-https://github.com/malisanjay475/jms_enterprise.git}"
INSTALL_DIR="${JMS_INSTALL_DIR:-/opt/jms-enterprise}"
BRANCH="${JMS_BRANCH:-main}"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Re-run with sudo so Docker and /opt can be used."
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y git curl >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y git curl >/dev/null
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Installing via get.docker.com ..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || true
fi

if ! docker compose version >/dev/null 2>&1 && ! docker-compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose not available after Docker install. Install the compose plugin, then re-run this script."
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

umask 077
PW="${DB_PASSWORD:-${VPS_POSTGRES_PASSWORD:-}}"
if [ -n "$PW" ]; then
  {
    echo "DB_USER=${DB_USER:-jms_v1}"
    echo "DB_PASSWORD=$PW"
    echo "DB_NAME=${DB_NAME:-jms_v1}"
    echo "V1_HTTP_PORT=${V1_HTTP_PORT:-9091}"
    echo "GEMINI_API_KEY=${GEMINI_API_KEY:-}"
    echo "SERVER_TYPE=${SERVER_TYPE:-MAIN}"
  } > .env
else
  echo "DB_PASSWORD not set; using compose defaults (fine for first try)."
fi

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(docker-compose)
fi

"${DC[@]}" -p jms-enterprise-v1 -f docker-compose.vps-v1-upload-only.yml up -d --build

IP="$(curl -fsS --connect-timeout 3 https://api.ipify.org 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PORT="${V1_HTTP_PORT:-9091}"
echo ""
echo "=== JMS v1 stack started ==="
echo "Try: http://${IP}:${PORT}"
echo "(Allow TCP ${PORT} in the VPS firewall if the page does not load.)"
echo ""
