[CmdletBinding()]
param(
  [switch]$Rebuild,
  [switch]$NoOpen,
  [switch]$Down
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
  # Ignore console encoding differences on older PowerShell hosts.
}

function Get-EnvValue([string]$Name) {
  if (-not (Test-Path ".env")) { return $null }
  $prefix = [regex]::Escape($Name) + "="
  $lines = @(Get-Content ".env" | Where-Object { $_ -match "^$prefix" })
  if ($lines.Count -eq 0) { return $null }
  foreach ($line in $lines) {
    $value = $line.Substring($Name.Length + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2) -replace "\\'", "'"
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }
  return ""
}

function Set-EnvValue([string]$Name, [string]$Value) {
  $lines = if (Test-Path ".env") { @(Get-Content ".env") } else { @() }
  $pattern = "^" + [regex]::Escape($Name) + "="
  # Docker Compose treats single-quoted .env values literally.
  # Escape an apostrophe with a backslash so passwords/tokens survive intact.
  $escapedValue = $Value -replace "'", "\'"
  $replacement = "$Name='$escapedValue'"
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = $replacement
      $found = $true
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

function Find-DockerCli {
  $command = Get-Command "docker.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $binDir = Split-Path $candidate -Parent
      if (-not (($env:Path -split ";") -contains $binDir)) {
        $env:Path = "$binDir;$env:Path"
      }
      return $candidate
    }
  }

  return $null
}

function Find-DockerDesktop {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
    "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Invoke-DockerQuiet([string]$DockerCli, [string]$Arguments) {
  $commandLine = '"' + $DockerCli + '" ' + $Arguments + ' >nul 2>nul'
  & cmd.exe /d /c $commandLine
  return $LASTEXITCODE
}

function Test-DockerEngine([string]$DockerCli) {
  return ((Invoke-DockerQuiet $DockerCli "info") -eq 0)
}

function Start-DockerDesktop {
  try {
    $desktopCli = Get-Command "docker.exe" -ErrorAction SilentlyContinue
    if ($desktopCli) {
      $exitCode = Invoke-DockerQuiet $desktopCli.Source "desktop start"
      if ($exitCode -eq 0) {
        return $true
      }
    }
  } catch {
    # Fall back to starting Docker Desktop.exe directly.
  }

  $desktopExe = Find-DockerDesktop
  if ($desktopExe) {
    Start-Process -FilePath $desktopExe | Out-Null
    Write-Host "Starting Docker Desktop..."
    return $true
  }

  return $false
}

function Ensure-Docker {
  $docker = Find-DockerCli
  if (-not $docker) {
    throw "Docker CLI was not found. Install Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/"
  }

  Write-Host "Docker CLI: $docker"

  if (-not (Test-DockerEngine $docker)) {
    $started = Start-DockerDesktop
    if (-not $started) {
      throw "Docker Engine is not running and Docker Desktop.exe was not found. Start Docker Desktop manually and run the launcher again."
    }

    $ready = $false
    for ($attempt = 1; $attempt -le 90; $attempt++) {
      if (Test-DockerEngine $docker) {
        $ready = $true
        break
      }
      Start-Sleep -Seconds 2
    }

    if (-not $ready) {
      throw "Docker Desktop started, but the Docker Engine was not ready after 180 seconds. Open Docker Desktop, wait for Running status, then run the launcher again."
    }
  }

  if ((Invoke-DockerQuiet $docker "compose version") -ne 0) {
    throw "The 'docker compose' command is unavailable. Update or reinstall Docker Desktop."
  }
}

Ensure-Docker

function Get-ValueLength([string]$Value) {
  if ($null -eq $Value) { return 0 }
  return $Value.Length
}

function Show-DashboardPasswordDiagnostics {
  $hostPassword = Get-EnvValue "DASHBOARD_ADMIN_PASSWORD"
  $hostLength = Get-ValueLength $hostPassword
  Write-Host "Dashboard admin password configured in .env: $([bool](-not [string]::IsNullOrWhiteSpace($hostPassword))); length=$hostLength"

  try {
    $containerLength = docker compose exec -T dashboard sh -lc 'if [ -n "${DASHBOARD_ADMIN_PASSWORD+x}" ]; then printf "%s" "$DASHBOARD_ADMIN_PASSWORD" | wc -c; else printf "0"; fi'
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Dashboard container password: configured; length=$($containerLength.Trim())"
    } else {
      Write-Host "Dashboard container password: could not inspect."
    }
  } catch {
    Write-Host "Dashboard container password: could not inspect."
  }
}

