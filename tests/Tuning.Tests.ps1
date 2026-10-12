# Pester tests for scripts\lib\Tuning.ps1 and scripts\lib\Health.ps1.
# Written to run on Pester 3.4 (ships with Windows) and on Pester 5 (CI): setup lives in BeforeAll inside each
# Describe, and assertions are plain `throw`s instead of `Should`.   Run:  Invoke-Pester tests

Describe 'FIVR / V-F encoding (docs/CONFIGURATION.md)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'encodes negative offsets like the documented table' {
        $cases = @{ 0 = '0x00000000'; -50 = '0xF9A00000'; -75 = '0xF6600000'; -90 = '0xF4800000'; -100 = '0xF3400000'
                    -115 = '0xF1400000'; -125 = '0xF0000000'; -140 = '0xEE200000' }
        foreach ($k in $cases.Keys) { Assert-Equal (ConvertTo-FivrHex $k) $cases[$k] "FIVR $k mV" }
    }
    It 'encodes the V/F point 1 boost of +100 mV' {
        Assert-Equal (ConvertTo-VfHex 100) '0x0CC00000' 'V/F +100 mV'
    }
}

Describe 'Get-Defaults' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'returns the install dir and task name from config/defaults.json' {
        $d = Get-Defaults
        Assert-Equal $d.taskName 'ThrottleStop_Autostart' 'taskName'
        if (-not $d.installDir) { throw 'installDir is empty' }
    }
}

Describe 'Merge-ThrottleStopSettings' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
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
    It 'only stops a ThrottleStop whose path is the install dir exe' {
        # Regression: an early installer killed every ThrottleStop.exe, including the user's live copy.
        $src = Get-Content (Join-Path $PSScriptRoot '..\scripts\lib\Tuning.ps1') -Raw
        if ($src -notmatch 'Where-Object \{ \$_\.Path -eq \$exe \}') { throw 'Merge-ThrottleStopSettings must filter processes by Path' }
    }
}

Describe 'Test-Tuning' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
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

Describe 'Health check helpers' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'Compare-IniSettings reports changed and missing keys with expected and actual values' {
        $d = Compare-IniSettings @('[ThrottleStop]', 'A=1', 'B=9') @('A=1', 'B=2', 'C=3')
        Assert-Equal $d.Count 2 'drifted keys'
        $b = $d | Where-Object { $_.key -eq 'B' }; Assert-Equal $b.expected '2' 'B expected'; Assert-Equal $b.actual '9' 'B actual'
        $c = $d | Where-Object { $_.key -eq 'C' }; if ($null -ne $c.actual) { throw 'missing key should have a null actual value' }
    }
    It 'Compare-IniSettings is empty when everything matches (and ignores comments)' {
        $d = Compare-IniSettings @('A=1', 'B=2') @('; comment', '', 'A=1', 'B=2')
        Assert-Equal $d.Count 0 'no drift'
    }
    It 'Get-TurboCapMHz reads the lowest P-core ratio from the template' {
        Assert-Equal (Get-TurboCapMHz @('OneAD_EAX0=0x2F2F2F2F', 'OneAD_EDX0=0x2F2F2F2F')) 4700 'uniform 47x'
        Assert-Equal (Get-TurboCapMHz @('OneAD_EAX0=0x34343636', 'OneAD_EDX0=0x31313232')) 4900 'stock groups -> lowest is 49x'
        if ($null -ne (Get-TurboCapMHz @('A=1'))) { throw 'no turbo keys should give $null' }
    }
    It 'Get-Verdict: fail beats warn beats ok, and info never counts' {
        $ok   = [pscustomobject]@{ ok = $true;  severity = 'fail' }
        $warn = [pscustomobject]@{ ok = $false; severity = 'warn' }
        $fail = [pscustomobject]@{ ok = $false; severity = 'fail' }
        $info = [pscustomobject]@{ ok = $false; severity = 'info' }
        Assert-Equal (Get-Verdict @($ok, $info)) 'ok' 'info only'
        Assert-Equal (Get-Verdict @($ok, $warn, $info)) 'warn' 'warn'
        Assert-Equal (Get-Verdict @($ok, $warn, $fail)) 'fail' 'fail'
    }
}

