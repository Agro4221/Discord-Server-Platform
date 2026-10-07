[CmdletBinding()]
param(
  [switch]$Dashboard,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

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
      return $value
    }
  }
  return $Default
}

function Test-Http([string]$Uri, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-WebRequest -Uri $Uri -Headers $Headers -Method Get -UseBasicParsing -TimeoutSec 5
    return @{
      ok = $true
      status = [int]$response.StatusCode
      body = $response.Content
    }
  } catch {
    $status = 0
    if ($_.Exception.Response) {
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    }
    return @{
      ok = $false
      status = $status
      body = ""
      error = $_.Exception.Message
    }
  }
}

function Get-PidSnapshot([string]$Path) {
  if (-not (Test-Path $Path)) {
    return @{ present = $false; alive = $false; pid = $null; process = $null }
  }

  $raw = (Get-Content $Path -Raw).Trim()
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) {
    return @{ present = $true; alive = $false; pid = $null; process = "invalid_pid" }
  }

  try {
    $process = Get-Process -Id $pidValue -ErrorAction Stop
    return @{
      present = $true
      alive = $true
      pid = $pidValue
      process = $process.ProcessName
    }
  } catch {
    return @{ present = $true; alive = $false; pid = $pidValue; process = $null }
  }
}

$runtimeRoot = Join-Path (Get-Location) ".native-runtime"
$fleetRoot = Join-Path $runtimeRoot "fleet"
$healthPort = Get-EnvValue "HEALTH_PORT" "3001"
$managementPort = Get-EnvValue "MANAGEMENT_API_PORT" "3002"
$dashboardPort = Get-EnvValue "DASHBOARD_PORT" "3000"
$managementKey = Get-EnvValue "MANAGEMENT_API_KEY" ""

$report = [ordered]@{
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
  runtime = "native-windows"
  node = @{
    installed = $false
    version = $null
  }
  processes = [ordered]@{}
  services = [ordered]@{}
  fleet = @{
    authenticated = $false
    identities = @()
    error = $null
  }
}

try {
  $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if ($node) {
    $report.node.installed = $true
    $report.node.version = (& node.exe --version).Trim()
  }
} catch {
  $report.node.error = $_.Exception.Message
}

$report.processes.primaryBot = Get-PidSnapshot (Join-Path $runtimeRoot "bot.pid")
$report.processes.fleetSupervisor = Get-PidSnapshot (Join-Path $runtimeRoot "fleet.pid")
if ($Lavalink2) {
}
if ($Dashboard) {
  $report.processes.dashboard = Get-PidSnapshot (Join-Path $runtimeRoot "dashboard.pid")
}

$health = Test-Http ("http://127.0.0.1:" + $healthPort + "/health")
$report.services.botHealth = @{
  ok = $health.status -eq 200
  httpStatus = $health.status
  payload = if ($health.body) { try { $health.body | ConvertFrom-Json } catch { $health.body } } else { $null }
  error = $health.error
}

$unauthenticatedFleet = Test-Http ("http://127.0.0.1:" + $managementPort + "/api/fleet")
$report.services.managementUnauthenticated = @{
  expectedStatus = 401
  actualStatus = $unauthenticatedFleet.status
  ok = $unauthenticatedFleet.status -eq 401
  error = $unauthenticatedFleet.error
}

if (-not [string]::IsNullOrWhiteSpace($managementKey)) {
  $fleet = Test-Http ("http://127.0.0.1:" + $managementPort + "/api/fleet") @{ Authorization = "Bearer " + $managementKey }
  if ($fleet.status -eq 200 -and $fleet.body) {
    try {
      $data = $fleet.body | ConvertFrom-Json
      $report.fleet.authenticated = $true
      $report.fleet.identities = @($data.identities | ForEach-Object {
        [ordered]@{
          id = $_.id
          enabled = $_.enabled
          status = $_.status
          connected = $_.connected
          credentialConfigured = $_.credentialConfigured
          restartRequired = $_.restartRequired
          guildCount = $_.guildCount
          lastSeenAt = $_.lastSeenAt
        }
      })
    } catch {
      $report.fleet.error = "invalid_fleet_response"
    }
  } else {
    if ($fleet.error) {
      $report.fleet.error = $fleet.error
    } else {
      $report.fleet.error = "management_status_" + $fleet.status
    }
  }
} else {
  $report.fleet.error = "management_api_key_not_configured"
}

if ($Dashboard) {
  $dashboard = Test-Http ("http://127.0.0.1:" + $dashboardPort + "/")
  $report.services.dashboard = @{
    ok = $dashboard.status -eq 200
    httpStatus = $dashboard.status
    error = $dashboard.error
  }
}

$ytDlp = Get-Command "yt-dlp.exe" -ErrorAction SilentlyContinue
$ffmpeg = Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue
$report.services.musicTooling = @{
  ytDlp = if ($ytDlp) { @{ ok = $true; version = (& $ytDlp.Source --version).Trim() } } else { @{ ok = $false; error = "yt_dlp_not_found" } }
  ffmpeg = if ($ffmpeg) { @{ ok = $true; version = ((& $ffmpeg.Source -version | Select-Object -First 1).Trim()) } } else { @{ ok = $false; error = "ffmpeg_not_found" } }
}


if ($Json) {
  $report | ConvertTo-Json -Depth 8
  exit 0
}

Write-Host "=== Discord Server Platform native diagnostics ==="
Write-Host ("UTC: " + $report.timestamp)
$nodeVersion = "not found"
if ($report.node.version) { $nodeVersion = [string]$report.node.version }
Write-Host ("Node.js: " + $nodeVersion)
Write-Host ""

foreach ($name in @("primaryBot", "fleetSupervisor", "dashboard")) {
  if ($report.processes.Contains($name)) {
    $p = $report.processes[$name]
    $processState = "DOWN"
    if ($p.alive) { $processState = "ALIVE" }
    $processPid = "—"
    if ($null -ne $p.pid) { $processPid = [string]$p.pid }
    $processName = "—"
    if ($p.process) { $processName = [string]$p.process }
    Write-Host ("PROCESS {0}: {1} pid={2} process={3}" -f $name, $processState, $processPid, $processName)
  }
}

$botHealth = $report.services.botHealth
$botHealthState = "FAIL"
if ($botHealth.ok) { $botHealthState = "OK" }
Write-Host ("BOT HEALTH: http={0} status={1}" -f $botHealth.httpStatus, $botHealthState)
$managementAuth = $report.services.managementUnauthenticated
$managementAuthState = "FAIL"
if ($managementAuth.ok) { $managementAuthState = "OK" }
Write-Host ("MANAGEMENT AUTH: expected=401 actual={0} status={1}" -f $managementAuth.actualStatus, $managementAuthState)
$fleetAuthState = "NO"
if ($report.fleet.authenticated) { $fleetAuthState = "YES" }
Write-Host ("FLEET AUTHENTICATED: {0} identities={1}" -f $fleetAuthState, @($report.fleet.identities).Count)


Write-Host ""
Write-Host "Diagnostics are read-only. Credentials are not printed."
