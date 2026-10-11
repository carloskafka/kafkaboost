@echo off
rem One-click installer: self-elevates, then runs scripts\Install-Tuning.ps1.
rem Extra arguments are passed through, e.g.  install.cmd -InstallDir "D:\ThrottleStop" -SkipVBS
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-Tuning.ps1" %*
echo.
pause
