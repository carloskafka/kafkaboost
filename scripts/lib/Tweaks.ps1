# Tweak engine: reads config\tweaks.json (the catalog) and applies / reverts / checks each tweak.
# Dot-source AFTER lib\Tuning.ps1 (it needs Test-Admin, Disable-Vbs and Restore-Vbs).
#
# Design rules
#   * Data driven: a tweak is a list of small declarative actions (registry, regkey, service, powerplan, dns, defender, vbs, bcdedit). Nothing is
#     built from free text; ids, paths and values come from the catalog only.
#   * Before an action changes anything, the PREVIOUS value is recorded in the state file, so revert restores what was really there
#     (and removes what was not), not a guess.
#   * Applying is all-or-nothing: if action N fails, the actions already applied are reverted.
#   * Tests redirect $script:RegMap and $script:TweakStatePath to a sandbox, so they never touch real keys.

$script:RegMap = @{ HKLM = 'HKLM:'; HKCU = 'HKCU:' }
$script:TweakStatePath = Join-Path $env:ProgramData 'LegionTuning\state.json'
$script:TweakCatalogPath = $null    # default: <repo>\config\tweaks.json

$script:UltimateGuid = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
$script:HighPerfGuid = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

# ---------------------------------------------------------------- catalog and state

function Get-TweakCatalog([string]$Path) {
    if (-not $Path) { $Path = $script:TweakCatalogPath }
    if (-not $Path) { $Path = Join-Path $PSScriptRoot '..\..\config\tweaks.json' }
    $json = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
    return $json
}

function Get-TweakState {
    if (Test-Path -LiteralPath $script:TweakStatePath) {
        try { return (Get-Content -LiteralPath $script:TweakStatePath -Raw | ConvertFrom-Json) } catch { }
    }
    return [pscustomobject]@{ version = 1; tweaks = [pscustomobject]@{} }
}

