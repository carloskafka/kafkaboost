# Shared setup for the Pester tests: dot-source it inside BeforeAll ( . (Join-Path $PSScriptRoot 'Setup.ps1') ).
# Works on Pester 3.4 and 5 because it is a file, not a variable that only exists at discovery time.
$root = Join-Path $PSScriptRoot '..'
. (Join-Path $root 'scripts\lib\Tuning.ps1')
. (Join-Path $root 'scripts\lib\Health.ps1')
. (Join-Path $root 'scripts\lib\Tweaks.ps1')
function Assert-Equal($actual, $expected, $what) {
    if ($actual -ne $expected) { throw "$what : expected '$expected' but got '$actual'" }
}
function New-Sandbox {
    $d = Join-Path ([IO.Path]::GetTempPath()) ("tuning_test_" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $d | Out-Null
    Set-Content (Join-Path $d 'ThrottleStop.exe') 'fake' -Encoding ASCII   # never executed
    return $d
}

# Helpers shared by the test files. They live here (not at the top of each file) because Pester 5 does not make functions
# defined at file level available when the tests run; every Describe dot-sources this file in BeforeAll.
function New-TweakSandbox {
    $key = "KafkaBoostTest_" + [guid]::NewGuid().ToString('N')
    $script:SbRoot = "HKCU:\Software\$key"
    New-Item -Path $script:SbRoot -Force | Out-Null
    $script:RegMap = @{ HKLM = $script:SbRoot; HKCU = $script:SbRoot }
    $script:TweakStatePath = Join-Path ([IO.Path]::GetTempPath()) ("kb_state_" + [guid]::NewGuid().ToString('N') + '.json')
    $cat = Join-Path ([IO.Path]::GetTempPath()) ("kb_cat_" + [guid]::NewGuid().ToString('N') + '.json')
    $json = @'
{ "version": 1, "categories": ["general"], "tweaks": [
  { "id": "t-dword", "category": "general", "risk": "safe", "recommended": true, "needsReboot": false,
    "actions": [ { "type": "registry", "path": "HKCU:\\A\\B", "name": "V", "kind": "DWord", "on": 0, "off": 1 } ] },
  { "id": "t-policy", "category": "general", "risk": "safe", "recommended": true, "needsReboot": false,
    "actions": [ { "type": "registry", "path": "HKCU:\\Pol", "name": "P", "kind": "DWord", "on": 2, "off": null } ] },
  { "id": "t-big", "category": "general", "risk": "advanced", "recommended": false, "needsReboot": false,
    "actions": [ { "type": "registry", "path": "HKCU:\\Big", "name": "N", "kind": "DWord", "on": 4294967295, "off": 10 } ] },
  { "id": "t-string", "category": "general", "risk": "safe", "recommended": false, "needsReboot": false,
    "actions": [ { "type": "registry", "path": "HKCU:\\Mouse", "name": "S", "kind": "String", "on": "0", "off": "1" } ] },
  { "id": "t-key", "category": "general", "risk": "safe", "recommended": false, "needsReboot": false,
    "actions": [ { "type": "regkey", "path": "HKCU:\\Classes\\Menu\\Inproc" } ] },
  { "id": "t-multi", "category": "general", "risk": "safe", "recommended": false, "needsReboot": false,
    "actions": [ { "type": "registry", "path": "HKCU:\\M", "name": "One", "kind": "DWord", "on": 1, "off": null },
                 { "type": "bogus" } ] },
  { "id": "t-risky", "category": "general", "risk": "risky", "recommended": false, "needsReboot": false,
    "actions": [ { "type": "registry", "path": "HKCU:\\R", "name": "X", "kind": "DWord", "on": 1, "off": null } ] },
  { "id": "t-new", "category": "general", "risk": "safe", "recommended": false, "needsReboot": false, "minBuild": 99999,
    "actions": [ { "type": "registry", "path": "HKCU:\\N", "name": "X", "kind": "DWord", "on": 1, "off": null } ] }
] }
'@
    [IO.File]::WriteAllText($cat, $json, [Text.UTF8Encoding]::new($false))
    return $cat
}
function Remove-TweakSandbox {
    if ($script:SbRoot -and $script:SbRoot -like 'HKCU:\Software\KafkaBoostTest_*' -and (Test-Path -LiteralPath $script:SbRoot)) { Remove-Item -LiteralPath $script:SbRoot -Recurse -Force }
    if ($script:TweakStatePath -and (Test-Path -LiteralPath $script:TweakStatePath)) { Remove-Item -LiteralPath $script:TweakStatePath -Force }
    $script:RegMap = @{ HKLM = 'HKLM:'; HKCU = 'HKCU:' }
}
function Get-Sb([string]$Sub, [string]$Name) { (Get-ItemProperty -LiteralPath (Join-Path $script:SbRoot $Sub) -Name $Name -ErrorAction SilentlyContinue).$Name }

function New-CleanSandbox {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('kb_clean_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $root | Out-Null
    return $root
}
function Add-File([string]$Path, [int]$Bytes) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllBytes($Path, (New-Object byte[] $Bytes))
}
