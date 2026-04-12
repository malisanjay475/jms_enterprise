# --- CONFIGURATION ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$RemoteNginxConfig = "/root/jpsms/nginx/default.conf"

$LocalHttpConfig = "nginx\default.conf.http"
$LocalHttpsConfig = "nginx\default.conf.https"

# Check files
if (-Not (Test-Path $LocalHttpConfig) -or -Not (Test-Path $LocalHttpsConfig)) {
    Write-Error "Config files missing! Run me from BACKEND folder."
    exit
}

# --- STEP 1: DOWNGRADE TO HTTP ---
Write-Host "Step 1: Stopping Docker and Swapping to HTTP Config..." -ForegroundColor Cyan
scp $LocalHttpConfig "${RemoteUser}@${RemoteIP}:${RemoteNginxConfig}"
ssh "${RemoteUser}@${RemoteIP}" "cd $RemotePath && docker-compose down && docker-compose up -d"

Write-Host "Waiting 10s for Nginx to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# --- STEP 2: GENERATE CERTS ---
Write-Host "Step 2: Generating Certificates..." -ForegroundColor Cyan
# This command runs Certbot against the now-working HTTP Nginx
$CertCmd = "cd $RemotePath && docker-compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot -d jmsocean.cloud -d www.jmsocean.cloud --email admin@jmsocean.cloud --agree-tos --no-eff-email --force-renewal"
ssh "${RemoteUser}@${RemoteIP}" $CertCmd

if ($LASTEXITCODE -ne 0) {
    Write-Error "Certbot Failed! Check output above."
    exit
}

# --- STEP 3: UPGRADE TO HTTPS ---
Write-Host "Step 3: Certificates Success! Upgrading to HTTPS..." -ForegroundColor Cyan
scp $LocalHttpsConfig "${RemoteUser}@${RemoteIP}:${RemoteNginxConfig}"
ssh "${RemoteUser}@${RemoteIP}" "cd $RemotePath && docker-compose restart nginx"

Write-Host "---------------------------------------------------" -ForegroundColor Green
Write-Host "SSL FIXED & ENFORCED!" -ForegroundColor Green
Write-Host "Visit https://jmsocean.cloud" -ForegroundColor Yellow
Write-Host "---------------------------------------------------" -ForegroundColor Green
