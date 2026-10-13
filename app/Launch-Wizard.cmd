@echo off
rem Starts KafkaBoost (dev mode) with administrator rights.
rem Requires Node.js; installs Electron on first run.
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm start
