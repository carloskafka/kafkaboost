# Disk cleanup: measures (dry run) and deletes the contents of a fixed list of well-known junk locations.
# Dot-source after Tuning.ps1 (it uses Test-Admin through Steps.ps1 only).
#
# Safety rules
#   * The targets are a fixed allow-list below; nothing comes from user input except WHICH ids to run.
#   * Only the CONTENTS of a target folder are deleted, never the folder itself, and reparse points (junctions, symlinks)
#     are not followed, so a link cannot lead the cleanup outside the target.
#   * A locked file is skipped and counted, never forced.
#   * Recycle Bin is the one irreversible target; the app asks twice and it is never selected by default.
# Tests set $script:CleanupMap (id -> folders) to sandbox folders.

$script:CleanupMap = $null

function Get-CleanupTargets {
    $windir = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
    $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { '' }
    $targets = @(
        [pscustomobject]@{ id = 'user-temp';  danger = $false; paths = @($env:TEMP); filter = '*'; service = $null }
        [pscustomobject]@{ id = 'win-temp';   danger = $false; paths = @((Join-Path $windir 'Temp')); filter = '*'; service = $null }
        [pscustomobject]@{ id = 'prefetch';   danger = $false; paths = @((Join-Path $windir 'Prefetch')); filter = '*.pf'; service = $null }
        [pscustomobject]@{ id = 'update-cache'; danger = $false; paths = @((Join-Path $windir 'SoftwareDistribution\Download')); filter = '*'; service = 'wuauserv' }
        [pscustomobject]@{ id = 'thumbnails'; danger = $false; paths = @((Join-Path $local 'Microsoft\Windows\Explorer')); filter = 'thumbcache_*.db'; service = $null }
        [pscustomobject]@{ id = 'recycle-bin'; danger = $true; paths = @(); filter = '*'; service = $null }
    )
    if ($script:CleanupMap) {
        foreach ($t in $targets) { if ($script:CleanupMap.ContainsKey($t.id)) { $t.paths = @($script:CleanupMap[$t.id]) } }
    }
    return $targets
}

# Walks a folder without following reparse points. Yields FileInfo objects whose name matches $Filter.
function Get-CleanupFiles([string]$Root, [string]$Filter) {
    if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($Root)
    while ($stack.Count) {
        $dir = $stack.Pop()
        try {
            foreach ($d in [IO.Directory]::GetDirectories($dir)) {
                $attr = [IO.File]::GetAttributes($d)
                if (-not ($attr -band [IO.FileAttributes]::ReparsePoint)) { $stack.Push($d) }
            }
            foreach ($f in [IO.Directory]::GetFiles($dir, $Filter)) {
                $attr = [IO.File]::GetAttributes($f)
                if ($attr -band [IO.FileAttributes]::ReparsePoint) { continue }
                New-Object IO.FileInfo $f
            }
        } catch { }   # unreadable folder: skip it
    }
}

# Sub-folders of $Root, never following reparse points (so a junction cannot lead outside the target).
function Get-CleanupDirs([string]$Root) {
    if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($Root)
    while ($stack.Count) {
        $dir = $stack.Pop()
        try {
            foreach ($d in [IO.Directory]::GetDirectories($dir)) {
                if ([IO.File]::GetAttributes($d) -band [IO.FileAttributes]::ReparsePoint) { continue }
                $d; $stack.Push($d)
            }
        } catch { }
    }
}

function Get-RecycleBinSize {
    try {
        $shell = New-Object -ComObject Shell.Application
        $bin = $shell.NameSpace(0xA)
        $total = [int64]0; $count = 0
        foreach ($i in $bin.Items()) { $total += [int64]$i.Size; $count++ }
        return [pscustomobject]@{ bytes = $total; files = $count }
    } catch { return [pscustomobject]@{ bytes = 0; files = 0 } }
}

# Dry run: how much each target holds. Nothing is deleted.
function Get-CleanupSizes {
    foreach ($t in (Get-CleanupTargets)) {
        $bytes = [int64]0; $files = 0
        if ($t.id -eq 'recycle-bin' -and -not $script:CleanupMap) {
            $r = Get-RecycleBinSize; $bytes = $r.bytes; $files = $r.files
        } else {
            foreach ($p in $t.paths) { foreach ($f in (Get-CleanupFiles $p $t.filter)) { $bytes += $f.Length; $files++ } }
        }
        [pscustomobject]@{ id = $t.id; danger = $t.danger; bytes = $bytes; files = $files }
    }
}

# Deletes the contents of the chosen targets. Unknown ids are ignored. Returns one result per target plus totals.
function Invoke-Cleanup([string[]]$Ids) {
    $results = @()
    foreach ($t in (Get-CleanupTargets)) {
        if ($Ids -notcontains $t.id) { continue }
        $freed = [int64]0; $deleted = 0; $skipped = 0
        if ($t.id -eq 'recycle-bin' -and -not $script:CleanupMap) {
            $before = Get-RecycleBinSize
            try { Clear-RecycleBin -Force -ErrorAction Stop; $freed = $before.bytes; $deleted = $before.files } catch { $skipped = $before.files }
        } else {
            $svcWasRunning = $false
            if ($t.service) {
                $svc = Get-Service -Name $t.service -ErrorAction SilentlyContinue
                if ($svc -and $svc.Status -eq 'Running') { $svcWasRunning = $true; Stop-Service -Name $t.service -Force -ErrorAction SilentlyContinue }
            }
            try {
                foreach ($p in $t.paths) {
                    foreach ($f in @(Get-CleanupFiles $p $t.filter)) {
                        try { $len = $f.Length; [IO.File]::Delete($f.FullName); $freed += $len; $deleted++ } catch { $skipped++ }
                    }
                    # remove sub-folders that are now empty (deepest first); the target folder itself stays
                    if ($t.filter -eq '*') {
                        foreach ($d in (@(Get-CleanupDirs $p) | Sort-Object Length -Descending)) {
                            try {
                                if ([IO.File]::GetAttributes($d) -band [IO.FileAttributes]::ReparsePoint) { continue }
                                if (-not [IO.Directory]::EnumerateFileSystemEntries($d).GetEnumerator().MoveNext()) { [IO.Directory]::Delete($d) }
                            } catch { }
                        }
                    }
                }
            } finally {
                if ($svcWasRunning) { Start-Service -Name $t.service -ErrorAction SilentlyContinue }
            }
        }
        $results += [pscustomobject]@{ id = $t.id; bytes = $freed; files = $deleted; skipped = $skipped }
    }
    return $results
}
