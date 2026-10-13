# Health check ("is my PC still optimized?") and one-click fix. Dot-source AFTER lib\Tuning.ps1:
#   . "$PSScriptRoot\lib\Tuning.ps1"; . "$PSScriptRoot\lib\Health.ps1"

$script:BaselineFile = Join-Path $env:ProgramData 'LegionTuning\baseline.json'

# ---------------------------------------------------------------- pure helpers (unit tested)

# Compares key=value lines of the settings template with the INI lines. Returns one object per drifted key.
function Compare-IniSettings([string[]]$IniLines, [string[]]$SettingsLines) {
    $drift = @()
    foreach ($l in $SettingsLines) {
        if ($l -notmatch '^\s*([A-Za-z0-9_]+)=(.*)$') { continue }
        $k = $Matches[1]; $want = $Matches[2]
        $have = $IniLines | Where-Object { $_ -like "$k=*" } | Select-Object -First 1
        $haveVal = if ($have) { $have.Substring($k.Length + 1) } else { $null }
        if ($haveVal -ne $want) { $drift += [pscustomobject]@{ key = $k; expected = $want; actual = $haveVal } }
    }
    return , $drift
}

# Lowest P-core turbo ratio in the template (OneAD_EAX0 / OneAD_EDX0 hold 4 ratio bytes each) in MHz, or $null.
function Get-TurboCapMHz([string[]]$SettingsLines) {
    $vals = @()
    foreach ($key in 'OneAD_EAX0', 'OneAD_EDX0') {
        $line = $SettingsLines | Where-Object { $_ -like "$key=*" } | Select-Object -First 1
        if (-not $line) { continue }
        $n = [Convert]::ToUInt32(($line.Split('=')[1] -replace '^0x', ''), 16)
        foreach ($shift in 0, 8, 16, 24) { $vals += (($n -shr $shift) -band 0xFF) }
    }
    if (-not $vals) { return $null }
    return (($vals | Measure-Object -Minimum).Minimum * 100)
}

# checks: objects with .ok and .severity ('fail' | 'warn' | 'info'). Verdict: fail > warn > ok. 'info' never changes it.
function Get-Verdict($Checks) {
    $bad = @($Checks | Where-Object { -not $_.ok })
    if (@($bad | Where-Object { $_.severity -eq 'fail' }).Count) { return 'fail' }
    if (@($bad | Where-Object { $_.severity -eq 'warn' }).Count) { return 'warn' }
    return 'ok'
}

# ---------------------------------------------------------------- baseline (what Windows looked like when we applied the tuning)

function Save-Baseline([string]$InstallDir) {
    $os = Get-CimInstance Win32_OperatingSystem
    New-Item -ItemType Directory -Force (Split-Path $script:BaselineFile) | Out-Null
    [pscustomobject]@{
        appliedAt = (Get-Date).ToString('s'); windowsBuild = $os.BuildNumber; windowsVersion = $os.Version
        windowsCaption = $os.Caption; installDir = $InstallDir
    } | ConvertTo-Json | Set-Content -LiteralPath $script:BaselineFile -Encoding UTF8
}

function Get-Baseline {
    if (Test-Path -LiteralPath $script:BaselineFile) { Get-Content -LiteralPath $script:BaselineFile -Raw | ConvertFrom-Json }
}

# ---------------------------------------------------------------- live telemetry (optional: needs HWiNFO with SensorsSM=1)

