# Pester tests for scripts\lib\Rammap.ps1. A fake fetcher, fake signature check, fake runner and fake memory counters stand in for the
# network, Authenticode, RAMMap itself and Windows: nothing is downloaded and RAMMap is never started.
# Plain Assert-Equal / throw assertions (Setup.ps1), so the file runs on Pester 3.4 and 5.

Describe 'Rammap (config, install, signature, run, history)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Rammap.ps1')
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $script:Cfg = Get-RammapConfig
        function New-FakeZip([string]$Path, [string[]]$Names) {
            $src = New-Sandbox
            foreach ($n in $Names) { Set-Content (Join-Path $src $n) "fake $n" -Encoding ASCII }
            $z = [IO.Compression.ZipFile]::Open($Path, 'Create')
            try { foreach ($n in $Names) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, (Join-Path $src $n), $n) } } finally { $z.Dispose() }
            Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
        }
        function Get-ErrorCode([scriptblock]$Block) {
            try { & $Block } catch { return $_.Exception.Data['code'] }
            return $null
        }
        $script:Good = Join-Path ([IO.Path]::GetTempPath()) ('kb_rmzip_' + [guid]::NewGuid().ToString('N') + '.zip')
        New-FakeZip $script:Good @('RAMMap.exe', 'RAMMap64.exe', 'Eula.txt')
        $script:NoExe = Join-Path ([IO.Path]::GetTempPath()) ('kb_rmzip2_' + [guid]::NewGuid().ToString('N') + '.zip')
        New-FakeZip $script:NoExe @('RAMMap.exe', 'Eula.txt')
        $script:Valid = { param($p) @{ status = 'Valid'; subject = 'CN="Microsoft Corporation", O=Microsoft Corporation, C=US' } }
    }
    AfterAll { Remove-Item -LiteralPath $script:Good, $script:NoExe -Force -ErrorAction SilentlyContinue }
    BeforeEach {
        $script:RammapRoot = New-Sandbox
        $script:RammapFetcher = $null; $script:RammapSignature = $null; $script:RammapRunner = $null; $script:RammapMemory = $null
    }
    AfterEach { Remove-Item -LiteralPath $script:RammapRoot -Recurse -Force -ErrorAction SilentlyContinue }

    It 'has five actions, every switch an -E switch and only from the config' {
        Assert-Equal @($script:Cfg.actions).Count 5 'action count'
        foreach ($a in $script:Cfg.actions) { if ($a.switch -notmatch '^-E[a-z0-9]$') { throw "bad switch $($a.switch)" } }
        if ($script:Cfg.urlPrefix -notmatch '^https://download\.sysinternals\.com/') { throw 'urlPrefix' }
        Assert-Equal $script:Cfg.zipUrl.StartsWith($script:Cfg.urlPrefix) $true 'zipUrl under urlPrefix'
    }

    It 'accepts only a Valid signature from exactly Microsoft Corporation' {
        $f = Join-Path $script:RammapRoot 'x.exe'; Set-Content $f 'x'
        $script:RammapSignature = $script:Valid
        Assert-Equal (Test-RammapSignature $f $script:Cfg).ok $true 'valid + exact signer'
        $script:RammapSignature = { param($p) @{ status = 'Valid'; subject = 'CN="Microsoft Corporation Fake"' } }
        Assert-Equal (Test-RammapSignature $f $script:Cfg).ok $false 'look-alike signer'
        $script:RammapSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        Assert-Equal (Test-RammapSignature $f $script:Cfg).ok $false 'not signed'
        $script:RammapSignature = { param($p) @{ status = 'HashMismatch'; subject = 'CN="Microsoft Corporation"' } }
        Assert-Equal (Test-RammapSignature $f $script:Cfg).ok $false 'tampered'
    }

    It 'installs a good zip with a valid signature' {
        $script:RammapSignature = $script:Valid
        $script:RammapFetcher = { param($u, $out) Copy-Item $script:Good $out }
        $r = Install-Rammap $script:Cfg $null
        if (-not (Test-Path (Join-Path $script:RammapRoot 'RAMMap64.exe'))) { throw 'exe not installed' }
        Assert-Equal $r.source $script:Cfg.zipUrl 'source'
        Assert-Equal (Get-RammapState $script:Cfg).installed $true 'state installed'
    }

    It 'refuses a bad signature and installs nothing' {
        $script:RammapSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        $script:RammapFetcher = { param($u, $out) Copy-Item $script:Good $out }
        Assert-Equal (Get-ErrorCode { Install-Rammap $script:Cfg $null }) 'msg.rammap.badSignature' 'error code'
        if (Test-Path (Join-Path $script:RammapRoot 'RAMMap64.exe')) { throw 'exe was installed' }
    }

    It 'refuses a zip without RAMMap64.exe and a reply that is not a zip' {
        $script:RammapSignature = $script:Valid
        $script:RammapFetcher = { param($u, $out) Copy-Item $script:NoExe $out }
        Assert-Equal (Get-ErrorCode { Install-Rammap $script:Cfg $null }) 'msg.rammap.badZip' 'zip without exe'
        $script:RammapFetcher = { param($u, $out) Set-Content $out '<html>blocked</html>' }
        Assert-Equal (Get-ErrorCode { Install-Rammap $script:Cfg $null }) 'msg.rammap.badZip' 'html reply'
    }

    It 'refuses a download address outside the expected site' {
        $bad = $script:Cfg | ConvertTo-Json -Depth 5 | ConvertFrom-Json; $bad.zipUrl = 'https://evil.example/RAMMap.zip'
        Assert-Equal (Get-ErrorCode { Install-Rammap $bad $null }) 'msg.rammap.badSource' 'foreign address'
    }

    It 'computes the delta and keeps a missing counter missing, never 0' {
        $b = [pscustomobject]@{ availableBytes = 100; freeBytes = 10; standbyBytes = 80; modifiedBytes = $null }
        $a = [pscustomobject]@{ availableBytes = 150; freeBytes = 60; standbyBytes = 30; modifiedBytes = 5 }
        $d = Get-RammapDelta $b $a
        Assert-Equal $d.availableBytes 50 'available'; Assert-Equal $d.freeBytes 50 'free'; Assert-Equal $d.standbyBytes (-50) 'standby'
        if ($null -ne $d.modifiedBytes) { throw 'a missing counter must stay missing' }
    }

    It 'runs only an allow-listed action with -accepteula and the switch from the config, and records before and after' {
        $script:RammapSignature = $script:Valid
        Set-Content (Join-Path $script:RammapRoot 'RAMMap64.exe') 'fake'
        $script:MemCalls = 0
        $script:RammapMemory = { $script:MemCalls++; [pscustomobject]@{ totalBytes = 1000; availableBytes = 100 * $script:MemCalls; freeBytes = 10; standbyBytes = 500 - 100 * $script:MemCalls; modifiedBytes = 1 } }
        $script:Seen = $null
        $script:RammapRunner = { param($exe, $a) $script:Seen = $a; 0 }
        $r = Invoke-RammapAction 'standby' $script:Cfg
        Assert-Equal $r.ok $true 'ok'
        Assert-Equal ($script:Seen -join ' ') '-accepteula -E0' 'arguments'
        Assert-Equal $r.data.delta.standbyBytes (-100) 'standby delta'
        Assert-Equal @(Get-RammapHistory).Count 1 'history count'
        Assert-Equal (Get-RammapHistory)[0].action 'standby' 'history action'
    }

    It 'rejects an unknown action id, including one that looks like a switch, without starting anything' {
        $script:RammapSignature = $script:Valid
        Set-Content (Join-Path $script:RammapRoot 'RAMMap64.exe') 'fake'
        $script:Ran = $false; $script:RammapRunner = { param($e, $a) $script:Ran = $true; 0 }
        Assert-Equal (Invoke-RammapAction '-Ew' $script:Cfg).code 'msg.rammap.unknownAction' 'switch as id'
        Assert-Equal (Invoke-RammapAction 'standby; calc' $script:Cfg).code 'msg.rammap.unknownAction' 'injected id'
        Assert-Equal $script:Ran $false 'nothing started'
    }

    It 'does not start when not installed or when the signature is not valid, and does not log a failed run' {
        Assert-Equal (Invoke-RammapAction 'standby' $script:Cfg).code 'msg.rammap.notInstalled' 'not installed'
        Set-Content (Join-Path $script:RammapRoot 'RAMMap64.exe') 'fake'
        $script:RammapSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        $script:Ran = $false; $script:RammapRunner = { param($e, $a) $script:Ran = $true; 0 }
        Assert-Equal (Invoke-RammapAction 'standby' $script:Cfg).code 'msg.rammap.badSignature' 'bad signature'
        Assert-Equal $script:Ran $false 'nothing started'
        $script:RammapSignature = $script:Valid; $script:RammapRunner = { param($e, $a) 5 }
        $script:RammapMemory = { [pscustomobject]@{ totalBytes = 1; availableBytes = 1; freeBytes = 1; standbyBytes = 1; modifiedBytes = 1 } }
        Assert-Equal (Invoke-RammapAction 'standby' $script:Cfg).code 'msg.rammap.runFailed' 'non-zero exit'
        Assert-Equal @(Get-RammapHistory).Count 0 'failed run is not logged'
    }

    It 'Watch-RammapMemory emits one reading per interval until the time is up, keeps a missing counter missing and survives a failing reader' {
        $script:Clock = [datetime]'2026-10-14T10:00:00'        # the fake clock only moves when the fake Sleep runs
        $now = { $script:Clock }
        $sleep = { param($s) $script:Clock = $script:Clock.AddSeconds($s) }
        $script:Got = New-Object System.Collections.ArrayList
        $reader = { [pscustomobject]@{ totalBytes = 1000; availableBytes = 400; freeBytes = $null; standbyBytes = 300; modifiedBytes = 5 } }
        $n = Watch-RammapMemory 2 '' 6 -OnSample { param($x) [void]$script:Got.Add($x) } -Reader $reader -Sleep $sleep -Now $now
        Assert-Equal $n 3 'readings in 6 s at 2 s'
        Assert-Equal $script:Got.Count 3 'samples delivered'
        if ($null -ne $script:Got[0].freeBytes) { throw 'a missing counter must stay missing' }
        Assert-Equal $script:Got[0].standbyBytes 300 'standby'
        $script:Clock = [datetime]'2026-10-14T10:00:00'
        $bad = { throw 'counter unavailable' }
        Assert-Equal (Watch-RammapMemory 2 '' 4 -Reader $bad -Sleep $sleep -Now $now) 0 'a failing reader gives no readings, no crash'
    }

    It 'Watch-RammapMemory stops when the stop file appears' {
        $stop = Join-Path $script:RammapRoot 'memory.stop'
        $script:Clock = [datetime]'2026-10-14T10:00:00'
        $now = { $script:Clock }
        $script:Count = 0
        $sleep = { param($s) $script:Clock = $script:Clock.AddSeconds($s); $script:Count++; if ($script:Count -ge 2) { Set-Content $stop 'stop' } }
        $reader = { [pscustomobject]@{ totalBytes = 1; availableBytes = 1; freeBytes = 1; standbyBytes = 1; modifiedBytes = 1 } }
        $n = Watch-RammapMemory 1 $stop 100 -Reader $reader -Sleep $sleep -Now $now
        Assert-Equal $n 2 'stopped after the stop file appeared'
    }

    It 'reads the real memory counters as numbers and never as 0 when missing' {
        $m = Get-RammapMemory
        if ($null -ne $m.totalBytes -and $m.totalBytes -le 0) { throw 'totalBytes must be positive or missing' }
    }
}