Describe 'Config template' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'keeps the tested values in config/ThrottleStop.settings.ini' {
        $cfg = Get-Content (Join-Path $PSScriptRoot '..\config\ThrottleStop.settings.ini')
        foreach ($l in 'FIVRVoltage00=0xF3400000', 'FIVRVoltage20=0xF3400000', 'FIVRVoltage50=0xF4800000', 'VFPoint110=0x0CC00000',
                       'OneAD_EAX0=0x2F2F2F2F', 'OneAD_EDX0=0x2F2F2F2F', 'Six50_EAX0=0x00000024',
                       'PowerLimitEAX0=0x00DF8208', 'PowerLimitEDX0=0x004282A8') {
            if ($cfg -notcontains $l) { throw "missing $l" }
        }
    }
}

Describe 'Entry scripts started with powershell -File (how install.cmd and the app start them)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'no script uses $PSScriptRoot in a param() default (it is empty under -File in Windows PowerShell 5.1)' {
        $bad = @()
        Get-ChildItem (Join-Path $PSScriptRoot '..\scripts') -Recurse -Filter *.ps1 | ForEach-Object {
            $ast = [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$null)
            if ($ast.ParamBlock) {
                $hits = $ast.ParamBlock.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.UserPath -eq 'PSScriptRoot' }, $true)
                if ($hits.Count) { $bad += $_.Name }
            }
        }
        if ($bad.Count) { throw "param() default uses PSScriptRoot in: $($bad -join ', ')" }
    }
    It 'Install-Tuning.ps1 gets past argument binding under -File (regression: install.cmd failed in Join-Path)' {
        $dir = New-Sandbox
        try {
            $script = (Resolve-Path (Join-Path $PSScriptRoot '..\scripts\Install-Tuning.ps1')).Path
            $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -InstallDir $dir -SkipVBS -NoTask -NoStart 2>&1 | Out-String
            if ($out -match 'ParameterArgumentValidationError') { throw "argument binding failed:`n$out" }
        } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'Steps.ps1 runs the read-only detect step under -File' {
        $script = (Resolve-Path (Join-Path $PSScriptRoot '..\scripts\Steps.ps1')).Path
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Step detect 2>&1 | Out-String
        if ($out -notmatch 'RESULT: ') { throw "no RESULT line:`n$out" }
    }
}

Describe 'Resolve-InstallDir' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'reads the exe path out of the watchdog task arguments' {
        $a = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "if (-not (Get-Process ThrottleStop -ErrorAction SilentlyContinue)) { Start-Process -FilePath ''C:\Users\me\Downloads\ThrottleStop_9.7.3\ThrottleStop.exe'' -WorkingDirectory ''C:\Users\me\Downloads\ThrottleStop_9.7.3'' }"'
        Assert-Equal (Get-ExeFromTaskArguments $a) 'C:\Users\me\Downloads\ThrottleStop_9.7.3\ThrottleStop.exe' 'exe path'
        if ($null -ne (Get-ExeFromTaskArguments '-NoProfile -Command "Get-Date"')) { throw 'unrelated arguments must give $null' }
    }
    It 'keeps the requested folder when ThrottleStop is there' {
        $dir = New-Sandbox
        try { Assert-Equal (Resolve-InstallDir $dir 'No_Such_Task_For_Tests') $dir 'requested folder' } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'falls back to the requested folder when nothing is installed, there is no task and nothing is found in the search roots' {
        $empty = New-Sandbox; Remove-Item (Join-Path $empty 'ThrottleStop.exe') -Force   # an empty search root, so the real Downloads is not used
        try {
            $nowhere = Join-Path $empty 'no_throttlestop_here'
            Assert-Equal (Resolve-InstallDir $nowhere 'No_Such_Task_For_Tests' @($empty)) $nowhere 'fallback'
        } finally { Remove-Item $empty -Recurse -Force }
    }
}

