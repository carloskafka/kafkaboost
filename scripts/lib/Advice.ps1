# Boost-clock advice: reads the recorded play sessions and says whether the P-core cap has measured headroom. ADVICE ONLY: it never changes a
# value (AGENTS.md rules 4 and 9). It never says "stable"; it says what the sessions showed. Missing sensors are missing, never 0 (rule 11).
#
# Verdicts: notEnough | hold | raise | lowerCheck
#   raise      = +1 ratio step (100 MHz) might fit: test it with two matched runs (docs/TROUBLESHOOTING.md) before keeping it
#   hold       = keep the cap (a reason says why)
#   lowerCheck = WHEA 19 was logged: do not raise; rule 1 says go to -80/-80/-70 mV if it returns
#   notEnough  = fewer than $MinSessions loaded sessions recorded
# A "loaded" session lasted at least 5 minutes with an average package power of at least 40 W (idle recordings say nothing about the cap).

function Get-BoostAdvice($History, [int]$CapMHz, [double]$Pl1W = 65, [int]$MinSessions = 3, [int]$MaxSafeTempC = 85, [int]$HardTempC = 90) {
    $all = @($History | Where-Object { $_ -and $_.summary })
    $loaded = @($all | Where-Object { $_.summary.durationSec -ge 300 -and $_.summary.powerW -and $_.summary.powerW.avg -ge 40 })
    $ratio = [int][math]::Round($CapMHz / 100)
    $r = { param($v, $reason, $ev) [pscustomobject]@{ verdict = $v; reason = $reason; capRatio = $ratio; suggestedRatio = $(if ($v -eq 'raise') { $ratio + 1 } else { $null }); loadedSessions = $loaded.Count; needed = $MinSessions; evidence = $ev } }
    $whea19 = @($all | Where-Object { $_.whea -and $_.whea.has19 }).Count
    $wheaAny = @($all | Where-Object { $_.whea -and $_.whea.count -gt 0 }).Count
    if ($whea19) { return & $r 'lowerCheck' 'whea19' $null }                 # any session, loaded or not
    if ($wheaAny) { return & $r 'hold' 'whea' $null }
    if ($CapMHz -le 0) { return & $r 'notEnough' 'noCap' $null }
    if ($loaded.Count -lt $MinSessions) { return & $r 'notEnough' 'fewSessions' $null }
    $temps = @($loaded | Where-Object { $_.summary.tempC } | ForEach-Object { [double]$_.summary.tempC.peak })
    $clocks = @($loaded | Where-Object { $_.summary.pClockMHz } | ForEach-Object { [double]$_.summary.pClockMHz.peak })
    if (-not $temps.Count -or -not $clocks.Count) { return & $r 'notEnough' 'noSensors' $null }   # a missing sensor is not "fine"
    $maxTemp = ($temps | Measure-Object -Maximum).Maximum
    $maxClock = ($clocks | Measure-Object -Maximum).Maximum
    $pl1 = @($loaded | Where-Object { $null -ne $_.summary.pl1Pct } | ForEach-Object { [double]$_.summary.pl1Pct })
    $maxPl1Pct = if ($pl1.Count) { ($pl1 | Measure-Object -Maximum).Maximum } else { $null }
    $avgPower = [math]::Round((@($loaded | ForEach-Object { [double]$_.summary.powerW.avg }) | Measure-Object -Average).Average, 1)
    $ev = [pscustomobject]@{ maxTempC = $maxTemp; maxPClockMHz = $maxClock; avgPowerW = $avgPower; maxPl1Pct = $maxPl1Pct; capMHz = $CapMHz }
    if ($maxTemp -ge $HardTempC) { return & $r 'hold' 'hot' $ev }
    if ($maxClock -lt $CapMHz - 100) { return & $r 'hold' 'notCapBound' $ev }       # the games never reached the cap: raising it changes nothing
    if ($null -eq $maxPl1Pct) { return & $r 'notEnough' 'noSensors' $ev }
    if ($maxPl1Pct -gt 50 -or $avgPower -ge $Pl1W - 3) { return & $r 'hold' 'powerBound' $ev }   # power-limited: a higher cap needs watts, not just clocks
    if ($maxTemp -gt $MaxSafeTempC) { return & $r 'hold' 'marginal' $ev }
    & $r 'raise' 'headroom' $ev
}
