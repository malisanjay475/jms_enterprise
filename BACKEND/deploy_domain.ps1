# --- CONFIGURATION ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$RemoteZipPath = "/root/v8.zip"
$LocalFile = "v8.zip"

# Check file
if (-Not (Test-Path $LocalFile)) {
    Write-Error "File $LocalFile not found!"
    exit
}

# 1. UPLOAD
Write-Host "Step 1: Uploading Nginx Config ($LocalFile)..." -ForegroundColor Cyan
scp $LocalFile "${RemoteUser}@${RemoteIP}:${RemoteZipPath}"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Upload Failed. Check SSH."
    exit
}

# 2. DEPLOY & RESTART NGINX
Write-Host "Step 2: Updating Nginx Config and Restarting..." -ForegroundColor Cyan
# Commands:
# 1. Unzip v8.zip (updates nginx/default.conf)
# 2. Restart Nginx container to apply changes
$RemoteCommand = "unzip -o $RemoteZipPath -d $RemotePath && cd $RemotePath && docker-compose restart nginx"

ssh "${RemoteUser}@${RemoteIP}" $RemoteCommand

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "DOMAIN CONFIG UPDATED!" -ForegroundColor Green
Write-Host "Make sure you have pointed your domain (A Record) to $RemoteIP" -ForegroundColor Yellow
Write-Host "---------------------------------------------------" -ForegroundColor Green