function Get-LiveTelemetry {
    try {
        $m = [IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Global\HWiNFO_SENS_SM2', [IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
    } catch { return $null }
    $v = $m.CreateViewAccessor(0, 0, 'Read')
    $ro = $v.ReadUInt32(32); $rs = $v.ReadUInt32(36); $rn = $v.ReadUInt32(40)
    $text = {
        param($off, $len)
        $b = New-Object byte[] $len; [void]$v.ReadArray($off, $b, 0, $len)
        [Text.Encoding]::Default.GetString($b).Split([char]0)[0]
    }
    $pClk = @(); $eClk = @(); $pkgT = $null; $pkgP = $null
    for ($i = 0; $i -lt $rn; $i++) {
        $o = $ro + $i * $rs; $label = & $text ($o + 12) 128; $val = $v.ReadDouble($o + 284)
        if ($label -match '^P-core \d+ Clock$') { $pClk += $val }
        elseif ($label -match '^E-core \d+ Clock$') { $eClk += $val }
        elseif ($label -eq 'CPU Package' -and -not $pkgT -and (& $text ($o + 268) 16) -match 'C$') { $pkgT = $val }
        elseif ($label -eq 'CPU Package Power' -and -not $pkgP) { $pkgP = $val }
    }
    $v.Dispose(); $m.Dispose()
    [pscustomobject]@{
        pClockMaxMHz = if ($pClk) { [int]($pClk | Measure-Object -Maximum).Maximum } else { $null }
        eClockMaxMHz = if ($eClk) { [int]($eClk | Measure-Object -Maximum).Maximum } else { $null }
        packageTempC = if ($null -ne $pkgT) { [int]$pkgT } else { $null }
        packagePowerW = if ($null -ne $pkgP) { [math]::Round($pkgP, 1) } else { $null }
    }
}

# The telemetry step: ONLY the shared-memory read (no health check, no admin). Reader is injectable for the tests.
# available = false when HWiNFO is not running with shared memory (or the memory is not readable from this process): the tiles then
# say so instead of showing anything. takenAt is the local time of the read.
function Get-TelemetrySnapshot([scriptblock]$Reader = { Get-LiveTelemetry }) {
    $live = $null
    try { $live = & $Reader } catch { $live = $null }
    $has = [bool]($live -and ($null -ne $live.packageTempC -or $null -ne $live.pClockMaxMHz -or $null -ne $live.packagePowerW))
    [pscustomobject]@{ available = $has; live = $(if ($has) { $live } else { $null }); takenAt = (Get-Date).ToString('s') }
}

# ---------------------------------------------------------------- the report

function Get-HealthReport([string]$InstallDir, [string]$SettingsFile, [string]$TaskName) {
    $checks = [System.Collections.Generic.List[object]]::new()
    # code = i18n key of the detail text (check.<id>.<state>), cargs = values for its {placeholders}.
    # name/detail stay as the English fallback for scripts and for languages without a translation.
    $add = { param($id, $name, $ok, $sev, $detail, $fix, $code, $cargs) $checks.Add([pscustomobject]@{ id = $id; name = $name; ok = [bool]$ok; severity = $sev; detail = $detail; fix = $fix; code = $code; args = $cargs }) }
    $settings = Get-Content -LiteralPath $SettingsFile

    $ini = Join-Path $InstallDir 'ThrottleStop.ini'
    if (Test-Path -LiteralPath $ini) {
        $drift = Compare-IniSettings (Get-Content -LiteralPath $ini) $settings
        if ($drift.Count) {
            $detail = 'Changed or missing: ' + (($drift | ForEach-Object { "$($_.key) (want $($_.expected), found $(if ($null -eq $_.actual) { 'nothing' } else { $_.actual }))" }) -join '; ')
            & $add 'settings' 'Tuning settings' $false 'fail' $detail 'settings' 'check.settings.drift' @{ keys = (($drift | ForEach-Object { $_.key }) -join ', ') }
        } else {
            & $add 'settings' 'Tuning settings' $true 'fail' 'Undervolt, boost caps and power limits are in the INI.' 'settings' 'check.settings.ok' @{}
        }
    } else { & $add 'settings' 'Tuning settings' $false 'fail' 'ThrottleStop.ini was not found. Run the setup wizard first.' 'settings' 'check.settings.missingIni' @{} }

    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    $ts = Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe -or -not $_.Path } | Select-Object -First 1   # Path is unreadable from a non-elevated process
    if ($ts) { & $add 'running' 'ThrottleStop is running' $true 'warn' "PID $($ts.Id)" 'start' 'check.running.ok' @{ pid = $ts.Id } }
    else { & $add 'running' 'ThrottleStop is running' $false 'warn' 'Not running, so the tuning is not applied right now.' 'start' 'check.running.no' @{} }

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) { & $add 'task' 'Always-on startup' $true 'fail' 'Starts at logon and a 5-minute watchdog keeps it running.' 'task' 'check.task.ok' @{} }
    else { & $add 'task' 'Always-on startup' $false 'fail' 'The autostart task is missing.' 'task' 'check.task.no' @{} }

    $hv = [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent
    if ($hv) { & $add 'vbs' 'Virtualization-based security off' $false 'fail' 'VBS/hypervisor is back ON (a Windows update can do this). Voltage changes are locked while it is on.' 'vbs' 'check.vbs.no' @{} }
    else { & $add 'vbs' 'Virtualization-based security off' $true 'fail' 'Off, so voltage changes can be applied.' 'vbs' 'check.vbs.ok' @{} }

    $base = Get-Baseline
    $os = Get-CimInstance Win32_OperatingSystem
    if ($base) {
        if ($base.windowsBuild -eq $os.BuildNumber) {
            & $add 'windows' 'Windows build since setup' $true 'info' "Unchanged (build $($os.BuildNumber), applied $($base.appliedAt))." $null 'check.windows.ok' @{ build = $os.BuildNumber; applied = $base.appliedAt }
        } else {
            & $add 'windows' 'Windows build since setup' $false 'info' "Windows was updated: build $($base.windowsBuild) -> $($os.BuildNumber) since the tuning was applied on $($base.appliedAt)." $null 'check.windows.no' @{ from = $base.windowsBuild; to = $os.BuildNumber; applied = $base.appliedAt }
        }
    }

    $live = Get-LiveTelemetry
    $cap = Get-TurboCapMHz $settings
    if ($live -and $live.pClockMaxMHz -and $cap) {
        if ($live.pClockMaxMHz -gt ($cap * 1.03)) {
            & $add 'cap' 'Boost cap is active' $false 'warn' "A P-core is at $($live.pClockMaxMHz) MHz, above the $cap MHz cap." 'settings' 'check.cap.no' @{ clock = $live.pClockMaxMHz; cap = $cap }
        } else {
            & $add 'cap' 'Boost cap is active' $true 'warn' "Highest P-core clock right now: $($live.pClockMaxMHz) MHz (cap $cap MHz)." 'settings' 'check.cap.ok' @{ clock = $live.pClockMaxMHz; cap = $cap }
        }
    }

    [pscustomobject]@{
        verdict = (Get-Verdict $checks)
        installed = (Test-Path -LiteralPath $ini)
        checks = @($checks)
        live = $live
        baseline = $base
        windows = "$($os.Caption) (build $($os.BuildNumber))"
        checkedAt = (Get-Date).ToString('s')
    }
}
# ---------------------------------------------------------------- one-click fix

