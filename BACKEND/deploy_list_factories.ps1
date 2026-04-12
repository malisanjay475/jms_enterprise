$ErrorActionPreference = "Stop"
$RemoteHost = "72.62.228.195"
$RemoteUser = "root"
$Script = "list_factories.js"

Write-Host "1. Uploading Script to Host..."
scp $Script "${RemoteUser}@${RemoteHost}:/root/"

Write-Host "2. Copying Script into Container..."
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/$Script jpsms-app:/app/$Script"

Write-Host "3. Running Script inside Container..."
ssh "${RemoteUser}@${RemoteHost}" "docker exec jpsms-app node /app/$Script"

Write-Host "4. Cleanup..."
ssh "${RemoteUser}@${RemoteHost}" "rm /root/$Script"

Write-Host "Done!"
