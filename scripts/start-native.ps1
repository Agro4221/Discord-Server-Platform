[CmdletBinding()]
param(
  [switch]$Dashboard,
  [switch]$Lavalink2,
  [switch]$Rebuild,
  [switch]$NoOpen,
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
$nativeToolsRoot = Join-Path (Get-Location) "tools"
$bundledPostgresBin = Join-Path $nativeToolsRoot "pgsql\\bin"
New-Item -ItemType Directory -Force -Path $runtimeRoot, $logRoot, $nativeToolsRoot | Out-Null

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

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  Set-Content -Path (Join-Path $runtimeRoot "$Name.pid") -Value $process.Id -Encoding ASCII
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

function Find-Node {
  $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  return $null
}

function Ensure-Node {
  $nodePath = Find-Node
  $versionText = if ($nodePath) { (& $nodePath --version).Trim().TrimStart("v") } else { "0.0.0" }
  $parts = $versionText.Split(".")
  $major = 0
  $minor = 0
  if ($parts.Count -ge 2) {
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
  }
  if ($major -lt 24 -or ($major -eq 24 -and $minor -lt 17)) {
    $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
    if (-not $winget) { throw "Node.js 24.17+ is required for native mode and winget was not found for automatic installation." }
    Write-Host "Node.js 24.21.0+ is missing. Installing the required Node.js LTS version..."
    & $winget install --id OpenJS.NodeJS.LTS --exact --version 24.21.0 --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Automatic Node.js 24.21.0 installation failed." }
    $nodePath = Find-Node
    $versionText = if ($nodePath) { (& $nodePath --version).Trim().TrimStart("v") } else { "" }
    $parts = $versionText.Split(".")
    if ($parts.Count -ge 2) {
      $major = [int]$parts[0]
      $minor = [int]$parts[1]
    }
  }
  if ($major -lt 24 -or ($major -eq 24 -and $minor -lt 17)) {
    throw "Native mode requires Node.js 24.17+. Detected $versionText."
  }
  $nodeDir = Split-Path $nodePath -Parent
  if (-not (($env:Path -split ";" | Where-Object { $_ -eq $nodeDir }).Count)) {
    $env:Path = "$nodeDir;$env:Path"
  }
  Write-Host "Node.js: $versionText"
}

function Ensure-NpmDependencies {
  if (Test-Path "node_modules") { return }
  Write-Host "Installing npm dependencies once (native mode)..."
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
}

function Ensure-Postgres {
  if (Test-Path (Join-Path $bundledPostgresBin "pg_ctl.exe")) {
    if (-not (($env:Path -split ";" | Where-Object { $_ -eq $bundledPostgresBin }).Count)) {
      $env:Path = "$bundledPostgresBin;$env:Path"
    }
  }

  $pgIsReady = Get-Command "pg_isready.exe" -ErrorAction SilentlyContinue
  $psql = Get-Command "psql.exe" -ErrorAction SilentlyContinue
  $initdb = Get-Command "initdb.exe" -ErrorAction SilentlyContinue
  $pgCtl = Get-Command "pg_ctl.exe" -ErrorAction SilentlyContinue

  if (-not $pgIsReady -or -not $psql -or -not $initdb -or -not $pgCtl) {
    Write-Host "Portable PostgreSQL is missing. Downloading PostgreSQL 18.6 binaries..."
    $zipRoot = Join-Path $runtimeRoot "downloads"
    $extractRoot = Join-Path $runtimeRoot "postgres-extract"
    $zipPath = Join-Path $zipRoot "postgresql-18.6-5-windows-x64-binaries.zip"
    New-Item -ItemType Directory -Force -Path $zipRoot | Out-Null
    if (-not (Test-Path $zipPath)) {
      Invoke-WebRequest -Uri "https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip" -OutFile $zipPath -UseBasicParsing
    }
    if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $source = Join-Path $extractRoot "pgsql"
    if (-not (Test-Path (Join-Path $source "bin\pg_ctl.exe"))) {
      throw "Downloaded PostgreSQL archive did not contain the expected pgsql\bin runtime."
    }
    $target = Join-Path $nativeToolsRoot "pgsql"
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item -Path $source -Destination $target
    $env:Path = "$bundledPostgresBin;$env:Path"
    $pgIsReady = Get-Command "pg_isready.exe" -ErrorAction SilentlyContinue
    $psql = Get-Command "psql.exe" -ErrorAction SilentlyContinue
    $initdb = Get-Command "initdb.exe" -ErrorAction SilentlyContinue
    $pgCtl = Get-Command "pg_ctl.exe" -ErrorAction SilentlyContinue
  }

  $dbUrl = Get-EnvValue "DATABASE_URL"
  if ([string]::IsNullOrWhiteSpace($dbUrl) -or $dbUrl -match "postgresql://USER:PASSWORD@") {
    $dbPassword = New-Secret 32
    $dbUrl = "postgresql://postgres:$dbPassword@127.0.0.1:5432/discord_platform"
    Set-EnvValue "DATABASE_URL" $dbUrl
    Set-EnvValue "POSTGRES_PASSWORD" $dbPassword
  }
  $env:DATABASE_URL = $dbUrl
  Import-EnvFile

  $dataRoot = Join-Path (Get-Location) ".postgres-data"
  if (-not (Test-Path (Join-Path $dataRoot "PG_VERSION"))) {
    Write-Host "Initializing local PostgreSQL cluster..."
    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
    $uri = [Uri]$env:DATABASE_URL
    $userinfo = $uri.UserInfo.Split(":", 2)
    $dbPassword = if ($userinfo.Count -eq 2) { [Uri]::UnescapeDataString($userinfo[1]) } else { New-Secret 32 }
    $pwFile = Join-Path $runtimeRoot "postgres-password.tmp"
    Set-Content -Path $pwFile -Value $dbPassword -NoNewline -Encoding ASCII
    try {
      & $initdb -D $dataRoot -U postgres --pwfile=$pwFile --encoding=UTF8 --auth-local=trust --auth-host=scram-sha-256
      if ($LASTEXITCODE -ne 0) { throw "PostgreSQL cluster initialization failed." }
    } finally {
      Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    }
  }

  & $pgIsReady -h 127.0.0.1 -p 5432 *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting local PostgreSQL..."
    $postgres = Join-Path (Split-Path $pgCtl.Source -Parent) "postgres.exe"
    if (-not (Test-Path $postgres)) {
      throw "PostgreSQL server executable was not found next to pg_ctl.exe."
    }

    $pgStdOut = Join-Path $logRoot "postgres-stdout.log"
    $pgStdErr = Join-Path $logRoot "postgres-stderr.log"
    Start-Process -FilePath $postgres -ArgumentList @(
      "-D", $dataRoot,
      "-h", "127.0.0.1",
      "-p", "5432"
    ) -WorkingDirectory $dataRoot -RedirectStandardOutput $pgStdOut -RedirectStandardError $pgStdErr -WindowStyle Hidden | Out-Null
  }

  $ready = $false
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    & $pgIsReady -h 127.0.0.1 -p 5432 *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    Write-Host "PostgreSQL startup log:"
    Get-Content (Join-Path $logRoot "postgres-stderr.log") -Tail 80 -ErrorAction SilentlyContinue
    Get-Content (Join-Path $logRoot "postgres.log") -Tail 80 -ErrorAction SilentlyContinue
    throw "Local PostgreSQL did not become ready on 127.0.0.1:5432."
  }

  $uri = [Uri]$env:DATABASE_URL
  $userinfo = $uri.UserInfo.Split(":", 2)
  if ($userinfo.Count -eq 2) {
    $env:PGPASSWORD = [Uri]::UnescapeDataString($userinfo[1])
  }

  # Check/create the application database using the always-present postgres database.
  & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "SELECT 1;" *> $null
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    throw "PostgreSQL server is running but the postgres administrative connection failed."
  }

  $databaseExistsRaw = & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname='discord_platform');" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    throw "Could not query PostgreSQL databases."
  }

  $databaseExists = $databaseExistsRaw.Trim() -eq "t"
  if (-not $databaseExists) {
    Write-Host "Creating local database discord_platform..."
    & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "CREATE DATABASE discord_platform;" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
      throw "Could not create the discord_platform database."
    }
  }

  & $psql $env:DATABASE_URL -c "SELECT 1;" 2>$null
  $applicationExitCode = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($applicationExitCode -ne 0) { throw "PostgreSQL rejected the configured DATABASE_URL." }

  Write-Host "PostgreSQL: ready"
}

