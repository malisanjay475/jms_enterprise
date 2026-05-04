$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$liveRoot = "C:\Users\SanjayMali\Downloads\jms-local-server-jms-01\JMS_LOCAL_SERVER_jms-01"

$pairs = @(
  @{ Source = "BACKEND\PUBLIC\planning.html"; Destination = "BACKEND\PUBLIC\planning.html" },
  @{ Source = "BACKEND\PUBLIC\supervisor.html"; Destination = "BACKEND\PUBLIC\supervisor.html" },
  @{ Source = "BACKEND\PUBLIC\masters.html"; Destination = "BACKEND\PUBLIC\masters.html" },
  @{ Source = "BACKEND\PUBLIC\assets\app.css"; Destination = "BACKEND\PUBLIC\assets\app.css" },
  @{ Source = "BACKEND\PUBLIC\assets\app.js"; Destination = "BACKEND\PUBLIC\assets\app.js" },
  @{ Source = "BACKEND\PUBLIC\assets\timeline_patch.js"; Destination = "BACKEND\PUBLIC\assets\timeline_patch.js" },
  @{ Source = "BACKEND\src\legacy\registerLegacyRoutes.js"; Destination = "BACKEND\src\legacy\registerLegacyRoutes.js" }
)

Write-Host "Syncing Git source to live local server..." -ForegroundColor Cyan
Write-Host "Source: $repoRoot"
Write-Host "Live:   $liveRoot"

foreach ($pair in $pairs) {
  $source = Join-Path $repoRoot $pair.Source
  $destination = Join-Path $liveRoot $pair.Destination

  if (!(Test-Path -LiteralPath $source)) {
    Write-Warning "Missing source: $source"
    continue
  }

  $destinationDir = Split-Path -Parent $destination
  if (!(Test-Path -LiteralPath $destinationDir)) {
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  }

  Copy-Item -LiteralPath $source -Destination $destination -Force
  Write-Host "Copied $($pair.Source)" -ForegroundColor Green
}

Write-Host "Done. Restart backend only if registerLegacyRoutes.js changed." -ForegroundColor Cyan
