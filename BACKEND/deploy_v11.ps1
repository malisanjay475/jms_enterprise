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

Write-Host "3. Copying Files..."
Copy-Item "server.js" -Destination "$TempDir"
Copy-Item "migrate_factory_isolation_v2.js" -Destination "$TempDir"
Copy-Item "services/sync.service.js" -Destination "$TempDir/services"
Copy-Item "PUBLIC/supervisor.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/login.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/users.html" -Destination "$TempDir/PUBLIC"
Copy-Item "PUBLIC/assets/app.js" -Destination "$TempDir/PUBLIC/assets"

Write-Host "4. Zipping..."
Compress-Archive -Path "$TempDir/*" -DestinationPath $ZipName

Write-Host "5. Uploading to $RemoteHost..."
# Note: This assumes SSH key is set up. If not, it will prompt for password.
scp $ZipName "${RemoteUser}@${RemoteHost}:/root/"

Write-Host "6. Deploying on Remote..."
# Unzip to /root/jpsms (App Root), Rebuild/Restart App, Run Migration
$Cmd = "unzip -o /root/$ZipName -d /root/jpsms && cd /root/jpsms && docker-compose up -d --build app && echo 'Waiting for DB...' && sleep 5 && docker exec jpsms-app node migrate_factory_isolation_v2.js && rm /root/$ZipName"
ssh "${RemoteUser}@${RemoteHost}" $Cmd

Write-Host "7. Cleanup Local..."
Remove-Item $TempDir -Recurse -Force
# Remove-Item $ZipName -Force # Optional: Keep zip for debug if needed but script says remove. I'll keep it commented for now or just remove.
Remove-Item $ZipName -Force

Write-Host "Done! Deployment Complete."
