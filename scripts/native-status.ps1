[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$runtimeRoot = Join-Path (Get-Location) ".native-runtime"
$pidNames = @("lavalink", "lavalink2", "bot", "dashboard")

$totalRamBytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$totalRamGiB = [math]::Round($totalRamBytes / 1GB, 1)
$logicalCores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors

Write-Host "Discord Server Platform — native runtime"
Write-Host ("System RAM: {0} GiB | Logical CPUs: {1}" -f $totalRamGiB, $logicalCores)
Write-Host ""

$totalWorkingSet = [int64]0
$running = @()

foreach ($name in $pidNames) {
  $pidFile = Join-Path $runtimeRoot "$name.pid"
  if (-not (Test-Path $pidFile)) { continue }

  $raw = (Get-Content $pidFile -Raw).Trim()
  $pidValue = 0
  if (-not [int]::TryParse($raw, [ref]$pidValue)) { continue }

  try {
    $process = Get-Process -Id $pidValue -ErrorAction Stop
    $memoryMiB = [math]::Round($process.WorkingSet64 / 1MB, 1)
    $totalWorkingSet += $process.WorkingSet64
    $running += [pscustomobject]@{
      Process = $name
      PID = $pidValue
      RAM_MiB = $memoryMiB
      CPU_s = [math]::Round($process.CPU, 1)
    }
  } catch {
  }
}

if ($running.Count -eq 0) {
  Write-Host "No native DSP processes are currently tracked."
  exit 0
}

$running | Format-Table -AutoSize
Write-Host ""
Write-Host ("Tracked DSP working set: {0} MiB ({1:N2} GiB)" -f ([math]::Round($totalWorkingSet / 1MB, 1)), ([math]::Round($totalWorkingSet / 1GB, 2)))
