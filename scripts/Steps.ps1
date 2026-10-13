#Requires -Version 5.1
<#
.SYNOPSIS  Runs ONE step and reports it as machine-readable lines for the Electron app.
.DESCRIPTION
  Output protocol (stdout, one per line):
    LOG: <text>
    RESULT: <json {ok, message, code, args, data}>      (code/args = language-neutral i18n key + values; message = English fallback)
  Steps: detect | backup | get | vbs | apply | task | verify | health | fix | autostart | rollback | paths | cleanbackups | tweaks-list | tweak-set | tweaks-recommended | cleanup-scan | cleanup-run | restore-list | restore-create | restore-open | sensors-state | sensors-get | sensors-read | hwinfo-state | hwinfo-check | hwinfo-get | hwinfo-start | hwinfo-stop
#>
param(
    [Parameter(Mandatory)][ValidateSet('detect', 'backup', 'get', 'vbs', 'apply', 'task', 'verify', 'health', 'fix', 'autostart', 'rollback', 'paths', 'cleanbackups', 'tweaks-list', 'tweak-set', 'tweaks-recommended', 'cleanup-scan', 'cleanup-run', 'restore-list', 'restore-create', 'restore-open', 'sensors-state', 'sensors-get', 'sensors-read', 'hwinfo-state', 'hwinfo-check', 'hwinfo-get', 'hwinfo-start', 'hwinfo-stop')][string]$Step,
    [string]$InstallDir,
    [string]$ZipPath,
    [string]$SettingsFile,
    [string]$TaskName,
    [switch]$DisableVBS,
    [switch]$RestoreVbs,
    [ValidateSet('status', 'on', 'off')][string]$Mode = 'status',   # autostart step
    [string]$AppExe,
    [string]$AppArgs,
    [string]$TweakId,
    [ValidateSet('on', 'off')][string]$TweakMode = 'on',   # tweak-set step
    [switch]$AllowRisky,
    [string]$CleanupIds,       # cleanup-run: comma separated target ids
    [string]$RestoreName,      # restore-create: description of the point
    [switch]$NoSafetyPoint,    # tweak-set / tweaks-recommended: do not create the safety restore point first
    [switch]$Download,         # get step: fetch ThrottleStop from TechPowerUp when it is not on the PC (the user agreed in the app); hwinfo-get: the user agreed to download HWiNFO
    [string]$HwinfoVersion,    # hwinfo-get: the version the user was shown and agreed to (refused when the page offers another)
    [switch]$UpdateIni         # hwinfo-start: turn SensorsSM=1 on in the user's own HWiNFO64.INI (a timestamped .bak is made first)
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $SettingsFile) { $SettingsFile = Join-Path $root '..\config\ThrottleStop.settings.ini' }
. (Join-Path $root 'lib\Tuning.ps1')
. (Join-Path $root 'lib\Health.ps1')
. (Join-Path $root 'lib\Tweaks.ps1')
. (Join-Path $root 'lib\Cleanup.ps1')
. (Join-Path $root 'lib\Restore.ps1')
. (Join-Path $root 'lib\Sensors.ps1')
. (Join-Path $root 'lib\Hwinfo.ps1')
$defaults = Get-Defaults
if (-not $InstallDir) { $InstallDir = $defaults.installDir }
if (-not $TaskName)   { $TaskName   = $defaults.taskName }
$InstallDir = Resolve-InstallDir $InstallDir $TaskName   # ThrottleStop may live elsewhere than the default folder

function Log($m) { Write-Output "LOG: $m" }
function Done($ok, $msg, $data = $null, $code = $null, $cargs = $null) {
    Write-Output ("RESULT: " + (@{ ok = [bool]$ok; message = $msg; code = $code; args = $cargs; data = $data } | ConvertTo-Json -Depth 6 -Compress))
}