function Ensure-LavalinkJar {
  $configured = Get-EnvValue "LAVALINK_JAR_PATH"
  if ([string]::IsNullOrWhiteSpace($configured)) {
    $configured = ".\infrastructure\lavalink\lavalink.jar"
    Set-EnvValue "LAVALINK_JAR_PATH" $configured
  }

  $resolved = if ([System.IO.Path]::IsPathRooted($configured)) { $configured } else { Join-Path (Get-Location) $configured }
  if (-not (Test-Path $resolved -PathType Leaf)) {
    Write-Host "Lavalink JAR is missing. Downloading Lavalink 4.2.2..."
    $downloadRoot = Join-Path $runtimeRoot "downloads"
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    $downloaded = Join-Path $downloadRoot "Lavalink-4.2.2.jar"
    if (-not (Test-Path $downloaded)) {
      Invoke-WebRequest -Uri "https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar" -OutFile $downloaded -UseBasicParsing
    }
    $target = Join-Path (Get-Location) "infrastructure\lavalink\lavalink.jar"
    Copy-Item $downloaded $target -Force
    $resolved = $target
  }
  return (Resolve-Path $resolved).Path
}

function Find-Java {
  $java = Get-Command "java.exe" -ErrorAction SilentlyContinue
  if ($java) { return $java.Source }
  $candidates = @(Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-21*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Join-Path $_ "bin\java.exe"
  })
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  return $null
}