# Re-applies only what drifted. VBS is a security setting, so it is touched only with -DisableVbs. Returns log lines.
function Invoke-Fix([string]$InstallDir, [string]$SettingsFile, [string]$TaskName, [switch]$DisableVbs) {
    $log = @()
    $report = Get-HealthReport $InstallDir $SettingsFile $TaskName
    $need = @($report.checks | Where-Object { -not $_.ok -and $_.fix } | ForEach-Object { $_.fix } | Sort-Object -Unique)
    if (-not $need.Count) { return @('Nothing to fix.') }
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'

    if ($need -contains 'settings') {
        $ini = Join-Path $InstallDir 'ThrottleStop.ini'
        if (Test-Path -LiteralPath $ini) { $bak = "$ini.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"; Copy-Item -LiteralPath $ini $bak; $log += "backup: $bak" }
        $n = Merge-ThrottleStopSettings $InstallDir $SettingsFile
        $log += "$n settings re-applied"
    }
    if ($need -contains 'task') { $u = Register-ThrottleStopTask $InstallDir $TaskName; $log += "autostart task registered for $u" }
    if ($need -contains 'vbs') {
        if ($DisableVbs) { Disable-Vbs; $log += 'VBS/hypervisor disabled - reboot required' }
        else { $log += 'VBS is on: left unchanged (tick "disable VBS" to allow it). Voltage changes stay locked until then.' }
    }
    if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) {
        Start-Process -FilePath $exe -WorkingDirectory $InstallDir; $log += 'ThrottleStop started'
    }
    Save-Baseline $InstallDir
    return $log
}
