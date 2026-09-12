<#
  One-click OTA publish for the JMS QC app.

  What it does:
    1. Reads versionCode / versionName from app/build.gradle.kts
    2. Uploads your built APK to the LOCAL server's /api/qc-app/publish endpoint
    3. The server writes /qc-app/version.json + stores the APK as jms-qc.apk

  Then on the phone: just re-open the QC app -> an "Update available" banner
  appears on the Job Queue -> tap Update. No cable, no re-install from Studio.

  IMPORTANT — before running this, build the APK once in Android Studio:
    Build menu -> Build Bundle(s) / APK(s) -> Build APK(s)
  (produces app/build/outputs/apk/debug/app-debug.apk)

  Every publish must have a HIGHER versionCode than what's installed, or the
  phone won't offer the update. The version is bumped in build.gradle.kts per change.

  Usage (from anywhere):
    powershell -File android_qc/tools/publish-qc-update.ps1 -User admin -Password "****"

  Optional:
    -Server   default http://192.168.1.173:3001   (the LOCAL factory server)
    -Apk      default the debug APK path
    -Notes    release notes shown in the update banner
#>
param(
    [string]$Server = "http://192.168.1.173:3001",
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$Apk = "",
    [string]$Notes = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot          # android_qc/
if (-not $Apk) { $Apk = Join-Path $root "app\build\outputs\apk\debug\app-debug.apk" }

$gradlePath = Join-Path $root "app\build.gradle.kts"
$gradle = Get-Content $gradlePath -Raw
$vc = [regex]::Match($gradle, 'versionCode\s*=\s*(\d+)').Groups[1].Value
$vn = [regex]::Match($gradle, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value

if (-not (Test-Path $Apk)) {
    Write-Host "APK not found: $Apk" -ForegroundColor Red
    Write-Host "Build it first in Android Studio: Build -> Build Bundle(s)/APK(s) -> Build APK(s)" -ForegroundColor Yellow
    exit 1
}

Write-Host "Publishing JMS QC v$vn (versionCode $vc)" -ForegroundColor Cyan
Write-Host "  APK   : $Apk"
Write-Host "  Server: $Server"

# curl.exe ships with Windows 10/11 and handles multipart uploads cleanly.
& curl.exe -s -S -X POST "$Server/api/qc-app/publish" `
    -F "username=$User" `
    -F "password=$Password" `
    -F "versionCode=$vc" `
    -F "versionName=$vn" `
    -F "notes=$Notes" `
    -F "apk=@$Apk;type=application/vnd.android.package-archive"

Write-Host ""
Write-Host "Done. Re-open the QC app on the phone and tap the Update banner." -ForegroundColor Green
