#Requires -Version 5.1
<#
.SYNOPSIS  Runs ONE wizard step and reports it as machine-readable lines for the Electron app.
.DESCRIPTION
  Output protocol (stdout, one per line):  LOG: <text>   and a final   RESULT: <json {ok, message, data}>
  Steps: detect | backup | get | vbs | apply | task | verify | health | fix | rollback
#>
param(
    [Parameter(Mandatory)][ValidateSet('detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify', 'health', 'fix', 'rollback')][string]$Step,
    [string]$InstallDir,
    [string]$ZipPath,
    [string]$SettingsFile,
    [string]$TaskName,
    [switch]$DisableVBS,
    [switch]$RestoreVbs
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SettingsFile) { $SettingsFile = Join-Path $root '..\config\ThrottleStop.settings.ini' }
. (Join-Path $root 'lib\Tuning.ps1')
. (Join-Path $root 'lib\Health.ps1')
$defaults = Get-Defaults
if (-not $InstallDir) { $InstallDir = $defaults.installDir }
if (-not $TaskName)   { $TaskName   = $defaults.taskName }
function Log($m) { Write-Output "LOG: $m" }
function Done($ok, $msg, $data = $null) { Write-Output ("RESULT: " + (@{ ok = [bool]$ok; message = $msg; data = $data } | ConvertTo-Json -Depth 6 -Compress)) }

try {
    if ($Step -ne 'detect' -and $Step -ne 'verify' -and $Step -ne 'health' -and -not (Test-Admin)) { throw 'Administrator rights are required for this step. Restart the app as administrator.' }
    if (Test-Path -LiteralPath $SettingsFile) { $SettingsFile = (Resolve-Path -LiteralPath $SettingsFile).Path }
    switch ($Step) {
        'detect' {
            $hw = Get-HardwareInfo $InstallDir $TaskName
            Log "$($hw.manufacturer) $($hw.model) - $($hw.cpu)"
            Log $hw.osVersion
            if (-not $hw.cpuSupported) { Done $false 'This CPU is not an i9-14900HX. The tuning values are specific to that chip, so the wizard will not apply them.' $hw; return }
            $msg = if ($hw.modelVerified) { 'Supported: Lenovo 83DE with i9-14900HX.' } else { "Supported CPU (i9-14900HX), but the model is $($hw.model), not the verified 83DE. Proceed with care." }
            Done $true $msg $hw
        }
        'backup' {
            $ini = Join-Path $InstallDir 'ThrottleStop.ini'
            if (Test-Path -LiteralPath $ini) {
                $bak = "$ini.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"; Copy-Item -LiteralPath $ini $bak
                Log "backup: $bak"; Done $true 'ThrottleStop.ini backed up.' @{ file = $bak }
            } else { Log 'no ThrottleStop.ini yet'; Done $true 'Nothing to back up yet (fresh install).' }
        }
        'get' {
            $exe = Install-ThrottleStopBinaries $InstallDir $ZipPath
            Log $exe; Done $true 'ThrottleStop is ready.' @{ exe = $exe }
        }
        'vbs' {
            if ($DisableVBS) { Disable-Vbs; Log 'hypervisorlaunchtype=off, VBS=0, HVCI=0'; Done $true 'VBS/hypervisor disabled. Reboot required (also switch Memory integrity off in Windows Security).' }
            else { Log 'skipped by user'; Done $true 'Left unchanged. If the FIVR controls stay locked, re-run this step with VBS disabled.' }
        }
        'apply' {
            Log "settings: $SettingsFile"
            $n = Merge-ThrottleStopSettings $InstallDir $SettingsFile
            Done $true "$n settings written to ThrottleStop.ini." @{ keys = $n }
        }
        'task' {
            $u = Register-ThrottleStopTask $InstallDir $TaskName
            $exe = Join-Path $InstallDir 'ThrottleStop.exe'
            if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) { Start-Process -FilePath $exe -WorkingDirectory $InstallDir; Log 'ThrottleStop started' }
            Save-Baseline $InstallDir; Log 'baseline saved (Windows build at setup time)'
            Done $true "Autostart + 5-minute watchdog registered for $u." }
        'verify' {
            $res = Test-Tuning $InstallDir $SettingsFile $TaskName
            $res | ForEach-Object { Log ("{0}: {1} ({2})" -f $_.name, $(if ($_.ok) { 'OK' } else { 'FAIL' }), $_.detail) }
            $bad = @($res | Where-Object { -not $_.ok }).Count
            Done ($bad -eq 0) $(if ($bad) { "$bad check(s) need attention." } else { 'Everything checks out.' }) $res
        }
        'health' {
            $h = Get-HealthReport $InstallDir $SettingsFile $TaskName
            $h.checks | ForEach-Object { Log ("{0}: {1} - {2}" -f $_.name, $(if ($_.ok) { 'OK' } else { 'ATTENTION' }), $_.detail) }
            $msg = switch ($h.verdict) { 'ok' { 'Your PC is still optimized.' } 'warn' { 'Mostly fine, one thing needs a look.' } default { 'The optimization is not fully in place.' } }
            Done ($h.verdict -ne 'fail') $msg $h
        }
        'fix' {
            $l = Invoke-Fix $InstallDir $SettingsFile $TaskName -DisableVbs:$DisableVBS
            $l | ForEach-Object { Log $_ }
            $h = Get-HealthReport $InstallDir $SettingsFile $TaskName
            Done ($h.verdict -ne 'fail') $(if ($h.verdict -eq 'ok') { 'Fixed. Your PC is optimized again.' } else { 'Applied what was possible; some items still need attention (see the list).' }) $h
        }        'rollback' {
            $l = Invoke-Rollback $InstallDir $TaskName -RestoreVbs:$RestoreVbs
            $l | ForEach-Object { Log $_ }
            Done $true 'Rolled back.' $l
        }
    }
} catch { Done $false $_.Exception.Message }
