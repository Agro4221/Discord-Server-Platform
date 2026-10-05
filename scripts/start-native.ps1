[CmdletBinding()]
param(
  [switch]$Dashboard,
  [switch]$NoDashboard,
  [switch]$Lavalink2,
  [switch]$Rebuild,
  [switch]$NoOpen,
  [switch]$Status,
  [switch]$Down
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

$runtimeRoot = Join-Path (Get-Location) ".native-runtime"
$logRoot = Join-Path $runtimeRoot "logs"
New-Item -ItemType Directory -Force -Path $runtimeRoot, $logRoot | Out-Null

function Get-EnvValue([string]$Name) {
  if (-not (Test-Path ".env")) { return $null }
  $prefix = [regex]::Escape($Name) + "="
  foreach ($line in @(Get-Content ".env")) {
    if ($line -match "^\s*#") { continue }
    if ($line -match "^$prefix") {
      $value = $line.Substring($Name.Length + 1).Trim()
      if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
        $value = $value.Substring(1, $value.Length - 2) -replace "\\'", "'"
      } elseif ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

function Set-EnvValue([string]$Name, [string]$Value) {
  $lines = if (Test-Path ".env") { @(Get-Content ".env") } else { @() }
  $pattern = "^" + [regex]::Escape($Name) + "="
  $escaped = $Value -replace "'", "\'"
  $replacement = "$Name='$escaped'"
  $found = $false

  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = $replacement
      $found = $true
    }
  }

  if (-not $found) { $lines += $replacement }
  Set-Content -Path ".env" -Value $lines -Encoding UTF8
}

function Import-EnvFile {
  foreach ($line in @(Get-Content ".env")) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }
    if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$") { continue }

    $name = $Matches[1]
    $value = $Matches[2].Trim()

    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2) -replace "\\'", "'"
    } elseif ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

function New-Secret([int]$Length = 32) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return (([System.BitConverter]::ToString($bytes)) -replace "-", "").ToLowerInvariant()
}

function Stop-NativeProcess([string]$Name) {
  $pidFile = Join-Path $runtimeRoot "$Name.pid"
  if (-not (Test-Path $pidFile)) { return }

  $raw = (Get-Content $pidFile -Raw).Trim()
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue

  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) { return }

  try {
    Get-Process -Id $pidValue -ErrorAction Stop | Out-Null
    & taskkill.exe /PID $pidValue /T /F *> $null
  } catch {}
}

function Rotate-Log([string]$Path, [int64]$MaxBytes = 10MB) {
  if (-not (Test-Path $Path -PathType Leaf)) { return }
  if ((Get-Item $Path).Length -le $MaxBytes) { return }

  $rotated = "$Path.1"
  Remove-Item $rotated -Force -ErrorAction SilentlyContinue
  Move-Item -Path $Path -Destination $rotated -Force
}

function Start-NativeProcess(
  [string]$Name,
  [string]$FilePath,
  [string[]]$ArgumentList,
  [string]$WorkingDirectory,
  [string]$LogName
) {
  Stop-NativeProcess $Name
  $stdout = Join-Path $logRoot "$LogName.out.log"
  $stderr = Join-Path $logRoot "$LogName.err.log"
  Rotate-Log $stdout
  Rotate-Log $stderr

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  Set-Content -Path (Join-Path $runtimeRoot "$Name.pid") -Value $process.Id -Encoding ASCII
  return $process
}

function Wait-Http([string]$Url, [int]$Attempts, [int]$DelaySeconds) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
  return $false
}

function Wait-Tcp([string]$HostName, [int]$Port, [int]$Attempts, [int]$DelaySeconds) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $task = $client.ConnectAsync($HostName, $Port)
      if ($task.Wait(1500) -and $client.Connected) {
        return $true
      }
    } catch {} finally {
      $client.Dispose()
    }
    Start-Sleep -Seconds $DelaySeconds
  }
  return $false
}

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($machine, $user, $env:Path) -join ";"
}

function Invoke-WingetInstall([string]$PackageId, [string[]]$ExtraArguments = @()) {
  $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "Windows App Installer (winget) was not found. Install App Installer from Microsoft Store, then run start.bat again."
  }

  Write-Host "Installing dependency: $PackageId"
  & winget.exe install --id $PackageId --exact --source winget --silent --accept-source-agreements --accept-package-agreements --disable-interactivity @ExtraArguments
  if ($LASTEXITCODE -ne 0) {
    throw "winget failed to install $PackageId (exit code $LASTEXITCODE)."
  }
  Refresh-ProcessPath
}

