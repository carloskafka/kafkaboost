# RAMMap (Sysinternals, Microsoft freeware): fetch the official build on demand, run ONE allow-listed memory action, and measure the
# memory counters before and after. RAMMap has no output of its own, so every number we show comes from Windows counters we read ourselves.
#
# Rules
#   * RAMMap is proprietary freeware: never committed or bundled. It is downloaded only after the user's explicit click, from the
#     address in config/rammap.json, into %ProgramData%\LegionTuning\rammap (a folder only administrators can change).
#   * The zip must hold RAMMap64.exe and that file must carry a VALID Authenticode signature from the signer in the config.
#     Anything else is deleted and nothing is installed.
#   * RAMMap64.exe is started ONLY from our own folder, ONLY with '-accepteula' plus one switch from the allow-list in the config (no free
#     text, no user-built arguments), and never when another RAMMap64 from that path is already running.
#   * A counter Windows does not report is $null (missing), never 0. We never claim a performance gain: only what was measured.
#   * Besides the page, the only caller is the opt-in auto clean (Invoke-RammapAutoClean): the 'working-sets' action only, past a standby threshold and outside a cooldown.
#
# Tests replace the seams: $script:RammapFetcher, $script:RammapSignature, $script:RammapRunner, $script:RammapMemory and $script:RammapRoot.

$script:RammapFetcher = $null
$script:RammapSignature = $null
$script:RammapRunner = $null
$script:RammapMemory = $null
$script:RammapRoot = Join-Path $env:ProgramData 'LegionTuning\rammap'
$script:RammapConfigPath = Join-Path $PSScriptRoot '..\..\config\rammap.json'
$script:RammapUserAgent = 'KafkaBoost (+https://github.com/carloskafka/kafkaboost)'

function Get-RammapConfig { Get-Content -LiteralPath $script:RammapConfigPath -Raw | ConvertFrom-Json }

function New-RammapError([string]$Code, [string]$Message, [hashtable]$ErrorArgs = @{}) {
    $e = New-Object System.Exception $Message
    $e.Data['code'] = $Code; $e.Data['args'] = $ErrorArgs
    return $e
}

function Get-RammapExePath($Config) { Join-Path $script:RammapRoot $Config.exe }

# ---- state -------------------------------------------------------------------------------------------------------

# { installed; exe; version; signerOk; signer }. Never throws.
function Get-RammapState($Config) {
    $exe = Get-RammapExePath $Config
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return [pscustomobject]@{ installed = $false; exe = $exe; version = $null; signerOk = $false; signer = '' } }
    $sig = Test-RammapSignature $exe $Config
    $ver = ''; try { $ver = [string](Get-Item -LiteralPath $exe).VersionInfo.FileVersion } catch { }
    return [pscustomobject]@{ installed = $true; exe = $exe; version = $ver; signerOk = [bool]$sig.ok; signer = $sig.signer }
}

# { ok; status; signer }: ok only when the signature is Valid and the signer is exactly the expected company.
function Test-RammapSignature([string]$ExePath, $Config) {
    $sig = if ($script:RammapSignature) { & $script:RammapSignature $ExePath } else {
        $s = Get-AuthenticodeSignature -LiteralPath $ExePath
        @{ status = [string]$s.Status; subject = $(if ($s.SignerCertificate) { [string]$s.SignerCertificate.Subject } else { '' }) }
    }
    $subject = [string]$sig.subject
    $name = if ($subject -match 'CN="([^"]+)"') { $Matches[1] } elseif ($subject -match 'CN=([^,]+)') { $Matches[1] } else { '' }
    $ok = ([string]$sig.status -eq 'Valid') -and ($name -eq [string]$Config.signer)
    return [pscustomobject]@{ ok = [bool]$ok; status = [string]$sig.status; signer = $name }
}

# ---- download ----------------------------------------------------------------------------------------------------

