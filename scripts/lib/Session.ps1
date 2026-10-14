# Play-session recorder: samples the live telemetry while the user plays and summarizes it. Read-only: it never writes a tuning value.
# Sensors that cannot be read stay null ("missing", never 0). Throttle flags are not exposed by the telemetry, so the summary says so
# instead of claiming "no throttling". Readers and the clock are injectable for the tests.

function New-SessionSummary($Samples, [double]$Pl1W = 65, [double]$Pl2W = 85) {
    $s = @($Samples)
    $stat = {
        param($name)
        $v = @($s | Where-Object { $null -ne $_.$name } | ForEach-Object { [double]$_.$name })
        if (-not $v.Count) { return $null }
        $m = $v | Measure-Object -Maximum -Average
        [pscustomobject]@{ peak = [math]::Round($m.Maximum, 1); avg = [math]::Round($m.Average, 1); samples = $v.Count }
    }
    # lowest / highest of a memory counter (bytes); null when it was never readable. Samples recorded before this existed have no such property.
    $range = {
        param($name)
        $v = @($s | Where-Object { $null -ne $_.PSObject.Properties[$name] -and $null -ne $_.$name } | ForEach-Object { [double]$_.$name })
        if (-not $v.Count) { return $null }
        $m = $v | Measure-Object -Minimum -Maximum
        [pscustomobject]@{ min = [double]$m.Minimum; max = [double]$m.Maximum; samples = $v.Count }
    }
    $mem = [pscustomobject]@{ standbyBytes = & $range 'standbyBytes'; freeBytes = & $range 'freeBytes' }
    $pw = @($s | Where-Object { $null -ne $_.packagePowerW })
    $first = $null; $last = $null
    if ($s.Count) { $first = [datetime]$s[0].t; $last = [datetime]$s[$s.Count - 1].t }
    [pscustomobject]@{
        samples     = $s.Count
        durationSec = if ($s.Count -gt 1) { [int]($last - $first).TotalSeconds } else { 0 }
        tempC       = & $stat 'packageTempC'
        powerW      = & $stat 'packagePowerW'
        pClockMHz   = & $stat 'pClockMaxMHz'
        eClockMHz   = & $stat 'eClockMaxMHz'
        memory      = $(if ($mem.standbyBytes -or $mem.freeBytes) { $mem } else { $null })
        # share of readings at or above the limits (1 W tolerance); null when power was never readable
        pl1Pct      = if ($pw.Count) { [math]::Round(100 * @($pw | Where-Object { $_.packagePowerW -ge $Pl1W - 1 }).Count / $pw.Count) } else { $null }
        pl2Pct      = if ($pw.Count) { [math]::Round(100 * @($pw | Where-Object { $_.packagePowerW -ge $Pl2W - 1 }).Count / $pw.Count) } else { $null }
        pl1W        = $Pl1W
        pl2W        = $Pl2W
        throttleFlags = 'unknown'
    }
}

# WHEA-Logger events since $Since. 19 = "Internal parity error" (AGENTS.md rule 1). Reader is injectable: returns objects with Id.
function Get-WheaSince([datetime]$Since, [scriptblock]$Reader = {
        param($since)
        Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $since } -ErrorAction SilentlyContinue
    }) {
    $ev = @()
    try { $ev = @(& $Reader $Since | Where-Object { $_ }) } catch { $ev = @() }
    $ids = @($ev | ForEach-Object { [int]$_.Id } | Sort-Object -Unique)
    [pscustomobject]@{ count = $ev.Count; ids = $ids; has19 = ($ids -contains 19) }
}

# Records until the stop file appears (or MaxSec). OnSample gets each sample object; returns the samples.
function Invoke-SessionRecording([int]$IntervalSec, [string]$StopFile, [int]$MaxSec,
        [scriptblock]$Reader = { Get-LiveTelemetry }, [scriptblock]$OnSample = {}, [scriptblock]$Sleep = { param($s) Start-Sleep -Seconds $s },
        [scriptblock]$Now = { Get-Date },
        [scriptblock]$MemReader = { if (Get-Command Get-RammapMemory -ErrorAction SilentlyContinue) { Get-RammapMemory } else { $null } }) {
    $samples = [System.Collections.Generic.List[object]]::new()
    $start = & $Now
    while ($true) {
        $t = & $Now
        if (($t - $start).TotalSeconds -ge $MaxSec) { break }
        if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { break }
        $live = $null
        try { $live = & $Reader } catch { $live = $null }
        if ($live) {
            # standby and free memory next to the sensors (read-only; a counter Windows does not report stays null, never 0)
            $mem = $null; try { $mem = & $MemReader } catch { $mem = $null }
            $smp = [pscustomobject]@{ t = $t.ToString('s'); packageTempC = $live.packageTempC; packagePowerW = $live.packagePowerW; pClockMaxMHz = $live.pClockMaxMHz; eClockMaxMHz = $live.eClockMaxMHz
                standbyBytes = $(if ($mem) { $mem.standbyBytes } else { $null }); freeBytes = $(if ($mem) { $mem.freeBytes } else { $null }) }
            $samples.Add($smp)
            & $OnSample $smp | Out-Host   # whatever the callback writes goes to the console, never into the returned samples
        }
        & $Sleep $IntervalSec
    }
    , $samples.ToArray()
}
