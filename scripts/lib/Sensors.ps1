# Live sensors (the Sensors screen): temperatures, clocks, voltages, power, fans and load for CPU, GPU, board, disks and memory.
# Source: LibreHardwareMonitor (MPL-2.0), downloaded on demand when the user agrees. Nothing from it is committed to this repo.
# Dot-source after Tuning.ps1 (Test-Admin, Get-Defaults).
#
# Rules
#   * The release is pinned in config/sensors.json (version, url, SHA-256). A download whose hash differs is deleted and refused.
#   * Only the library DLLs are unpacked (no GUI exe, no symbols); the folder is locked to administrators for writing, because an
#     elevated process loads the DLL from it.
#   * We never install a driver. LibreHardwareMonitor 0.9.x reads Intel/AMD CPU sensors through the PawnIO driver, which the user
#     installs on their own; without it the CPU temperature and power are simply absent and we say so. We never invent a value.
#   * This is not LatencyMon: nothing here measures DPC/ISR latency.
# Tests set $script:SensorProvider = @{ Read = { @{ pawnio = $true; hardware = @(...) } } } and $script:SensorDownloader = { param($url, $out) ... }.

$script:SensorProvider = $null
$script:SensorDownloader = $null
$script:SensorsRoot = Join-Path $env:ProgramData 'LegionTuning\sensors'
$script:SensorsConfigPath = Join-Path $PSScriptRoot '..\..\config\sensors.json'

# DLLs of the zip that the library does not need (GUI chart/tree controls and the task-scheduler helper of the GUI exe).
$script:SensorSkipDlls = @('Aga.Controls.dll', 'OxyPlot.dll', 'OxyPlot.WindowsForms.dll', 'Microsoft.Win32.TaskScheduler.dll')

$script:SensorUnits = @{
    Voltage = 'V'; Current = 'A'; Power = 'W'; Clock = 'MHz'; Temperature = 'C'; Load = 'pct'; Frequency = 'Hz'; Fan = 'RPM'
    Flow = 'Lh'; Control = 'pct'; Level = 'pct'; Factor = ''; Data = 'GB'; SmallData = 'MB'; Throughput = 'Bps'; TimeSpan = 's'
    Energy = 'mWh'; Noise = 'dBA'; Conductivity = 'uScm'; Humidity = 'pct'
}

function Get-SensorConfig {
    Get-Content -LiteralPath $script:SensorsConfigPath -Raw | ConvertFrom-Json
}

function Get-SensorLibDir($Config) { Join-Path $script:SensorsRoot $Config.version }

function Get-SensorLibPath($Config) { Join-Path (Get-SensorLibDir $Config) $Config.library }

function Test-SensorSupportInstalled($Config) { Test-Path -LiteralPath (Get-SensorLibPath $Config) -PathType Leaf }

# True when the zip has the library and no entry that could escape the target folder.
function Test-SensorZip([string]$ZipPath, [string]$Library) {
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($ZipPath)
        try {
            $names = @($z.Entries | ForEach-Object { $_.FullName })
            if ($names -notcontains $Library) { return $false }
            foreach ($n in $names) { if ($n -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($n) -or $n -match '^[A-Za-z]:') { return $false } }
            return $true
        } finally { $z.Dispose() }
    } catch { return $false }
}

function Get-FileSha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

# Downloads the pinned zip into $DestDir (a fresh folder) and checks its SHA-256. Returns the zip path; throws with a readable message.
function Save-SensorDownload($Config, [string]$DestDir) {
    if (-not ([string]$Config.url).StartsWith([string]$Config.urlPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'The sensor download address in config/sensors.json is not an official LibreHardwareMonitor release address.' }
    New-Item -ItemType Directory -Force $DestDir | Out-Null
    $tmp = Join-Path $DestDir ('LibreHardwareMonitor_' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        if ($script:SensorDownloader) { & $script:SensorDownloader $Config.url $tmp }
        else {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $Config.url -UserAgent 'KafkaBoost sensors' -UseBasicParsing -OutFile $tmp -TimeoutSec 180 | Out-Null
        }
        if (-not (Test-Path -LiteralPath $tmp)) { throw 'The download produced no file.' }
        $actual = Get-FileSha256 $tmp
        if ($actual -ne ([string]$Config.sha256).ToLowerInvariant()) { throw "SHA-256 mismatch: expected $($Config.sha256) but the file is $actual. It was deleted and nothing was installed." }
        if (-not (Test-SensorZip $tmp $Config.library)) { throw "The download is not a valid LibreHardwareMonitor zip (no $($Config.library))." }
        return $tmp
    } catch {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        throw
    }
}

# Unpacks only the library DLLs (by name, never by a path from the zip) into the version folder.
function Expand-SensorZip($Config, [string]$ZipPath, [string]$TargetDir) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    New-Item -ItemType Directory -Force $TargetDir | Out-Null
    $z = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $n = 0
        foreach ($e in $z.Entries) {
            if ($e.FullName -notmatch '^[^\\/]+\.dll$' -or $script:SensorSkipDlls -contains $e.Name) { continue }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $TargetDir $e.Name), $true); $n++
        }
        return $n
    } finally { $z.Dispose() }
}