function Save-RammapUrl([string]$Url, [string]$OutFile) {
    $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($curl) {
        & $curl.Source -sSL --fail --max-time 300 -A $script:RammapUserAgent -o $OutFile $Url 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw (New-RammapError 'msg.rammap.networkFailed' "curl failed with exit code $LASTEXITCODE for $Url") }
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        try { Invoke-WebRequest -Uri $Url -UserAgent $script:RammapUserAgent -UseBasicParsing -OutFile $OutFile -TimeoutSec 300 | Out-Null }
        catch { throw (New-RammapError 'msg.rammap.networkFailed' $_.Exception.Message) }
    }
}

# True when the file is a zip (starts with 'PK') that holds the exe at its top level.
function Test-RammapZip([string]$Path, [string]$Exe) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $head = New-Object byte[] 4
    $fs = [IO.File]::OpenRead($Path)
    try { if ($fs.Read($head, 0, 4) -lt 4) { return $false } } finally { $fs.Dispose() }
    if ($head[0] -ne 0x50 -or $head[1] -ne 0x4B) { return $false }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($Path)
    try { return [bool]($z.Entries | Where-Object { $_.FullName -eq $Exe }) } finally { $z.Dispose() }
}

# Downloads (or uses -ZipPath), checks and installs RAMMap64.exe. Returns { exe; version; signer; source }.
function Install-Rammap($Config, [string]$ZipPath) {
    if (-not ([string]$Config.zipUrl).StartsWith([string]$Config.urlPrefix)) { throw (New-RammapError 'msg.rammap.badSource' 'The download address in the configuration is not from the expected site.') }
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('KafkaBoost_rammap_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $stage | Out-Null
    try {
        $source = 'file'
        if ($ZipPath) { $zip = $ZipPath }
        else {
            $zip = Join-Path $stage 'rammap.zip'
            if ($script:RammapFetcher) { & $script:RammapFetcher $Config.zipUrl $zip } else { Save-RammapUrl $Config.zipUrl $zip }
            $source = [string]$Config.zipUrl
        }
        if (-not (Test-RammapZip $zip $Config.exe)) { throw (New-RammapError 'msg.rammap.badZip' "The download is not a zip with $($Config.exe).") }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $staged = Join-Path $stage $Config.exe
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        try { $e = $z.Entries | Where-Object { $_.FullName -eq $Config.exe } | Select-Object -First 1; [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $staged, $true) } finally { $z.Dispose() }
        $sig = Test-RammapSignature $staged $Config
        if (-not $sig.ok) {
            throw (New-RammapError 'msg.rammap.badSignature' "The signature of $($Config.exe) is not valid or not from $($Config.signer) (status $($sig.status), signer '$($sig.signer)'). It was deleted and nothing was installed." @{ status = $sig.status; signer = $sig.signer })
        }
        New-Item -ItemType Directory -Force $script:RammapRoot | Out-Null
        $dest = Get-RammapExePath $Config
        Move-Item -LiteralPath $staged -Destination $dest -Force
        $ver = ''; try { $ver = [string](Get-Item -LiteralPath $dest).VersionInfo.FileVersion } catch { }
        return [pscustomobject]@{ exe = $dest; version = $ver; signer = $sig.signer; source = $source }
    } finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---- memory counters ---------------------------------------------------------------------------------------------

# Bytes, or $null when Windows does not report a value. Locale independent: the raw performance class, not the localized counter names.
function Get-RammapMemory {
    if ($script:RammapMemory) { return (& $script:RammapMemory) }
    $o = [ordered]@{ totalBytes = $null; availableBytes = $null; freeBytes = $null; standbyBytes = $null; modifiedBytes = $null }
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        $o.totalBytes = [int64]$os.TotalVisibleMemorySize * 1KB
        $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -ErrorAction Stop
        # A property Windows does not report stays $null: a cast would turn it into 0.
        $get = { param($name) if ($null -eq $m.$name) { $null } else { [int64]$m.$name } }
        $o.availableBytes = & $get 'AvailableBytes'
        $o.freeBytes = & $get 'FreeAndZeroPageListBytes'
        $parts = @(& $get 'StandbyCacheNormalPriorityBytes'; & $get 'StandbyCacheReserveBytes'; & $get 'StandbyCacheCoreBytes')
        $o.standbyBytes = if ($parts | Where-Object { $null -eq $_ }) { $null } else { [int64]($parts | Measure-Object -Sum).Sum }
        $o.modifiedBytes = & $get 'ModifiedPageListBytes'
    } catch { }
    return [pscustomobject]$o
}

# after - before for each counter; $null when either side is missing.
function Get-RammapDelta($Before, $After) {
    $d = [ordered]@{}
    foreach ($k in 'availableBytes', 'freeBytes', 'standbyBytes', 'modifiedBytes') {
        $d[$k] = if ($null -eq $Before.$k -or $null -eq $After.$k) { $null } else { [int64]$After.$k - [int64]$Before.$k }
    }
    return [pscustomobject]$d
}

# ---- run one action ----------------------------------------------------------------------------------------------

function Get-RammapHistoryPath { Join-Path $script:RammapRoot 'history.jsonl' }

function Add-RammapHistory($Record) {
    New-Item -ItemType Directory -Force $script:RammapRoot | Out-Null
    ($Record | ConvertTo-Json -Depth 5 -Compress) | Add-Content -LiteralPath (Get-RammapHistoryPath) -Encoding UTF8
}

# Newest first, at most $Max records. Lines that do not parse are skipped.
function Get-RammapHistory([int]$Max = 50) {
    $p = Get-RammapHistoryPath
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    $rows = foreach ($line in (Get-Content -LiteralPath $p -Tail 500)) { try { $line | ConvertFrom-Json } catch { } }
    return @($rows | Sort-Object { $_.time } -Descending | Select-Object -First $Max)
}

# { ok; code; message; data }. Only an id from the config's allow-list is accepted; the switch comes from the config, never from the caller.
function Invoke-RammapAction([string]$ActionId, $Config, [ValidateSet('manual', 'auto')][string]$Trigger = 'manual') {
    $act = $Config.actions | Where-Object { $_.id -eq $ActionId } | Select-Object -First 1
    if (-not $act) { return [pscustomobject]@{ ok = $false; code = 'msg.rammap.unknownAction'; message = "Unknown RAMMap action: $ActionId"; data = $null } }
    $st = Get-RammapState $Config
    if (-not $st.installed) { return [pscustomobject]@{ ok = $false; code = 'msg.rammap.notInstalled'; message = 'RAMMap is not on this PC yet.'; data = $null } }
    if (-not $st.signerOk) { return [pscustomobject]@{ ok = $false; code = 'msg.rammap.badSignature'; message = "RAMMap64.exe has no valid $($Config.signer) signature; it was not started."; data = @{ signer = $st.signer } } }
    $running = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($Config.exe)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $st.exe })
    if ($running.Count -and -not $script:RammapRunner) { return [pscustomobject]@{ ok = $false; code = 'msg.rammap.alreadyRunning'; message = 'RAMMap is already running; close it first.'; data = $null } }
    $before = Get-RammapMemory
    $runArgs = @('-accepteula', [string]$act.switch)
    $exit = if ($script:RammapRunner) { & $script:RammapRunner $st.exe $runArgs } else {
        $p = Start-Process -FilePath $st.exe -ArgumentList $runArgs -WorkingDirectory $script:RammapRoot -WindowStyle Hidden -PassThru
        if (-not $p.WaitForExit(120000)) { try { $p.Kill() } catch { }; -1 } else { $p.ExitCode }
    }
    if ($exit -ne 0) { return [pscustomobject]@{ ok = $false; code = 'msg.rammap.runFailed'; message = "RAMMap exited with code $exit."; data = @{ exitCode = $exit } } }
    Start-Sleep -Milliseconds 500        # the counters settle a moment after the call returns
    $after = Get-RammapMemory
    $delta = Get-RammapDelta $before $after
    $rec = [pscustomobject]@{ time = (Get-Date).ToUniversalTime().ToString('o'); action = $act.id; trigger = $Trigger; switch = [string]$act.switch; before = $before; after = $after; delta = $delta }
    Add-RammapHistory $rec
    return [pscustomobject]@{ ok = $true; code = 'msg.rammap.done'; message = "RAMMap ran $($act.id)."; data = $rec }
}