function Ensure-Node {
  Refresh-ProcessPath
  $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if (-not $node) {
    Invoke-WingetInstall "OpenJS.NodeJS.LTS"
    $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  }
  if (-not $node) { throw "Node.js installation completed but node.exe is still unavailable." }

  $versionText = (& node.exe --version).Trim().TrimStart("v")
  $parts = $versionText.Split(".")
  $major = 0
  $minor = 0
  if ($parts.Count -ge 2) {
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
  }
  if ($major -lt 24 -or ($major -eq 24 -and $minor -lt 17)) {
    throw "Native mode requires Node.js 24.17+. Detected $versionText."
  }
  Write-Host "Node.js: $versionText"
}

function Ensure-NpmDependencies {
  $marker = Join-Path $runtimeRoot "npm-install.marker"
  $packageFiles = @(
    "package.json",
    "apps/bot/package.json",
    "apps/dashboard/package.json",
    "packages/domain/package.json"
  )
  $needsInstall = -not (Test-Path $marker)
  if (-not $needsInstall) {
    $markerTime = (Get-Item $marker).LastWriteTimeUtc
    $needsInstall = @($packageFiles | Where-Object {
      Test-Path $_ -PathType Leaf -and (Get-Item $_).LastWriteTimeUtc -gt $markerTime
    }).Count -gt 0
  }
  if ($needsInstall) {
    Write-Host "Installing/updating npm dependencies (first run or package change)..."
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    Set-Content -Path $marker -Value (Get-Date).ToString("o") -Encoding ASCII
  }
}

function Try-StartPostgresService {
  $services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like "postgresql*" -and $_.Status -ne "Running"
  })

  foreach ($service in $services) {
    try {
      Start-Service -Name $service.Name -ErrorAction Stop
      Write-Host "PostgreSQL service started: $($service.Name)"
      return $true
    } catch {
    }
  }

  return $false
}

function Add-PostgresToPath {
  $root = Join-Path $env:ProgramFiles "PostgreSQL"
  if (-not (Test-Path $root -PathType Container)) { return }
  $dirs = @(Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
  foreach ($dir in $dirs) {
    $bin = Join-Path $dir.FullName "bin"
    if (Test-Path (Join-Path $bin "pg_isready.exe")) {
      if (-not (($env:Path -split ";") -contains $bin)) { $env:Path = "$bin;$env:Path" }
      return
    }
  }
}

function Install-Postgres([string]$Password) {
  $override = "--mode unattended --unattendedmodeui none --superpassword $Password --serverport 5432"
  Invoke-WingetInstall "PostgreSQL.PostgreSQL.17" @("--override", $override)
  Add-PostgresToPath
}

function Ensure-Postgres {
  Refresh-ProcessPath
  Add-PostgresToPath
  $pgIsReady = Get-Command "pg_isready.exe" -ErrorAction SilentlyContinue
  $psql = Get-Command "psql.exe" -ErrorAction SilentlyContinue
  $postgresPassword = Get-EnvValue "POSTGRES_PASSWORD"
  if ([string]::IsNullOrWhiteSpace($postgresPassword)) {
    throw "POSTGRES_PASSWORD is required before PostgreSQL setup."
  }

  if (-not $pgIsReady -or -not $psql) {
    Install-Postgres $postgresPassword
    Refresh-ProcessPath
    Add-PostgresToPath
    $pgIsReady = Get-Command "pg_isready.exe" -ErrorAction SilentlyContinue
    $psql = Get-Command "psql.exe" -ErrorAction SilentlyContinue
  }
  if (-not $pgIsReady -or -not $psql) {
    throw "PostgreSQL installation completed but pg_isready.exe/psql.exe are unavailable."
  }

  $dbUrl = Get-EnvValue "DATABASE_URL"
  $autoConfiguredDatabase = $false
  if ([string]::IsNullOrWhiteSpace($dbUrl) -or $dbUrl -match "://USER:PASSWORD@") {
    $dbUrl = "postgresql://postgres:$postgresPassword@127.0.0.1:5432/discord_platform"
    Set-EnvValue "DATABASE_URL" $dbUrl
    $env:DATABASE_URL = $dbUrl
    $autoConfiguredDatabase = $true
  }

  & pg_isready.exe -d $dbUrl *> $null
  if ($LASTEXITCODE -ne 0) {
    Try-StartPostgresService | Out-Null
    Start-Sleep -Seconds 2
    & pg_isready.exe -d $dbUrl *> $null
  }
  if ($LASTEXITCODE -ne 0) {
    $candidate = Read-Host "PostgreSQL is not reachable. Enter DATABASE_URL (or press Enter to abort)"
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      throw "PostgreSQL is not reachable at the configured DATABASE_URL."
    }
    Set-EnvValue "DATABASE_URL" $candidate
    Import-EnvFile
    & pg_isready.exe -d $env:DATABASE_URL *> $null
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL is still not reachable at the supplied DATABASE_URL." }
  }

  & psql.exe $env:DATABASE_URL -c "SELECT 1;" *> $null
  if ($LASTEXITCODE -ne 0 -and $autoConfiguredDatabase) {
    $adminUrl = "postgresql://postgres:$postgresPassword@127.0.0.1:5432/postgres"
    & psql.exe $adminUrl -c "SELECT 1;" *> $null
    if ($LASTEXITCODE -eq 0) {
      $exists = (& psql.exe $adminUrl -tAc "SELECT 1 FROM pg_database WHERE datname='discord_platform';" 2>$null).Trim()
      if ($exists -ne "1") {
        & psql.exe $adminUrl -c "CREATE DATABASE discord_platform;" *> $null
      }
      & psql.exe $env:DATABASE_URL -c "SELECT 1;" *> $null
    }
  }
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL accepted no connection for DATABASE_URL." }

  Write-Host "PostgreSQL: ready"
}

