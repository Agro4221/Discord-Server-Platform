[CmdletBinding()]
param(
  [switch]$Loop,
  [switch]$Down
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$runtimeRoot = Join-Path (Get-Location) ".native-runtime"
$fleetRoot = Join-Path $runtimeRoot "fleet"
$logRoot = Join-Path $runtimeRoot "logs"
New-Item -ItemType Directory -Force -Path $runtimeRoot, $fleetRoot, $logRoot | Out-Null
$logFile = Join-Path $logRoot "fleet-reconciler.log"

function Write-FleetLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

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

function Get-PidFile([string]$IdentityId) {
  return Join-Path $fleetRoot "$IdentityId.pid"
}

function Get-FleetPid([string]$IdentityId) {
  $pidFile = Get-PidFile $IdentityId
  if (-not (Test-Path $pidFile)) { return $null }

  $raw = (Get-Content $pidFile -Raw).Trim()
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }

  try {
    $process = Get-Process -Id $pidValue -ErrorAction Stop
    return $process
  } catch {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Stop-FleetProcess([string]$IdentityId) {
  $pidFile = Get-PidFile $IdentityId
  if (-not (Test-Path $pidFile)) { return $true }

  $raw = (Get-Content $pidFile -Raw).Trim()
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) { return $true }

  try {
    Get-Process -Id $pidValue -ErrorAction Stop | Out-Null
    Write-FleetLog "stop identity=$IdentityId pid=$pidValue"
    & taskkill.exe /PID $pidValue /T /F *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-FleetLog "ERROR stop failed identity=$IdentityId pid=$pidValue exit=$LASTEXITCODE"
      return $false
    }
  } catch {
    # Process already stopped.
  }
  return $true
}

function Start-FleetProcess([string]$IdentityId) {
  $safeId = $IdentityId -replace "[^a-zA-Z0-9_-]", "_"
  $stdout = Join-Path $logRoot "fleet-$safeId.out.log"
  $stderr = Join-Path $logRoot "fleet-$safeId.err.log"
  $oldIdentity = $env:BOT_IDENTITY_ID
  try {
    $env:BOT_IDENTITY_ID = $IdentityId
    $process = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "start", "-w", "apps/bot") -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  } catch {
    Write-FleetLog "ERROR start failed identity=$IdentityId error=$($_.Exception.Message)"
    return $false
  } finally {
    $env:BOT_IDENTITY_ID = $oldIdentity
  }

  Set-Content -Path (Get-PidFile $IdentityId) -Value $process.Id -Encoding ASCII
  Write-FleetLog "started identity=$IdentityId pid=$($process.Id)"
  return $true
}

function Get-FleetState {
  $managementPort = Get-EnvValue "MANAGEMENT_API_PORT" "3002"
  $managementKey = Get-EnvValue "MANAGEMENT_API_KEY"
  if ([string]::IsNullOrWhiteSpace($managementKey)) {
    throw "MANAGEMENT_API_KEY is required for native Fleet reconciliation."
  }

  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$managementPort/api/fleet" -Headers @{ Authorization = "Bearer $managementKey" } -Method Get -TimeoutSec 10
  } catch {
    Write-FleetLog "ERROR management API unavailable: $($_.Exception.Message)"
    throw
  }
}

function Reconcile-Once {
  $fleet = Get-FleetState
  $failed = $false
  $desired = @{}

  foreach ($identity in @($fleet.identities)) {
    if (
      $identity.id -and
      $identity.id -ne "primary" -and
      $identity.enabled -eq $true -and
      $identity.credentialConfigured -eq $true
    ) {
      $desired[[string]$identity.id] = $identity
    }
  }

  foreach ($file in @(Get-ChildItem -Path $fleetRoot -Filter "*.pid" -File -ErrorAction SilentlyContinue)) {
    $identityId = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    if (-not $desired.ContainsKey($identityId)) {
      if (-not (Stop-FleetProcess $identityId)) { $failed = $true }
    }
  }

  foreach ($entry in $desired.GetEnumerator()) {
    $identityId = $entry.Key
    $identity = $entry.Value
    $process = Get-FleetPid $identityId
    $healthyState = [string]$identity.status -in @("starting", "ready") -and $identity.restartRequired -ne $true -and $identity.connected -eq $true

    if ($null -ne $process -and $healthyState) {
      Write-FleetLog "healthy identity=$identityId pid=$($process.Id) status=$($identity.status)"
      continue
    }

    if ($null -ne $process) {
      Write-FleetLog "restart identity=$identityId pid=$($process.Id) status=$($identity.status) restartRequired=$($identity.restartRequired) connected=$($identity.connected)"
      if (-not (Stop-FleetProcess $identityId)) {
        $failed = $true
        continue
      }
    }

    if (-not (Start-FleetProcess $identityId)) {
      $failed = $true
    }
  }

  Write-FleetLog "reconcile complete desired=$($desired.Count) failed=$failed"
  return (-not $failed)
}

if ($Down) {
  $failed = $false
  foreach ($file in @(Get-ChildItem -Path $fleetRoot -Filter "*.pid" -File -ErrorAction SilentlyContinue)) {
    $identityId = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    if (-not (Stop-FleetProcess $identityId)) { $failed = $true }
  }
  Write-FleetLog "down complete failed=$failed"
  if ($failed) { exit 1 }
  exit 0
}

$first = Reconcile-Once
if (-not $first) { exit 1 }
if (-not $Loop) { exit 0 }

while ($true) {
  Start-Sleep -Seconds 15
  try {
    if (-not (Reconcile-Once)) {
      Write-FleetLog "ERROR reconciliation cycle failed"
    }
  } catch {
    Write-FleetLog "ERROR reconciliation cycle aborted: $($_.Exception.Message)"
  }
}
