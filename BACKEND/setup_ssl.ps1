# --- CONFIGURATION ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$RemoteZipPath = "/root/v9.zip"
$LocalFile = "v9.zip"

# Check file
if (-Not (Test-Path $LocalFile)) {
    Write-Error "File $LocalFile not found!"
    exit
}

# 1. UPLOAD
Write-Host "Step 1: Uploading Infrastructure ($LocalFile)..." -ForegroundColor Cyan
scp $LocalFile "${RemoteUser}@${RemoteIP}:${RemoteZipPath}"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Upload Failed. Check SSH."
    exit
}

# 2. DEPLOY & GENERATE CERTS
Write-Host "Step 2: Deploying Config and Requesting Certificates..." -ForegroundColor Cyan

# Commands explanation:
# 1. unzip v9.zip: Updates docker-compose.yml and nginx/default.conf
# 2. docker-compose up -d: Recreates containers with new volumes and certbot service
# 3. docker-compose run ... certbot: Requests the actual certificate
# 4. ls ...: Verifies the cert files exist
$RemoteCommand = "unzip -o $RemoteZipPath -d $RemotePath && cd $RemotePath && docker-compose up -d && docker-compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot -d jmsocean.cloud -d www.jmsocean.cloud --email admin@jmsocean.cloud --agree-tos --no-eff-email && ls -l $RemotePath/certbot/conf/live/jmsocean.cloud/"

ssh "${RemoteUser}@${RemoteIP}" $RemoteCommand

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "CERTIFICATES GENERATED (If no errors above)!" -ForegroundColor Green
Write-Host "Now ready to enforce HTTPS." -ForegroundColor Yellow
Write-Host "---------------------------------------------------" -ForegroundColor Green
