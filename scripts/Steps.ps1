#Requires -Version 5.1
<#
.SYNOPSIS  Runs ONE step and reports it as machine-readable lines for the Electron app.
.DESCRIPTION
  Output protocol (stdout, one per line):
    LOG: <text>
    RESULT: <json {ok, message, code, args, data}>      (code/args = language-neutral i18n key + values; message = English fallback)
  Steps: detect | backup | get | vbs | apply | task | verify | health | fix | autostart | rollback | paths | cleanbackups
#>
param(
    [Parameter(Mandatory)][ValidateSet('detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify', 'health', 'fix', 'autostart', 'rollback', 'paths', 'cleanbackups')][string]$Step,
    [string]$InstallDir,
    [string]$ZipPath,
    [string]$SettingsFile,
    [string]$TaskName,
    [switch]$DisableVBS,
    [switch]$RestoreVbs,
    [ValidateSet('status', 'on', 'off')][string]$Mode = 'status',   # autostart step
    [string]$AppExe,
    [string]$AppArgs
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
$InstallDir = Resolve-InstallDir $InstallDir $TaskName   # ThrottleStop may live elsewhere than the default folder

function Log($m) { Write-Output "LOG: $m" }
function Done($ok, $msg, $data = $null, $code = $null, $cargs = $null) {
    Write-Output ("RESULT: " + (@{ ok = [bool]$ok; message = $msg; code = $code; args = $cargs; data = $data } | ConvertTo-Json -Depth 6 -Compress))
}

try {
    $readOnly = ($Step -in 'detect', 'verify', 'health', 'paths', 'cleanbackups') -or ($Step -eq 'autostart' -and $Mode -eq 'status')
    if (-not $readOnly -and -not (Test-Admin)) { throw 'Administrator rights are required for this step. Restart the app as administrator.' }
    if (Test-Path -LiteralPath $SettingsFile) { $SettingsFile = (Resolve-Path -LiteralPath $SettingsFile).Path }
    switch ($Step) {
        'detect' {
            $hw = Get-HardwareInfo $InstallDir $TaskName
            Log "$($hw.manufacturer) $($hw.model) - $($hw.cpu)"
            Log $hw.osVersion
            if (-not $hw.cpuSupported) { Done $false 'This CPU is not an i9-14900HX. The tuning values are specific to that chip, so the app will not apply them.' $hw 'msg.detect.unsupported' @{}; return }
            if ($hw.modelVerified) { Done $true "Supported: $($hw.manufacturer) $($hw.model) with i9-14900HX." $hw 'msg.detect.supported' @{ manufacturer = $hw.manufacturer; model = $hw.model } }
            else { Done $true "Supported CPU (i9-14900HX), but the model is $($hw.model), not the verified 83DE. Proceed with care." $hw 'msg.detect.modelUnverified' @{ model = $hw.model } }
        }
        'backup' {
            $ini = Join-Path $InstallDir 'ThrottleStop.ini'
            if (Test-Path -LiteralPath $ini) {
                $bak = "$ini.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"; Copy-Item -LiteralPath $ini $bak
                Log "backup: $bak"; Done $true 'ThrottleStop.ini backed up.' @{ file = $bak } 'msg.backup.done' @{}
            } else { Log 'no ThrottleStop.ini yet'; Done $true 'Nothing to back up yet (fresh install).' $null 'msg.backup.none' @{} }
        }
        'get' {
            $exe = Install-ThrottleStopBinaries $InstallDir $ZipPath
            Log $exe; Done $true 'ThrottleStop is ready.' @{ exe = $exe } 'msg.get.ready' @{}
        }
        'vbs' {
            if ($DisableVBS) { Disable-Vbs; Log 'hypervisorlaunchtype=off, VBS=0, HVCI=0'; Done $true 'VBS/hypervisor disabled. Reboot required (also switch Memory integrity off in Windows Security).' $null 'msg.vbs.disabled' @{} }
            else { Log 'skipped by user'; Done $true 'Left unchanged. If the voltage controls stay locked, run this step again with VBS disabled.' $null 'msg.vbs.unchanged' @{} }
        }
        'apply' {
            Log "settings: $SettingsFile"
            $n = Merge-ThrottleStopSettings $InstallDir $SettingsFile
            Done $true "$n settings written to ThrottleStop.ini." @{ keys = $n } 'msg.apply.done' @{ keys = $n }
        }
        'task' {
            $u = Register-ThrottleStopTask $InstallDir $TaskName
            $exe = Join-Path $InstallDir 'ThrottleStop.exe'
            if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) { Start-Process -FilePath $exe -WorkingDirectory $InstallDir; Log 'ThrottleStop started' }
            Save-Baseline $InstallDir; Log 'baseline saved (Windows build at setup time)'
            Done $true "Autostart + 5-minute watchdog registered for $u." $null 'msg.task.done' @{ user = $u }
        }
        'verify' {
            $res = Test-Tuning $InstallDir $SettingsFile $TaskName
            $res | ForEach-Object { Log ("{0}: {1} ({2})" -f $_.name, $(if ($_.ok) { 'OK' } else { 'FAIL' }), $_.detail) }
            $bad = @($res | Where-Object { -not $_.ok }).Count
            if ($bad) { Done $false "$bad check(s) need attention." $res 'msg.verify.bad' @{ count = $bad } } else { Done $true 'Everything checks out.' $res 'msg.verify.ok' @{} }
        }
        'health' {
            $h = Get-HealthReport $InstallDir $SettingsFile $TaskName
            $h.checks | ForEach-Object { Log ("{0}: {1} - {2}" -f $_.name, $(if ($_.ok) { 'OK' } else { 'ATTENTION' }), $_.detail) }
            $msg = switch ($h.verdict) { 'ok' { 'Your PC is still optimized.' } 'warn' { 'Mostly fine, one thing needs a look.' } default { 'The optimization is not fully in place.' } }
            Done ($h.verdict -ne 'fail') $msg $h ('msg.health.' + $h.verdict) @{}
        }
        'fix' {
            $l = Invoke-Fix $InstallDir $SettingsFile $TaskName -DisableVbs:$DisableVBS
            $l | ForEach-Object { Log $_ }
            $h = Get-HealthReport $InstallDir $SettingsFile $TaskName
            if ($h.verdict -eq 'ok') { Done $true 'Fixed. Your PC is optimized again.' $h 'msg.fix.ok' @{} }
            else { Done ($h.verdict -ne 'fail') 'Applied what was possible; some items still need attention (see the list).' $h 'msg.fix.partial' @{} }
        }
        'autostart' {
            $appTask = $defaults.appTaskName
            switch ($Mode) {
                'on'  { $uu = Register-AppAutostart $appTask $AppExe $AppArgs; Log "task $appTask registered for $uu"; Done $true 'The app now starts hidden in the system tray at logon.' @{ enabled = $true } 'msg.autostart.on' @{} }
                'off' { Unregister-AppAutostart $appTask; Log "task $appTask removed"; Done $true 'The app no longer starts with Windows.' @{ enabled = $false } 'msg.autostart.off' @{} }
                default {
                    $e = Get-AppAutostart $appTask
                    Done $true $(if ($e) { 'Starts with Windows.' } else { 'Does not start with Windows.' }) @{ enabled = $e } $(if ($e) { 'msg.autostart.statusOn' } else { 'msg.autostart.statusOff' }) @{}
                }
            }
        }
        'paths' {
            $exists = Test-Path -LiteralPath (Join-Path $InstallDir 'ThrottleStop.exe')
            Done $true $InstallDir @{ installDir = $InstallDir; found = $exists } 'msg.paths.ok' @{ dir = $InstallDir }
        }
        'cleanbackups' {
            $n = Remove-OldBackups $InstallDir 3
            Log "removed $n old backup(s) in $InstallDir"
            Done $true "Deleted $n old backup(s); the newest 3 were kept." @{ count = $n } 'msg.backups.deleted' @{ count = $n }
        }        'rollback' {
            $l = Invoke-Rollback $InstallDir $TaskName -RestoreVbs:$RestoreVbs
            $l | ForEach-Object { Log $_ }
            Done $true 'Rolled back.' $l 'msg.rollback.done' @{}
        }
    }
} catch { Done $false $_.Exception.Message }
