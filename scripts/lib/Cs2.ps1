# Counter-Strike 2 preset: (1) the Windows "Graphics settings" GPU preference for cs2.exe, (2) an optional autoexec.cfg, (3) optional tuning of
# cs2_video.txt (resolution, refresh rate), (4) the data for the launch-options helper (the app only shows and copies a string; Steam's
# localconfig.vdf is never touched).
# Dot-source AFTER lib\Tuning.ps1 and lib\Tweaks.ps1 (it reuses Read-RegValue / Write-RegValue / Remove-RegValueIfPresent and the state file).
#
# Rules
#   * Detecting CS2 is read-only: HKCU\Software\Valve\Steam (SteamPath), steamapps\libraryfolders.vdf and appmanifest_730.acf. Nothing is written.
#   * GPU preference = HKCU\Software\Microsoft\DirectX\UserGpuPreferences, value name = the full exe path, data "GpuPreference=2;" (what the
#     Settings > Graphics page writes for "High performance"). The PREVIOUS data is recorded in the tweak state file (section "cs2"), so
#     revert puts back exactly what was there, or removes the value when there was none. Other fields in the same data are kept.
#     A value KafkaBoost did not write (no record) is never reverted by us.
#   * The only two game files we write are autoexec.cfg (inside <game>\csgo\cfg) and cs2_video.txt (inside Steam's userdata for the active
#     Steam account, <steam>\userdata\<steamid32>\730\local\cfg). Both: an existing file is copied first to <name>.bak_<timestamp>; restore
#     acts only when the current file carries our marker line (or is missing); a file the user wrote or edited without the marker is never
#     overwritten or deleted. cs2_video.txt is never fully rewritten: only the specific keys the user chose (resolution, refresh rate) are
#     changed, everything else in the file (shadows, textures, AA, ...) is left exactly as it was. No other file in either location is
#     read, written or removed, and Steam's localconfig.vdf is never touched by any of this.
#   * Tests redirect $script:RegMap (registry), $script:TweakStatePath (state) and use temp folders for Steam and the game.

$script:Cs2ConfigPath = $null          # default: <repo>\config\cs2.json
$script:Cs2GpuKey = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
$script:Cs2BadPathChars = '[\[\]\*\?<>\|"]'

function Get-Cs2Config([string]$Path) {
    if (-not $Path) { $Path = $script:Cs2ConfigPath }
    if (-not $Path) { $Path = Join-Path $PSScriptRoot '..\..\config\cs2.json' }
    return ([IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path, [Text.Encoding]::UTF8) | ConvertFrom-Json)
}

function New-Cs2Result([bool]$Ok, [string]$Code, [string]$Message, $Data = $null, $CArgs = $null) {
    [pscustomobject]@{ ok = $Ok; code = $Code; message = $Message; args = $(if ($CArgs) { $CArgs } else { @{} }); data = $Data }
}

# ---------------------------------------------------------------- detection (read-only)