Describe 'Find-ThrottleStopFolder' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'finds an extracted ThrottleStop one level down and returns its folder' {
        $root = New-Sandbox; Remove-Item (Join-Path $root 'ThrottleStop.exe') -Force
        try {
            $sub = Join-Path $root 'ThrottleStop_9.7.3'; New-Item -ItemType Directory $sub | Out-Null
            Set-Content (Join-Path $sub 'ThrottleStop.exe') 'fake' -Encoding ASCII
            Assert-Equal (Find-ThrottleStopFolder @($root)) $sub 'folder'
        } finally { Remove-Item $root -Recurse -Force }
    }
    It 'returns nothing when there is no ThrottleStop (and ignores roots that do not exist)' {
        $root = New-Sandbox; Remove-Item (Join-Path $root 'ThrottleStop.exe') -Force
        try { if ($null -ne (Find-ThrottleStopFolder @($root, 'Z:\no\such\root'))) { throw 'expected $null' } } finally { Remove-Item $root -Recurse -Force }
    }
    It 'Resolve-InstallDir uses the folder it finds when the requested one is empty and there is no task' {
        $root = New-Sandbox; Remove-Item (Join-Path $root 'ThrottleStop.exe') -Force
        try {
            $sub = Join-Path $root 'ts'; New-Item -ItemType Directory $sub | Out-Null
            Set-Content (Join-Path $sub 'ThrottleStop.exe') 'fake' -Encoding ASCII
            $requested = Join-Path $root 'does_not_exist'
            Assert-Equal (Resolve-InstallDir $requested 'No_Such_Task_For_Tests' @($root)) $sub 'resolved'
        } finally { Remove-Item $root -Recurse -Force }
    }
}

Describe 'Remove-OldBackups' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'keeps the newest N backups and deletes the rest, leaving other files alone' {
        $dir = New-Sandbox
        try {
            1..6 | ForEach-Object {
                $f = Join-Path $dir ("ThrottleStop.ini.bak_2026101$_")
                Set-Content $f "bak $_" -Encoding ASCII
                (Get-Item $f).LastWriteTime = (Get-Date).AddMinutes(-60 + $_)
            }
            Set-Content (Join-Path $dir 'ThrottleStop.ini') 'live' -Encoding ASCII
            $n = Remove-OldBackups $dir 3
            Assert-Equal $n 3 'removed'
            $left = @(Get-ChildItem $dir -Filter 'ThrottleStop.ini.bak_*' | Select-Object -ExpandProperty Name | Sort-Object)
            Assert-Equal ($left -join ',') 'ThrottleStop.ini.bak_20261014,ThrottleStop.ini.bak_20261015,ThrottleStop.ini.bak_20261016' 'newest kept'
            if (-not (Test-Path (Join-Path $dir 'ThrottleStop.ini'))) { throw 'the live ini must not be touched' }
        } finally { Remove-Item $dir -Recurse -Force }
    }
    It 'returns 0 for a folder that does not exist' {
        Assert-Equal (Remove-OldBackups 'Z:\no\such\folder' 3) 0 'missing folder'
    }
}

Describe 'ThrottleStop download helpers (TechPowerUp flow)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    It 'reads the first hidden form value by name' {
        $html = '<form><input type="hidden" name="id" value="2835" /></form><form><input type="hidden" name="id" value="2775" /></form><input type="hidden" name="server_id" value="26">'
        Assert-Equal (Get-HtmlFieldValue $html 'id') '2835' 'newest version id'
        Assert-Equal (Get-HtmlFieldValue $html 'server_id') '26' 'server'
        Assert-Equal (Get-HtmlFieldValue $html 'nothing') $null 'absent'
    }
    It 'accepts a zip that holds ThrottleStop.exe and rejects HTML or other zips' {
        $d = New-Sandbox
        try {
            $src = Join-Path $d 'src'; New-Item -ItemType Directory $src | Out-Null
            Set-Content (Join-Path $src 'ThrottleStop.exe') 'x' -Encoding ASCII
            $good = Join-Path $d 'good.zip'; Compress-Archive -Path (Join-Path $src 'ThrottleStop.exe') -DestinationPath $good
            Set-Content (Join-Path $src 'other.txt') 'x' -Encoding ASCII
            $bad = Join-Path $d 'bad.zip'; Compress-Archive -Path (Join-Path $src 'other.txt') -DestinationPath $bad
            $html = Join-Path $d 'page.zip'; Set-Content $html '<html>error</html>' -Encoding ASCII
            Assert-Equal (Test-ThrottleStopZip $good) $true 'good zip'
            Assert-Equal (Test-ThrottleStopZip $bad) $false 'zip without the exe'
            Assert-Equal (Test-ThrottleStopZip $html) $false 'html saved as zip'
            Assert-Equal (Test-ThrottleStopZip (Join-Path $d 'missing.zip')) $false 'missing file'
        } finally { Remove-Item $d -Recurse -Force }
    }
}
