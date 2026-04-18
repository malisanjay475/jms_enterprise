#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$compose = Join-Path $root "docker-compose.vps-v1-upload-only.yml"
$backend = Join-Path $root "BACKEND"

if (-not (Test-Path $compose)) { throw "Missing $compose" }
if (-not (Test-Path $backend)) { throw "Missing BACKEND folder" }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zip = Join-Path $dist "jms-v1-upload.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path $compose, $backend -DestinationPath $zip -CompressionLevel Optimal -Force
Write-Host "Created: $zip"
Write-Host "Upload this zip to your VPS, unzip, cd into the folder that contains BACKEND and the yml file, then:"
Write-Host "  docker compose -f docker-compose.vps-v1-upload-only.yml up -d --build"