# Administrators and SYSTEM may write, everyone else may only read and run: an elevated process loads these DLLs.
function Set-SensorsAcl([string]$Dir) {
    & icacls.exe $Dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# Download (the user agreed in the app), validate, unpack, delete the zip. Returns @{ dir; files; version }.
function Install-SensorSupport($Config, [switch]$SkipAcl) {
    $dl = Join-Path ([IO.Path]::GetTempPath()) ('KafkaBoost_sensors_' + [guid]::NewGuid().ToString('N'))
    try {
        $zip = Save-SensorDownload $Config $dl
        $dir = Get-SensorLibDir $Config
        if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
        $n = Expand-SensorZip $Config $zip $dir
        if (-not (Test-Path -LiteralPath (Get-SensorLibPath $Config))) { throw "$($Config.library) was not found after unpacking." }
        $acl = if ($SkipAcl) { $null } else { Set-SensorsAcl $dir }
        return [pscustomobject]@{ dir = $dir; files = $n; version = $Config.version; aclLocked = $acl }
    } finally { Remove-Item -LiteralPath $dl -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---- reading -----------------------------------------------------------------------------------------------------

function Get-SensorGroupId([string]$HardwareType) {
    switch -Regex ($HardwareType) {
        '^Cpu$' { return 'cpu' }
        '^Gpu' { return 'gpu' }
        '^(Motherboard|SuperIO|EmbeddedController)$' { return 'motherboard' }
        '^Storage$' { return 'storage' }
        '^Memory$' { return 'memory' }
        default { return 'other' }
    }
}

$script:SensorGroupOrder = @('cpu', 'gpu', 'motherboard', 'memory', 'storage', 'other')

# Raw hardware list -> groups. Sensors without a value are dropped (not measured), and so are the CPU power readings when -DropCpuPower is set; numbers are rounded to 1 decimal.
function ConvertTo-SensorGroups($Hardware, [switch]$DropCpuPower) {
    $by = @{}
    foreach ($h in @($Hardware)) {
        $gid = Get-SensorGroupId ([string]$h.hardwareType)
        $sensors = @()
        foreach ($s in @($h.sensors)) {
            if ($null -eq $s.value) { continue }
            $type = [string]$s.type
            if ($DropCpuPower -and $gid -eq 'cpu' -and $type -eq 'Power') { continue }   # without the driver the library reports 0 W, which is not a measurement
            $sensors += [pscustomobject]@{
                name = [string]$s.name; type = $type
                value = [math]::Round([double]$s.value, 1)
                min = $(if ($null -ne $s.min) { [math]::Round([double]$s.min, 1) } else { $null })
                max = $(if ($null -ne $s.max) { [math]::Round([double]$s.max, 1) } else { $null })
                unit = $(if ($script:SensorUnits.ContainsKey($type)) { $script:SensorUnits[$type] } else { '' })
            }
        }
        if (-not $sensors.Count) { continue }
        if (-not $by.ContainsKey($gid)) { $by[$gid] = New-Object System.Collections.ArrayList }
        [void]$by[$gid].Add([pscustomobject]@{ name = [string]$h.name; type = [string]$h.hardwareType; sensors = $sensors })
    }
    $groups = @()
    foreach ($gid in $script:SensorGroupOrder) { if ($by.ContainsKey($gid)) { $groups += [pscustomobject]@{ id = $gid; hardware = @($by[$gid]) } } }
    return $groups
}

# Opens LibreHardwareMonitor once and reads every sensor. Needs Windows PowerShell 5.1 (the net472 build) and, for the CPU, administrator rights.
function Read-SensorsLive($Config) {
    $dll = Get-SensorLibPath $Config
    [void][Reflection.Assembly]::LoadFrom($dll)          # LoadFrom also resolves the dependencies in the same folder
    $pawn = $null
    try { $pawn = [bool][LibreHardwareMonitor.PawnIo.PawnIo]::IsInstalled } catch { }
    $pc = New-Object LibreHardwareMonitor.Hardware.Computer
    $pc.IsCpuEnabled = $true; $pc.IsGpuEnabled = $true; $pc.IsMemoryEnabled = $true; $pc.IsMotherboardEnabled = $true; $pc.IsStorageEnabled = $true
    $out = New-Object System.Collections.ArrayList
    $walk = $null
    $walk = {
        param($hw)
        $hw.Update()
        $ss = @(foreach ($s in $hw.Sensors) { @{ name = $s.Name; type = [string]$s.SensorType; value = $s.Value; min = $s.Min; max = $s.Max } })
        [void]$out.Add(@{ hardwareType = [string]$hw.HardwareType; name = $hw.Name; sensors = $ss })
        foreach ($sub in $hw.SubHardware) { & $walk $sub }
    }
    $pc.Open()
    try {
        foreach ($hw in $pc.Hardware) { & $walk $hw }
        Start-Sleep -Milliseconds 300                      # a second pass so load/power counters have a delta
        $out.Clear()
        foreach ($hw in $pc.Hardware) { & $walk $hw }
    } finally { $pc.Close() }
    return @{ pawnio = $pawn; hardware = @($out) }
}

function Get-SensorState {
    $cfg = Get-SensorConfig
    return [pscustomobject]@{
        installed = (Test-SensorSupportInstalled $cfg); version = $cfg.version; name = $cfg.name; license = $cfg.license
        url = $cfg.url; sizeBytes = $cfg.sizeBytes; homepage = $cfg.homepage; sha256 = $cfg.sha256
    }
}

# The result of the sensors-read step: { ok; code; message; data }.
function Get-SensorSnapshot {
    $cfg = Get-SensorConfig
    $admin = [bool](Test-Admin)
    if (-not $script:SensorProvider -and -not (Test-SensorSupportInstalled $cfg)) {
        return [pscustomobject]@{ ok = $false; code = 'msg.sensors.missing'; message = 'Sensor support is not installed yet.'; data = [pscustomobject]@{ installed = $false; admin = $admin } }
    }
    try {
        $raw = if ($script:SensorProvider) { & $script:SensorProvider.Read } else { Read-SensorsLive $cfg }
    } catch {
        return [pscustomobject]@{ ok = $false; code = 'msg.sensors.loadFailed'; message = $_.Exception.Message; data = [pscustomobject]@{ installed = $true; admin = $admin } }
    }
    $groups = @(ConvertTo-SensorGroups $raw.hardware -DropCpuPower:($raw.pawnio -eq $false))
    $count = 0; $cpuTemp = $false
    foreach ($g in $groups) { foreach ($h in $g.hardware) { $count += @($h.sensors).Count; if ($g.id -eq 'cpu' -and @($h.sensors | Where-Object { $_.type -eq 'Temperature' }).Count) { $cpuTemp = $true } } }
    $data = [pscustomobject]@{
        installed = $true; admin = $admin; pawnio = $raw.pawnio; cpuTemperature = $cpuTemp; count = $count
        source = "$($cfg.name) $($cfg.version)"; takenAt = (Get-Date).ToString('s'); groups = $groups
    }
    if (-not $count) { return [pscustomobject]@{ ok = $false; code = 'msg.sensors.empty'; message = 'No sensor returned a value.'; data = $data } }
    if (-not $admin) { return [pscustomobject]@{ ok = $true; code = 'msg.sensors.needsAdmin'; message = 'Run as administrator to read the CPU sensors; showing what is readable.'; data = $data } }
    if (-not $cpuTemp) { return [pscustomobject]@{ ok = $true; code = 'msg.sensors.noCpuTemp'; message = 'No CPU temperature was reported (the PawnIO driver is probably not installed).'; data = $data } }
    return [pscustomobject]@{ ok = $true; code = 'msg.sensors.ok'; message = "$count sensors."; data = $data }
}
