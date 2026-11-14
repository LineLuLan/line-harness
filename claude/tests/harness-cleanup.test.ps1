. (Join-Path $PSScriptRoot 'test-lib.ps1')
$cleaner = Join-Path $PSScriptRoot '..\bin\harness-cleanup.ps1'
$fixture = New-TestFolder
$tempBefore = $env:TEMP; $profileBefore = $env:USERPROFILE
try {
  $env:TEMP = Join-Path $fixture 'temp'; $env:USERPROFILE = Join-Path $fixture 'profile'
  $root = Join-Path $env:TEMP 'claude'; $runs = Join-Path $env:USERPROFILE '.claude\state\runs'
  foreach ($dir in @("$root\old\deep", "$root\recent", "$runs\old-run", "$runs\new-run")) { [void][IO.Directory]::CreateDirectory($dir) }
  foreach ($file in @("$root\old\deep\data.bin", "$root\recent\old.txt", "$root\recent\new.txt", "$runs\old-run\out.log", "$runs\old-run\session.txt", "$runs\new-run\out.log")) {
    [IO.File]::WriteAllText($file, ('a' * 1024))
    [IO.File]::SetLastWriteTimeUtc($file, [datetime]::UtcNow.AddDays(-40))
    [IO.File]::SetCreationTimeUtc($file, [datetime]::UtcNow.AddDays(-40))
  }
  foreach ($dir in @(Get-ChildItem -LiteralPath $root -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending)) {
    [IO.Directory]::SetCreationTimeUtc($dir.FullName, [datetime]::UtcNow.AddDays(-40))
    [IO.Directory]::SetLastWriteTimeUtc($dir.FullName, [datetime]::UtcNow.AddDays(-40))
  }
  [IO.File]::SetLastWriteTimeUtc("$root\recent\new.txt", [datetime]::UtcNow)
  [IO.File]::SetLastWriteTimeUtc("$runs\new-run\out.log", [datetime]::UtcNow)
  $output = (& $cleaner 6>&1 | Out-String)
  Assert-True ($output.Contains("$root\old") -and $output.Contains("$runs\old-run\out.log") -and $output -match 'MB') 'dry run reports old folder/log and size'
  Assert-True (-not $output.Contains("$root\recent") -and -not $output.Contains('session.txt') -and -not $output.Contains("$runs\new-run\out.log")) 'newest file controls folder retention; only old out.log selected'
  Assert-True ((Test-Path "$root\old\deep\data.bin") -and (Test-Path "$runs\old-run\out.log") -and -not (Test-Path (Join-Path $env:USERPROFILE '.claude\state\cleanup.log'))) 'dry run changes nothing'
  . (Import-TestFunctions $cleaner)
  $old = "$root\old"; $cutoff = [datetime]::UtcNow.AddDays(-30)
  foreach ($change in @('folder-created','folder-modified','child-dir-created','child-dir-modified','file-created','file-modified')) {
    $target = if ($change -like 'folder-*') { $old } elseif ($change -like 'child-dir-*') { "$old\deep" } else { "$old\deep\data.bin" }
    $item = Get-Item -LiteralPath $target
    $created = $item.CreationTimeUtc; $modified = $item.LastWriteTimeUtc
    try {
      if ($change -like '*-created') { $item.CreationTimeUtc = [datetime]::UtcNow } else { $item.LastWriteTimeUtc = [datetime]::UtcNow }
      Assert-True ($null -eq (Get-CleanupCandidate -Path $old -Root $root -Cutoff $cutoff -Folder)) "retain on recent $change"
    } finally { $item.CreationTimeUtc = $created; $item.LastWriteTimeUtc = $modified }
  }
  Assert-Throws { Assert-CleanupPath -Path ($root + '-outside\file') -Root $root } 'prefix sibling rejected'
  Assert-Throws { Assert-CleanupPath -Path "$root\..\escape" -Root $root } 'traversal rejected'
  Assert-Throws { Assert-CleanupPath -Path $root -Root $root } 'root itself rejected'
  $junction = Join-Path $root 'linked'
  $nestedLink = Join-Path $root 'old\link'
  try {
    $null = New-Item -ItemType Junction -Path $junction -Target "$runs\old-run"
    $null = New-Item -ItemType Junction -Path $nestedLink -Target "$runs\old-run"
    $output = (& $cleaner 6>&1 | Out-String)
    Assert-True ($output -notmatch ('Would delete: ' + [regex]::Escape($junction)) -and $output -notmatch ('Would delete: ' + [regex]::Escape("$root\old"))) 'junctions and containing candidates skipped'
    Assert-Throws { Assert-CleanupPath -Path "$junction\out.log" -Root $root } 'junction ancestor rejected'
  } finally {
    foreach ($link in @($nestedLink, $junction)) { if (Test-Path -LiteralPath $link) { [IO.Directory]::Delete($link) } }
  }
  # Exercise deletion orchestration with mocked removal; no cleanup -Apply or real deletion.
  $first = "$runs\old-run\out.log"; $second = "$root\recent\old.txt"
  $items = @(
    (Get-CleanupCandidate -Path $first -Root $runs -Cutoff $cutoff),
    (Get-CleanupCandidate -Path $second -Root $root -Cutoff $cutoff)
  )
  [IO.File]::SetAttributes($first, ([IO.File]::GetAttributes($first) -bor [IO.FileAttributes]::ReadOnly))
  [IO.File]::SetAttributes($second, ([IO.File]::GetAttributes($second) -bor [IO.FileAttributes]::ReadOnly))
  $script:attempts = @(); $script:readOnlySeen = $false
  function Remove-CleanupItem { param($Item)
    $script:attempts += $Item.FullName
    if ([IO.File]::GetAttributes($Item.FullName) -band [IO.FileAttributes]::ReadOnly) { $script:readOnlySeen = $true }
    if ($Item.FullName -eq $first) { throw 'fixture locked file' }
  }
  $audit = Join-Path $env:USERPROFILE '.claude\state\cleanup.log'
  $output = (Remove-CleanupCandidates -Candidates $items -Cutoff $cutoff -Audit $audit 6>&1 | Out-String)
  Assert-True ($script:attempts.Count -eq 2 -and -not $script:readOnlySeen) 'read-only cleared and next candidate attempted after failure'
  Assert-True ($output -match 'Failures: 1' -and $output -match 'fixture locked file') 'failure summary lists candidate error'
  Assert-True ([IO.File]::ReadAllText($audit) -match 'FAIL.*fixture locked file' -and [IO.File]::ReadAllText($audit).Contains($second)) 'failures and successful removals logged'

  # -Vhdx: fake disks under a fake LOCALAPPDATA; docker / wsl / diskpart shims record any launch.
  $local = Join-Path $fixture 'local'
  $wslDisk = Join-Path $local 'wsl\{fake-guid}\ext4.vhdx'
  $dockerDisk = Join-Path $local 'Docker\wsl\disk\docker_data.vhdx'
  $other = Join-Path $local 'wsl\{fake-guid}\notes.txt'
  foreach ($file in @($wslDisk, $dockerDisk, $other)) {
    [void][IO.Directory]::CreateDirectory((Split-Path $file -Parent))
    $stream = [IO.File]::Create($file)
    try { $stream.SetLength(4096) } finally { $stream.Dispose() }
  }
  $shims = Join-Path $fixture 'shims'; $marker = Join-Path $fixture 'launched.txt'
  [void][IO.Directory]::CreateDirectory($shims)
  foreach ($name in @('docker', 'wsl', 'diskpart')) {
    [IO.File]::WriteAllText((Join-Path $shims "$name.cmd"), "@echo $name>>`"$marker`"`r`n")
  }
  $pathBefore = $env:PATH; $localBefore = $env:HARNESS_CLEANUP_LOCALAPPDATA
  $compact = Join-Path $env:TEMP 'claude\compact-vhdx.txt'
  try {
    $env:PATH = $shims + ';' + $env:PATH; $env:HARNESS_CLEANUP_LOCALAPPDATA = $local
    $quiet = (& $cleaner -Vhdx 6>&1 | Out-String)
    Assert-True ($quiet.Contains("VHDX: $wslDisk") -and $quiet.Contains("VHDX: $dockerDisk") -and -not $quiet.Contains('notes.txt')) '-Vhdx lists wsl (recursive) and docker .vhdx only'
    Assert-True ($quiet -match 'VHDX: .*ext4\.vhdx 0\.0 GB sparse=(yes|no|unknown)') '-Vhdx shows GB and the sparse flag'
    Assert-True ($quiet -match 'Nothing to do' -and $quiet -notmatch 'diskpart' -and -not (Test-Path -LiteralPath $compact)) 'under the threshold: no steps, no script'
    Assert-True ($quiet -notmatch 'Would delete' -and $quiet -notmatch 'Total:') '-Vhdx skips the normal cleanup'
    $loud = (& $cleaner -Vhdx -VhdxGB 0 -Apply 6>&1 | Out-String)
    Assert-True ($loud -match '1\) docker image prune -a -f ; docker builder prune -a -f' -and
      $loud.Contains('2) docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -- fstrim -av') -and
      $loud -match '3\) ' -and $loud -notmatch 'wsl -d docker-desktop' -and
      $loud.Contains('4) docker desktop stop ; wsl --shutdown') -and
      $loud.Contains(('5) In an admin PowerShell: diskpart /s "{0}"' -f $compact))) 'over the threshold: the five steps are printed'
    $script = if (Test-Path -LiteralPath $compact) { [IO.File]::ReadAllText($compact) } else { '' }
    $expected = foreach ($disk in @($dockerDisk, $wslDisk) | Sort-Object) { "select vdisk file=`"$disk`"`r`nattach vdisk readonly`r`ncompact vdisk`r`ndetach vdisk`r`n" }
    Assert-True ($script -eq (($expected -join '') + "exit`r`n")) 'diskpart script lists every .vhdx then exit'
    Assert-True ((Test-Path "$root\old\deep\data.bin") -and (Test-Path "$runs\new-run\out.log")) '-Vhdx -Apply deletes nothing'
    Assert-True (-not (Test-Path -LiteralPath $marker)) 'no docker, wsl or diskpart process started'
    . (Import-TestFunctions $cleaner)
    function Get-WslDistroName { 'Ubuntu' }
    function Get-VhdxSparseFlag { param([string]$Path) 'yes' }
    $mocked = (Invoke-VhdxReport -VhdxGB 0 6>&1 | Out-String)
    Assert-True ($mocked.Contains('3) wsl -d Ubuntu -u root -- fstrim -av') -and $mocked -match 'sparse=yes') 'one fstrim step per distro'
    $env:HARNESS_CLEANUP_LOCALAPPDATA = Join-Path $fixture 'empty-local'
    Assert-True ((Invoke-VhdxReport 6>&1 | Out-String) -match 'No \.vhdx found') 'no .vhdx: says so'
    Assert-True (-not (Test-Path -LiteralPath $marker)) 'still no docker, wsl or diskpart process started'
  } finally { $env:PATH = $pathBefore; $env:HARNESS_CLEANUP_LOCALAPPDATA = $localBefore }
} finally {
  $env:TEMP = $tempBefore; $env:USERPROFILE = $profileBefore
  Remove-TestFolder $fixture
}
Complete-Tests
