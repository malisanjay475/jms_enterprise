# Update code on the VPS from git and rebuild the full v2 Docker stack.
# One-time on the server: git clone https://github.com/malisanjay475/jms_enterprise.git
#   cd jms_enterprise && cp env.docker.example .env && nano .env
# Then from your PC (repo root):
#   .\deploy_v2_stack.ps1

$ErrorActionPreference = "Stop"
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jms_enterprise"
$GitBranch = "main"
$sshTarget = "${RemoteUser}@${RemoteIP}"

Write-Host "Pull + rebuild on ${sshTarget}:${RemotePath} (branch ${GitBranch})..." -ForegroundColor Cyan
ssh $sshTarget "cd `"$RemotePath`" && git fetch origin && git checkout $GitBranch && git pull origin $GitBranch && (docker compose up -d --build || docker-compose up -d --build)"

Write-Host "Done. Open http://${RemoteIP}/" -ForegroundColor Green
