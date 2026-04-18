#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v gh >/dev/null 2>&1 || { echo "Install GitHub CLI: https://cli.github.com/"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login"; exit 1; }

url="$(git config --get remote.origin.url)"
if [[ "$url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
  REPO="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
else
  echo "Could not parse owner/repo from: $url"; exit 1
fi
echo "Repository: $REPO"

ENV_FILE="$(dirname "$0")/github-actions.secrets.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy github-actions.secrets.env.example and edit."
  exit 1
fi

read_value() {
  local want="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// }" || "$line" =~ ^[[:space:]]*# ]] && continue
    local k="${line%%=*}"
    k="$(echo "$k" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ "$k" != "$want" ]] && continue
    local v="${line#*=}"
    v="$(echo "$v" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    printf '%s' "$v"
    return 0
  done < "$ENV_FILE"
  return 1
}

set_secret() {
  local name="$1"
  local body="$2"
  if [[ -z "${body// }" ]]; then
    echo "  skip $name (empty)"
    return
  fi
  echo "  set $name"
  printf '%s' "$body" | gh secret set "$name" --repo "$REPO"
}

key_file="$(read_value HOSTINGER_SSH_KEY_FILE 2>/dev/null || true)"
if [[ -n "${key_file:-}" ]]; then
  p="$key_file"
  [[ "$p" = /* ]] || p="$ROOT/$p"
  [[ -f "$p" ]] || { echo "Key file not found: $p"; exit 1; }
  set_secret HOSTINGER_SSH_KEY "$(cat "$p")"
fi

for n in HOSTINGER_SSH_HOST HOSTINGER_SSH_USER VPS_DEPLOY_PATH VPS_POSTGRES_PASSWORD \
         VPS_SSH_PASSWORD HOSTINGER_SSH_KEY_PASSPHRASE VPS_GEMINI_API_KEY GHCR_PULL_TOKEN; do
  v="$(read_value "$n" 2>/dev/null || true)"
  set_secret "$n" "${v:-}"
done

if [[ -z "${key_file:-}" ]]; then
  inline="$(read_value HOSTINGER_SSH_KEY 2>/dev/null || true)"
  set_secret HOSTINGER_SSH_KEY "${inline:-}"
fi

echo "Done. Verify: gh secret list --repo $REPO"
