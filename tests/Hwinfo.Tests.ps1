# Pester tests for scripts\lib\Hwinfo.ps1. Fake fetcher, fake signature check, fake processes and sandbox folders stand in for the
# network, Authenticode, the process list and ProgramData: nothing is downloaded, no HWiNFO is started or stopped.

Describe 'Hwinfo (discovery, zip, signature, INI, processes)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Sensors.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Hwinfo.ps1')
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $script:Prefix = 'https://www.hwinfo.com/files/'
        # The layout of the official page (reduced): installer block, portable block with a stable and a beta button, DOS block.
        function New-Page([string]$Version = '8.54', [string]$Link = 'https://www.hwinfo.com/files/hwi_854.zip') {
            "<h2>Installer<div>for Windows 7 64-bit and later</div></h2> <sub>Version $Version</sub><a href=`"https://www.hwinfo.com/files/hwi64_854.exe`">Local</a>" +
            "<h2>Portable<div>for Windows 95 and later<br>x86, x64 or ARM64 platform</div></h2> <sub>Version $Version</sub>" +
            "<div class=`"btn btn-less`"> Free Download<ul><li><a href=`"https://www.hwinfo.com/dAppCDN`">CDN</a></li><li><a href=`"$Link`">Local (U.S.)</a></li></ul></div>" +
            "<div class=`"btn btn-gray btn-sm`"> Download latest Beta v8.55-6095<ul><li><a href=`"https://www.hwinfo.com/files/hwi_855_6095.zip`">Primary backup</a></li></ul></div>" +
            "<h2>Portable<div>for DOS</div></h2><sub>&nbsp;</sub><a href=`"https://www.hwinfo.com/files/HWINF627.ZIP`">Local</a>"
        }
        function New-FakeZip([string]$Path, [string[]]$Names) {
            $src = New-Sandbox
            foreach ($n in $Names) { Set-Content (Join-Path $src (Split-Path $n -Leaf)) "fake $n" -Encoding ASCII }
            $z = [IO.Compression.ZipFile]::Open($Path, 'Create')
            try { foreach ($n in $Names) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, (Join-Path $src (Split-Path $n -Leaf)), $n) } } finally { $z.Dispose() }
            Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
        }
        $script:Cfg = Get-HwinfoConfig
        $script:Good = Join-Path ([IO.Path]::GetTempPath()) ('kb_hwzip_' + [guid]::NewGuid().ToString('N') + '.zip')
        New-FakeZip $script:Good @('HWiNFO32.exe', 'HWiNFO64.exe', 'HWiNFO_ARM64.exe')
        $script:Template = $script:HwinfoTemplatePath
    }
    AfterAll { Remove-Item -LiteralPath $script:Good -Force -ErrorAction SilentlyContinue }
    AfterEach {
        $script:HwinfoFetcher = $null; $script:HwinfoSignature = $null; $script:HwinfoProcesses = $null; $script:HwinfoSharedMemory = $null
        $script:HwinfoStarter = $null; $script:HwinfoStopper = $null
        $script:HwinfoRoot = Join-Path $env:ProgramData 'LegionTuning\hwinfo'
    }

    It 'config/hwinfo.json points at the official site and expects the REALiX signer' {
        if (-not $script:Cfg.downloadPage.StartsWith('https://www.hwinfo.com/')) { throw 'download page outside hwinfo.com' }
        if (-not $script:Cfg.filePrefix.StartsWith('https://www.hwinfo.com/files/')) { throw 'file prefix outside hwinfo.com' }
        Assert-Equal $script:Cfg.signer 'REALiX' 'signer'
        Assert-Equal $script:Cfg.exe 'HWiNFO64.exe' 'exe'
    }
    It 'reads the stable portable zip and its version from the page, ignoring the installer, the beta and the DOS build' {
        $r = ConvertFrom-HwinfoPage (New-Page) $script:Prefix
        Assert-Equal $r.version '8.54' 'version'
        Assert-Equal $r.url 'https://www.hwinfo.com/files/hwi_854.zip' 'url'
    }
    It 'refuses a page whose layout changed, whose link leaves the official prefix or disagrees with the version' {
        if (ConvertFrom-HwinfoPage '<html>nothing here</html>' $script:Prefix) { throw 'unknown layout must give nothing' }
        if (ConvertFrom-HwinfoPage (New-Page '8.54' 'https://evil.example/files/hwi_854.zip') $script:Prefix) { throw 'foreign host must be refused' }
        if (ConvertFrom-HwinfoPage (New-Page '8.54' 'https://www.hwinfo.com/files/hwi_853.zip') $script:Prefix) { throw 'version and file name disagree' }
        if (ConvertFrom-HwinfoPage (New-Page '8.54' 'https://www.hwinfo.com/files/hwi_854.zip.exe') $script:Prefix) { throw 'not a .zip link' }
    }
    It 'Get-HwinfoRelease returns the release, or throws msg.hwinfo.pageChanged' {
        $script:HwinfoFetcher = @{ Page = { New-Page } }
        Assert-Equal (Get-HwinfoRelease $script:Cfg).version '8.54' 'version'
        $script:HwinfoFetcher = @{ Page = { '<html>cloudflare</html>' } }
        $code = ''; try { Get-HwinfoRelease $script:Cfg | Out-Null } catch { $code = $_.Exception.Data['code'] }
        Assert-Equal $code 'msg.hwinfo.pageChanged' 'code'
    }
    It 'accepts a zip with HWiNFO64.exe and refuses an HTML page, a zip without the exe and a zip that escapes the folder' {
        if (-not (Test-HwinfoZipFile $script:Good 'HWiNFO64.exe')) { throw 'good zip refused' }
        $html = Join-Path ([IO.Path]::GetTempPath()) ('kb_hwhtml_' + [guid]::NewGuid().ToString('N') + '.zip')
        $noexe = Join-Path ([IO.Path]::GetTempPath()) ('kb_hwnoexe_' + [guid]::NewGuid().ToString('N') + '.zip')
        try {
            Set-Content $html '<html>Just a moment...</html>' -Encoding ASCII
            if (Test-HwinfoZipFile $html 'HWiNFO64.exe') { throw 'an HTML challenge page is not a zip' }
            New-FakeZip $noexe @('HWiNFO32.exe')
            if (Test-HwinfoZipFile $noexe 'HWiNFO64.exe') { throw 'zip without HWiNFO64.exe must be refused' }
            $z = [IO.Compression.ZipFile]::Open($noexe, 'Update')
            try { [void]$z.CreateEntry('HWiNFO64.exe'); [void]$z.CreateEntry('..\evil.exe') } finally { $z.Dispose() }
            if (Test-HwinfoZipFile $noexe 'HWiNFO64.exe') { throw 'zip with ..\ must be refused' }
            if (Test-HwinfoZipFile (Join-Path ([IO.Path]::GetTempPath()) 'kb_does_not_exist.zip') 'HWiNFO64.exe') { throw 'missing file' }
        } finally { Remove-Item -LiteralPath $html, $noexe -Force -ErrorAction SilentlyContinue }
    }
    It 'accepts only a Valid signature from REALiX' {
        $script:HwinfoSignature = { param($p) @{ status = 'Valid'; subject = 'CN="REALiX, s.r.o.", O="REALiX, s.r.o.", C=SK' } }
        $s = Test-HwinfoSignature 'x.exe' $script:Cfg
        if (-not $s.ok) { throw 'valid REALiX refused' }
        Assert-Equal $s.signer 'REALiX, s.r.o.' 'signer name'
        $script:HwinfoSignature = { param($p) @{ status = 'Valid'; subject = 'CN="Someone Else Ltd", C=US' } }
        if ((Test-HwinfoSignature 'x.exe' $script:Cfg).ok) { throw 'other signer accepted' }
        $script:HwinfoSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        if ((Test-HwinfoSignature 'x.exe' $script:Cfg).ok) { throw 'unsigned accepted' }
        $script:HwinfoSignature = { param($p) @{ status = 'HashMismatch'; subject = 'CN="REALiX, s.r.o."' } }
        if ((Test-HwinfoSignature 'x.exe' $script:Cfg).ok) { throw 'tampered file accepted' }
    }
    It 'INI: copies the template when there is none, keeps an INI that already has SensorsSM=1' {
        $d = New-Sandbox
        try {
            Assert-Equal (Initialize-HwinfoIni $d $script:Template).action 'copied' 'first'
            if (-not (Test-HwinfoSharedMemoryIni (Join-Path $d 'HWiNFO64.INI'))) { throw 'template must turn shared memory on' }
            Assert-Equal (Initialize-HwinfoIni $d $script:Template).action 'kept' 'second'
        } finally { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'INI: leaves a user INI without SensorsSM untouched unless told, then backs it up and sets only that key' {
        $d = New-Sandbox; $ini = Join-Path $d 'HWiNFO64.INI'
        try {
            $orig = "[Settings]`r`nFont=Caf$([char]0xE9)`r`nSensorsSM=0`r`nOther=5`r`n"
            [IO.File]::WriteAllText($ini, $orig, [Text.Encoding]::GetEncoding(28591))
            Assert-Equal (Initialize-HwinfoIni $d $script:Template).action 'needsSharedMemory' 'without consent'
            Assert-Equal ([IO.File]::ReadAllText($ini, [Text.Encoding]::GetEncoding(28591))) $orig 'untouched'
            $r = Initialize-HwinfoIni $d $script:Template -UpdateExisting
            Assert-Equal $r.action 'patched' 'with consent'
            Assert-Equal ([IO.File]::ReadAllText($r.backup, [Text.Encoding]::GetEncoding(28591))) $orig 'backup is the original'
            $new = [IO.File]::ReadAllText($ini, [Text.Encoding]::GetEncoding(28591))
            Assert-Equal $new ($orig -replace 'SensorsSM=0', 'SensorsSM=1') 'only SensorsSM changed (other keys and the accent kept)'
        } finally { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'INI: inserts the key into [Settings], or adds the section, when the key is absent' {
        $d = New-Sandbox; $ini = Join-Path $d 'HWiNFO64.INI'
        try {
            Set-Content $ini "[Settings]`r`nOther=5" -Encoding ASCII
            Initialize-HwinfoIni $d $script:Template -UpdateExisting | Out-Null
            if (-not (Test-HwinfoSharedMemoryIni $ini)) { throw 'key not inserted' }
            if ((Get-Content $ini -Raw) -notmatch 'Other=5') { throw 'other key lost' }
            Set-Content $ini "Foo=1" -Encoding ASCII
            Initialize-HwinfoIni $d $script:Template -UpdateExisting | Out-Null
            if (-not (Test-HwinfoSharedMemoryIni $ini)) { throw 'section not added' }
            $baks = @(Get-ChildItem $d -Filter 'HWiNFO64.INI.bak_*')
            if ($baks.Count -lt 1) { throw 'no backup' }
        } finally { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'selects only processes started from that exe (case-insensitive); an unreadable Path is not ours' {
        $exe = 'C:\App\hwinfo\8.54\HWiNFO64.exe'
        $p = @([pscustomobject]@{ Id = 1; Path = 'c:\app\HWINFO\8.54\hwinfo64.EXE' }, [pscustomobject]@{ Id = 2; Path = 'C:\Other\HWiNFO64.exe' }, [pscustomobject]@{ Id = 3; Path = $null })
        $mine = @(Select-HwinfoOwnProcesses $p $exe)
        Assert-Equal $mine.Count 1 'count'
        Assert-Equal $mine[0].Id 1 'id'
    }
}

Describe 'Hwinfo install, state, start, stop (sandbox)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Sensors.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Hwinfo.ps1')
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        function New-FakeZip([string]$Path, [string[]]$Names) {
            $src = New-Sandbox
            foreach ($n in $Names) { Set-Content (Join-Path $src (Split-Path $n -Leaf)) "fake $n" -Encoding ASCII }
            $z = [IO.Compression.ZipFile]::Open($Path, 'Create')
            try { foreach ($n in $Names) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, (Join-Path $src (Split-Path $n -Leaf)), $n) } } finally { $z.Dispose() }
            Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
        }
        $script:Cfg = Get-HwinfoConfig
        $script:Good = Join-Path ([IO.Path]::GetTempPath()) ('kb_hwzip2_' + [guid]::NewGuid().ToString('N') + '.zip')
        New-FakeZip $script:Good @('HWiNFO32.exe', 'HWiNFO64.exe', 'HWiNFO_ARM64.exe')
        $script:Page = "<h2>Portable<div>for Windows 95 and later</div></h2> <sub>Version 8.54</sub><div class=`"btn btn-less`"><a href=`"https://www.hwinfo.com/files/hwi_854.zip`">Local</a></div><div class=`"btn-gray`"></div><h2>x</h2>"
        $script:OkSig = { param($p) @{ status = 'Valid'; subject = 'CN="REALiX, s.r.o."' } }
        $script:Empty = New-Sandbox     # a search root with no HWiNFO in it
        function Use-Fakes {
            $script:HwinfoFetcher = @{ Page = { $script:Page }; File = { param($u, $o) $script:Fetched = $u; Copy-Item -LiteralPath $script:Good -Destination $o } }
            $script:HwinfoSignature = $script:OkSig
        }
    }
    AfterAll { Remove-Item -LiteralPath $script:Good -Force -ErrorAction SilentlyContinue; Remove-Item $script:Empty -Recurse -Force -ErrorAction SilentlyContinue }
    BeforeEach { $script:Root = New-Sandbox; $script:HwinfoRoot = $script:Root }
    AfterEach {
        $script:HwinfoFetcher = $null; $script:HwinfoSignature = $null; $script:HwinfoProcesses = $null; $script:HwinfoSharedMemory = $null
        $script:HwinfoStarter = $null; $script:HwinfoStopper = $null
        Remove-Item $script:Root -Recurse -Force -ErrorAction SilentlyContinue
        $script:HwinfoRoot = Join-Path $env:ProgramData 'LegionTuning\hwinfo'
    }

    It 'installs: downloads the discovered url, unpacks only HWiNFO64.exe, copies the INI, leaves no staging folder' {
        Use-Fakes
        $r = Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl
        Assert-Equal $script:Fetched 'https://www.hwinfo.com/files/hwi_854.zip' 'downloaded url'
        Assert-Equal $r.version '8.54' 'version'
        Assert-Equal $r.ini 'copied' 'ini'
        if (-not (Test-Path (Join-Path $script:Root '8.54\HWiNFO64.exe'))) { throw 'exe missing' }
        if (-not (Test-Path (Join-Path $script:Root '8.54\HWiNFO64.INI'))) { throw 'ini missing' }
        foreach ($no in 'HWiNFO32.exe', 'HWiNFO_ARM64.exe') { if (Test-Path (Join-Path $script:Root "8.54\$no")) { throw "$no must not be unpacked" } }
        Assert-Equal @(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter 'KafkaBoost_hwinfo_*' -ErrorAction SilentlyContinue).Count 0 'staging folders left'
    }
    It 'refuses a bad signature: nothing is installed and the staging folder is gone' {
        Use-Fakes
        $script:HwinfoSignature = { param($p) @{ status = 'NotSigned'; subject = '' } }
        $code = ''; try { Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl | Out-Null } catch { $code = $_.Exception.Data['code'] }
        Assert-Equal $code 'msg.hwinfo.badSignature' 'code'
        if (Test-Path (Join-Path $script:Root '8.54')) { throw 'nothing may be installed' }
        Assert-Equal @(Get-ChildItem ([IO.Path]::GetTempPath()) -Directory -Filter 'KafkaBoost_hwinfo_*' -ErrorAction SilentlyContinue).Count 0 'staging folders left'
    }
    It 'refuses when the page now offers another version than the one the user agreed to' {
        Use-Fakes
        $script:Fetched = $null
        $code = ''; try { Install-Hwinfo $script:Cfg '8.40' $null -SkipAcl | Out-Null } catch { $code = $_.Exception.Data['code'] }
        Assert-Equal $code 'msg.hwinfo.versionChanged' 'code'
        Assert-Equal $script:Fetched $null 'nothing was downloaded'
    }
    It 'reports a protection page (reply is not a zip) as msg.hwinfo.blocked' {
        Use-Fakes
        $script:HwinfoFetcher.File = { param($u, $o) Set-Content $o '<html>Just a moment...</html>' -Encoding ASCII }
        $code = ''; try { Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl | Out-Null } catch { $code = $_.Exception.Data['code'] }
        Assert-Equal $code 'msg.hwinfo.blocked' 'code'
        if (Test-Path (Join-Path $script:Root '8.54')) { throw 'nothing may be installed' }
    }
    It 'accepts a zip the user downloaded (-ZipPath) under the same checks and never touches the network' {
        Use-Fakes
        $script:HwinfoFetcher = @{ Page = { throw 'no network expected' }; File = { throw 'no network expected' } }
        $r = Install-Hwinfo $script:Cfg $null $script:Good -SkipAcl
        if (-not (Test-Path $r.exe)) { throw 'exe missing' }
        $bad = Join-Path ([IO.Path]::GetTempPath()) ('kb_hwbad_' + [guid]::NewGuid().ToString('N') + '.zip')
        try {
            New-FakeZip $bad @('HWiNFO32.exe')
            $code = ''; try { Install-Hwinfo $script:Cfg $null $bad -SkipAcl | Out-Null } catch { $code = $_.Exception.Data['code'] }
            Assert-Equal $code 'msg.hwinfo.badZip' 'code'
        } finally { Remove-Item $bad -Force -ErrorAction SilentlyContinue }
    }
    It 'state: nothing installed; then the own copy; then a copy the user already has wins over it' {
        $script:HwinfoProcesses = { @() }; $script:HwinfoSharedMemory = { $false }
        $s = Get-HwinfoState @($script:Empty)
        Assert-Equal $s.installed $false 'empty'
        Use-Fakes; $script:HwinfoProcesses = { @() }; $script:HwinfoSharedMemory = { $false }
        Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl | Out-Null
        $s = Get-HwinfoState @($script:Empty)
        Assert-Equal $s.source 'own' 'own'
        Assert-Equal $s.ini 'ok' 'ini'
        $mine = New-Sandbox
        try {
            New-Item -ItemType Directory (Join-Path $mine 'hwi_830') | Out-Null; Set-Content (Join-Path $mine 'hwi_830\HWiNFO64.exe') 'x' -Encoding ASCII
            $s = Get-HwinfoState @($mine)
            Assert-Equal $s.source 'existing' 'existing wins'
            Assert-Equal $s.ini 'missing' 'their folder has no INI yet'
            if (-not $s.dir.EndsWith('hwi_830')) { throw "wrong dir $($s.dir)" }
        } finally { Remove-Item $mine -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'state: running here, running somewhere else, shared memory flag' {
        Use-Fakes; Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl | Out-Null
        $exe = Join-Path $script:Root '8.54\HWiNFO64.exe'
        $script:HwinfoSharedMemory = { $true }
        $script:HwinfoProcesses = { @([pscustomobject]@{ Id = 7; Path = $exe }) }
        $s = Get-HwinfoState @($script:Empty)
        Assert-Equal $s.running $true 'running'; Assert-Equal $s.runningHere $true 'here'; Assert-Equal $s.sharedMemory $true 'sm'
        $script:HwinfoProcesses = { @([pscustomobject]@{ Id = 8; Path = 'C:\Elsewhere\HWiNFO64.exe' }) }
        $s = Get-HwinfoState @($script:Empty)
        Assert-Equal $s.running $true 'running'; Assert-Equal $s.runningHere $false 'not here'
    }
    It 'start: not installed, bad signature, already running here, another copy running, then a clean start without arguments' {
        $script:HwinfoProcesses = { @() }
        Assert-Equal (Start-HwinfoApp $script:Cfg -SearchRoots @($script:Empty)).code 'msg.hwinfo.notInstalled' 'not installed'
        Use-Fakes; Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl | Out-Null
        $exe = Join-Path $script:Root '8.54\HWiNFO64.exe'
        $script:Started = @()
        $script:HwinfoStarter = { param($e, $d) $script:Started += , @($e, $d) }
        $script:HwinfoSignature = { param($p) @{ status = 'HashMismatch'; subject = 'CN="REALiX, s.r.o."' } }
        Assert-Equal (Start-HwinfoApp $script:Cfg -SearchRoots @($script:Empty)).code 'msg.hwinfo.badSignature' 'bad signature'
        $script:HwinfoSignature = $script:OkSig
        $script:HwinfoProcesses = { @([pscustomobject]@{ Id = 7; Path = $exe }) }
        Assert-Equal (Start-HwinfoApp $script:Cfg -SearchRoots @($script:Empty)).code 'msg.hwinfo.alreadyRunning' 'already'
        $script:HwinfoProcesses = { @([pscustomobject]@{ Id = 8; Path = 'C:\Elsewhere\HWiNFO64.exe' }) }
        Assert-Equal (Start-HwinfoApp $script:Cfg -SearchRoots @($script:Empty)).code 'msg.hwinfo.otherRunning' 'other copy'
        Assert-Equal $script:Started.Count 0 'nothing started so far'
        $script:HwinfoProcesses = { @() }
        $r = Start-HwinfoApp $script:Cfg -SearchRoots @($script:Empty)
        Assert-Equal $r.code 'msg.hwinfo.started' 'started'
        Assert-Equal $script:Started.Count 1 'one start'
        Assert-Equal $script:Started[0][0] $exe 'the exe'
    }
    It 'start: a user INI without SensorsSM stops the start, and -UpdateIni backs it up and goes on' {
        $mine = New-Sandbox
        try {
            New-Item -ItemType Directory (Join-Path $mine 'hw') | Out-Null
            Set-Content (Join-Path $mine 'hw\HWiNFO64.exe') 'x' -Encoding ASCII
            Set-Content (Join-Path $mine 'hw\HWiNFO64.INI') "[Settings]`r`nSensorsSM=0" -Encoding ASCII
            $script:HwinfoProcesses = { @() }; $script:HwinfoSignature = $script:OkSig
            $script:Started = @(); $script:HwinfoStarter = { param($e, $d) $script:Started += , @($e, $d) }
            $r = Start-HwinfoApp $script:Cfg -SearchRoots @($mine)
            Assert-Equal $r.code 'msg.hwinfo.iniNoSharedMemory' 'needs consent'; Assert-Equal $script:Started.Count 0 'not started'
            $r = Start-HwinfoApp $script:Cfg -UpdateIni -SearchRoots @($mine)
            Assert-Equal $r.code 'msg.hwinfo.started' 'started'
            Assert-Equal $r.data.ini 'patched' 'patched'
            if (-not (Test-Path $r.data.backup)) { throw 'backup missing' }
        } finally { Remove-Item $mine -Recurse -Force -ErrorAction SilentlyContinue }
    }
    It 'stop: ends only the processes started from this exe' {
        Use-Fakes; Install-Hwinfo $script:Cfg '8.54' $null -SkipAcl | Out-Null
        $exe = Join-Path $script:Root '8.54\HWiNFO64.exe'
        $script:HwinfoProcesses = { @([pscustomobject]@{ Id = 7; Path = $exe }, [pscustomobject]@{ Id = 8; Path = 'C:\Elsewhere\HWiNFO64.exe' }, [pscustomobject]@{ Id = 9; Path = $null }) }
        $script:Stopped = @(); $script:HwinfoStopper = { param($id) $script:Stopped += $id }
        $r = Stop-HwinfoApp @($script:Empty)
        Assert-Equal $r.code 'msg.hwinfo.stopped' 'code'
        Assert-Equal ($script:Stopped -join ',') '7' 'only our pid'
        $script:HwinfoProcesses = { @([pscustomobject]@{ Id = 8; Path = 'C:\Elsewhere\HWiNFO64.exe' }) }
        $script:Stopped = @()
        Assert-Equal (Stop-HwinfoApp @($script:Empty)).code 'msg.hwinfo.notRunning' 'foreign copy only'
        Assert-Equal $script:Stopped.Count 0 'nothing stopped'
    }
}
