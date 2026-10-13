# System Restore points: list, create, and a safety point before the first tweak.
# Dot-source after Tuning.ps1 (Test-Admin) and Tweaks.ps1 (Get-TweakState).
#
# Rules
#   * We never change the System Protection settings or the 24-hour limit Windows puts on restore points. If Windows
#     does not create one, we say so; we do not work around it.
#   * There is no single-point delete: Windows has no clean API for it, so the app opens the System Restore dialog instead.
#   * The safety point never blocks a tweak: it is best effort and its outcome is reported.
# Tests set $script:RestoreProvider = @{ List = { ... }; Create = { param($description) ... } } so no real point is made.

$script:RestoreProvider = $null

$script:RestoreTypeNames = @{ 0 = 'install'; 1 = 'uninstall'; 10 = 'driver'; 12 = 'settings'; 13 = 'cancelled' }

function ConvertFrom-RestorePointRaw($Raw) {
    $when = $null
    try { $when = [Management.ManagementDateTimeConverter]::ToDateTime([string]$Raw.CreationTime) } catch {
        try { $when = [datetime]$Raw.CreationTime } catch { }
    }
    $type = [int]$Raw.RestorePointType
    [pscustomobject]@{
        id          = [int]$Raw.SequenceNumber
        description = [string]$Raw.Description
        created     = $(if ($when) { $when.ToString('s') } else { $null })
        type        = $(if ($script:RestoreTypeNames.ContainsKey($type)) { $script:RestoreTypeNames[$type] } else { 'other' })
    }
}

# Newest first. Needs administrator rights when it reads the real list.
function Get-KbRestorePoints {
    $raw = if ($script:RestoreProvider) { @(& $script:RestoreProvider.List) } else { @(Get-ComputerRestorePoint -ErrorAction Stop) }
    return @($raw | ForEach-Object { ConvertFrom-RestorePointRaw $_ } | Sort-Object id -Descending)
}

function Get-LastRestoreId {
    try { $l = @(Get-KbRestorePoints); if ($l.Count) { return [int]$l[0].id } } catch { }
    return 0
}

# Creates a restore point and checks that Windows really made one (Checkpoint-Computer only warns when it declines).
function New-KbRestorePoint([string]$Description = 'KafkaBoost') {
    if (-not $script:RestoreProvider -and -not (Test-Admin)) {
        return [pscustomobject]@{ ok = $false; created = $false; code = 'msg.restore.needsAdmin'; message = 'Administrator rights are required to create a restore point.' }
    }
    $before = Get-LastRestoreId
    try {
        if ($script:RestoreProvider) { & $script:RestoreProvider.Create $Description | Out-Null }
        else { Checkpoint-Computer -Description $Description -RestorePointType MODIFY_SETTINGS -WarningAction SilentlyContinue -ErrorAction Stop }
    } catch {
        return [pscustomobject]@{ ok = $false; created = $false; code = 'msg.restore.failed'; message = $_.Exception.Message }
    }
    $after = Get-LastRestoreId
    if ($after -gt $before) {
        return [pscustomobject]@{ ok = $true; created = $true; id = $after; code = 'msg.restore.created'; message = 'Restore point created.' }
    }
    return [pscustomobject]@{ ok = $true; created = $false; code = 'msg.restore.skipped'; message = 'Windows did not create a new point: it allows one every 24 hours, or System Protection is off.' }
}

# True when no tweak is recorded yet, i.e. the next change is the first one KafkaBoost makes.
function Test-FirstTweak {
    $s = Get-TweakState
    return -not @($s.tweaks.PSObject.Properties).Count
}
