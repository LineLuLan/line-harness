# Intent: wait for memory before a worker or review starts.
# Status: CIM polling only. Next: supervisor validates on Line's host.
# Blockers: none. Confidence: deterministic polling/timeout fixtures.
# 2026-11-14 (Line): measure commit headroom (FreeVirtualMemory = commit limit - committed), not free
# physical RAM. Physical RAM sits near 0.5 GB on this machine while workers still run fine (pagefile);
# only a near-full commit charge makes a new process fail.
function Get-FreeRamGB {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  if ($null -eq $os.FreeVirtualMemory) { throw 'FreeVirtualMemory is unavailable.' }
  return ([double]$os.FreeVirtualMemory * 1KB / 1GB)
}
# 2026-11-14 (Line): sessions always run. Low memory never blocks, waits, or stops a worker or review;
# if memory truly runs out, Windows ends the process itself. This check only reports (one sample, no
# polling) and always returns $true. MinGB/TimeoutMin stay for caller compatibility; TimeoutMin is unused.
function Wait-FreeRam {
  [CmdletBinding()]
  param([ValidateRange(0, 1048576)][double]$MinGB = 1.5,
        [ValidateRange(0, 1440)][double]$TimeoutMin = 10)
  try { $free = Get-FreeRamGB } catch {
    Write-Warning 'RAM check unavailable; continuing.'
    return $true
  }
  Write-Host ('RAM: {0:F2} GB commit headroom' -f $free)
  if ($free -lt $MinGB) { Write-Warning ('Low commit headroom ({0:F2} GB < {1:F2} GB); continuing anyway (Line: never stop for RAM).' -f $free, $MinGB) }
  return $true
}
function Write-RamDiagnostic {
  Write-Host ('Commit headroom: {0:F2} GB' -f (Get-FreeRamGB))
  Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object {
    Write-Host ('{0} {1:F0} MB' -f $_.ProcessName, ($_.WorkingSet64 / 1MB))
  }
}
