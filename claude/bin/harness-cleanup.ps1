[CmdletBinding()]
param([switch]$Apply, [ValidateRange(1,36500)][int]$Days = 30, [switch]$Vhdx, [ValidateRange(0,100000)][int]$VhdxGB = 80)
$ErrorActionPreference = 'Stop'

# Intent: reclaim only stale temp folders and run output, with no link traversal.
# Status: dry-run default; recheck boundaries and age immediately before deletion.
# Next: supervisor reviews dry-run before Apply. Blockers: none.
# Confidence: dry-run, age and junction fixtures; live deletion deliberately not run.
function Assert-CleanupPath {
  param([string]$Path, [string]$Root, [switch]$AllowRoot)
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\','/')
  $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  if (-not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
      -not ($AllowRoot -and $full.Equals($base, [StringComparison]::OrdinalIgnoreCase))) { throw 'Cleanup path is outside its allowed root.' }
  # Check every ancestor, including ancestors above the allowed root.
  $ancestors = New-Object 'Collections.Generic.List[string]'
  $cursor = $full
  while ($cursor) {
    $ancestors.Add($cursor)
    $cursor = Split-Path -Path $cursor -Parent
  }
  for ($i = $ancestors.Count - 1; $i -ge 0; $i--) {
    $cursor = $ancestors[$i]
    $item = Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue
    if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Cleanup does not follow reparse points.' }
  }
}
function Get-CleanupTree {
  param([string]$Path, [string]$Root)
  Assert-CleanupPath -Path $Path -Root $Root
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $item
  if ($item.PSIsContainer) {
    foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop)) {
      Get-CleanupTree -Path $child.FullName -Root $Root
    }
  }
}
function Get-CleanupCandidate {
  param([string]$Path, [string]$Root, [datetime]$Cutoff, [switch]$Folder)
  try {
    $tree = @(Get-CleanupTree -Path $Path -Root $Root)
    $files = @($tree | Where-Object { -not $_.PSIsContainer })
    $newest = [datetime]::MinValue
    foreach ($item in $tree) {
      if ($item.CreationTimeUtc -gt $newest) { $newest = $item.CreationTimeUtc }
      if ($item.LastWriteTimeUtc -gt $newest) { $newest = $item.LastWriteTimeUtc }
    }
    if ($newest -ge $Cutoff) { return }
    [pscustomobject]@{ Path=$Path; Root=$Root; Folder=[bool]$Folder; Bytes=($files | Measure-Object Length -Sum).Sum; Tree=$tree }
  } catch { [pscustomobject]@{ Path=$Path; Root=$Root; Failure=$_.Exception.Message } }
}
function Write-CleanupAudit {
  param([string]$Audit, [string]$Action, [string]$Path, [string]$Message = '')
  $stateRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.claude\state'))
  Assert-CleanupPath -Path $Audit -Root $stateRoot
  [void][IO.Directory]::CreateDirectory($stateRoot)
  $entry = '{0}|{1}|{2}|{3}' -f [datetime]::UtcNow.ToString('o'), $Action, $Path, ($Message -replace '[\r\n]', ' ')
  [IO.File]::AppendAllText($Audit, $entry + "`n", (New-Object Text.UTF8Encoding($false)))
}
function Write-CleanupFailures {
  param([object[]]$Failures, [string]$Audit)
  if (-not $Failures.Count) { return }
  Write-Output ('Failures: {0}' -f $Failures.Count)
  foreach ($failure in $Failures) {
    Write-Output ('Failed: {0}: {1}' -f $failure.Path, $failure.Failure)
    try { Write-CleanupAudit -Audit $Audit -Action FAIL -Path $failure.Path -Message $failure.Failure }
    catch { Write-Output ('Cleanup log unavailable: {0}' -f $_.Exception.Message) }
  }
}
function Remove-CleanupItem {
  param($Item)
  if ($Item.PSIsContainer) { [IO.Directory]::Delete($Item.FullName, $false) }
  else { [IO.File]::Delete($Item.FullName) }
}
function Remove-CleanupCandidates {
  param([object[]]$Candidates, [datetime]$Cutoff, [string]$Audit)
  # Intent: one stale/locked candidate must not prevent cleanup of independent candidates.
  # Status: boundaries and age rechecked; failures retained and logged. Next: supervisor review.
  # Blockers: none. Confidence: mocked removal proves continuation without applying cleanup.
  $failures = New-Object 'Collections.Generic.List[object]'
  $total = 0.0
  foreach ($candidate in $Candidates) {
    try {
      if ($candidate.Failure) { throw $candidate.Failure }
      $fresh = Get-CleanupCandidate -Path $candidate.Path -Root $candidate.Root -Cutoff $Cutoff -Folder:$candidate.Folder
      if ($null -eq $fresh) { continue }
      if ($fresh.Failure) { throw $fresh.Failure }
      # Ensure the audit path is safe before removing any content.
      Assert-CleanupPath -Path $Audit -Root (Join-Path $env:USERPROFILE '.claude\state')
      foreach ($item in @($fresh.Tree | Sort-Object { $_.FullName.Length } -Descending)) {
        Assert-CleanupPath -Path $item.FullName -Root $candidate.Root
        $attributes = [IO.File]::GetAttributes($item.FullName)
        if ($attributes -band [IO.FileAttributes]::ReadOnly) {
          [IO.File]::SetAttributes($item.FullName, ($attributes -band (-bnot [IO.FileAttributes]::ReadOnly)))
        }
        Remove-CleanupItem -Item $item
        Write-CleanupAudit -Audit $Audit -Action DELETE -Path $item.FullName
      }
      Write-Output ('Deleted: {0} ({1:F3} MB)' -f $fresh.Path, ($fresh.Bytes / 1MB))
      $total += $fresh.Bytes
    } catch { $failures.Add([pscustomobject]@{Path=$candidate.Path; Failure=$_.Exception.Message}) }
  }
  Write-Output ('Total: {0:F3} MB' -f ($total / 1MB))
  Write-CleanupFailures -Failures @($failures.ToArray()) -Audit $Audit
}
function Invoke-HarnessCleanup {
  param([switch]$Apply, [int]$Days)
  $tempRoot = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'claude'))
  $runsRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.claude\state\runs'))
  $cutoff = [datetime]::UtcNow.AddDays(-$Days)
  $candidates = @(
    foreach ($root in @($tempRoot, $runsRoot)) {
      if (-not (Test-Path -LiteralPath $root)) { continue }
      try {
        Assert-CleanupPath -Path $root -Root $root -AllowRoot
        $directories = @(Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction Stop)
      } catch { [pscustomobject]@{Path=$root; Root=$root; Failure=$_.Exception.Message}; continue }
      foreach ($dir in $directories) {
        if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($root -eq $tempRoot) { Get-CleanupCandidate -Path $dir.FullName -Root $root -Cutoff $cutoff -Folder }
        else {
          $log = Join-Path $dir.FullName 'out.log'
          if (Test-Path -LiteralPath $log -PathType Leaf) { Get-CleanupCandidate -Path $log -Root $root -Cutoff $cutoff }
        }
      }
    }
  )
  $audit = Join-Path $env:USERPROFILE '.claude\state\cleanup.log'
  if ($Apply) { Remove-CleanupCandidates -Candidates $candidates -Cutoff $cutoff -Audit $audit; return }
  $total = 0.0
  $failures = @($candidates | Where-Object { $_.Failure })
  foreach ($candidate in $candidates) {
    if ($candidate.Failure) { continue }
    Write-Output ('Would delete: {0} ({1:F3} MB)' -f $candidate.Path, ($candidate.Bytes / 1MB))
    $total += $candidate.Bytes
  }
  Write-Output ('Total: {0:F3} MB' -f ($total / 1MB))
  Write-CleanupFailures -Failures $failures -Audit $audit
}
# Intent: -Vhdx reports the WSL and Docker virtual disks and, when one is too big, prints the manual
#   compaction steps and writes a diskpart script. It is report-only: it never runs docker, wsl or diskpart,
#   even with -Apply, and it skips the temp/runs cleanup.
# Status: listing + sparse flag + steps + script file. Next: Line runs the steps by hand. Blockers: none.
# Confidence: fake .vhdx fixtures with shimmed docker/wsl/diskpart in harness-cleanup.test.ps1.
function Get-VhdxSparseFlag {
  param([string]$Path)
  try {
    $fsutil = Join-Path $env:SystemRoot 'System32\fsutil.exe'
    $text = (& $fsutil sparse queryflag $Path 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { return 'unknown' }
    if ($text -match '\bNOT\b') { return 'no' }
    if ($text -match '\bset\b') { return 'yes' }
    return 'unknown'
  } catch { return 'unknown' }
}
function Get-WslDistroName {
  try {
    foreach ($key in @(Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction Stop)) {
      $name = (Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue).DistributionName
      # docker-desktop and docker-desktop-data belong to Docker Desktop; step 1-2 trim them.
      if ($name -and $name -notlike 'docker-desktop*') { $name }
    }
  } catch { }
}
function Get-VhdxFile {
  param([string]$LocalAppData)
  $wslRoot = Join-Path $LocalAppData 'wsl'
  $dockerRoot = Join-Path $LocalAppData 'Docker\wsl\disk'
  $found = @()
  if (Test-Path -LiteralPath $wslRoot -PathType Container) {
    $found += @(Get-ChildItem -LiteralPath $wslRoot -Recurse -File -Force -ErrorAction SilentlyContinue)
  }
  if (Test-Path -LiteralPath $dockerRoot -PathType Container) {
    $found += @(Get-ChildItem -LiteralPath $dockerRoot -File -Force -ErrorAction SilentlyContinue)
  }
  @($found | Where-Object { $_.Extension -eq '.vhdx' } | Sort-Object FullName -Unique)
}
function Invoke-VhdxReport {
  param([int]$VhdxGB = 80)
  $local = if ($env:HARNESS_CLEANUP_LOCALAPPDATA) { $env:HARNESS_CLEANUP_LOCALAPPDATA } else { $env:LOCALAPPDATA }
  $files = @(Get-VhdxFile -LocalAppData $local)
  if (-not $files.Count) { Write-Output 'No .vhdx found under the WSL or Docker folders.'; return }
  foreach ($file in $files) {
    Write-Output ('VHDX: {0} {1:F1} GB sparse={2}' -f $file.FullName, ($file.Length / 1GB), (Get-VhdxSparseFlag -Path $file.FullName))
  }
  $big = @($files | Where-Object { $_.Length -gt ([int64]$VhdxGB * 1GB) })
  if (-not $big.Count) { Write-Output ('No .vhdx is over {0} GB. Nothing to do.' -f $VhdxGB); return }
  $scriptDir = Join-Path $env:TEMP 'claude'
  $scriptPath = Join-Path $scriptDir 'compact-vhdx.txt'
  $lines = New-Object 'Collections.Generic.List[string]'
  foreach ($file in $files) {
    $lines.Add(('select vdisk file="{0}"' -f $file.FullName))
    $lines.Add('attach vdisk readonly')
    $lines.Add('compact vdisk')
    $lines.Add('detach vdisk')
  }
  $lines.Add('exit')
  [void][IO.Directory]::CreateDirectory($scriptDir)
  # diskpart reads the script in the ANSI code page.
  [IO.File]::WriteAllText($scriptPath, (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::Default)
  Write-Output ('{0} .vhdx file(s) over {1} GB. Run these steps by hand (this script runs none of them):' -f $big.Count, $VhdxGB)
  Write-Output '1) docker image prune -a -f ; docker builder prune -a -f'
  Write-Output '2) docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -- fstrim -av'
  $distros = @(Get-WslDistroName)
  if ($distros.Count) { foreach ($distro in $distros) { Write-Output ('3) wsl -d {0} -u root -- fstrim -av' -f $distro) } }
  else { Write-Output '3) (no WSL distro found; skip)' }
  Write-Output '4) docker desktop stop ; wsl --shutdown'
  Write-Output ('5) In an admin PowerShell: diskpart /s "{0}"' -f $scriptPath)
}
if ($MyInvocation.InvocationName -ne '.') {
  if ($Vhdx) { Invoke-VhdxReport -VhdxGB $VhdxGB }
  else { Invoke-HarnessCleanup -Apply:$Apply -Days $Days }
}
