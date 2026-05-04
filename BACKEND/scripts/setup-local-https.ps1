param(
  [int]$HttpsPort = 3443,
  [string]$Passphrase = "jmslocalhttps"
)

$ErrorActionPreference = "Stop"

$backendRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$certDir = Join-Path $backendRoot "certs"
$pfxPath = Join-Path $certDir "jms-local-https.pfx"
$cerPath = Join-Path $certDir "jms-local-https.cer"
$envPath = Join-Path $backendRoot ".env"

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
  Select-Object -ExpandProperty IPAddress -Unique

$sanParts = @("DNS=localhost", "IPAddress=127.0.0.1")
foreach ($ip in $ips) {
  $sanParts += "IPAddress=$ip"
}
$sanText = "2.5.29.17={text}" + ($sanParts -join "&")

$subject = "CN=JMS Local HTTPS"
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject } | Select-Object -First 1
if ($existing) {
  Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $existing.Thumbprint) -Force
}

$cert = New-SelfSignedCertificate `
  -Subject $subject `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyExportPolicy Exportable `
  -KeyLength 2048 `
  -KeyAlgorithm RSA `
  -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(5) `
  -TextExtension @($sanText)

$securePass = ConvertTo-SecureString -String $Passphrase -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePass | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

$trusted = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint } | Select-Object -First 1
if (-not $trusted) {
  Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
}

function Set-EnvLine {
  param([string]$Path, [string]$Key, [string]$Value)
  $line = "$Key=$Value"
  if (!(Test-Path $Path)) {
    Set-Content -Path $Path -Value $line
    return
  }
  $content = Get-Content -Path $Path
  $matched = $false
  $updated = foreach ($entry in $content) {
    if ($entry -match "^\s*$([regex]::Escape($Key))=") {
      $matched = $true
      $line
    } else {
      $entry
    }
  }
  if (-not $matched) {
    $updated += $line
  }
  Set-Content -Path $Path -Value $updated
}

Set-EnvLine -Path $envPath -Key "HTTPS_ENABLED" -Value "true"
Set-EnvLine -Path $envPath -Key "HTTPS_PORT" -Value $HttpsPort
Set-EnvLine -Path $envPath -Key "HTTPS_PFX_PATH" -Value "certs/jms-local-https.pfx"
Set-EnvLine -Path $envPath -Key "HTTPS_PFX_PASSPHRASE" -Value $Passphrase

Write-Host "JMS local HTTPS certificate created."
Write-Host "PFX: $pfxPath"
Write-Host "Phone trust certificate: $cerPath"
Write-Host "HTTPS port configured: $HttpsPort"
Write-Host ""
Write-Host "Restart backend, then open on phone:"
foreach ($ip in $ips) {
  Write-Host "  https://$ip`:$HttpsPort/shifting_supervisor.html"
}
Write-Host ""
Write-Host "For phone camera access, install/trust the .cer on the phone if the browser shows a certificate warning."
