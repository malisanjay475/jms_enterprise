#!/usr/bin/env bash
# One-time: TURN relay (coturn) for JMS Chat voice calls, on the production VPS.
#
# Phones on mobile data usually cannot reach each other directly; the call audio then
# goes through this relay. Run as root in the VPS terminal:
#   bash /opt/jms-enterprise/scripts/vps-setup-turn.sh
# It prints the two values to add as GitHub secrets (TURN_URLS, TURN_SECRET); the next
# production deploy passes them to the app. Re-running keeps the same secret.
#
# Ports to open in the Hostinger firewall (VPS > Firewall): 3478 TCP+UDP and
# 49160-49200 UDP. Rollback: docker rm -f jms-coturn.
set -euo pipefail

DOMAIN="${TURN_DOMAIN:-jmsocean.cloud}"
DIR=/opt/jms-coturn
mkdir -p "$DIR"
if [[ ! -s "$DIR/secret" ]]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > "$DIR/secret"
  chmod 600 "$DIR/secret"
fi
SECRET="$(cat "$DIR/secret")"
PUBLIC_IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"

cat > "$DIR/turnserver.conf" <<EOF
listening-port=3478
min-port=49160
max-port=49200
external-ip=${PUBLIC_IP}
realm=${DOMAIN}
use-auth-secret
static-auth-secret=${SECRET}
fingerprint
no-cli
no-tls
no-dtls
no-multicast-peers
# never relay into private networks (the VPS's own services)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
total-quota=200
user-quota=4
EOF

docker rm -f jms-coturn >/dev/null 2>&1 || true
docker run -d --name jms-coturn --restart unless-stopped --network host \
  -v "$DIR/turnserver.conf:/etc/coturn/turnserver.conf:ro" \
  coturn/coturn:4.6.2 -c /etc/coturn/turnserver.conf >/dev/null

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 3478/tcp >/dev/null; ufw allow 3478/udp >/dev/null; ufw allow 49160:49200/udp >/dev/null
fi

sleep 2
docker ps --filter name=jms-coturn --format '{{.Names}} {{.Status}}'
echo
echo "Add these two GitHub secrets (Settings > Secrets and variables > Actions):"
echo "  TURN_URLS   = turn:${DOMAIN}:3478,turn:${DOMAIN}:3478?transport=tcp"
echo "  TURN_SECRET = ${SECRET}"
echo
echo "Also open 3478 TCP+UDP and 49160-49200 UDP in the Hostinger firewall."
