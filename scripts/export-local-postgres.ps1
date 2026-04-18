#Requires -Version 5.1
<#
  Export your complete local Postgres DB to a file you can upload to the VPS.

  Uses pg_dump custom format (-Fc) with --no-owner --no-acl so restore into Docker works cleanly.

  Prerequisites: PostgreSQL client tools (pg_dump) on PATH — ideally same major version as the server
  (VPS compose uses postgres:14-alpine). If your PC is PG 18, restore usually still works; if not,
  install PostgreSQL 14 client tools or run pg_dump from a postgres:14 container pointed at your PC.

  Example:
    .\scripts\export-local-postgres.ps1 -Database jpsms -User postgres -Password "yourpw"
    .\scripts\export-local-postgres.ps1 -Database jpsms -OutFile S:\backups\jms.dump
#>
param(
  [string]$PgHost = "127.0.0.1",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$Password = "",
  [string]$Database = "jpsms",
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  throw "pg_dump not found. Add PostgreSQL bin to PATH, or install PostgreSQL command-line tools."
}

if (-not $OutFile) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $root = Resolve-Path (Join-Path $PSScriptRoot "..")
  $dist = Join-Path $root "dist"
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $OutFile = Join-Path $dist "jms_pg_backup_$stamp.dump"
}

$OutFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile)
$parent = Split-Path -Parent $OutFile
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

$env:PGPASSWORD = $Password
try {
  Write-Host "Dumping $Database @ ${PgHost}:${Port} as $User -> $OutFile"
  & pg_dump `
    --host=$PgHost `
    --port=$Port `
    --username=$User `
    --dbname=$Database `
    --format=custom `
    --no-owner `
    --no-acl `
    --file=$OutFile
  Write-Host "Done. For automatic import on the VPS: copy this file to the repo's seed folder as seed\restore.dump (or any .dump in seed\), then docker compose up -d --build."
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