function Save-TweakState($State) {
    $dir = Split-Path -Parent $script:TweakStatePath
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $tmp = "$($script:TweakStatePath).tmp"
    ($State | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $script:TweakStatePath -Force
}

function Get-TweakRecord($State, [string]$Id) {
    $p = $State.tweaks.PSObject.Properties[$Id]
    if ($p) { return $p.Value }
    return $null
}

# ---------------------------------------------------------------- registry helpers

function Resolve-RegPath([string]$Path) {
    if ($Path -match '^(HKLM|HKCU):\\?(.*)$') { return ($script:RegMap[$Matches[1]] + '\' + $Matches[2]) }
    throw "Unsupported registry path: $Path"
}

# DWord values are stored as Int32 but written as unsigned in the catalog (4294967295). Compare and write through Int32.
function ConvertTo-DwordInt($Value) {
    $u = [uint32]([int64]$Value -band 0xFFFFFFFFL)
    return [BitConverter]::ToInt32([BitConverter]::GetBytes($u), 0)
}

function Read-RegValue([string]$Path, [string]$Name) {
    $p = Resolve-RegPath $Path
    if (-not (Test-Path -LiteralPath $p)) { return [pscustomobject]@{ exists = $false; value = $null; kind = $null } }
    $key = Get-Item -LiteralPath $p
    if ($key.GetValueNames() -notcontains $Name) { return [pscustomobject]@{ exists = $false; value = $null; kind = $null } }
    return [pscustomobject]@{ exists = $true; value = $key.GetValue($Name, $null, 'DoNotExpandEnvironmentNames'); kind = [string]$key.GetValueKind($Name) }
}

function Test-RegEqual($Current, $Want, [string]$Kind) {
    if (-not $Current.exists) { return $false }
    if ($Kind -eq 'DWord') { return ((ConvertTo-DwordInt $Current.value) -eq (ConvertTo-DwordInt $Want)) }
    return ([string]$Current.value -eq [string]$Want)
}

function Write-RegValue([string]$Path, [string]$Name, $Value, [string]$Kind) {
    $p = Resolve-RegPath $Path
    if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }
    $v = if ($Kind -eq 'DWord') { ConvertTo-DwordInt $Value } else { $Value }
    Set-ItemProperty -LiteralPath $p -Name $Name -Value $v -Type $Kind -Force
}

# ---------------------------------------------------------------- the actions
# Each action type has three behaviours: Active (is the tweak's value in place?), Apply (returns the PREVIOUS state), Revert (takes it back).

function Get-WindowsBuild { [int](Get-CimInstance Win32_OperatingSystem).BuildNumber }

function Get-ActivePowerGuid {
    $o = (& powercfg /getactivescheme) -join ' '
    if ($o -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') { return $Matches[1].ToLower() }
    return $null
}

function Get-StaticDnsServers([string]$InterfaceGuid) {
    $p = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$InterfaceGuid"
    if (-not (Test-Path -LiteralPath $p)) { return '' }
    $v = (Get-ItemProperty -LiteralPath $p -Name NameServer -ErrorAction SilentlyContinue).NameServer
    if ($null -eq $v) { return '' }
    return [string]$v
}

function Get-DnsAdapters { @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' }) }

function Test-ActionActive($a, $Record) {
    switch ($a.type) {
        'registry' { return (Test-RegEqual (Read-RegValue $a.path $a.name) $a.on $a.kind) }
        'regkey'   { return (Test-Path -LiteralPath (Resolve-RegPath $a.path)) }
        'service' {
            $s = Get-CimInstance Win32_Service -Filter "Name='$($a.name)'" -ErrorAction SilentlyContinue
            if (-not $s) { return $false }
            return ($s.StartMode -eq $a.on)
        }
        'powerplan' {
            $cur = Get-ActivePowerGuid
            if ($cur -eq $script:UltimateGuid -or $cur -eq $script:HighPerfGuid) { return $true }
            return ($Record -and $Record.appliedGuid -and $cur -eq $Record.appliedGuid)
        }
        'dns' {
            $want = @($a.servers)
            $ads = Get-DnsAdapters
            if (-not $ads.Count) { return $false }
            foreach ($ad in $ads) {
                $cur = @((Get-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
                if (($want | Where-Object { $cur -notcontains $_ }).Count) { return $false }
            }
            return $true
        }
        'defender' { try { return [bool](Get-MpPreference).DisableRealtimeMonitoring } catch { return $false } }
        'vbs'      { return (-not [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent) }
        'bcdedit'  { $cur = Get-BcdElement $a.element; return ($cur.exists -and $cur.value -ieq $a.on) }
        default    { throw "Unknown action type: $($a.type)" }
    }
}

# Returns the previous state (a plain object that goes into the state file).
function Invoke-ActionApply($a) {
    switch ($a.type) {
        'registry' {
            $prev = Read-RegValue $a.path $a.name
            Write-RegValue $a.path $a.name $a.on $a.kind
            return [pscustomobject]@{ type = 'registry'; exists = $prev.exists; value = $prev.value; kind = $prev.kind }
        }
        'regkey' {
            $p = Resolve-RegPath $a.path
            $existed = Test-Path -LiteralPath $p
            if (-not $existed) { New-Item -Path $p -Force | Out-Null; Set-ItemProperty -LiteralPath $p -Name '(default)' -Value '' }
            return [pscustomobject]@{ type = 'regkey'; existed = $existed }
        }
        'service' {
            $s = Get-CimInstance Win32_Service -Filter "Name='$($a.name)'" -ErrorAction Stop
            $prevMode = $s.StartMode; $wasRunning = ($s.State -eq 'Running')
            Set-Service -Name $a.name -StartupType $a.on
            if ($a.on -eq 'Disabled' -and $wasRunning) { Stop-Service -Name $a.name -Force -ErrorAction SilentlyContinue }
            return [pscustomobject]@{ type = 'service'; startMode = $prevMode; wasRunning = $wasRunning }
        }
        'powerplan' {
            $prev = Get-ActivePowerGuid
            $target = $null
            foreach ($g in $script:UltimateGuid, $script:HighPerfGuid) {
                $list = (& powercfg /list) -join ' '
                if ($list -notmatch $g) { & powercfg -duplicatescheme $g 2>$null | Out-Null }
                $list = (& powercfg /list) -join ' '
                if ($list -match $g -or $list -match 'Ultimate|High performance') { $target = $g; break }
            }
            if (-not $target) { throw 'No high-performance power plan is available on this PC.' }
            & powercfg /setactive $target
            return [pscustomobject]@{ type = 'powerplan'; previousGuid = $prev; appliedGuid = (Get-ActivePowerGuid) }
        }
        'dns' {
            $prevList = @()
            foreach ($ad in (Get-DnsAdapters)) {
                $prevList += [pscustomobject]@{ index = $ad.ifIndex; guid = $ad.InterfaceGuid; staticServers = (Get-StaticDnsServers $ad.InterfaceGuid) }
                Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses @($a.servers)
            }
            if (-not $prevList.Count) { throw 'No active network adapter was found.' }
            return [pscustomobject]@{ type = 'dns'; adapters = $prevList }
        }
        'defender' {
            $prev = [bool](Get-MpPreference).DisableRealtimeMonitoring
            Set-MpPreference -DisableRealtimeMonitoring $true
            Start-Sleep -Milliseconds 800
            if (-not [bool](Get-MpPreference).DisableRealtimeMonitoring) {
                throw 'Windows refused the change (Tamper Protection is probably on). It is not bypassed; turn Tamper Protection off in Windows Security yourself if you really want this.'
            }
            return [pscustomobject]@{ type = 'defender'; wasDisabled = $prev }
        }
        'vbs' {
            $prev = [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent
            Disable-Vbs
            return [pscustomobject]@{ type = 'vbs'; hypervisorWasOn = $prev }
        }
        'bcdedit' {
            $prev = Get-BcdElement $a.element
            Set-BcdElement $a.element $a.on
            return [pscustomobject]@{ type = 'bcdedit'; exists = $prev.exists; value = $prev.value }
        }
        default { throw "Unknown action type: $($a.type)" }
    }
}

function Invoke-ActionRevert($a, $prev) {
    switch ($a.type) {
        'registry' {
            if ($prev) {
                if ($prev.exists) { Write-RegValue $a.path $a.name $prev.value $prev.kind }
                else { Remove-RegValueIfPresent $a.path $a.name }
            } elseif ($a.PSObject.Properties['off'] -and $null -ne $a.off) { Write-RegValue $a.path $a.name $a.off $a.kind }
            else { Remove-RegValueIfPresent $a.path $a.name }
        }
        'regkey' {
            if (-not $prev -or -not $prev.existed) { $p = Resolve-RegPath $a.path; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force } }
        }
        'service' {
            $mode = if ($prev) { $prev.startMode } else { $a.off }
            $map = @{ Auto = 'Automatic'; Manual = 'Manual'; Disabled = 'Disabled'; Automatic = 'Automatic' }
            Set-Service -Name $a.name -StartupType $map[$mode]
            if ($mode -eq 'Auto' -or $mode -eq 'Automatic') { Start-Service -Name $a.name -ErrorAction SilentlyContinue }
        }
        'powerplan' {
            if ($prev -and $prev.previousGuid) { & powercfg /setactive $prev.previousGuid }
        }
        'dns' {
            if ($prev) {
                foreach ($ad in $prev.adapters) {
                    if ($ad.staticServers) { Set-DnsClientServerAddress -InterfaceIndex $ad.index -ServerAddresses @(([string]$ad.staticServers) -split '[,\s]+' | Where-Object { $_ }) }
                    else { Set-DnsClientServerAddress -InterfaceIndex $ad.index -ResetServerAddresses }
                }
            } else { foreach ($ad in (Get-DnsAdapters)) { Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ResetServerAddresses } }
        }
        'defender' { Set-MpPreference -DisableRealtimeMonitoring $false }
        'vbs'      { Restore-Vbs }
        'bcdedit' {
            if ($prev -and $prev.exists) { Set-BcdElement $a.element $prev.value }
            else { Remove-BcdElement $a.element }
        }
        default    { throw "Unknown action type: $($a.type)" }
    }
}

function Remove-RegValueIfPresent([string]$Path, [string]$Name) {
    $p = Resolve-RegPath $Path
    if (Test-Path -LiteralPath $p) { Remove-ItemProperty -LiteralPath $p -Name $Name -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- per-tweak API

function Test-TweakNeedsAdmin($Tweak) {
    foreach ($a in $Tweak.actions) {
        if ($a.type -in 'service', 'dns', 'defender', 'vbs', 'bcdedit') { return $true }
        if ($a.type -in 'registry', 'regkey' -and $a.path -like 'HKLM:*') { return $true }
    }
    return $false
}

function Test-TweakApplicable($Tweak, [int]$Build) {
    if ($Tweak.PSObject.Properties['minBuild'] -and $Build -lt [int]$Tweak.minBuild) { return $false }
    return $true
}

# status: active (every action in place) | inactive (none) | partial (some) | unavailable (not for this Windows build)
function Get-TweakStatus($Tweak, $State, [int]$Build) {
    if (-not (Test-TweakApplicable $Tweak $Build)) { return 'unavailable' }
    $rec = Get-TweakRecord $State $Tweak.id
    $on = 0; $n = 0
    foreach ($a in $Tweak.actions) { $n++; if (Test-ActionActive $a $rec) { $on++ } }
    if ($on -eq $n) { return 'active' }
    if ($on -eq 0) { return 'inactive' }
    return 'partial'
}

function Get-TweakStatuses([string]$CatalogPath) {
    $cat = Get-TweakCatalog $CatalogPath; $state = Get-TweakState; $build = Get-WindowsBuild
    foreach ($t in $cat.tweaks) {
        $status = try { Get-TweakStatus $t $state $build } catch { 'error' }
        [pscustomobject]@{
            id = $t.id; category = $t.category; risk = $t.risk; recommended = [bool]$t.recommended; needsReboot = [bool]$t.needsReboot
            needsAdmin = (Test-TweakNeedsAdmin $t); status = $status
        }
    }
}

# Applies ($Enable = $true) or reverts one tweak. Risky tweaks need -AllowRisky. All-or-nothing: a failing action undoes the earlier ones.
function Set-Tweak([string]$Id, [bool]$Enable, [switch]$AllowRisky, [string]$CatalogPath) {
    $cat = Get-TweakCatalog $CatalogPath
    $t = $cat.tweaks | Where-Object { $_.id -eq $Id } | Select-Object -First 1
    if (-not $t) { return [pscustomobject]@{ ok = $false; id = $Id; code = 'tweak.error.unknown'; error = "Unknown tweak: $Id" } }
    if ($Enable -and $t.risk -eq 'risky' -and -not $AllowRisky) { return [pscustomobject]@{ ok = $false; id = $Id; code = 'tweak.error.riskyNeedsConsent'; error = 'This tweak lowers security and needs explicit consent.' } }
    if (-not (Test-TweakApplicable $t (Get-WindowsBuild))) { return [pscustomobject]@{ ok = $false; id = $Id; code = 'tweak.error.notForThisWindows'; error = 'Not available on this Windows version.' } }
    if ((Test-TweakNeedsAdmin $t) -and -not (Test-Admin)) { return [pscustomobject]@{ ok = $false; id = $Id; code = 'tweak.error.admin'; error = 'Administrator rights are required for this tweak.' } }

    $state = Get-TweakState
    $rec = Get-TweakRecord $state $Id
    $done = @()
    try {
        if ($Enable) {
            $prevs = @()
            foreach ($a in $t.actions) { $prevs += (Invoke-ActionApply $a); $done += $a }
            $entry = [pscustomobject]@{ appliedAt = (Get-Date).ToString('s'); previous = $prevs }
            if (($t.actions | Where-Object { $_.type -eq 'powerplan' }) -and $prevs[0].appliedGuid) { $entry | Add-Member -NotePropertyName appliedGuid -NotePropertyValue $prevs[0].appliedGuid }
            if ($state.tweaks.PSObject.Properties[$Id]) { $state.tweaks.PSObject.Properties.Remove($Id) }
            $state.tweaks | Add-Member -NotePropertyName $Id -NotePropertyValue $entry
        } else {
            $i = 0
            foreach ($a in $t.actions) { $prev = if ($rec -and $rec.previous -and $i -lt @($rec.previous).Count) { @($rec.previous)[$i] } else { $null }; Invoke-ActionRevert $a $prev; $i++ }
            if ($state.tweaks.PSObject.Properties[$Id]) { $state.tweaks.PSObject.Properties.Remove($Id) }
        }
        Save-TweakState $state
        return [pscustomobject]@{ ok = $true; id = $Id; enabled = $Enable; needsReboot = [bool]$t.needsReboot; code = $(if ($Enable) { 'tweak.msg.applied' } else { 'tweak.msg.reverted' }) }
    } catch {
        # undo what this call already changed, most recent first
        if ($Enable -and $done.Count) {
            for ($k = $done.Count - 1; $k -ge 0; $k--) { try { Invoke-ActionRevert $done[$k] $prevs[$k] } catch { } }
        }
        return [pscustomobject]@{ ok = $false; id = $Id; code = 'tweak.error.failed'; error = $_.Exception.Message }
    }
}

# The tweaks "Apply recommended" works on: marked recommended AND safe, available on this Windows build and not active yet.
function Get-RecommendedTweaks([string]$CatalogPath) {
    $cat = Get-TweakCatalog $CatalogPath; $state = Get-TweakState; $build = Get-WindowsBuild
    foreach ($t in $cat.tweaks) {
        if ($t.risk -ne 'safe' -or -not $t.recommended) { continue }
        if (-not (Test-TweakApplicable $t $build)) { continue }
        if ((Get-TweakStatus $t $state $build) -eq 'active') { continue }
        $t
    }
}

# Applies every tweak that is marked recommended AND safe and is not active yet. Returns one result per tweak tried.
function Set-RecommendedTweaks([string]$CatalogPath) {
    foreach ($t in @(Get-RecommendedTweaks $CatalogPath)) {
        Set-Tweak $t.id $true -CatalogPath $CatalogPath
    }
}

# ---------------------------------------------------------------- preview (read-only)
# What would change, before anything is written: for each action the current value on this PC, the new value and what turning the tweak
# off puts back. Reads only (registry, service list, power plan, DNS, Defender, hypervisor state); needs no administrator rights.
# "restore" is what Invoke-ActionRevert will do: the value recorded at apply time is the current value, so a value that is not set now is
# deleted again, and a value that is set now is written back as it is.

# DWord values come back as Int32; show them the way the catalog and regedit do (unsigned).
function Format-RegDisplay($Value, [string]$Kind) {
    if ($Kind -eq 'DWord') { return [string][BitConverter]::ToUInt32([BitConverter]::GetBytes([int](ConvertTo-DwordInt $Value)), 0) }
    return [string]$Value
}

function Get-ActivePowerPlanName {
    $o = (& powercfg /getactivescheme) -join ' '
    if ($o -match '\(([^)]+)\)\s*$') { return $Matches[1] }
    return $null
}

function Get-ActionPreview($a) {
    switch ($a.type) {
        'registry' {
            $cur = Read-RegValue $a.path $a.name
            $curText = if ($cur.exists) { Format-RegDisplay $cur.value $cur.kind } else { $null }
            return [pscustomobject]@{
                type = 'registry'; path = $a.path; name = $a.name; kind = $a.kind
                currentSet = [bool]$cur.exists; current = $curText; new = (Format-RegDisplay $a.on $a.kind)
                alreadyInPlace = (Test-RegEqual $cur $a.on $a.kind)
                restoreDeletes = (-not $cur.exists); restore = $curText
            }
        }
        'regkey' {
            $exists = Test-Path -LiteralPath (Resolve-RegPath $a.path)
            return [pscustomobject]@{ type = 'regkey'; path = $a.path; currentSet = $exists; alreadyInPlace = $exists; restoreDeletes = (-not $exists) }
        }
        'service' {
            $s = Get-CimInstance Win32_Service -Filter "Name='$($a.name)'" -ErrorAction SilentlyContinue
            return [pscustomobject]@{
                type = 'service'; name = $a.name; found = [bool]$s; current = $(if ($s) { [string]$s.StartMode } else { $null })
                running = $(if ($s) { $s.State -eq 'Running' } else { $false }); new = [string]$a.on; restore = $(if ($s) { [string]$s.StartMode } else { [string]$a.off })
            }
        }
        'powerplan' {
            return [pscustomobject]@{ type = 'powerplan'; current = (Get-ActivePowerPlanName); currentGuid = (Get-ActivePowerGuid); new = 'Ultimate Performance / High performance'; restore = (Get-ActivePowerPlanName) }
        }
        'dns' {
            $ads = @(foreach ($ad in (Get-DnsAdapters)) {
                $st = Get-StaticDnsServers $ad.InterfaceGuid
                [pscustomobject]@{ name = [string]$ad.Name; current = [string]$st; restoreAutomatic = (-not $st) }
            })
            return [pscustomobject]@{ type = 'dns'; servers = (@($a.servers) -join ', '); adapters = $ads }
        }
        'defender' {
            $off = $null; try { $off = [bool](Get-MpPreference).DisableRealtimeMonitoring } catch { }
            return [pscustomobject]@{ type = 'defender'; currentOn = $(if ($null -eq $off) { $null } else { -not $off }) }
        }
        'vbs' {
            $on = $null; try { $on = [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent } catch { }
            return [pscustomobject]@{ type = 'vbs'; currentOn = $on }
        }
        'bcdedit' {
            $cur = $null; try { $cur = Get-BcdElement $a.element } catch { }
            $on = $(if ($null -eq $cur) { $null } else { ($cur.exists -and $cur.value -ieq $a.on) })
            return [pscustomobject]@{ type = 'bcdedit'; element = $a.element; current = $(if ($cur) { $cur.value }); currentOn = $on; needsReboot = $true }
        }
        default { return [pscustomobject]@{ type = [string]$a.type } }
    }
}

# One entry per tweak id (ids that are not in the catalog are skipped). Never throws: an action that cannot be read carries `error`.
function Get-TweakPreview([string[]]$Ids, [string]$CatalogPath) {
    $cat = Get-TweakCatalog $CatalogPath; $state = Get-TweakState; $build = Get-WindowsBuild
    foreach ($id in @($Ids | Where-Object { $_ })) {
        $t = $cat.tweaks | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if (-not $t) { continue }
        $acts = @(foreach ($a in $t.actions) {
            try { Get-ActionPreview $a } catch { [pscustomobject]@{ type = [string]$a.type; error = $_.Exception.Message } }
        })
        $status = try { Get-TweakStatus $t $state $build } catch { 'error' }
        [pscustomobject]@{
            id = $t.id; risk = $t.risk; recommended = [bool]$t.recommended; needsReboot = [bool]$t.needsReboot
            needsAdmin = (Test-TweakNeedsAdmin $t); status = $status; actions = $acts
        }
    }
}