try {
    $readOnly = ($Step -in 'detect', 'verify', 'health', 'paths', 'cleanbackups', 'tweaks-list', 'tweak-set', 'tweaks-recommended', 'cleanup-scan', 'restore-list', 'restore-open', 'sensors-state', 'sensors-get', 'sensors-read', 'hwinfo-state', 'hwinfo-check') -or ($Step -eq 'autostart' -and $Mode -eq 'status')
    if ($Step -in 'hwinfo-get', 'hwinfo-start', 'hwinfo-stop' -and -not (Test-Admin)) { Done $false 'Administrator rights are required for this step. Restart the app as administrator.' $null 'msg.hwinfo.needsAdmin' @{}; return }
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
            $exe = Install-ThrottleStopBinaries $InstallDir $ZipPath -Download:$Download
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
        }
        'tweaks-list' {
            $list = @(Get-TweakStatuses)
            Done $true "$($list.Count) tweaks." @{ tweaks = $list; admin = (Test-Admin); build = (Get-WindowsBuild) } 'msg.tweaks.listed' @{ count = $list.Count }
        }
        'tweak-set' {
            if (-not $TweakId) { throw 'tweak-set needs -TweakId.' }
            $sp = $null
            if ($TweakMode -eq 'on' -and -not $NoSafetyPoint -and (Test-FirstTweak)) { $sp = New-KbRestorePoint 'KafkaBoost: before the first tweak'; Log "restore point: $($sp.code)" }
            $r = Set-Tweak $TweakId ($TweakMode -eq 'on') -AllowRisky:$AllowRisky
            if ($sp) { $r | Add-Member -NotePropertyName restorePoint -NotePropertyValue $sp.code -Force }
            Log "$TweakId -> $TweakMode : $(if ($r.ok) { 'ok' } else { $r.error })"
            Done $r.ok $(if ($r.ok) { "Tweak $TweakId $(if ($TweakMode -eq 'on') { 'applied' } else { 'reverted' })." } else { $r.error }) $r $r.code @{ id = $TweakId }
        }
        'tweaks-recommended' {
            $sp = $null
            if (-not $NoSafetyPoint) { $sp = New-KbRestorePoint 'KafkaBoost: before Apply recommended'; Log "restore point: $($sp.code)" }
            $rs = @(Set-RecommendedTweaks)
            $bad = @($rs | Where-Object { -not $_.ok }).Count
            $rs | ForEach-Object { Log "$($_.id): $(if ($_.ok) { 'applied' } else { $_.error })" }
            Done ($bad -eq 0) "$($rs.Count - $bad) applied, $bad failed." @{ results = $rs; restorePoint = $(if ($sp) { $sp.code } else { $null }) } $(if ($bad) { 'msg.tweaks.recommendedPartial' } else { 'msg.tweaks.recommendedOk' }) @{ ok = ($rs.Count - $bad); failed = $bad }
        }
        'cleanup-scan' {
            $sizes = @(Get-CleanupSizes)
            $total = [int64]0; foreach ($s in $sizes) { if (-not $s.danger) { $total += $s.bytes } }
            Done $true "$([math]::Round($total / 1MB)) MB can be cleaned." @{ targets = $sizes; admin = (Test-Admin) } 'msg.cleanup.scanned' @{ mb = [math]::Round($total / 1MB) }
        }
        'cleanup-run' {
            $ids = @($CleanupIds -split '[,\s]+' | Where-Object { $_ })
            if (-not $ids.Count) { throw 'cleanup-run needs -CleanupIds.' }
            $res = @(Invoke-Cleanup $ids)
            $bytes = [int64]0; $files = 0; $skipped = 0
            foreach ($r in $res) { $bytes += $r.bytes; $files += $r.files; $skipped += $r.skipped; Log "$($r.id): $($r.files) files, $([math]::Round($r.bytes / 1MB, 1)) MB, $($r.skipped) skipped" }
            Done $true "Freed $([math]::Round($bytes / 1MB, 1)) MB ($files files, $skipped skipped)." @{ results = $res; bytes = $bytes; files = $files; skipped = $skipped } 'msg.cleanup.done' @{ mb = [math]::Round($bytes / 1MB, 1); files = $files; skipped = $skipped }
        }
        'restore-list' {
            if (-not (Test-Admin)) { Done $true 'Administrator rights are needed to read the restore points.' @{ admin = $false; points = @() } 'msg.restore.needsAdmin' @{}; return }
            try { $pts = @(Get-KbRestorePoints) } catch { Done $true 'System Protection looks off, or Windows returned no restore points.' @{ admin = $true; points = @() } 'msg.restore.none' @{}; return }
            Done $true "$($pts.Count) restore point(s)." @{ admin = $true; points = $pts } 'msg.restore.listed' @{ count = $pts.Count }
        }
        'restore-create' {
            $name = if ($RestoreName) { $RestoreName.Substring(0, [math]::Min(100, $RestoreName.Length)) } else { 'KafkaBoost' }
            $r = New-KbRestorePoint $name
            Log "$($r.code): $($r.message)"
            Done $r.ok $r.message $r $r.code @{}
        }
        'restore-open' {
            Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\rstrui.exe')
            Done $true 'System Restore opened.' $null 'msg.restore.opened' @{}
        }
        'sensors-state' {
            $st = Get-SensorState
            Done $true $(if ($st.installed) { "$($st.name) $($st.version) is installed." } else { "$($st.name) $($st.version) is not installed." }) $st $(if ($st.installed) { 'msg.sensors.installed' } else { 'msg.sensors.missing' }) @{ version = $st.version }
        }
        'sensors-get' {
            if (-not (Test-Admin)) { Done $false 'Administrator rights are required to install the sensor library.' $null 'msg.sensors.getNeedsAdmin' @{}; return }
            $cfg = Get-SensorConfig
            Log "downloading $($cfg.name) $($cfg.version) ($($cfg.url))"
            try { $r = Install-SensorSupport $cfg } catch {
                Log $_.Exception.Message
                Done $false $_.Exception.Message $null $(if ($_.Exception.Message -like 'SHA-256 mismatch*') { 'msg.sensors.hashMismatch' } else { 'msg.sensors.getFailed' }) @{ detail = $_.Exception.Message }
                return
            }
            Log "unpacked $($r.files) files to $($r.dir)"
            Done $true "$($cfg.name) $($cfg.version) installed." $r 'msg.sensors.installed' @{ version = $cfg.version }
        }
        'sensors-read' {
            $r = Get-SensorSnapshot
            Done $r.ok $r.message $r.data $r.code @{ detail = $r.message }
        }
        'hwinfo-state' {
            $st = Get-HwinfoState
            Done $true $(if ($st.installed) { "HWiNFO $($st.version) found ($($st.source))." } else { 'HWiNFO is not on this PC.' }) $st $(if ($st.installed) { 'msg.hwinfo.state.installed' } else { 'msg.hwinfo.state.missing' }) @{ version = $st.version }
        }
        'hwinfo-check' {
            $cfg = Get-HwinfoConfig
            try { $rel = Get-HwinfoRelease $cfg } catch {
                $c = $_.Exception.Data['code']; Log $_.Exception.Message
                Done $false $_.Exception.Message $null $(if ($c) { $c } else { 'msg.hwinfo.networkFailed' }) @{ detail = $_.Exception.Message }
                return
            }
            Done $true "HWiNFO $($rel.version) is the current portable build." $rel 'msg.hwinfo.checked' @{ version = $rel.version }
        }
        'hwinfo-get' {
            if (-not $Download -and -not $ZipPath) { Done $false 'Downloading HWiNFO needs your agreement in the app.' $null 'msg.hwinfo.consentNeeded' @{}; return }
            $cfg = Get-HwinfoConfig
            if ($HwinfoVersion -and $HwinfoVersion -notmatch '^[0-9]+\.[0-9]+$') { throw 'Bad -HwinfoVersion.' }
            if ($ZipPath) { Log "using $ZipPath (no download)" } else { Log "downloading HWiNFO from $($cfg.downloadPage)" }
            try { $r = Install-Hwinfo $cfg $HwinfoVersion $ZipPath } catch {
                $c = $_.Exception.Data['code']; $a = $_.Exception.Data['args']; Log $_.Exception.Message
                Done $false $_.Exception.Message $null $(if ($c) { $c } else { 'msg.hwinfo.getFailed' }) $(if ($a) { $a } else { @{ detail = $_.Exception.Message } })
                return
            }
            Log "signature OK ($($r.signer)); unpacked to $($r.dir); INI: $($r.ini)"
            Done $true "HWiNFO $($r.version) installed." $r 'msg.hwinfo.installed' @{ version = $r.version }
        }
        'hwinfo-start' {
            $r = Start-HwinfoApp (Get-HwinfoConfig) -UpdateIni:$UpdateIni
            Log "$($r.code): $($r.message)"
            Done $r.ok $r.message $r.data $r.code @{ detail = $r.message }
        }
        'hwinfo-stop' {
            $r = Stop-HwinfoApp
            Log "$($r.code): $($r.message)"
            Done $r.ok $r.message $r.data $r.code @{}
        }
        'rollback' {
            $l = Invoke-Rollback $InstallDir $TaskName -RestoreVbs:$RestoreVbs
            $l | ForEach-Object { Log $_ }
            Done $true 'Rolled back.' $l 'msg.rollback.done' @{}
        }
    }
} catch { Done $false $_.Exception.Message }
