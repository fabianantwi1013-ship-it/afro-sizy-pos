@echo off
title Afro ^& Sizy - Point of Sale
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Download the LTS version from https://nodejs.org, install it,
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8787'"
node --disable-warning=ExperimentalWarning server.js

echo.
echo   The till has stopped. Close this window, or press a key to try again.
pause >nul
