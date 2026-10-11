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

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    !!  $m" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run as Administrator (use install.cmd).' }
if (-not (Test-Path -LiteralPath $SettingsFile)) { throw "Settings file not found: $SettingsFile" }
$SettingsFile = (Resolve-Path -LiteralPath $SettingsFile).Path

# ---------------------------------------------------------------- 1. ThrottleStop binaries
Step "ThrottleStop in $InstallDir"
$exe = Join-Path $InstallDir 'ThrottleStop.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    if (-not $ZipPath) {
        $ZipPath = Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter 'ThrottleStop*.zip' -ErrorAction SilentlyContinue |
                   Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $ZipPath -or -not (Test-Path -LiteralPath $ZipPath)) {
        Warn 'ThrottleStop.exe not found and no ThrottleStop*.zip in Downloads.'
        Warn 'Download it from https://www.techpowerup.com/download/techpowerup-throttlestop/ (tested with 9.7.3),'
        Warn 'save the zip in Downloads (or pass -ZipPath) and run this script again.'
        throw 'ThrottleStop not available.'
    }
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $InstallDir -Force
    # some zips contain a single sub-folder
    if (-not (Test-Path -LiteralPath $exe)) {
        $sub = Get-ChildItem $InstallDir -Recurse -Filter ThrottleStop.exe | Select-Object -First 1
        if ($sub) { Get-ChildItem $sub.Directory.FullName | Move-Item -Destination $InstallDir -Force }
    }
    if (-not (Test-Path -LiteralPath $exe)) { throw "ThrottleStop.exe not found after unpacking $ZipPath" }
    Ok "unpacked $ZipPath"
} else { Ok 'already present' }

# ---------------------------------------------------------------- 2. VBS / hypervisor
Step 'VBS / hypervisor (required for FIVR undervolting)'
if ($TaskOnly) { Warn 'skipped (-TaskOnly)' }
elseif ($SkipVBS) { Warn 'skipped (-SkipVBS). If FIVR controls are locked in ThrottleStop, run again with -DisableVBS.' }
else {
    $go = $DisableVBS
    if (-not $go) { $go = ((Read-Host 'Disable VBS/hypervisor? This BREAKS WSL2/Docker until restored (scripts\restore_vbs.ps1). [y/N]') -match '^(y|s)') }
    if ($go) {
        bcdedit /set hypervisorlaunchtype off | Out-Null
        reg add 'HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard' /v EnableVirtualizationBasedSecurity /t REG_DWORD /d 0 /f | Out-Null
        reg add 'HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' /v Enabled /t REG_DWORD /d 0 /f | Out-Null
        Ok 'hypervisorlaunchtype=off, VBS=0, HVCI=0  (REBOOT required; also turn Memory integrity OFF in Windows Security if it is still on)'
    } else { Warn 'left unchanged' }
}

# ---------------------------------------------------------------- 3. ThrottleStop.ini
Step 'Merging settings into ThrottleStop.ini'
if ($TaskOnly) { Warn 'skipped (-TaskOnly)' } else {
$running = Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }   # only OUR copy
if ($running) {
    # SaveOnExit=2 would overwrite our edit on a clean exit, so stop it hard before editing.
    $running | Stop-Process -Force; Start-Sleep -Seconds 2
}
$iniPath = Join-Path $InstallDir 'ThrottleStop.ini'
if (Test-Path -LiteralPath $iniPath) {
    $bak = "$iniPath.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item -LiteralPath $iniPath $bak; Ok "backup: $bak"
    $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $iniPath)
} else {
    $lines = [System.Collections.Generic.List[string]]::new(); $lines.Add('[ThrottleStop]')
    Warn 'no ThrottleStop.ini yet - creating a minimal one (ThrottleStop fills in defaults)'
}
$count = 0
foreach ($l in Get-Content -LiteralPath $SettingsFile) {
    if ($l -notmatch '^\s*([A-Za-z0-9_]+)=(.*)$') { continue }
    $k = $Matches[1]; $new = "$k=$($Matches[2])"; $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -like "$k=*") { $idx = $i; break } }
    if ($idx -ge 0) { $lines[$idx] = $new } else { $lines.Add($new) }
    $count++
}
Set-Content -LiteralPath $iniPath -Value $lines -Encoding ASCII
Ok "$count keys written"
}

# ---------------------------------------------------------------- 4. Scheduled task
if ($NoTask) { Warn 'task skipped (-NoTask)' }
else {
    Step "Scheduled task '$TaskName' (logon + 5-min watchdog, highest privileges)"
    $cmd = "if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue)) { Start-Process -FilePath '$exe' -WorkingDirectory '$InstallDir' }"
    $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`""
    $user     = "$env:USERDOMAIN\$env:USERNAME"
    $logon    = New-ScheduledTaskTrigger -AtLogOn -User $user
    $repeat   = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $logon.Repetition = $repeat.Repetition          # logon trigger that also repeats every 5 min, indefinitely
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
                  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon -Settings $settings -Principal $principal -Force | Out-Null
    Ok "registered for $user"
}

# ---------------------------------------------------------------- 5. HWiNFO (optional)
if ($HWiNFODir) {
    Step "HWiNFO shared-memory config in $HWiNFODir"
    $hwIni = Join-Path $HWiNFODir 'HWiNFO64.INI'
    if (Test-Path -LiteralPath $hwIni) { Copy-Item -LiteralPath $hwIni "$hwIni.bak" -Force }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\config\HWiNFO64.INI') $hwIni -Force
    Ok 'HWiNFO64.INI written (restart HWiNFO; do NOT pass command-line args to it - free version errors)'
}

# ---------------------------------------------------------------- 6. Start
if ($NoStart) { Warn 'not started (-NoStart)' }
else {
    Step 'Starting ThrottleStop'
    Start-Process -FilePath $exe -WorkingDirectory $InstallDir
    Ok 'started'
}

Write-Host "`nDone. Verify in ThrottleStop > FIVR: offsets -0.0996 / -0.0996 / -0.0898, Turbo Groups 47, E-cores 36;" -ForegroundColor Green
Write-Host 'TPL: PL1 65 / PL2 85 and "Disable Controls" UNCHECKED. Reboot first if VBS was changed.' -ForegroundColor Green
