
# ==========================================
# JPSMS AUTO DEPLOY SCRIPT (Windows -> VPS)
# ==========================================

# --- CONFIGURATION (UPDATE THESE!) ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$RemoteZipPath = "/root/v7.zip" # Upload to root to avoid permission issues

# --- FILES ---
$LocalFile = "v7.zip"

# Check if file exists
if (-Not (Test-Path $LocalFile)) {
    Write-Error "File $LocalFile not found! Run the preparation script first."
    exit
}

# 1. UPLOAD
Write-Host "Step 1: Uploading $LocalFile to $RemoteIP..." -ForegroundColor Cyan
scp $LocalFile "${RemoteUser}@${RemoteIP}:${RemoteZipPath}"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Upload Failed. Please check your SSH credentials."
    exit
}

# 2. UNZIP & RESTART (Remote Docker Command)
Write-Host "Step 2: Unzipping and Rebuilding Docker (No Cache)..." -ForegroundColor Cyan
# Commands:
# 1. Unzip v7.zip into /root/jpsms (overwriting services/)
# 2. Check if file updated (grep v4.3)
# 3. Rebuild Docker without cache to ensure new code is picked up
$RemoteCommand = "unzip -o $RemoteZipPath -d $RemotePath && grep 'v4.3' $RemotePath/services/sync.service.js && cd $RemotePath && docker-compose build --no-cache app && docker-compose up -d"

ssh "${RemoteUser}@${RemoteIP}" $RemoteCommand

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "The Main Server should now be running the new code." -ForegroundColor Green
Write-Host "---------------------------------------------------" -ForegroundColor Green
