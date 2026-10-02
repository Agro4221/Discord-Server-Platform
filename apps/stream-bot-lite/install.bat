@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Agro Stream Bot Lite - INSTALL
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js 22.12+ and run this file again.
  pause
  exit /b 1
)

for /f "tokens=1,2,3" %%a in ('node -p "process.versions.node.split('.') .join(' ')"') do set "NODE_MAJOR=%%a"
if not defined NODE_MAJOR set "NODE_MAJOR=0"

if %NODE_MAJOR% LSS 22 (
  echo [ERROR] Node.js 22.12+ is required.
  node --version
  pause
  exit /b 1
)

echo [INFO] Node.js:
node --version
echo.

if not exist "yt-dlp.exe" (
  echo [INFO] Downloading yt-dlp for Windows...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile 'yt-dlp.exe'"
  if errorlevel 1 (
    echo [ERROR] Could not download yt-dlp.exe.
    echo [ACTION] Download yt-dlp.exe manually from the official yt-dlp GitHub releases and place it in this folder.
    pause
    exit /b 1
  )
)

yt-dlp.exe --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] yt-dlp.exe was found but could not be started.
  pause
  exit /b 1
)

echo [INFO] yt-dlp:
yt-dlp.exe --version
echo.

echo [INFO] Installing npm dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [INFO] Building project...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo.
    echo [INFO] Created .env from .env.example.
    echo [ACTION] Open .env and fill in your Discord/token settings.
  )
)

echo.
echo ========================================
echo Installation complete.
echo Run start.bat to launch the bot.
echo ========================================
pause
exit /b 0
