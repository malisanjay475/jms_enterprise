#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
ZIP="$DIST/jms-v1-upload.zip"
mkdir -p "$DIST"
rm -f "$ZIP"
(
  cd "$ROOT"
  zip -r -q "$ZIP" docker-compose.vps-v1-upload-only.yml BACKEND seed
)
echo "Created: $ZIP"
echo "Upload to VPS, unzip, cd to folder containing BACKEND, seed, and the yml, then:"
echo "  docker compose -p jms-enterprise-v1 -f docker-compose.vps-v1-upload-only.yml up -d --build"
echo "Optional: copy your PC pg_dump -Fc to seed/restore.dump before compose (auto-imports when DB has no users)."
