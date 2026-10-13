# Pester tests for scripts\lib\Tweaks.ps1 (the tweak engine) and config\tweaks.json (the catalog).
# The engine runs against a SANDBOX registry key and a temp state file, never the real keys. Plain `throw` assertions (Pester 3.4 and 5).

Describe 'Tweak engine on a sandbox registry' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1') }
    BeforeEach { $script:cat = New-TweakSandbox }
    AfterEach { Remove-TweakSandbox }

    It 'applies a DWord and reverts to the value that was there before' {
        New-Item (Join-Path $script:SbRoot 'A\B') -Force | Out-Null
        Set-ItemProperty (Join-Path $script:SbRoot 'A\B') -Name V -Value 7 -Type DWord
        $r = Set-Tweak 't-dword' $true -CatalogPath $script:cat
        Assert-Equal $r.ok $true 'apply ok'
        Assert-Equal (Get-Sb 'A\B' 'V') 0 'value after apply'
        $r = Set-Tweak 't-dword' $false -CatalogPath $script:cat
        Assert-Equal $r.ok $true 'revert ok'
        Assert-Equal (Get-Sb 'A\B' 'V') 7 'the ORIGINAL 7 is back (not the catalog off value 1)'
    }
    It 'removes a value that did not exist before (policy style) on revert' {
        Set-Tweak 't-policy' $true -CatalogPath $script:cat | Out-Null
        Assert-Equal (Get-Sb 'Pol' 'P') 2 'applied'
        Set-Tweak 't-policy' $false -CatalogPath $script:cat | Out-Null
        if ($null -ne (Get-Sb 'Pol' 'P')) { throw 'the value should be gone again' }
    }
    It 'handles 0xFFFFFFFF written as 4294967295' {
        Set-Tweak 't-big' $true -CatalogPath $script:cat | Out-Null
        Assert-Equal (ConvertTo-DwordInt (Get-Sb 'Big' 'N')) -1 'stored as the 32-bit pattern 0xFFFFFFFF'
        $t = (Get-TweakCatalog $script:cat).tweaks | Where-Object { $_.id -eq 't-big' }
        Assert-Equal (Get-TweakStatus $t (Get-TweakState) 26300) 'active' 'status after apply'
        Set-Tweak 't-big' $false -CatalogPath $script:cat | Out-Null
        if ($null -ne (Get-Sb 'Big' 'N')) { throw 'value did not exist before, should be removed' }
    }
    It 'handles string values' {
        New-Item (Join-Path $script:SbRoot 'Mouse') -Force | Out-Null
        Set-ItemProperty (Join-Path $script:SbRoot 'Mouse') -Name S -Value '2' -Type String
        Set-Tweak 't-string' $true -CatalogPath $script:cat | Out-Null
        Assert-Equal (Get-Sb 'Mouse' 'S') '0' 'applied'
        Set-Tweak 't-string' $false -CatalogPath $script:cat | Out-Null
        Assert-Equal (Get-Sb 'Mouse' 'S') '2' 'restored'
    }
    It 'creates and removes a registry key' {
        Set-Tweak 't-key' $true -CatalogPath $script:cat | Out-Null
        if (-not (Test-Path (Join-Path $script:SbRoot 'Classes\Menu\Inproc'))) { throw 'key not created' }
        Set-Tweak 't-key' $false -CatalogPath $script:cat | Out-Null
        if (Test-Path (Join-Path $script:SbRoot 'Classes\Menu\Inproc')) { throw 'key not removed' }
    }
    It 'is all-or-nothing: a failing second action undoes the first' {
        $r = Set-Tweak 't-multi' $true -CatalogPath $script:cat
        Assert-Equal $r.ok $false 'must fail'
        Assert-Equal $r.code 'tweak.error.failed' 'code'
        if ($null -ne (Get-Sb 'M' 'One')) { throw 'the first action was not undone' }
        if ((Get-TweakState).tweaks.PSObject.Properties['t-multi']) { throw 'a failed tweak must not be recorded' }
    }
    It 'refuses a risky tweak without consent and accepts it with -AllowRisky' {
        $r = Set-Tweak 't-risky' $true -CatalogPath $script:cat
        Assert-Equal $r.code 'tweak.error.riskyNeedsConsent' 'code'
        if ($null -ne (Get-Sb 'R' 'X')) { throw 'nothing may be written without consent' }
        $r = Set-Tweak 't-risky' $true -AllowRisky -CatalogPath $script:cat
        Assert-Equal $r.ok $true 'with consent'
    }
    It 'refuses unknown ids and tweaks for a newer Windows' {
        Assert-Equal (Set-Tweak 'nope' $true -CatalogPath $script:cat).code 'tweak.error.unknown' 'unknown'
        Assert-Equal (Set-Tweak 't-new' $true -CatalogPath $script:cat).code 'tweak.error.notForThisWindows' 'minBuild'
    }
    It 'reports inactive, active and unavailable' {
        $c = Get-TweakCatalog $script:cat
        $pol = $c.tweaks | Where-Object { $_.id -eq 't-policy' }
        $new = $c.tweaks | Where-Object { $_.id -eq 't-new' }
        Assert-Equal (Get-TweakStatus $pol (Get-TweakState) 26300) 'inactive' 'before'
        Set-Tweak 't-policy' $true -CatalogPath $script:cat | Out-Null
        Assert-Equal (Get-TweakStatus $pol (Get-TweakState) 26300) 'active' 'after'
        Assert-Equal (Get-TweakStatus $new (Get-TweakState) 26300) 'unavailable' 'minBuild'
    }
    It 'reports partial when only some actions are in place' {
        $two = Join-Path ([IO.Path]::GetTempPath()) ("kb_cat2_" + [guid]::NewGuid().ToString('N') + '.json')
        $j = '{"version":1,"categories":["general"],"tweaks":[{"id":"t2","category":"general","risk":"safe","recommended":false,"needsReboot":false,"actions":[' +
             '{"type":"registry","path":"HKCU:\\X","name":"a","kind":"DWord","on":1,"off":null},{"type":"registry","path":"HKCU:\\X","name":"b","kind":"DWord","on":1,"off":null}]}]}'
        [IO.File]::WriteAllText($two, $j)
        New-Item (Join-Path $script:SbRoot 'X') -Force | Out-Null
        Set-ItemProperty (Join-Path $script:SbRoot 'X') -Name a -Value 1 -Type DWord
        $t = (Get-TweakCatalog $two).tweaks[0]
        Assert-Equal (Get-TweakStatus $t (Get-TweakState) 26300) 'partial' 'one of two'
        Remove-Item $two -Force
    }
    It 'applies only safe recommended tweaks in "recommended" and keeps going after a failure' {
        $res = @(Set-RecommendedTweaks $script:cat)
        $ids = @($res | ForEach-Object { $_.id })
        if ($ids -contains 't-risky' -or $ids -contains 't-big' -or $ids -contains 't-multi') { throw "a non-recommended or risky tweak was applied: $ids" }
        if ($ids -notcontains 't-dword' -or $ids -notcontains 't-policy') { throw "missing: $ids" }
    }
}