# Library folders from a libraryfolders.vdf text: the new format ("path" "D:\\Lib") and the old one ("1" "D:\\Lib"). Drive paths only.
function ConvertFrom-LibraryFolders([string]$Text) {
    $out = @()
    if (-not $Text) { return $out }
    foreach ($m in [regex]::Matches($Text, '(?i)"(?:path|\d+)"\s+"([^"]+)"')) {
        $p = $m.Groups[1].Value.Replace('\\', '\').Replace('/', '\')
        if ($p -match '^[A-Za-z]:\\') { $out += $p.TrimEnd('\') }
    }
    return $out
}

function Get-SteamRoots {
    $roots = @()
    $a = Read-RegValue 'HKCU:\Software\Valve\Steam' 'SteamPath'
    if ($a.exists -and $a.value) { $roots += ([string]$a.value).Replace('/', '\').TrimEnd('\') }
    $b = Read-RegValue 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' 'InstallPath'
    if ($b.exists -and $b.value) { $roots += ([string]$b.value).Replace('/', '\').TrimEnd('\') }
    return @($roots | Where-Object { $_ -match '^[A-Za-z]:\\' -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique)
}

function Get-SteamLibraries([string[]]$Roots) {
    $libs = @()
    foreach ($r in $Roots) {
        $libs += $r
        $vdf = Join-Path $r 'steamapps\libraryfolders.vdf'
        if ((Test-Path -LiteralPath $vdf -PathType Leaf) -and ((Get-Item -LiteralPath $vdf).Length -lt 1MB)) {
            $libs += ConvertFrom-LibraryFolders ([IO.File]::ReadAllText($vdf))
        }
    }
    $seen = @{}; $res = @()
    foreach ($l in $libs) { $k = $l.ToLowerInvariant(); if (-not $seen.ContainsKey($k) -and (Test-Path -LiteralPath $l -PathType Container)) { $seen[$k] = 1; $res += $l } }
    return $res
}

function ConvertTo-Cs2SteamId32([string]$Steam64) {
    try { $n = [uint64]$Steam64; if ($n -lt 76561197960265728) { return $null }; return [string]($n - [uint64]76561197960265728) } catch { return $null }
}

# The Steam32 id of the account currently signed in to Steam, read-only. Tries the running client's registry value first
# (set only while Steam is open), then falls back to the most-recently-used entry in config\loginusers.vdf. $null if neither is found.
function Get-Cs2SteamId32([string[]]$Roots) {
    $active = Read-RegValue 'HKCU:\Software\Valve\Steam\ActiveProcess' 'ActiveUser'
    if ($active.exists -and $active.value -and [int64]$active.value -gt 0) { return [string][int64]$active.value }
    foreach ($r in $Roots) {
        $vdf = Join-Path $r 'config\loginusers.vdf'
        if ((Test-Path -LiteralPath $vdf -PathType Leaf) -and ((Get-Item -LiteralPath $vdf).Length -lt 1MB)) {
            $text = [IO.File]::ReadAllText($vdf)
            foreach ($m in [regex]::Matches($text, '(?is)"(7656\d{13})"\s*\{(.*?)\}')) {
                if ($m.Groups[2].Value -match '"MostRecent"\s+"1"') { $id32 = ConvertTo-Cs2SteamId32 $m.Groups[1].Value; if ($id32) { return $id32 } }
            }
        }
    }
    return $null
}

function Get-Cs2InstallDirName([string]$Library, $Cfg) {
    $name = $Cfg.defaultFolder
    $acf = Join-Path $Library "steamapps\appmanifest_$($Cfg.steamAppId).acf"
    if ((Test-Path -LiteralPath $acf -PathType Leaf) -and ((Get-Item -LiteralPath $acf).Length -lt 1MB)) {
        $m = [regex]::Match([IO.File]::ReadAllText($acf), '(?im)^\s*"installdir"\s+"([^"]+)"')
        if ($m.Success -and $m.Groups[1].Value -match '^[^\\/:*?"<>|]+$' -and $m.Groups[1].Value -ne '..' -and $m.Groups[1].Value -ne '.') { $name = $m.Groups[1].Value }
    }
    return $name
}

# Finds cs2.exe through Steam. Several libraries are all searched; the first hit wins and the rest are listed.
function Find-Cs2Install {
    $cfg = Get-Cs2Config
    $roots = @(Get-SteamRoots)
    $libs = @(Get-SteamLibraries $roots)
    $hits = @()
    foreach ($l in $libs) {
        $exe = Join-Path $l ("steamapps\common\" + (Get-Cs2InstallDirName $l $cfg) + "\game\bin\win64\" + $cfg.exeName)
        if (Test-Path -LiteralPath $exe -PathType Leaf) { $hits += $exe }
    }
    return [pscustomobject]@{
        found = ($hits.Count -gt 0); exe = $(if ($hits.Count) { $hits[0] } else { $null }); others = @($hits | Select-Object -Skip 1)
        steamPath = $(if ($roots.Count) { $roots[0] } else { $null }); libraries = $libs; source = 'steam'
    }
}

# ---------------------------------------------------------------- path validation

# Returns { ok; exe; code; message }. The exe must be a drive path without ".." segments, named cs2.exe, with no wildcard characters.
function Resolve-Cs2Exe([string]$Exe, [switch]$MustExist) {
    $bad = { param($c, $m) [pscustomobject]@{ ok = $false; exe = $null; code = $c; message = $m } }
    if (-not $Exe -or $Exe.Length -gt 260) { return (& $bad 'msg.cs2.badExe' 'Choose the cs2.exe file.') }
    $p = $Exe.Trim().Replace('/', '\')
    if (@($p -split '\\' | Where-Object { $_ -eq '..' -or $_ -eq '.' }).Count) { return (& $bad 'msg.cs2.badPath' 'The path may not contain "." or ".." parts.') }
    if ($p -notmatch '^[A-Za-z]:\\') { return (& $bad 'msg.cs2.badPath' 'Use a full path on a drive (for example C:\...\cs2.exe).') }
    if ($p -match $script:Cs2BadPathChars) { return (& $bad 'msg.cs2.badPath' 'The path contains characters that Windows paths should not have here.') }
    $full = [IO.Path]::GetFullPath($p)
    $cfg = Get-Cs2Config
    if ([IO.Path]::GetFileName($full) -ine $cfg.exeName) { return (& $bad 'msg.cs2.notCs2' 'The file must be named cs2.exe.') }
    if ($MustExist -and -not (Test-Path -LiteralPath $full -PathType Leaf)) { return (& $bad 'msg.cs2.badExe' 'That cs2.exe does not exist.') }
    return [pscustomobject]@{ ok = $true; exe = $full; code = $null; message = '' }
}

# <game>\csgo\cfg for an exe in <game>\bin\win64, or $null when the exe is not in that layout. It is never created.
function Get-Cs2CfgDir([string]$Exe) {
    $win64 = Split-Path -Parent $Exe
    $bin = Split-Path -Parent $win64
    $game = Split-Path -Parent $bin
    if (-not $win64 -or -not $bin -or -not $game) { return $null }
    if ((Split-Path -Leaf $win64) -ne 'win64' -or (Split-Path -Leaf $bin) -ne 'bin' -or (Split-Path -Leaf $game) -ne 'game') { return $null }
    return (Join-Path $game 'csgo\cfg')
}

function Test-ReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    return [bool]((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# ---------------------------------------------------------------- GPU preference

function Get-GpuPrefField([string]$Data) {
    if ($Data) { $m = [regex]::Match($Data, '(?i)(?:^|;)\s*GpuPreference=(\d+)\s*;'); if ($m.Success) { return [int]$m.Groups[1].Value } }
    return $null
}

# Same data with GpuPreference set to $Pref; every other field stays as it was.
function Set-GpuPrefField([string]$Data, [int]$Pref) {
    if (-not $Data) { return "GpuPreference=$Pref;" }
    if ($null -ne (Get-GpuPrefField $Data)) { return ([regex]'(?i)(^|;)(\s*)GpuPreference=\d+\s*;').Replace($Data, ('${1}${2}GpuPreference=' + $Pref + ';'), 1) }
    $d = $Data; if (-not $d.EndsWith(';')) { $d += ';' }
    return $d + "GpuPreference=$Pref;"
}

function Get-Cs2StateObject {
    $s = Get-TweakState
    if (-not $s.PSObject.Properties['cs2']) { $s | Add-Member -NotePropertyName cs2 -NotePropertyValue ([pscustomobject]@{ gpu = [pscustomobject]@{} }) }
    if (-not $s.cs2.PSObject.Properties['gpu']) { $s.cs2 | Add-Member -NotePropertyName gpu -NotePropertyValue ([pscustomobject]@{}) }
    return $s
}
function Get-Cs2GpuRecord($State, [string]$Exe) {
    $p = $State.cs2.gpu.PSObject.Properties[$Exe.ToLowerInvariant()]
    if ($p) { return $p.Value }
    return $null
}
function Set-Cs2GpuRecord($State, [string]$Exe, $Rec) {
    $k = $Exe.ToLowerInvariant()
    if ($State.cs2.gpu.PSObject.Properties[$k]) { $State.cs2.gpu.PSObject.Properties.Remove($k) }
    if ($Rec) { $State.cs2.gpu | Add-Member -NotePropertyName $k -NotePropertyValue $Rec }
}

# pref: $null (no entry or no field) | 0 Windows decides | 1 power saving | 2 high performance. recorded = KafkaBoost wrote it and can revert it.
function Get-Cs2GpuStatus([string]$Exe) {
    $cur = Read-RegValue $script:Cs2GpuKey $Exe
    $pref = if ($cur.exists) { Get-GpuPrefField ([string]$cur.value) } else { $null }
    $rec = Get-Cs2GpuRecord (Get-Cs2StateObject) $Exe
    [pscustomobject]@{ pref = $pref; high = ($pref -eq 2); entry = $cur.exists; recorded = [bool]$rec; data = $(if ($cur.exists) { [string]$cur.value } else { $null }) }
}

function Set-Cs2GpuPreference([string]$Exe, [bool]$Enable) {
    $r = Resolve-Cs2Exe $Exe -MustExist:$Enable
    if (-not $r.ok) { return (New-Cs2Result $false $r.code $r.message) }
    $exe = $r.exe
    $state = Get-Cs2StateObject
    $rec = Get-Cs2GpuRecord $state $exe
    try {
        if ($Enable) {
            $prev = Read-RegValue $script:Cs2GpuKey $exe
            if ($rec -and (Get-GpuPrefField ([string]$prev.value)) -eq 2) { return (New-Cs2Result $true 'msg.cs2.gpuAlready' 'High performance is already set for cs2.exe.' (Get-Cs2GpuStatus $exe)) }
            if ((Get-GpuPrefField ([string]$prev.value)) -eq 2) { return (New-Cs2Result $true 'msg.cs2.gpuAlreadyYours' 'High performance was already set for cs2.exe (not by KafkaBoost), so nothing was changed.' (Get-Cs2GpuStatus $exe)) }
            $newData = Set-GpuPrefField $(if ($prev.exists) { [string]$prev.value } else { '' }) 2
            Write-RegValue $script:Cs2GpuKey $exe $newData 'String'
            try {
                # keep the FIRST recorded previous state if an older record exists (a second apply must not overwrite the original)
                $entry = if ($rec) { $rec } else { [pscustomobject]@{ appliedAt = (Get-Date).ToString('s'); exe = $exe; previous = [pscustomobject]@{ exists = $prev.exists; value = $prev.value; kind = $prev.kind } } }
                Set-Cs2GpuRecord $state $exe $entry
                Save-TweakState $state
            } catch {
                if ($prev.exists) { Write-RegValue $script:Cs2GpuKey $exe $prev.value $prev.kind } else { Remove-RegValueIfPresent $script:Cs2GpuKey $exe }
                throw
            }
            return (New-Cs2Result $true 'msg.cs2.gpuApplied' 'cs2.exe now prefers the high-performance GPU.' (Get-Cs2GpuStatus $exe))
        }
        if (-not $rec) { return (New-Cs2Result $false 'msg.cs2.gpuNotOurs' 'KafkaBoost did not set this preference, so it will not remove it. Change it in Windows Settings > System > Display > Graphics.' (Get-Cs2GpuStatus $exe)) }
        $p = $rec.previous
        if ($p -and $p.exists) { Write-RegValue $script:Cs2GpuKey $exe $p.value $p.kind } else { Remove-RegValueIfPresent $script:Cs2GpuKey $exe }
        Set-Cs2GpuRecord $state $exe $null
        Save-TweakState $state
        return (New-Cs2Result $true 'msg.cs2.gpuReverted' 'The previous GPU preference for cs2.exe was put back.' (Get-Cs2GpuStatus $exe))
    } catch {
        return (New-Cs2Result $false 'msg.cs2.failed' $_.Exception.Message $null @{ detail = $_.Exception.Message })
    }
}

# ---------------------------------------------------------------- autoexec.cfg

$script:Cs2AutoexecName = 'autoexec.cfg'
$script:Cs2BackupPattern = '^autoexec\.cfg\.bak_\d{8}_\d{6}(_\d+)?$'

function Test-AutoexecMarker([string]$Path, $Cfg) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -gt 1MB) { return $false }
    foreach ($line in [IO.File]::ReadAllLines($Path)) { if ($line.StartsWith($Cfg.autoexecMarker)) { return $true } }
    return $false
}

# Text of the file for the chosen option ids. Unknown ids and out-of-range values are errors, never written.
function New-Cs2AutoexecText([string[]]$Ids, $FpsMax, $Cfg) {
    if (-not $Cfg) { $Cfg = Get-Cs2Config }
    $lines = @(
        "$($Cfg.autoexecMarker) on $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))",
        '// Everything below is a SUGGESTION. Edit or delete any line. Nothing here is a promise of more FPS.',
        '// To go back: use "Restore previous" in KafkaBoost (it puts your old autoexec.cfg back), or delete this file.',
        ''
    )
    $n = 0
    foreach ($id in @($Ids | Where-Object { $_ })) {
        $o = $Cfg.autoexec | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if (-not $o) { throw "Unknown autoexec option: $id" }
        $line = $o.line
        if ($o.PSObject.Properties['param'] -and $o.param) {
            $v = 0
            if ($null -eq $FpsMax -or "$FpsMax" -notmatch '^\d{1,4}$' -or -not [int]::TryParse("$FpsMax", [ref]$v)) { throw "Option $id needs a whole number." }
            if ($v -lt [int]$o.param.min -or $v -gt [int]$o.param.max) { throw "Option $id needs a number between $($o.param.min) and $($o.param.max)." }
            $line = $line.Replace('{' + $o.param.name + '}', "$v")
        }
        $lines += "// $($o.comment)"; $lines += $line; $lines += ''; $n++
    }
    if (-not $n) { throw 'Choose at least one option.' }
    return (($lines -join "`r`n"))
}

function Get-Cs2AutoexecContext([string]$Exe) {
    $r = Resolve-Cs2Exe $Exe
    if (-not $r.ok) { return @{ error = (New-Cs2Result $false $r.code $r.message) } }
    $dir = Get-Cs2CfgDir $r.exe
    if (-not $dir -or -not (Test-Path -LiteralPath $dir -PathType Container)) { return @{ error = (New-Cs2Result $false 'msg.cs2.noCfgDir' 'The game\csgo\cfg folder was not found next to that cs2.exe.') } }
    if (Test-ReparsePoint $dir) { return @{ error = (New-Cs2Result $false 'msg.cs2.noCfgDir' 'The cfg folder is a link; KafkaBoost will not write through links.') } }
    $target = Join-Path $dir $script:Cs2AutoexecName
    if (Test-ReparsePoint $target) { return @{ error = (New-Cs2Result $false 'msg.cs2.noCfgDir' 'autoexec.cfg is a link; KafkaBoost will not write through links.') } }
    return @{ exe = $r.exe; dir = $dir; target = $target }
}

function Get-Cs2Backups([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $Dir -File -Filter 'autoexec.cfg.bak_*' | Where-Object { $_.Name -match $script:Cs2BackupPattern } | Sort-Object Name -Descending)
}

function Get-Cs2AutoexecStatus([string]$Exe) {
    $c = Get-Cs2AutoexecContext $Exe
    if ($c.error) { return [pscustomobject]@{ available = $false; exists = $false; ours = $false; foreign = $false; backups = 0; hasOriginal = $false; file = $null } }
    $cfg = Get-Cs2Config
    $exists = Test-Path -LiteralPath $c.target -PathType Leaf
    $ours = $exists -and (Test-AutoexecMarker $c.target $cfg)
    $orig = @(Get-Cs2Backups $c.dir | Where-Object { -not (Test-AutoexecMarker $_.FullName $cfg) })
    [pscustomobject]@{ available = $true; exists = $exists; ours = $ours; foreign = ($exists -and -not $ours); backups = @(Get-Cs2Backups $c.dir).Count; hasOriginal = ($orig.Count -gt 0); file = $c.target }
}

function Write-Cs2Autoexec([string]$Exe, [string[]]$Ids, $FpsMax) {
    $c = Get-Cs2AutoexecContext $Exe
    if ($c.error) { return $c.error }
    try { $text = New-Cs2AutoexecText $Ids $FpsMax } catch { return (New-Cs2Result $false 'msg.cs2.badOptions' $_.Exception.Message @{ detail = $_.Exception.Message }) }
    $backup = $null
    try {
        if (Test-Path -LiteralPath $c.target -PathType Leaf) {
            $stamp = (Get-Date).ToString('yyyyMMdd_HHmmss'); $bak = Join-Path $c.dir "$($script:Cs2AutoexecName).bak_$stamp"; $i = 1
            while (Test-Path -LiteralPath $bak) { $bak = Join-Path $c.dir "$($script:Cs2AutoexecName).bak_${stamp}_$i"; $i++ }
            Copy-Item -LiteralPath $c.target -Destination $bak
            if ((Get-Item -LiteralPath $bak).Length -ne (Get-Item -LiteralPath $c.target).Length) { throw 'The backup copy does not match the original, so nothing was written.' }
            $backup = Split-Path -Leaf $bak
        }
        $tmp = Join-Path $c.dir 'autoexec.cfg.kafkaboost_tmp'
        [IO.File]::WriteAllText($tmp, $text + "`r`n", (New-Object Text.UTF8Encoding($false)))      # no BOM: the game's cfg parser would read it as part of line 1
        Move-Item -LiteralPath $tmp -Destination $c.target -Force
    } catch {
        return (New-Cs2Result $false 'msg.cs2.failed' $_.Exception.Message $null @{ detail = $_.Exception.Message })
    }
    $st = Get-Cs2AutoexecStatus $c.exe
    return (New-Cs2Result $true $(if ($backup) { 'msg.cs2.autoexecWrittenBackup' } else { 'msg.cs2.autoexecWritten' }) 'autoexec.cfg written.' $st @{ backup = $backup })
}

function Restore-Cs2Autoexec([string]$Exe) {
    $c = Get-Cs2AutoexecContext $Exe
    if ($c.error) { return $c.error }
    $cfg = Get-Cs2Config
    $exists = Test-Path -LiteralPath $c.target -PathType Leaf
    if ($exists -and -not (Test-AutoexecMarker $c.target $cfg)) {
        return (New-Cs2Result $false 'msg.cs2.autoexecNotOurs' 'The current autoexec.cfg was not written by KafkaBoost (or you removed our marker line), so it was left alone.' (Get-Cs2AutoexecStatus $c.exe))
    }
    $orig = @(Get-Cs2Backups $c.dir | Where-Object { -not (Test-AutoexecMarker $_.FullName $cfg) }) | Select-Object -First 1
    try {
        if ($orig) {
            Copy-Item -LiteralPath $orig.FullName -Destination $c.target -Force
            return (New-Cs2Result $true 'msg.cs2.autoexecRestored' 'Your previous autoexec.cfg was put back.' (Get-Cs2AutoexecStatus $c.exe) @{ backup = $orig.Name })
        }
        if ($exists) {
            Remove-Item -LiteralPath $c.target -Force
            return (New-Cs2Result $true 'msg.cs2.autoexecRemoved' 'There was no autoexec.cfg before, so the one KafkaBoost wrote was removed.' (Get-Cs2AutoexecStatus $c.exe))
        }
    } catch {
        return (New-Cs2Result $false 'msg.cs2.failed' $_.Exception.Message $null @{ detail = $_.Exception.Message })
    }
    return (New-Cs2Result $true 'msg.cs2.autoexecNothing' 'There is nothing to restore.' (Get-Cs2AutoexecStatus $c.exe))
}

# ---------------------------------------------------------------- cs2_video.txt (resolution, refresh rate)

$script:Cs2VideoName = 'cs2_video.txt'
$script:Cs2VideoBackupPattern = '^cs2_video\.txt\.bak_\d{8}_\d{6}(_\d+)?$'

# <steamRoot>\userdata\<steamid32>\730\local\cfg\cs2_video.txt for the account currently signed in to Steam. $null if no
# Steam install or no signed-in account could be found (read-only detection, same sources as Find-Cs2Install).
function Get-Cs2VideoPath($Cfg) {
    $roots = @(Get-SteamRoots)
    if (-not $roots.Count) { return $null }
    $id32 = Get-Cs2SteamId32 $roots
    if (-not $id32) { return $null }
    return (Join-Path $roots[0] "userdata\$id32\$($Cfg.steamAppId)\local\cfg\$script:Cs2VideoName")
}

function Test-VideoMarker([string]$Path, $Cfg) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -gt 1MB) { return $false }
    foreach ($line in [IO.File]::ReadAllLines($Path)) { if ($line.StartsWith($Cfg.videoMarker)) { return $true } }
    return $false
}

function Get-Cs2VideoContext {
    $cfg = Get-Cs2Config
    $target = Get-Cs2VideoPath $cfg
    if (-not $target) { return @{ error = (New-Cs2Result $false 'msg.cs2.noVideoAccount' 'No signed-in Steam account could be found, so cs2_video.txt is not available. Open Steam and sign in, then try again.') } }
    $dir = Split-Path -Parent $target
    if (Test-ReparsePoint $dir) { return @{ error = (New-Cs2Result $false 'msg.cs2.noVideoFile' 'That Steam userdata folder is a link; KafkaBoost will not write through links.') } }
    if (Test-ReparsePoint $target) { return @{ error = (New-Cs2Result $false 'msg.cs2.noVideoFile' 'cs2_video.txt is a link; KafkaBoost will not write through links.') } }
    return @{ cfg = $cfg; target = $target }
}

# Current values of our known keys, read from the file text (regex only; this file is never fully parsed as KeyValues).
function Get-Cs2VideoValues([string]$Text, $Cfg) {
    $vals = @{}
    if (-not $Text) { return $vals }
    foreach ($o in $Cfg.video) {
        $m = [regex]::Match($Text, '(?m)^\s*"' + [regex]::Escape($o.settingKey) + '"\s+"([^"]*)"')
        if ($m.Success) { $vals[$o.id] = $m.Groups[1].Value }
    }
    return $vals
}

# New text for the file: $Values is a hashtable of option id -> string value. Only the matching keys (and any "also" pair) are
# touched; everything else in $OriginalText is kept byte-for-byte. Unknown ids and out-of-range values are errors, nothing is written.
function New-Cs2VideoText([hashtable]$Values, [string]$OriginalText, $Cfg) {
    if (-not $OriginalText) { throw 'cs2_video.txt is empty.' }
    if ($OriginalText.LastIndexOf('}') -lt 0) { throw 'cs2_video.txt does not look like a valid file (no closing brace), so nothing was changed.' }
    $pairs = @()
    foreach ($id in @($Values.Keys | Where-Object { $_ })) {
        $o = $Cfg.video | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if (-not $o) { throw "Unknown video option: $id" }
        $v = 0
        $raw = "$($Values[$id])"
        if ($raw -notmatch '^\d{1,5}$' -or -not [int]::TryParse($raw, [ref]$v)) { throw "Option $id needs a whole number." }
        if ($v -lt [int]$o.param.min -or $v -gt [int]$o.param.max) { throw "Option $id needs a number between $($o.param.min) and $($o.param.max)." }
        $pairs += [pscustomobject]@{ key = $o.settingKey; value = "$v" }
        if ($o.PSObject.Properties['also']) { foreach ($extra in @($o.also)) { $pairs += [pscustomobject]@{ key = $extra.settingKey; value = "$($extra.value)" } } }
    }
    if (-not $pairs.Count) { throw 'Choose at least one option.' }
    $text = $OriginalText
    if (-not (($text -split "`r?`n") | Where-Object { $_.StartsWith($Cfg.videoMarker) })) {
        $text = "$($Cfg.videoMarker) on $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))`r`n" + $text
    }
    foreach ($p in $pairs) {
        $pattern = '(?m)^(\s*)"' + [regex]::Escape($p.key) + '"(\s+)"[^"]*"'
        if ($text -match $pattern) {
            $text = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + '"' + $p.key + '"' + $m.Groups[2].Value + '"' + $p.value + '"' }, 1)
        } else {
            $i = $text.LastIndexOf('}')
            $text = $text.Substring(0, $i) + "`t`"$($p.key)`"`t`"$($p.value)`"`r`n" + $text.Substring($i)
        }
    }
    return $text
}

function Get-Cs2VideoStatus {
    $c = Get-Cs2VideoContext
    if ($c.error) { return [pscustomobject]@{ available = $false; exists = $false; ours = $false; foreign = $false; backups = 0; hasOriginal = $false; file = $null; values = @{} } }
    $exists = Test-Path -LiteralPath $c.target -PathType Leaf
    $ours = $exists -and (Test-VideoMarker $c.target $c.cfg)
    $dir = Split-Path -Parent $c.target
    $backups = @(if (Test-Path -LiteralPath $dir -PathType Container) { Get-ChildItem -LiteralPath $dir -File -Filter 'cs2_video.txt.bak_*' | Where-Object { $_.Name -match $script:Cs2VideoBackupPattern } })
    $orig = @($backups | Where-Object { -not (Test-VideoMarker $_.FullName $c.cfg) })
    $vals = @{}
    if ($exists -and (Get-Item -LiteralPath $c.target).Length -lt 1MB) { $vals = Get-Cs2VideoValues ([IO.File]::ReadAllText($c.target)) $c.cfg }
    [pscustomobject]@{ available = $true; exists = $exists; ours = $ours; foreign = ($exists -and -not $ours); backups = $backups.Count; hasOriginal = ($orig.Count -gt 0); file = $c.target; values = $vals }
}

function Write-Cs2Video([hashtable]$Values) {
    $c = Get-Cs2VideoContext
    if ($c.error) { return $c.error }
    if (-not (Test-Path -LiteralPath $c.target -PathType Leaf)) {
        return (New-Cs2Result $false 'msg.cs2.noVideoFile' 'cs2_video.txt was not found. Start Counter-Strike 2 once and open the Video settings so it is created, then try again.')
    }
    $original = [IO.File]::ReadAllText($c.target)
    try { $text = New-Cs2VideoText $Values $original $c.cfg } catch { return (New-Cs2Result $false 'msg.cs2.badOptions' $_.Exception.Message @{ detail = $_.Exception.Message }) }
    $backup = $null
    try {
        $stamp = (Get-Date).ToString('yyyyMMdd_HHmmss'); $dir = Split-Path -Parent $c.target
        $bak = Join-Path $dir "$($script:Cs2VideoName).bak_$stamp"; $i = 1
        while (Test-Path -LiteralPath $bak) { $bak = Join-Path $dir "$($script:Cs2VideoName).bak_${stamp}_$i"; $i++ }
        Copy-Item -LiteralPath $c.target -Destination $bak
        if ((Get-Item -LiteralPath $bak).Length -ne (Get-Item -LiteralPath $c.target).Length) { throw 'The backup copy does not match the original, so nothing was written.' }
        $backup = Split-Path -Leaf $bak
        $tmp = Join-Path $dir 'cs2_video.txt.kafkaboost_tmp'
        [IO.File]::WriteAllText($tmp, $text, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $tmp -Destination $c.target -Force
    } catch {
        return (New-Cs2Result $false 'msg.cs2.failed' $_.Exception.Message $null @{ detail = $_.Exception.Message })
    }
    return (New-Cs2Result $true 'msg.cs2.videoWritten' 'cs2_video.txt updated. Your previous file was saved as {backup}.' (Get-Cs2VideoStatus) @{ backup = $backup })
}

function Restore-Cs2Video {
    $c = Get-Cs2VideoContext
    if ($c.error) { return $c.error }
    $exists = Test-Path -LiteralPath $c.target -PathType Leaf
    if ($exists -and -not (Test-VideoMarker $c.target $c.cfg)) {
        return (New-Cs2Result $false 'msg.cs2.videoNotOurs' 'The current cs2_video.txt was not written by KafkaBoost (or you removed our marker line), so it was left alone.' (Get-Cs2VideoStatus))
    }
    $dir = Split-Path -Parent $c.target
    $backups = @(if (Test-Path -LiteralPath $dir -PathType Container) { Get-ChildItem -LiteralPath $dir -File -Filter 'cs2_video.txt.bak_*' | Where-Object { $_.Name -match $script:Cs2VideoBackupPattern } | Sort-Object Name -Descending })
    $orig = @($backups | Where-Object { -not (Test-VideoMarker $_.FullName $c.cfg) }) | Select-Object -First 1
    try {
        if ($orig) {
            Copy-Item -LiteralPath $orig.FullName -Destination $c.target -Force
            return (New-Cs2Result $true 'msg.cs2.videoRestored' 'Your previous cs2_video.txt was put back.' (Get-Cs2VideoStatus) @{ backup = $orig.Name })
        }
        if ($exists) {
            Remove-Item -LiteralPath $c.target -Force
            return (New-Cs2Result $true 'msg.cs2.videoRemoved' 'There was no cs2_video.txt before, so the one KafkaBoost wrote was removed.' (Get-Cs2VideoStatus))
        }
    } catch {
        return (New-Cs2Result $false 'msg.cs2.failed' $_.Exception.Message $null @{ detail = $_.Exception.Message })
    }
    return (New-Cs2Result $true 'msg.cs2.videoNothing' 'There is nothing to restore.' (Get-Cs2VideoStatus))
}

# ---------------------------------------------------------------- overview for the screen

# Everything the CS2 screen needs in one read-only call. $UserExe (optional) is a cs2.exe the user picked; when it is no longer valid
# the automatic detection is used and userExeInvalid says so.
function Get-Cs2Overview([string]$UserExe) {
    $cfg = Get-Cs2Config
    $det = $null; $invalid = $false
    if ($UserExe) {
        $r = Resolve-Cs2Exe $UserExe -MustExist
        if ($r.ok) { $det = [pscustomobject]@{ found = $true; exe = $r.exe; others = @(); steamPath = $null; libraries = @(); source = 'user' } } else { $invalid = $true }
    }
    if (-not $det) { $det = Find-Cs2Install }
    $gpu = $null; $auto = $null; $cfgDir = $null
    if ($det.found) {
        $gpu = Get-Cs2GpuStatus $det.exe
        $auto = Get-Cs2AutoexecStatus $det.exe
        $cfgDir = Get-Cs2CfgDir $det.exe
    }
    $video = Get-Cs2VideoStatus    # independent of cs2.exe: tied to the signed-in Steam account, not the game install
    [pscustomobject]@{
        found = $det.found; source = $det.source; exe = $det.exe; others = @($det.others); steamPath = $det.steamPath; libraryCount = @($det.libraries).Count
        cfgDir = $cfgDir; userExeInvalid = $invalid; gpu = $gpu; autoexec = $auto; video = $video
        catalog = [pscustomobject]@{ autoexec = @($cfg.autoexec); launch = @($cfg.launch); video = @($cfg.video) }
    }
}
