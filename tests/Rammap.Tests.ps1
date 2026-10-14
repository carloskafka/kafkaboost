# Pester tests for scripts\lib\Rammap.ps1. A fake fetcher, fake signature check, fake runner and fake memory counters stand in for the
# network, Authenticode, RAMMap itself and Windows: nothing is downloaded and RAMMap is never started.

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
        @($script:Cfg.actions).Count | Should Be 5
        foreach ($a in $script:Cfg.actions) { $a.switch | Should Match '^-E[a-z0-9]$' }
        $script:Cfg.urlPrefix | Should Match '^https://download\.sysinternals\.com/'
        $script:Cfg.zipUrl.StartsWith($script:Cfg.urlPrefix) | Should Be $true
    }

    It 'accepts only a Valid signature from exactly Microsoft Corporation' {
        $f = Join-Path $script:RammapRoot 'x.exe'; Set-Content $f 'x'
        $script:RammapSignature = $script:Valid
        (Test-RammapSignature $f $script:Cfg).ok | Should Be $true
        $script:RammapSignature = { param($p) @{ status = 'Valid'; subject = 'CN="Microsoft Corporation Fake"' } }
        (Test-RammapSignature $f $script:Cfg).ok | Should Be $false
        $script:RammapSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        (Test-RammapSignature $f $script:Cfg).ok | Should Be $false
        $script:RammapSignature = { param($p) @{ status = 'HashMismatch'; subject = 'CN="Microsoft Corporation"' } }
        (Test-RammapSignature $f $script:Cfg).ok | Should Be $false
    }

    It 'installs a good zip with a valid signature' {
        $script:RammapSignature = $script:Valid
        $script:RammapFetcher = { param($u, $out) Copy-Item $script:Good $out }
        $r = Install-Rammap $script:Cfg $null
        Test-Path (Join-Path $script:RammapRoot 'RAMMap64.exe') | Should Be $true
        $r.source | Should Be $script:Cfg.zipUrl
        (Get-RammapState $script:Cfg).installed | Should Be $true
    }

    It 'refuses a bad signature and installs nothing' {
        $script:RammapSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        $script:RammapFetcher = { param($u, $out) Copy-Item $script:Good $out }
        $code = $null; try { Install-Rammap $script:Cfg $null } catch { $code = $_.Exception.Data['code'] }
        $code | Should Be 'msg.rammap.badSignature'
        Test-Path (Join-Path $script:RammapRoot 'RAMMap64.exe') | Should Be $false
    }

    It 'refuses a zip without RAMMap64.exe and a reply that is not a zip' {
        $script:RammapSignature = $script:Valid
        $script:RammapFetcher = { param($u, $out) Copy-Item $script:NoExe $out }
        $code = $null; try { Install-Rammap $script:Cfg $null } catch { $code = $_.Exception.Data['code'] }
        $code | Should Be 'msg.rammap.badZip'
        $script:RammapFetcher = { param($u, $out) Set-Content $out '<html>blocked</html>' }
        $code = $null; try { Install-Rammap $script:Cfg $null } catch { $code = $_.Exception.Data['code'] }
        $code | Should Be 'msg.rammap.badZip'
    }

    It 'refuses a download address outside the expected site' {
        $bad = $script:Cfg | ConvertTo-Json | ConvertFrom-Json; $bad.zipUrl = 'https://evil.example/RAMMap.zip'
        $code = $null; try { Install-Rammap $bad $null } catch { $code = $_.Exception.Data['code'] }
        $code | Should Be 'msg.rammap.badSource'
    }

    It 'computes the delta and keeps a missing counter missing, never 0' {
        $b = [pscustomobject]@{ availableBytes = 100; freeBytes = 10; standbyBytes = 80; modifiedBytes = $null }
        $a = [pscustomobject]@{ availableBytes = 150; freeBytes = 60; standbyBytes = 30; modifiedBytes = 5 }
        $d = Get-RammapDelta $b $a
        $d.availableBytes | Should Be 50; $d.freeBytes | Should Be 50; $d.standbyBytes | Should Be (-50)
        $d.modifiedBytes | Should BeNullOrEmpty
    }

    It 'runs only an allow-listed action with -accepteula and the switch from the config, and records before and after' {
        $script:RammapSignature = $script:Valid
        Set-Content (Join-Path $script:RammapRoot 'RAMMap64.exe') 'fake'
        $script:MemCalls = 0
        $script:RammapMemory = { $script:MemCalls++; [pscustomobject]@{ totalBytes = 1000; availableBytes = 100 * $script:MemCalls; freeBytes = 10; standbyBytes = 500 - 100 * $script:MemCalls; modifiedBytes = 1 } }
        $script:Seen = $null
        $script:RammapRunner = { param($exe, $a) $script:Seen = $a; 0 }
        $r = Invoke-RammapAction 'standby' $script:Cfg
        $r.ok | Should Be $true
        ($script:Seen -join ' ') | Should Be '-accepteula -E0'
        $r.data.delta.standbyBytes | Should Be (-100)
        @(Get-RammapHistory).Count | Should Be 1
        (Get-RammapHistory)[0].action | Should Be 'standby'
    }

    It 'rejects an unknown action id, including one that looks like a switch, without starting anything' {
        $script:RammapSignature = $script:Valid
        Set-Content (Join-Path $script:RammapRoot 'RAMMap64.exe') 'fake'
        $script:Ran = $false; $script:RammapRunner = { param($e, $a) $script:Ran = $true; 0 }
        (Invoke-RammapAction '-Ew' $script:Cfg).code | Should Be 'msg.rammap.unknownAction'
        (Invoke-RammapAction 'standby; calc' $script:Cfg).code | Should Be 'msg.rammap.unknownAction'
        $script:Ran | Should Be $false
    }

    It 'does not start when not installed or when the signature is not valid, and does not log a failed run' {
        (Invoke-RammapAction 'standby' $script:Cfg).code | Should Be 'msg.rammap.notInstalled'
        Set-Content (Join-Path $script:RammapRoot 'RAMMap64.exe') 'fake'
        $script:RammapSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        $script:Ran = $false; $script:RammapRunner = { param($e, $a) $script:Ran = $true; 0 }
        (Invoke-RammapAction 'standby' $script:Cfg).code | Should Be 'msg.rammap.badSignature'
        $script:Ran | Should Be $false
        $script:RammapSignature = $script:Valid; $script:RammapRunner = { param($e, $a) 5 }
        $script:RammapMemory = { [pscustomobject]@{ totalBytes = 1; availableBytes = 1; freeBytes = 1; standbyBytes = 1; modifiedBytes = 1 } }
        (Invoke-RammapAction 'standby' $script:Cfg).code | Should Be 'msg.rammap.runFailed'
        @(Get-RammapHistory).Count | Should Be 0
    }

    It 'reads the real memory counters as numbers and never as 0 when missing' {
        $m = Get-RammapMemory
        if ($null -ne $m.totalBytes) { $m.totalBytes | Should BeGreaterThan 0 }
    }
}
