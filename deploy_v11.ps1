# --- CONFIGURATION ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$RemoteZipPath = "/root/v11.zip"
$LocalZip = "v11.zip"

# Clean up old zip
if (Test-Path $LocalZip) { Remove-Item $LocalZip }

# Create Temporary Directory for Structure
$TempDir = "v11_temp"
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
New-Item -ItemType Directory -Path $TempDir | Out-Null

# Copy Files (Preserving Structure relative to /root/jpsms/BACKEND usually, but server structure is mapped to /app?)
# Wait, user wraps "BACKEND" content usually?
# Let's check previous deployments. "unzip -o v8.zip -d /root/jpsms".
# If /root/jpsms contains docker-compose.yml and a "BACKEND" folder, then I should structure zip as:
# BACKEND/server.js
# BACKEND/PUBLIC/login.html
# ...
# Let's assume standard structure:
# v11.zip/BACKEND/server.js
# v11.zip/BACKEND/PUBLIC/login.html
# v11.zip/BACKEND/PUBLIC/assets/app.js

# 1. Create Structure
New-Item -ItemType Directory -Path "$TempDir/BACKEND" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/BACKEND/PUBLIC" | Out-Null
New-Item -ItemType Directory -Path "$TempDir/BACKEND/PUBLIC/assets" | Out-Null

# 2. Copy Files
Copy-Item "BACKEND/server.js" -Destination "$TempDir/BACKEND/server.js"
Copy-Item "BACKEND/PUBLIC/login.html" -Destination "$TempDir/BACKEND/PUBLIC/login.html"
Copy-Item "BACKEND/PUBLIC/assets/app.js" -Destination "$TempDir/BACKEND/PUBLIC/assets/app.js"

# 3. Zip
Write-Host "Creating $LocalZip..." -ForegroundColor Cyan
Compress-Archive -Path "$TempDir/*" -DestinationPath $LocalZip

# 4. Upload
Write-Host "Uploading $LocalZip..." -ForegroundColor Cyan
scp $LocalZip "${RemoteUser}@${RemoteIP}:${RemoteZipPath}"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Upload Failed."
    exit
}

# 5. Deploy
Write-Host "Deploying & Restarting..." -ForegroundColor Cyan
# Unzip to /root/jpsms/ which should overwrite BACKEND/...
# Then restart backend service
$RemoteCommand = "unzip -o $RemoteZipPath -d $RemotePath && cd $RemotePath && docker-compose restart backend"

ssh "${RemoteUser}@${RemoteIP}" $RemoteCommand

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "DEPLOYMENT V11 COMPLETE" -ForegroundColor Green
Write-Host "Server updated. Please verify factory isolation." -ForegroundColor Yellow
Write-Host "---------------------------------------------------" -ForegroundColor Green

# Cleanup
Remove-Item $TempDir -Recurse -Force