# ---- auto clean --------------------------------------------------------------------------------------------------

function Get-RammapAutoStatePath { Join-Path $script:RammapRoot 'auto-state.json' }

# The time of the last successful auto clean, or $null when there is none (or the file is unreadable).
function Get-RammapLastAutoClean {
    $p = Get-RammapAutoStatePath
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    try { return ([datetime](Get-Content -LiteralPath $p -Raw | ConvertFrom-Json).lastClean).ToUniversalTime() } catch { return $null }
}

function New-RammapAutoResult([bool]$Ok, [string]$Code, [string]$Message, $Data = $null) {
    [pscustomobject]@{ ok = $Ok; code = $Code; message = $Message; data = $Data }
}

# { ok; code; message; data }. Cleans the working sets (never another action) when standby memory is at least $ThresholdPct of the total and
# the last auto clean is older than $CooldownMin. A counter Windows does not report skips the clean (reason 'missing'); it is never read as 0.
function Invoke-RammapAutoClean([int]$ThresholdPct, [int]$CooldownMin, $Config, [scriptblock]$Now = { Get-Date }) {
    $pct = [math]::Max(20, [math]::Min(90, $ThresholdPct))
    $cooldown = [math]::Max(5, [math]::Min(60, $CooldownMin))
    $mem = Get-RammapMemory
    if ($null -eq $mem.standbyBytes -or $null -eq $mem.totalBytes -or $mem.totalBytes -le 0) {
        return New-RammapAutoResult $true 'msg.rammap.auto.skipped' 'Memory counters are missing; nothing was cleaned.' @{ reason = 'missing' }
    }
    if (($mem.standbyBytes / $mem.totalBytes * 100) -lt $pct) {
        return New-RammapAutoResult $true 'msg.rammap.auto.skipped' 'Standby memory is below the threshold.' @{ reason = 'below' }
    }
    $at = (& $Now).ToUniversalTime()
    $last = Get-RammapLastAutoClean
    if ($last -and ($at - $last).TotalMinutes -lt $cooldown) {
        return New-RammapAutoResult $true 'msg.rammap.auto.skipped' 'The last auto clean is too recent.' @{ reason = 'cooldown' }
    }
    $r = Invoke-RammapAction 'working-sets' $Config -Trigger auto
    if (-not $r.ok) { return $r }
    New-Item -ItemType Directory -Force $script:RammapRoot | Out-Null
    (@{ lastClean = $at.ToString('o') } | ConvertTo-Json -Compress) | Set-Content -LiteralPath (Get-RammapAutoStatePath) -Encoding UTF8
    return New-RammapAutoResult $true 'msg.rammap.auto.cleaned' 'Auto clean ran working-sets.' $r.data
}

