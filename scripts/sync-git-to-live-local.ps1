$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
# Active factory LOCAL server root (the path pm2 actually runs the backend from).
# The old Downloads\jms-local-server-jms-01 copy is inactive — do not sync there.
$liveRoot = "D:\JMS_LOCAL_SERVER_factory-1-3cbb2e3f"

$pairs = @(
  @{ Source = "BACKEND\PUBLIC\planning.html"; Destination = "BACKEND\PUBLIC\planning.html" },
  @{ Source = "BACKEND\PUBLIC\assets\planning-script-1.js"; Destination = "BACKEND\PUBLIC\assets\planning-script-1.js" },
  @{ Source = "BACKEND\PUBLIC\assets\planning-script-2.js"; Destination = "BACKEND\PUBLIC\assets\planning-script-2.js" },
  @{ Source = "BACKEND\PUBLIC\assets\planning-script-3.js"; Destination = "BACKEND\PUBLIC\assets\planning-script-3.js" },
  @{ Source = "BACKEND\PUBLIC\supervisor.html"; Destination = "BACKEND\PUBLIC\supervisor.html" },
  @{ Source = "BACKEND\PUBLIC\assets\supervisor-script-1.js"; Destination = "BACKEND\PUBLIC\assets\supervisor-script-1.js" },
  @{ Source = "BACKEND\PUBLIC\shifting_supervisor.html"; Destination = "BACKEND\PUBLIC\shifting_supervisor.html" },
  @{ Source = "BACKEND\PUBLIC\masters.html"; Destination = "BACKEND\PUBLIC\masters.html" },
  @{ Source = "BACKEND\PUBLIC\assets\masters-script-1.js"; Destination = "BACKEND\PUBLIC\assets\masters-script-1.js" },
  @{ Source = "BACKEND\PUBLIC\assets\masters-script-2.js"; Destination = "BACKEND\PUBLIC\assets\masters-script-2.js" },
  @{ Source = "BACKEND\PUBLIC\dpr.html"; Destination = "BACKEND\PUBLIC\dpr.html" },
  @{ Source = "BACKEND\PUBLIC\assets\dpr-script-1.js"; Destination = "BACKEND\PUBLIC\assets\dpr-script-1.js" },
  @{ Source = "BACKEND\PUBLIC\assets\dpr-script-2.js"; Destination = "BACKEND\PUBLIC\assets\dpr-script-2.js" },
  @{ Source = "BACKEND\PUBLIC\QCSupervisor.html"; Destination = "BACKEND\PUBLIC\QCSupervisor.html" },
  @{ Source = "BACKEND\PUBLIC\assets\QCSupervisor-script-1.js"; Destination = "BACKEND\PUBLIC\assets\QCSupervisor-script-1.js" },
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
