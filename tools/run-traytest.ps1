<#
.SYNOPSIS  Real-mode tray check: closing the window must keep the process and the tray icon alive, and the window must reopen.
.EXAMPLE   .\tools\run-traytest.ps1
#>
$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Run 'npm install' in app\ first." }
$out = Join-Path $env:TEMP 'kb_traytest.json'
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
$env:WIZARD_TRAYTEST = $out
try {
    $p = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $app -PassThru -WindowStyle Minimized
    if (-not $p.WaitForExit(90000)) { $p.Kill(); throw 'timed out' }
} finally { Remove-Item Env:WIZARD_TRAYTEST -ErrorAction SilentlyContinue }
if (-not (Test-Path $out)) { throw 'no result file' }
$r = Get-Content $out -Raw | ConvertFrom-Json
$r | ConvertTo-Json -Depth 4 -Compress
$ok = $r.before.windowVisible -and (-not $r.afterClose.windowVisible) -and (-not $r.afterClose.windowDestroyed) -and $r.afterClose.trayExists -and $r.afterOpenFromTray.windowVisible
if ($ok) { 'TRAY TEST PASSED' } else { 'TRAY TEST FAILED'; exit 1 }