function Ensure-LavalinkJar {
  $configured = Get-EnvValue "LAVALINK_JAR_PATH"
  if ([string]::IsNullOrWhiteSpace($configured)) {
    $configured = ".\infrastructure\lavalink\lavalink.jar"
    Set-EnvValue "LAVALINK_JAR_PATH" $configured
  }

  $resolved = if ([System.IO.Path]::IsPathRooted($configured)) { $configured } else { Join-Path (Get-Location) $configured }
  if (Test-Path $resolved -PathType Leaf) { return (Resolve-Path $resolved).Path }

  $version = "4.2.2"
  $downloadUrl = "https://github.com/lavalink-devs/Lavalink/releases/download/$version/Lavalink.jar"
  $expectedSha256 = "8CB801E591072C3689FAFD71CCF571A95A4EAD3CC35DF045E157D763D89119A"
  Write-Host "Downloading Lavalink $version..."
  try {
    $targetDir = Split-Path $resolved -Parent
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    Invoke-WebRequest -Uri $downloadUrl -OutFile $resolved -UseBasicParsing
    $actual = (Get-FileHash -Path $resolved -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actual -ne $expectedSha256) {
      Remove-Item $resolved -Force -ErrorAction SilentlyContinue
      throw "Lavalink SHA-256 verification failed."
    }
  } catch {
    Remove-Item $resolved -Force -ErrorAction SilentlyContinue
    throw "Could not download/verify Lavalink $version: $($_.Exception.Message)"
  }
  return (Resolve-Path $resolved).Path
}

function Ensure-Java {
  Refresh-ProcessPath
  $java = Get-Command "java.exe" -ErrorAction SilentlyContinue
  if (-not $java) {
    Invoke-WingetInstall "Microsoft.OpenJDK.17"
    Refresh-ProcessPath
    $java = Get-Command "java.exe" -ErrorAction SilentlyContinue
  }
  if (-not $java) { throw "Java installation completed but java.exe is still unavailable." }

  $versionText = (& java.exe -version 2>&1 | Select-Object -First 1).ToString()
  if ($versionText -notmatch '"(1[7-9]|[2-9][0-9]).') {
    throw "Java 17+ is required by the native Lavalink runtime. Detected: $versionText"
  }
  return $java.Source
}

function Ensure-Secret([string]$Name, [int]$Length) {
  $value = Get-EnvValue $Name
  if ([string]::IsNullOrWhiteSpace($value)) { Set-EnvValue $Name (New-Secret $Length) }
}

