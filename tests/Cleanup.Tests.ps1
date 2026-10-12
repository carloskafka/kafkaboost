# Pester tests for scripts\lib\Cleanup.ps1. Everything runs in sandbox folders (CleanupMap), never on the real temp folders.

function New-CleanSandbox {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('kb_clean_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $root | Out-Null
    return $root
}
function Add-File([string]$Path, [int]$Bytes) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllBytes($Path, (New-Object byte[] $Bytes))
}

Describe 'Cleanup (sandbox folders)' {
    BeforeAll { . (Join-Path $PSScriptRoot 'Setup.ps1'); . (Join-Path $PSScriptRoot '..\scripts\lib\Cleanup.ps1') }
    AfterEach { $script:CleanupMap = $null; if ($script:sb -and (Test-Path $script:sb)) { Remove-Item $script:sb -Recurse -Force -ErrorAction SilentlyContinue } }

    It 'measures sizes without deleting anything (dry run)' {
        $script:sb = New-CleanSandbox
        Add-File (Join-Path $script:sb 'temp\a.tmp') 1000
        Add-File (Join-Path $script:sb 'temp\sub\b.tmp') 2000
        $script:CleanupMap = @{ 'user-temp' = @((Join-Path $script:sb 'temp')) }
        $s = Get-CleanupSizes | Where-Object { $_.id -eq 'user-temp' }
        Assert-Equal $s.bytes 3000 'bytes'
        Assert-Equal $s.files 2 'files'
        if (-not (Test-Path (Join-Path $script:sb 'temp\a.tmp'))) { throw 'dry run deleted a file' }
    }
    It 'deletes the contents, removes empty sub-folders and keeps the target folder' {
        $script:sb = New-CleanSandbox
        $t = Join-Path $script:sb 'temp'
        Add-File (Join-Path $t 'a.tmp') 500; Add-File (Join-Path $t 'sub\deep\b.tmp') 700
        $script:CleanupMap = @{ 'user-temp' = @($t) }
        $r = @(Invoke-Cleanup @('user-temp'))
        Assert-Equal $r[0].bytes 1200 'freed'
        Assert-Equal $r[0].files 2 'deleted'
        if (-not (Test-Path $t)) { throw 'the target folder itself must stay' }
        Assert-Equal @(Get-ChildItem $t -Force).Count 0 'folder is empty'
    }
    It 'only touches the ids it was asked for' {
        $script:sb = New-CleanSandbox
        Add-File (Join-Path $script:sb 'a\x.tmp') 100; Add-File (Join-Path $script:sb 'b\y.tmp') 100
        $script:CleanupMap = @{ 'user-temp' = @((Join-Path $script:sb 'a')); 'win-temp' = @((Join-Path $script:sb 'b')) }
        Invoke-Cleanup @('user-temp', 'not-a-target') | Out-Null
        if (Test-Path (Join-Path $script:sb 'a\x.tmp')) { throw 'asked target not cleaned' }
        if (-not (Test-Path (Join-Path $script:sb 'b\y.tmp'))) { throw 'a target that was not asked for was cleaned' }
    }
    It 'applies the file filter (thumbnail cache keeps every other file)' {
        $script:sb = New-CleanSandbox
        $d = Join-Path $script:sb 'explorer'
        Add-File (Join-Path $d 'thumbcache_256.db') 100; Add-File (Join-Path $d 'keep.txt') 100
        $script:CleanupMap = @{ 'thumbnails' = @($d) }
        Invoke-Cleanup @('thumbnails') | Out-Null
        if (Test-Path (Join-Path $d 'thumbcache_256.db')) { throw 'thumbcache not deleted' }
        if (-not (Test-Path (Join-Path $d 'keep.txt'))) { throw 'other file was deleted' }
    }
    It 'skips a locked file instead of failing' {
        $script:sb = New-CleanSandbox
        $t = Join-Path $script:sb 'temp'
        Add-File (Join-Path $t 'locked.tmp') 100; Add-File (Join-Path $t 'free.tmp') 100
        $script:CleanupMap = @{ 'user-temp' = @($t) }
        $fs = [IO.File]::Open((Join-Path $t 'locked.tmp'), 'Open', 'ReadWrite', 'None')
        try { $r = @(Invoke-Cleanup @('user-temp')) } finally { $fs.Dispose() }
        Assert-Equal $r[0].skipped 1 'skipped'
        Assert-Equal $r[0].files 1 'deleted'
        if (-not (Test-Path (Join-Path $t 'locked.tmp'))) { throw 'locked file vanished' }
    }
    It 'does not follow a junction out of the target' {
        $script:sb = New-CleanSandbox
        $outside = Join-Path $script:sb 'outside'; Add-File (Join-Path $outside 'precious.txt') 100
        $t = Join-Path $script:sb 'temp'; New-Item -ItemType Directory $t | Out-Null
        cmd /c mklink /J "$t\link" "$outside" | Out-Null
        $script:CleanupMap = @{ 'user-temp' = @($t) }
        Invoke-Cleanup @('user-temp') | Out-Null
        if (-not (Test-Path (Join-Path $outside 'precious.txt'))) { throw 'the cleanup followed a junction and deleted outside the target' }
    }
    It 'returns nothing for a folder that does not exist' {
        $script:CleanupMap = @{ 'user-temp' = @('C:\definitely\not\here') }
        $s = Get-CleanupSizes | Where-Object { $_.id -eq 'user-temp' }
        Assert-Equal $s.bytes 0 'bytes'
    }
    It 'marks only the Recycle Bin as dangerous' {
        $d = @(Get-CleanupTargets | Where-Object { $_.danger } | ForEach-Object { $_.id })
        Assert-Equal ($d -join ',') 'recycle-bin' 'dangerous ids'
    }
}