Describe 'Tweak catalog (config\tweaks.json)' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'Setup.ps1')
        $script:real = Get-TweakCatalog (Join-Path $PSScriptRoot '..\config\tweaks.json')
        $i18n = Join-Path $PSScriptRoot '..\app\renderer\i18n'
        $script:en = [IO.File]::ReadAllText((Join-Path $i18n 'en.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
        $script:pt = [IO.File]::ReadAllText((Join-Path $i18n 'pt-BR.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
    }
    It 'has unique ids and valid categories and risks' {
        $ids = @($script:real.tweaks | ForEach-Object { $_.id })
        Assert-Equal @($ids | Select-Object -Unique).Count $ids.Count 'unique ids'
        foreach ($t in $script:real.tweaks) {
            if ($t.category -notin $script:real.categories) { throw "$($t.id): bad category $($t.category)" }
            if ($t.risk -notin 'safe', 'advanced', 'risky') { throw "$($t.id): bad risk" }
            if (-not @($t.actions).Count) { throw "$($t.id): no actions" }
        }
    }
    It 'gives every action a known type and the fields that type needs' {
        foreach ($t in $script:real.tweaks) {
            foreach ($a in $t.actions) {
                if ($a.type -notin 'registry', 'regkey', 'service', 'powerplan', 'dns', 'defender', 'vbs') { throw "$($t.id): type $($a.type)" }
                if ($a.type -eq 'registry') {
                    foreach ($f in 'path', 'name', 'kind') { if (-not $a.$f) { throw "$($t.id): registry action without $f" } }
                    if ($a.kind -notin 'DWord', 'String') { throw "$($t.id): kind $($a.kind)" }
                    if ($a.path -notmatch '^(HKLM|HKCU):\\') { throw "$($t.id): path $($a.path)" }
                    if ($null -eq $a.on) { throw "$($t.id): no on value" }
                }
                if ($a.type -eq 'regkey' -and $a.path -notmatch '^(HKLM|HKCU):\\') { throw "$($t.id): regkey path" }
                if ($a.type -eq 'service' -and (-not $a.name -or -not $a.on -or -not $a.off)) { throw "$($t.id): service fields" }
            }
        }
    }
    It 'never marks a risky tweak as recommended' {
        foreach ($t in $script:real.tweaks) { if ($t.risk -eq 'risky' -and $t.recommended) { throw "$($t.id) is risky AND recommended" } }
    }
    It 'has a title and description in English and Portuguese for every tweak' {
        foreach ($t in $script:real.tweaks) {
            foreach ($k in "tweak.$($t.id).title", "tweak.$($t.id).desc") {
                foreach ($d in $script:en, $script:pt) { if (-not $d.PSObject.Properties[$k] -or -not $d.$k) { throw "missing text $k" } }
            }
        }
        foreach ($c in $script:real.categories) {
            if (-not $script:en.PSObject.Properties["tweak.cat.$c"] -or -not $script:pt.PSObject.Properties["tweak.cat.$c"]) { throw "missing category text $c" }
        }
    }
    It 'reads every tweak status on this PC without throwing (read-only)' {
        $list = @(Get-TweakStatuses (Join-Path $PSScriptRoot '..\config\tweaks.json'))
        Assert-Equal $list.Count $script:real.tweaks.Count 'one status per tweak'
        foreach ($s in $list) { if ($s.status -notin 'active', 'inactive', 'partial', 'unavailable') { throw "$($s.id): status $($s.status)" } }
    }
}
