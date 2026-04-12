$ErrorActionPreference = "Stop"
$RemoteHost = "72.62.228.195"
$RemoteUser = "root"

Write-Host "Fetching logs from remote server..."
ssh "${RemoteUser}@${RemoteHost}" "docker logs --tail 50 jpsms-app"
