#!/bin/sh
# Queries sync health from inside the app container on the VPS.
#
# Shared by both the first attempt and the retry in sync-alert.yml (via
# script_path) so the two can never drift apart.
#
# ALWAYS exits 0 and prints machine-readable STATUS/DETAIL/RESP lines — the
# workflow's "Evaluate" step decides pass/fail from them. Note this only holds
# once SSH has connected; a connection failure is handled by the workflow, not
# here, because this script never runs in that case.
#
# We run the request INSIDE the app container using node's http (the image is
# node:20-alpine — it has node but NOT curl). This is exactly how the Docker
# healthcheck reaches the app, so it works regardless of host firewall or
# published-port mapping.
APP="$(docker ps --format '{{.Names}}' | grep -E 'jms-enterprise-v1-app' | head -1)"
if [ -z "$APP" ]; then
  echo "STATUS=DOWN"
  echo "DETAIL=App container (jms-enterprise-v1-app*) is not running on the VPS."
  exit 0
fi

RESP="$(docker exec -e SYNC_API_KEY="${SYNC_API_KEY}" "$APP" node -e '
  const http = require("http");
  const key = process.env.SYNC_API_KEY || "";
  http.get("http://127.0.0.1:3000/api/sync-alert?key=" + encodeURIComponent(key), (r) => {
    let b = "";
    r.on("data", d => b += d);
    r.on("end", () => { process.stdout.write(b); });
  }).on("error", () => { process.exit(2); });
' 2>/dev/null || true)"

if [ -z "$RESP" ]; then
  echo "STATUS=DOWN"
  echo "DETAIL=App did not respond on port 3000 inside the container."
  exit 0
fi

echo "STATUS=RESPONDED"
echo "RESP=$RESP"
