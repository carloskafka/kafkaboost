param([int]$Minutes = 30, [int]$IntervalSec = 2, [string]$Out)   # default: <repo>\logs\hwinfo_log.csv
# Logs key HWiNFO readings via shared memory (needs SensorsSM=1 in HWiNFO64.INI).
if (-not $Out) {
    $logs = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'logs'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $Out = Join-Path $logs 'hwinfo_log.csv'
}

$ci = [Globalization.CultureInfo]::InvariantCulture
$m = [IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Global\HWiNFO_SENS_SM2', [IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
$v = $m.CreateViewAccessor(0, 0, 'Read')
$so=$v.ReadUInt32(20);$ss=$v.ReadUInt32(24);$sn=$v.ReadUInt32(28);$ro=$v.ReadUInt32(32);$rs=$v.ReadUInt32(36);$rn=$v.ReadUInt32(40)
function S($off,$len){ $b=New-Object byte[] $len; [void]$v.ReadArray($off,$b,0,$len); [Text.Encoding]::Default.GetString($b).Split([char]0)[0] }
$sens = 0..($sn-1) | % { S ($so+$_*$ss+8) 128 }
$meta = 0..($rn-1) | % { $o=$ro+$_*$rs; [pscustomobject]@{ i=$_; sensor=$sens[$v.ReadUInt32($o+4)]; label=(S ($o+12) 128); unit=(S ($o+268) 16); off=$o } }
$pClk  = $meta | ? { $_.label -match '^P-core \d+ Clock$' }
$eClk  = $meta | ? { $_.label -match '^E-core \d+ Clock$' }
$pTemp = $meta | ? { $_.unit -match 'C$' -and $_.label -match '^P-core \d+$' }
$pkgT  = $meta | ? { $_.label -eq 'CPU Package' -and $_.unit -match 'C$' } | select -First 1
$pkgP  = $meta | ? { $_.label -eq 'CPU Package Power' } | select -First 1
$usage = $meta | ? { $_.label -eq 'Total CPU Usage' } | select -First 1
$thr   = $meta | ? { $_.unit -eq 'Yes/No' -and $_.label -match 'Throttling|Limit|PROCHOT|EDP|Exceeded' -and $_.sensor -match 'Intel Core' }
$gpuT  = $meta | ? { $_.sensor -match 'NVIDIA|RTX' -and $_.label -eq 'GPU Temperature' } | select -First 1
$gpuP  = $meta | ? { $_.sensor -match 'NVIDIA|RTX' -and $_.label -eq 'GPU Power' } | select -First 1
$pkgT2 = $meta | ? { $_.label -eq 'CPU Package' -and $_.unit -match 'C$' } | select -Last 1
$iaT   = $meta | ? { $_.label -eq 'CPU IA Cores' -and $_.unit -match 'C$' } | select -First 1
$whea  = $meta | ? { $_.label -match 'Total Errors' } | select -First 1
function Val($r){ if($r){ $v.ReadDouble($r.off+284) } else { $null } }
function Mx($rs){ $x=$rs | % { Val $_ }; if($x){ ($x | Measure-Object -Maximum).Maximum } else { $null } }
$thrNames = ($thr | % { $_.label }) -join ' | '
"sensors found: pClk=$($pClk.Count) eClk=$($eClk.Count) pTemp=$($pTemp.Count) thrFlags=$($thr.Count) pkgT=$([bool]$pkgT) pkgP=$([bool]$pkgP) gpuT=$([bool]$gpuT) whea=$([bool]$whea)"
"throttle flags: $thrNames"
"time,maxPclk_MHz,maxEclk_MHz,maxPcoreTemp_C,pkgTemp_C,pkgPower_W,cpuUsage_pct,thermalOrLimitFlagsActive,gpuTemp_C,gpuPower_W,wheaErrors,pkgTemp2_C,iaCoresTemp_C" | Set-Content $Out
$end = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $end) {
  $flags = ($thr | ? { (Val $_) -ge 1 } | % { $_.label }) -join ';'
  $row = @((Get-Date).ToString('HH:mm:ss'),(Mx $pClk),(Mx $eClk),(Mx $pTemp),(Val $pkgT),(Val $pkgP),(Val $usage),$flags,(Val $gpuT),(Val $gpuP),(Val $whea),(Val $pkgT2),(Val $iaT)) | % { if($_ -is [double]){ $_.ToString('0.0',$ci) } else { "$_" } }
  Add-Content $Out ($row -join ',')
  Start-Sleep $IntervalSec
}

