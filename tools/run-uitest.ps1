<#
.SYNOPSIS  Runs the UI interaction test (demo mode, throw-away profile) on Windows, then on a fake Linux platform, and prints the results.
.EXAMPLE   .\tools\run-uitest.ps1
#>
$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Run 'npm install' in app\ first." }
$failed = 0
foreach ($platform in 'win32', 'linux') {
    $out = Join-Path $env:TEMP "kb_uitest_$platform.json"
    if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
    $env:WIZARD_DEMO = '1'; $env:WIZARD_UITEST = $out
    if ($platform -ne 'win32') { $env:WIZARD_FAKE_PLATFORM = $platform } else { Remove-Item Env:WIZARD_FAKE_PLATFORM -ErrorAction SilentlyContinue }
    try {
        $p = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $app -PassThru -WindowStyle Minimized
        if (-not $p.WaitForExit(120000)) { $p.Kill(); Write-Host "[$platform] timed out" -ForegroundColor Red; $failed++; continue }
    } finally { Remove-Item Env:WIZARD_DEMO, Env:WIZARD_UITEST, Env:WIZARD_FAKE_PLATFORM -ErrorAction SilentlyContinue }
    if (-not (Test-Path $out)) { Write-Host "[$platform] no result file" -ForegroundColor Red; $failed++; continue }
    $r = Get-Content $out -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "[$platform] passed $($r.passed), failed $($r.failed)"
    $r.results | Where-Object { -not $_.ok } | ForEach-Object { Write-Host "   FAIL: $($_.name) $($_.detail)" -ForegroundColor Red }
    $failed += $r.failed
}
if ($failed) { exit 1 }
