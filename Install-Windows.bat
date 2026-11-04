@echo off
rem Windows double-click installer. Runs kit\install.ps1 with a one-time execution policy bypass.
cd /d "%~dp0"
if not exist "kit\install.ps1" (
  echo Please extract the whole ZIP first, then run this file from the extracted folder.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kit\install.ps1"
set CODE=%ERRORLEVEL%
echo.
if not "%CODE%"=="0" echo Install failed. Please screenshot the text above and open an issue: https://github.com/znnw4m6k7k-dotcom/dsh-delivery/issues
pause
exit /b %CODE%
