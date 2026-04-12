# --- CONFIGURATION ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$RemoteZipPath = "/root/v10.zip"
$LocalFile = "v10.zip"

# Check file
if (-Not (Test-Path $LocalFile)) {
    Write-Error "File $LocalFile not found!"
    exit
}

# 1. UPLOAD
Write-Host "Step 1: Uploading Nginx SSL Config ($LocalFile)..." -ForegroundColor Cyan
scp $LocalFile "${RemoteUser}@${RemoteIP}:${RemoteZipPath}"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Upload Failed. Check SSH."
    exit
}

# 2. DEPLOY & RESTART NGINX
Write-Host "Step 2: Updating Nginx Config and Restarting..." -ForegroundColor Cyan
# Commands:
# 1. Unzip v10.zip (updates nginx/default.conf with SSL block)
# 2. Restart Nginx container to apply changes
$RemoteCommand = "unzip -o $RemoteZipPath -d $RemotePath && cd $RemotePath && docker-compose restart nginx"

ssh "${RemoteUser}@${RemoteIP}" $RemoteCommand

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "HTTPS ENFORCED!" -ForegroundColor Green
Write-Host "Visit https://jmsocean.cloud" -ForegroundColor Yellow
Write-Host "---------------------------------------------------" -ForegroundColor Green
