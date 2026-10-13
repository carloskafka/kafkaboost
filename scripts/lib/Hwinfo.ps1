# HWiNFO on demand (the Dashboard "live telemetry source" card): the Dashboard's live tiles read HWiNFO shared memory, so the app can
# fetch the official portable build, start it sensors-only and stop it again. Dot-source after Tuning.ps1 (Test-Admin) and Sensors.ps1
# (Test-SensorZip, Set-SensorsAcl).
#
# Rules
#   * HWiNFO is proprietary freeware ("FREEWARE for Non-Commercial use only" on its download page). It is never committed or bundled:
#     it is downloaded from www.hwinfo.com only after the user's explicit click, into a fresh temp folder, and unpacked to
#     %ProgramData%\LegionTuning\hwinfo\<version>. Only HWiNFO64.exe is unpacked.
#   * No pinned hash (the build changes every few weeks). Instead: the portable zip address is read from the official download page at
#     run time (and the page layout is checked, failing with a code if it changed), the zip must hold HWiNFO64.exe, and the extracted exe
#     must carry a VALID Authenticode signature whose signer is REALiX. Otherwise it is deleted and nothing is installed.
#   * HWiNFO64.exe is never started with command-line arguments (the free version shows an error). config\HWiNFO64.INI (SensorsOnly=1,
#     SensorsSM=1) is placed next to the exe BEFORE the first start. A user's own INI is never overwritten: a missing INI gets the template;
#     an INI without SensorsSM=1 is only changed on explicit consent, and a timestamped .bak is made first.
#   * Start only when no HWiNFO64 from that path is running; stop only processes whose Path is that exe (never another copy).
#   * The site's CDN may answer Invoke-WebRequest with a bot challenge page. We use curl.exe (ships with Windows), identify ourselves
#     honestly and never try to solve a challenge: a reply that is not a zip stops with msg.hwinfo.blocked and the user downloads it
#     in a browser (-ZipPath accepts that zip and applies the same checks).
# Tests set $script:HwinfoFetcher = @{ Page = { param($url) '<html>' }; File = { param($url, $out) ... } }, $script:HwinfoSignature = { param($exe) @{ status = 'Valid'; subject = 'CN=REALiX' } },
# $script:HwinfoProcesses, $script:HwinfoSharedMemory, $script:HwinfoStarter and $script:HwinfoStopper.

$script:HwinfoFetcher = $null
$script:HwinfoSignature = $null
$script:HwinfoProcesses = $null
$script:HwinfoSharedMemory = $null
$script:HwinfoStarter = $null
$script:HwinfoStopper = $null
$script:HwinfoRoot = Join-Path $env:ProgramData 'LegionTuning\hwinfo'
$script:HwinfoConfigPath = Join-Path $PSScriptRoot '..\..\config\hwinfo.json'
$script:HwinfoTemplatePath = Join-Path $PSScriptRoot '..\..\config\HWiNFO64.INI'
$script:HwinfoUserAgent = 'KafkaBoost (+https://github.com/carloskafka/legion-14900hx-throttlestop)'

function Get-HwinfoConfig { Get-Content -LiteralPath $script:HwinfoConfigPath -Raw | ConvertFrom-Json }

# A failure with a language-neutral code (Steps.ps1 reads Exception.Data['code'] / ['args']).
function New-HwinfoError([string]$Code, [string]$Message, [hashtable]$ErrorArgs = @{}) {
    $e = New-Object System.Exception $Message
    $e.Data['code'] = $Code; $e.Data['args'] = $ErrorArgs
    return $e
}

# ---- discovery ---------------------------------------------------------------------------------------------------

# The "Portable for Windows 95 and later" block of the official page: its "Version X.YY" and the first (stable) download link, which must be
# <filePrefix>hwi_<XYY>.zip and agree with the version. The beta button that follows is ignored. $null when the layout is not recognised.
function ConvertFrom-HwinfoPage([string]$Html, [string]$FilePrefix) {
    $m = [regex]::Match($Html, '(?is)<h2>\s*Portable\s*<div>\s*for Windows 95 and later.*?<sub>\s*Version\s+([0-9]+\.[0-9]+)\s*</sub>(.*?)(?=<h2>|$)')
    if (-not $m.Success) { return $null }
    $version = $m.Groups[1].Value; $block = $m.Groups[2].Value
    $cut = $block.IndexOf('btn-gray'); if ($cut -ge 0) { $block = $block.Substring(0, $cut) }
    $u = [regex]::Match($block, 'href="(' + [regex]::Escape($FilePrefix) + 'hwi_([0-9]+)\.zip)"')
    if (-not $u.Success) { return $null }
    if ($u.Groups[2].Value -ne ($version -replace '\.', '')) { return $null }
    return [pscustomobject]@{ version = $version; url = $u.Groups[1].Value }
}

