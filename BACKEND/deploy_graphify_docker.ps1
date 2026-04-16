# Deploy Graphify static viewer as its own Docker container on your VPS.
# Prereqs: OpenSSH (ssh, scp), Docker + Compose plugin on the server.
#
# Usage (from BACKEND folder):
#   .\deploy_graphify_docker.ps1

$ErrorActionPreference = "Stop"

$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jms-graphify"

Write-Host "Remote: ${RemoteUser}@${RemoteIP}:${RemotePath}" -ForegroundColor Cyan
Write-Host "Ensure firewall allows GRAPHIFY_VIEW_PORT (default 8088) if you need public access." -ForegroundColor Yellow

$sshTarget = "${RemoteUser}@${RemoteIP}"

Write-Host "Creating remote directories..." -ForegroundColor Cyan
ssh $sshTarget "mkdir -p `"$RemotePath/graphify-view`" `"$RemotePath/PUBLIC`""

Write-Host "Uploading compose + Dockerfile + nginx config..." -ForegroundColor Cyan
scp "docker-compose.graphify.yml" "${sshTarget}:${RemotePath}/"
scp "graphify-view/Dockerfile" "${sshTarget}:${RemotePath}/graphify-view/"
scp "graphify-view/nginx.conf" "${sshTarget}:${RemotePath}/graphify-view/"

Write-Host "Uploading static assets (graph + API inventory)..." -ForegroundColor Cyan
scp "PUBLIC/graph-view.html" "${sshTarget}:${RemotePath}/PUBLIC/"
scp "PUBLIC/api-inventory.json" "${sshTarget}:${RemotePath}/PUBLIC/"
scp "PUBLIC/graphify-graph.json" "${sshTarget}:${RemotePath}/PUBLIC/"

Write-Host "Building and starting container..." -ForegroundColor Cyan
ssh $sshTarget "cd `"$RemotePath`" && (docker compose -f docker-compose.graphify.yml up -d --build || docker-compose -f docker-compose.graphify.yml up -d --build)"

Write-Host "Done. Open http://${RemoteIP}:8088/graph-view.html (or / after redirect)." -ForegroundColor Green
