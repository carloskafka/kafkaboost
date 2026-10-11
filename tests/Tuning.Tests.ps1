# Pester tests for scripts\lib\Tuning.ps1  (written for Pester 3.4, the version that ships with Windows; plain
# `throw` assertions keep them runnable on newer Pester too).   Run:  Invoke-Pester tests
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '..\scripts\lib\Tuning.ps1')

function Assert-Equal($actual, $expected, $what) {
    if ($actual -ne $expected) { throw "$what : expected '$expected' but got '$actual'" }
}
function New-Sandbox {
    $d = Join-Path ([IO.Path]::GetTempPath()) ("tuning_test_" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $d | Out-Null
    Set-Content (Join-Path $d 'ThrottleStop.exe') 'fake' -Encoding ASCII   # never executed
    return $d
}

Describe 'FIVR / V-F encoding (docs/CONFIGURATION.md)' {
    $cases = @{ 0 = '0x00000000'; -50 = '0xF9A00000'; -75 = '0xF6600000'; -90 = '0xF4800000'; -100 = '0xF3400000'
                -115 = '0xF1400000'; -125 = '0xF0000000'; -140 = '0xEE200000' }
    It 'encodes negative offsets like the documented table' {
        foreach ($k in $cases.Keys) { Assert-Equal (ConvertTo-FivrHex $k) $cases[$k] "FIVR $k mV" }
    }
    It 'encodes the V/F point 1 boost of +100 mV' {
        Assert-Equal (ConvertTo-VfHex 100) '0x0CC00000' 'V/F +100 mV'
    }
}

Describe 'Get-Defaults' {
    It 'returns the install dir and task name from config/defaults.json' {
        $d = Get-Defaults
        Assert-Equal $d.taskName 'ThrottleStop_Autostart' 'taskName'
        if (-not $d.installDir) { throw 'installDir is empty' }
    }
}

Describe 'Merge-ThrottleStopSettings' {
    It 'replaces existing keys, appends new ones, keeps the rest and creates no duplicates' {
        $dir = New-Sandbox
        try {
            Set-Content (Join-Path $dir 'ThrottleStop.ini') @('[ThrottleStop]', 'KeepMe=1', 'FIVRVoltage00=0xEE000000', 'Other=7') -Encoding ASCII
            $settings = Join-Path $dir 'settings.ini'
            Set-Content $settings @('; comment', '', 'FIVRVoltage00=0xF3400000', 'NewKey=0x2F') -Encoding ASCII
            $n = Merge-ThrottleStopSettings $dir $settings
            $lines = Get-Content (Join-Path $dir 'ThrottleStop.ini')
            Assert-Equal $n 2 'keys written'
            Assert-Equal @($lines | Where-Object { $_ -eq 'FIVRVoltage00=0xF3400000' }).Count 1 'replaced value'
            Assert-Equal @($lines | Where-Object { $_ -like 'FIVRVoltage00=*' }).Count 1 'no duplicate key'
            Assert-Equal @($lines | Where-Object { $_ -eq 'NewKey=0x2F' }).Count 1 'appended key'
            Assert-Equal @($lines | Where-Object { $_ -eq 'KeepMe=1' }).Count 1 'unrelated key kept'
            Assert-Equal $lines[0] '[ThrottleStop]' 'section header kept'
        } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'creates a minimal ini with a [ThrottleStop] header when none exists' {
        $dir = New-Sandbox
        try {
            $settings = Join-Path $dir 'settings.ini'; Set-Content $settings 'A=1' -Encoding ASCII
            [void](Merge-ThrottleStopSettings $dir $settings)
            $lines = Get-Content (Join-Path $dir 'ThrottleStop.ini')
            Assert-Equal $lines[0] '[ThrottleStop]' 'header'
            Assert-Equal $lines[1] 'A=1' 'key'
        } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'is idempotent' {
        $dir = New-Sandbox
        try {
            $settings = Join-Path $dir 'settings.ini'; Set-Content $settings @('A=1', 'B=2') -Encoding ASCII
            [void](Merge-ThrottleStopSettings $dir $settings); $first = Get-Content (Join-Path $dir 'ThrottleStop.ini')
            [void](Merge-ThrottleStopSettings $dir $settings); $second = Get-Content (Join-Path $dir 'ThrottleStop.ini')
            Assert-Equal ($second -join '|') ($first -join '|') 'second merge changes nothing'
        } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'ignores a ThrottleStop process that is not the one in the install dir' {
        # Regression: an early installer killed every ThrottleStop.exe, including the user's live copy.
        $src = Get-Content (Join-Path $here '..\scripts\lib\Tuning.ps1') -Raw
        if ($src -notmatch 'Where-Object \{ \$_\.Path -eq \$exe \}') { throw 'Merge-ThrottleStopSettings must filter processes by Path' }
    }
}

Describe 'Test-Tuning' {
    It 'passes the ini check when all keys match and flags drift by key name' {
        $dir = New-Sandbox
        try {
            $settings = Join-Path $dir 'settings.ini'; Set-Content $settings @('A=1', 'B=2') -Encoding ASCII
            Set-Content (Join-Path $dir 'ThrottleStop.ini') @('[ThrottleStop]', 'A=1', 'B=2') -Encoding ASCII
            $ok = (Test-Tuning $dir $settings 'No_Such_Task_For_Tests') | Where-Object { $_.name -eq 'ThrottleStop.ini settings' }
            Assert-Equal $ok.ok $true 'matching ini'
            Set-Content (Join-Path $dir 'ThrottleStop.ini') @('[ThrottleStop]', 'A=1', 'B=9') -Encoding ASCII
            $bad = (Test-Tuning $dir $settings 'No_Such_Task_For_Tests') | Where-Object { $_.name -eq 'ThrottleStop.ini settings' }
            Assert-Equal $bad.ok $false 'drifted ini'
            if ($bad.detail -notmatch 'B') { throw "detail should name the drifted key, got '$($bad.detail)'" }
        } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'reports a missing autostart task' {
        $dir = New-Sandbox
        try {
            $settings = Join-Path $dir 'settings.ini'; Set-Content $settings 'A=1' -Encoding ASCII
            $t = (Test-Tuning $dir $settings 'No_Such_Task_For_Tests') | Where-Object { $_.name -eq 'Autostart + watchdog task' }
            Assert-Equal $t.ok $false 'missing task'
        } finally { Remove-Item $dir -Recurse -Force }
    }
}

Describe 'Config template' {
    It 'keeps the tested values in config/ThrottleStop.settings.ini' {
        $cfg = Get-Content (Join-Path $here '..\config\ThrottleStop.settings.ini')
        foreach ($l in 'FIVRVoltage00=0xF3400000', 'FIVRVoltage20=0xF3400000', 'FIVRVoltage50=0xF4800000', 'VFPoint110=0x0CC00000',
                       'OneAD_EAX0=0x2F2F2F2F', 'OneAD_EDX0=0x2F2F2F2F', 'Six50_EAX0=0x00000024',
                       'PowerLimitEAX0=0x00DF8208', 'PowerLimitEDX0=0x004282A8') {
            if ($cfg -notcontains $l) { throw "missing $l" }
        }
    }
}
