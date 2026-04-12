$ErrorActionPreference = "Stop"
$RemoteHost = "72.62.228.195"
$RemoteUser = "root"

Write-Host "1. Uploading server.js..."
scp server.js "${RemoteUser}@${RemoteHost}:/root/jpsms/"

Write-Host "2. Uploading Migration Script..."
scp migrate_factory_isolation_v2.js "${RemoteUser}@${RemoteHost}:/root/jpsms/"

Write-Host "3. Uploading Frontend Assets (app.js)..."
scp PUBLIC/assets/app.js "${RemoteUser}@${RemoteHost}:/root/jpsms/"

Write-Host "4. Uploading Frontend Pages..."
scp PUBLIC/planning.html "${RemoteUser}@${RemoteHost}:/root/jpsms/"
scp PUBLIC/login.html "${RemoteUser}@${RemoteHost}:/root/jpsms/"
scp PUBLIC/Supervisor.html "${RemoteUser}@${RemoteHost}:/root/jpsms/"

Write-Host "5. Copying files into Container..."
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/server.js jpsms-app:/app/server.js"
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/migrate_factory_isolation_v2.js jpsms-app:/app/migrate_factory_isolation_v2.js"
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/app.js jpsms-app:/app/PUBLIC/assets/app.js"
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/planning.html jpsms-app:/app/PUBLIC/planning.html"
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/login.html jpsms-app:/app/PUBLIC/login.html"
ssh "${RemoteUser}@${RemoteHost}" "docker cp /root/jpsms/Supervisor.html jpsms-app:/app/PUBLIC/Supervisor.html"

Write-Host "6. Running Migration..."
ssh "${RemoteUser}@${RemoteHost}" "docker exec jpsms-app node migrate_factory_isolation_v2.js"

Write-Host "7. Restarting App..."
ssh "${RemoteUser}@${RemoteHost}" "docker restart jpsms-app"

Write-Host "SUCCESS! deployed full factory isolation fix."
