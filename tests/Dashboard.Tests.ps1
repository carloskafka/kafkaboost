# Pester tests for the Dashboard additions: the telemetry snapshot (fake reader instead of HWiNFO shared memory) and the hardware
# summaries (fake CIM rows instead of the real disks and RAM). Nothing real is read, and no serial number is ever part of the result.

Describe 'Dashboard (telemetry snapshot, disks, memory)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }

    It 'telemetry: a reader with values gives available=true and the values untouched' {
        $s = Get-TelemetrySnapshot { [pscustomobject]@{ pClockMaxMHz = 4689; eClockMaxMHz = 3591; packageTempC = 68; packagePowerW = 31.5 } }
        Assert-Equal $s.available $true 'available'
        Assert-Equal $s.live.packageTempC 68 'temp'
        Assert-Equal $s.live.packagePowerW 31.5 'power'
        if ($s.takenAt -notmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$') { throw "takenAt is not a local ISO time: $($s.takenAt)" }
    }
    It 'telemetry: no shared memory (reader returns null) is "unavailable", never zeros' {
        $s = Get-TelemetrySnapshot { $null }
        Assert-Equal $s.available $false 'available'
        if ($null -ne $s.live) { throw 'live must be null when there is nothing to show' }
    }
    It 'telemetry: a reader that throws is "unavailable", not an error' {
        $s = Get-TelemetrySnapshot { throw 'boom' }
        Assert-Equal $s.available $false 'available'
    }
    It 'telemetry: a reader that finds the memory but no known sensor is "unavailable"' {
        $s = Get-TelemetrySnapshot { [pscustomobject]@{ pClockMaxMHz = $null; eClockMaxMHz = $null; packageTempC = $null; packagePowerW = $null } }
        Assert-Equal $s.available $false 'available'
    }
    It 'telemetry: keeps a partial reading (temperature only) and leaves the rest null' {
        $s = Get-TelemetrySnapshot { [pscustomobject]@{ pClockMaxMHz = $null; eClockMaxMHz = $null; packageTempC = 55; packagePowerW = $null } }
        Assert-Equal $s.available $true 'available'
        if ($null -ne $s.live.pClockMaxMHz) { throw 'a missing sensor must stay null' }
    }

    It 'disks: model, size in GB and type from the storage class; no serial number property at all' {
        $drives = { @([pscustomobject]@{ Model = 'Fake NVMe 1TB '; Size = 1024203640320; MediaType = 'Fixed hard disk media'; SerialNumber = 'SECRET123' },
                      [pscustomobject]@{ Model = 'Fake HDD'; Size = 2000398934016; MediaType = 'Fixed hard disk media'; SerialNumber = 'SECRET456' }) }
        $phys = { @([pscustomobject]@{ FriendlyName = 'Fake NVMe 1TB'; MediaType = 4; BusType = 17 }, [pscustomobject]@{ FriendlyName = 'Fake HDD'; MediaType = 3; BusType = 11 }) }
        $d = @(Get-DiskSummary $drives $phys)
        Assert-Equal $d.Count 2 'count'
        Assert-Equal $d[0].model 'Fake NVMe 1TB' 'model is trimmed'
        Assert-Equal $d[0].sizeGB 1024 'size'
        Assert-Equal $d[0].type 'nvme' 'type 0'
        Assert-Equal $d[1].type 'hdd' 'type 1'
        $json = $d | ConvertTo-Json -Compress
        if ($json -match 'SECRET|serial') { throw "a serial number leaked: $json" }
    }
    It 'disks: a disk the storage class does not know is type "unknown"; removable media and rows without a model are skipped' {
        $drives = { @([pscustomobject]@{ Model = 'Mystery'; Size = 500107862016; MediaType = 'Fixed hard disk media' },
                      [pscustomobject]@{ Model = 'USB stick'; Size = 16e9; MediaType = 'Removable Media' },
                      [pscustomobject]@{ Model = $null; Size = 1e9; MediaType = 'Fixed hard disk media' }) }
        $d = @(Get-DiskSummary $drives { @() })
        Assert-Equal $d.Count 1 'count'
        Assert-Equal $d[0].type 'unknown' 'type'
        Assert-Equal $d[0].sizeGB 500 'size'
    }
    It 'disks: when the storage class fails the disks are still listed (type unknown); when the drive query fails the list is empty' {
        $drives = { @([pscustomobject]@{ Model = 'Fake'; Size = 256060514304; MediaType = 'Fixed hard disk media' }) }
        $d = @(Get-DiskSummary $drives { throw 'no storage namespace' })
        Assert-Equal $d.Count 1 'count'
        Assert-Equal $d[0].type 'unknown' 'type'
        Assert-Equal @(Get-DiskSummary { throw 'no cim' } { @() }).Count 0 'empty'
    }

    It 'memory: configured speed (highest module) and module count' {
        $m = Get-MemorySummary { @([pscustomobject]@{ ConfiguredClockSpeed = 5600; Speed = 5600 }, [pscustomobject]@{ ConfiguredClockSpeed = 4800; Speed = 5600 }) }
        Assert-Equal $m.speedMHz 5600 'speed'
        Assert-Equal $m.modules 2 'modules'
    }
    It 'memory: falls back to the rated speed, and to null when nothing is reported' {
        Assert-Equal (Get-MemorySummary { @([pscustomobject]@{ ConfiguredClockSpeed = 0; Speed = 3200 }) }).speedMHz 3200 'rated'
        $m = Get-MemorySummary { throw 'no cim' }
        if ($null -ne $m.speedMHz) { throw 'speed must be null when unknown' }
        Assert-Equal $m.modules 0 'modules'
    }

    It 'Steps.ps1 knows the telemetry step and treats it as read-only (no administrator check)' {
        $src = Get-Content -Raw (Join-Path $PSScriptRoot '..\scripts\Steps.ps1')
        if ($src -notmatch "'telemetry'\)\]\[string\]\`$Step") { throw 'telemetry is not in the ValidateSet' }
        if ($src -notmatch "\`$readOnly = \(\`$Step -in [^\r\n]*'telemetry'") { throw 'telemetry is not in the read-only list' }
    }
}