function Get-HwinfoCurl { $c = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { return $c.Source }; return $null }

function Save-HwinfoUrl([string]$Url, [string]$OutFile) {
    $curl = Get-HwinfoCurl
    if ($curl) {
        & $curl -sSL --fail --max-time 300 -A $script:HwinfoUserAgent -o $OutFile $Url 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw (New-HwinfoError 'msg.hwinfo.networkFailed' "curl failed with exit code $LASTEXITCODE for $Url") }
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        try { Invoke-WebRequest -Uri $Url -UserAgent $script:HwinfoUserAgent -UseBasicParsing -OutFile $OutFile -TimeoutSec 300 | Out-Null }
        catch { throw (New-HwinfoError 'msg.hwinfo.networkFailed' $_.Exception.Message) }
    }
}

function Get-HwinfoPageHtml($Config) {
    if ($script:HwinfoFetcher) { return [string](& $script:HwinfoFetcher.Page $Config.downloadPage) }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('kb_hwinfo_page_' + [guid]::NewGuid().ToString('N') + '.html')
    try { Save-HwinfoUrl $Config.downloadPage $tmp; return [IO.File]::ReadAllText($tmp) } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

# What would be downloaded: { name; version; url; source; signer; license }. Reads only the official download page.
function Get-HwinfoRelease($Config) {
    $html = Get-HwinfoPageHtml $Config
    $r = ConvertFrom-HwinfoPage $html $Config.filePrefix
    if (-not $r) { throw (New-HwinfoError 'msg.hwinfo.pageChanged' 'The HWiNFO download page changed and the portable download was not found.') }
    return [pscustomobject]@{ name = $Config.name; version = $r.version; url = $r.url; source = $Config.downloadPage; signer = $Config.signer; license = $Config.license }
}

# ---- validation --------------------------------------------------------------------------------------------------

function Test-HwinfoZipFile([string]$Path, [string]$Exe) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $head = New-Object byte[] 4
    $fs = [IO.File]::OpenRead($Path)
    try { if ($fs.Read($head, 0, 4) -lt 4) { return $false } } finally { $fs.Dispose() }
    if ($head[0] -ne 0x50 -or $head[1] -ne 0x4B) { return $false }                  # 'PK': an HTML challenge/error page is not a zip
    return (Test-SensorZip $Path $Exe)
}

# { ok; status; signer; subject }: ok only when the signature is Valid and the signer is the expected company.
function Test-HwinfoSignature([string]$ExePath, $Config) {
    $sig = if ($script:HwinfoSignature) { & $script:HwinfoSignature $ExePath } else {
        $s = Get-AuthenticodeSignature -LiteralPath $ExePath
        @{ status = [string]$s.Status; subject = $(if ($s.SignerCertificate) { [string]$s.SignerCertificate.Subject } else { '' }) }
    }
    $subject = [string]$sig.subject
    $name = if ($subject -match 'CN="([^"]+)"') { $Matches[1] } elseif ($subject -match 'CN=([^,]+)') { $Matches[1] } else { '' }
    $ok = ([string]$sig.status -eq 'Valid') -and ($name -match [regex]::Escape([string]$Config.signer))
    return [pscustomobject]@{ ok = [bool]$ok; status = [string]$sig.status; signer = $name; subject = $subject }
}

function Get-HwinfoFileVersion([string]$ExePath) {
    try { return [string](Get-Item -LiteralPath $ExePath).VersionInfo.FileVersion } catch { return '' }
}

# ---- INI ---------------------------------------------------------------------------------------------------------

function Test-HwinfoSharedMemoryIni([string]$IniPath) {
    if (-not (Test-Path -LiteralPath $IniPath)) { return $false }
    $txt = [IO.File]::ReadAllText($IniPath, [Text.Encoding]::GetEncoding(28591))
    return [bool]($txt -match '(?im)^\s*SensorsSM\s*=\s*1\s*$')
}

