<#
Copies this repo's Claude skills and agents (.claude/skills, .claude/agents) to ~/.claude so they work in every project.
Never edits settings.json, hooks or CLAUDE.md. Existing items are skipped unless -Force (then a .bak copy is made).
#>
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:USERPROFILE '.claude'
function Copy-Item2($src, $dst) {
    if (Test-Path $dst) {
        if (-not $Force) { Write-Output "skip (exists): $dst"; return }
        Copy-Item $dst "$dst.bak" -Recurse -Force
    }
    Copy-Item $src $dst -Recurse -Force
    Write-Output "copied: $dst"
}
New-Item -ItemType Directory -Force (Join-Path $dest 'skills'), (Join-Path $dest 'agents') | Out-Null
Get-ChildItem (Join-Path $repo '.claude\skills') -Directory | ForEach-Object { Copy-Item2 $_.FullName (Join-Path $dest "skills\$($_.Name)") }
Get-ChildItem (Join-Path $repo '.claude\agents') -File -Filter *.md | ForEach-Object { Copy-Item2 $_.FullName (Join-Path $dest "agents\$($_.Name)") }
Write-Output ''
Write-Output 'Manual steps (not automated on purpose):'
Write-Output '1. Create the weekly audit task from tools\claude-setup\weekly-quota-audit.md (Claude app > Scheduled).'
Write-Output '2. Optional: /autocompact 300k, /mcp disable <unused>, BASH_MAX_OUTPUT_LENGTH=15000 in settings.json env.'
