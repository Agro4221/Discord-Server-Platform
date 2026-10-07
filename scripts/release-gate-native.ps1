[CmdletBinding()]
param(
  [switch]$Dashboard
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$runtimeRoot = Join-Path (Get-Location) ".native-runtime"
function Get-EnvValue([string]$Name, [string]$Default = "") {
  if (-not (Test-Path ".env")) { return $Default }
  $prefix = [regex]::Escape($Name) + "="
  foreach ($line in @(Get-Content ".env")) {
    if ($line -match "^s*#") { continue }
    if ($line -match "^$prefix") {
      $value = $line.Substring($Name.Length + 1).Trim()
      if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
        $value = $value.Substring(1, $value.Length - 2) -replace "\'", "'"
      } elseif ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    }
  }
  return $Default
}

function Assert-Ok([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "NATIVE RELEASE GATE FAILED: $Message" }
  Write-Host "OK: $Message"
}

function Get-Json([string]$Uri, [hashtable]$Headers = @{}) {
  return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Get -TimeoutSec 10
}

function Assert-PidAlive([string]$PidFile, [string]$Description) {
  Assert-Ok (Test-Path $PidFile) ("PID file exists: " + $Description)
  $raw = (Get-Content $PidFile -Raw).Trim()
  $pidValue = 0
  Assert-Ok ([int]::TryParse($raw, [ref]$pidValue)) ("PID file is valid: " + $Description)
  try {
    Get-Process -Id $pidValue -ErrorAction Stop | Out-Null
    Write-Host "OK: Native process is alive: $Description"
  } catch {
    throw "NATIVE RELEASE GATE FAILED: Native process is not alive: $Description (pid=$pidValue)"
  }
  return $pidValue
}

$healthPort = Get-EnvValue "HEALTH_PORT" "3001"
$managementPort = Get-EnvValue "MANAGEMENT_API_PORT" "3002"
$dashboardPort = Get-EnvValue "DASHBOARD_PORT" "3000"
$managementKey = Get-EnvValue "MANAGEMENT_API_KEY" ""

Write-Host "=== Discord Server Platform native Windows release gate ==="
Write-Host "Health: $healthPort  Management: $managementPort  Dashboard: $dashboardPort"
Write-Host ""

Assert-PidAlive (Join-Path $runtimeRoot "bot.pid") "primary bot"
Assert-PidAlive (Join-Path $runtimeRoot "fleet.pid") "native Fleet supervisor"

$health = Get-Json ("http://127.0.0.1:" + $healthPort + "/health")
Assert-Ok ($health.status -eq "ready") "Bot health status is ready"
Assert-Ok ($health.discord -eq "ready") "Discord Gateway is ready"
Assert-Ok ($health.database -eq "ready") "Database is ready"
$moduleStatuses = @($health.modules.psobject.Properties | ForEach-Object { [string]$_.Value })
Assert-Ok (-not ($moduleStatuses -contains "down")) "No bot module reports down state"

Assert-Ok (-not [string]::IsNullOrWhiteSpace($managementKey)) "Management API key is configured"

try {
  Invoke-WebRequest -Uri ("http://127.0.0.1:" + $managementPort + "/api/fleet") -UseBasicParsing -Method Get -TimeoutSec 10 | Out-Null
  throw "Management API unexpectedly allowed an unauthenticated request"
} catch {
  $unauthorizedStatus = 0
  if ($_.Exception.Response) {
    try { $unauthorizedStatus = [int]$_.Exception.Response.StatusCode } catch { $unauthorizedStatus = 0 }
  }
  Assert-Ok ($unauthorizedStatus -eq 401) "Management API rejects unauthenticated requests"
}

$headers = @{ Authorization = "Bearer " + $managementKey }
$fleet = Get-Json ("http://127.0.0.1:" + $managementPort + "/api/fleet") $headers
Assert-Ok ($null -ne $fleet.identities) "Fleet endpoint responds with identity state"

$enabled = @($fleet.identities | Where-Object { $_.enabled -eq $true })
foreach ($identity in $enabled) {
  Assert-Ok ($identity.credentialConfigured -eq $true) ("Identity " + $identity.id + " has stored credentials")
  Assert-Ok ($identity.restartRequired -ne $true) ("Identity " + $identity.id + " has no pending restart")
  Assert-Ok ($identity.status -eq "ready") ("Identity " + $identity.id + " reports ready")
  Assert-Ok ($identity.connected -eq $true) ("Identity " + $identity.id + " reports connected")

  if ($identity.id -ne "primary") {
    $pidPath = Join-Path (Join-Path $runtimeRoot "fleet") ($identity.id + ".pid")
    Assert-PidAlive $pidPath ("secondary bot " + $identity.id) | Out-Null
  }
}

$secondaryPidFiles = @(Get-ChildItem (Join-Path $runtimeRoot "fleet") -Filter "*.pid" -File -ErrorAction SilentlyContinue)
$enabledSecondary = @($enabled | Where-Object { $_.id -and $_.id -ne "primary" } | ForEach-Object { [string]$_.id })
foreach ($pidFile in $secondaryPidFiles) {
  $identityId = [System.IO.Path]::GetFileNameWithoutExtension($pidFile.Name)
  Assert-Ok ($enabledSecondary -contains $identityId) ("No orphaned native Fleet process is tracked: " + $identityId)
}

if ($Dashboard) {
  try {
    Invoke-WebRequest -Uri ("http://127.0.0.1:" + $dashboardPort + "/") -UseBasicParsing -TimeoutSec 10 | Out-Null
    Assert-PidAlive (Join-Path $runtimeRoot "dashboard.pid") "Dashboard" | Out-Null
    Write-Host "OK: Dashboard is reachable"
  } catch {
    throw "NATIVE RELEASE GATE FAILED: Dashboard is not reachable: " + $_.Exception.Message
  }
}

$ytDlp = Get-Command "yt-dlp.exe" -ErrorAction SilentlyContinue
$ffmpeg = Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue
Assert-Ok ($null -ne $ytDlp) "yt-dlp is installed"
Assert-Ok ($null -ne $ffmpeg) "FFmpeg is installed"
if ($ytDlp) {
  $version = (& $ytDlp.Source --version).Trim()
  Write-Host "OK: yt-dlp $version"
}
if ($ffmpeg) {
  $version = (& $ffmpeg.Source -version | Select-Object -First 1).Trim()
  Write-Host "OK: $version"
}

Write-Host "NATIVE RELEASE GATE PASSED"
