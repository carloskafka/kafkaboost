param(
    [int]$Minutes = 60,
    [int]$Seconds = 0,
    [int]$IntervalSec = 2,
    [string]$Out   # default: <repo>\logs\perf_log.csv
)
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Out) {
    $logs = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'logs'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $Out = Join-Path $logs 'perf_log.csv'
}

$start = Get-Date
$dur = if ($Seconds -gt 0) { New-Object TimeSpan(0, 0, $Seconds) } else { New-Object TimeSpan(0, $Minutes, 0) }
$end = $start.Add($dur)

'timestamp;realMHzAvg;realMHzMax;perfPct;maxFreqPct;cpuBusyPct;availMB;committedMB;e37_sinceStart;whea_sinceStart' |
    Out-File -FilePath $Out -Encoding utf8

$paths = @(
    '\Informações do Processador(_Total)\Frequência Real',
    '\Informações do Processador(_Total)\% de Desempenho do Processador',
    '\Informações do Processador(_Total)\% de Frequência Máxima',
    '\Informações do Processador(_Total)\% de Tempo Ocioso',
    '\Informações do Processador(*)\Frequência Real',
    '\Memória\MBytes Disponíveis',
    '\Memória\Bytes Confirmados'
)

while ((Get-Date) -lt $end) {
    $ts = Get-Date -Format 'HH:mm:ss'
    $samples = @()
    try { $samples = (Get-Counter -Counter $paths -MaxSamples 1 -ErrorAction Stop).CounterSamples } catch {}

    $real  = ($samples | Where-Object { $_.InstanceName -eq '_Total' -and $_.Path -like '*Frequência Real' } | Select-Object -First 1).CookedValue
    $perf  = ($samples | Where-Object { $_.InstanceName -eq '_Total' -and $_.Path -like '*Desempenho do Processador' } | Select-Object -First 1).CookedValue
    $maxf  = ($samples | Where-Object { $_.InstanceName -eq '_Total' -and $_.Path -like '*Frequência Máxima' } | Select-Object -First 1).CookedValue
    $idle  = ($samples | Where-Object { $_.InstanceName -eq '_Total' -and $_.Path -like '*Tempo Ocioso' } | Select-Object -First 1).CookedValue
    $avail = ($samples | Where-Object { $_.Path -like '*Disponíveis' } | Select-Object -First 1).CookedValue
    $comm  = ($samples | Where-Object { $_.Path -like '*Confirmados' } | Select-Object -First 1).CookedValue

    $mx = 0.0
    $samples | Where-Object { $_.InstanceName -ne '_Total' -and $_.Path -like '*Frequência Real' } |
        ForEach-Object { if ($_.CookedValue -gt $mx) { $mx = $_.CookedValue } }

    $busy = if ($null -ne $idle) { 100 - $idle } else { $null }

    $e37 = (Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Processor-Power'; Id = 37; StartTime = $start } -ErrorAction SilentlyContinue | Measure-Object).Count
    $whea = (Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $start } -ErrorAction SilentlyContinue | Measure-Object).Count

    $line = '{0};{1:N0};{2:N0};{3:N1};{4:N0};{5:N1};{6:N0};{7:N0};{8};{9}' -f `
        $ts, [double]$real, [double]$mx, [double]$perf, [double]$maxf, [double]$busy,
        [double]$avail, ([double]$comm / 1MB), $e37, $whea

    Write-Output $line
    $line | Out-File -FilePath $Out -Encoding utf8 -Append
    Start-Sleep -Seconds $IntervalSec
}
