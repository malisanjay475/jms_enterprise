$ErrorActionPreference = "Stop"
$RemoteHost = "72.62.228.195"
$RemoteUser = "root"
$File = "server.js"

Write-Host "1. Uploading server.js..."
scp $File "${RemoteUser}@${RemoteHost}:/root/jpsms/"

Write-Host "2. Copying into Container..."
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/$File jpsms-app:/app/$File"

Write-Host "3. Restarting App..."
ssh "${RemoteUser}@${RemoteHost}" "docker restart jpsms-app"

Write-Host "Done! Server Updated."
