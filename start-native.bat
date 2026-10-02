@echo off
setlocal
cd /d "%~dp0"

chcp 65001 >nul

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell is not available in PATH.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-native.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Native launcher finished with error code %EXIT_CODE%.
  pause
)

endlocal & exit /b %EXIT_CODE%
