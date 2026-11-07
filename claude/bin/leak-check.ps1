# Measure-only zombie check (no admin needed). Run any time.
$pm = "C:\Program Files (x86)\Windows Kits\10\Tools\10.0.28000.0\x64\poolmon.exe"
$script:n = 0
function Get-ProcTag {
    $script:n++; $f = "$env:TEMP\poolchk_$($script:n).txt"
    if (Test-Path $f) { Remove-Item $f -Force }
    & $pm -b -n $f | Out-Null; Start-Sleep 1
    $l = (Select-String -Path $f -Pattern '^ Proc' | Select-Object -Last 1).Line -split '\s+'
    [pscustomobject]@{Allocs=[long]$l[3]; Frees=[long]$l[4]}
}
$b = Get-ProcTag; "Baseline:  Allocs=$($b.Allocs)  Frees=$($b.Frees)"
1..20 | ForEach-Object { Start-Process cmd -ArgumentList '/c exit' -WindowStyle Hidden -Wait }
Start-Sleep 5
$a = Get-ProcTag; "After:     Allocs=$($a.Allocs)  Frees=$($a.Frees)"
$dA = $a.Allocs - $b.Allocs; $dF = $a.Frees - $b.Frees
""; "New allocs: $dA, new frees: $dF"
if ($dA -lt 15) { ">>> DO LOI: khong ghi nhan process moi - bao cho Claude." }
elseif ($dF -ge ($dA * 0.5)) { ">>> HET LEAK - nhom driver round B la thu pham." }
else { ">>> VAN LEAK - chuyen round C (Vanguard)." }
