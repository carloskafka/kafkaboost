# Pester tests for scripts\lib\Sensors.ps1. A fake provider and a fake downloader stand in for LibreHardwareMonitor and the network:
# nothing is downloaded and no driver or hardware is touched.

Describe 'Sensors (fake provider)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Sensors.ps1')
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        function New-FakeZip([string]$Path, [string[]]$Names) {
            $src = New-Sandbox
            foreach ($n in $Names) { $leaf = Split-Path $n -Leaf; Set-Content (Join-Path $src $leaf) "fake $n" -Encoding ASCII }
            $z = [IO.Compression.ZipFile]::Open($Path, 'Create')
            try { foreach ($n in $Names) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, (Join-Path $src (Split-Path $n -Leaf)), $n) } } finally { $z.Dispose() }
            Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
        }
        $script:Raw = @{
            pawnio = $true
            hardware = @(
                @{ hardwareType = 'Cpu'; name = 'Test CPU'; sensors = @(
                    @{ name = 'CPU Package'; type = 'Temperature'; value = 61.26; min = 40; max = 80.04 },
                    @{ name = 'CPU Package'; type = 'Power'; value = 31.5; min = 5; max = 90 },
                    @{ name = 'Gone'; type = 'Clock'; value = $null; min = $null; max = $null }) },
                @{ hardwareType = 'GpuNvidia'; name = 'Test GPU'; sensors = @(@{ name = 'GPU Core'; type = 'Temperature'; value = 50; min = 40; max = 70 }) },
                @{ hardwareType = 'SuperIO'; name = 'Test board'; sensors = @(@{ name = 'Fan #1'; type = 'Fan'; value = 2100; min = 0; max = 4000 }) },
                @{ hardwareType = 'Storage'; name = 'Test SSD'; sensors = @(@{ name = 'Temperature'; type = 'Temperature'; value = 38; min = 30; max = 50 }) },
                @{ hardwareType = 'Memory'; name = 'Total Memory'; sensors = @(@{ name = 'Memory'; type = 'Load'; value = 55.55; min = $null; max = $null }) },
                @{ hardwareType = 'Network'; name = 'No sensors'; sensors = @() }
            )
        }
    }
    AfterEach { $script:SensorProvider = $null; $script:SensorDownloader = $null }

    It 'pins the release in config/sensors.json (version, official url, 64-hex sha256, MPL-2.0)' {
        $c = Get-SensorConfig
        if ($c.sha256 -notmatch '^[0-9a-f]{64}$') { throw "bad sha256: $($c.sha256)" }
        if (-not $c.url.StartsWith($c.urlPrefix)) { throw 'url is outside the official release prefix' }
        if ($c.url -notlike "*v$($c.version)*") { throw 'url does not name the pinned version' }
        Assert-Equal $c.license 'MPL-2.0' 'license'
    }
    It 'groups hardware, orders groups, rounds, drops sensors without a value and hardware without sensors' {
        $g = @(ConvertTo-SensorGroups $script:Raw.hardware)
        Assert-Equal (($g | ForEach-Object { $_.id }) -join ',') 'cpu,gpu,motherboard,memory,storage' 'group order'
        $cpu = $g[0].hardware[0]
        Assert-Equal @($cpu.sensors).Count 2 'cpu sensors (the null clock is dropped)'
        Assert-Equal $cpu.sensors[0].value 61.3 'rounded'
        Assert-Equal $cpu.sensors[0].unit 'C' 'unit'
        Assert-Equal $g[2].hardware[0].sensors[0].unit 'RPM' 'fan unit'
        Assert-Equal $g[3].hardware[0].sensors[0].min $null 'unknown min stays null'
    }
    It 'drops CPU power when told the driver is missing (the library would report 0 W)' {
        $g = @(ConvertTo-SensorGroups $script:Raw.hardware -DropCpuPower)
        Assert-Equal @($g[0].hardware[0].sensors).Count 1 'only the temperature is left'
        Assert-Equal $g[0].hardware[0].sensors[0].type 'Temperature' 'kept type'
    }
    It 'maps hardware types to groups' {
        Assert-Equal (Get-SensorGroupId 'GpuAmd') 'gpu' 'amd'
        Assert-Equal (Get-SensorGroupId 'EmbeddedController') 'motherboard' 'ec'
        Assert-Equal (Get-SensorGroupId 'Battery') 'other' 'other'
    }
    It 'reads through the provider: ok when admin and the CPU temperature is there' {
        function Test-Admin { $true }   # shadows the real check for this test
        $script:SensorProvider = @{ Read = { $script:Raw } }
        $r = Get-SensorSnapshot
        Assert-Equal $r.code 'msg.sensors.ok' 'code'
        if (-not $r.data.cpuTemperature) { throw 'cpu temperature flag' }
    }
    It 'reports needsAdmin (still ok, with data) when the session is not elevated' {
        function Test-Admin { $false }
        $script:SensorProvider = @{ Read = { $script:Raw } }
        $r = Get-SensorSnapshot
        Assert-Equal $r.code 'msg.sensors.needsAdmin' 'code'
        if (-not $r.ok) { throw 'should stay ok so the page shows what is readable' }
        Assert-Equal $r.data.count 6 'sensor count'
        Assert-Equal $r.data.admin $false 'admin flag'
    }
    It 'says the CPU temperature is missing instead of inventing it' {
        function Test-Admin { $true }
        $script:SensorProvider = @{ Read = { @{ pawnio = $false; hardware = @($script:Raw.hardware[1]) } } }
        $r = Get-SensorSnapshot
        Assert-Equal $r.code 'msg.sensors.noCpuTemp' 'code'
        Assert-Equal $r.data.cpuTemperature $false 'flag'
    }
    It 'reports empty and load failures with codes' {
        $script:SensorProvider = @{ Read = { @{ pawnio = $true; hardware = @() } } }
        Assert-Equal (Get-SensorSnapshot).code 'msg.sensors.empty' 'empty'
        $script:SensorProvider = @{ Read = { throw 'cannot load' } }
        $r = Get-SensorSnapshot
        Assert-Equal $r.code 'msg.sensors.loadFailed' 'load'
        if ($r.ok) { throw 'must not be ok' }
    }
    It 'reports missing support when the library is not installed' {
        $dir = New-Sandbox
        try {
            $script:SensorsRoot = $dir
            $r = Get-SensorSnapshot
            Assert-Equal $r.code 'msg.sensors.missing' 'code'
            Assert-Equal $r.data.installed $false 'installed'
        } finally { $script:SensorsRoot = Join-Path $env:ProgramData 'LegionTuning\sensors'; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Describe 'Sensors download (fake downloader, sandbox)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Sensors.ps1')
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        function New-FakeZip([string]$Path, [string[]]$Names) {
            $src = New-Sandbox
            foreach ($n in $Names) { Set-Content (Join-Path $src (Split-Path $n -Leaf)) "fake $n" -Encoding ASCII }
            $z = [IO.Compression.ZipFile]::Open($Path, 'Create')
            try { foreach ($n in $Names) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, (Join-Path $src (Split-Path $n -Leaf)), $n) } } finally { $z.Dispose() }
            Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
        }
        $script:Names = @('LibreHardwareMonitorLib.dll', 'HidSharp.dll', 'LibreHardwareMonitor.exe', 'OxyPlot.dll', 'de/Microsoft.Win32.TaskScheduler.resources.dll')
        $script:Good = Join-Path ([IO.Path]::GetTempPath()) ('kb_fakezip_' + [guid]::NewGuid().ToString('N') + '.zip')
        New-FakeZip $script:Good $script:Names
        $script:GoodHash = (Get-FileHash -LiteralPath $script:Good -Algorithm SHA256).Hash.ToLowerInvariant()
        function New-Cfg([string]$Hash) {
            [pscustomobject]@{ name = 'LibreHardwareMonitor'; version = '9.9.9'; library = 'LibreHardwareMonitorLib.dll'
                url = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v9.9.9/x.zip'
                urlPrefix = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/'; sha256 = $Hash }
        }
    }
    AfterAll { Remove-Item -LiteralPath $script:Good -Force -ErrorAction SilentlyContinue }
    AfterEach { $script:SensorDownloader = $null }

    It 'accepts a zip whose SHA-256 matches, unpacks only the library DLLs, and deletes the zip' {
        $root = New-Sandbox
        try {
            $script:SensorsRoot = $root
            $script:SensorDownloader = { param($u, $o) Copy-Item -LiteralPath $script:Good -Destination $o }
            $r = Install-SensorSupport (New-Cfg $script:GoodHash) -SkipAcl
            Assert-Equal $r.files 2 'only LibreHardwareMonitorLib.dll and HidSharp.dll are unpacked'
            if (-not (Test-Path (Join-Path $root '9.9.9\LibreHardwareMonitorLib.dll'))) { throw 'library missing' }
            foreach ($no in 'LibreHardwareMonitor.exe', 'OxyPlot.dll') { if (Test-Path (Join-Path $root "9.9.9\$no")) { throw "$no must not be unpacked" } }
            if (-not (Test-SensorSupportInstalled (New-Cfg $script:GoodHash))) { throw 'should now be installed' }
            $left = @(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter 'KafkaBoost_sensors_*' -ErrorAction SilentlyContinue)
            Assert-Equal $left.Count 0 'download folders left in TEMP'
        } finally { $script:SensorsRoot = Join-Path $env:ProgramData 'LegionTuning\sensors'; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'refuses a zip with a wrong SHA-256, deletes it and installs nothing' {
        $root = New-Sandbox
        try {
            $script:SensorsRoot = $root
            $script:SensorDownloader = { param($u, $o) Copy-Item -LiteralPath $script:Good -Destination $o; $script:Last = $o }
            $msg = ''
            try { Install-SensorSupport (New-Cfg ('0' * 64)) -SkipAcl | Out-Null } catch { $msg = $_.Exception.Message }
            if ($msg -notlike 'SHA-256 mismatch*') { throw "expected a mismatch error, got '$msg'" }
            if (Test-Path -LiteralPath $script:Last) { throw 'the bad zip must be deleted' }
            if (Test-Path (Join-Path $root '9.9.9')) { throw 'nothing may be unpacked' }
        } finally { $script:SensorsRoot = Join-Path $env:ProgramData 'LegionTuning\sensors'; Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'refuses a download address outside the official release prefix' {
        $cfg = New-Cfg $script:GoodHash; $cfg.url = 'https://example.com/LibreHardwareMonitor.zip'
        $msg = ''
        try { Save-SensorDownload $cfg (Join-Path ([IO.Path]::GetTempPath()) 'kb_never') | Out-Null } catch { $msg = $_.Exception.Message }
        if ($msg -notlike '*not an official*') { throw "got '$msg'" }
    }
    It 'refuses a zip with a path that escapes the folder or without the library' {
        $bad = Join-Path ([IO.Path]::GetTempPath()) ('kb_badzip_' + [guid]::NewGuid().ToString('N') + '.zip')
        try {
            New-FakeZip $bad @('HidSharp.dll')
            if (Test-SensorZip $bad 'LibreHardwareMonitorLib.dll') { throw 'a zip without the library must be refused' }
            $z = [IO.Compression.ZipFile]::Open($bad, 'Update')
            try { $e = $z.CreateEntry('LibreHardwareMonitorLib.dll'); $e2 = $z.CreateEntry('../evil.dll') } finally { $z.Dispose() }
            if (Test-SensorZip $bad 'LibreHardwareMonitorLib.dll') { throw 'a zip with ../ must be refused' }
        } finally { Remove-Item -LiteralPath $bad -Force -ErrorAction SilentlyContinue }
    }
}