function Ensure-Java {
  $javaPath = Find-Java
  if (-not $javaPath) {
    $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
    if (-not $winget) { throw "Java 17+ is required for native mode and winget was not found for automatic installation." }
    Write-Host "Java 21 is missing. Installing Eclipse Temurin 21..."
    & $winget install --id EclipseAdoptium.Temurin.21.JDK --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Automatic Java 21 installation failed." }
    $javaPath = Find-Java
  }
  if (-not $javaPath) { throw "Java 21 was installed but java.exe could not be located. Open a new terminal and retry." }
  return $javaPath
}

function Ensure-Secret([string]$Name, [int]$Length) {
  $value = Get-EnvValue $Name
  if ([string]::IsNullOrWhiteSpace($value)) {
    Set-EnvValue $Name (New-Secret $Length)
    return
  }

  if ($Name -eq "BOT_CREDENTIALS_ENCRYPTION_KEY" -and $value -notmatch "^[a-fA-F0-9]{64}$") {
    Write-Host "Regenerating invalid BOT_CREDENTIALS_ENCRYPTION_KEY..."
    Set-EnvValue $Name (New-Secret 32)
  }
}

try {
  if ($Down) {
    Stop-NativeProcess "dashboard"
    Stop-NativeProcess "fleet"
    Stop-NativeProcess "bot"
    Stop-NativeProcess "lavalink2"
    Stop-NativeProcess "lavalink"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\reconcile-fleet-native.ps1" -Down
    if ($LASTEXITCODE -ne 0) { throw "Native Bot Fleet cleanup failed with exit code $LASTEXITCODE." }
    Write-Host "Native Discord Server Platform processes stopped."
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

  Ensure-Secret "MANAGEMENT_API_KEY" 48
  Ensure-Secret "BOT_CREDENTIALS_ENCRYPTION_KEY" 64
  Ensure-Secret "LAVALINK_PASSWORD" 24

  Import-EnvFile
  Ensure-Node
  Ensure-NpmDependencies

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

  Ensure-Postgres

  $java = Ensure-Java
  $lavalinkJar = Ensure-LavalinkJar

  $env:DSP_CONTAINERIZED = "false"
  $env:HEALTH_HOST = "127.0.0.1"
  $env:MANAGEMENT_API_HOST = "127.0.0.1"
  $env:LAVALINK_HOST = "127.0.0.1"
  $env:LAVALINK_PORT = "2333"

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

  $nodeJsonItems = @($nodes | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress -Depth 4 }); $env:LAVALINK_NODES = "[" + ($nodeJsonItems -join ",") + "]"
  $env:SERVER_PORT = "2333"

  Start-NativeProcess "bot" "npm.cmd" @("run", "start", "-w", "apps/bot") (Get-Location).Path "bot"

  $healthPort = Get-EnvValue "HEALTH_PORT"
  if ([string]::IsNullOrWhiteSpace($healthPort)) { $healthPort = "3001" }
  $healthUrl = "http://127.0.0.1:$healthPort/health"

  if (-not (Wait-Http $healthUrl 60 2)) {
    Get-Content (Join-Path $logRoot "bot.err.log") -Tail 120 -ErrorAction SilentlyContinue
    Get-Content (Join-Path $logRoot "bot.out.log") -Tail 120 -ErrorAction SilentlyContinue
    throw "Bot health endpoint did not become ready: $healthUrl"
  }

  if ($Dashboard) {
    $dashboardPort = Get-EnvValue "DASHBOARD_PORT"
    if ([string]::IsNullOrWhiteSpace($dashboardPort)) { $dashboardPort = "3000" }

    $managementPort = Get-EnvValue "MANAGEMENT_API_PORT"
    if ([string]::IsNullOrWhiteSpace($managementPort)) { $managementPort = "3002" }
    $env:BOT_HEALTH_URL = $healthUrl
    $env:MANAGEMENT_API_URL = "http://127.0.0.1:$managementPort"

    Start-NativeProcess "dashboard" "npm.cmd" @("run", "start", "-w", "apps/dashboard") (Get-Location).Path "dashboard"

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

  Start-NativeProcess "fleet" "powershell.exe" @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path (Get-Location) "scripts\reconcile-fleet-native.ps1"),
    "-Loop"
  ) (Get-Location).Path "fleet"

  if ($Dashboard) {
    Write-Host "Control Center: $dashboardUrl"
    if (-not $NoOpen) { Start-Process $dashboardUrl }
  } else {
    Write-Host "Dashboard is OFF for low-overhead gaming mode. Add -Dashboard when you need it."
  }

  Write-Host ""
  Write-Host "Native Fleet supervisor: enabled for registered secondary Bot Identities."
  Write-Host "For Sea of Thieves + OBS/RTMP, keep the default single-Lavalink mode."
  exit 0
} catch {
  Write-Host ""
  Write-Host "Native launcher failed: $($_.Exception.Message)"
  Write-Host "Logs: $logRoot"
  exit 1
}
