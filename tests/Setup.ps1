# Shared setup for the Pester tests: dot-source it inside BeforeAll ( . (Join-Path $PSScriptRoot 'Setup.ps1') ).
# Works on Pester 3.4 and 5 because it is a file, not a variable that only exists at discovery time.
$root = Join-Path $PSScriptRoot '..'
. (Join-Path $root 'scripts\lib\Tuning.ps1')
. (Join-Path $root 'scripts\lib\Health.ps1')
function Assert-Equal($actual, $expected, $what) {
    if ($actual -ne $expected) { throw "$what : expected '$expected' but got '$actual'" }
}
function New-Sandbox {
    $d = Join-Path ([IO.Path]::GetTempPath()) ("tuning_test_" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $d | Out-Null
    Set-Content (Join-Path $d 'ThrottleStop.exe') 'fake' -Encoding ASCII   # never executed
    return $d
}