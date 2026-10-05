@echo off
setlocal
cd /d "%~dp0"

call "%~dp0start-native.bat" -Dashboard %*
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
