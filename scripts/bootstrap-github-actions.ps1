#Requires -Version 7.0
$ErrorActionPreference = "Stop"

function Get-RepoSlug {
    $url = (git config --get remote.origin.url 2>$null).Trim()
    if (-not $url) { throw "Run from repo root; git remote origin not set." }
    if ($url -match "github\.com[:/]([^/]+)/([^/.]+)(\.git)?$") {
        return "$($Matches[1])/$($Matches[2])"
    }
    throw "Could not parse GitHub owner/repo from remote: $url"
}

function Parse-DotEnvLine([string]$Line) {
    $t = $Line.Trim()
    if (-not $t -or $t.StartsWith("#")) { return $null }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { return $null }
    $name = $t.Substring(0, $i).Trim()
    $val = $t.Substring($i + 1).Trim()
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
    }
    return @{ Name = $name; Value = $val }
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$null = Get-Command gh -ErrorAction Stop
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Run: gh auth login   (needs repo admin for secrets)" }

$repo = Get-RepoSlug
Write-Host "Repository: $repo"

$envPath = Join-Path $PSScriptRoot "github-actions.secrets.env"
if (-not (Test-Path $envPath)) {
    Write-Host "Missing $envPath"
    Write-Host "Copy scripts/github-actions.secrets.env.example -> scripts/github-actions.secrets.env and edit."
    exit 1
}

$vars = @{}
foreach ($line in (Get-Content $envPath -Encoding UTF8)) {
    $p = Parse-DotEnvLine $line
    if ($null -ne $p) { $vars[$p.Name] = $p.Value }
}

function Set-OneSecret([string]$Name, [string]$Body) {
    if ([string]::IsNullOrWhiteSpace($Body)) {
        Write-Host "  skip $Name (empty)"
        return
    }
    Write-Host "  set $Name"
    $Body | gh secret set $Name --repo $repo
}

$keyFromFile = $false
if (-not [string]::IsNullOrWhiteSpace($vars["HOSTINGER_SSH_KEY_FILE"])) {
    $rel = $vars["HOSTINGER_SSH_KEY_FILE"]
    $path = if ([System.IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $root $rel }
    if (-not (Test-Path $path)) { throw "Key file not found: $path" }
    Set-OneSecret "HOSTINGER_SSH_KEY" (Get-Content $path -Raw -Encoding UTF8)
    $keyFromFile = $true
}

$secretNames = @(
    "HOSTINGER_SSH_HOST",
    "HOSTINGER_SSH_USER",
    "VPS_DEPLOY_PATH",
    "VPS_POSTGRES_PASSWORD",
    "VPS_SSH_PASSWORD",
    "HOSTINGER_SSH_KEY_PASSPHRASE",
    "VPS_GEMINI_API_KEY",
    "GHCR_PULL_TOKEN"
)
foreach ($n in $secretNames) {
    if ($vars.ContainsKey($n)) { Set-OneSecret $n $vars[$n] }
}

if (-not $keyFromFile -and $vars.ContainsKey("HOSTINGER_SSH_KEY")) {
    Set-OneSecret "HOSTINGER_SSH_KEY" $vars["HOSTINGER_SSH_KEY"]
}

Write-Host "Done. Verify: gh secret list --repo $repo"
