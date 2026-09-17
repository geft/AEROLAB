@echo off
title AEROLAB Desktop
cd /d "%~dp0"

echo ====================================================
echo  AEROLAB - Physiological Running Analytics
echo  Launching Native Desktop (Chromium-Free)
echo ====================================================

node scripts\launch-chrome-app.js
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] An error occurred while launching AEROLAB.
  echo Please make sure Node.js is installed.
  pause
)
