# Zombie process leak test - round A (Nahimic + Lenovo Vantage, no reboot needed)  v2
# Run in an ELEVATED PowerShell:  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ADMIN\.claude\bin\leak-test.ps1
$pm = "C:\Program Files (x86)\Windows Kits\10\Tools\10.0.28000.0\x64\poolmon.exe"
$script:n = 0
function Get-ProcTag {
    $script:n++; $f = "$env:TEMP\pool_$($script:n).txt"
    if (Test-Path $f) { Remove-Item $f -Force }
    & $pm -b -n $f | Out-Null; Start-Sleep 1
    $line = (Select-String -Path $f -Pattern '^ Proc' | Select-Object -Last 1).Line -split '\s+'
    [pscustomobject]@{Allocs=[long]$line[3]; Frees=[long]$line[4]}
}
$svc = 'NahimicService','LenovoVantageService','LenovoFnAndFunctionKeys'
$before = Get-ProcTag
"Baseline:  Allocs=$($before.Allocs)  Frees=$($before.Frees)"
$svc | ForEach-Object { Stop-Service $_ -Force -ErrorAction SilentlyContinue }
Get-Service $svc | ForEach-Object { "  {0} -> {1}" -f $_.Name, $_.Status }
1..20 | ForEach-Object { Start-Process cmd -ArgumentList '/c exit' -WindowStyle Hidden -Wait }
Start-Sleep 5
$after = Get-ProcTag
"After:     Allocs=$($after.Allocs)  Frees=$($after.Frees)"
$dA = $after.Allocs - $before.Allocs; $dF = $after.Frees - $before.Frees
""; "New allocs: $dA, new frees: $dF"
if ($dA -lt 15) { ">>> DO LOI: khong ghi nhan duoc process moi - bao ket qua nay cho Claude." }
elseif ($dF -ge ($dA * 0.5)) { ">>> FREES CHAY LAI - thu pham trong nhom: $($svc -join ', ')" }
else { ">>> VAN LEAK (frees dung yen) - khong phai Nahimic/Vantage user-mode. Chuyen round B." }
$svc | ForEach-Object { Start-Service $_ -ErrorAction SilentlyContinue }
"Services restarted:"; Get-Service $svc | ForEach-Object { "  {0} -> {1}" -f $_.Name, $_.Status }
