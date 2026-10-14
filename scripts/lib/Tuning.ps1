# Shared functions for the ThrottleStop tuning (used by Install-Tuning.ps1 and the Electron wizard via Steps.ps1).
# Dot-source this file:  . "$PSScriptRoot\lib\Tuning.ps1"

# Single source of truth for install dir and task name: config\defaults.json (also read by app\src\main.js).
function Get-Defaults {
    $f = Join-Path $PSScriptRoot '..\..\config\defaults.json'
    Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
}

# FIVR offset (negative mV) -> ThrottleStop.ini hex. field = 2048 - round(|mV| x 1.024), value = field << 21.  See docs/CONFIGURATION.md
function ConvertTo-FivrHex([double]$mV) {
    $field = (2048 - [int][math]::Round([math]::Abs($mV) * 1.024)) -band 0x7FF
    if ($mV -eq 0) { return '0x00000000' }
    return ('0x{0:X8}' -f (($field -shl 21) -band 0xFFFFFFFF))
}

# V/F point offset (signed mV) -> hex. field = round(mV x 1.024), value = field << 21.
function ConvertTo-VfHex([double]$mV) {
    $field = ([int][math]::Round($mV * 1.024)) -band 0x7FF
    return ('0x{0:X8}' -f (($field -shl 21) -band 0xFFFFFFFF))
}
function Test-Admin {

    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---- hardware details for the Dashboard cards (read-only, no serial numbers anywhere) -----------------------------
# Disks: model, size in GB and type only. Win32_DiskDrive and MSFT_PhysicalDisk are injectable so the tests need no hardware.
# MSFT_PhysicalDisk.MediaType: 3 = HDD, 4 = SSD, 5 = SCM; BusType 17 = NVMe. Everything else is "unknown".
function Get-DiskSummary([scriptblock]$Drives = { Get-CimInstance Win32_DiskDrive }, [scriptblock]$Physical = { Get-CimInstance -Namespace 'root\Microsoft\Windows\Storage' -ClassName MSFT_PhysicalDisk }) {
    $rows = @(); $phys = @()
    try { $rows = @(& $Drives) } catch { return @() }
    try { $phys = @(& $Physical) } catch { $phys = @() }
    $out = @()
    foreach ($d in $rows) {
        if (-not $d.Model -or $d.MediaType -match 'Removable') { continue }
        $p = $phys | Where-Object { $_.FriendlyName -and $_.FriendlyName.Trim() -eq $d.Model.Trim() } | Select-Object -First 1
        $type = 'unknown'
        if ($p) {
            if ($p.BusType -eq 17) { $type = 'nvme' }
            elseif ($p.MediaType -eq 4) { $type = 'ssd' }
            elseif ($p.MediaType -eq 3) { $type = 'hdd' }
        }
        $out += [pscustomobject]@{ model = $d.Model.Trim(); sizeGB = [int][math]::Round([double]$d.Size / 1e9); type = $type }
    }
    return $out
}

# RAM: total GB, configured speed in MHz (the highest module speed) and the number of modules. $Modules = Win32_PhysicalMemory rows.
function Get-MemorySummary([scriptblock]$Modules = { Get-CimInstance Win32_PhysicalMemory }) {
    $rows = @()
    try { $rows = @(& $Modules) } catch { $rows = @() }
    $speeds = @($rows | ForEach-Object { if ($_.ConfiguredClockSpeed) { [int]$_.ConfiguredClockSpeed } elseif ($_.Speed) { [int]$_.Speed } } | Where-Object { $_ })
    [pscustomobject]@{
        speedMHz = $(if ($speeds.Count) { ($speeds | Measure-Object -Maximum).Maximum } else { $null })
        modules = $rows.Count
    }
}

function Get-HardwareInfo([string]$InstallDir, [string]$TaskName) {
    $cs  = Get-CimInstance Win32_ComputerSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $os  = Get-CimInstance Win32_OperatingSystem
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    $ts  = Get-Process ThrottleStop -ErrorAction SilentlyContinue | Select-Object -First 1
    $mem = Get-MemorySummary
    $disks = @(Get-DiskSummary)
    [pscustomobject]@{
        os                = 'windows'
        osVersion         = "$($os.Caption) (build $($os.BuildNumber))"
        gpu               = ((Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Microsoft|Basic' } | ForEach-Object { $_.Name }) -join ', ')
        ramGB             = [int][math]::Round($cs.TotalPhysicalMemory / 1GB)
        powerPlan         = $(if ((powercfg /getactivescheme) -match '\((.+)\)\s*$') { $Matches[1].Trim() } else { 'unknown' })
        manufacturer      = $cs.Manufacturer
        model             = $cs.Model
        cpu               = $cpu.Name.Trim()
        cpuCores          = [int]$cpu.NumberOfCores
        cpuThreads        = [int]$cpu.NumberOfLogicalProcessors
        ramSpeedMHz       = $mem.speedMHz
        ramModules        = $mem.modules
        disks             = $disks
        cpuSupported      = [bool]($cpu.Name -match '14900HX')
        modelVerified     = [bool]($cs.Model -eq '83DE')
        isAdmin           = (Test-Admin)
        hypervisorPresent = [bool]$cs.HypervisorPresent
        throttleStopFound = (Test-Path -LiteralPath $exe)
        throttleStopRunning = [bool]$ts
        taskInstalled     = [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
    }
}

function Find-ThrottleStopZip {
    Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter 'ThrottleStop*.zip' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}

# Returns the path of ThrottleStop.exe, unpacking a zip if needed. Throws with a user-facing message if unavailable.
# ---- download ThrottleStop from TechPowerUp (only when the user asked for it) -------------------------------------
$script:TpuPage = 'https://www.techpowerup.com/download/techpowerup-throttlestop/'

# First value of a hidden form field (name="id" value="2835") in a page; $null when absent.
function Get-HtmlFieldValue([string]$Html, [string]$Name) {
    $m = [regex]::Match($Html, 'name="' + [regex]::Escape($Name) + '"\s+value="([^"]*)"')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

# True when the file is a zip that holds ThrottleStop.exe (guards against saving an HTML error page as the "download").
function Test-ThrottleStopZip([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($Path)
        try { return [bool]($z.Entries | Where-Object { $_.Name -eq 'ThrottleStop.exe' }) } finally { $z.Dispose() }
    } catch { return $false }
}

# The TechPowerUp flow: version list (newest first) -> pick that version -> pick a server -> the zip.
# Returns @{ path; version; source }. Throws a readable message when the site changes shape or blocks us.
function Save-ThrottleStopDownload([string]$DestDir) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ua = 'Mozilla/5.0 (KafkaBoost setup)'
    $page = Invoke-WebRequest -Uri $script:TpuPage -UserAgent $ua -UseBasicParsing -TimeoutSec 30
    $id = Get-HtmlFieldValue $page.Content 'id'
    if (-not $id) { throw 'The TechPowerUp page changed and the version list was not found. Download ThrottleStop yourself and choose the zip.' }
    $pick = Invoke-WebRequest -Uri $script:TpuPage -Method Post -Body @{ id = $id } -UserAgent $ua -UseBasicParsing -TimeoutSec 30
    $server = Get-HtmlFieldValue $pick.Content 'server_id'
    if (-not $server) { throw 'TechPowerUp did not offer a download server. Download ThrottleStop yourself and choose the zip.' }
    New-Item -ItemType Directory -Force $DestDir | Out-Null
    $tmp = Join-Path $DestDir ('ThrottleStop_download_' + [guid]::NewGuid().ToString('N') + '.zip')
    $resp = Invoke-WebRequest -Uri $script:TpuPage -Method Post -Body @{ id = $id; server_id = $server } -UserAgent $ua -UseBasicParsing -OutFile $tmp -PassThru -TimeoutSec 180
    if (-not (Test-ThrottleStopZip $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; throw 'The downloaded file is not a ThrottleStop zip. Download it yourself and choose the zip.' }
    $final = try { $resp.BaseResponse.ResponseUri.AbsoluteUri } catch { $script:TpuPage }
    $ver = if ($final -match 'ThrottleStop_([0-9][0-9.]*)\.zip') { $Matches[1] } else { '' }
    return @{ path = $tmp; version = $ver; source = $final }
}

function Install-ThrottleStopBinaries([string]$InstallDir, [string]$ZipPath, [switch]$Download) {
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    if (Test-Path -LiteralPath $exe) { return $exe }
    if (-not $ZipPath) { $ZipPath = Find-ThrottleStopZip }
    $downloaded = $null
    if ((-not $ZipPath -or -not (Test-Path -LiteralPath $ZipPath)) -and $Download) {
        $d = Save-ThrottleStopDownload (Join-Path $env:TEMP 'KafkaBoost_dl')
        $ZipPath = $d.path; $downloaded = $d.path
    }
    if (-not $ZipPath -or -not (Test-Path -LiteralPath $ZipPath)) {
        throw "ThrottleStop not found in '$InstallDir', and no ThrottleStop folder or ThrottleStop*.zip was found in Downloads, Desktop or Documents. Download it from https://www.techpowerup.com/download/techpowerup-throttlestop/ (tested with 9.7.3), keep the .zip in Downloads (or pass -ZipPath, or extract it and pass -InstallDir) and run this step again."
    }
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $InstallDir -Force
    if (-not (Test-Path -LiteralPath $exe)) {   # some zips contain a single sub-folder
        $sub = Get-ChildItem $InstallDir -Recurse -Filter ThrottleStop.exe | Select-Object -First 1
        if ($sub) { Get-ChildItem $sub.Directory.FullName | Move-Item -Destination $InstallDir -Force }
    }
    if ($downloaded) { Remove-Item -LiteralPath $downloaded -Force -ErrorAction SilentlyContinue }
    if (-not (Test-Path -LiteralPath $exe)) { throw "ThrottleStop.exe not found after unpacking $ZipPath" }
    return $exe
}

function Disable-Vbs {
    bcdedit /set hypervisorlaunchtype off | Out-Null
    reg add 'HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard' /v EnableVirtualizationBasedSecurity /t REG_DWORD /d 0 /f | Out-Null
    reg add 'HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' /v Enabled /t REG_DWORD /d 0 /f | Out-Null
}

function Restore-Vbs {
    bcdedit /set hypervisorlaunchtype auto | Out-Null
    reg add 'HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard' /v EnableVirtualizationBasedSecurity /t REG_DWORD /d 1 /f | Out-Null
}

# Reads one boot-config element for the current OS entry. value is $null when the element is not set (Windows uses its own default).
function Get-BcdElement([string]$Element) {
    $out = & bcdedit /enum '{current}' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { return [pscustomobject]@{ exists = $false; value = $null } }
    $m = [regex]::Match(($out -join "`n"), "(?im)^\s*$([regex]::Escape($Element))\s+(\S+)\s*$")
    if ($m.Success) { return [pscustomobject]@{ exists = $true; value = $m.Groups[1].Value } }
    return [pscustomobject]@{ exists = $false; value = $null }
}

function Set-BcdElement([string]$Element, [string]$Value) {
    & bcdedit /set $Element $Value | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "bcdedit /set $Element $Value failed (exit $LASTEXITCODE)." }
}

# Removes the override, so the element goes back to the Windows default (not to a recorded "off" value).
function Remove-BcdElement([string]$Element) {
    & bcdedit /deletevalue $Element 2>$null | Out-Null   # exit code is non-zero when the element was already unset; not an error here
}

# Merges key=value lines of $SettingsFile into ThrottleStop.ini. Stops ONLY the ThrottleStop whose path is $Exe
# (SaveOnExit=2 would overwrite the edit on a clean exit). Returns the number of keys written.
function Merge-ThrottleStopSettings([string]$InstallDir, [string]$SettingsFile) {
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    $running = Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
    if ($running) { $running | Stop-Process -Force; Start-Sleep -Seconds 2 }
    $iniPath = Join-Path $InstallDir 'ThrottleStop.ini'
    if (Test-Path -LiteralPath $iniPath) {
        $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $iniPath)
    } else {
        $lines = [System.Collections.Generic.List[string]]::new(); $lines.Add('[ThrottleStop]')
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
    return $count
}

# Logon trigger + 5-minute watchdog that starts ThrottleStop only when it is not running.
function Register-ThrottleStopTask([string]$InstallDir, [string]$TaskName) {
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    $cmd = "if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue)) { Start-Process -FilePath '$exe' -WorkingDirectory '$InstallDir' }"
    $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`""
    $user     = "$env:USERDOMAIN\$env:USERNAME"
    $logon    = New-ScheduledTaskTrigger -AtLogOn -User $user
    $repeat   = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $logon.Repetition = $repeat.Repetition
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
                  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon -Settings $settings -Principal $principal -Force | Out-Null
    return $user
}

# Read-only verification. Returns a list of {name, ok, detail}.
function Test-Tuning([string]$InstallDir, [string]$SettingsFile, [string]$TaskName) {
    $r = [System.Collections.Generic.List[object]]::new()
    $add = { param($n, $ok, $d) $r.Add([pscustomobject]@{ name = $n; ok = [bool]$ok; detail = $d }) }
    $ini = Join-Path $InstallDir 'ThrottleStop.ini'
    if (Test-Path -LiteralPath $ini) {
        $cur = Get-Content -LiteralPath $ini; $bad = @(); $n = 0
        foreach ($l in Get-Content -LiteralPath $SettingsFile) {
            if ($l -notmatch '^\s*([A-Za-z0-9_]+)=(.*)$') { continue }
            $n++; $k = $Matches[1]; $hit = $cur | Where-Object { $_ -eq "$k=$($Matches[2])" } | Select-Object -First 1
            if (-not $hit) { $bad += $k }
        }
        & $add 'ThrottleStop.ini settings' ($bad.Count -eq 0) ($(if ($bad.Count) { "differs: $($bad -join ', ')" } else { "$n/$n keys match" }))
    } else { & $add 'ThrottleStop.ini settings' $false 'ThrottleStop.ini not found' }
    $ts = Get-Process ThrottleStop -ErrorAction SilentlyContinue
    & $add 'ThrottleStop running' ([bool]$ts) ($(if ($ts) { "PID $($ts[0].Id)" } else { 'not running (the watchdog starts it within 5 min)' }))
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    & $add 'Autostart + watchdog task' ([bool]$t) ($(if ($t) { "state $($t.State)" } else { 'task missing' }))
    $hv = [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent
    & $add 'Hypervisor/VBS off (needed for undervolt)' (-not $hv) ($(if ($hv) { 'still ON - disable it and reboot' } else { 'off' }))
    return $r
}

# Undo: remove the task, restore the newest ThrottleStop.ini backup, optionally re-enable VBS.
function Invoke-Rollback([string]$InstallDir, [string]$TaskName, [switch]$RestoreVbs) {
    $log = @()
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; $log += 'task removed' }
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    Get-Process ThrottleStop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
    $bak = Get-ChildItem -Path $InstallDir -Filter 'ThrottleStop.ini.bak_*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($bak) { Copy-Item -LiteralPath $bak.FullName (Join-Path $InstallDir 'ThrottleStop.ini') -Force; $log += "ThrottleStop.ini restored from $($bak.Name)" }
    else { $log += 'no ThrottleStop.ini backup found - INI left as is' }
    if ($RestoreVbs) { Restore-Vbs; $log += 'VBS/hypervisor re-enabled (reboot required)' }
    return $log
}

# ---- app autostart: opens the Electron app hidden in the system tray at logon (elevated, because the app asks for admin rights)
function Get-AppAutostart([string]$TaskName) { [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) }

function Register-AppAutostart([string]$TaskName, [string]$AppExe, [string]$AppArgs) {
    if (-not (Test-Path -LiteralPath $AppExe)) { throw "App executable not found: $AppExe" }
    $user      = "$env:USERDOMAIN\$env:USERNAME"
    $action    = New-ScheduledTaskAction -Execute $AppExe -Argument $AppArgs
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
                   -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    return $user
}

function Unregister-AppAutostart([string]$TaskName) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
}

# Extracts the ThrottleStop.exe path from the watchdog task's arguments (pure, unit tested).
function Get-ExeFromTaskArguments([string]$Arguments) {
    if ($Arguments -match "-FilePath '([^']+ThrottleStop\.exe)'") { return $Matches[1] }
    return $null
}

# Looks for an already extracted ThrottleStop (a folder containing ThrottleStop.exe, at most two levels deep) in the places people
# keep it. Returns the folder of the most recently modified copy, or $null.
function Find-ThrottleStopFolder([string[]]$Roots) {
    if (-not $Roots) {
        $Roots = @((Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Documents'),
                   'C:\Tools', 'C:\ThrottleStop', $env:ProgramFiles)
    }
    $hits = foreach ($r in $Roots) {
        if ($r -and (Test-Path -LiteralPath $r)) {
            Get-ChildItem -LiteralPath $r -Filter 'ThrottleStop.exe' -Recurse -Depth 2 -File -ErrorAction SilentlyContinue
        }
    }
    $best = $hits | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($best) { return $best.DirectoryName }
    return $null
}

# The folder the user asked for if ThrottleStop is there; otherwise the folder the existing watchdog task starts it from; otherwise
# an already extracted copy found in the usual places (Downloads, Desktop, ...); otherwise the requested folder unchanged
# (so a fresh install still unpacks a zip into it).
function Resolve-InstallDir([string]$Requested, [string]$TaskName, [string[]]$SearchRoots) {
    if ($Requested -and (Test-Path -LiteralPath (Join-Path $Requested 'ThrottleStop.exe'))) { return $Requested }
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        foreach ($a in $task.Actions) {
            $exe = Get-ExeFromTaskArguments ([string]$a.Arguments)
            if ($exe -and (Test-Path -LiteralPath $exe)) { return (Split-Path -Parent $exe) }
        }
    }
    $found = Find-ThrottleStopFolder $SearchRoots
    if ($found) { return $found }
    return $Requested
}

# Deletes ThrottleStop.ini.bak_* backups beyond the newest $Keep. Returns how many were removed.
function Remove-OldBackups([string]$InstallDir, [int]$Keep = 3) {
    if (-not (Test-Path -LiteralPath $InstallDir)) { return 0 }
    $files = @(Get-ChildItem -LiteralPath $InstallDir -Filter 'ThrottleStop.ini.bak_*' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    $old = @($files | Select-Object -Skip $Keep)
    foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force }
    return $old.Count
}