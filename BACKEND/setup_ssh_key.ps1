# --- CONFIGURATION ---
$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$LocalPubKey = "$env:USERPROFILE\.ssh\id_ed25519.pub"

# Check key
if (-Not (Test-Path $LocalPubKey)) {
    Write-Error "Public Key $LocalPubKey not found!"
    exit
}

$PubKeyContent = Get-Content $LocalPubKey

Write-Host "Step 1: Installing SSH Key to Server..." -ForegroundColor Cyan
Write-Host "You will be asked for the password ONE LAST TIME." -ForegroundColor Yellow

# Command to append key to authorized_keys (creates dir if missing)
$RemoteCmd = "mkdir -p ~/.ssh && echo '$PubKeyContent' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh"

ssh "${RemoteUser}@${RemoteIP}" $RemoteCmd

if ($LASTEXITCODE -eq 0) {
    Write-Host "---------------------------------------------------" -ForegroundColor Green
    Write-Host "SUCCESS! Anitgravity (and you) can now connect." -ForegroundColor Green
    Write-Host "Try: ssh root@$RemoteIP (Should be password-less)" -ForegroundColor Cyan
    Write-Host "---------------------------------------------------" -ForegroundColor Green
}
else {
    Write-Error "Failed to install key."
}
