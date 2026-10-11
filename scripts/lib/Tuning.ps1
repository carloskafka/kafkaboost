# Shared functions for the ThrottleStop tuning (used by Install-Tuning.ps1 and the Electron wizard via Steps.ps1).
# Dot-source this file:  . "$PSScriptRoot\lib\Tuning.ps1"

# Single source of truth for install dir and task name: config\defaults.json (also read by app\src\main.js).
function Get-Defaults {
    $f = Join-Path $PSScriptRoot '..\..\config\defaults.json'
    Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
}

function Test-Admin {

    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-HardwareInfo([string]$InstallDir, [string]$TaskName) {
    $cs  = Get-CimInstance Win32_ComputerSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $os  = Get-CimInstance Win32_OperatingSystem
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    $ts  = Get-Process ThrottleStop -ErrorAction SilentlyContinue | Select-Object -First 1
    [pscustomobject]@{
        os                = 'windows'
        osVersion         = "$($os.Caption) (build $($os.BuildNumber))"
        manufacturer      = $cs.Manufacturer
        model             = $cs.Model
        cpu               = $cpu.Name.Trim()
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
function Install-ThrottleStopBinaries([string]$InstallDir, [string]$ZipPath) {
    $exe = Join-Path $InstallDir 'ThrottleStop.exe'
    if (Test-Path -LiteralPath $exe) { return $exe }
    if (-not $ZipPath) { $ZipPath = Find-ThrottleStopZip }
    if (-not $ZipPath -or -not (Test-Path -LiteralPath $ZipPath)) {
        throw 'ThrottleStop not found. Download it from https://www.techpowerup.com/download/techpowerup-throttlestop/ (tested with 9.7.3), keep the .zip in Downloads and run this step again.'
    }
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $InstallDir -Force
    if (-not (Test-Path -LiteralPath $exe)) {   # some zips contain a single sub-folder
        $sub = Get-ChildItem $InstallDir -Recurse -Filter ThrottleStop.exe | Select-Object -First 1
        if ($sub) { Get-ChildItem $sub.Directory.FullName | Move-Item -Destination $InstallDir -Force }
    }
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
