# Pester tests for scripts\lib\Cs2.ps1 and config\cs2.json (the Counter-Strike 2 preset).
# Steam and the game are fake folders under %TEMP%, the registry is a SANDBOX key (via $script:RegMap) and the state file is a temp file:
# nothing here touches the real Steam, the real game or the real GPU preference. Plain `throw` assertions (Pester 3.4 and 5).

Describe 'CS2 preset (sandbox folders and registry)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1')
        . (Join-Path $PSScriptRoot '..\scripts\lib\Cs2.ps1')

        function New-CsSandbox {
            $script:CsTemp = Join-Path ([IO.Path]::GetTempPath()) ("kb_cs2_" + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Force $script:CsTemp | Out-Null
            $script:CsKey = "HKCU:\Software\KafkaBoostTest_" + [guid]::NewGuid().ToString('N')
            New-Item -Path $script:CsKey -Force | Out-Null
            $script:RegMap = @{ HKLM = $script:CsKey; HKCU = $script:CsKey }
            $script:TweakStatePath = Join-Path $script:CsTemp 'state.json'
        }
        function Remove-CsSandbox {
            if ($script:CsKey -and $script:CsKey -like 'HKCU:\Software\KafkaBoostTest_*' -and (Test-Path -LiteralPath $script:CsKey)) { Remove-Item -LiteralPath $script:CsKey -Recurse -Force }
            if ($script:CsTemp -and $script:CsTemp -like '*kb_cs2_*' -and (Test-Path -LiteralPath $script:CsTemp)) { Remove-Item -LiteralPath $script:CsTemp -Recurse -Force -ErrorAction SilentlyContinue }
            $script:RegMap = @{ HKLM = 'HKLM:'; HKCU = 'HKCU:' }
            $script:TweakStatePath = Join-Path $env:ProgramData 'LegionTuning\state.json'
        }
        # A fake library with the game inside: <lib>\steamapps\common\<dir>\game\bin\win64\cs2.exe and ...\game\csgo\cfg
        function New-CsGame([string]$Lib, [string]$Dir = 'Counter-Strike Global Offensive') {
            $game = Join-Path $Lib "steamapps\common\$Dir\game"
            New-Item -ItemType Directory -Force (Join-Path $game 'bin\win64') | Out-Null
            New-Item -ItemType Directory -Force (Join-Path $game 'csgo\cfg') | Out-Null
            Set-Content (Join-Path $game 'bin\win64\cs2.exe') 'fake' -Encoding ASCII      # never executed
            Set-Content (Join-Path $game 'csgo\cfg\gamemode.cfg') 'untouched' -Encoding ASCII
            return (Join-Path $game 'bin\win64\cs2.exe')
        }
        function Set-CsSteamPath([string]$Root) {
            New-Item -Path (Join-Path $script:CsKey 'Software\Valve\Steam') -Force | Out-Null
            Set-ItemProperty -LiteralPath (Join-Path $script:CsKey 'Software\Valve\Steam') -Name SteamPath -Value $Root.Replace('\', '/')   # Steam stores forward slashes
        }
        function Get-CsGpuData([string]$Exe) {
            $k = Join-Path $script:CsKey 'Software\Microsoft\DirectX\UserGpuPreferences'
            if (-not (Test-Path -LiteralPath $k)) { return $null }
            $key = Get-Item -LiteralPath $k
            if ($key.GetValueNames() -notcontains $Exe) { return $null }
            return [string]$key.GetValue($Exe)
        }
        function Set-CsGpuData([string]$Exe, [string]$Data) {
            $k = Join-Path $script:CsKey 'Software\Microsoft\DirectX\UserGpuPreferences'
            New-Item -Path $k -Force | Out-Null
            Set-ItemProperty -LiteralPath $k -Name $Exe -Value $Data -Type String
        }
        function Read-CsFile([string]$Path) { [IO.File]::ReadAllText($Path) }
    }
    BeforeEach { New-CsSandbox }
    AfterEach { Remove-CsSandbox }

    # ------------------------------------------------------------ catalog
    It 'the catalog is valid: unique ids, lines on one row, known tiers, a marker, bounds' {
        $c = Get-Cs2Config
        Assert-Equal $c.exeName 'cs2.exe' 'exe name'
        if (-not $c.autoexecMarker.StartsWith('//')) { throw 'the marker must be a cfg comment' }
        $ids = @($c.autoexec | ForEach-Object { $_.id }); Assert-Equal @($ids | Select-Object -Unique).Count $ids.Count 'autoexec ids unique'
        $lids = @($c.launch | ForEach-Object { $_.id }); Assert-Equal @($lids | Select-Object -Unique).Count $lids.Count 'launch ids unique'
        foreach ($a in $c.autoexec) {
            if ($a.line -match "[\r\n;]") { throw "autoexec line for $($a.id) must be a single command" }
            if ($a.comment -match "[\r\n]") { throw "comment for $($a.id) must be one line" }
            if ($a.comment -notmatch '^[\x20-\x7e]+$') { throw "comment for $($a.id) must be plain ASCII" }
        }
        foreach ($l in $c.launch) {
            if ($l.tier -notin 'suggested', 'disputed', 'placebo') { throw "bad tier for $($l.id)" }
            if ($l.text -notmatch '^[+-][a-z]+( [a-z0-9]+)?$') { throw "odd launch option $($l.text)" }
        }
    }

    # ------------------------------------------------------------ Steam detection
    It 'reads library folders in the new and the old libraryfolders.vdf format' {
        $new = "`"libraryfolders`"`n{`n`t`"0`"`n`t{`n`t`t`"path`"`t`t`"C:\\Program Files (x86)\\Steam`"`n`t`t`"label`"`t`t`"`"`n`t`t`"apps`"`n`t`t{`n`t`t`t`"730`"`t`t`"123456789`"`n`t`t}`n`t}`n`t`"1`"`n`t{`n`t`t`"path`"`t`t`"D:\\SteamLibrary`"`n`t}`n}"
        $l = @(ConvertFrom-LibraryFolders $new)
        Assert-Equal $l.Count 2 'two libraries'
        Assert-Equal $l[0] 'C:\Program Files (x86)\Steam' 'first'
        Assert-Equal $l[1] 'D:\SteamLibrary' 'second (backslashes unescaped)'
        $old = "`"LibraryFolders`"`n{`n`t`"TimeNextStatsReport`"`t`t`"1234567890`"`n`t`"ContentStatsID`"`t`t`"-1`"`n`t`"1`"`t`t`"E:\\Games\\Steam`"`n`t`"2`"`t`t`"F:\\More`"`n}"
        $o = @(ConvertFrom-LibraryFolders $old)
        Assert-Equal $o.Count 2 'old format count'
        Assert-Equal $o[0] 'E:\Games\Steam' 'old first'
        Assert-Equal @(ConvertFrom-LibraryFolders '').Count 0 'empty text'
        Assert-Equal @(ConvertFrom-LibraryFolders "`"path`" `"\\\\server\\share`"").Count 0 'a UNC path is not a drive library'
    }
    It 'finds cs2.exe in a second library listed in libraryfolders.vdf (SteamPath with forward slashes)' {
        $steam = Join-Path $script:CsTemp 'Steam'; $lib2 = Join-Path $script:CsTemp 'Lib2'
        New-Item -ItemType Directory -Force (Join-Path $steam 'steamapps') | Out-Null
        $vdf = "`"libraryfolders`"`n{`n`t`"0`" { `"path`" `"" + $steam.Replace('\', '\\') + "`" }`n`t`"1`" { `"path`" `"" + $lib2.Replace('\', '\\') + "`" }`n}"
        [IO.File]::WriteAllText((Join-Path $steam 'steamapps\libraryfolders.vdf'), $vdf)
        $exe = New-CsGame $lib2
        Set-CsSteamPath $steam
        $r = Find-Cs2Install
        Assert-Equal $r.found $true 'found'
        Assert-Equal $r.exe $exe 'exe path'
        Assert-Equal @($r.libraries).Count 2 'two libraries searched'
        Assert-Equal $r.source 'steam' 'source'
    }
    It 'first library wins, the others are listed; the appmanifest installdir is honoured' {
        $steam = Join-Path $script:CsTemp 'Steam'; $lib2 = Join-Path $script:CsTemp 'Lib2'
        New-Item -ItemType Directory -Force (Join-Path $steam 'steamapps') | Out-Null
        [IO.File]::WriteAllText((Join-Path $steam 'steamapps\libraryfolders.vdf'), ("`"libraryfolders`" { `"1`" { `"path`" `"" + $lib2.Replace('\', '\\') + "`" } }"))
        $e1 = New-CsGame $steam
        $e2 = New-CsGame $lib2 'My CS2'
        [IO.File]::WriteAllText((Join-Path $lib2 'steamapps\appmanifest_730.acf'), "`"AppState`"`n{`n`t`"appid`"`t`t`"730`"`n`t`"installdir`"`t`t`"My CS2`"`n}")
        Set-CsSteamPath $steam
        $r = Find-Cs2Install
        Assert-Equal $r.exe $e1 'first hit'
        Assert-Equal @($r.others).Count 1 'one other'
        Assert-Equal $r.others[0] $e2 'the other uses the manifest folder name'
    }
    It 'an installdir with path characters in the manifest is ignored' {
        $steam = Join-Path $script:CsTemp 'Steam'
        New-Item -ItemType Directory -Force (Join-Path $steam 'steamapps') | Out-Null
        [IO.File]::WriteAllText((Join-Path $steam 'steamapps\appmanifest_730.acf'), "`"installdir`" `"..\\..\\evil`"")
        $n = Get-Cs2InstallDirName $steam (Get-Cs2Config)
        Assert-Equal $n 'Counter-Strike Global Offensive' 'falls back to the default folder'
    }
    It 'reports not found when Steam or the game is missing, and never throws' {
        $r = Find-Cs2Install
        Assert-Equal $r.found $false 'no Steam at all'
        $steam = Join-Path $script:CsTemp 'Steam'; New-Item -ItemType Directory -Force (Join-Path $steam 'steamapps') | Out-Null
        Set-CsSteamPath $steam
        Assert-Equal (Find-Cs2Install).found $false 'Steam without the game'
        Assert-Equal (Get-Cs2Overview '').found $false 'overview of a missing game'
    }

    # ------------------------------------------------------------ path validation
    It 'accepts a real cs2.exe path and rejects traversal, wrong names, relative and wildcard paths' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        $ok = Resolve-Cs2Exe $exe -MustExist
        Assert-Equal $ok.ok $true 'valid'
        Assert-Equal (Resolve-Cs2Exe ($exe.ToUpper())).ok $true 'case does not matter for the name'
        foreach ($case in @(
            @('', 'msg.cs2.badExe'), @('cs2.exe', 'msg.cs2.badPath'), @('..\cs2.exe', 'msg.cs2.badPath'),
            @('C:\a\..\b\game\bin\win64\cs2.exe', 'msg.cs2.badPath'), @('C:\a\game\bin\win64\..\win64\cs2.exe', 'msg.cs2.badPath'),
            @('\\server\share\game\bin\win64\cs2.exe', 'msg.cs2.badPath'), @('C:\a\g*me\bin\win64\cs2.exe', 'msg.cs2.badPath'),
            @('C:\a\[x]\bin\win64\cs2.exe', 'msg.cs2.badPath'), @('C:\a\game\bin\win64\csgo.exe', 'msg.cs2.notCs2'),
            @('C:\a\game\bin\win64\cs2.exe.bat', 'msg.cs2.notCs2'))) {
            $r = Resolve-Cs2Exe $case[0]
            if ($r.ok) { throw "should be rejected: $($case[0])" }
            Assert-Equal $r.code $case[1] "code for '$($case[0])'"
        }
        $missing = Resolve-Cs2Exe 'C:\definitely\not\here\game\bin\win64\cs2.exe' -MustExist
        Assert-Equal $missing.code 'msg.cs2.badExe' 'a missing file'
    }
    It 'finds the cfg folder only for the game\bin\win64 layout and never creates it' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        $cfg = Get-Cs2CfgDir $exe
        if ($cfg -notlike '*game\csgo\cfg') { throw "unexpected cfg dir $cfg" }
        Assert-Equal (Get-Cs2CfgDir 'C:\Tools\cs2.exe') $null 'no layout, no cfg dir'
        Assert-Equal (Get-Cs2CfgDir 'C:\x\game\bin\x64\cs2.exe') $null 'wrong folder name'
        $lonely = Join-Path $script:CsTemp 'Other\game\bin\win64'; New-Item -ItemType Directory -Force $lonely | Out-Null
        Set-Content (Join-Path $lonely 'cs2.exe') 'x'
        $r = Write-Cs2Autoexec (Join-Path $lonely 'cs2.exe') @('showfps') $null
        Assert-Equal $r.code 'msg.cs2.noCfgDir' 'a missing cfg folder is not created'
        if (Test-Path -LiteralPath (Join-Path $script:CsTemp 'Other\game\csgo')) { throw 'the csgo folder must not be created' }
    }

    # ------------------------------------------------------------ GPU preference
    It 'applies High performance when there was no entry and revert removes the value again' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Assert-Equal (Get-Cs2GpuStatus $exe).entry $false 'no entry yet'
        $r = Set-Cs2GpuPreference $exe $true
        Assert-Equal $r.ok $true 'apply ok'
        Assert-Equal $r.code 'msg.cs2.gpuApplied' 'code'
        Assert-Equal (Get-CsGpuData $exe) 'GpuPreference=2;' 'data written'
        $st = Get-Cs2GpuStatus $exe
        Assert-Equal $st.high $true 'high'; Assert-Equal $st.recorded $true 'recorded'
        $r = Set-Cs2GpuPreference $exe $false
        Assert-Equal $r.ok $true 'revert ok'
        Assert-Equal (Get-CsGpuData $exe) $null 'the value is gone, as it did not exist before'
        Assert-Equal (Get-Cs2GpuStatus $exe).recorded $false 'record removed'
    }
    It 'keeps the other fields and restores the exact previous data on revert' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Set-CsGpuData $exe 'AppStatus=0;AutoHDREnable=2097;'
        Assert-Equal (Get-Cs2GpuStatus $exe).pref $null 'no GpuPreference field yet'
        Set-Cs2GpuPreference $exe $true | Out-Null
        Assert-Equal (Get-CsGpuData $exe) 'AppStatus=0;AutoHDREnable=2097;GpuPreference=2;' 'other fields kept'
        Set-Cs2GpuPreference $exe $false | Out-Null
        Assert-Equal (Get-CsGpuData $exe) 'AppStatus=0;AutoHDREnable=2097;' 'exactly the previous data'
    }
    It 'replaces an existing GpuPreference=1 and brings it back' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Set-CsGpuData $exe 'GpuPreference=1;'
        Set-Cs2GpuPreference $exe $true | Out-Null
        Assert-Equal (Get-CsGpuData $exe) 'GpuPreference=2;' 'replaced'
        Set-Cs2GpuPreference $exe $false | Out-Null
        Assert-Equal (Get-CsGpuData $exe) 'GpuPreference=1;' 'power saving is back'
    }
    It 'applying twice keeps the ORIGINAL previous value' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Set-CsGpuData $exe 'GpuPreference=1;'
        Set-Cs2GpuPreference $exe $true | Out-Null
        $again = Set-Cs2GpuPreference $exe $true
        Assert-Equal $again.code 'msg.cs2.gpuAlready' 'second apply is a no-op'
        Set-Cs2GpuPreference $exe $false | Out-Null
        Assert-Equal (Get-CsGpuData $exe) 'GpuPreference=1;' 'original restored'
    }
    It 'a preference somebody else set is left alone and cannot be reverted by us' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Set-CsGpuData $exe 'GpuPreference=2;'
        $r = Set-Cs2GpuPreference $exe $true
        Assert-Equal $r.code 'msg.cs2.gpuAlreadyYours' 'nothing changed'
        Assert-Equal (Get-Cs2GpuStatus $exe).recorded $false 'nothing recorded'
        $v = Set-Cs2GpuPreference $exe $false
        Assert-Equal $v.ok $false 'revert refused'
        Assert-Equal $v.code 'msg.cs2.gpuNotOurs' 'code'
        Assert-Equal (Get-CsGpuData $exe) 'GpuPreference=2;' 'still there'
    }
    It 'touches only the value for this exe, and keeps the tweak records in the shared state file' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Set-CsGpuData 'C:\Other\game.exe' 'GpuPreference=1;'
        Save-TweakState ([pscustomobject]@{ version = 1; tweaks = [pscustomobject]@{ 'game-mode' = [pscustomobject]@{ appliedAt = 'x'; previous = @() } } })
        Set-Cs2GpuPreference $exe $true | Out-Null
        Assert-Equal (Get-CsGpuData 'C:\Other\game.exe') 'GpuPreference=1;' 'other app untouched'
        $s = Get-TweakState
        if (-not $s.tweaks.PSObject.Properties['game-mode']) { throw 'the tweak record was lost' }
        if (-not $s.cs2) { throw 'the cs2 section is missing' }
        Set-Cs2GpuPreference $exe $false | Out-Null
        if (-not (Get-TweakState).tweaks.PSObject.Properties['game-mode']) { throw 'the tweak record was lost on revert' }
    }
    It 'refuses a bad path for the GPU preference and writes nothing' {
        $r = Set-Cs2GpuPreference 'C:\a\..\b\cs2.exe' $true
        Assert-Equal $r.ok $false 'rejected'
        Assert-Equal $r.code 'msg.cs2.badPath' 'code'
        $r = Set-Cs2GpuPreference 'C:\not\there\game\bin\win64\cs2.exe' $true
        Assert-Equal $r.code 'msg.cs2.badExe' 'a missing exe cannot get a preference'
        if (Test-Path -LiteralPath (Join-Path $script:CsKey 'Software\Microsoft\DirectX')) { throw 'the registry must not have been touched' }
    }
    It 'can still revert after the game was uninstalled' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        Set-Cs2GpuPreference $exe $true | Out-Null
        Remove-Item (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $exe)))) -Recurse -Force
        $r = Set-Cs2GpuPreference $exe $false
        Assert-Equal $r.ok $true 'revert ok without the file'
        Assert-Equal (Get-CsGpuData $exe) $null 'value gone'
    }

    # ------------------------------------------------------------ autoexec text
    It 'builds the file text with the marker, the chosen lines and their comments' {
        $t = New-Cs2AutoexecText @('showfps', 'fpsmax') '144'
        if (-not $t.StartsWith('// Written by KafkaBoost')) { throw 'marker must be the first line' }
        if ($t -notmatch '(?m)^cl_showfps 1\r?$') { throw 'showfps line' }
        if ($t -notmatch '(?m)^fps_max 144\r?$') { throw 'fps_max line' }
        if ($t -notmatch 'SUGGESTION') { throw 'must say these are suggestions' }
        if ($t -match '(?i)\bFPS gain|boost your fps|more fps than') { throw 'no FPS promises' }
        Assert-Equal ((New-Cs2AutoexecText @('showfps') $null) -match 'fps_max') $false 'only the chosen options'
    }
    It 'rejects unknown ids, missing or out-of-range numbers and an empty choice' {
        foreach ($case in @(@(@('bogus'), $null), @(@('fpsmax'), $null), @(@('fpsmax'), '5'), @(@('fpsmax'), '5000'), @(@('fpsmax'), 'abc'), @(@('fpsmax'), '100; quit'), @(@(), $null))) {
            $threw = $false
            try { New-Cs2AutoexecText $case[0] $case[1] | Out-Null } catch { $threw = $true }
            if (-not $threw) { throw "should throw for $($case[0]) / $($case[1])" }
        }
    }

    # ------------------------------------------------------------ autoexec file
    It 'writes with no original file: no backup, no BOM, only autoexec.cfg is added' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        $before = @(Get-ChildItem $cfg | ForEach-Object { $_.Name })
        $r = Write-Cs2Autoexec $exe @('showfps') $null
        Assert-Equal $r.ok $true 'ok'; Assert-Equal $r.code 'msg.cs2.autoexecWritten' 'code'
        $after = @(Get-ChildItem $cfg | ForEach-Object { $_.Name })
        Assert-Equal (($after | Where-Object { $before -notcontains $_ }) -join ',') 'autoexec.cfg' 'only autoexec.cfg is new (no leftover temp file)'
        $bytes = [IO.File]::ReadAllBytes((Join-Path $cfg 'autoexec.cfg'))
        if ($bytes[0] -eq 0xEF) { throw 'the file must not start with a BOM' }
        Assert-Equal (Read-CsFile (Join-Path $cfg 'gamemode.cfg')).Trim() 'untouched' 'other cfg files untouched'
        $st = Get-Cs2AutoexecStatus $exe
        Assert-Equal $st.ours $true 'ours'; Assert-Equal $st.backups 0 'no backup'
    }
    It 'backs up an existing autoexec.cfg with a timestamped .bak and restore puts it back byte for byte' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        $orig = "// my own config`r`nbind `"x`" `"say hi`"`r`n"
        [IO.File]::WriteAllText((Join-Path $cfg 'autoexec.cfg'), $orig)
        Assert-Equal (Get-Cs2AutoexecStatus $exe).foreign $true 'foreign file detected'
        $r = Write-Cs2Autoexec $exe @('showfps', 'fpsmax') '120'
        Assert-Equal $r.code 'msg.cs2.autoexecWrittenBackup' 'code'
        if ($r.args.backup -notmatch '^autoexec\.cfg\.bak_\d{8}_\d{6}') { throw "bad backup name $($r.args.backup)" }
        Assert-Equal (Read-CsFile (Join-Path $cfg $r.args.backup)) $orig 'the backup is the original'
        if ((Read-CsFile (Join-Path $cfg 'autoexec.cfg')) -notmatch 'Written by KafkaBoost') { throw 'new file has the marker' }
        $v = Restore-Cs2Autoexec $exe
        Assert-Equal $v.code 'msg.cs2.autoexecRestored' 'restore code'
        Assert-Equal (Read-CsFile (Join-Path $cfg 'autoexec.cfg')) $orig 'original is back'
    }
    It 'writing twice then restoring still gives the user''s original' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        [IO.File]::WriteAllText((Join-Path $cfg 'autoexec.cfg'), "// original`r`n")
        Write-Cs2Autoexec $exe @('showfps') $null | Out-Null
        Write-Cs2Autoexec $exe @('showfps', 'fpsmax') '200' | Out-Null
        Assert-Equal (Get-Cs2AutoexecStatus $exe).backups 2 'two backups, the second one is our first file'
        Restore-Cs2Autoexec $exe | Out-Null
        Assert-Equal (Read-CsFile (Join-Path $cfg 'autoexec.cfg')) "// original`r`n" 'the original, not our first file'
    }
    It 'removes our file on restore when there was no original, but only while it carries the marker' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        Write-Cs2Autoexec $exe @('showfps') $null | Out-Null
        $r = Restore-Cs2Autoexec $exe
        Assert-Equal $r.code 'msg.cs2.autoexecRemoved' 'removed'
        if (Test-Path -LiteralPath (Join-Path $cfg 'autoexec.cfg')) { throw 'file should be gone' }
        Assert-Equal (Restore-Cs2Autoexec $exe).code 'msg.cs2.autoexecNothing' 'a second restore has nothing to do'
        # the user replaced our file with their own (no marker): it must survive
        Write-Cs2Autoexec $exe @('showfps') $null | Out-Null
        [IO.File]::WriteAllText((Join-Path $cfg 'autoexec.cfg'), "// mine now`r`n")
        $r = Restore-Cs2Autoexec $exe
        Assert-Equal $r.ok $false 'refused'; Assert-Equal $r.code 'msg.cs2.autoexecNotOurs' 'code'
        Assert-Equal (Read-CsFile (Join-Path $cfg 'autoexec.cfg')) "// mine now`r`n" 'untouched'
    }
    It 'does not restore over a user file even when old backups exist' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        [IO.File]::WriteAllText((Join-Path $cfg 'autoexec.cfg'), "// first`r`n")
        Write-Cs2Autoexec $exe @('showfps') $null | Out-Null
        [IO.File]::WriteAllText((Join-Path $cfg 'autoexec.cfg'), "// edited by hand, marker removed`r`n")
        $r = Restore-Cs2Autoexec $exe
        Assert-Equal $r.code 'msg.cs2.autoexecNotOurs' 'left alone'
        Assert-Equal (Read-CsFile (Join-Path $cfg 'autoexec.cfg')) "// edited by hand, marker removed`r`n" 'content kept'
    }
    It 'rejects bad options before touching anything' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        [IO.File]::WriteAllText((Join-Path $cfg 'autoexec.cfg'), "// keep`r`n")
        $r = Write-Cs2Autoexec $exe @('showfps', 'rm -rf') $null
        Assert-Equal $r.code 'msg.cs2.badOptions' 'code'
        Assert-Equal @(Get-ChildItem $cfg -Filter 'autoexec*').Count 1 'no backup, no temp file'
        Assert-Equal (Read-CsFile (Join-Path $cfg 'autoexec.cfg')) "// keep`r`n" 'original untouched'
    }
    It 'rejects traversal and wrong names for the autoexec and writes nothing outside the cfg folder' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        $evil = $exe.Replace('\win64\', '\win64\..\win64\')
        Assert-Equal (Write-Cs2Autoexec $evil @('showfps') $null).code 'msg.cs2.badPath' 'dot-dot in the path'
        $other = Join-Path (Split-Path -Parent $exe) 'csgo.exe'; Set-Content $other 'x'
        Assert-Equal (Write-Cs2Autoexec $other @('showfps') $null).code 'msg.cs2.notCs2' 'wrong file name'
        Assert-Equal (Restore-Cs2Autoexec 'C:\x\..\y\cs2.exe').code 'msg.cs2.badPath' 'restore with traversal'
        $files = @(Get-ChildItem $script:CsTemp -Recurse -File | Where-Object { $_.Name -like 'autoexec*' })
        Assert-Equal $files.Count 0 'nothing was written anywhere'
    }
    It 'will not write through a junction in place of the cfg folder' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib'); $cfg = Get-Cs2CfgDir $exe
        $outside = Join-Path $script:CsTemp 'outside'; New-Item -ItemType Directory $outside | Out-Null
        Remove-Item -LiteralPath $cfg -Recurse -Force
        cmd /c mklink /J "$cfg" "$outside" | Out-Null
        $r = Write-Cs2Autoexec $exe @('showfps') $null
        Assert-Equal $r.ok $false 'refused'
        Assert-Equal @(Get-ChildItem $outside).Count 0 'nothing landed outside'
        cmd /c rmdir "$cfg" | Out-Null
    }

    # ------------------------------------------------------------ overview for the screen
    It 'the overview uses a valid user-picked exe, and falls back to detection when it is gone' {
        $exe = New-CsGame (Join-Path $script:CsTemp 'Lib')
        $o = Get-Cs2Overview $exe
        Assert-Equal $o.found $true 'found'; Assert-Equal $o.source 'user' 'source'; Assert-Equal $o.userExeInvalid $false 'valid'
        Assert-Equal $o.gpu.high $false 'gpu not set'; Assert-Equal $o.autoexec.available $true 'autoexec available'
        if ($o.cfgDir -notlike '*game\csgo\cfg') { throw 'cfg dir' }
        if (@($o.catalog.launch).Count -lt 3) { throw 'catalog is part of the overview' }
        $gone = Get-Cs2Overview 'C:\gone\game\bin\win64\cs2.exe'
        Assert-Equal $gone.found $false 'nothing to fall back to'; Assert-Equal $gone.userExeInvalid $true 'flagged'
    }
}
