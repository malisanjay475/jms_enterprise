
# ==========================================
# JPSMS DIAGNOSE REMOTE SCRIPT
# ==========================================

$RemoteUser = "root"
$RemoteIP = "72.62.228.195"
$RemotePath = "/root/jpsms"
$ZipName = "diag_package.zip"

$Files = @("diagnose_remote.js", "package.json") # package.json needed for dependencies? usually node_modules exist on remote

Write-Host "Creating $ZipName..." -ForegroundColor Cyan
if (Test-Path $ZipName) { Remove-Item $ZipName }
Compress-Archive -Path $Files -DestinationPath $ZipName

Write-Host "Uploading..." -ForegroundColor Cyan
scp $ZipName "${RemoteUser}@${RemoteIP}:/root/$ZipName"

if ($LASTEXITCODE -ne 0) { Write-Error "Upload Failed!"; exit }

Write-Host "Executing Diagnostic..." -ForegroundColor Cyan
$Cmd = "unzip -o /root/$ZipName -d $RemotePath && cd $RemotePath && docker-compose build app && docker-compose up -d && docker-compose exec -T app node diagnose_remote.js"

ssh "${RemoteUser}@${RemoteIP}" $Cmd
