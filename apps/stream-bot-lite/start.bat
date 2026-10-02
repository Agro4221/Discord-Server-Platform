@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Agro Stream Bot Lite - START
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js 22.12+ and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\better-sqlite3" (
  echo [INFO] Dependencies not found. Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
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
if not exist ".env" (
  echo [WARNING] .env file not found.
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo [INFO] Created .env from .env.example.
    echo [ACTION] Fill DISCORD_TOKEN, DISCORD_CLIENT_ID and other settings in .env.
    pause
    exit /b 1
  ) else (
    echo [ERROR] .env.example not found.
    pause
    exit /b 1
  )
)

echo [INFO] Project folder:
cd
echo.

echo [INFO] Cleaning old build...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
  echo [ERROR] Could not remove old dist folder.
  pause
  exit /b 1
)

echo [INFO] Building project...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo.
echo [INFO] Starting bot...
echo [INFO] Stop with CTRL+C.
echo.

call npm start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Bot stopped with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
