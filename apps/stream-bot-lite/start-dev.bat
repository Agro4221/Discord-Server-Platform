@echo off
setlocal
cd /d "%~dp0"

echo Starting Stream Bot Lite in development mode...
echo Stop with CTRL+C.
echo.

if not exist "node_modules\tsx" (
  echo [INFO] Dependencies not found. Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo [WARNING] .env was created from .env.example.
    echo Fill it in and run start-dev.bat again.
    pause
    exit /b 1
  )
)

call npm run dev
pause
