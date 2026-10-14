# Pester tests for the boost-clock advice: pure function over fake session history, nothing real is read.

Describe 'Advice (boost cap headroom)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Advice.ps1')
        function New-Sess($temp = 80, $clock = 4700, $avgW = 55, $pl1 = 10, $dur = 1800, $wheaCount = 0, $has19 = $false) {
            [pscustomobject]@{ summary = [pscustomobject]@{ durationSec = $dur; tempC = [pscustomobject]@{ peak = $temp; avg = $temp - 5 }; pClockMHz = [pscustomobject]@{ peak = $clock; avg = $clock }
                    powerW = [pscustomobject]@{ peak = $avgW + 10; avg = $avgW }; pl1Pct = $pl1 }
                whea = [pscustomobject]@{ count = $wheaCount; has19 = $has19 } }
        }
    }

    It 'three loaded sessions with margin: raise by exactly one ratio step' {
        $a = Get-BoostAdvice @((New-Sess), (New-Sess 82), (New-Sess 78)) 4700
        Assert-Equal $a.verdict 'raise' 'verdict'; Assert-Equal $a.suggestedRatio 48 'one step only'; Assert-Equal $a.capRatio 47 'cap'
    }
    It 'too few loaded sessions (short or idle ones do not count): not enough data' {
        $a = Get-BoostAdvice @((New-Sess), (New-Sess), (New-Sess 80 4700 20), (New-Sess 80 4700 55 10 120)) 4700
        Assert-Equal $a.verdict 'notEnough' 'verdict'; Assert-Equal $a.loadedSessions 2 'loaded'
    }
    It 'no history at all is not enough data, never a default recommendation' {
        Assert-Equal (Get-BoostAdvice @() 4700).verdict 'notEnough' 'empty'
        Assert-Equal (Get-BoostAdvice $null 4700).verdict 'notEnough' 'null'
    }
    It 'WHEA 19 in any session blocks raising and points to the lower-undervolt check' {
        $a = Get-BoostAdvice @((New-Sess), (New-Sess), (New-Sess), (New-Sess 80 4700 5 1 10 1 $true)) 4700
        Assert-Equal $a.verdict 'lowerCheck' 'verdict'; Assert-Equal $a.reason 'whea19' 'reason'
        if ($null -ne $a.suggestedRatio) { throw 'never a ratio with WHEA 19' }
    }
    It 'any other WHEA event holds the cap' {
        Assert-Equal (Get-BoostAdvice @((New-Sess), (New-Sess), (New-Sess 80 4700 55 10 1800 2)) 4700).reason 'whea' 'reason'
    }
    It 'a hot session (90 C or more) holds; 86-89 C is marginal and also holds' {
        Assert-Equal (Get-BoostAdvice @((New-Sess), (New-Sess), (New-Sess 90)) 4700).reason 'hot' 'hot'
        Assert-Equal (Get-BoostAdvice @((New-Sess), (New-Sess), (New-Sess 87)) 4700).reason 'marginal' 'marginal'
    }
    It 'games that never reach the cap hold: raising it would change nothing' {
        Assert-Equal (Get-BoostAdvice @((New-Sess 80 4300), (New-Sess 80 4300), (New-Sess 80 4300)) 4700).reason 'notCapBound' 'reason'
    }
    It 'power-limited sessions hold: a higher cap needs watts' {
        Assert-Equal (Get-BoostAdvice @((New-Sess 80 4700 55 80), (New-Sess), (New-Sess)) 4700).reason 'powerBound' 'share'
        Assert-Equal (Get-BoostAdvice @((New-Sess 80 4700 63), (New-Sess 80 4700 63), (New-Sess 80 4700 63)) 4700).reason 'powerBound' 'avg'
    }
    It 'a missing sensor is never read as fine' {
        $s = New-Sess; $s.summary.tempC = $null
        Assert-Equal (Get-BoostAdvice @($s, $s, $s) 4700).verdict 'notEnough' 'verdict'
    }
}
