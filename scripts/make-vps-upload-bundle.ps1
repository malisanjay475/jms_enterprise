#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$compose = Join-Path $root "docker-compose.vps-v1-upload-only.yml"
$backend = Join-Path $root "BACKEND"
$seed = Join-Path $root "seed"

if (-not (Test-Path $compose)) { throw "Missing $compose" }
if (-not (Test-Path $backend)) { throw "Missing BACKEND folder" }
if (-not (Test-Path $seed)) { New-Item -ItemType Directory -Force -Path $seed | Out-Null }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zip = Join-Path $dist "jms-v1-upload.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path $compose, $backend, $seed -DestinationPath $zip -CompressionLevel Optimal -Force
Write-Host "Created: $zip"
Write-Host "Upload this zip to your VPS, unzip, cd into the folder that contains BACKEND, seed, and the yml file, then:"
Write-Host "  docker compose -p jms-enterprise-v1 -f docker-compose.vps-v1-upload-only.yml up -d --build"
Write-Host "Optional: place pg_dump -Fc as seed\restore.dump before zipping or on the VPS (auto-import when DB has no users)."