# ---- live view (Memory page) -------------------------------------------------------------------------------------

# One reading every $IntervalSec until the stop file appears or $MaxSec passes; $OnSample gets each reading (what it writes goes to the
# console, never into the returned count). Counters Windows does not report stay $null. Returns the number of readings. Read-only.
function Watch-RammapMemory([int]$IntervalSec, [string]$StopFile, [int]$MaxSec, [scriptblock]$OnSample = {},
        [scriptblock]$Reader = { Get-RammapMemory }, [scriptblock]$Sleep = { param($s) Start-Sleep -Seconds $s }, [scriptblock]$Now = { Get-Date }) {
    $start = & $Now; $n = 0
    while ($true) {
        $t = & $Now
        if (($t - $start).TotalSeconds -ge $MaxSec) { break }
        if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { break }
        $m = $null
        try { $m = & $Reader } catch { $m = $null }
        if ($m) {
            $n++
            $smp = [pscustomobject]@{ t = $t.ToString('s'); totalBytes = $m.totalBytes; availableBytes = $m.availableBytes; freeBytes = $m.freeBytes; standbyBytes = $m.standbyBytes; modifiedBytes = $m.modifiedBytes }
            & $OnSample $smp | Out-Host
        }
        & $Sleep $IntervalSec
    }
    return $n
}
