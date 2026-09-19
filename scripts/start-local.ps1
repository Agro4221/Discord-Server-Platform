[CmdletBinding()]
param(
  [switch]$Rebuild,
  [switch]$NoOpen,
  [switch]$Down
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Не найдено: $Name. Установи Docker Desktop и убедись, что команда доступна в PATH."
  }
}

function Get-EnvValue([string]$Name) {
  if (-not (Test-Path ".env")) { return $null }
  $prefix = [regex]::Escape($Name) + "="
  $line = Get-Content ".env" | Where-Object { $_ -match "^$prefix" } | Select-Object -First 1
  if ($null -eq $line) { return $null }
  return $line.Substring($Name.Length + 1)
}

function Set-EnvValue([string]$Name, [string]$Value) {
  $lines = if (Test-Path ".env") { @(Get-Content ".env") } else { @() }
  $pattern = "^" + [regex]::Escape($Name) + "="
  $replacement = "$Name=$Value"
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = $replacement
      $found = $true
      break
    }
  }
  if (-not $found) {
    $lines += $replacement
  }
  Set-Content -Path ".env" -Value $lines -Encoding UTF8
}

function New-Secret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return (([System.BitConverter]::ToString($bytes)) -replace "-", "").ToLowerInvariant()
}

Require-Command "docker"
docker compose version | Out-Null

if ($Down) {
  docker compose down
  exit 0
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Создан локальный .env из .env.example."
}

$token = Get-EnvValue "DISCORD_TOKEN"
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = Read-Host "Discord bot token"
  if ([string]::IsNullOrWhiteSpace($token)) { throw "DISCORD_TOKEN обязателен." }
  Set-EnvValue "DISCORD_TOKEN" $token
}

$clientId = Get-EnvValue "DISCORD_CLIENT_ID"
if ([string]::IsNullOrWhiteSpace($clientId)) {
  $clientId = Read-Host "Discord client ID"
  if ([string]::IsNullOrWhiteSpace($clientId)) { throw "DISCORD_CLIENT_ID обязателен." }
  Set-EnvValue "DISCORD_CLIENT_ID" $clientId
}

$adminPassword = Get-EnvValue "DASHBOARD_ADMIN_PASSWORD"
if ([string]::IsNullOrWhiteSpace($adminPassword)) {
  $adminPassword = Read-Host "Dashboard admin password"
  if ([string]::IsNullOrWhiteSpace($adminPassword)) { throw "DASHBOARD_ADMIN_PASSWORD обязателен." }
  Set-EnvValue "DASHBOARD_ADMIN_PASSWORD" $adminPassword
}

$generated = @{
  "MANAGEMENT_API_KEY" = 48
  "DASHBOARD_SESSION_SECRET" = 48
  "POSTGRES_PASSWORD" = 24
  "LAVALINK_PASSWORD" = 24
}
foreach ($entry in $generated.GetEnumerator()) {
  $current = Get-EnvValue $entry.Key
  if ([string]::IsNullOrWhiteSpace($current)) {
    Set-EnvValue $entry.Key (New-Secret $entry.Value)
  }
}

docker compose config | Out-Null

$upArgs = @("compose", "up", "-d")
if ($Rebuild) { $upArgs += "--build" }
& docker @upArgs
if ($LASTEXITCODE -ne 0) { throw "docker compose up завершился с кодом $LASTEXITCODE." }

$healthPort = Get-EnvValue "HEALTH_PORT"
if ([string]::IsNullOrWhiteSpace($healthPort)) { $healthPort = "3001" }

$dashboardPort = Get-EnvValue "DASHBOARD_PORT"
if ([string]::IsNullOrWhiteSpace($dashboardPort)) { $dashboardPort = "3000" }

$healthUrl = "http://127.0.0.1:$healthPort/health"
$dashboardUrl = "http://127.0.0.1:$dashboardPort/"

$ready = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
  try {
    Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3 | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $ready) {
  docker compose ps
  throw "Bot health endpoint не стал доступен: $healthUrl"
}

$dashboardReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  try {
    Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 3 | Out-Null
    $dashboardReady = $true
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $dashboardReady) {
  docker compose ps
  throw "Dashboard не стал доступен: $dashboardUrl"
}

Write-Host ""
Write-Host "Discord Server Platform запущена локально."
Write-Host "Control Center: $dashboardUrl"
Write-Host "Bot health:     $healthUrl"
Write-Host ""

if (-not $NoOpen) {
  Start-Process $dashboardUrl
}
