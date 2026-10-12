<#
.SYNOPSIS  Regenerates the app screenshots by walking the whole UI in demo mode (sample data, nothing on the PC is touched).
.PARAMETER OutDir  Where to write the PNGs (default: docs\assets).
.PARAMETER All     Also render the light theme and the Portuguese UI (files get a -light / -pt suffix).
.EXAMPLE   .\tools\make-shots.ps1
.EXAMPLE   .\tools\make-shots.ps1 -All -OutDir $env:TEMP\shots
#>
param([string]$OutDir, [switch]$All)
$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'
if (-not $OutDir) { $OutDir = Join-Path $repo 'docs\assets' }
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Run 'npm install' in app\ first." }
if (Test-Path $OutDir) { Get-ChildItem $OutDir -Filter *.png -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force } }
$env:WIZARD_DEMO = '1'; $env:WIZARD_SHOTS = $OutDir
if ($All) { $env:SHOTS_VARIANTS = 'all' }
try {
    $p = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $app -PassThru -WindowStyle Minimized
    if (-not $p.WaitForExit(300000)) { $p.Kill(); throw 'timed out' }
} finally { Remove-Item Env:WIZARD_DEMO, Env:WIZARD_SHOTS, Env:SHOTS_VARIANTS -ErrorAction SilentlyContinue }
Get-ChildItem $OutDir -Filter *.png | ForEach-Object { '{0,-30} {1,7:N0} KB' -f $_.Name, ($_.Length / 1KB) }
