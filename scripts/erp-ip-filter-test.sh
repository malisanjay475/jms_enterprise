#!/usr/bin/env bash
#
# erp-ip-filter-test.sh
# --------------------------------------------------------------------------
# Diagnose whether the Joyo ERP filters our staging VPS source IP.
#
# The ERP (http://erp.joyo.in:8464/api/Values/) flip-flops between empty []
# and having data on its own. Our live-proxy reports return whatever the ERP
# returns at that instant. Open question: when the ERP has data, can the
# staging VPS actually see it, or does the ERP block the VPS IP?
#
# The only conclusive test is a SAME-INSTANT comparison from two source IPs:
#   - the VPS   (same IP our proxy uses)
#   - your laptop (a different IP)
# Run this script in BOTH places at the same time, then compare timestamps.
#
# USAGE
#   Local (your machine):
#     bash scripts/erp-ip-filter-test.sh
#
#   On the VPS (same IP the proxy uses) — either SSH in and run it, or:
#     ssh -p 22 <STAGING_SSH_USER>@72.62.228.195 'bash -s' < scripts/erp-ip-filter-test.sh
#     # key auth:
#     ssh -i /path/to/staging_key -p 22 <STAGING_SSH_USER>@72.62.228.195 'bash -s' < scripts/erp-ip-filter-test.sh
#
# Optional env overrides:
#   ERP_ENDPOINT   ERP method to poll         (default: GetORJRDetails)
#   POLLS          number of samples          (default: 12)
#   INTERVAL       seconds between samples     (default: 15)
#   PROXY_URL      local proxy to cross-check  (default: http://127.0.0.1:9093/api/reports/erp-jr-details)
#                  (only checked when running ON the VPS)
# --------------------------------------------------------------------------
set -u

ERP_BASE="http://erp.joyo.in:8464/api/Values"
ERP_ENDPOINT="${ERP_ENDPOINT:-GetORJRDetails}"
POLLS="${POLLS:-12}"
INTERVAL="${INTERVAL:-15}"
PROXY_URL="${PROXY_URL:-http://127.0.0.1:9093/api/reports/erp-jr-details}"
ERP_URL="${ERP_BASE}/${ERP_ENDPOINT}"

# Best-effort: identify where we're running and our public IP.
host="$(hostname 2>/dev/null || echo unknown)"
pubip="$(curl -s --max-time 8 https://api.ipify.org 2>/dev/null || echo '?')"

echo "=================================================================="
echo " ERP IP-filter test"
echo " host       : $host"
echo " public IP  : $pubip"
echo " erp url    : $ERP_URL"
echo " polls      : $POLLS  every ${INTERVAL}s"
echo " started    : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=================================================================="
echo " Run this at the SAME TIME on the VPS and on your laptop, then line"
echo " up the timestamps. A window where one side has data and the other"
echo " is empty = the empty side is being filtered."
echo "------------------------------------------------------------------"

data_hits=0
for i in $(seq 1 "$POLLS"); do
  ts="$(date -u +%H:%M:%S)"
  body="$(curl -s --max-time 15 "$ERP_URL" 2>/dev/null)"
  bytes="$(printf '%s' "$body" | wc -c | tr -d ' ')"
  # Treat anything longer than "[]" (2 bytes) as having data.
  if [ "$bytes" -gt 2 ]; then
    state="DATA"
    data_hits=$((data_hits + 1))
  else
    state="empty"
  fi
  printf '[%s] poll %2d/%s  %-5s bytes=%-5s %s\n' \
    "$ts" "$i" "$POLLS" "$state" "$bytes" "$(printf '%s' "$body" | head -c 50)"
  [ "$i" -lt "$POLLS" ] && sleep "$INTERVAL"
done

echo "------------------------------------------------------------------"
echo " data windows seen from this IP: $data_hits / $POLLS"

# If we're on the VPS (proxy reachable on localhost), cross-check the proxy
# path against the raw ERP path back-to-back.
if curl -s --max-time 5 -o /dev/null "$PROXY_URL" 2>/dev/null; then
  echo "------------------------------------------------------------------"
  echo " Proxy cross-check (this looks like the VPS — proxy is reachable):"
  raw="$(curl -s --max-time 15 "$ERP_URL" 2>/dev/null)"
  prx="$(curl -s --max-time 15 "$PROXY_URL" 2>/dev/null)"
  echo "   RAW   : $(printf '%s' "$raw" | head -c 100)"
  echo "   PROXY : $(printf '%s' "$prx" | head -c 100)"
fi

echo "=================================================================="
echo " INTERPRETATION"
echo "   laptop DATA + VPS empty (same window) -> ERP FILTERS the VPS IP"
echo "                                            (whitelist $pubip with Joyo)"
echo "   both empty in the same windows        -> ERP just empty; code is fine"
echo "   both DATA together                    -> no filtering; feature proven"
echo "=================================================================="
