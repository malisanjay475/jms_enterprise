#Requires -Version 5.1
<#
  Dump local Postgres using the official postgres image (no Windows pg_dump install).
  Requires Docker Desktop running. Reaches the PC's Postgres via host.docker.internal.

  Example:
    .\scripts\export-db-via-docker.ps1 -Password 'Sanjay@541##'
#>
param(
  [string]$PgHost = "host.docker.internal",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$Password = "",
  [string]$Database = "jpsms",
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker not found. Install Docker Desktop, or install PostgreSQL and add pg_dump to PATH."
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutFile) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root "seed") | Out-Null
  $OutFile = Join-Path $root "seed\restore.dump"
}
$OutFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile)
$seedDir = Split-Path -Parent $OutFile
New-Item -ItemType Directory -Force -Path $seedDir | Out-Null

$seedDirWin = (Resolve-Path $seedDir).Path
$outLeaf = Split-Path -Leaf $OutFile

Write-Host "Writing: $OutFile"
Write-Host "Using: postgres:14 image, host=$PgHost port=$Port db=$Database user=$User"

$passArg = if ($Password) { "-e", "PGPASSWORD=$Password" } else { @() }

docker run --rm `
  @passArg `
  --mount "type=bind,source=$seedDirWin,target=/out" `
  postgres:14 `
  pg_dump -h $PgHost -p $Port -U $User -d $Database --format=custom --no-owner --no-acl -f "/out/$outLeaf"

Write-Host "Done. Copy folder seed to your VPS next to compose, then docker compose up -d --build."
