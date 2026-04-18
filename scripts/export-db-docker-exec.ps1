#Requires -Version 5.1
<#
  Dump Postgres running in a local Docker container (pg_dump inside container + docker cp).

  If -Container is omitted, uses the first running container whose image name contains "postgres".

  Example:
    .\scripts\export-db-docker-exec.ps1 -Password 'Sanjay@541##'
    .\scripts\export-db-docker-exec.ps1 -Container backend-db-1 -Password 'Sanjay@541##'
#>
param(
  [string]$Container = "",
  [string]$User = "postgres",
  [string]$Database = "jpsms",
  [string]$Password = "",
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker not found."
}

# PowerShell 5 treats native stderr (e.g. "no such object") as errors — use cmd for quiet inspect.
function Test-DockerContainerExists([string]$name) {
  if (-not $name) { return $false }
  $safe = $name.Replace('"', '')
  cmd /c "docker inspect ""$safe"" >nul 2>nul" | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Find-FirstPostgresContainer {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    $lines = @(docker ps --format "{{.Names}}`t{{.Image}}`t{{.Ports}}" 2>$null)
  } finally {
    $ErrorActionPreference = $prev
  }
  $postgres = @()
  foreach ($line in $lines) {
    if (-not $line) { continue }
    $parts = $line -split "`t", 3
    if ($parts.Count -lt 2) { continue }
    $nm = $parts[0].Trim()
    $img = $parts[1]
    $prt = if ($parts.Count -gt 2) { $parts[2] } else { "" }
    if ($img -match '(?i)postgres') {
      $postgres += [PSCustomObject]@{ Name = $nm; Image = $img; Ports = $prt; Prefer = ($prt -match '5432') }
    }
  }
  $withPort = $postgres | Where-Object { $_.Prefer } | Select-Object -First 1
  if ($withPort) { return $withPort.Name }
  $any = $postgres | Select-Object -First 1
  if ($any) { return $any.Name }
  return $null
}

$resolved = $Container.Trim()
if (-not $resolved) {
  $resolved = Find-FirstPostgresContainer
}

if (-not $resolved) {
  Write-Host "No Postgres container found. Running docker ps:" -ForegroundColor Yellow
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
  throw "Start your Postgres container, or pass -Container 'NAME' from the NAMES column above."
}

if (-not (Test-DockerContainerExists $resolved)) {
  Write-Host "Container '$resolved' not found. Running docker ps:" -ForegroundColor Yellow
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
  throw "Fix -Container to match NAMES from the table above."
}

$Container = $resolved

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutFile) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root "seed") | Out-Null
  $OutFile = Join-Path $root "seed\restore.dump"
}
$OutFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile)
$seedDir = Split-Path -Parent $OutFile
New-Item -ItemType Directory -Force -Path $seedDir | Out-Null

$tmp = "/tmp/jms_restore_$(Get-Date -Format 'yyyyMMddHHmmss').dump"

Write-Host "Using container: $Container"
Write-Host "Dump inside container -> $tmp then copy to: $OutFile"

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
try {
  if ($Password) {
    docker exec -e "PGPASSWORD=$Password" $Container pg_dump `
      -U $User `
      -d $Database `
      --format=custom `
      --no-owner `
      --no-acl `
      -f $tmp
  } else {
    docker exec $Container pg_dump `
      -U $User `
      -d $Database `
      --format=custom `
      --no-owner `
      --no-acl `
      -f $tmp
  }

  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump inside container failed (wrong -Database, -User, or password?)."
  }

  docker cp "${Container}:${tmp}" $OutFile
  if ($LASTEXITCODE -ne 0) {
    throw "docker cp failed."
  }
} finally {
  $ErrorActionPreference = $prevEap
}
$safeC = $Container.Replace('"', '')
cmd /c "docker exec ""$safeC"" rm -f $tmp >nul 2>nul" | Out-Null

Write-Host "Done: $OutFile"
Write-Host "Upload seed folder to VPS, then docker compose up -d --build."
