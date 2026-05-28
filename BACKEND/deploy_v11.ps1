$ErrorActionPreference = "Stop"
$RemoteHost = "72.62.228.195"
$RemoteUser = "root"
$ZipName = "v11.zip"
$TempDir = "v11_temp"

Write-Host "1. Cleaning up..."
if (Test-Path $ZipName) { Remove-Item $ZipName -Force }
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }

Write-Host "2. Creating Temp Structure..."
New-Item -ItemType Directory -Path "$TempDir" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/services" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/PUBLIC/assets" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/src/db" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/src/legacy" | Out-Null

Write-Host "3. Copying Files..."
Copy-Item "server.js" -Destination "$TempDir"
Copy-Item "package.json" -Destination "$TempDir"
Copy-Item "services/sync.service.js" -Destination "$TempDir/services"
Copy-Item "src/db/createDbPool.js" -Destination "$TempDir/src/db"
Copy-Item "src/legacy/registerLegacyRoutes.js" -Destination "$TempDir/src/legacy"
Copy-Item "PUBLIC/supervisor.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/login.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/users.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/dpr.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/assets/app.js" -Destination "$TempDir/PUBLIC/assets"

Write-Host "4. Zipping..."
Compress-Archive -Path "$TempDir/*" -DestinationPath $ZipName

Write-Host "5. Uploading to $RemoteHost..."
# Note: Using the specific po_parser_vps_deploy_ed25519 deployment key
scp -i "$env:USERPROFILE\.ssh\po_parser_vps_deploy_ed25519" $ZipName "${RemoteUser}@${RemoteHost}:/root/"

Write-Host "6. Deploying on Remote..."
# Unzip to /opt/jms-enterprise/BACKEND, Rebuild/Restart V1 App, Clean up zip
$Cmd = "unzip -o /root/$ZipName -d /opt/jms-enterprise/BACKEND && cd /opt/jms-enterprise && docker compose -p jms-enterprise-v1 -f docker-compose.vps-v1-isolated.yml up -d --build app && rm /root/$ZipName"
ssh -i "$env:USERPROFILE\.ssh\po_parser_vps_deploy_ed25519" -o StrictHostKeyChecking=no "${RemoteUser}@${RemoteHost}" $Cmd

Write-Host "7. Cleanup Local..."
Remove-Item $TempDir -Recurse -Force
# Remove-Item $ZipName -Force # Optional: Keep zip for debug if needed but script says remove. I'll keep it commented for now or just remove.
Remove-Item $ZipName -Force

Write-Host "Done! Deployment Complete."
