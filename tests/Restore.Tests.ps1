# Pester tests for scripts\lib\Restore.ps1. A fake provider stands in for Windows: no real restore point is made.

Describe 'Restore points (fake provider)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Restore.ps1') }
    AfterEach { $script:RestoreProvider = $null; $script:TweakStatePath = Join-Path $env:ProgramData 'LegionTuning\state.json' }

    It 'converts the WMI date and names the type' {
        $r = ConvertFrom-RestorePointRaw ([pscustomobject]@{ SequenceNumber = 7; Description = 'x'; CreationTime = '20261010223000.000000+000'; RestorePointType = 12 })
        Assert-Equal $r.id 7 'id'
        Assert-Equal $r.type 'settings' 'type'
        if (-not $r.created -or $r.created -notlike '2026-10-1*') { throw "bad date: $($r.created)" }
    }
    It 'lists newest first' {
        $script:RestoreProvider = @{ List = { @(
            [pscustomobject]@{ SequenceNumber = 1; Description = 'a'; CreationTime = '20261001000000.000000+000'; RestorePointType = 0 },
            [pscustomobject]@{ SequenceNumber = 3; Description = 'c'; CreationTime = '20261003000000.000000+000'; RestorePointType = 12 }) } }
        $l = @(Get-KbRestorePoints)
        Assert-Equal $l[0].id 3 'newest'
        Assert-Equal $l.Count 2 'count'
    }
    It 'reports a created point when the list grows' {
        $script:Made = 0
        $script:RestoreProvider = @{
            List   = { if ($script:Made) { @([pscustomobject]@{ SequenceNumber = 5; Description = 'k'; CreationTime = '20261010000000.000000+000'; RestorePointType = 12 }) } else { @() } }
            Create = { param($d) $script:Made = 1 } }
        $r = New-KbRestorePoint 'KafkaBoost test'
        if (-not $r.created) { throw 'should be created' }
        Assert-Equal $r.id 5 'id'
    }
    It 'says skipped (not failed) when Windows declines silently' {
        $script:RestoreProvider = @{ List = { @([pscustomobject]@{ SequenceNumber = 2; Description = 'old'; CreationTime = '20261010000000.000000+000'; RestorePointType = 12 }) }; Create = { param($d) } }
        $r = New-KbRestorePoint 'x'
        if (-not $r.ok -or $r.created) { throw 'should be ok but not created' }
        Assert-Equal $r.code 'msg.restore.skipped' 'code'
    }
    It 'returns a failure when creating throws' {
        $script:RestoreProvider = @{ List = { @() }; Create = { param($d) throw 'boom' } }
        $r = New-KbRestorePoint 'x'
        if ($r.ok) { throw 'should fail' }
        Assert-Equal $r.code 'msg.restore.failed' 'code'
    }
    It 'knows the first tweak from the state file' {
        $dir = New-Sandbox
        try {
            $script:TweakStatePath = Join-Path $dir 'state.json'
            if (-not (Test-FirstTweak)) { throw 'empty state is the first tweak' }
            Save-TweakState ([pscustomobject]@{ version = 1; tweaks = [pscustomobject]@{ 'game-mode' = [pscustomobject]@{ appliedAt = 'x'; previous = @() } } })
            if (Test-FirstTweak) { throw 'a recorded tweak means it is not the first' }
        } finally { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
