#Requires -Version 5.1
<#
.SYNOPSIS
  Creates the "Legion Tuning" shortcut (desktop and Start Menu) that opens the app with administrator rights.

.DESCRIPTION
  A .lnk file holds absolute paths, so it cannot be committed; this script builds it for wherever the repo (or the
  installed app) lives. The shortcut starts app\Launch-Wizard.cmd (development mode) or, with -Target, any other exe/cmd,
  uses app\build\icon.ico and has the "Run as administrator" flag set. Re-running it just refreshes the shortcut.

.EXAMPLE
  .\Create-Shortcut.ps1                      # desktop + Start Menu
  .\Create-Shortcut.ps1 -NoStartMenu
  .\Create-Shortcut.ps1 -Target "C:\Program Files\Legion Tuning Wizard\Legion Tuning Wizard.exe"
  .\Create-Shortcut.ps1 -OutDir $env:TEMP    # write the .lnk somewhere else (used by the tests)
#>
[CmdletBinding()]
param(
    [string]$Target,
    [string]$Icon,
    [string]$Name = 'Legion Tuning',
    [string]$OutDir,
    [switch]$NoDesktop,
    [switch]$NoStartMenu
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Target) { $Target = Join-Path $repo 'app\Launch-Wizard.cmd' }
if (-not $Icon)   { $Icon   = Join-Path $repo 'app\build\icon.ico' }
if (-not (Test-Path -LiteralPath $Target)) { throw "Target not found: $Target" }

function New-Lnk([string]$Path) {
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($Path)
    $s.TargetPath = (Resolve-Path -LiteralPath $Target).Path
    $s.WorkingDirectory = Split-Path -Parent $s.TargetPath
    $s.Description = 'Check and apply the CPU tuning (ThrottleStop) - Legion Tuning'
    $s.WindowStyle = 7                                   # minimized: the .cmd launcher window stays out of the way
    if (Test-Path -LiteralPath $Icon) { $s.IconLocation = (Resolve-Path -LiteralPath $Icon).Path }
    $s.Save()
    # "Run as administrator" = bit 0x20 of the byte at offset 0x15 in the .lnk header (the same flag the Properties dialog sets)
    $bytes = [IO.File]::ReadAllBytes($Path); $bytes[0x15] = $bytes[0x15] -bor 0x20; [IO.File]::WriteAllBytes($Path, $bytes)
    Write-Host "created $Path"
}

$made = @()
if ($OutDir) {
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $made += New-Lnk (Join-Path $OutDir "$Name.lnk")
} else {
    if (-not $NoDesktop)   { New-Lnk (Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk") }
    if (-not $NoStartMenu) { New-Lnk (Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk") }
}
