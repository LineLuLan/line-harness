# Docker RAM tracker (Line's machine, 2026-08-18). Samples every 15s while Docker runs.
# Usage:  docker-ram-track.ps1            -> sampling loop (run by scheduled task "DockerRamTrack")
#         docker-ram-track.ps1 -Report    -> peak values + suggested .wslconfig cap
param([switch]$Report, [int]$IntervalSec = 15)
$csv = "$env:USERPROFILE\.claude\logs\docker-ram.csv"
if ($Report) {
    $rows = Import-Csv $csv
    $n = $rows.Count
    if ($n -eq 0) { "no samples yet"; return }
    $peakUsed  = ($rows | Measure-Object -Property VmUsedMB -Maximum).Maximum
    $peakCtr   = ($rows | Measure-Object -Property ContainersMB -Maximum).Maximum
    $peakVmmem = ($rows | Measure-Object -Property VmmemMB -Maximum).Maximum
    $peakSwap  = ($rows | Measure-Object -Property SwapUsedMB -Maximum).Maximum
    "Samples: $n  (from $($rows[0].Time) to $($rows[-1].Time))"
    "Peak VM real used (no cache): $peakUsed MB   <- size the cap on this"
    "Peak containers total:        $peakCtr MB"
    "Peak swap used:               $peakSwap MB"
    "Peak vmmemWSL (Windows view): $peakVmmem MB  (always ~= cap, ignore)"
    $sug = [math]::Ceiling(($peakUsed * 1.3 + 256) / 256) * 256
    "Suggested .wslconfig memory = ${sug}MB  (peak used x1.3 + 256MB, rounded up to 256MB)"
    return
}
if (-not (Test-Path $csv)) { "Time,VmmemMB,VmUsedMB,SwapUsedMB,ContainersMB" | Out-File $csv -Encoding utf8 }
while ($true) {
    $vm = Get-Process vmmemWSL -ErrorAction SilentlyContinue
    $be = Get-Process com.docker.backend -ErrorAction SilentlyContinue
    if ($vm -and $be) {
        $mi = wsl -d docker-desktop -- cat /proc/meminfo 2>$null
        $g = @{}; foreach ($l in $mi) { if ($l -match '^(\w+):\s+(\d+)') { $g[$matches[1]] = [long]$matches[2] } }
        $used = [math]::Round(($g.MemTotal - $g.MemAvailable) / 1024)
        $swap = [math]::Round(($g.SwapTotal - $g.SwapFree) / 1024)
        $ctr = 0
        docker stats --no-stream --format "{{.MemUsage}}" 2>$null | ForEach-Object {
            if ($_ -match '^([\d.]+)(\w+)') { $v=[double]$matches[1]; switch ($matches[2]) { 'GiB' {$v*=1024} 'KiB' {$v/=1024} 'B' {$v/=1MB} }; $ctr += $v }
        }
        "{0:yyyy-MM-dd HH:mm:ss},{1},{2},{3},{4}" -f (Get-Date), [math]::Round($vm.WorkingSet64/1MB), $used, $swap, [math]::Round($ctr) | Add-Content $csv
    }
    Start-Sleep -Seconds $IntervalSec
}