# Puts HWiNFO64.INI next to the exe. Returns @{ action; backup }: copied (there was none), kept (already has SensorsSM=1), needsSharedMemory
# (the user's INI lacks it and -UpdateExisting was not given: untouched) or patched (SensorsSM=1 set after a timestamped .bak).
function Initialize-HwinfoIni([string]$Dir, [string]$Template, [switch]$UpdateExisting) {
    $ini = Join-Path $Dir 'HWiNFO64.INI'
    if (-not (Test-Path -LiteralPath $ini)) { Copy-Item -LiteralPath $Template -Destination $ini; return @{ action = 'copied'; backup = $null } }
    if (Test-HwinfoSharedMemoryIni $ini) { return @{ action = 'kept'; backup = $null } }
    if (-not $UpdateExisting) { return @{ action = 'needsSharedMemory'; backup = $null } }
    $bak = "$ini.bak_$(Get-Date -Format yyyyMMdd_HHmmss)"
    Copy-Item -LiteralPath $ini -Destination $bak
    $enc = [Text.Encoding]::GetEncoding(28591)           # byte-for-byte round trip of an ANSI file
    $txt = [IO.File]::ReadAllText($ini, $enc)
    if ($txt -match '(?im)^\s*SensorsSM\s*=') { $txt = [regex]::Replace($txt, '(?im)^(\s*SensorsSM\s*=)[^\r\n]*', '${1}1') }
    elseif ($txt -match '(?im)^\[Settings\][ \t]*\r?$') { $txt = [regex]::Replace($txt, '(?im)^(\[Settings\][ \t]*\r?\n)', "`$1SensorsSM=1`r`n", 1) }
    else { $txt = $txt.TrimEnd() + "`r`n[Settings]`r`nSensorsSM=1`r`n" }
    [IO.File]::WriteAllText($ini, $txt, $enc)
    return @{ action = 'patched'; backup = $bak }
}

# ---- state -------------------------------------------------------------------------------------------------------

function Get-HwinfoOwnDir {
    if (-not (Test-Path -LiteralPath $script:HwinfoRoot)) { return $null }
    $dirs = @(Get-ChildItem -LiteralPath $script:HwinfoRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'HWiNFO64.exe') })
    if (-not $dirs.Count) { return $null }
    $best = $dirs | Sort-Object { try { [version]($_.Name -replace '[^0-9.]', '') } catch { [version]'0.0' } } -Descending | Select-Object -First 1
    return $best.FullName
}

# An HWiNFO64.exe the user already has (Downloads, Desktop, Documents, C:\Tools, Program Files; two levels deep). The newest one's folder, or $null.
function Find-HwinfoFolder([string[]]$Roots) {
    if ($null -eq $Roots) {
        $Roots = @((Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Documents'), 'C:\Tools', 'C:\HWiNFO', $env:ProgramFiles)
    }
    $hits = foreach ($r in $Roots) {
        if ($r -and (Test-Path -LiteralPath $r)) { Get-ChildItem -LiteralPath $r -Filter 'HWiNFO64.exe' -Recurse -Depth 2 -File -ErrorAction SilentlyContinue }
    }
    $best = $hits | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($best) { return $best.DirectoryName }
    return $null
}

function Get-HwinfoProcesses {
    if ($script:HwinfoProcesses) { return @(& $script:HwinfoProcesses) }
    return @(Get-Process -Name 'HWiNFO64' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Path = $_.Path } })
}

# Only the processes started from this exe (Path compare, case-insensitive). A process whose Path cannot be read is NOT ours.
function Select-HwinfoOwnProcesses($Processes, [string]$ExePath) {
    return @(@($Processes) | Where-Object { $_.Path -and ([string]$_.Path -ieq $ExePath) })
}

