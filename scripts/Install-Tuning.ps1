#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot setup of the ThrottleStop tuning used on the Lenovo Legion 83DE (i9-14900HX):
  undervolt, boost caps, PL1/PL2, and an "always running" autostart + watchdog task.

.DESCRIPTION
  1. Finds ThrottleStop (or unpacks ThrottleStop*.zip from -ZipPath / Downloads into -InstallDir).
  2. Optionally disables VBS / the hypervisor (needed for FIVR undervolting; breaks WSL2 + Docker-WSL2).
  3. Merges config\ThrottleStop.settings.ini into ThrottleStop.ini (backs up the old file first).
  4. Registers scheduled task "ThrottleStop_Autostart": at logon, highest privileges, and a
     5-minute watchdog that starts ThrottleStop only if it is not running.
  5. Optionally copies config\HWiNFO64.INI (shared-memory logging) next to HWiNFO.

  Run it through install.cmd (self-elevates) or from an elevated PowerShell. Reboot afterwards if VBS was changed.
  The same logic powers the Electron wizard (app\) through scripts\Steps.ps1.
  NOT tested on a fresh Windows install yet - see README.md "Limitations".

.EXAMPLE
  .\Install-Tuning.ps1 -ZipPath "$env:USERPROFILE\Downloads\ThrottleStop_9.7.3.zip" -DisableVBS
.EXAMPLE
  .\Install-Tuning.ps1 -InstallDir "C:\Users\me\Downloads\ThrottleStop_9.7.3" -SkipVBS -NoStart
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\Tools\ThrottleStop',
    [string]$ZipPath,
    [string]$SettingsFile = (Join-Path $PSScriptRoot '..\config\ThrottleStop.settings.ini'),
    [string]$HWiNFODir,
    [switch]$DisableVBS,
    [switch]$SkipVBS,
    [switch]$NoTask,
    [switch]$NoStart,
    [switch]$TaskOnly,   # only (re)register the autostart/watchdog task; leave VBS, INI and the running process alone
    [string]$TaskName = 'ThrottleStop_Autostart'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Tuning.ps1')

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    !!  $m" -ForegroundColor Yellow }

if (-not (Test-Admin)) { throw 'Run as Administrator (use install.cmd).' }
if (-not (Test-Path -LiteralPath $SettingsFile)) { throw "Settings file not found: $SettingsFile" }
$SettingsFile = (Resolve-Path -LiteralPath $SettingsFile).Path

Step "ThrottleStop in $InstallDir"
$exe = Install-ThrottleStopBinaries $InstallDir $ZipPath
Ok $exe

Step 'VBS / hypervisor (required for FIVR undervolting)'
if ($TaskOnly) { Warn 'skipped (-TaskOnly)' }
elseif ($SkipVBS) { Warn 'skipped (-SkipVBS). If FIVR controls are locked in ThrottleStop, run again with -DisableVBS.' }
else {
    $go = $DisableVBS
    if (-not $go) { $go = ((Read-Host 'Disable VBS/hypervisor? This BREAKS WSL2/Docker until restored (scripts\restore_vbs.ps1). [y/N]') -match '^(y|s)') }
    if ($go) { Disable-Vbs; Ok 'hypervisorlaunchtype=off, VBS=0, HVCI=0  (REBOOT required; also turn Memory integrity OFF in Windows Security if it is still on)' }
    else { Warn 'left unchanged' }
}

Step 'Merging settings into ThrottleStop.ini'
if ($TaskOnly) { Warn 'skipped (-TaskOnly)' } else {
    $iniPath = Join-Path $InstallDir 'ThrottleStop.ini'
    if (Test-Path -LiteralPath $iniPath) {
        $bak = "$iniPath.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
        Copy-Item -LiteralPath $iniPath $bak; Ok "backup: $bak"
    } else { Warn 'no ThrottleStop.ini yet - creating a minimal one (ThrottleStop fills in defaults)' }
    Ok "$(Merge-ThrottleStopSettings $InstallDir $SettingsFile) keys written"
}

if ($NoTask) { Warn 'task skipped (-NoTask)' }
else {
    Step "Scheduled task '$TaskName' (logon + 5-min watchdog, highest privileges)"
    Ok "registered for $(Register-ThrottleStopTask $InstallDir $TaskName)"
}

if ($HWiNFODir) {
    Step "HWiNFO shared-memory config in $HWiNFODir"
    $hwIni = Join-Path $HWiNFODir 'HWiNFO64.INI'
    if (Test-Path -LiteralPath $hwIni) { Copy-Item -LiteralPath $hwIni "$hwIni.bak" -Force }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\config\HWiNFO64.INI') $hwIni -Force
    Ok 'HWiNFO64.INI written (restart HWiNFO; do NOT pass command-line args to it - free version errors)'
}

if ($NoStart) { Warn 'not started (-NoStart)' }
else {
    Step 'Starting ThrottleStop'
    if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) {
        Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    }
    Ok 'running'
}

Write-Host "`nDone. Verify in ThrottleStop > FIVR: offsets -0.0996 / -0.0996 / -0.0898, Turbo Groups 47, E-cores 36;" -ForegroundColor Green
Write-Host 'TPL: PL1 65 / PL2 85 and "Disable Controls" UNCHECKED. Reboot first if VBS was changed.' -ForegroundColor Green
