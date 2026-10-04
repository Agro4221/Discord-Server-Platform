[CmdletBinding()]
param(
  [switch]$SkipLavalink
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Get-EnvValue([string]$Name, [string]$Default = "") {
  if (-not (Test-Path ".env")) { return $Default }
  $prefix = [regex]::Escape($Name) + "="
  foreach ($line in @(Get-Content ".env" | Where-Object { $_ -match "^$prefix" })) {
    $value = $line.Substring($Name.Length + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2) -replace "\'", "'"
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return $Default
}

function Assert-Ok([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "RELEASE GATE FAILED: $Message" }
  Write-Host "OK: $Message"
}

function Get-Json([string]$Uri, [hashtable]$Headers = @{}) {
  return Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Get -TimeoutSec 10
}

$healthPort = Get-EnvValue "HEALTH_PORT" "3001"
$managementPort = Get-EnvValue "MANAGEMENT_API_PORT" "3002"
$dashboardPort = Get-EnvValue "DASHBOARD_PORT" "3000"
$lavalinkHost = Get-EnvValue "LAVALINK_HOST" "127.0.0.1"
$lavalinkPort = Get-EnvValue "LAVALINK_PORT" "2333"
$lavalinkPassword = Get-EnvValue "LAVALINK_PASSWORD" ""

Write-Host "=== Discord Server Platform local release gate ==="
Write-Host "Health: $healthPort  Management: $managementPort  Dashboard: $dashboardPort"
Write-Host ""

& docker compose ps
Assert-Ok ($LASTEXITCODE -eq 0) "Docker Compose project is reachable"

$runningServices = @(& docker compose ps --services 2>$null)
Assert-Ok ($LASTEXITCODE -eq 0) "Docker Compose service inventory is available"
foreach ($service in @("postgres", "lavalink", "lavalink2", "bot", "dashboard")) {
  Assert-Ok ($runningServices -contains $service) ("Docker Compose service is running: " + $service)
}

$health = Get-Json ("http://127.0.0.1:" + $healthPort + "/health")
Assert-Ok ($health.status -eq "ready") "Bot health status is ready"
Assert-Ok ($health.discord -eq "ready") "Discord Gateway is ready"
Assert-Ok ($health.database -eq "ready") "Database is ready"

$moduleStatuses = @($health.modules.psobject.Properties | ForEach-Object { [string]$_.Value })
Assert-Ok (-not ($moduleStatuses -contains "down")) "No bot module reports down state"

$managementKey = Get-EnvValue "MANAGEMENT_API_KEY"
Assert-Ok (-not [string]::IsNullOrWhiteSpace($managementKey)) "Management API key is configured"
$headers = @{ Authorization = "Bearer " + $managementKey }
$fleet = Get-Json ("http://127.0.0.1:" + $managementPort + "/api/fleet") $headers
Assert-Ok ($null -ne $fleet.identities) "Fleet endpoint responds with identity state"

$enabledIdentities = @($fleet.identities | Where-Object { $_.enabled -eq $true })

$expectedFleetContainers = @{}
foreach ($identity in @($fleet.identities)) {
  if (
    $identity.id -and
    $identity.id -ne "primary" -and
    $identity.enabled -eq $true -and
    $identity.credentialConfigured -eq $true
  ) {
    $expectedFleetContainers["dsp-bot-fleet-$($identity.id)"] = $true
  }
}

$runningFleetContainers = @(& docker ps --format "{{.Names}}" 2>$null | Where-Object { $_ -like "dsp-bot-fleet-*" })
Assert-Ok ($LASTEXITCODE -eq 0) "Docker Fleet container inventory is available"
foreach ($container in $runningFleetContainers) {
  Assert-Ok ($expectedFleetContainers.ContainsKey($container)) ("No orphaned Fleet container is running: " + $container)
}

foreach ($identity in $enabledIdentities) {
  Assert-Ok ($identity.credentialConfigured -eq $true) ("Identity " + $identity.id + " has stored credentials")
  Assert-Ok ($identity.restartRequired -ne $true) ("Identity " + $identity.id + " has no pending restart")
  Assert-Ok ($identity.status -eq "ready") ("Identity " + $identity.id + " reports ready")
  Assert-Ok ($identity.connected -eq $true) ("Identity " + $identity.id + " reports connected")
}

try {
  Invoke-WebRequest -Uri ("http://127.0.0.1:" + $dashboardPort + "/") -UseBasicParsing -TimeoutSec 10 | Out-Null
  Write-Host "OK: Dashboard is reachable"
} catch {
  throw "RELEASE GATE FAILED: Dashboard is not reachable: $($_.Exception.Message)"
}

if (-not $SkipLavalink) {
  Assert-Ok (-not [string]::IsNullOrWhiteSpace($lavalinkPassword)) "Lavalink password is configured"
  $lavalinkHeaders = @{ Authorization = $lavalinkPassword }
  foreach ($nodePort in @($lavalinkPort, 2334)) {
    try {
      $version = Get-Json ("http://" + $lavalinkHost + ":" + $nodePort + "/version") $lavalinkHeaders
      Assert-Ok ($null -ne $version) ("Lavalink node " + $nodePort + " responds to /version")
    } catch {
      throw "RELEASE GATE FAILED: Lavalink node " + $nodePort + " is unavailable: " + $_.Exception.Message
    }
  }
}

Write-Host ""
Write-Host "RELEASE GATE PASSED"
