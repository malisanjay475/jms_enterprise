#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
ZIP="$DIST/jms-v1-upload.zip"
mkdir -p "$DIST"
rm -f "$ZIP"
(
  cd "$ROOT"
  zip -r -q "$ZIP" docker-compose.vps-v1-upload-only.yml BACKEND
)
echo "Created: $ZIP"
echo "Upload to VPS, unzip, cd to folder containing BACKEND and the yml, then:"
echo "  docker compose -f docker-compose.vps-v1-upload-only.yml up -d --build"