if ($Down) {
  docker compose down
  exit 0
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created local .env from .env.example."
}

$token = Get-EnvValue "DISCORD_TOKEN"
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = Read-Host "Discord bot token"
  if ([string]::IsNullOrWhiteSpace($token)) { throw "DISCORD_TOKEN is required." }
  Set-EnvValue "DISCORD_TOKEN" $token
}

$clientId = Get-EnvValue "DISCORD_CLIENT_ID"
if ([string]::IsNullOrWhiteSpace($clientId)) {
  $clientId = Read-Host "Discord client ID"
  if ([string]::IsNullOrWhiteSpace($clientId)) { throw "DISCORD_CLIENT_ID is required." }
  Set-EnvValue "DISCORD_CLIENT_ID" $clientId
}

$authRequired = Get-EnvValue "DASHBOARD_AUTH_REQUIRED"
if ([string]::IsNullOrWhiteSpace($authRequired)) { $authRequired = "false" }

$adminPassword = Get-EnvValue "DASHBOARD_ADMIN_PASSWORD"
if ($authRequired -eq "true" -and [string]::IsNullOrWhiteSpace($adminPassword)) {
  $adminPassword = Read-Host "Dashboard admin password"
  if ([string]::IsNullOrWhiteSpace($adminPassword)) { throw "DASHBOARD_ADMIN_PASSWORD is required when Dashboard auth is enabled." }
  Set-EnvValue "DASHBOARD_ADMIN_PASSWORD" $adminPassword
}

if ([string]::IsNullOrWhiteSpace((Get-EnvValue "DASHBOARD_AUTH_REQUIRED"))) {
  Set-EnvValue "DASHBOARD_AUTH_REQUIRED" "false"
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
    $current = New-Secret $entry.Value
  }
  Set-EnvValue $entry.Key $current
}

docker compose config | Out-Null

$dbPassword = Get-EnvValue "POSTGRES_PASSWORD"
if ([string]::IsNullOrWhiteSpace($dbPassword)) {
  throw "POSTGRES_PASSWORD is required."
}

Write-Host "Preparing PostgreSQL..."
& docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL container could not be started."
}

$dbReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  & docker compose exec -T postgres pg_isready -U postgres -d discord_platform *> $null
  if ($LASTEXITCODE -eq 0) {
    $dbReady = $true
    break
  }
  Start-Sleep -Seconds 2
}
if (-not $dbReady) {
  docker compose logs --tail=80 postgres
  throw "PostgreSQL did not become ready."
}

# The official postgres image only applies POSTGRES_PASSWORD on first initialization.
# Our local volume can therefore contain an older password. Sync the existing role
# to the password currently configured in .env without touching the database data.
$sqlPassword = $dbPassword -replace "'", "''"
$alterSql = "ALTER USER postgres PASSWORD '$sqlPassword';"
& docker compose exec -T postgres psql -U postgres -d discord_platform -c $alterSql *> $null
if ($LASTEXITCODE -ne 0) {
  docker compose logs --tail=80 postgres
  throw "PostgreSQL password synchronization failed."
}

if ($Rebuild) {
  Write-Host "Rebuilding Docker images without cache..."
  & docker compose build --no-cache
  if ($LASTEXITCODE -ne 0) {
    throw "Docker image rebuild failed with exit code $LASTEXITCODE."
  }
}

# Normal starts intentionally avoid an image rebuild so a gaming session does not
# trigger a Next.js/Node/Java build unless the user explicitly asks for it.
& docker compose up -d
$composeExitCode = $LASTEXITCODE
if ($composeExitCode -ne 0) {
  Write-Host ""
  Write-Host "Docker Compose failed. Recent service logs:"
  docker compose ps
  docker compose logs --tail=80 lavalink lavalink2 postgres bot dashboard
  throw "docker compose up failed with exit code $composeExitCode."
}

Show-DashboardPasswordDiagnostics

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
  throw "Bot health endpoint did not become available: $healthUrl"
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
  throw "Dashboard did not become available: $dashboardUrl"
}

Write-Host ""
Write-Host "Discord Server Platform is running locally."
Write-Host "Control Center: $dashboardUrl"
Write-Host "Bot health:     $healthUrl"
Write-Host ""

if (-not $NoOpen) {
  Start-Process $dashboardUrl
}
