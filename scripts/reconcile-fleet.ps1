[CmdletBinding()]
param(
  [switch]$Down
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$reconcileFailed = $false

$DataDirectory = Join-Path (Get-Location) "data"
$LogDirectory = Join-Path $DataDirectory "logs"
$LogFile = Join-Path $LogDirectory "fleet-reconciler.log"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-FleetLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Get-EnvValue([string]$Name) {
  if (-not (Test-Path ".env")) { return $null }
  $prefix = [regex]::Escape($Name) + "="
  foreach ($line in @(Get-Content ".env" | Where-Object { $_ -match "^$prefix" })) {
    $value = $line.Substring($Name.Length + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2) -replace "\'", "'"
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return ""
}

function Get-ContainerStatus([string]$Name) {
  $output = & docker inspect --format "{{.State.Status}}" $Name 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return (($output | Select-Object -First 1).ToString().Trim())
}

function Get-FleetContainers {
  return @(& docker ps -a --format "{{.Names}}" | Where-Object { $_ -like "dsp-bot-fleet-*" })
}

function Remove-FleetContainer([string]$Name) {
  $status = Get-ContainerStatus $Name
  if ($null -eq $status) { return $true }

  Write-FleetLog "remove container=$Name status=$status"
  & docker rm -f $Name *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-FleetLog "ERROR remove failed container=$Name exit=$LASTEXITCODE"
    return $false
  }
  return $true
}

if ($Down) {
  foreach ($container in Get-FleetContainers) {
    if (-not (Remove-FleetContainer $container)) {
      $reconcileFailed = $true
    }
  }
  Write-FleetLog "down complete failed=$reconcileFailed"
  if ($reconcileFailed) { exit 1 }
  exit 0
}

$managementPort = Get-EnvValue "MANAGEMENT_API_PORT"
if ([string]::IsNullOrWhiteSpace($managementPort)) { $managementPort = "3002" }

$managementKey = Get-EnvValue "MANAGEMENT_API_KEY"
if ([string]::IsNullOrWhiteSpace($managementKey)) {
  throw "MANAGEMENT_API_KEY is required for fleet reconciliation."
}

$headers = @{
  Authorization = "Bearer $managementKey"
}

try {
  $fleet = Invoke-RestMethod -Uri "http://127.0.0.1:$managementPort/api/fleet" -Headers $headers -Method Get -TimeoutSec 10
} catch {
  Write-FleetLog "ERROR management API unavailable: $($_.Exception.Message)"
  exit 1
}

$desired = @{}
foreach ($identity in @($fleet.identities)) {
  if (
    $identity.id -and
    $identity.id -ne "primary" -and
    $identity.enabled -eq $true -and
    $identity.credentialConfigured -eq $true
  ) {
    $desired[$identity.id] = "dsp-bot-fleet-$($identity.id)"
  }
}

foreach ($container in Get-FleetContainers) {
  if (-not ($desired.Values -contains $container)) {
    if (-not (Remove-FleetContainer $container)) {
      $reconcileFailed = $true
    }
  }
}

foreach ($entry in $desired.GetEnumerator()) {
  $identityId = $entry.Key
  $containerName = $entry.Value
  $status = Get-ContainerStatus $containerName
  $fleetIdentity = @($fleet.identities | Where-Object { $_.id -eq $identityId } | Select-Object -First 1)
  $fleetStatus = if ($fleetIdentity.Count -gt 0 -and $fleetIdentity[0].status) { [string]$fleetIdentity[0].status } else { "unknown" }

  if ($status -eq "running" -and $fleetStatus -in @("starting", "ready")) {
    Write-FleetLog "healthy container=$containerName identity=$identityId fleetStatus=$fleetStatus"
    continue
  }

  if ($null -ne $status) {
    Write-FleetLog "restart container=$containerName identity=$identityId containerStatus=$status fleetStatus=$fleetStatus"
    if (-not (Remove-FleetContainer $containerName)) {
      $reconcileFailed = $true
      continue
    }
  }

  Write-FleetLog "start identity=$identityId container=$containerName"
  & docker compose run -d --no-deps --name $containerName -e "BOT_IDENTITY_ID=$identityId" bot *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-FleetLog "ERROR start failed identity=$identityId container=$containerName exit=$LASTEXITCODE"
    $reconcileFailed = $true
    continue
  }
  Write-FleetLog "started identity=$identityId container=$containerName"
}

Write-FleetLog "reconcile complete desired=$($desired.Count) failed=$reconcileFailed"
if ($reconcileFailed) { exit 1 }
exit 0