function Test-HwinfoSharedMemory {
    if ($script:HwinfoSharedMemory) { return [bool](& $script:HwinfoSharedMemory) }
    try { $m = [IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Global\HWiNFO_SENS_SM2', [IO.MemoryMappedFiles.MemoryMappedFileRights]::Read); $m.Dispose(); return $true } catch { return $false }
}

# Which HWiNFO64.exe the app would use: a copy the user already has wins over the app's own download.
function Resolve-HwinfoExe([string[]]$SearchRoots) {
    $existing = Find-HwinfoFolder $SearchRoots
    if ($existing) { return @{ exe = (Join-Path $existing 'HWiNFO64.exe'); dir = $existing; source = 'existing' } }
    $own = Get-HwinfoOwnDir
    if ($own) { return @{ exe = (Join-Path $own 'HWiNFO64.exe'); dir = $own; source = 'own' } }
    return $null
}

function Get-HwinfoState([string[]]$SearchRoots) {
    $cfg = Get-HwinfoConfig
    $res = Resolve-HwinfoExe $SearchRoots
    $procs = @(Get-HwinfoProcesses)
    $ownRunning = if ($res) { @(Select-HwinfoOwnProcesses $procs $res.exe).Count -gt 0 } else { $false }
    $iniState = 'none'
    if ($res) {
        $ini = Join-Path $res.dir 'HWiNFO64.INI'
        $iniState = if (-not (Test-Path -LiteralPath $ini)) { 'missing' } elseif (Test-HwinfoSharedMemoryIni $ini) { 'ok' } else { 'noSharedMemory' }
    }
    return [pscustomobject]@{
        installed = [bool]$res; source = $(if ($res) { $res.source } else { $null }); dir = $(if ($res) { $res.dir } else { $null })
        version = $(if ($res) { Get-HwinfoFileVersion $res.exe } else { $null })
        running = ($procs.Count -gt 0); runningHere = $ownRunning; sharedMemory = (Test-HwinfoSharedMemory); ini = $iniState
        name = $cfg.name; homepage = $cfg.homepage; downloadPage = $cfg.downloadPage; signer = $cfg.signer; license = $cfg.license
        installRoot = $script:HwinfoRoot
    }
}

# ---- install -----------------------------------------------------------------------------------------------------

# Download (the user agreed in the app) or take -ZipPath, validate, unpack only HWiNFO64.exe, check its signature, place the INI.
# Returns @{ dir; exe; version; signer; ini; source }. Throws coded errors; the staging folder is always deleted.
function Install-Hwinfo($Config, [string]$ExpectedVersion, [string]$ZipPath, [switch]$SkipAcl) {
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('KafkaBoost_hwinfo_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $stage | Out-Null
    try {
        $version = $null; $source = 'file'
        if ($ZipPath) { $zip = $ZipPath }
        else {
            $rel = Get-HwinfoRelease $Config
            if ($ExpectedVersion -and $rel.version -ne $ExpectedVersion) {
                throw (New-HwinfoError 'msg.hwinfo.versionChanged' "The page now offers $($rel.version), not $ExpectedVersion. Check again before downloading." @{ shown = $ExpectedVersion; now = $rel.version })
            }
            $zip = Join-Path $stage 'hwinfo.zip'
            if ($script:HwinfoFetcher) { & $script:HwinfoFetcher.File $rel.url $zip } else { Save-HwinfoUrl $rel.url $zip }
            $version = $rel.version; $source = $rel.url
        }
        if (-not (Test-HwinfoZipFile $zip $Config.exe)) {
            if ($ZipPath) { throw (New-HwinfoError 'msg.hwinfo.badZip' "$ZipPath is not an HWiNFO portable zip (no $($Config.exe))." @{ exe = $Config.exe }) }
            throw (New-HwinfoError 'msg.hwinfo.blocked' 'The reply was not a zip (the site may be showing a protection page). Download the portable zip in your browser and choose it here.')
        }
        $x = Join-Path $stage 'x'; New-Item -ItemType Directory -Force $x | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        try { $e = $z.Entries | Where-Object { $_.FullName -eq $Config.exe } | Select-Object -First 1; [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $x $Config.exe), $true) } finally { $z.Dispose() }
        $exeStaged = Join-Path $x $Config.exe
        $sig = Test-HwinfoSignature $exeStaged $Config
        if (-not $sig.ok) {
            throw (New-HwinfoError 'msg.hwinfo.badSignature' "The signature of $($Config.exe) is not valid or not from $($Config.signer) (status $($sig.status), signer '$($sig.signer)'). It was deleted and nothing was installed." @{ status = $sig.status; signer = $sig.signer })
        }
        if (-not $version) { $version = (Get-HwinfoFileVersion $exeStaged) }
        $version = ($version -replace '[^0-9A-Za-z.\-]', '')
        if (-not $version) { $version = 'unknown' }
        $dir = Join-Path $script:HwinfoRoot $version
        if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
        New-Item -ItemType Directory -Force $dir | Out-Null
        Move-Item -LiteralPath $exeStaged -Destination (Join-Path $dir $Config.exe)
        $ini = Initialize-HwinfoIni $dir $script:HwinfoTemplatePath
        $acl = if ($SkipAcl) { $null } else { Set-SensorsAcl $dir }
        return [pscustomobject]@{ dir = $dir; exe = (Join-Path $dir $Config.exe); version = $version; signer = $sig.signer; ini = $ini.action; source = $source; aclLocked = $acl }
    } finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---- start / stop ------------------------------------------------------------------------------------------------

# { ok; code; message; data }. Never passes arguments to HWiNFO64.exe.
function Start-HwinfoApp($Config, [switch]$UpdateIni, [string[]]$SearchRoots) {
    $res = Resolve-HwinfoExe $SearchRoots
    if (-not $res) { return [pscustomobject]@{ ok = $false; code = 'msg.hwinfo.notInstalled'; message = 'HWiNFO is not on this PC yet.'; data = $null } }
    $sig = Test-HwinfoSignature $res.exe $Config
    if (-not $sig.ok) { return [pscustomobject]@{ ok = $false; code = 'msg.hwinfo.badSignature'; message = "HWiNFO64.exe at $($res.exe) has no valid $($Config.signer) signature (status $($sig.status)); it was not started."; data = @{ status = $sig.status; signer = $sig.signer } } }
    $procs = @(Get-HwinfoProcesses)
    if (@(Select-HwinfoOwnProcesses $procs $res.exe).Count) { return [pscustomobject]@{ ok = $true; code = 'msg.hwinfo.alreadyRunning'; message = 'HWiNFO is already running.'; data = @{ dir = $res.dir } } }
    if ($procs.Count) { return [pscustomobject]@{ ok = $true; code = 'msg.hwinfo.otherRunning'; message = 'Another HWiNFO64 is already running; a second copy was not started.'; data = @{ dir = $res.dir } } }
    $ini = Initialize-HwinfoIni $res.dir $script:HwinfoTemplatePath -UpdateExisting:$UpdateIni
    if ($ini.action -eq 'needsSharedMemory') { return [pscustomobject]@{ ok = $false; code = 'msg.hwinfo.iniNoSharedMemory'; message = 'Your HWiNFO64.INI does not have SensorsSM=1, so the Dashboard cannot read it.'; data = @{ dir = $res.dir; ini = $ini.action } } }
    if ($script:HwinfoStarter) { & $script:HwinfoStarter $res.exe $res.dir } else { Start-Process -FilePath $res.exe -WorkingDirectory $res.dir }
    return [pscustomobject]@{ ok = $true; code = 'msg.hwinfo.started'; message = 'HWiNFO started (sensors only).'; data = @{ dir = $res.dir; ini = $ini.action; backup = $ini.backup; source = $res.source } }
}

function Stop-HwinfoApp([string[]]$SearchRoots) {
    $res = Resolve-HwinfoExe $SearchRoots
    if (-not $res) { return [pscustomobject]@{ ok = $true; code = 'msg.hwinfo.notRunning'; message = 'HWiNFO is not running.'; data = @{ stopped = 0 } } }
    $mine = @(Select-HwinfoOwnProcesses (Get-HwinfoProcesses) $res.exe)
    if (-not $mine.Count) { return [pscustomobject]@{ ok = $true; code = 'msg.hwinfo.notRunning'; message = 'HWiNFO is not running from this folder; nothing was stopped.'; data = @{ stopped = 0 } } }
    foreach ($p in $mine) {
        if ($script:HwinfoStopper) { & $script:HwinfoStopper $p.Id; continue }
        $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
        if ($proc) { [void]$proc.CloseMainWindow(); if (-not $proc.WaitForExit(4000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    }
    return [pscustomobject]@{ ok = $true; code = 'msg.hwinfo.stopped'; message = 'HWiNFO stopped.'; data = @{ stopped = $mine.Count } }
}