try {
  if ($Status) {
    & (Join-Path $PSScriptRoot "native-status.ps1")
    exit $LASTEXITCODE
  }

  if ($Down) {
    Stop-NativeProcess "dashboard"
    Stop-NativeProcess "bot"
    Stop-NativeProcess "lavalink2"
    Stop-NativeProcess "lavalink"
    Write-Host "Native Discord Server Platform processes stopped."
    exit 0
  }

  if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created local .env from .env.example."
  }

  # Discord credentials are optional at process startup.
  # Control Center -> Bot Fleet can register them after the Management API is online.
  Ensure-Secret "MANAGEMENT_API_KEY" 48
  Ensure-Secret "LAVALINK_PASSWORD" 24

  Import-EnvFile
  Ensure-Node
  Ensure-NpmDependencies
  Ensure-Postgres

  $java = Ensure-Java
  $lavalinkJar = Ensure-LavalinkJar

  $env:DSP_CONTAINERIZED = "false"
  $env:HEALTH_HOST = "127.0.0.1"
  $env:MANAGEMENT_API_HOST = "127.0.0.1"
  $env:LAVALINK_HOST = "127.0.0.1"
  $env:LAVALINK_PORT = "2333"
  $managementApiPort = Get-EnvValue "MANAGEMENT_API_PORT"
  if ([string]::IsNullOrWhiteSpace($managementApiPort)) { $managementApiPort = "3002" }
  $env:MANAGEMENT_API_PORT = $managementApiPort

  $password = Get-EnvValue "LAVALINK_PASSWORD"
  if ([string]::IsNullOrWhiteSpace($password)) { throw "LAVALINK_PASSWORD is required." }

  $nodes = @(
    @{
      id = "local"
      host = "127.0.0.1"
      port = 2333
      password = $password
    }
  )

  $javaXms = Get-EnvValue "LAVALINK_JAVA_XMS"
  if ([string]::IsNullOrWhiteSpace($javaXms)) { $javaXms = "128m" }
  $javaXmx = Get-EnvValue "LAVALINK_JAVA_XMX"
  if ([string]::IsNullOrWhiteSpace($javaXmx)) { $javaXmx = "512m" }

  $env:LAVALINK_SERVER_PASSWORD = $password
  $env:SERVER_PORT = "2333"
  $lavalinkWorkingDirectory = Join-Path (Get-Location) "infrastructure\lavalink"
  Start-NativeProcess "lavalink" $java @("-Xms$javaXms", "-Xmx$javaXmx", "-jar", $lavalinkJar) $lavalinkWorkingDirectory "lavalink"
  Write-Host "Lavalink node 1 starting..."

  if (-not (Wait-Tcp "127.0.0.1" 2333 60 1)) {
    Get-Content (Join-Path $logRoot "lavalink.err.log") -Tail 80 -ErrorAction SilentlyContinue
    throw "Lavalink node 1 did not open port 2333."
  }

  if ($Lavalink2) {
    $env:SERVER_PORT = "2334"
    $nodes += @{
      id = "local-2"
      host = "127.0.0.1"
      port = 2334
      password = $password
    }
    Start-NativeProcess "lavalink2" $java @("-Xms$javaXms", "-Xmx$javaXmx", "-jar", $lavalinkJar) $lavalinkWorkingDirectory "lavalink2"
    Write-Host "Lavalink node 2 starting..."
    if (-not (Wait-Tcp "127.0.0.1" 2334 60 1)) {
      Get-Content (Join-Path $logRoot "lavalink2.err.log") -Tail 80 -ErrorAction SilentlyContinue
      throw "Lavalink node 2 did not open port 2334."
    }
  } else {
    Stop-NativeProcess "lavalink2"
  }

  $env:LAVALINK_NODES = ($nodes | ConvertTo-Json -Compress)
  $env:SERVER_PORT = "2333"

  # Build before starting Lavalink/bot so the first-run compiler spike does not
  # happen at the same time as the runtime services.
  $botBuildMarker = Join-Path (Get-Location) "apps\bot\dist\main.js"
  if ($Rebuild -or -not (Test-Path $botBuildMarker)) {
    Write-Host "Building domain + bot..."
    & npm.cmd run build:domain
    if ($LASTEXITCODE -ne 0) { throw "Domain build failed." }
    & npm.cmd run build:bot
    if ($LASTEXITCODE -ne 0) { throw "Bot build failed." }
  }

  $dashboardBuildMarker = Join-Path (Get-Location) "apps\dashboard\.next\BUILD_ID"
  if ($Dashboard -and ($Rebuild -or -not (Test-Path $dashboardBuildMarker))) {
    Write-Host "Building Dashboard..."
    & npm.cmd run build -w apps/dashboard
    if ($LASTEXITCODE -ne 0) { throw "Dashboard build failed." }
  }

  $botNodeHeap = Get-EnvValue "BOT_NODE_MAX_OLD_SPACE_MB"
  if ([string]::IsNullOrWhiteSpace($botNodeHeap)) { $botNodeHeap = "768" }
  if ($botNodeHeap -notmatch "^\d+$" -or [int]$botNodeHeap -lt 256 -or [int]$botNodeHeap -gt 2048) {
    throw "BOT_NODE_MAX_OLD_SPACE_MB must be between 256 and 2048 MiB."
  }

  $previousNodeOptions = $env:NODE_OPTIONS
  $env:NODE_OPTIONS = "--max-old-space-size=$botNodeHeap"
  Start-NativeProcess "bot" "npm.cmd" @("run", "start", "-w", "apps/bot") (Get-Location).Path "bot"
  $env:NODE_OPTIONS = $previousNodeOptions

  $healthPort = Get-EnvValue "HEALTH_PORT"
  if ([string]::IsNullOrWhiteSpace($healthPort)) { $healthPort = "3001" }
  $healthUrl = "http://127.0.0.1:$healthPort/health"

  if (-not (Wait-Http $healthUrl 60 2)) {
    Get-Content (Join-Path $logRoot "bot.err.log") -Tail 120 -ErrorAction SilentlyContinue
    Get-Content (Join-Path $logRoot "bot.out.log") -Tail 120 -ErrorAction SilentlyContinue
    throw "Bot health endpoint did not become ready: $healthUrl"
  }

  $runDashboard = $Dashboard -or -not $NoDashboard
  if ($runDashboard) {
    $dashboardPort = Get-EnvValue "DASHBOARD_PORT"
    if ([string]::IsNullOrWhiteSpace($dashboardPort)) { $dashboardPort = "3000" }

    $env:BOT_HEALTH_URL = $healthUrl
    $env:MANAGEMENT_API_URL = "http://127.0.0.1:$managementApiPort"

    $dashboardNodeHeap = Get-EnvValue "DASHBOARD_NODE_MAX_OLD_SPACE_MB"
    if ([string]::IsNullOrWhiteSpace($dashboardNodeHeap)) { $dashboardNodeHeap = "512" }
    if ($dashboardNodeHeap -notmatch "^\d+$" -or [int]$dashboardNodeHeap -lt 256 -or [int]$dashboardNodeHeap -gt 2048) {
      throw "DASHBOARD_NODE_MAX_OLD_SPACE_MB must be between 256 and 2048 MiB."
    }

    $env:NODE_OPTIONS = "--max-old-space-size=$dashboardNodeHeap"
    Start-NativeProcess "dashboard" "npm.cmd" @("run", "start:native", "-w", "apps/dashboard", "--", "-p", $dashboardPort) (Get-Location).Path "dashboard"
    $env:NODE_OPTIONS = $previousNodeOptions

    $dashboardUrl = "http://127.0.0.1:{0}/" -f $dashboardPort
    if (-not (Wait-Http $dashboardUrl 60 2)) {
      Get-Content (Join-Path $logRoot "dashboard.err.log") -Tail 120 -ErrorAction SilentlyContinue
      Get-Content (Join-Path $logRoot "dashboard.out.log") -Tail 120 -ErrorAction SilentlyContinue
      throw "Dashboard did not become ready: $dashboardUrl"
    }
  }

  Write-Host ""
  Write-Host "Discord Server Platform is running in native Windows mode."
  Write-Host "Docker Desktop is not required and is not started by this launcher."
  Write-Host "Lavalink nodes: $($nodes.Count)"
  Write-Host "Bot health: $healthUrl"
  Write-Host "Logs: $logRoot"

  if ($Dashboard) {
    Write-Host "Control Center: $dashboardUrl"
    if (-not $NoOpen) { Start-Process $dashboardUrl }
  } else {
    Write-Host "Dashboard is OFF for low-overhead gaming mode. Add -Dashboard when you need it."
  }

  Write-Host ""
  Write-Host "For Sea of Thieves + OBS/RTMP, keep the default single-Lavalink mode."
  exit 0
} catch {
  Write-Host ""
  Write-Host "Native launcher failed: $($_.Exception.Message)"
  Write-Host "Logs: $logRoot"
  exit 1
}
