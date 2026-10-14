# Pester tests for the play-session recorder: summary maths, WHEA lookup and the recording loop (fake readers, fake clock, nothing real is read).

Describe 'Session (summary, WHEA, recording loop)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Session.ps1') }

    It 'summary: peak, average, duration and the share of readings at the power limits' {
        $s = @(
            [pscustomobject]@{ t = '2026-10-13T20:00:00'; packageTempC = 70; packagePowerW = 60; pClockMaxMHz = 4600; eClockMaxMHz = 3500 },
            [pscustomobject]@{ t = '2026-10-13T20:00:05'; packageTempC = 80; packagePowerW = 65; pClockMaxMHz = 4700; eClockMaxMHz = 3600 },
            [pscustomobject]@{ t = '2026-10-13T20:00:10'; packageTempC = 90; packagePowerW = 85; pClockMaxMHz = 4700; eClockMaxMHz = 3600 })
        $r = New-SessionSummary $s 65 85
        Assert-Equal $r.samples 3 'samples'
        Assert-Equal $r.durationSec 10 'duration'
        Assert-Equal $r.tempC.peak 90 'peak temp'
        Assert-Equal $r.tempC.avg 80 'avg temp'
        Assert-Equal $r.pl1Pct 67 'PL1 share'
        Assert-Equal $r.pl2Pct 33 'PL2 share'
        Assert-Equal $r.throttleFlags 'unknown' 'flags are never claimed'
    }
    It 'summary: a sensor that was never readable stays null, never 0' {
        $s = @([pscustomobject]@{ t = '2026-10-13T20:00:00'; packageTempC = 70; packagePowerW = $null; pClockMaxMHz = $null; eClockMaxMHz = $null })
        $r = New-SessionSummary $s
        if ($null -ne $r.powerW) { throw 'powerW must be null' }
        if ($null -ne $r.pl1Pct) { throw 'pl1Pct must be null without power readings' }
        Assert-Equal $r.tempC.peak 70 'temp'
    }
    It 'summary: no samples at all gives zeros for counts and null for sensors' {
        $r = New-SessionSummary @()
        Assert-Equal $r.samples 0 'samples'
        if ($null -ne $r.tempC) { throw 'tempC must be null' }
    }
    It 'whea: reports count, ids and whether WHEA 19 is present' {
        $w = Get-WheaSince ([datetime]'2026-10-13') { param($s) @([pscustomobject]@{ Id = 19 }, [pscustomobject]@{ Id = 17 }, [pscustomobject]@{ Id = 19 }) }
        Assert-Equal $w.count 3 'count'
        Assert-Equal $w.has19 $true 'has19'
    }
    It 'whea: nothing logged (or a reader that throws) is zero events' {
        Assert-Equal (Get-WheaSince ([datetime]'2026-10-13') { param($s) $null }).count 0 'none'
        Assert-Equal (Get-WheaSince ([datetime]'2026-10-13') { param($s) throw 'boom' }).has19 $false 'throws'
    }
    It 'recording: stops when the stop file appears and skips unreadable moments' {
        $stop = Join-Path ([IO.Path]::GetTempPath()) ("kb_stop_" + [guid]::NewGuid().ToString('N'))
        $script:n = 0; $script:clock = [datetime]'2026-10-13T20:00:00'
        $reader = { $script:n++; if ($script:n -eq 2) { $null } else { [pscustomobject]@{ packageTempC = 70 + $script:n; packagePowerW = 60; pClockMaxMHz = 4600; eClockMaxMHz = 3500 } } }
        $sleep = { param($s) $script:clock = $script:clock.AddSeconds($s); if ($script:n -ge 4) { Set-Content -LiteralPath $stop 'x' } }
        $got = Invoke-SessionRecording 5 $stop 3600 $reader {} $sleep { $script:clock }
        Remove-Item -LiteralPath $stop -ErrorAction SilentlyContinue
        Assert-Equal @($got).Count 3 'three readable samples out of four moments'
    }
    It 'recording: ends at MaxSec even without a stop file' {
        $script:clock = [datetime]'2026-10-13T20:00:00'
        $got = Invoke-SessionRecording 10 '' 30 { [pscustomobject]@{ packageTempC = 70; packagePowerW = 60; pClockMaxMHz = 1; eClockMaxMHz = 1 } } {} { param($s) $script:clock = $script:clock.AddSeconds($s) } { $script:clock }
        Assert-Equal @($got).Count 3 'samples until the cap'
    }
}
