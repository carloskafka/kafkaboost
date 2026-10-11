<#
.SYNOPSIS  Regenerates docs/assets/*.png by walking the whole app UI in demo mode (sample data, nothing on the PC is touched).
.EXAMPLE   .\tools\make-shots.ps1
#>
$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'
$out = Join-Path $repo 'docs\assets'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Run 'npm install' in app\ first." }
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$env:WIZARD_DEMO = '1'; $env:WIZARD_SHOTS = $out
try {
    $p = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $app -PassThru -WindowStyle Minimized
    if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'timed out' }
} finally { Remove-Item Env:WIZARD_DEMO, Env:WIZARD_SHOTS -ErrorAction SilentlyContinue }
Get-ChildItem $out | ForEach-Object { '{0,-24} {1,7:N0} KB' -f $_.Name, ($_.Length / 1KB) }
