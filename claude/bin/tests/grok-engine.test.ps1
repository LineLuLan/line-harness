# Intent: prove the K5d byte-exact Grok engine (setup, bring-back, conflict, rollback, undo) without Grok or WMI. Status: regression suite. Next: host E2E. Blockers: none. Confidence: real temporary Git repositories, autocrlf true and false.
$ErrorActionPreference = 'Stop'
$bin = Split-Path -Parent $PSScriptRoot
$source = Split-Path -Parent (Split-Path -Parent $bin)
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$fixture = Join-Path $tempRoot ('grok-engine-test-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$script:passed = 0; $script:failed = 0
$saved = @{}
foreach ($name in @('GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','CODEX_DO_STATE_DIR','CODEX_DO_ENGINE','CODEX_DO_USAGE_CACHE_DIR','ULTRATHINK_ONTOLOGY','CODEX_ACC_ROOT','CODEX_ACC_MAIN_HOME','GROK_DO_BIN','CODEX_DO_NOTIFY')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Assert-Grok($Condition, [string]$Name) {
  if ($Condition) { $script:passed++; Write-Host "PASS: $Name" }
  else { $script:failed++; Write-Host "FAIL: $Name" }
}
function B([string]$Text) { return ,$utf8.GetBytes($Text) }
function Write-Bytes([string]$Path, [byte[]]$Bytes) {
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
  [IO.File]::WriteAllBytes($Path, $Bytes)
}
function Write-Fixture([string]$Path, [string]$Text) { Write-Bytes $Path (B $Text) }
function Test-Bytes([string]$Path, [byte[]]$Expected) {
  if (-not [IO.File]::Exists($Path)) { return $false }
  return ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) -ceq [Convert]::ToBase64String($Expected))
}
# Every file (bytes) and folder under a root, .git excluded, as one comparable string.
function Get-Tree([string]$Root) {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $items = New-Object 'System.Collections.Generic.List[string]'
  foreach ($entry in (New-Object IO.DirectoryInfo($rootFull)).EnumerateFileSystemInfos('*', [IO.SearchOption]::AllDirectories)) {
    $relative = $entry.FullName.Substring($rootFull.Length + 1).Replace('\', '/')
    if ($relative -eq '.git' -or $relative.StartsWith('.git/')) { continue }
    if ($entry -is [IO.DirectoryInfo]) { $items.Add("D $relative") }
    else { $items.Add("F $relative " + [Convert]::ToBase64String([IO.File]::ReadAllBytes($entry.FullName))) }
  }
  $array = $items.ToArray()
  [Array]::Sort($array, [StringComparer]::Ordinal)
  return ($array -join "`n")
}
function New-TestRepo([string]$Name, [string]$Crlf, [hashtable]$Files) {
  $path = Join-Path $fixture $Name
  [void][IO.Directory]::CreateDirectory($path)
  [void](Invoke-GrokGit -Dir $path -Arguments @('init','--quiet'))
  foreach ($pair in @(@('core.autocrlf', $Crlf), @('core.safecrlf', 'false'), @('user.name', 'grok-test'), @('user.email', 'grok-test@example.invalid'))) {
    [void](Invoke-GrokGit -Dir $path -Arguments @('config', $pair[0], $pair[1]))
  }
  foreach ($key in $Files.Keys) { Write-Bytes (Join-Path $path $key) $Files[$key] }
  [void](Invoke-GrokGit -Dir $path -RepoNewlines -Arguments @('add','-A'))
  [void](Invoke-GrokGit -Dir $path -RepoNewlines -Arguments @('commit','--quiet','-m','fixture'))
  return $path
}
function Start-TestRun([string]$Repo, [string]$Name, [string]$StateRoot = (Join-Path $fixture 'state space')) {
  $folder = Join-Path $StateRoot "runs\$Name"
  $wt = Join-Path $StateRoot "grok-wt\$Name"
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $created = New-GrokWorktree -Dir $Repo -WorktreeDir $wt -RunFolder $folder
  Write-Fixture (Join-Path $folder 'run.json') (@{ runId=$Name; engine='grok'; dir=$Repo; worktreeDir=$created.worktreeDir; manifest=$created.manifest; startedUtc=[datetime]::UtcNow.ToString('o') } | ConvertTo-Json)
  return [pscustomobject]@{ Folder=$folder; Wt=$created.worktreeDir; Manifest=$created.manifest; Count=$created.count; Repo=$Repo; Name=$Name }
}
function Read-Apply($Run) { return ([IO.File]::ReadAllText((Join-Path $Run.Folder 'apply.json')) | ConvertFrom-Json) }
function Read-Undo($Run) { return ([IO.File]::ReadAllText((Join-Path $Run.Folder 'undo\undo.json')) | ConvertFrom-Json) }
function Read-Exit($Run) { return [IO.File]::ReadAllText((Join-Path $Run.Folder 'exit.txt')).Trim() }
function Get-Sorted($Items) { $array = [string[]]@($Items | Where-Object { $null -ne $_ }); [Array]::Sort($array, [StringComparer]::Ordinal); return ($array -join '|') }
function Invoke-TestUndo([string]$Folder) {
  $records = @(Invoke-GrokUndo -RunFolder $Folder 6>&1)
  $code = @($records | Where-Object { $_ -is [int] })[-1]
  $text = @($records | Where-Object { $_ -isnot [int] } | ForEach-Object { "$_" }) -join "`n"
  return [pscustomobject]@{ Code = $code; Text = $text }
}
function Invoke-TestDispatcher([string[]]$Arguments) {
  $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin 'codex-do.ps1') @Arguments 2>&1) | ForEach-Object { "$_" }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($output -join "`n") }
}
function Get-LockFile([string]$StateDir, [string]$Repo) {
  $sha1 = [Security.Cryptography.SHA1]::Create()
  try { $hex = -join ($sha1.ComputeHash($utf8.GetBytes([IO.Path]::GetFullPath($Repo).TrimEnd('\','/').ToLowerInvariant())) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha1.Dispose() }
  $lockDir = Join-Path $StateDir 'dispatch-locks'
  New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
  return (Join-Path $lockDir ($hex.Substring(0, 16) + '.lock'))
}
$unicodeName = 'th' + [char]0x01B0 + ' m' + [char]0x1EE5 + 'c/t' + [char]0x1EC7 + 'p a.txt'
try {
  . (Join-Path $bin 'grok-engine-lib.ps1')
  $env:GIT_CONFIG_COUNT = '1'; $env:GIT_CONFIG_KEY_0 = 'safe.directory'; $env:GIT_CONFIG_VALUE_0 = '*'
  New-Item -ItemType Directory -Path $fixture | Out-Null
  # K5e (E13): the real cache can say Codex is out; every dispatcher call here is pinned and never reads the real cache, engine.txt or ontology.
  $env:CODEX_DO_ENGINE = 'codex'
  $env:CODEX_DO_USAGE_CACHE_DIR = Join-Path $fixture 'usage-cache-empty'
  $env:ULTRATHINK_ONTOLOGY = Join-Path $source 'claude\ontology\harness.ontology.json'
  # Intent: K6a G10 - every dispatcher call uses temp state, temp Codex accounts and the fake grok; the real runs folder must not change. Status: suite-wide. Next: none. Blockers: none. Confidence: count asserted at the end.
  $realRuns = Join-Path $env:USERPROFILE '.claude\state\runs'
  $realRunCount = @(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue).Count
  # V8: also the newest folder names, so a test run that replaced a real one is caught.
  $realRunNewest = (@(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ',')
  $defaultState = Join-Path $fixture 'state default'
  $env:CODEX_DO_STATE_DIR = $defaultState
  $env:GROK_DO_BIN = Join-Path $PSScriptRoot 'fixtures\fake-grok.cmd'
  $env:CODEX_DO_NOTIFY = '0'
  $env:CODEX_ACC_ROOT = Join-Path $fixture 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixture 'main-home'
  New-Item -ItemType Directory -Path $env:CODEX_ACC_ROOT, $env:CODEX_ACC_MAIN_HOME -Force | Out-Null
  Assert-Grok ((Test-GrokTempName '.grok-0a1b2c3d.tmp') -and (Test-GrokTempName 'x/.grok-zzzzzzzz.tmp') -and -not (Test-GrokTempName 'grok-0a1b2c3d.tmp') -and -not (Test-GrokTempName '.grok-0a1b.tmp')) 'temp-name filter matches .grok-????????.tmp only'

  foreach ($mode in @('true','false')) {
    $tag = "autocrlf=$mode"
    # Intent: criterion 8 matrix - every file kind, byte equality, undo round trip. Status: K5d core. Next: none. Blockers: none. Confidence: whole-tree snapshots.
    $binary = [byte[]]@(0, 1, 13, 65, 0, 10, 13, 13, 255)
    $repo = New-TestRepo "matrix-$mode" $mode @{
      '.gitignore' = (B "*.log`nignored-dir/`n")
      'clean-lf.txt' = (B "one`ntwo`n"); 'clean-crlf.txt' = (B "one`r`ntwo`r`n"); 'clean-mixed.txt' = (B "one`r`ntwo`nthree`r`n")
      'edit-lf.txt' = (B "alpha beta`ngamma`n"); 'edit-crlf.txt' = (B "alpha beta`r`ngamma`r`n"); 'edit-mixed.txt' = (B "alpha beta`r`ngamma`ndelta`r`n")
      'bin.dat' = $binary; 'del.txt' = (B "delete me`n"); $unicodeName = (B "unicode name`r`n")
      'dirty.txt' = (B "committed`n"); 'zero.txt' = [byte[]]@(); 'trunc.txt' = (B "x`n"); 'missing.txt' = (B "tracked`n")
      'swap1' = (B "file becomes dir`n"); 'swap2/x.txt' = (B "dir becomes file`n")
    }
    Write-Fixture (Join-Path $repo 'dirty.txt') "dirty in Dir`n"
    [IO.File]::Delete((Join-Path $repo 'missing.txt'))
    Write-Fixture (Join-Path $repo 'untracked.txt') "untracked`r`n"
    Write-Fixture (Join-Path $repo 'keep.log') 'ignored in Dir'
    Write-Fixture (Join-Path $repo '.grok-0a1b2c3d.tmp') 'stale engine temp'
    $preSetup = Get-Tree $repo
    $run = Start-TestRun $repo "matrix-$mode"
    $copyOk = $true
    foreach ($relative in @('.gitignore','clean-lf.txt','clean-crlf.txt','clean-mixed.txt','edit-lf.txt','edit-crlf.txt','edit-mixed.txt','bin.dat','del.txt',$unicodeName,'dirty.txt','zero.txt','trunc.txt','swap1','swap2/x.txt','untracked.txt')) {
      if (-not (Test-Bytes (Join-Path $run.Wt $relative) ([IO.File]::ReadAllBytes((Join-Path $repo $relative))))) { $copyOk = $false; Write-Host "  copy mismatch: $relative" }
    }
    Assert-Grok $copyOk "$tag setup copies tracked, dirty and untracked files byte for byte"
    Assert-Grok (-not (Test-Path -LiteralPath (Join-Path $run.Wt 'keep.log')) -and -not (Test-Path -LiteralPath (Join-Path $run.Wt 'missing.txt')) -and -not (Test-Path -LiteralPath (Join-Path $run.Wt '.grok-0a1b2c3d.tmp'))) "$tag setup skips ignored, missing and engine temp files"
    $manifest = [IO.File]::ReadAllText($run.Manifest) | ConvertFrom-Json
    $unicodeEntry = @($manifest.files | Where-Object { $_.path -ceq $unicodeName })
    Assert-Grok ($manifest.version -eq 1 -and @($manifest.files).Count -eq 16 -and $run.Count -eq 16 -and $unicodeEntry.Count -eq 1 -and $unicodeEntry[0].sha256 -ceq (Get-FileHash -LiteralPath (Join-Path $repo $unicodeName) -Algorithm SHA256).Hash.ToLowerInvariant() -and $unicodeEntry[0].size -eq 14) "$tag manifest is an array of path, sha256 and size"
    $hashOk = $true
    foreach ($relative in @('edit-lf.txt','edit-crlf.txt','edit-mixed.txt','bin.dat','zero.txt')) {
      $entry = @($manifest.files | Where-Object { $_.path -ceq $relative })
      $copyHash = (Get-FileHash -LiteralPath (Join-Path $run.Wt $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($entry.Count -ne 1 -or $entry[0].sha256 -cne $copyHash -or $entry[0].size -ne (Get-Item -LiteralPath (Join-Path $run.Wt $relative)).Length) { $hashOk = $false; Write-Host "  manifest/copy mismatch: $relative" }
    }
    Assert-Grok $hashOk "$tag manifest sha256 and size equal the worktree copy (LF, CRLF, mixed, binary, 0-byte)"
    Assert-Grok (-not (Test-Path -LiteralPath (Join-Path $run.Folder 'baselineTree')) -and -not ([IO.File]::ReadAllText((Join-Path $run.Folder 'run.json'))).Contains('baselineTree')) "$tag no baselineTree recorded"
    $status = Invoke-GrokGit -Dir $run.Wt -RepoNewlines -Arguments @('status','--porcelain','--untracked-files=no')
    Assert-Grok (@($status -split "`n" | Where-Object { $_ -and $_ -notmatch 'dirty\.txt$' -and $_ -notmatch 'missing\.txt$' }).Count -eq 0) "$tag cosmetic index shows only real tracked changes"
    $wt = $run.Wt
    Write-Fixture (Join-Path $wt 'edit-lf.txt') "alpha BETA`ngamma`n"
    Write-Fixture (Join-Path $wt 'edit-crlf.txt') "alpha BETA`r`ngamma`r`n"
    Write-Fixture (Join-Path $wt 'edit-mixed.txt') "alpha BETA`r`ngamma`ndelta`r`n"
    $binaryEdited = [byte[]]@(0, 1, 13, 66, 0, 10, 13, 13, 255, 0)
    Write-Bytes (Join-Path $wt 'bin.dat') $binaryEdited
    [IO.File]::Delete((Join-Path $wt 'del.txt'))
    Write-Fixture (Join-Path $wt $unicodeName) "unicode name edited`r`n"
    Write-Fixture (Join-Path $wt 'dirty.txt') "dirty in Dir`nand worker`n"
    Write-Fixture (Join-Path $wt 'untracked.txt') "untracked edited`r`n"
    Write-Fixture (Join-Path $wt 'new.txt') "new file`n"
    Write-Bytes (Join-Path $wt 'empty-new.txt') ([byte[]]@())
    Write-Bytes (Join-Path $wt 'trunc.txt') ([byte[]]@())
    Write-Fixture (Join-Path $wt 'missing.txt') "recreated by worker`n"
    Write-Fixture (Join-Path $wt 'worker.log') 'ignored output'
    Write-Fixture (Join-Path $wt 'ignored-dir/x.txt') 'ignored folder'
    New-Item -ItemType Directory -Path (Join-Path $wt 'empty-folder') | Out-Null
    [IO.File]::Delete((Join-Path $wt 'swap1'))
    Write-Fixture (Join-Path $wt 'swap1/inner.txt') "inner`n"
    Remove-Item -LiteralPath (Join-Path $wt 'swap2') -Recurse -Force
    Write-Fixture (Join-Path $wt 'swap2') "now a file`n"
    $before = Get-Tree $repo
    # F7d: compare with the snapshot taken before setup, not with itself.
    Assert-Grok ($before -ceq $preSetup -and -not (Test-Path -LiteralPath (Join-Path $repo 'new.txt'))) "$tag Dir unchanged by setup and while the worker edits"
    $output = @(Invoke-GrokBringBack -RunFolder $run.Folder -GrokExit 0 6>&1) -join "`n"
    $result = Read-Apply $run
    $expectedFiles = Get-Sorted @('bin.dat','dirty.txt','edit-crlf.txt','edit-lf.txt','edit-mixed.txt','empty-new.txt','missing.txt','new.txt','swap1/inner.txt','swap2',$unicodeName,'trunc.txt','untracked.txt')
    Assert-Grok ($result.status -ceq 'applied' -and (Get-Sorted $result.files) -ceq $expectedFiles -and (Get-Sorted $result.deleted) -ceq 'del.txt|swap1|swap2/x.txt' -and (Read-Exit $run) -ceq '0') "$tag applied lists exactly changed+added files and deletes"
    Assert-Grok ((Test-Bytes (Join-Path $repo 'clean-lf.txt') (B "one`ntwo`n")) -and (Test-Bytes (Join-Path $repo 'clean-crlf.txt') (B "one`r`ntwo`r`n")) -and (Test-Bytes (Join-Path $repo 'clean-mixed.txt') (B "one`r`ntwo`nthree`r`n")) -and (Test-Bytes (Join-Path $repo 'zero.txt') ([byte[]]@()))) "$tag clean LF, CRLF, mixed and 0-byte files stay byte-identical"
    Assert-Grok ((Test-Bytes (Join-Path $repo 'edit-lf.txt') (B "alpha BETA`ngamma`n")) -and (Test-Bytes (Join-Path $repo 'edit-crlf.txt') (B "alpha BETA`r`ngamma`r`n")) -and (Test-Bytes (Join-Path $repo 'edit-mixed.txt') (B "alpha BETA`r`ngamma`ndelta`r`n"))) "$tag edited LF, CRLF and mixed files keep their own line endings"
    Assert-Grok ((Test-Bytes (Join-Path $repo 'bin.dat') $binaryEdited) -and (Test-Bytes (Join-Path $repo $unicodeName) (B "unicode name edited`r`n")) -and (Test-Bytes (Join-Path $repo 'dirty.txt') (B "dirty in Dir`nand worker`n")) -and (Test-Bytes (Join-Path $repo 'untracked.txt') (B "untracked edited`r`n"))) "$tag binary, non-ASCII, dirty and untracked edits brought back exactly"
    Assert-Grok ((Test-Bytes (Join-Path $repo 'new.txt') (B "new file`n")) -and (Test-Bytes (Join-Path $repo 'empty-new.txt') ([byte[]]@())) -and (Test-Bytes (Join-Path $repo 'trunc.txt') ([byte[]]@())) -and (Test-Bytes (Join-Path $repo 'missing.txt') (B "recreated by worker`n")) -and -not (Test-Path -LiteralPath (Join-Path $repo 'del.txt'))) "$tag new, 0-byte, truncated, missing-then-created and deleted files"
    Assert-Grok ((Test-Bytes (Join-Path $repo 'swap1/inner.txt') (B "inner`n")) -and (Test-Bytes (Join-Path $repo 'swap2') (B "now a file`n"))) "$tag file->directory and directory->file swaps"
    Assert-Grok (-not (Test-Path -LiteralPath (Join-Path $repo 'worker.log')) -and -not (Test-Path -LiteralPath (Join-Path $repo 'ignored-dir')) -and -not (Test-Path -LiteralPath (Join-Path $repo 'empty-folder')) -and (Test-Bytes (Join-Path $repo 'keep.log') (B 'ignored in Dir'))) "$tag ignored files and empty folders from the worker are not brought back"
    $undoState = Read-Undo $run
    # F3: raw order, no sorting helper: deletes in ordinal order, then changed+added in ordinal order.
    $rawOrder = (@($undoState.entries) | ForEach-Object { $_.path }) -join '|'
    Assert-Grok ($rawOrder -ceq ('del.txt|swap1|swap2/x.txt|' + $expectedFiles) -and ((@($result.files) -join '|') -ceq $expectedFiles)) "$tag undo.json entries and apply.json files are in A5 order (raw)"
    Assert-Grok ($undoState.state -ceq 'applied' -and @($undoState.entries).Count -eq 16 -and $undoState.dir -ceq $repo -and $result.undo -ceq (Join-Path $run.Folder 'undo\undo.json') -and -not (Test-Path -LiteralPath $run.Wt)) "$tag undo bundle applied and worktree removed"
    Assert-Grok ($output.Contains('grok patch: applied 13 file(s), deleted 3') -and $output.Contains("undo: codex-do.ps1 -Undo matrix-$mode")) "$tag result prints the undo command"
    Assert-Grok (@(Get-ChildItem -LiteralPath $repo -Recurse -Force -Filter '.grok-*.tmp' | Where-Object { $_.Name -ne '.grok-0a1b2c3d.tmp' }).Count -eq 0) "$tag no temp files left in Dir"
    $undo = Invoke-TestUndo $run.Folder
    Assert-Grok ($undo.Code -eq 0 -and (Get-Tree $repo) -ceq $before -and (Read-Undo $run).state -ceq 'undone') "$tag undo restores the whole tree byte-exact"
    Assert-Grok ($undo.Text.Contains('restored: del.txt') -and $undo.Text.Contains('grok undo: 16 restored, 0 skipped')) "$tag undo prints restored paths and a summary"
    $again = Invoke-TestUndo $run.Folder
    Assert-Grok ($again.Code -eq 0 -and $again.Text.Contains('already undone') -and (Get-Tree $repo) -ceq $before) "$tag second undo is already undone"

    # Intent: undo skips what Line changed after the run (exit 79), and a later explicit undo finishes. Status: A6/A7. Next: none. Blockers: none. Confidence: bytes.
    $repo2 = New-TestRepo "skip-$mode" $mode @{ 'a.txt' = (B "a`r`n"); 'b.txt' = (B "b`n") }
    $run2 = Start-TestRun $repo2 "skip-$mode"
    Write-Fixture (Join-Path $run2.Wt 'a.txt') "A`r`n"
    Write-Fixture (Join-Path $run2.Wt 'b.txt') "B`n"
    Invoke-GrokBringBack -RunFolder $run2.Folder -GrokExit 0 6>$null
    Write-Fixture (Join-Path $repo2 'b.txt') "Line edited later`n"
    $partial = Invoke-TestUndo $run2.Folder
    $undoResult = [IO.File]::ReadAllText((Join-Path $run2.Folder 'undo\undo-result.json')) | ConvertFrom-Json
    Assert-Grok ($partial.Code -eq 79 -and (Test-Bytes (Join-Path $repo2 'a.txt') (B "a`r`n")) -and (Test-Bytes (Join-Path $repo2 'b.txt') (B "Line edited later`n")) -and (Read-Undo $run2).state -ceq 'partial') "$tag undo skips a file changed after the run and exits 79"
    Assert-Grok ($partial.Text.Contains('skipped: b.txt (changed after the run)') -and @($undoResult.skipped).Count -eq 1 -and $undoResult.skipped[0].path -ceq 'b.txt' -and (Get-Sorted $undoResult.restored) -ceq 'a.txt') "$tag undo-result lists restored and skipped"
    Write-Fixture (Join-Path $repo2 'b.txt') "B`n"
    $finish = Invoke-TestUndo $run2.Folder
    Assert-Grok ($finish.Code -eq 0 -and (Test-Bytes (Join-Path $repo2 'b.txt') (B "b`n")) -and (Read-Undo $run2).state -ceq 'undone' -and $finish.Text.Contains('restored: a.txt (earlier undo)')) "$tag partial undo can be finished by run id"

    # Intent: undo never clears attributes in Dir; a read-only target is skipped (A3). Status: undo path. Next: none. Blockers: none. Confidence: bytes and reason.
    $repo11 = New-TestRepo "ro-undo-$mode" $mode @{ 'ro.txt' = (B "ro`n") }
    $run11 = Start-TestRun $repo11 "ro-undo-$mode"
    Write-Fixture (Join-Path $run11.Wt 'ro.txt') "RO`n"
    Invoke-GrokBringBack -RunFolder $run11.Folder -GrokExit 0 6>$null
    $roPath = Join-Path $repo11 'ro.txt'
    [IO.File]::SetAttributes($roPath, [IO.FileAttributes]::ReadOnly)
    $roUndo = Invoke-TestUndo $run11.Folder
    Assert-Grok ($roUndo.Code -eq 79 -and $roUndo.Text.Contains('skipped: ro.txt (read-only)') -and (Test-Bytes $roPath (B "RO`n")) -and (([IO.File]::GetAttributes($roPath) -band [IO.FileAttributes]::ReadOnly) -ne 0)) "$tag undo skips a read-only target and keeps its attribute"
    [IO.File]::SetAttributes($roPath, [IO.FileAttributes]::Normal)

    # Intent: Dir edited during the run -> nothing applied, exit 77. Status: criterion 3. Next: none. Blockers: none. Confidence: whole-tree snapshot.
    $repo3 = New-TestRepo "conflict-$mode" $mode @{ 'c.txt' = (B "c`r`n"); 'd.txt' = (B "d`n") }
    $run3 = Start-TestRun $repo3 "conflict-$mode"
    Write-Fixture (Join-Path $run3.Wt 'c.txt') "worker`r`n"
    Write-Fixture (Join-Path $run3.Wt 'd.txt') "worker d`n"
    Write-Fixture (Join-Path $run3.Wt 'n.txt') "worker new`n"
    Write-Fixture (Join-Path $run3.Wt 'n2.txt') "worker new 2`n"
    Write-Fixture (Join-Path $repo3 'c.txt') "concurrent`r`n"
    Write-Fixture (Join-Path $repo3 'n2.txt') "Line created it too`n"
    $conflictBefore = Get-Tree $repo3
    $conflictOut = @(Invoke-GrokBringBack -RunFolder $run3.Folder -GrokExit 0 6>&1) -join "`n"
    $conflict = Read-Apply $run3
    Assert-Grok ($conflict.status -ceq 'conflict' -and (Get-Sorted $conflict.conflicts) -ceq 'c.txt|n2.txt' -and (Read-Exit $run3) -ceq '77') "$tag conflict lists paths and exits 77"
    Assert-Grok ((Get-Tree $repo3) -ceq $conflictBefore -and (Test-Path -LiteralPath $run3.Wt) -and -not (Test-Path -LiteralPath (Join-Path $run3.Folder 'undo'))) "$tag conflict applies nothing, keeps the worktree, writes no undo bundle"
    Assert-Grok ($conflictOut.Contains('grok patch: conflict c.txt') -and $conflictOut.Contains("grok patch: CONFLICT - kept $($run3.Wt)")) "$tag conflict output lists paths"
    $retryMarker = [IO.File]::ReadAllText((Join-Path $run3.Folder 'apply.json'))
    Invoke-GrokBringBack -RunFolder $run3.Folder -GrokExit 0 6>$null
    Assert-Grok ([IO.File]::ReadAllText((Join-Path $run3.Folder 'apply.json')) -ceq $retryMarker) "$tag conflict retry is a no-op"

    # Intent: a write failure mid-apply rolls back earlier writes (A3 read-only target). Status: criterion 5. Next: none. Blockers: none. Confidence: whole-tree snapshot.
    $repo4 = New-TestRepo "rollback-$mode" $mode @{ 'a1.txt' = (B "a1`r`n"); 'z9.txt' = (B "z9`n") }
    $run4 = Start-TestRun $repo4 "rollback-$mode"
    Write-Fixture (Join-Path $run4.Wt 'a1.txt') "A1 worker`r`n"
    Write-Fixture (Join-Path $run4.Wt 'newdir/m5.txt') "m5`n"
    Write-Fixture (Join-Path $run4.Wt 'z9.txt') "Z9 worker`n"
    $lockedPath = Join-Path $repo4 'z9.txt'
    [IO.File]::SetAttributes($lockedPath, [IO.FileAttributes]::ReadOnly)
    $rollbackBefore = Get-Tree $repo4
    $rollbackOut = @(Invoke-GrokBringBack -RunFolder $run4.Folder -GrokExit 0 6>&1) -join "`n"
    $rolled = Read-Apply $run4
    Assert-Grok ($rolled.status -ceq 'error' -and $rolled.reason -match 'read-only' -and $rolled.reason -match 'z9\.txt' -and (Read-Exit $run4) -ceq '77' -and $rollbackOut.Contains('grok patch: error')) "$tag read-only target is a write failure with exit 77"
    Assert-Grok ((Get-Tree $repo4) -ceq $rollbackBefore -and (Read-Undo $run4).state -ceq 'rolled-back' -and (Test-Path -LiteralPath $run4.Wt) -and (([IO.File]::GetAttributes($lockedPath) -band [IO.FileAttributes]::ReadOnly) -ne 0)) "$tag earlier writes rolled back, created folder removed, read-only kept"
    $nothing = Invoke-TestUndo $run4.Folder
    Assert-Grok ($nothing.Code -eq 0 -and $nothing.Text.Contains('nothing to undo') -and (Get-Tree $repo4) -ceq $rollbackBefore) "$tag undo of a rolled-back run does nothing"
    [IO.File]::SetAttributes($lockedPath, [IO.FileAttributes]::Normal)

    # Intent: a hash change right before a write = conflict, rollback, and the racing edit is kept (A2). Status: re-check. Next: none. Blockers: none. Confidence: overridden re-check.
    $repo5 = New-TestRepo "race-$mode" $mode @{ 'r1.txt' = (B "r1`n"); 'r2.txt' = (B "r2`r`n") }
    $run5 = Start-TestRun $repo5 "race-$mode"
    Write-Fixture (Join-Path $run5.Wt 'r1.txt') "R1`n"
    Write-Fixture (Join-Path $run5.Wt 'r2.txt') "R2`r`n"
    $script:originalTargetState = ${function:Test-GrokTargetState}
    $script:raceTarget = Join-Path $repo5 'r2.txt'
    $script:raceCalls = 0
    function Test-GrokTargetState {
      param([string]$Target, [AllowNull()][string]$Sha)
      if ($Target -ceq $script:raceTarget) { $script:raceCalls++; if ($script:raceCalls -eq 2) { Write-Fixture $Target "Line raced`r`n" } }
      return (& $script:originalTargetState -Target $Target -Sha $Sha)
    }
    try { Invoke-GrokBringBack -RunFolder $run5.Folder -GrokExit 0 6>$null }
    finally { Set-Item -Path Function:\Test-GrokTargetState -Value $script:originalTargetState }
    $race = Read-Apply $run5
    Assert-Grok ($race.status -ceq 'conflict' -and (Get-Sorted $race.conflicts) -ceq 'r2.txt' -and (Read-Exit $run5) -ceq '77') "$tag re-check mismatch before a write is a conflict"
    Assert-Grok ((Test-Bytes (Join-Path $repo5 'r1.txt') (B "r1`n")) -and (Test-Bytes (Join-Path $repo5 'r2.txt') (B "Line raced`r`n")) -and (Read-Undo $run5).state -ceq 'rolled-back') "$tag race rolls back r1 and keeps Line's r2"

    # Intent: a case-only rename deletes then adds (A4). Status: case test. Next: none. Blockers: none. Confidence: on-disk names.
    $repo6 = New-TestRepo "case-$mode" $mode @{ 'Readme.txt' = (B "case`r`n") }
    $run6 = Start-TestRun $repo6 "case-$mode"
    [IO.File]::Move((Join-Path $run6.Wt 'Readme.txt'), (Join-Path $run6.Wt 'tmp-case.txt'))
    [IO.File]::Move((Join-Path $run6.Wt 'tmp-case.txt'), (Join-Path $run6.Wt 'README.txt'))
    Invoke-GrokBringBack -RunFolder $run6.Folder -GrokExit 0 6>$null
    $case = Read-Apply $run6
    $names = @((New-Object IO.DirectoryInfo($repo6)).GetFiles() | ForEach-Object { $_.Name })
    Assert-Grok ($case.status -ceq 'applied' -and (Get-Sorted $case.files) -ceq 'README.txt' -and (Get-Sorted $case.deleted) -ceq 'Readme.txt' -and ($names -ccontains 'README.txt') -and -not ($names -ccontains 'Readme.txt') -and (Test-Bytes (Join-Path $repo6 'README.txt') (B "case`r`n"))) "$tag case-only rename brought back"
    $caseUndo = Invoke-TestUndo $run6.Folder
    $names = @((New-Object IO.DirectoryInfo($repo6)).GetFiles() | ForEach-Object { $_.Name })
    Assert-Grok ($caseUndo.Code -eq 0 -and ($names -ccontains 'Readme.txt') -and -not ($names -ccontains 'README.txt')) "$tag case-only rename undone"

    # Intent: .gitattributes eol=lf plus a CRLF working file - no conversion anywhere. Status: A10. Next: none. Blockers: none. Confidence: bytes.
    $repo7 = New-TestRepo "attr-$mode" $mode @{ '.gitattributes' = (B "* text eol=lf`n"); 'attr.txt' = (B "one two`r`nthree`r`n"); 'other.txt' = (B "other`r`n") }
    Assert-Grok ((Test-Bytes (Join-Path $repo7 'attr.txt') (B "one two`r`nthree`r`n"))) "$tag fixture keeps a CRLF working file under eol=lf"
    $run7 = Start-TestRun $repo7 "attr-$mode"
    Assert-Grok ((Test-Bytes (Join-Path $run7.Wt 'attr.txt') (B "one two`r`nthree`r`n"))) "$tag setup copies the CRLF file under eol=lf unchanged"
    Write-Fixture (Join-Path $run7.Wt 'attr.txt') "one TWO`r`nthree`r`n"
    Invoke-GrokBringBack -RunFolder $run7.Folder -GrokExit 0 6>$null
    Assert-Grok ((Read-Apply $run7).status -ceq 'applied' -and (Test-Bytes (Join-Path $repo7 'attr.txt') (B "one TWO`r`nthree`r`n")) -and (Test-Bytes (Join-Path $repo7 'other.txt') (B "other`r`n"))) "$tag eol=lf attribute causes no conversion on bring-back"

    # Intent: the worker's nested repository is skipped, other changes still apply (A10). Status: skip list. Next: none. Blockers: none. Confidence: apply.json.
    $repo8 = New-TestRepo "nested-$mode" $mode @{ 'a.txt' = (B "a`n") }
    $run8 = Start-TestRun $repo8 "nested-$mode"
    Write-Fixture (Join-Path $run8.Wt 'a.txt') "A`n"
    $sub = Join-Path $run8.Wt 'sub'
    New-Item -ItemType Directory -Path $sub | Out-Null
    [void](Invoke-GrokGit -Dir $sub -Arguments @('init','--quiet'))
    Write-Fixture (Join-Path $sub 'f.txt') 'inside nested'
    $nestedOut = @(Invoke-GrokBringBack -RunFolder $run8.Folder -GrokExit 0 6>&1) -join "`n"
    $nestedResult = Read-Apply $run8
    Assert-Grok ($nestedResult.status -ceq 'applied' -and (Get-Sorted $nestedResult.files) -ceq 'a.txt' -and (Get-Sorted @($nestedResult.skipped | ForEach-Object { $_.path })) -ceq 'sub' -and @($nestedResult.skipped)[0].reason -ceq 'nested repository' -and -not (Test-Path -LiteralPath (Join-Path $repo8 'sub')) -and (Test-Bytes (Join-Path $repo8 'a.txt') (B "A`n"))) "$tag nested repository from the worker is skipped and listed"
    Assert-Grok ((Test-Path -LiteralPath (Join-Path $sub 'f.txt')) -and $nestedOut.Contains('grok patch: skipped sub (nested repository)')) "$tag worktree kept so the skipped repository is not lost"

    # Intent: a crashed apply leaves state pending; -Undo still restores (A2, A10). Status: pending bundle. Next: none. Blockers: none. Confidence: whole tree.
    $repo9 = New-TestRepo "pending-$mode" $mode @{ 'p1.txt' = (B "p1`n"); 'p2.txt' = (B "p2`r`n") }
    $pendingBefore = Get-Tree $repo9
    $run9 = Start-TestRun $repo9 "pending-$mode"
    Write-Fixture (Join-Path $run9.Wt 'p1.txt') "P1`n"
    Write-Fixture (Join-Path $run9.Wt 'p2.txt') "P2`r`n"
    Write-Fixture (Join-Path $run9.Wt 'p3.txt') "P3`n"
    Invoke-GrokBringBack -RunFolder $run9.Folder -GrokExit 0 6>$null
    $bundle = Read-Undo $run9
    $bundle.state = 'pending'
    Write-Fixture (Join-Path $run9.Folder 'undo\undo.json') ($bundle | ConvertTo-Json -Depth 6)
    Write-Fixture (Join-Path $repo9 'p2.txt') "p2`r`n"   # simulate: the crash happened before p2 was written
    $pendingUndo = Invoke-TestUndo $run9.Folder
    Assert-Grok ($pendingUndo.Code -eq 0 -and (Get-Tree $repo9) -ceq $pendingBefore -and (Read-Undo $run9).state -ceq 'undone') "$tag undo of a pending (crashed) bundle"

    # Intent: F1a - two index entries differing only in case map to one disk file; a no-op run must not delete or rewrite it. Status: canonical setup. Next: none. Blockers: none. Confidence: whole tree + alias.
    $repoC1 = New-TestRepo "casedup-$mode" $mode @{ 'File.txt' = (B "content`r`n"); 'other.txt' = (B "o`n") }
    $blob = Invoke-GrokGit -Dir $repoC1 -Arguments @('rev-parse','HEAD:File.txt')
    [void](Invoke-GrokGit -Dir $repoC1 -Arguments @('update-index','--add','--cacheinfo',"100644,$blob,file.txt"))
    [void](Invoke-GrokGit -Dir $repoC1 -Arguments @('commit','--quiet','-m','case duplicate'))
    $c1Before = Get-Tree $repoC1
    $runC1 = Start-TestRun $repoC1 "casedup-$mode"
    $c1Manifest = [IO.File]::ReadAllText($runC1.Manifest) | ConvertFrom-Json
    Invoke-GrokBringBack -RunFolder $runC1.Folder -GrokExit 0 6>$null
    Assert-Grok ((Read-Apply $runC1).status -ceq 'empty' -and (Get-Tree $repoC1) -ceq $c1Before -and @($c1Manifest.files).Count -eq 2 -and @($c1Manifest.aliases).Count -eq 1 -and @($c1Manifest.aliases)[0].path -ceq 'file.txt' -and @($c1Manifest.aliases)[0].canonical -ceq 'File.txt') "$tag F1a case-duplicate index entries: no-op run is empty, Dir identical, alias recorded"

    # Intent: F1b - two tracked files whose folder spelling differs only in case; a no-op run must not delete and re-create either. Status: canonical folders. Next: none. Blockers: none. Confidence: tree + write time.
    $repoC2 = New-TestRepo "casedir-$mode" $mode @{ 'Docs/a.md' = (B "a`n") }
    Write-Fixture (Join-Path $repoC2 'Docs/b.md') "b`n"
    $blob = Invoke-GrokGit -Dir $repoC2 -Arguments @('hash-object','-w','--','Docs/b.md')
    [void](Invoke-GrokGit -Dir $repoC2 -Arguments @('update-index','--add','--cacheinfo',"100644,$blob,docs/b.md"))
    [void](Invoke-GrokGit -Dir $repoC2 -Arguments @('commit','--quiet','-m','case folder'))
    $c2Before = Get-Tree $repoC2
    [IO.File]::SetLastWriteTimeUtc((Join-Path $repoC2 'Docs/b.md'), [datetime]'2020-01-01')
    $runC2 = Start-TestRun $repoC2 "casedir-$mode"
    $c2Paths = Get-Sorted @(([IO.File]::ReadAllText($runC2.Manifest) | ConvertFrom-Json).files | ForEach-Object { $_.path })
    Invoke-GrokBringBack -RunFolder $runC2.Folder -GrokExit 0 6>$null
    Assert-Grok ((Read-Apply $runC2).status -ceq 'empty' -and (Get-Tree $repoC2) -ceq $c2Before -and [IO.File]::GetLastWriteTimeUtc((Join-Path $repoC2 'Docs/b.md')) -eq [datetime]'2020-01-01' -and $c2Paths -ceq 'Docs/a.md|Docs/b.md') "$tag F1b folder spellings differing in case: one canonical folder, no-op run leaves Dir untouched"

    # Intent: F2 - a file that became a two-level folder tree is restored by undo. Status: createdDirs cleanup. Next: none. Blockers: none. Confidence: whole tree.
    $repoD = New-TestRepo "deepswap-$mode" $mode @{ 'd' = (B "was a file`n"); 'k.txt' = (B "k`n") }
    $dBefore = Get-Tree $repoD
    $runD = Start-TestRun $repoD "deepswap-$mode"
    [IO.File]::Delete((Join-Path $runD.Wt 'd'))
    Write-Fixture (Join-Path $runD.Wt 'd/sub/x.txt') "x`n"
    Invoke-GrokBringBack -RunFolder $runD.Folder -GrokExit 0 6>$null
    Assert-Grok ((Read-Apply $runD).status -ceq 'applied' -and (Test-Bytes (Join-Path $repoD 'd/sub/x.txt') (B "x`n"))) "$tag F2 file->two-level folder applied"
    $deepUndo = Invoke-TestUndo $runD.Folder
    Assert-Grok ($deepUndo.Code -eq 0 -and (Get-Tree $repoD) -ceq $dBefore -and (Read-Undo $runD).state -ceq 'undone') "$tag F2 undo restores a file that became a two-level folder"

    # Intent: F2 - the same swap rolled back after a later write fails. Status: rollback path. Next: none. Blockers: none. Confidence: whole tree.
    $repoD2 = New-TestRepo "deeproll-$mode" $mode @{ 'd' = (B "was a file`n"); 'z.txt' = (B "z`n") }
    $runD2 = Start-TestRun $repoD2 "deeproll-$mode"
    [IO.File]::Delete((Join-Path $runD2.Wt 'd'))
    Write-Fixture (Join-Path $runD2.Wt 'd/sub/x.txt') "x`n"
    Write-Fixture (Join-Path $runD2.Wt 'z.txt') "Z`n"
    [IO.File]::SetAttributes((Join-Path $repoD2 'z.txt'), [IO.FileAttributes]::ReadOnly)
    $d2Before = Get-Tree $repoD2
    Invoke-GrokBringBack -RunFolder $runD2.Folder -GrokExit 0 6>$null
    $d2Result = Read-Apply $runD2
    Assert-Grok ($d2Result.status -ceq 'error' -and $null -eq $d2Result.unrestored -and (Read-Undo $runD2).state -ceq 'rolled-back' -and (Get-Tree $repoD2) -ceq $d2Before) "$tag F2 rollback restores a file that became a two-level folder"
    [IO.File]::SetAttributes((Join-Path $repoD2 'z.txt'), [IO.FileAttributes]::Normal)

    # Intent: F7a - stale engine temps (>10 min) are removed only in folders being written; fresh ones and other folders stay. Status: apply and undo. Next: none. Blockers: none. Confidence: file existence.
    $repoT = New-TestRepo "stale-$mode" $mode @{ 'w/a.txt' = (B "a`n"); 'other/o.txt' = (B "o`n") }
    $oldTemp = Join-Path $repoT 'w/.grok-11111111.tmp'; $freshTemp = Join-Path $repoT 'w/.grok-22222222.tmp'; $otherTemp = Join-Path $repoT 'other/.grok-33333333.tmp'
    foreach ($tempPath in @($oldTemp, $freshTemp, $otherTemp)) { Write-Fixture $tempPath 'leftover' }
    foreach ($tempPath in @($oldTemp, $otherTemp)) { [IO.File]::SetLastWriteTimeUtc($tempPath, [DateTime]::UtcNow.AddMinutes(-20)) }
    $runT = Start-TestRun $repoT "stale-$mode"
    Write-Fixture (Join-Path $runT.Wt 'w/a.txt') "A`n"
    Invoke-GrokBringBack -RunFolder $runT.Folder -GrokExit 0 6>$null
    Assert-Grok ((Read-Apply $runT).status -ceq 'applied' -and -not (Test-Path -LiteralPath $oldTemp) -and (Test-Path -LiteralPath $freshTemp) -and (Test-Path -LiteralPath $otherTemp)) "$tag F7a apply removes only stale temps in written folders"
    $undoTemp = Join-Path $repoT 'w/.grok-44444444.tmp'
    Write-Fixture $undoTemp 'leftover'; [IO.File]::SetLastWriteTimeUtc($undoTemp, [DateTime]::UtcNow.AddMinutes(-20))
    $tempUndo = Invoke-TestUndo $runT.Folder
    Assert-Grok ($tempUndo.Code -eq 0 -and -not (Test-Path -LiteralPath $undoTemp) -and (Test-Path -LiteralPath $freshTemp) -and (Test-Path -LiteralPath $otherTemp)) "$tag F7a undo removes only stale temps in written folders"
    # Intent: failed workers cannot publish partial edits. Status: F2 regression. Next: none. Blockers: none. Confidence: changed file and exact output assertion.
    $repo10 = New-TestRepo "skipped-$mode" $mode @{ 's.txt' = (B "s`n") }
    $run10 = Start-TestRun $repo10 "skipped-$mode"
    Write-Fixture (Join-Path $run10.Wt 's.txt') "failed worker edit`n"
    $skipOutput = @(Invoke-GrokBringBack -RunFolder $run10.Folder -GrokExit 6 6>&1) -join "`n"
    Assert-Grok ((Read-Apply $run10).status -ceq 'skipped' -and (Read-Apply $run10).reason -ceq 'grok exit 6' -and (Read-Exit $run10) -ceq '6') "$tag nonzero Grok exit skips bring-back and preserves exit"
    Assert-Grok ((Test-Path -LiteralPath $run10.Wt) -and (Test-Bytes (Join-Path $repo10 's.txt') (B "s`n")) -and -not (Test-Path -LiteralPath (Join-Path $run10.Folder 'undo'))) "$tag skipped run keeps edits isolated"
    Assert-Grok ($skipOutput -ceq "grok patch: SKIPPED (grok exit 6) - kept $($run10.Wt)") "$tag skipped result prints the recovery path"
  }

  # Intent: general repository for lifecycle regressions kept from K5a-K5c. Status: autocrlf false. Next: none. Blockers: none. Confidence: temp repo only.
  $repo = New-TestRepo 'original repo' 'false' @{ 'README.md' = (B "readme`n"); 'claude/CLAUDE.md' = (B "claude`r`n") }
  $tracked = Join-Path $repo 'README.md'
  Write-Fixture (Join-Path $repo 'notes with space.txt') 'earlier untracked content'
  $empty = Start-TestRun $repo 'empty'
  Invoke-GrokBringBack -RunFolder $empty.Folder -GrokExit 0 6>$null
  Assert-Grok ((Read-Apply $empty).status -ceq 'empty' -and (Read-Exit $empty) -ceq '0' -and -not (Test-Path -LiteralPath $empty.Wt) -and -not (Test-Path -LiteralPath (Join-Path $empty.Folder 'undo'))) 'successful empty change set publishes zero without an undo bundle'

  # Intent: infrastructure errors still publish a durable exit and are not conflicts. Status: F3 regression. Next: none. Blockers: none. Confidence: malformed metadata fixture.
  $brokenFolder = Join-Path $fixture 'broken-run'
  New-Item -ItemType Directory -Path $brokenFolder | Out-Null
  Write-Fixture (Join-Path $brokenFolder 'run.json') '{bad JSON'
  Invoke-GrokBringBack -RunFolder $brokenFolder -GrokExit 0 6>$null
  $broken = [IO.File]::ReadAllText((Join-Path $brokenFolder 'apply.json')) | ConvertFrom-Json
  Assert-Grok ($broken.status -ceq 'error' -and [IO.File]::ReadAllText((Join-Path $brokenFolder 'exit.txt')).Trim() -ceq '77') 'bad metadata is error with durable exit 77'
  $legacyFolder = Join-Path $fixture 'legacy-run'
  New-Item -ItemType Directory -Path $legacyFolder | Out-Null
  Write-Fixture (Join-Path $legacyFolder 'run.json') (@{ engine='grok'; dir=$repo; worktreeDir=(Join-Path $fixture 'nowhere'); baselineTree='abc' } | ConvertTo-Json)
  Invoke-GrokBringBack -RunFolder $legacyFolder -GrokExit 0 6>$null
  $legacy = [IO.File]::ReadAllText((Join-Path $legacyFolder 'apply.json')) | ConvertFrom-Json
  Assert-Grok ($legacy.status -ceq 'error' -and $legacy.reason -ceq 'invalid Grok run metadata' -and [IO.File]::ReadAllText((Join-Path $legacyFolder 'exit.txt')).Trim() -ceq '77') 'pre-K5d run without manifest is invalid metadata, exit 77'

  # Intent: a marker write failure after a successful apply still reports applied. Status: fix2 G5 regression. Next: none. Blockers: none. Confidence: applied marker serialization forced to throw.
  $markerFail = Start-TestRun $repo 'marker-fail'
  Write-Fixture (Join-Path $markerFail.Wt 'marker-fail.txt') "applied before marker failure`n"
  $script:markerThrown = $false
  function ConvertTo-Json {
    param([Parameter(ValueFromPipeline = $true)]$InputObject, [int]$Depth = 2)
    begin { $items = @() } process { $items += $InputObject }
    end {
      if (-not $script:markerThrown -and $items.Count -eq 1 -and $items[0] -is [Collections.IDictionary] -and $items[0]['status'] -eq 'applied' -and $items[0].Contains('files')) {
        $script:markerThrown = $true; throw 'forced marker write failure'
      }
      $items | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth $Depth
    }
  }
  try { Invoke-GrokBringBack -RunFolder $markerFail.Folder -GrokExit 0 6>$null }
  finally { Remove-Item -LiteralPath Function:\ConvertTo-Json }
  $markerResult = Read-Apply $markerFail
  Assert-Grok ($markerResult.status -ceq 'applied' -and $markerResult.warning -match 'forced marker write failure' -and (Read-Exit $markerFail) -ceq '0') 'marker write failure after apply reports applied with warning and Grok exit'
  Assert-Grok ([IO.File]::ReadAllText((Join-Path $repo 'marker-fail.txt')) -ceq "applied before marker failure`n" -and -not (Test-Path -LiteralPath $markerFail.Wt)) 'marker write failure keeps the applied edit'
  [IO.File]::Delete((Join-Path $repo 'marker-fail.txt'))

  $subdir = Join-Path $repo 'claude'
  $invalidWt = Join-Path $fixture 'invalid-wt'
  $rejected = $false
  try { New-GrokWorktree -Dir $subdir -WorktreeDir $invalidWt -RunFolder $fixture | Out-Null } catch { $rejected = $true }
  Assert-Grok ($rejected -and -not (Test-Path -LiteralPath $invalidWt)) 'non-toplevel rejected before worktree creation'
  $noHead = Join-Path $fixture 'unborn'
  New-Item -ItemType Directory -Path $noHead | Out-Null
  [void](Invoke-GrokGit -Dir $noHead -Arguments @('init','--quiet'))
  $rejected = $false
  try { New-GrokWorktree -Dir $noHead -WorktreeDir $invalidWt -RunFolder $fixture | Out-Null } catch { $rejected = $true }
  Assert-Grok ($rejected -and -not (Test-Path -LiteralPath $invalidWt)) 'missing HEAD rejected before worktree creation'

  # Intent: F4 - a crash mid-apply (unreadable apply.json, bundle pending/failed) tells Line to run -Undo. Status: replay text. Next: none. Blockers: none. Confidence: exact line.
  $inc = Start-TestRun $repo 'incomplete'
  Write-Fixture (Join-Path $inc.Wt 'README.md') "incomplete edit`n"
  Invoke-GrokBringBack -RunFolder $inc.Folder -GrokExit 0 6>$null
  Write-Fixture (Join-Path $inc.Folder 'apply.json') ''
  $incBundle = Read-Undo $inc; $incBundle.state = 'pending'
  Write-Fixture (Join-Path $inc.Folder 'undo\undo.json') ($incBundle | ConvertTo-Json -Depth 6)
  $incOut = @(Write-GrokApplyResult -RunFolder $inc.Folder 6>&1) -join "`n"
  Write-Fixture (Join-Path $inc.Folder 'apply.json') '{"status":"error","reason":"x"}'
  $incBundle.state = 'failed'
  Write-Fixture (Join-Path $inc.Folder 'undo\undo.json') ($incBundle | ConvertTo-Json -Depth 6)
  $incOut2 = @(Write-GrokApplyResult -RunFolder $inc.Folder 6>&1) -join "`n"
  Assert-Grok ($incOut -ceq 'grok patch: INCOMPLETE APPLY - run codex-do.ps1 -Undo incomplete' -and $incOut2.Contains('grok patch: INCOMPLETE APPLY - run codex-do.ps1 -Undo incomplete') -and $incOut2.Contains('grok patch: error x')) 'F4 crash mid-apply prints INCOMPLETE APPLY with the -Undo command'
  $incUndo = Invoke-TestUndo $inc.Folder
  Assert-Grok ($incUndo.Code -eq 0 -and [IO.File]::ReadAllText($tracked) -ceq "readme`n") 'F4 the incomplete run is undone'

  # Intent: F5 - all Dir writes landed but the final undo.json write failed: still 'applied' with a warning; bundle stays pending and -Undo works. Status: forced failure. Next: none. Blockers: none. Confidence: state file.
  $f5 = Start-TestRun $repo 'state-write-fail'
  Write-Fixture (Join-Path $f5.Wt 'f5.txt') "f5`n"
  $script:originalJsonWriter = ${function:Write-GrokJsonFile}
  function Write-GrokJsonFile {
    param([string]$Path, [object]$Value)
    if ($Value -is [Collections.IDictionary] -and $Value['state'] -eq 'applied') { throw 'forced state write failure' }
    & $script:originalJsonWriter -Path $Path -Value $Value
  }
  try { Invoke-GrokBringBack -RunFolder $f5.Folder -GrokExit 0 6>$null }
  finally { Set-Item -Path Function:\Write-GrokJsonFile -Value $script:originalJsonWriter }
  $f5Result = Read-Apply $f5
  Assert-Grok ($f5Result.status -ceq 'applied' -and $f5Result.warning -match 'forced state write failure' -and $f5Result.undo -and (Read-Exit $f5) -ceq '0' -and (Read-Undo $f5).state -ceq 'pending' -and (Test-Path -LiteralPath (Join-Path $repo 'f5.txt'))) 'F5 failed final state write still reports applied with a warning, bundle pending'
  $f5Undo = Invoke-TestUndo $f5.Folder
  Assert-Grok ($f5Undo.Code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $repo 'f5.txt'))) 'F5 the pending bundle is undone'

  # Intent: F7b - -Undo when Dir is gone: message, exit 2, nothing recreated. Status: guard. Next: none. Blockers: none. Confidence: path check.
  $goneRepo = New-TestRepo 'gone repo' 'false' @{ 'g.txt' = (B "g`n") }
  $gone = Start-TestRun $goneRepo 'gone'
  Write-Fixture (Join-Path $gone.Wt 'g.txt') "G`n"
  Invoke-GrokBringBack -RunFolder $gone.Folder -GrokExit 0 6>$null
  Rename-Item -LiteralPath $goneRepo -NewName 'gone repo moved'
  $goneUndo = Invoke-TestUndo $gone.Folder
  Assert-Grok ($goneUndo.Code -eq 2 -and $goneUndo.Text.Contains('Dir no longer exists') -and -not (Test-Path -LiteralPath $goneRepo) -and (Read-Undo $gone).state -ceq 'applied') 'F7b -Undo with a missing Dir exits 2 and writes nothing'

  # Intent: F7c - a junction that replaces a tracked folder in the worktree is skipped, never followed, and Dir's files are not deleted. Status: reparse guard. Next: none. Blockers: none. Confidence: apply.json + bytes.
  $repoJ = New-TestRepo 'junction repo' 'false' @{ 'jdir/a.txt' = (B "a`n"); 'b.txt' = (B "b`n") }
  $runJ = Start-TestRun $repoJ 'junction'
  $junctionTarget = Join-Path $fixture 'junction-target'
  Write-Fixture (Join-Path $junctionTarget 'outside.txt') 'outside'
  Remove-Item -LiteralPath (Join-Path $runJ.Wt 'jdir') -Recurse -Force
  $junction = Join-Path $runJ.Wt 'jdir'
  New-Item -ItemType Junction -Path $junction -Value $junctionTarget | Out-Null
  Write-Fixture (Join-Path $runJ.Wt 'b.txt') "B`n"
  Invoke-GrokBringBack -RunFolder $runJ.Folder -GrokExit 0 6>$null
  $jResult = Read-Apply $runJ
  $reparseSkips = @(@($jResult.skipped) | Where-Object { $_.reason -ceq 'reparse point' } | ForEach-Object { $_.path })
  Assert-Grok ($jResult.status -ceq 'applied' -and (Get-Sorted $jResult.files) -ceq 'b.txt' -and @($jResult.deleted).Count -eq 0 -and ($reparseSkips -join '|') -ceq 'jdir/a.txt' -and (Test-Bytes (Join-Path $repoJ 'jdir/a.txt') (B "a`n")) -and -not (Test-Path -LiteralPath (Join-Path $repoJ 'jdir/outside.txt')) -and (Test-Path -LiteralPath $runJ.Wt)) 'F7c junction in the worktree is skipped as a reparse point and Dir keeps its files'
  [IO.Directory]::Delete($junction)

  # Intent: F7e - rollback that cannot restore a file (Line edited it) leaves state failed + unrestored; -Undo of the failed bundle then restores. Status: failed bundle. Next: none. Blockers: none. Confidence: bytes.
  $repoF = New-TestRepo 'rbfail repo' 'false' @{ 'a1.txt' = (B "a1`n"); 'z9.txt' = (B "z9`n") }
  $runF = Start-TestRun $repoF 'rbfail'
  Write-Fixture (Join-Path $runF.Wt 'a1.txt') "A1 worker`n"
  Write-Fixture (Join-Path $runF.Wt 'z9.txt') "Z9 worker`n"
  $z9 = Join-Path $repoF 'z9.txt'
  [IO.File]::SetAttributes($z9, [IO.FileAttributes]::ReadOnly)
  $script:originalTargetState = ${function:Test-GrokTargetState}
  $script:raceTarget = $z9; $script:raceCalls = 0; $script:raceOther = Join-Path $repoF 'a1.txt'
  function Test-GrokTargetState {
    param([string]$Target, [AllowNull()][string]$Sha)
    if ($Target -ceq $script:raceTarget) { $script:raceCalls++; if ($script:raceCalls -eq 2) { Write-Fixture $script:raceOther "Line edited after our write`n" } }
    return (& $script:originalTargetState -Target $Target -Sha $Sha)
  }
  try { $rbOut = @(Invoke-GrokBringBack -RunFolder $runF.Folder -GrokExit 0 6>&1) -join "`n" }
  finally { Set-Item -Path Function:\Test-GrokTargetState -Value $script:originalTargetState }
  $rbResult = Read-Apply $runF
  Assert-Grok ($rbResult.status -ceq 'error' -and (Get-Sorted $rbResult.unrestored) -ceq 'a1.txt' -and (Read-Undo $runF).state -ceq 'failed' -and (Test-Bytes (Join-Path $repoF 'a1.txt') (B "Line edited after our write`n")) -and $rbOut.Contains('grok patch: NOT RESTORED a1.txt') -and $rbOut.Contains('INCOMPLETE APPLY')) 'F7e rollback failure leaves state failed with unrestored paths'
  Write-Fixture (Join-Path $repoF 'a1.txt') "A1 worker`n"
  $failedUndo = Invoke-TestUndo $runF.Folder
  Assert-Grok ($failedUndo.Code -eq 0 -and (Test-Bytes (Join-Path $repoF 'a1.txt') (B "a1`n")) -and (Test-Bytes $z9 (B "z9`n")) -and (Read-Undo $runF).state -ceq 'undone') 'F7e -Undo of a failed bundle restores'
  [IO.File]::SetAttributes($z9, [IO.FileAttributes]::Normal)
  # Intent: T1 - the stale-temp sweep deletes only the engine's own lowercase-hex names; Line's tracked .grok-settings.tmp survives. Status: sweep matcher. Next: none. Blockers: none. Confidence: file existence.
  $repoT1 = New-TestRepo 't1 repo' 'false' @{ 'a.txt' = (B "a`n"); '.grok-settings.tmp' = (B "Line's own file`n") }
  Write-Fixture (Join-Path $repoT1 '.grok-0a1b2c3d.tmp') 'real stale temp'
  foreach ($name in @('.grok-settings.tmp', '.grok-0a1b2c3d.tmp')) { [IO.File]::SetLastWriteTimeUtc((Join-Path $repoT1 $name), [DateTime]::UtcNow.AddHours(-2)) }
  $runT1 = Start-TestRun $repoT1 't1'
  Write-Fixture (Join-Path $runT1.Wt 'a.txt') "A`n"
  Invoke-GrokBringBack -RunFolder $runT1.Folder -GrokExit 0 6>$null
  Assert-Grok ((Read-Apply $runT1).status -ceq 'applied' -and (Test-Bytes (Join-Path $repoT1 '.grok-settings.tmp') (B "Line's own file`n")) -and -not (Test-Path -LiteralPath (Join-Path $repoT1 '.grok-0a1b2c3d.tmp'))) 'T1 sweep keeps a non-hex .grok-settings.tmp and removes the stale hex temp'

  # Intent: T9 - a TRACKED file named like an engine temp (.grok-0a1b2c3d.tmp, older than 10 min) in a written folder survives apply and undo; an untracked stale temp next to it is still swept. Status: manifest-protected sweep. Next: none. Blockers: none. Confidence: file existence.
  $repoT9 = New-TestRepo 't9 repo' 'false' @{ 'w/a.txt' = (B "a`n"); 'w/.grok-0a1b2c3d.tmp' = (B "Line's tracked file`n") }
  $t9Tracked = Join-Path $repoT9 'w/.grok-0a1b2c3d.tmp'
  $t9Stale = Join-Path $repoT9 'w/.grok-11112222.tmp'
  Write-Fixture $t9Stale 'stale engine temp'
  foreach ($path in @($t9Tracked, $t9Stale)) { [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::UtcNow.AddHours(-2)) }
  $runT9 = Start-TestRun $repoT9 't9'
  $t9Protected = @(([IO.File]::ReadAllText($runT9.Manifest) | ConvertFrom-Json).protected)
  Write-Fixture (Join-Path $runT9.Wt 'w/a.txt') "A`n"
  Invoke-GrokBringBack -RunFolder $runT9.Folder -GrokExit 0 6>$null
  Assert-Grok ((Read-Apply $runT9).status -ceq 'applied' -and ($t9Protected -join '|') -ceq 'w/.grok-0a1b2c3d.tmp' -and (Test-Bytes $t9Tracked (B "Line's tracked file`n")) -and -not (Test-Path -LiteralPath $t9Stale)) 'T9 apply keeps a tracked hex-named temp the manifest lists, sweeps the untracked one'
  [IO.File]::SetLastWriteTimeUtc($t9Tracked, [DateTime]::UtcNow.AddHours(-2))
  $t9Undo = Invoke-TestUndo $runT9.Folder
  Assert-Grok ($t9Undo.Code -eq 0 -and (Test-Bytes $t9Tracked (B "Line's tracked file`n")) -and (Test-Bytes (Join-Path $repoT9 'w/a.txt') (B "a`n"))) 'T9 undo keeps the tracked hex-named temp'
  # Intent: T2 - a junction in Dir survives when the worker deletes every file under it, and undo restores through it. Status: reparse-safe folder removal. Next: none. Blockers: none. Confidence: attributes + bytes.
  $repoT2 = New-TestRepo 't2 repo' 'false' @{ 'a.txt' = (B "a`n") }
  $t2Outside = Join-Path $fixture 't2-outside'
  Write-Fixture (Join-Path $t2Outside 'one.txt') "one`n"
  $t2Junction = Join-Path $repoT2 'ext'
  New-Item -ItemType Junction -Path $t2Junction -Value $t2Outside | Out-Null
  $runT2 = Start-TestRun $repoT2 't2'
  [IO.File]::Delete((Join-Path $runT2.Wt 'ext/one.txt'))
  Invoke-GrokBringBack -RunFolder $runT2.Folder -GrokExit 0 6>$null
  $t2IsJunction = { [IO.Directory]::Exists($t2Junction) -and (([IO.File]::GetAttributes($t2Junction) -band [IO.FileAttributes]::ReparsePoint) -ne 0) }
  Assert-Grok ((Read-Apply $runT2).status -ceq 'applied' -and (Get-Sorted (Read-Apply $runT2).deleted) -ceq 'ext/one.txt' -and (& $t2IsJunction) -and -not (Test-Path -LiteralPath (Join-Path $t2Outside 'one.txt'))) 'T2 Dir junction survives when its last file is deleted'
  $t2Undo = Invoke-TestUndo $runT2.Folder
  Assert-Grok ($t2Undo.Code -eq 0 -and (& $t2IsJunction) -and (Test-Bytes (Join-Path $t2Outside 'one.txt') (B "one`n"))) 'T2 undo restores the file through the junction'
  [IO.Directory]::Delete($t2Junction)

  # Intent: T3 - a worker file with a device name (nul) is skipped as 'unsupported path'; other changes still apply. Status: added-path guard. Next: none. Blockers: none. Confidence: apply.json.
  $repoT3 = New-TestRepo 't3 repo' 'false' @{ 'a.txt' = (B "a`n") }
  $runT3 = Start-TestRun $repoT3 't3'
  Write-Fixture (Join-Path $runT3.Wt 'a.txt') "A`n"
  $nulPath = '\\?\' + (Join-Path $runT3.Wt 'nul')
  & cmd.exe /d /c "echo stray> `"$nulPath`""
  Invoke-GrokBringBack -RunFolder $runT3.Folder -GrokExit 0 6>$null
  $t3 = Read-Apply $runT3
  $t3Skips = @(@($t3.skipped) | Where-Object { $_.reason -ceq 'unsupported path' } | ForEach-Object { $_.path })
  Assert-Grok ($t3.status -ceq 'applied' -and (Get-Sorted $t3.files) -ceq 'a.txt' -and ($t3Skips -join '|') -ceq 'nul' -and (Test-Bytes (Join-Path $repoT3 'a.txt') (B "A`n")) -and (Read-Exit $runT3) -ceq '0' -and (Test-Path -LiteralPath $runT3.Wt)) 'T3 device-name file is skipped as unsupported path; a.txt still applies'
  & cmd.exe /d /c "del /f /q `"$nulPath`""

  # Intent: T4 - two real files whose names differ only in case (case-sensitive folder) stop setup with a clear error. Status: fsutil-dependent. Next: none. Blockers: fsutil may need rights. Confidence: message.
  $repoT4 = New-TestRepo 't4 repo' 'false' @{ 'a.txt' = (B "a`n") }
  $csFolder = Join-Path $repoT4 'cs'
  [void][IO.Directory]::CreateDirectory($csFolder)
  $fsutilOut = & fsutil.exe file setCaseSensitiveInfo $csFolder enable 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "NOTE: T4 skipped - fsutil could not enable case sensitivity: $fsutilOut"
  } else {
    Write-Fixture (Join-Path $csFolder 'File.txt') "UPPER`n"
    Write-Fixture (Join-Path $csFolder 'file.txt') "lower`n"
    [void](Invoke-GrokGit -Dir $repoT4 -Arguments @('config','core.ignorecase','false'))
    [void](Invoke-GrokGit -Dir $repoT4 -Arguments @('add','-A'))
    [void](Invoke-GrokGit -Dir $repoT4 -Arguments @('commit','--quiet','-m','case sensitive'))
    $t4Error = ''
    try { Start-TestRun $repoT4 't4' | Out-Null } catch { $t4Error = $_.Exception.Message }
    Assert-Grok ($t4Error -ceq 'case-sensitive folder not supported: cs/file.txt' -and -not (Test-Path -LiteralPath (Join-Path $fixture 'state space\grok-wt\t4'))) 'T4 case-sensitive folder with File.txt and file.txt stops setup'
    foreach ($name in @('File.txt', 'file.txt')) { [IO.File]::Delete((Join-Path $csFolder $name)) }
  }

  # Intent: T5 - a worktree folder left behind after removal is reported in cleanupReason and never force-deleted. Status: forced no-op removal. Next: none. Blockers: none. Confidence: apply.json.
  $runT5 = Start-TestRun $repoT1 't5'
  Write-Fixture (Join-Path $runT5.Wt 'a.txt') "A5`n"
  $script:originalRemoveWorktree = ${function:Remove-GrokWorktree}
  function Remove-GrokWorktree { param([string]$Dir, [string]$WorktreeDir) }
  try { Invoke-GrokBringBack -RunFolder $runT5.Folder -GrokExit 0 6>$null }
  finally { Set-Item -Path Function:\Remove-GrokWorktree -Value $script:originalRemoveWorktree }
  Assert-Grok ((Read-Apply $runT5).status -ceq 'applied' -and (Read-Apply $runT5).cleanupReason -ceq 'worktree folder still present (junctions?)' -and (Test-Path -LiteralPath $runT5.Wt)) 'T5 leftover worktree folder is reported, not deleted'
  Remove-GrokWorktree -Dir $repoT1 -WorktreeDir $runT5.Wt

  # Intent: T7 - a tracked file held open for writing (live log) does not fail setup; its manifest hash equals the copy. Status: share mode. Next: none. Blockers: none. Confidence: hash.
  $repoT7 = New-TestRepo 't7 repo' 'false' @{ 'live.log.txt' = (B "line one`n"); 'b.txt' = (B "b`n") }
  $holder = New-Object IO.FileStream((Join-Path $repoT7 'live.log.txt'), [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  $t7Error = ''
  try { $runT7 = Start-TestRun $repoT7 't7' } catch { $t7Error = $_.Exception.Message } finally { $holder.Dispose() }
  $t7Ok = $false
  if (-not $t7Error) {
    $t7Entry = @(([IO.File]::ReadAllText($runT7.Manifest) | ConvertFrom-Json).files | Where-Object { $_.path -ceq 'live.log.txt' })
    $t7Ok = $t7Entry.Count -eq 1 -and $t7Entry[0].sha256 -ceq (Get-FileHash -LiteralPath (Join-Path $runT7.Wt 'live.log.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  Assert-Grok ($t7Ok) "T7 setup copies a file held open for writing; manifest hash equals the copy $t7Error"
  # Intent: A9 - a PathTooLongException at setup becomes "path too long: <path>" (codex-do maps setup errors to exit 78) and leaves no worktree. Status: forced branch. Next: none. Blockers: this host has long paths enabled, so the exception is injected. Confidence: message and cleanup.
  Write-Fixture (Join-Path $repo 'deep.txt') 'long path stand-in'
  $script:originalJoin = ${function:Join-GrokChildPath}
  function Join-GrokChildPath {
    param([string]$Root, [string]$Relative)
    # Only the worktree-side join fails, as a long worktree root would; Dir-side joins stay real.
    if ($Relative -ceq 'deep.txt' -and $Root.StartsWith($longWt, [StringComparison]::OrdinalIgnoreCase)) { throw (New-Object IO.PathTooLongException 'forced') }
    return (& $script:originalJoin -Root $Root -Relative $Relative)
  }
  $longWt = Join-Path $fixture 'long-wt'
  $longFolder = Join-Path $fixture 'state space\runs\long-path'
  New-Item -ItemType Directory -Path $longFolder -Force | Out-Null
  $longError = ''
  try { New-GrokWorktree -Dir $repo -WorktreeDir $longWt -RunFolder $longFolder | Out-Null }
  catch { $longError = $_.Exception.Message }
  finally { Set-Item -Path Function:\Join-GrokChildPath -Value $script:originalJoin }
  Assert-Grok ($longError -ceq 'path too long: deep.txt' -and -not (Test-Path -LiteralPath $longWt) -and -not (Test-Path -LiteralPath (Join-Path $longFolder 'manifest.json'))) 'PathTooLongException at setup names the path and cleans up'
  [IO.File]::Delete((Join-Path $repo 'deep.txt'))

  $log = Join-Path $fixture 'out.log'
  Write-Fixture $log "not JSON`n{`"sessionId`":`"first`"}`n{`"sessionId`":`"fake-final-id`",`"usage`":{}}`n{`"answer`":`"last without id`"}`n"
  Assert-Grok ((Get-GrokSessionId -LogPath $log) -ceq 'fake-final-id') 'last JSON sessionId wins despite noise and later objects'

  # Intent: prove the host fake's JSON and file behavior without WMI. Status: offline smoke. Next: host wrapper. Blockers: none. Confidence: executes the supplied cmd fixture.
  $fake = Start-TestRun $repo 'fake-cli'
  Write-Fixture (Join-Path $fake.Folder 'stdin.txt') 'offline packet'
  Write-Fixture (Join-Path $fake.Folder 'fake-release') 'go'
  $fakeLines = @(& (Join-Path $PSScriptRoot 'fixtures/fake-grok.cmd') --prompt-file (Join-Path $fake.Folder 'stdin.txt') --cwd $fake.Wt)
  Assert-Grok ($LASTEXITCODE -eq 0) 'fake CLI exits zero'
  Write-Fixture (Join-Path $fake.Folder 'out.log') ($fakeLines -join "`n")
  $fakeSession = ([IO.File]::ReadAllText((Join-Path $fake.Folder 'fake-started.json')) | ConvertFrom-Json).sessionId
  Assert-Grok ((Get-GrokSessionId -LogPath (Join-Path $fake.Folder 'out.log')) -ceq $fakeSession -and $fakeSession -match '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') 'fake CLI emits parseable streaming JSON with a UUID session id (G5)'
  # Intent: K6a G5 - the fake echoes the resumed id on --resume and mints a new one with --fork-session. Status: offline smoke. Next: none. Blockers: none. Confidence: executes the cmd fixture.
  $resumeId = '2a000000-0000-4000-8000-000000000001'
  $fakeResume = Start-TestRun $repo 'fake-cli-resume'
  Write-Fixture (Join-Path $fakeResume.Folder 'stdin.txt') 'offline packet'
  Write-Fixture (Join-Path $fakeResume.Folder 'fake-release') 'go'
  $resumeLines = @(& (Join-Path $PSScriptRoot 'fixtures/fake-grok.cmd') --prompt-file (Join-Path $fakeResume.Folder 'stdin.txt') --cwd $fakeResume.Wt --resume $resumeId --no-subagents --rules 'a; b, c: d')
  $resumeLog = Join-Path $fakeResume.Folder 'out.log'
  Write-Fixture $resumeLog ($resumeLines -join "`n")
  $forkFolder = Join-Path $fixture 'fake-fork'
  New-Item -ItemType Directory -Path $forkFolder | Out-Null
  Write-Fixture (Join-Path $forkFolder 'stdin.txt') 'offline packet'
  Write-Fixture (Join-Path $forkFolder 'fake-release') 'go'
  $forkLines = @(& (Join-Path $PSScriptRoot 'fixtures/fake-grok.cmd') --prompt-file (Join-Path $forkFolder 'stdin.txt') --cwd $fakeResume.Wt --resume $resumeId --fork-session)
  Write-Fixture (Join-Path $forkFolder 'out.log') ($forkLines -join "`n")
  $forkId = Get-GrokSessionId -LogPath (Join-Path $forkFolder 'out.log')
  Assert-Grok ((Get-GrokSessionId -LogPath $resumeLog) -ceq $resumeId -and $forkId -cne $resumeId -and $forkId -match '\A[0-9a-f]{8}-' -and [IO.File]::ReadAllText((Join-Path $fakeResume.Folder 'fake-argv.txt')).Contains('--rules "a; b, c: d"') -and (Get-GrokFinalText -LogPath $resumeLog) -ceq 'fake answer') 'fake CLI: --resume echoes the id, --fork-session mints a new one, argv recorded raw, final answer text'
  # Intent: test the exact generated completion script without starting the dispatcher. Status: isolated telemetry. Next: host wrapper test. Blockers: none. Confidence: session.txt assertion.
  $tokens = $null; $parseErrors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $bin 'codex-do.ps1'), [ref]$tokens, [ref]$parseErrors)
  $completionFunctions = @('New-DispatchCompletionScript','Get-DispatchRollouts','Get-DispatchSessionMeta','Get-DispatchParentId','Write-DispatchSubagents','Write-DispatchSession')
  foreach ($definition in @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false))) {
    if ($definition.Name -in $completionFunctions) { . ([scriptblock]::Create($definition.Extent.Text)) }
  }
  $Engine = 'grok'
  $completion = Join-Path $fake.Folder 'complete.ps1'
  Write-Fixture $completion (New-DispatchCompletionScript)
  & powershell -NoProfile -ExecutionPolicy Bypass -File $completion -RunFolder $fake.Folder
  Assert-Grok ($LASTEXITCODE -eq 0 -and [IO.File]::ReadAllText((Join-Path $fake.Folder 'session.txt')) -ceq $fakeSession) 'generated completion writes Grok session without Codex rollouts'
  Invoke-GrokBringBack -RunFolder $fake.Folder -GrokExit 0 6>$null
  Assert-Grok ((Read-Apply $fake).status -eq 'applied' -and [IO.File]::ReadAllText((Join-Path $repo 'a.txt')) -ceq 'fake new file') 'fake CLI edits can be brought back'
  [void](Invoke-TestUndo $fake.Folder)
  Assert-Grok (-not (Test-Path -LiteralPath (Join-Path $repo 'a.txt')) -and [IO.File]::ReadAllText($tracked) -ceq "readme`n") 'fake CLI edits undone'

  # Intent: prove CreateNew gives one writer ownership. Status: concurrent regression. Next: none. Blockers: none. Confidence: independent PowerShell processes.
  $race = Start-TestRun $repo 'two-writers'
  Write-Fixture (Join-Path $race.Wt 'race.txt') 'one application'
  $writers = @()
  try {
    foreach ($number in @(1,2)) {
      $start = New-Object Diagnostics.ProcessStartInfo
      $start.FileName = 'powershell'
      $start.UseShellExecute = $false; $start.CreateNoWindow = $true
      $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
      $start.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RunFolder "{1}" -GrokExit 0' -f (Join-Path $bin 'grok-bringback.ps1'), $race.Folder
      $writers += [Diagnostics.Process]::Start($start)
    }
    $announcements = @()
    foreach ($writer in $writers) {
      $stdout = $writer.StandardOutput.ReadToEndAsync(); $stderr = $writer.StandardError.ReadToEndAsync()
      $writer.WaitForExit()
      Assert-Grok ($writer.ExitCode -eq 0 -and -not $stderr.Result) 'bring-back writer exits cleanly'
      if ($stdout.Result.Contains('grok patch: applied')) { $announcements += $stdout.Result }
    }
    Assert-Grok ((Read-Apply $race).status -eq 'applied' -and (Read-Exit $race) -eq '0' -and -not (Test-Path -LiteralPath $race.Wt)) 'exactly one concurrent writer applies and publishes exit'
    Assert-Grok ($announcements.Count -le 1) 'at most one writer announces the result'
  } finally { foreach ($writer in $writers) { if (-not $writer.HasExited) { $writer.Kill(); $writer.WaitForExit() }; $writer.Dispose() } }
  [IO.File]::Delete((Join-Path $repo 'race.txt'))

  # Intent: nested repositories in Dir reject setup; force-added ignored files are tracked, so they are copied (criterion 1). Status: F6 + K5d. Next: none. Blockers: none. Confidence: temp repo only.
  $nested = Join-Path $repo 'nested repo'
  New-Item -ItemType Directory -Path $nested | Out-Null
  [void](Invoke-GrokGit -Dir $nested -Arguments @('init','--quiet'))
  Write-Fixture (Join-Path $nested 'inside.txt') 'inside'
  $nestedWt = Join-Path $fixture 'nested-wt'
  $nestedError = ''
  try { New-GrokWorktree -Dir $repo -WorktreeDir $nestedWt -RunFolder (Join-Path $fixture 'nested-run') | Out-Null }
  catch { $nestedError = $_.Exception.Message }
  Assert-Grok (($nestedError -match 'untracked nested git repository') -and -not (Test-Path -LiteralPath $nestedWt)) 'untracked nested git repository rejects setup'
  Remove-Item -LiteralPath $nested -Recurse -Force
  Write-Fixture (Join-Path $repo '.gitignore') "secret.env`n"
  Write-Fixture (Join-Path $repo 'secret.env') 'force added secret'
  [void](Invoke-GrokGit -Dir $repo -Arguments @('add','-f','--','secret.env'))
  $forced = Start-TestRun $repo 'forced'
  Assert-Grok ((Test-Bytes (Join-Path $forced.Wt 'secret.env') (B 'force added secret'))) 'force-added ignored file is tracked, so it is copied'

  # Intent: cancel must not interrupt a live wrapper's claimed bring-back, but a dead wrapper's run is sealed with 77. Status: F5 + fix2 G3 regression. Next: none. Blockers: none. Confidence: real live and exited wrapper stand-ins.
  $standIn = $null
  try {
    $env:CODEX_DO_STATE_DIR = Join-Path $fixture 'cancel-state'
    $cancelRun = '20261118-120000-ab12'
    $cancelFolder = Join-Path $env:CODEX_DO_STATE_DIR "runs\$cancelRun"
    New-Item -ItemType Directory -Path $cancelFolder -Force | Out-Null
    $cancelWt = Join-Path $fixture 'cancel-worktree'
    New-Item -ItemType Directory -Path $cancelWt | Out-Null
    $standIn = Start-Process -FilePath powershell -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
    $standInCreated = $standIn.StartTime.ToUniversalTime().ToString('o')
    Write-Fixture (Join-Path $cancelFolder 'run.json') (@{
      runId = $cancelRun; dir = $repo; engine = 'grok'; wrapperPid = $standIn.Id; wrapperCreationDate = $standInCreated
      startedUtc = [datetime]::UtcNow.ToString('o'); worktreeDir = $cancelWt
      account = ''; resume = ''; accountHome = ''; model = 'grok-4.7-build-fast'; effort = 'high'
    } | ConvertTo-Json)
    $applyMarker = '{"status":"applied","files":["a.txt"]}'
    Write-Fixture (Join-Path $cancelFolder 'apply.json') $applyMarker
    $cancelOut = Invoke-TestDispatcher @('-Cancel', $cancelRun)
    Assert-Grok ($cancelOut.Code -eq 3 -and $cancelOut.Text -ceq 'grok bring-back in progress; retry in a few seconds') 'cancel refuses while the bring-back wrapper is alive'
    Assert-Grok ((Test-Path -LiteralPath $cancelWt) -and -not (Test-Path -LiteralPath (Join-Path $cancelFolder 'exit.txt')) -and -not $standIn.HasExited) 'refused cancel leaves the wrapper, the worktree and no exit'
    $standIn.Kill(); $standIn.WaitForExit()
    # The dispatcher's Dir lock for this run must be released by the dead-wrapper cancel.
    $lockFile = Get-LockFile $env:CODEX_DO_STATE_DIR $repo
    Write-Fixture $lockFile (@{ runId = $cancelRun; pid = $standIn.Id; pidStarted = $standInCreated } | ConvertTo-Json)
    $deadOut = Invoke-TestDispatcher @('-Cancel', $cancelRun)
    Assert-Grok ($deadOut.Code -eq 0 -and [IO.File]::ReadAllText((Join-Path $cancelFolder 'exit.txt')).Trim() -ceq '77') 'dead-wrapper cancel publishes exit 77'
    Assert-Grok ([IO.File]::ReadAllText((Join-Path $cancelFolder 'apply.json')) -ceq $applyMarker -and (Test-Path -LiteralPath $cancelWt) -and $deadOut.Text.Contains("grok worktree: kept $cancelWt")) 'dead-wrapper cancel keeps apply.json and the worktree'
    Assert-Grok (-not (Test-Path -LiteralPath $lockFile) -and @(Get-ChildItem -LiteralPath $cancelFolder -Filter '*.tmp').Count -eq 0) 'dead-wrapper cancel releases the Dir lock and leaves no temp file'
  } finally {
    if ($null -ne $standIn) { if (-not $standIn.HasExited) { $standIn.Kill(); $standIn.WaitForExit() }; $standIn.Dispose() }
    $env:CODEX_DO_STATE_DIR = $defaultState
  }

  # Intent: codex-do -Undo: lock refusal, last with and without -Dir, exit codes (A1, A6, A7, A10). Status: dispatcher path. Next: host check. Blockers: none. Confidence: real dispatcher processes.
  $standIn = $null
  try {
    $undoState = Join-Path $fixture 'undo-state'
    $env:CODEX_DO_STATE_DIR = $undoState
    $repoA = New-TestRepo 'undo repo A' 'true' @{ 'a.txt' = (B "a`r`n") }
    $repoB = New-TestRepo 'undo repo B' 'false' @{ 'b.txt' = (B "b`n") }
    $runA = Start-TestRun $repoA '20261118-100000-aaa1' $undoState
    Write-Fixture (Join-Path $runA.Wt 'a.txt') "A`r`n"
    Invoke-GrokBringBack -RunFolder $runA.Folder -GrokExit 0 6>$null
    $runB = Start-TestRun $repoB '20261118-100001-bbb2' $undoState
    Write-Fixture (Join-Path $runB.Wt 'b.txt') "B`n"
    Invoke-GrokBringBack -RunFolder $runB.Folder -GrokExit 0 6>$null
    Assert-Grok ((Get-GrokUndoCandidate -RunsDir (Join-Path $undoState 'runs')) -ceq '20261118-100001-bbb2' -and (Get-GrokUndoCandidate -RunsDir (Join-Path $undoState 'runs') -Dir $repoA) -ceq '20261118-100000-aaa1') 'last = newest applied run, -Dir filters'
    $standIn = Start-Process -FilePath powershell -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
    $lockB = Get-LockFile $undoState $repoB
    Write-Fixture $lockB (@{ pid = $standIn.Id; pidStarted = $standIn.StartTime.ToUniversalTime().ToString('o'); dir = $repoB.ToLowerInvariant(); startedUtc = [datetime]::UtcNow.ToString('o'); runId = '20261118-090000-ccc3' } | ConvertTo-Json)
    $busy = Invoke-TestDispatcher @('-Undo', 'last')
    Assert-Grok ($busy.Code -eq 3 -and $busy.Text.Contains('REFUSED: another worker is active in this Dir') -and (Test-Bytes (Join-Path $repoB 'b.txt') (B "B`n")) -and (Read-Undo $runB).state -ceq 'applied') '-Undo refuses while a run holds the Dir lock'
    $undoA = Invoke-TestDispatcher @('-Undo', 'last', '-Dir', $repoA)
    Assert-Grok ($undoA.Code -eq 0 -and $undoA.Text.Contains("undo 20261118-100000-aaa1 in $repoA") -and (Test-Bytes (Join-Path $repoA 'a.txt') (B "a`r`n")) -and -not (Test-Path -LiteralPath (Get-LockFile $undoState $repoA))) '-Undo last -Dir picks that Dir, restores and releases its lock'
    $standIn.Kill(); $standIn.WaitForExit()
    $undoB = Invoke-TestDispatcher @('-Undo', 'last')
    Assert-Grok ($undoB.Code -eq 0 -and $undoB.Text.Contains('undo 20261118-100001-bbb2 in') -and (Test-Bytes (Join-Path $repoB 'b.txt') (B "b`n")) -and -not (Test-Path -LiteralPath $lockB)) '-Undo last takes a stale lock and restores the newest run'
    $none = Invoke-TestDispatcher @('-Undo', 'last')
    Assert-Grok ($none.Code -eq 2) '-Undo last with nothing applied exits 2'
    $done = Invoke-TestDispatcher @('-Undo', '20261118-100000-aaa1')
    Assert-Grok ($done.Code -eq 0 -and $done.Text.Contains('already undone')) '-Undo of an undone run is already undone'
    $codexRun = Join-Path $undoState 'runs\20261118-100002-dd44'
    New-Item -ItemType Directory -Path $codexRun -Force | Out-Null
    Write-Fixture (Join-Path $codexRun 'run.json') (@{ runId = '20261118-100002-dd44'; dir = $repoA; wrapperPid = 1 } | ConvertTo-Json)
    $codexUndo = Invoke-TestDispatcher @('-Undo', '20261118-100002-dd44')
    Assert-Grok ($codexUndo.Code -eq 2 -and $codexUndo.Text.Contains('no undo bundle')) '-Undo of a Codex run exits 2'
    Assert-Grok ((Invoke-TestDispatcher @('-Undo', 'bogus')).Code -eq 64 -and (Invoke-TestDispatcher @('-Undo', '20261118-000000-dead')).Code -eq 64) '-Undo malformed or unknown run exits 64'
    Assert-Grok ((Invoke-TestDispatcher @('-Undo', 'last', '-Status')).Code -eq 64 -and (Invoke-TestDispatcher @('-Undo', 'last', '-Cancel', 'last')).Code -eq 64 -and (Invoke-TestDispatcher @('-Undo', 'last', '-Engine', 'grok', '-SpecFile', 'x.md')).Code -eq 64) '-Undo is exclusive with -Status, -Cancel and dispatch'
    # Intent: F7e - two concurrent -Undo calls on one Dir: exactly one runs, the other gets lock-busy exit 3. Status: lock race. Next: none. Blockers: needs the winner to hold the lock while the loser starts (200 MB file). Confidence: real processes.
    $repoC = New-TestRepo 'undo repo C' 'false' @{ 'c.txt' = (B "c`n") }
    $bigFile = Join-Path $repoC 'big.bin'
    $bigStream = [IO.File]::Open($bigFile, [IO.FileMode]::CreateNew)
    try { $bigStream.SetLength(200MB) } finally { $bigStream.Dispose() }
    $runC = Start-TestRun $repoC '20261118-100003-eee5' $undoState
    $bigWt = [IO.File]::Open((Join-Path $runC.Wt 'big.bin'), [IO.FileMode]::Open)
    try { $bigWt.WriteByte(1) } finally { $bigWt.Dispose() }
    Invoke-GrokBringBack -RunFolder $runC.Folder -GrokExit 0 6>$null
    $racers = @()
    try {
      foreach ($number in @(1, 2)) {
        $racers += Start-Process -FilePath powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Undo 20261118-100003-eee5' -f (Join-Path $bin 'codex-do.ps1')) -WindowStyle Hidden -PassThru
      }
      foreach ($racer in $racers) { $null = $racer.Handle }
      foreach ($racer in $racers) { [void]$racer.WaitForExit(120000) }
      $codes = Get-Sorted @($racers | ForEach-Object { [string]$_.ExitCode })
    } finally { foreach ($racer in $racers) { if (-not $racer.HasExited) { $racer.Kill() }; $racer.Dispose() } }
    $firstByte = [IO.File]::OpenRead($bigFile); try { $restoredByte = $firstByte.ReadByte() } finally { $firstByte.Dispose() }
    Assert-Grok ($codes -ceq '0|3' -and $restoredByte -eq 0 -and (Read-Undo $runC).state -ceq 'undone') "F7e two concurrent -Undo: one restores, the other is refused with exit 3 (codes $codes)"
  } finally {
    if ($null -ne $standIn) { if (-not $standIn.HasExited) { $standIn.Kill(); $standIn.WaitForExit() }; $standIn.Dispose() }
    $env:CODEX_DO_STATE_DIR = $defaultState
  }

  $dispatcher = [IO.File]::ReadAllText((Join-Path $bin 'codex-do.ps1'))
  Assert-Grok ($dispatcher.Contains('grok-bringback.ps1') -and -not $dispatcher.Contains('-BringBack') -and -not $dispatcher.Contains('baselineTree')) 'dispatcher calls grok-bringback.ps1 and records no baselineTree'
  # Intent: A13 - the worker cannot rewrite worktree files from HEAD through git's conversion. Status: deny args. Next: none. Blockers: none. Confidence: dispatcher text.
  $denyLine = @($dispatcher -split "`n" | Where-Object { $_ -match 'foreach \(\$rule in @\(' })
  Assert-Grok ($denyLine.Count -eq 1 -and $denyLine[0].Contains("'Bash(git restore*)'") -and $denyLine[0].Contains("'Bash(git reset*)'") -and -not $denyLine[0].Contains('git reset --hard') -and $denyLine[0].Contains("'Bash(git checkout*)'")) 'deny list blocks git restore and every git reset'
  $denyMissing = @(@('git checkout-index*','git apply*','git merge*','git rebase*','git revert*','git cherry-pick*','git pull*','git am*','git read-tree*','git config*','git -C*') | Where-Object { -not $denyLine[0].Contains("'Bash($_)'") })
  Assert-Grok ($denyMissing.Count -eq 0) ('F6 deny list also blocks checkout-index, apply, merge, rebase, revert, cherry-pick, pull, am, read-tree, config, -C' + $(if ($denyMissing.Count) { ' missing: ' + ($denyMissing -join ', ') } else { '' }))

  # Intent: run.cmd seals exit.txt even when bring-back never runs. Status: fix2 G4 regression. Next: none. Blockers: none. Confidence: dispatcher's own format strings executed by cmd.
  $fallbackFormat = [regex]::Match($dispatcher, "\`$wrapper \+= '(if not exist [^']*)' -f \`$exitPath").Groups[1].Value
  $bringBackFormat = [regex]::Match($dispatcher, "\`$wrapper \+= '(""%SystemRoot%[^']*-GrokExit %GROK_EXIT%[^']*)'").Groups[1].Value
  Assert-Grok ($fallbackFormat -ceq 'if not exist "{0}" (> "{0}.tmp" echo 77 & move /y "{0}.tmp" "{0}" >nul)' -and $bringBackFormat) 'run.cmd text contains the exit 77 fallback after bring-back'
  $sealFolder = Join-Path $fixture 'state space\runs\missing-bringback'
  New-Item -ItemType Directory -Path $sealFolder -Force | Out-Null
  $sealExit = Join-Path $sealFolder 'exit.txt'
  $sealCmd = Join-Path $sealFolder 'run.cmd'
  $sealLines = @('@echo off', 'set "GROK_EXIT=0"', ($bringBackFormat -f (Join-Path $sealFolder 'missing-bringback.ps1'), $sealFolder, (Join-Path $sealFolder 'bring-back.log')), ($fallbackFormat -f $sealExit))
  Write-Fixture $sealCmd (($sealLines -join "`r`n") + "`r`n")
  & cmd.exe /d /c "`"$sealCmd`""
  Assert-Grok ((Test-Path -LiteralPath $sealExit) -and [IO.File]::ReadAllText($sealExit).Trim() -ceq '77' -and -not (Test-Path -LiteralPath ($sealExit + '.tmp'))) 'missing bring-back script still publishes exit 77'
  Write-Fixture $sealExit "0`n"
  & cmd.exe /d /c "`"$sealCmd`""
  Assert-Grok ([IO.File]::ReadAllText($sealExit).Trim() -ceq '0') 'fallback leaves an existing exit.txt untouched'

  # Intent: K6a criterion 4 - an explicit -Engine grok rejects only a non-grok -Model and -Effort ultra before lint; -Attached/-Account/-Sandbox reach lint (74), -Resume with no grok session exits 2 at the engine decision. Status: K6a. Next: none. Blockers: none. Confidence: temp state (G10).
  $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin 'codex-do.ps1') -Engine grok -Model gpt-6-sol 2>&1)
  Assert-Grok ($LASTEXITCODE -eq 2 -and $output.Count -eq 1) 'early one-line rejection: -Engine grok -Model gpt-6-sol'
  foreach ($flags in @(@('-Attached'), @('-Account','main'), @('-Sandbox','workspace-write'), @('-Sandbox','read-only'))) {
    $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin 'codex-do.ps1') -Engine grok @flags 2>&1) -join "`n"
    Assert-Grok ($LASTEXITCODE -eq 74 -and $output -notmatch 'does not support') ("K6a: -Engine grok accepts " + ($flags -join ' ') + ' (reaches packet lint)')
  }
  $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin 'codex-do.ps1') -Engine grok -Resume last 'fix it' 2>&1) -join "`n"
  Assert-Grok ($LASTEXITCODE -eq 2 -and $output -match 'can only resume a grok session') 'K6a: -Engine grok -Resume with no grok-owned session exits 2'

  # Intent: K6a criterion 1 - xhigh for every tier, build-fast, speed flags, --no-subagents, --max-turns 300 and the THOROUGH --rules text as one argument; explicit flags win; -Fast is a no-op. Status: regression suite. Next: host timing check. Blockers: none. Confidence: pure function plus dispatcher early path.
  foreach ($tier in @('Standard-A','Standard-B','Important','Skip','')) {
    $plan = Get-GrokLaunchPlan -Tier $tier -Model 'gpt-6-sol' -Effort ''
    Assert-Grok ($plan.model -ceq 'grok-4.7-build-fast' -and $plan.effort -ceq 'xhigh') "default plan is grok-4.7-build-fast xhigh for tier '$tier'"
  }
  $plan = Get-GrokLaunchPlan -Tier 'Standard-A' -Effort 'high' -EffortGiven
  Assert-Grok ($plan.effort -ceq 'high' -and $plan.model -ceq 'grok-4.7-build-fast' -and @($plan.args)[[array]::IndexOf(@($plan.args), '--effort') + 1] -ceq 'high') 'explicit -Effort high overrides the xhigh default'
  $plan = Get-GrokLaunchPlan -Tier 'Important' -Model 'grok-4.7' -ModelGiven
  Assert-Grok ($plan.model -ceq 'grok-4.7' -and $plan.effort -ceq 'xhigh') 'explicit -Model grok-4.7 wins'
  $fastPlan = Get-GrokLaunchPlan -Tier 'Standard-A' -Fast
  $plainPlan = Get-GrokLaunchPlan -Tier 'Standard-A'
  Assert-Grok ($fastPlan.model -ceq $plainPlan.model -and $fastPlan.effort -ceq $plainPlan.effort -and ($fastPlan.args -join ' ') -ceq ($plainPlan.args -join ' ')) '-Fast is a no-op in the plan'
  $planArgs = @($plainPlan.args)
  $effortAt = [array]::IndexOf($planArgs, '--effort'); $modelAt = [array]::IndexOf($planArgs, '-m')
  Assert-Grok ($planArgs -contains '--no-plan' -and $planArgs -contains '--disable-web-search' -and $planArgs -contains '--no-subagents' -and $planArgs[$effortAt + 1] -ceq 'xhigh' -and $planArgs[$modelAt + 1] -ceq 'grok-4.7-build-fast') 'args contain --no-plan, --disable-web-search, --no-subagents and the chosen model and effort'
  $turnsAt = [array]::IndexOf($planArgs, '--max-turns'); $deniedAt = [array]::IndexOf($planArgs, '--disallowed-tools'); $sandboxAt = [array]::IndexOf($planArgs, '--sandbox')
  Assert-Grok ($planArgs[$turnsAt + 1] -ceq '300' -and $planArgs[$deniedAt + 1] -ceq 'Agent,use_tool,search_tool' -and $planArgs[$sandboxAt + 1] -ceq 'workspace' -and $planArgs -contains '--no-auto-update' -and $planArgs -notcontains '--resume' -and $planArgs -notcontains '--tools') 'existing Grok args kept: --max-turns 300, --disallowed-tools Agent (+ MCP meta-tools), --sandbox workspace'
  $thorough = 'You are a worker executing a task packet. Finish every SUCCESS CRITERION completely; never stop at a partial or placeholder solution. Read the files before editing. Run every VALIDATE command and fix failures until they pass or a STOP RULE applies; skip commands marked host-only and list them. Write the tests the packet asks for. Do not edit files outside FILES. If a STOP RULE applies, stop and report the exact blocker instead of guessing. End with a report that lists each criterion with file:line proof and the VALIDATE output tails.'
  $rulesAt = [array]::IndexOf($planArgs, '--rules')
  Assert-Grok ($rulesAt -ge 0 -and $planArgs[$rulesAt + 1] -ceq $thorough -and (Get-GrokRuleText) -ceq $thorough -and $plainPlan.rules -ceq $thorough -and @($planArgs | Where-Object { $_ -ceq '--rules' }).Count -eq 1) 'K6a: --rules carries the THOROUGH rule text (G11 wording) as one argument'
  Assert-Grok ($thorough.Contains(';') -and $thorough.Contains(',') -and $thorough.Contains(':')) 'K6a: the rule text has semicolons, commas and colons to keep intact'
  $rejectedChars = @(@('"', '%', '^', '&', '|', '<', '>', '!', "`r", "`n") | Where-Object { $char = $_; try { Assert-GrokRuleText ('rule ' + $char + ' text'); $false } catch { $true } })
  $acceptedRule = $true; try { Assert-GrokRuleText $thorough; Assert-GrokRuleText (Get-GrokRuleText -ReadOnly) } catch { $acceptedRule = $false }
  Assert-Grok ($rejectedChars.Count -eq 10 -and $acceptedRule) 'K6a G6: the lib throws on " % ^ & | < > ! CR LF in rule text and accepts both rule texts'
  $echo = Format-GrokArgsEcho -Arguments @($planArgs)
  Assert-Grok ($echo.Contains('--rules You are a worker executing a task packet... ') -and -not $echo.Contains('Finish every') -and $echo.Contains('--no-subagents')) "K6a G12: the dispatch echo truncates --rules to 40 characters ($echo)"
  # Intent: K6a criterion 3 / G8 + supervisor note - read-only = --sandbox read-only (advisory on Windows) plus a read/search tool allowlist and the short rule. Status: K6a. Next: none. Blockers: none. Confidence: probe 5 tool list.
  $roPlan = Get-GrokLaunchPlan -Tier 'Standard-A' -ReadOnly
  $roArgs = @($roPlan.args)
  Assert-Grok ($roArgs[[array]::IndexOf($roArgs, '--sandbox') + 1] -ceq 'read-only' -and $roArgs[[array]::IndexOf($roArgs, '--tools') + 1] -ceq 'read_file,grep,list_dir' -and $roArgs[[array]::IndexOf($roArgs, '--disallowed-tools') + 1] -ceq 'run_terminal_cmd,search_replace,write,Agent,use_tool,search_tool' -and $roArgs[[array]::IndexOf($roArgs, '--rules') + 1] -ceq 'Do not edit any file. Investigate and report findings with file:line evidence; end with a structured report.' -and $roPlan.sandbox -ceq 'read-only' -and $roPlan.effort -ceq 'xhigh') 'K6a: read-only plan = --sandbox read-only, read/search tools only, short rule'
  $resumePlan = Get-GrokLaunchPlan -ResumeSession '01a1ecc6-d081-7061-b778-722d723f69d5'
  $resumeArgs = @($resumePlan.args)
  Assert-Grok ($resumeArgs[0] -ceq '--resume' -and $resumeArgs[1] -ceq '01a1ecc6-d081-7061-b778-722d723f69d5' -and $resumeArgs -notcontains '--fork-session' -and $resumeArgs -notcontains '--restore-code' -and $resumeArgs -contains '--rules' -and $resumePlan.effort -ceq 'xhigh') 'K6a: resume plan = --resume <id> first, no --fork-session, never --restore-code, K6a defaults'
  # Intent: K6a supervisor decision 2 - every grok plan (worker, read-only, resume) blocks all MCP tools: --deny MCPTool(*), no use_tool/search_tool, Claude/Cursor MCP scan off. Status: K6a. Next: none. Blockers: none. Confidence: probe 7.
  foreach ($mcpCase in @(@{ Name = 'worker'; Plan = $plainPlan }, @{ Name = 'read-only'; Plan = $roPlan }, @{ Name = 'resume'; Plan = $resumePlan })) {
    $mcpArgs = @($mcpCase.Plan.args)
    $denyAt = [array]::IndexOf($mcpArgs, '--deny')
    $disallowed = $mcpArgs[[array]::IndexOf($mcpArgs, '--disallowed-tools') + 1].Split(',')
    Assert-Grok ($denyAt -ge 0 -and $mcpArgs[$denyAt + 1] -ceq 'MCPTool(*)' -and $disallowed -ccontains 'use_tool' -and $disallowed -ccontains 'search_tool' -and $mcpCase.Plan.env['GROK_CLAUDE_MCPS_ENABLED'] -ceq 'false' -and $mcpCase.Plan.env['GROK_CURSOR_MCPS_ENABLED'] -ceq 'false') "K6a: $($mcpCase.Name) plan blocks every MCP tool (--deny MCPTool(*), no use_tool/search_tool, MCP scan env off)"
  }
  $wrapperEnvLine = @($dispatcher -split "`n" | Where-Object { $_ -match 'foreach \(\$name in @\(\$grokPlan\.env\.Keys\)\)' })
  Assert-Grok ($wrapperEnvLine.Count -eq 1) 'K6a: run.cmd sets the plan env before calling grok'
  foreach ($flags in @(@('-Fast'), @('-Fast','-Model','grok-4.7'))) {
    $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin 'codex-do.ps1') -Engine grok @flags 2>&1) -join "`n"
    Assert-Grok ($LASTEXITCODE -ne 2 -and $output -notmatch 'does not support -Fast') ("-Fast accepted by dispatcher: " + ($flags -join ' '))
  }

  # Intent: K5e engine swap - precedence, auto rule, Critical rule and option fallback at function level (E9), with a fixed clock. Status: regression suite. Next: host -SetEngine show. Blockers: none. Confidence: pure function.
  $engineNow = [DateTimeOffset]::Parse('2026-11-18T12:00:00Z', [Globalization.CultureInfo]::InvariantCulture)
  $futureReset = $engineNow.AddDays(2).ToUnixTimeSeconds()
  $pastReset = $engineNow.AddDays(-1).ToUnixTimeSeconds()
  $hot = '{"weekly":{"left":4,"usedPercent":96,"resetsAt":' + $futureReset + '},"dataTs":"2026-11-18T10:00:00Z"}' | ConvertFrom-Json
  $cool = '{"weekly":{"left":60,"usedPercent":40,"resetsAt":' + $futureReset + '}}' | ConvertFrom-Json
  function Invoke-Engine([hashtable]$Arguments) {
    $all = @{ Now = $engineNow; Threshold = 95; Cache = $null }
    foreach ($key in $Arguments.Keys) { $all[$key] = $Arguments[$key] }
    return Resolve-DispatchEngine @all
  }
  function Test-Decision($Decision, [string]$Engine, [string]$Source) { return ($Decision.engine -ceq $Engine -and $Decision.source -ceq $Source -and $Decision.exitCode -eq 0) }
  # Precedence matrix: flag > env > file > auto.
  Assert-Grok (Test-Decision (Invoke-Engine @{ Explicit = 'grok'; EnvValue = 'codex'; FileValue = 'codex'; Cache = $cool }) 'grok' 'flag') 'precedence: flag grok beats env codex and file codex'
  Assert-Grok (Test-Decision (Invoke-Engine @{ Explicit = 'codex'; EnvValue = 'grok'; FileValue = 'grok'; Cache = $hot }) 'codex' 'flag') 'precedence: flag codex beats env grok, file grok and auto grok'
  Assert-Grok (Test-Decision (Invoke-Engine @{ EnvValue = 'grok'; FileValue = 'codex'; Cache = $cool }) 'grok' 'env') 'precedence: env grok beats file codex'
  Assert-Grok (Test-Decision (Invoke-Engine @{ EnvValue = 'codex'; FileValue = 'grok'; Cache = $hot }) 'codex' 'env') 'precedence: env codex beats file grok and auto grok'
  Assert-Grok (Test-Decision (Invoke-Engine @{ FileValue = 'grok'; Cache = $cool }) 'grok' 'file') 'precedence: file grok beats auto codex'
  Assert-Grok (Test-Decision (Invoke-Engine @{ FileValue = 'codex'; Cache = $hot }) 'codex' 'file') 'precedence: file codex beats auto grok'
  Assert-Grok (Test-Decision (Invoke-Engine @{ Cache = $hot }) 'grok' 'auto') 'precedence: nothing set -> auto rule'
  Assert-Grok (Test-Decision (Invoke-Engine @{ Explicit = 'auto'; EnvValue = 'codex'; FileValue = 'codex'; Cache = $hot }) 'grok' 'auto') 'precedence: -Engine auto skips env and file (E12b)'
  Assert-Grok (Test-Decision (Invoke-Engine @{ EnvValue = 'AUTO'; FileValue = 'codex'; Cache = $hot }) 'grok' 'auto') 'precedence: env auto means the auto rule, file not read'
  Assert-Grok (Test-Decision (Invoke-Engine @{ FileValue = "auto`n"; Cache = $cool }) 'codex' 'auto') 'precedence: file auto means the auto rule'
  $badEnv = Invoke-Engine @{ EnvValue = 'gemini'; FileValue = 'grok'; Cache = $cool }
  Assert-Grok ((Test-Decision $badEnv 'grok' 'file') -and @($badEnv.messages).Count -eq 1 -and $badEnv.messages[0] -match "CODEX_DO_ENGINE='gemini'.*ignored") 'invalid env warns once and falls through to the file'
  $badFile = Invoke-Engine @{ FileValue = 'turbo'; Cache = $hot }
  Assert-Grok ((Test-Decision $badFile 'grok' 'auto') -and @($badFile.messages).Count -eq 1 -and $badFile.messages[0] -match "engine\.txt says 'turbo'.*ignored") 'invalid engine.txt warns once and falls through to auto'
  # Auto rule (criterion 2, E5).
  $isoFuture = '{"weekly":{"usedPercent":96,"resetsAt":"2026-11-20T00:00:00Z"}}' | ConvertFrom-Json
  Assert-Grok ((Test-Decision (Invoke-Engine @{ Cache = $isoFuture }) 'grok' 'auto') -and (Invoke-Engine @{ Cache = $hot }).reason -ceq 'Codex weekly 96% used') 'auto: used 96 + resetsAt in the future (epoch seconds or ISO) -> grok'
  $leftOnly = '{"weekly":{"left":3},"dataTs":"2026-11-18T10:00:00Z"}' | ConvertFrom-Json
  $leftDecision = Invoke-Engine @{ Cache = $leftOnly }
  Assert-Grok ((Test-Decision $leftDecision 'grok' 'auto') -and $leftDecision.reason -ceq 'Codex weekly 97% used') 'auto: left 3, no usedPercent, fresh dataTs -> grok'
  Assert-Grok (Test-Decision (Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":96,"resetsAt":' + $pastReset + '}}' | ConvertFrom-Json) }) 'codex' 'auto') 'auto: used 96 + resetsAt in the past -> codex'
  Assert-Grok (Test-Decision (Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":96},"dataTs":"2026-11-17T06:00:00Z"}' | ConvertFrom-Json) }) 'codex' 'auto') 'auto: resetsAt missing + dataTs 30 h old -> codex'
  Assert-Grok (Test-Decision (Invoke-Engine @{ Cache = $cool }) 'codex' 'auto') 'auto: used 40 -> codex'
  $missing = Invoke-Engine @{ Cache = $null }
  Assert-Grok ((Test-Decision $missing 'codex' 'auto') -and $missing.reason -ceq 'no Codex usage data') 'auto: missing cache -> codex'
  $unparseable = @('{"weekly":null}', ('{"weekly":{"usedPercent":"96","resetsAt":' + $futureReset + '}}'), '{"weekly":{"usedPercent":96,"resetsAt":"not a date"}}', '{"weekly":{"usedPercent":96}}', '{"weekly":{"usedPercent":96},"dataTs":"garbage"}', '"text"')
  Assert-Grok (@($unparseable | Where-Object { (Invoke-Engine @{ Cache = ($_ | ConvertFrom-Json) }).engine -ne 'codex' }).Count -eq 0) 'auto: null weekly, string percent, bad resetsAt, missing or bad dataTs -> codex'
  Assert-Grok ((Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":95,"resetsAt":' + $futureReset + '}}' | ConvertFrom-Json) }).engine -ceq 'grok' -and (Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":94,"resetsAt":' + $futureReset + '}}' | ConvertFrom-Json) }).engine -ceq 'codex' -and (Invoke-Engine @{ Threshold = 90; Cache = ('{"weekly":{"usedPercent":92,"resetsAt":' + $futureReset + '}}' | ConvertFrom-Json) }).engine -ceq 'grok') 'auto: used >= threshold (95 boundary, threshold 90)'
  # Critical rule.
  $criticalAuto = Invoke-Engine @{ Tier = 'Critical'; Cache = $hot }
  Assert-Grok ((Test-Decision $criticalAuto 'codex' 'auto') -and (@($criticalAuto.messages) -join '|') -ceq 'codex-do: Critical packet stays on Codex; use an Opus subagent if Codex is out') 'Critical + auto grok -> codex with the message'
  Assert-Grok (@((Invoke-Engine @{ Tier = 'critical'; Cache = $cool }).messages).Count -eq 0 -and (Invoke-Engine @{ Tier = 'Important'; Cache = $hot }).engine -ceq 'grok' -and (Invoke-Engine @{ Tier = ''; Cache = $hot }).engine -ceq 'grok') 'Critical message only when auto picks grok; other and unknown tiers switch'
  $criticalManual = Invoke-Engine @{ Tier = 'Critical'; EnvValue = 'grok'; Cache = $cool }
  Assert-Grok ((Test-Decision $criticalManual 'grok' 'env') -and @($criticalManual.messages).Count -eq 1 -and $criticalManual.messages[0] -match '^codex-do: warning: Critical packet runs on Grok by manual choice') 'Critical + manual grok -> grok with one warning'
  # Intent: K6a G1/G4 - -Account/-Attached/-Sandbox no longer reject or fall back; -Resume follows the session owner (-ResumeOwner). Status: replaces the K5e E3/E9 option fallback. Next: none. Blockers: none. Confidence: pure function matrix.
  Assert-Grok ((Test-Decision (Invoke-Engine @{ Cache = $hot }) 'grok' 'auto') -and (Test-Decision (Invoke-Engine @{ EnvValue = 'grok' }) 'grok' 'env') -and (Test-Decision (Invoke-Engine @{ FileValue = 'grok' }) 'grok' 'file')) 'K6a: auto/env/file grok without -Resume stays grok (no option fallback)'
  $grokOwnedCool = Invoke-Engine @{ Cache = $cool; ResumeOwner = 'grok' }
  Assert-Grok ((Test-Decision $grokOwnedCool 'grok' 'auto') -and -not $grokOwnedCool.fellBack -and $grokOwnedCool.recordSource -ceq 'auto') 'K6a G1: grok-owned -Resume -> grok under auto even when Codex has quota'
  Assert-Grok ((Test-Decision (Invoke-Engine @{ EnvValue = 'codex'; Cache = $cool; ResumeOwner = 'grok' }) 'grok' 'env') -and (Test-Decision (Invoke-Engine @{ FileValue = 'codex'; ResumeOwner = 'grok' }) 'grok' 'file') -and (Test-Decision (Invoke-Engine @{ Explicit = 'grok'; ResumeOwner = 'grok' }) 'grok' 'flag')) 'K6a G1: grok-owned -Resume -> grok for env/file codex and -Engine grok'
  $grokOwnedFlagCodex = Invoke-Engine @{ Explicit = 'codex'; ResumeOwner = 'grok' }
  Assert-Grok ($grokOwnedFlagCodex.exitCode -eq 2 -and @($grokOwnedFlagCodex.messages).Count -eq 1 -and $grokOwnedFlagCodex.messages[0] -match 'belongs to grok') 'K6a G1: grok-owned -Resume + -Engine codex -> exit 2'
  $codexOwnedFlagGrok = Invoke-Engine @{ Explicit = 'grok'; ResumeOwner = 'codex' }
  $unknownFlagGrok = Invoke-Engine @{ Explicit = 'grok'; ResumeOwner = 'unknown' }
  Assert-Grok ($codexOwnedFlagGrok.exitCode -eq 2 -and $codexOwnedFlagGrok.messages[0] -match 'belongs to codex' -and $unknownFlagGrok.exitCode -eq 2 -and $unknownFlagGrok.messages[0] -match 'can only resume a grok session') 'K6a G1: codex-owned or unknown -Resume + -Engine grok -> exit 2'
  $autoResume = Invoke-Engine @{ Cache = $hot; ResumeOwner = 'codex' }
  Assert-Grok ((Test-Decision $autoResume 'codex' 'auto') -and $autoResume.fellBack -and $autoResume.recordSource -ceq 'auto-fallback' -and (@($autoResume.messages) -join '|') -ceq 'codex-do: -Resume continues on codex (engine auto ignored)') 'K6a G1: codex-owned -Resume under auto grok -> codex (auto-fallback), current path'
  $envResume = Invoke-Engine @{ EnvValue = 'grok'; Cache = $hot; ResumeOwner = 'unknown' }
  Assert-Grok ((Test-Decision $envResume 'codex' 'env') -and $envResume.fellBack -and $envResume.recordSource -ceq 'env-fallback' -and (@($envResume.messages) -join '|') -ceq 'codex-do: -Resume continues on codex (engine env ignored)') 'K6a G1: unknown-owner -Resume under env grok -> codex (env-fallback)'
  $fileResume = Invoke-Engine @{ FileValue = 'grok'; ResumeOwner = 'codex' }
  Assert-Grok ((Test-Decision $fileResume 'codex' 'file') -and $fileResume.recordSource -ceq 'file-fallback') 'K6a G1: codex-owned -Resume under file grok -> codex (file-fallback)'
  $coolResume = Invoke-Engine @{ Cache = $cool; ResumeOwner = 'codex' }
  Assert-Grok ((Test-Decision $coolResume 'codex' 'auto') -and -not $coolResume.fellBack -and @($coolResume.messages).Count -eq 0) 'auto codex + codex-owned -Resume prints nothing'
  $labelled = Invoke-Engine @{ FileValue = 'grok'; ResumeOwner = 'grok'; ResumeLabel = 'abc from run 20261118-080200-0b03 2026-11-18T08:02:00Z' }
  Assert-Grok ((Format-DispatchEngineLine $labelled) -ceq 'codex-do: engine grok (file: -Resume continues grok session abc from run 20261118-080200-0b03 2026-11-18T08:02:00Z)') 'V5: the engine line names the session, owner run id and start time'
  $criticalResume = Invoke-Engine @{ Tier = 'Critical'; Cache = $hot; ResumeOwner = 'grok' }
  Assert-Grok ((Test-Decision $criticalResume 'grok' 'auto') -and @($criticalResume.messages).Count -eq 1 -and $criticalResume.messages[0] -match '^codex-do: warning: Critical packet runs on Grok by manual choice') 'K6a G12: a Critical packet resuming a grok-owned session resumes on grok with the manual-Critical warning'  # E1: env/file/auto grok ignores a non-grok -Model and -Effort ultra with one line; the flag path is validated before lint.
  $ignored = Get-GrokOptionPlan -Source 'auto' -Model 'gpt-6-astra' -ModelGiven -Effort 'ultra' -EffortGiven
  $ignoredPlan = Get-GrokLaunchPlan -Tier 'Important' -Model 'gpt-6-astra' -Effort 'ultra' -ModelGiven:$ignored.modelGiven -EffortGiven:$ignored.effortGiven
  Assert-Grok (-not $ignored.modelGiven -and -not $ignored.effortGiven -and $ignored.line -ceq 'codex-do: grok ignores -Model gpt-6-astra (uses grok-4.7-build-fast), -Effort ultra (uses xhigh); engine auto' -and $ignoredPlan.model -ceq 'grok-4.7-build-fast' -and $ignoredPlan.effort -ceq 'xhigh') 'E1: auto grok ignores -Model gpt-6-astra and -Effort ultra with one line'
  $kept = Get-GrokOptionPlan -Source 'env' -Model 'grok-4.7' -ModelGiven -Effort 'xhigh' -EffortGiven
  $plainOptions = Get-GrokOptionPlan -Source 'file' -Model 'gpt-6-sol' -Effort ''
  Assert-Grok ($kept.modelGiven -and $kept.effortGiven -and -not $kept.line -and -not $plainOptions.modelGiven -and -not $plainOptions.line) 'E1: grok model and non-ultra effort are kept; the default -Model prints nothing'
  # Intent: K5e touch-up U2-U6 at function level. Status: regression suite. Next: none. Blockers: none. Confidence: fixed clock, same ms values as statusline-engine.test.js.
  Assert-Grok ((Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":96,"resetsAt":1795176000000}}' | ConvertFrom-Json) }).engine -ceq 'grok' -and (Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":96,"resetsAt":1794916800000}}' | ConvertFrom-Json) }).engine -ceq 'codex' -and [DateTimeOffset]::FromUnixTimeMilliseconds(1795176000000).UtcDateTime.ToString('o') -ceq '2026-11-20T12:00:00.0000000Z') 'U2: auto: resetsAt above 1e11 is milliseconds'
  $malformedDir = Join-Path $fixture 'malformed-cache'
  New-Item -ItemType Directory -Path $malformedDir | Out-Null
  Write-Fixture (Join-Path $malformedDir 'codex-usage.json') '{"weekly":{"usedPercent":96,'
  $retryTimer = [Diagnostics.Stopwatch]::StartNew()
  $malformedRead = Read-CodexUsageCache -Path (Join-Path $malformedDir 'codex-usage.json')
  $retryMs = $retryTimer.ElapsedMilliseconds
  $malformedDecision = Resolve-DispatchEngine -CacheDir $malformedDir -Now $engineNow
  Assert-Grok ($null -eq $malformedRead -and $retryMs -ge 90 -and $malformedDecision.engine -ceq 'codex' -and $null -eq (Read-CodexUsageCache -Path (Join-Path $malformedDir 'missing.json'))) "U3: a malformed cache is read twice (retry after ~100 ms, took $retryMs ms) and still means codex; a missing one is no data"
  $nearUsed = Invoke-Engine @{ Cache = ('{"weekly":{"usedPercent":94.6,"resetsAt":' + $futureReset + '}}' | ConvertFrom-Json) }
  Assert-Grok ((Test-Decision $nearUsed 'codex' 'auto') -and $nearUsed.reason -ceq 'Codex weekly 94.6% used' -and (Format-CodexUsedPercent -Used 94.96 -Threshold 95) -ceq '94.9%' -and (Format-CodexUsedPercent -Used 96.4 -Threshold 95) -ceq '96%' -and (Format-CodexUsedPercent -Used 40.4 -Threshold 95) -ceq '40%' -and (Format-CodexUsedPercent -Used 95 -Threshold 95) -ceq '95%') 'U4: 94.6 -> codex with label 94.6%; whole percent otherwise'
  $sources = @(
    (Invoke-Engine @{ EnvValue = 'grok'; ResumeOwner = 'unknown' }).recordSource,
    (Invoke-Engine @{ FileValue = 'grok'; ResumeOwner = 'codex' }).recordSource,
    (Invoke-Engine @{ Cache = $hot; ResumeOwner = 'codex' }).recordSource,
    (Invoke-Engine @{ Cache = $hot; ResumeOwner = 'grok' }).recordSource,
    (Invoke-Engine @{ Cache = $hot }).recordSource,
    (Invoke-Engine @{ Cache = $cool; ResumeOwner = 'codex' }).recordSource,
    (Invoke-Engine @{ Tier = 'Critical'; Cache = $hot }).recordSource,
    (Invoke-Engine @{ Explicit = 'grok' }).recordSource,
    (Invoke-Engine @{ EnvValue = 'codex' }).recordSource)
  Assert-Grok (($sources -join ',') -ceq 'env-fallback,file-fallback,auto-fallback,auto,auto,auto,auto,flag,env') "U5/K6a: recordSource is <source>-fallback only when a codex-owned or unknown -Resume turned grok into codex ($($sources -join ','))"
  $effortKept = @(foreach ($value in @('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')) { (Get-GrokOptionPlan -Source 'auto' -Effort $value -EffortGiven).effortGiven })
  $ultraPlan = Get-GrokOptionPlan -Source 'env' -Effort 'ultra' -EffortGiven
  $bogusPlan = Get-GrokOptionPlan -Source 'file' -Effort 'turbo' -EffortGiven
  $flagUltra = Get-GrokOptionPlan -Source 'flag' -Effort 'ultra' -EffortGiven
  $ultraLaunch = Get-GrokLaunchPlan -Effort 'ultra' -EffortGiven:$ultraPlan.effortGiven
  Assert-Grok (@($effortKept | Where-Object { -not $_ }).Count -eq 0 -and -not $ultraPlan.effortGiven -and $ultraPlan.line -ceq 'codex-do: grok ignores -Effort ultra (uses xhigh); engine env' -and -not $bogusPlan.effortGiven -and $flagUltra.effortGiven -and $ultraLaunch.effort -ceq 'xhigh' -and ((Get-GrokEffortValues) -join ',') -ceq 'none,minimal,low,medium,high,xhigh,max') 'U6: auto/env/file keep the efforts grok 1.0.88 accepts and map others (ultra) to xhigh with one line'

  # Worked example (packet): left 4, dataTs 2 h ago, no usedPercent, Standard-B, nothing set -> grok auto, build-fast high, then engine.txt codex -> codex (file).
  $worked = '{"weekly":{"left":4},"dataTs":"2026-11-18T10:00:00Z"}' | ConvertFrom-Json
  $workedDecision = Invoke-Engine @{ Tier = 'Standard-B'; Cache = $worked }
  $workedOptions = Get-GrokOptionPlan -Source $workedDecision.source -Model 'gpt-6-sol' -Effort ''
  $workedPlan = Get-GrokLaunchPlan -Tier 'Standard-B' -Model 'gpt-6-sol' -Effort '' -ModelGiven:$workedOptions.modelGiven -EffortGiven:$workedOptions.effortGiven
  Assert-Grok ((Test-Decision $workedDecision 'grok' 'auto') -and (Format-DispatchEngineLine $workedDecision) -ceq 'codex-do: engine grok (auto: Codex weekly 96% used)' -and $workedPlan.model -ceq 'grok-4.7-build-fast' -and $workedPlan.effort -ceq 'xhigh' -and (@($workedPlan.args) -join ' ').Contains('--effort xhigh')) 'worked example: auto grok, build-fast xhigh, exact engine line'
  # Threshold and explicit I/O inputs.
  $ontologyDir = Join-Path $fixture 'ontology'
  New-Item -ItemType Directory -Path $ontologyDir | Out-Null
  Write-Fixture (Join-Path $ontologyDir 'ninety.json') '{"quota":{"thresholds":{"codexUsed3":90}}}'
  Write-Fixture (Join-Path $ontologyDir 'bad.json') '{"quota":{"thresholds":{"codexUsed3":"x"}}}'
  Write-Fixture (Join-Path $ontologyDir 'broken.json') '{not json'
  Assert-Grok ((Get-DispatchEngineThreshold -OntologyPath $env:ULTRATHINK_ONTOLOGY) -eq 95 -and (Get-DispatchEngineThreshold -OntologyPath (Join-Path $ontologyDir 'ninety.json')) -eq 90 -and (Get-DispatchEngineThreshold -OntologyPath (Join-Path $ontologyDir 'bad.json')) -eq 95 -and (Get-DispatchEngineThreshold -OntologyPath (Join-Path $ontologyDir 'broken.json')) -eq 95 -and (Get-DispatchEngineThreshold -OntologyPath (Join-Path $ontologyDir 'missing.json')) -eq 95) 'threshold = ontology codexUsed3 (repo 95, fixture 90), fallback 95'
  $ioState = Join-Path $fixture 'engine-io-state'; $ioCache = Join-Path $fixture 'engine-io-cache'
  New-Item -ItemType Directory -Path $ioCache | Out-Null
  Write-Fixture (Join-Path $ioCache 'codex-usage.json') ('{"weekly":{"usedPercent":92,"resetsAt":' + $futureReset + '}}')
  Assert-Grok ((Resolve-DispatchEngine -StateDir $ioState -CacheDir $ioCache -OntologyPath (Join-Path $ontologyDir 'ninety.json') -Now $engineNow).engine -ceq 'grok' -and (Resolve-DispatchEngine -StateDir $ioState -CacheDir $ioCache -OntologyPath $env:ULTRATHINK_ONTOLOGY -Now $engineNow).engine -ceq 'codex') 'explicit -StateDir/-CacheDir/-OntologyPath inputs are read only when given'
  Assert-Grok ((Get-CodexUsageCachePath -CacheDir 'C:\c' -AccountName 'main' -AccountHome 'C:\m') -ceq 'C:\c\codex-usage.json') 'main account reads codex-usage.json'

  # Intent: E7 - one worked cross-language check of the cache name for a non-main account.
  # Exact hash input: the string Resolve-CodexAccountHome -Name work returns, i.e. Join-Path ([IO.Path]::GetFullPath($env:CODEX_ACC_ROOT)) 'work'
  # (here <fixture>\accounts\work, absolute with backslashes); the status line hashes path.join(CODEX_ACC_ROOT, 'work') - the same string.
  . (Join-Path $bin 'codex-acc-lib.ps1')
  $env:CODEX_ACC_ROOT = Join-Path $fixture 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixture 'main-home'
  New-Item -ItemType Directory -Path (Join-Path $env:CODEX_ACC_ROOT 'work'), $env:CODEX_ACC_MAIN_HOME -Force | Out-Null
  Write-Fixture (Join-Path $env:CODEX_ACC_ROOT 'active') "work`n"
  $workHome = Resolve-CodexAccountHome -Name 'work'
  $psSuffix = Get-CodexUsageCacheSuffix -AccountName 'work' -AccountHome $workHome
  # JS single quotes only: PowerShell 5.1 does not escape embedded double quotes for native arguments.
  $nodeScript = "const s=require(process.argv[1]);process.stdout.write(s.codexHome()+'|'+s.codexCacheSuffix(s.codexHome(),process.env.CODEX_ACC_MAIN_HOME))"
  $nodeOut = (& node -e $nodeScript (Join-Path $source 'claude\statusline-ultrathink.js')) -join ''
  Assert-Grok ($workHome -ceq (Join-Path $fixture 'accounts\work') -and $nodeOut -ceq ($workHome + '|' + $psSuffix) -and $psSuffix -match '\A-[0-9a-f]{16}\z' -and (Get-CodexUsageCacheSuffix -AccountName 'main' -AccountHome $env:CODEX_ACC_MAIN_HOME) -ceq '') "PowerShell cache suffix equals the status line's for a non-main account ($psSuffix)"

  # Intent: dispatcher-level K5e paths that exit before launch: -SetEngine write/show, usage errors, env grok + -Account, concurrent writers. Status: real dispatcher processes. Next: host -SetEngine show. Blockers: none. Confidence: temp state, cache and ontology only.
  try {
    $engineState = Join-Path $fixture 'engine state'
    $engineCacheDir = Join-Path $fixture 'engine cache'
    New-Item -ItemType Directory -Path $engineCacheDir | Out-Null
    $env:CODEX_DO_STATE_DIR = $engineState
    $env:CODEX_DO_USAGE_CACHE_DIR = $engineCacheDir
    Remove-Item Env:CODEX_DO_ENGINE -ErrorAction SilentlyContinue
    Write-Fixture (Join-Path $env:CODEX_ACC_ROOT 'active') "main`n"
    $liveReset = [DateTimeOffset]::UtcNow.AddDays(2).ToUnixTimeSeconds()
    Write-Fixture (Join-Path $engineCacheDir 'codex-usage.json') ('{"weekly":{"left":4,"usedPercent":96,"resetsAt":' + $liveReset + '}}')
    $engineFile = Join-Path $engineState 'engine.txt'
    $show = Invoke-TestDispatcher @('-SetEngine', 'show')
    Assert-Grok ($show.Code -eq 0 -and $show.Text.Contains('codex-do: engine mode: auto (default)') -and $show.Text.Contains('codex-do: Codex weekly used: 96%') -and $show.Text.Contains('grok (auto: Codex weekly 96% used)') -and -not (Test-Path -LiteralPath $engineFile)) '-SetEngine show prints mode, source, used % and creates nothing'
    $set = Invoke-TestDispatcher @('-SetEngine', 'codex')
    $setBytes = [IO.File]::ReadAllBytes($engineFile)
    Assert-Grok ($set.Code -eq 0 -and $set.Text.Contains('codex-do: engine mode saved: codex') -and $set.Text.Contains('effective engine for a non-Critical packet: codex (file: engine.txt says codex)') -and [Convert]::ToBase64String($setBytes) -ceq [Convert]::ToBase64String((B "codex`n")) -and @(Get-ChildItem -LiteralPath $engineState -Filter '*.tmp').Count -eq 0) '-SetEngine codex writes one line without BOM and reports codex (file) while Codex is at 96%'
    $beforeShow = (Get-Item -LiteralPath $engineFile).LastWriteTimeUtc
    $showFile = Invoke-TestDispatcher @('-SetEngine', 'show')
    Assert-Grok ($showFile.Code -eq 0 -and $showFile.Text.Contains('engine mode: codex (file)') -and (Get-Item -LiteralPath $engineFile).LastWriteTimeUtc -eq $beforeShow -and (Test-Bytes $engineFile (B "codex`n"))) '-SetEngine show reads engine.txt and changes nothing'
    $nextDispatch = Resolve-DispatchEngine -FileValue (Read-DispatchEngineFile -StateDir $engineState) -Cache ([IO.File]::ReadAllText((Join-Path $engineCacheDir 'codex-usage.json')) | ConvertFrom-Json) -Tier 'Standard-B'
    Assert-Grok ((Test-Decision $nextDispatch 'codex' 'file')) 'worked example: after -SetEngine codex the next dispatch is codex (file) although Codex is at 96%'
    $setAuto = Invoke-TestDispatcher @('-SetEngine', 'auto')
    Assert-Grok ($setAuto.Code -eq 0 -and $setAuto.Text.Contains('engine mode: auto (file)') -and $setAuto.Text.Contains('grok (auto: Codex weekly 96% used)') -and (Test-Bytes $engineFile (B "auto`n"))) '-SetEngine auto writes auto and reports the auto result'
    $usage = @(@('-SetEngine', 'grok', '-Status'), @('-SetEngine', 'grok', '-SpecFile', 'x.md'), @('-SetEngine', 'grok', '-Undo', 'last'), @('-SetEngine', 'grok', '-Cancel', 'last'), @('-SetEngine', 'grok', '-Attach', 'last'), @('-SetEngine', 'show', '-Engine', 'codex')) | ForEach-Object { (Invoke-TestDispatcher $_).Code }
    Assert-Grok ((@($usage | Where-Object { $_ -ne 64 }).Count -eq 0) -and (Test-Bytes $engineFile (B "auto`n"))) "-SetEngine with dispatch, -Status, -Undo, -Cancel, -Attach or -Engine exits 64 and writes nothing (codes $($usage -join ','))"
    # Parameter-binding errors go to stderr; collect them as text, not as terminating errors.
    $ErrorActionPreference = 'Continue'
    try { $badValue = Invoke-TestDispatcher @('-SetEngine', 'turbo'); $bareValue = Invoke-TestDispatcher @('-SetEngine') }
    finally { $ErrorActionPreference = 'Stop' }
    Assert-Grok ($badValue.Code -ne 0 -and $bareValue.Code -ne 0 -and (Test-Bytes $engineFile (B "auto`n"))) '-SetEngine needs codex|grok|auto|show (no bare form) and an invalid value writes nothing'
    Write-Fixture (Join-Path $env:CODEX_ACC_ROOT 'active') "Bad Name`n"
    $unknownUse = Invoke-TestDispatcher @('-SetEngine', 'show')
    Assert-Grok ($unknownUse.Code -eq 0 -and $unknownUse.Text.Contains('Codex weekly used: unknown') -and $unknownUse.Text.Contains('codex (auto: no Codex usage data)')) '-SetEngine show reports used: unknown on an account error'
    Write-Fixture (Join-Path $env:CODEX_ACC_ROOT 'active') "main`n"
    # Two writers at the same time: both succeed, the file holds one complete value, no temp file is left.
    $writers = @()
    try {
      foreach ($value in @('codex', 'grok', 'codex', 'grok')) {
        $writers += Start-Process -FilePath powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -SetEngine {1}' -f (Join-Path $bin 'codex-do.ps1'), $value) -WindowStyle Hidden -PassThru
      }
      foreach ($writer in $writers) { $null = $writer.Handle }
      foreach ($writer in $writers) { [void]$writer.WaitForExit(120000) }
      $writerCodes = @($writers | ForEach-Object { $_.ExitCode })
    } finally { foreach ($writer in $writers) { if (-not $writer.HasExited) { $writer.Kill() }; $writer.Dispose() } }
    $finalValue = [IO.File]::ReadAllText($engineFile)
    Assert-Grok (@($writerCodes | Where-Object { $_ -ne 0 }).Count -eq 0 -and @("codex`n", "grok`n") -ccontains $finalValue -and @(Get-ChildItem -LiteralPath $engineState -Filter '*.tmp').Count -eq 0) "four concurrent -SetEngine writers all exit 0 and leave one whole value (codes $($writerCodes -join ','))"
    # K6a: env grok + -Account and file grok + -Sandbox stay on grok; the non-repo Dir stops them before launch.
    $validSpec = Join-Path $fixture 'k5e-packet.md'
    Write-Fixture $validSpec "TIER: Standard-A`nGOAL: x`nSUCCESS CRITERIA: x`nFILES: a.ps1`nCONSTRAINTS: local`nDONE WHEN: done`nVALIDATE: git diff`nSTOP RULES: stop`nDOCS CHECKED: n/a`nPACKET CHECK: ok`n"
    $env:CODEX_DO_ENGINE = 'grok'
    $envAccount = Invoke-TestDispatcher @('-Account', 'main', '-Dir', $fixture, '-SpecFile', $validSpec, '-NoRamCheck')
    $env:CODEX_DO_ENGINE = 'bogus'
    Write-Fixture $engineFile "grok`n"
    $fileSandbox = Invoke-TestDispatcher @('-Sandbox', 'read-only', '-Dir', $fixture, '-SpecFile', $validSpec, '-NoRamCheck')
    Assert-Grok ($envAccount.Code -eq 78 -and $envAccount.Text.Contains('codex-do: -Account ignored on grok') -and $envAccount.Text -match 'engine grok \(env' -and $fileSandbox.Code -eq 78 -and $fileSandbox.Text -match "CODEX_DO_ENGINE='bogus'" -and $fileSandbox.Text -match 'engine grok \(file' -and $fileSandbox.Text -notmatch 'does not support' -and @(Get-ChildItem -LiteralPath (Join-Path $engineState 'runs') -ErrorAction SilentlyContinue).Count -eq 0) 'K6a: env grok + -Account prints the ignored line and file grok + -Sandbox read-only stays grok (both stop at the non-repo Dir check, exit 78, before launch); invalid env warns'
  } finally {
    foreach ($name in @('CODEX_DO_STATE_DIR', 'CODEX_DO_ENGINE', 'CODEX_DO_USAGE_CACHE_DIR')) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $env:CODEX_DO_ENGINE = 'codex'
    $env:CODEX_DO_USAGE_CACHE_DIR = Join-Path $fixture 'usage-cache-empty'
    $env:CODEX_DO_STATE_DIR = $defaultState
  }

  # Intent: K6a G1 - one owner lookup: 'last' = newest run for -Dir (any engine), a UUID = the newest run whose session.txt equals it; engine from run.json. Status: K6a. Next: none. Blockers: none. Confidence: fixture run folders with pinned creation times.
  $ownerRuns = Join-Path $fixture 'owner-state\runs'
  function New-OwnerRun([string]$Name, [hashtable]$Fields, [string]$Session, [datetime]$CreatedUtc, [string]$Log = '') {
    $folder = Join-Path $ownerRuns $Name
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $Fields.runId = $Name
    Write-Fixture (Join-Path $folder 'run.json') ($Fields | ConvertTo-Json)
    if ($Session) { Write-Fixture (Join-Path $folder 'session.txt') $Session }
    if ($Log) { Write-Fixture (Join-Path $folder 'out.log') $Log }
    [IO.Directory]::SetCreationTimeUtc($folder, $CreatedUtc)
    return $folder
  }
  $ownerDirX = Join-Path $fixture 'owner X'; $ownerDirY = Join-Path $fixture 'owner Y'
  $codexSession = '0a000000-0000-4000-8000-000000000001'; $grokSession = '0b000000-0000-4000-8000-000000000002'
  $endLine = { param([string]$Session, [long]$Total) '{"type":"end","stopReason":"end_turn","sessionId":"' + $Session + '","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":' + $Total + '}}' }
  [void](New-OwnerRun '20261118-080000-0a01' @{ dir = $ownerDirX; model = 'gpt-6-sol'; effort = 'high' } $codexSession ([datetime]'2026-11-18T08:00:00Z'))
  [void](New-OwnerRun '20261118-080100-0b02' @{ dir = $ownerDirX; engine = 'grok'; model = 'grok-4.7-build-fast'; effort = 'xhigh'; sandboxMode = 'grok-workspace' } $grokSession ([datetime]'2026-11-18T08:01:00Z') ("{`"type`":`"text`",`"data`":`"x`"}`n" + (& $endLine $grokSession 30000000) + "`n"))
  [void](New-OwnerRun '20261118-080200-0b03' @{ dir = $ownerDirX; engine = 'grok'; model = 'grok-4.7-build-fast'; effort = 'xhigh'; resume = $grokSession } $grokSession ([datetime]'2026-11-18T08:02:00Z') ((& $endLine $grokSession 25000000) + "`n"))
  [void](New-OwnerRun '20261118-080300-0c04' @{ dir = $ownerDirY; model = 'gpt-6-sol'; effort = 'high' } '0c000000-0000-4000-8000-000000000003' ([datetime]'2026-11-18T08:03:00Z'))
  $lastX = Get-GrokResumeOwner -RunsDir $ownerRuns -Dir $ownerDirX -Resume 'last'
  $lastY = Get-GrokResumeOwner -RunsDir $ownerRuns -Dir $ownerDirY -Resume 'last'
  $byCodexId = Get-GrokResumeOwner -RunsDir $ownerRuns -Dir $ownerDirY -Resume $codexSession.ToUpperInvariant()
  $byGrokId = Get-GrokResumeOwner -RunsDir $ownerRuns -Dir $ownerDirY -Resume $grokSession
  $noRun = Get-GrokResumeOwner -RunsDir $ownerRuns -Dir (Join-Path $fixture 'owner Z') -Resume 'last'
  $noId = Get-GrokResumeOwner -RunsDir $ownerRuns -Dir $ownerDirX -Resume '0d000000-0000-4000-8000-000000000004'
  $noFolder = Get-GrokResumeOwner -RunsDir (Join-Path $fixture 'no-such-runs') -Dir $ownerDirX -Resume 'last'
  Assert-Grok ($lastX.owner -ceq 'grok' -and $lastX.runId -ceq '20261118-080200-0b03' -and $lastX.session -ceq $grokSession) "K6a G1: 'last' = newest run for -Dir: grok-owned ($($lastX.owner) $($lastX.runId))"
  Assert-Grok ($lastY.owner -ceq 'codex' -and $byCodexId.owner -ceq 'codex' -and $byCodexId.runId -ceq '20261118-080000-0a01' -and $byGrokId.owner -ceq 'grok' -and $byGrokId.runId -ceq '20261118-080200-0b03') 'K6a G1: a UUID resolves to the run whose session.txt equals it (case-insensitive); codex runs are codex-owned'
  Assert-Grok ($noRun.owner -ceq 'unknown' -and $noId.owner -ceq 'unknown' -and $noFolder.owner -ceq 'unknown') 'K6a G1: no matching run (or no runs folder) -> unknown'
  # Intent: K6a G9 - the 50M cap sums usage.total_tokens of each run's final 'end' event for the session; no data -> $null. Status: K6a. Next: none. Blockers: none. Confidence: probe 1 field names.
  Assert-Grok ((Get-GrokSessionTokens -RunsDir $ownerRuns -Session $grokSession) -eq 55000000 -and $null -eq (Get-GrokSessionTokens -RunsDir $ownerRuns -Session $codexSession) -and $null -eq (Get-GrokSessionTokens -RunsDir $ownerRuns -Session '0d000000-0000-4000-8000-000000000004')) 'K6a G9: grok session tokens = sum of end-event usage.total_tokens across its runs (55M); none -> null'
  # Intent: K6a G8 - -OutFile gets the last assistant text: the text deltas after the final tool event. Status: K6a. Next: none. Blockers: none. Confidence: streaming-json shape from probe 1.
  $answerLog = Join-Path $fixture 'answer-out.log'
  Write-Fixture $answerLog ("not json`n" + '{"type":"text","data":"I will look."}' + "`n" + '{"type":"tool_call","toolCallId":"c1","toolName":"read_file"}' + "`n" + '{"type":"tool_call_update","toolCallId":"c1","status":"completed"}' + "`n" + '{"type":"thought","data":"hmm"}' + "`n" + '{"type":"text","data":"final "}' + "`n" + '{"type":"text","data":"answer"}' + "`n" + (& $endLine $grokSession 5) + "`n")
  Assert-Grok ((Get-GrokFinalText -LogPath $answerLog) -ceq 'final answer' -and (Get-GrokFinalText -LogPath (Join-Path $fixture 'missing.log')) -ceq '') 'K6a G8: Get-GrokFinalText returns the text after the last tool event'

  # Intent: K6a G3 - a read-only run never applies: status read-only, worktree removed, grok's exit published, no undo bundle, changed paths recorded with one warning line; -OutFile written. Status: K6a. Next: none. Blockers: none. Confidence: real worktree fixture.
  $roRepo = New-TestRepo 'ro repo' 'false' @{ 'r.txt' = (B "r`n") }
  foreach ($roCase in @(@{ Name = 'ro-zero'; Exit = 0 }, @{ Name = 'ro-five'; Exit = 5 })) {
    $roRun = Start-TestRun $roRepo $roCase.Name
    $roAnswer = Join-Path $fixture "$($roCase.Name) answer.txt"
    $roMeta = [IO.File]::ReadAllText((Join-Path $roRun.Folder 'run.json')) | ConvertFrom-Json
    $roMeta | Add-Member -NotePropertyName sandboxMode -NotePropertyValue 'read-only'
    $roMeta | Add-Member -NotePropertyName outFile -NotePropertyValue $roAnswer
    Write-Fixture (Join-Path $roRun.Folder 'run.json') ($roMeta | ConvertTo-Json)
    Write-Fixture (Join-Path $roRun.Folder 'out.log') ('{"type":"text","data":"read-only "}' + "`n" + '{"type":"text","data":"findings"}' + "`n")
    Write-Fixture (Join-Path $roRun.Wt 'r.txt') "changed`n"
    Write-Fixture (Join-Path $roRun.Wt 'new.txt') "new`n"
    $roLines = @(Invoke-GrokBringBack -RunFolder $roRun.Folder -GrokExit $roCase.Exit 6>&1 | ForEach-Object { "$_" })
    $roApply = Read-Apply $roRun
    Assert-Grok ($roApply.status -ceq 'read-only' -and (Read-Exit $roRun) -ceq [string]$roCase.Exit -and (Get-Sorted @($roApply.changedPaths)) -ceq 'new.txt|r.txt' -and -not (Test-Path -LiteralPath $roRun.Wt) -and -not (Test-Path -LiteralPath (Join-Path $roRun.Folder 'undo')) -and (Test-Bytes (Join-Path $roRepo 'r.txt') (B "r`n")) -and -not (Test-Path -LiteralPath (Join-Path $roRepo 'new.txt'))) "K6a G3: read-only run (grok exit $($roCase.Exit)) applies nothing, publishes exit $($roCase.Exit), removes the worktree, records changedPaths"
    Assert-Grok ($roLines.Count -eq 1 -and $roLines[0] -match '^grok read-only: nothing applied' -and $roLines[0].Contains('2 changed path(s) discarded') -and [IO.File]::ReadAllText($roAnswer) -ceq 'read-only findings') "K6a G3/G8: one result line and -OutFile holds the final answer ($($roLines -join ' / '))"
  }
  $roClean = Start-TestRun $roRepo 'ro-clean'
  $roCleanMeta = [IO.File]::ReadAllText((Join-Path $roClean.Folder 'run.json')) | ConvertFrom-Json
  $roCleanMeta | Add-Member -NotePropertyName sandboxMode -NotePropertyValue 'read-only'
  Write-Fixture (Join-Path $roClean.Folder 'run.json') ($roCleanMeta | ConvertTo-Json)
  $roCleanLines = @(Invoke-GrokBringBack -RunFolder $roClean.Folder -GrokExit 0 6>&1 | ForEach-Object { "$_" })
  Assert-Grok ((Read-Apply $roClean).status -ceq 'read-only' -and $null -eq (Read-Apply $roClean).PSObject.Properties['changedPaths'] -and $roCleanLines.Count -eq 1 -and $roCleanLines[0] -ceq 'grok read-only: nothing applied' -and -not (Test-Path -LiteralPath $roClean.Wt)) 'K6a G3: a clean read-only run prints exactly one line'

  # Intent: V1 - a read-only run whose run.json cannot be read (held open exclusively past the retries) fails closed: status error, exit 77, worktree kept, nothing applied. Status: K6a touch-up. Next: none. Blockers: none. Confidence: locked-file fixture.
  $lockedRun = Start-TestRun $roRepo 'ro-locked'
  $lockedMeta = [IO.File]::ReadAllText((Join-Path $lockedRun.Folder 'run.json')) | ConvertFrom-Json
  $lockedMeta | Add-Member -NotePropertyName sandboxMode -NotePropertyValue 'read-only'
  Write-Fixture (Join-Path $lockedRun.Folder 'run.json') ($lockedMeta | ConvertTo-Json)
  Write-Fixture (Join-Path $lockedRun.Wt 'r.txt') "changed`n"
  $holder = [IO.File]::Open((Join-Path $lockedRun.Folder 'run.json'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try { Invoke-GrokBringBack -RunFolder $lockedRun.Folder -GrokExit 0 6>$null } finally { $holder.Dispose() }
  $lockedApply = Read-Apply $lockedRun
  Assert-Grok ($lockedApply.status -ceq 'error' -and (Read-Exit $lockedRun) -ceq '77' -and (Test-Path -LiteralPath $lockedRun.Wt) -and (Test-Bytes (Join-Path $roRepo 'r.txt') (B "r`n")) -and -not (Test-Path -LiteralPath (Join-Path $lockedRun.Folder 'undo'))) "V1: unreadable run.json on a read-only run -> error 77, worktree kept, nothing applied ($($lockedApply.status))"
  Remove-GrokWorktree -Dir $roRepo -WorktreeDir $lockedRun.Wt
  # Intent: V2 - Initialize-GrokResumeWorktree moves a kept worktree aside (bytes intact, still registered) and prunes a folder deleted by hand so worktree add works again. Status: K6a touch-up. Next: none. Blockers: none. Confidence: real git worktrees.
  $keptRun = Start-TestRun $roRepo 'resume-kept'
  Write-Fixture (Join-Path $keptRun.Wt 'r.txt') "worker edit`n"
  $keptPath = Initialize-GrokResumeWorktree -Dir $roRepo -WorktreeDir $keptRun.Wt -Stamp '20261118-120000'
  $listing = Invoke-GrokGit -Dir $roRepo -Arguments @('worktree','list','--porcelain')
  Assert-Grok ($keptPath -ceq ($keptRun.Wt + '-kept-20261118-120000') -and -not (Test-Path -LiteralPath $keptRun.Wt) -and (Test-Bytes (Join-Path $keptPath 'r.txt') (B "worker edit`n")) -and $listing.Replace('\','/').Contains($keptPath.Replace('\','/'))) 'V2: a kept worktree is moved aside with git worktree move (bytes intact, still registered)'
  $again = New-GrokWorktree -Dir $roRepo -WorktreeDir $keptRun.Wt -RunFolder (New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'state space\runs\resume-kept-2')).FullName
  Assert-Grok ((Test-Path -LiteralPath $again.worktreeDir) -and (Initialize-GrokResumeWorktree -Dir $roRepo -WorktreeDir (Join-Path $fixture 'no such wt')) -ceq '') 'V2: after the move a fresh worktree is added at the same path; a free path returns no kept path'
  $missingRun = Start-TestRun $roRepo 'resume-missing'
  Remove-Item -LiteralPath $missingRun.Wt -Recurse -Force
  $missingError = ''
  try { [void](New-GrokWorktree -Dir $roRepo -WorktreeDir $missingRun.Wt -RunFolder (New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'state space\runs\resume-missing-a')).FullName) } catch { $missingError = $_.Exception.Message }
  [void](Initialize-GrokResumeWorktree -Dir $roRepo -WorktreeDir $missingRun.Wt)
  $readded = New-GrokWorktree -Dir $roRepo -WorktreeDir $missingRun.Wt -RunFolder (New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'state space\runs\resume-missing-b')).FullName
  Assert-Grok ($missingError -match 'registered' -and (Test-Path -LiteralPath $readded.worktreeDir)) "V2: a registered-but-missing worktree folder blocks add until prune; after prune the add succeeds ($missingError)"
  # Intent: V4 - an error-terminated run still counts its reported spend. Status: K6a touch-up. Next: none. Blockers: none. Confidence: fixture log.
  $errorRuns = Join-Path $fixture 'error-state\runs'
  $errorFolder = Join-Path $errorRuns '20261118-100000-ee01'
  New-Item -ItemType Directory -Path $errorFolder -Force | Out-Null
  $errorSession = '3e000000-0000-4000-8000-000000000001'
  Write-Fixture (Join-Path $errorFolder 'session.txt') $errorSession
  Write-Fixture (Join-Path $errorFolder 'out.log') ((& $endLine $errorSession 100) + "`n" + '{"type":"error","message":"boom","sessionId":"' + $errorSession + '","usage":{"total_tokens":4200}}' + "`n")
  Assert-Grok ((Get-GrokSessionTokens -RunsDir $errorRuns -Session $errorSession) -eq 4200) 'V4: the final error event''s usage.total_tokens is counted'
  # Intent: K6a G1/G2/G8/G9 dispatcher paths that exit before launch: owner/engine conflicts (2), prior worktree still present (78), sandbox mismatch (2), 50M cap (76), no session id (2). Status: real dispatcher processes, temp state only (G10). Next: none. Blockers: none. Confidence: fixture run folders.
  try {
    $k6State = Join-Path $fixture 'k6 state'
    $env:CODEX_DO_STATE_DIR = $k6State
    $env:CODEX_DO_ENGINE = 'codex'
    $k6Runs = Join-Path $k6State 'runs'
    $ownerRuns = $k6Runs
    $k6Repo = New-TestRepo 'k6 repo' 'false' @{ 'k.txt' = (B "k`n") }
    $k6Spec = Join-Path $fixture 'k6-fix.md'
    Write-Fixture $k6Spec "TIER: Standard-B`nGOAL: fix`n"
    $capSession = '1a000000-0000-4000-8000-000000000001'; $keptSession = '1b000000-0000-4000-8000-000000000002'
    $roSession = '1c000000-0000-4000-8000-000000000003'; $codexOwned = '1d000000-0000-4000-8000-000000000004'
    [void](New-OwnerRun '20261118-090000-1a01' @{ dir = $k6Repo; engine = 'grok'; worktreeDir = (Join-Path $k6State 'grok-wt\20261118-090000-1a01'); sandboxMode = 'grok-workspace' } $capSession ([datetime]'2026-11-18T09:00:00Z') ((& $endLine $capSession 30000000) + "`n"))
    [void](New-OwnerRun '20261118-090100-1a02' @{ startedUtc = '2026-11-18T09:01:00Z'; dir = $k6Repo; engine = 'grok'; worktreeDir = (Join-Path $k6State 'grok-wt\20261118-090100-1a02'); sandboxMode = 'grok-workspace' } $capSession ([datetime]'2026-11-18T09:01:00Z') ((& $endLine $capSession 25000000) + "`n"))
    $keptWt = Join-Path $k6State 'grok-wt\20261118-090200-1b03'
    New-Item -ItemType Directory -Path $keptWt -Force | Out-Null
    [void](New-OwnerRun '20261118-090200-1b03' @{ dir = $k6Repo; engine = 'grok'; worktreeDir = $keptWt; sandboxMode = 'grok-workspace' } $keptSession ([datetime]'2026-11-18T09:02:00Z'))
    [void](New-OwnerRun '20261118-090300-1c04' @{ dir = $k6Repo; engine = 'grok'; worktreeDir = (Join-Path $k6State 'grok-wt\20261118-090300-1c04'); sandboxMode = 'read-only' } $roSession ([datetime]'2026-11-18T09:03:00Z'))
    [void](New-OwnerRun '20261118-090400-1d05' @{ dir = (Join-Path $fixture 'k6 other'); model = 'gpt-6-sol'; effort = 'high' } $codexOwned ([datetime]'2026-11-18T09:04:00Z'))
    $noSessionDir = Join-Path $fixture 'k6 no session'
    [void](New-OwnerRun '20261118-090500-1e06' @{ dir = $noSessionDir; engine = 'grok'; worktreeDir = (Join-Path $k6State 'grok-wt\20261118-090500-1e06') } '' ([datetime]'2026-11-18T09:05:00Z'))
    $before = @(Get-ChildItem -LiteralPath $k6Runs -Directory).Count
    $cap = Invoke-TestDispatcher @('-Resume', $capSession, '-Dir', $k6Repo, '-SpecFile', $k6Spec, '-NoRamCheck')
    Assert-Grok ($cap.Code -eq 76 -and $cap.Text.Contains("codex-do: session $capSession already used 55M tokens (> 50M rule)") -and $cap.Text.Contains("engine grok (env: -Resume continues grok session $capSession from run 20261118-090100-1a02 2026-11-18T09:01:00Z)")) "K6a G9: grok-owned -Resume over 50M summed tokens exits 76 (env codex does not override a grok owner) ($($cap.Code))"
    $kept = Invoke-TestDispatcher @('-Resume', $keptSession, '-Dir', $k6Repo, '-SpecFile', $k6Spec, '-NoRamCheck')
    Assert-Grok ($kept.Code -eq 78 -and $kept.Text.Contains('codex-do: grok run 20261118-090200-1b03 has no exit.txt (run codex-do.ps1 -Cancel 20261118-090200-1b03 to seal it); cannot -Resume its session yet') -and (Test-Path -LiteralPath $keptWt)) "V2: a prior run that never published exit.txt -> exit 78, its worktree untouched ($($kept.Code))"
    $roMismatch = Invoke-TestDispatcher @('-Resume', $roSession, '-Sandbox', 'workspace-write', '-Dir', $k6Repo, '-SpecFile', $k6Spec, '-NoRamCheck')
    Assert-Grok ($roMismatch.Code -eq 2 -and $roMismatch.Text -match 'started with sandbox read-only; -Sandbox workspace-write cannot resume it') "K6a G8: -Resume with another sandbox than the owning run exits 2 ($($roMismatch.Code))"
    $flagCodex = Invoke-TestDispatcher @('-Engine', 'codex', '-Resume', $capSession, '-Dir', $k6Repo, '-SpecFile', $k6Spec, '-NoRamCheck')
    $flagGrok = Invoke-TestDispatcher @('-Engine', 'grok', '-Resume', $codexOwned, '-Dir', $k6Repo, '-SpecFile', $k6Spec, '-NoRamCheck')
    Assert-Grok ($flagCodex.Code -eq 2 -and $flagCodex.Text -match 'belongs to grok' -and $flagGrok.Code -eq 2 -and $flagGrok.Text -match 'belongs to codex') 'K6a G1: dispatcher grok owner + -Engine codex and codex owner + -Engine grok exit 2'
    $noSession = Invoke-TestDispatcher @('-Resume', 'last', '-Dir', $noSessionDir, '-SpecFile', $k6Spec, '-NoRamCheck')
    Assert-Grok ($noSession.Code -eq 2 -and $noSession.Text.Contains('codex-do: grok run 20261118-090500-1e06 has no session id to resume')) "K6a: a grok-owned 'last' without a session id exits 2 ($($noSession.Code))"
    # V3: a UUID resume whose owner run worked on another Dir exits 2.
    $otherDir = Invoke-TestDispatcher @('-Resume', $roSession, '-Dir', (Join-Path $fixture 'k6 other dir'), '-SpecFile', $k6Spec, '-NoRamCheck')
    Assert-Grok ($otherDir.Code -eq 2 -and $otherDir.Text.Contains("codex-do: grok session $roSession belongs to $k6Repo, not -Dir")) "V3: UUID -Resume with another -Dir exits 2 ($($otherDir.Code))"
    # V2: the prior run is still running (live wrapper, no lock file) -> 78 under the Dir lock; its worktree stays.
    $liveSession = '1f000000-0000-4000-8000-000000000007'
    $liveWt = Join-Path $k6State 'grok-wt\20261118-090600-1f07'
    New-Item -ItemType Directory -Path $liveWt -Force | Out-Null
    $liveStandIn = Start-Process -FilePath powershell -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
    try {
      [void](New-OwnerRun '20261118-090600-1f07' @{ dir = $k6Repo; engine = 'grok'; worktreeDir = $liveWt; sandboxMode = 'grok-workspace'; wrapperPid = $liveStandIn.Id; wrapperCreationDate = $liveStandIn.StartTime.ToUniversalTime().ToString('o'); startedUtc = '2026-11-18T09:06:00Z' } $liveSession ([datetime]'2026-11-18T09:06:00Z'))
      $live = Invoke-TestDispatcher @('-Resume', $liveSession, '-Dir', $k6Repo, '-SpecFile', $k6Spec, '-NoRamCheck')
      Assert-Grok ($live.Code -eq 78 -and $live.Text.Contains('codex-do: grok run 20261118-090600-1f07 is still running; cannot -Resume its session yet') -and (Test-Path -LiteralPath $liveWt)) "V2: resume while the prior run is alive exits 78 and keeps its worktree ($($live.Code))"
    } finally { if (-not $liveStandIn.HasExited) { $liveStandIn.Kill(); $liveStandIn.WaitForExit() }; $liveStandIn.Dispose() }
    $before = $before + 1 # the live fixture run above    Assert-Grok (@(Get-ChildItem -LiteralPath $k6Runs -Directory).Count -eq $before -and -not (Test-Path -LiteralPath (Join-Path $k6State 'grok-wt\20261118-090100-1a02'))) 'K6a: refused resumes create no run folder and no worktree'
  } finally {
    $env:CODEX_DO_STATE_DIR = $defaultState
    $env:CODEX_DO_ENGINE = 'codex'
  }
  # Intent: timing evidence for setup + bring-back on 1,000+ files (printed, not asserted). Status: criterion 8. Next: host real run. Blockers: none. Confidence: clone of this repository.
  $big = Join-Path $fixture 'timing repo'
  [void](Invoke-GrokGit -Dir $source -Arguments @('clone','--shared','--quiet','--', $source, $big))
  # Run 1 reads a just-cloned Dir (cold: first reads of new files are slow on this host); run 2 reads it again (warm, like a long-lived working tree).
  foreach ($phase in @('cold','warm')) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $bigRun = Start-TestRun $big "timing-$phase"
    $setupMs = $timer.ElapsedMilliseconds
    Write-Fixture (Join-Path $bigRun.Wt "timing-$phase.txt") "timing`n"
    $timer.Restart()
    Invoke-GrokBringBack -RunFolder $bigRun.Folder -GrokExit 0 6>$null
    $bringMs = $timer.ElapsedMilliseconds
    Write-Host ("TIMING ({0} Dir): {1} files, setup {2} ms, bring-back {3} ms, status {4}" -f $phase, $bigRun.Count, $setupMs, $bringMs, (Read-Apply $bigRun).status)
    Assert-Grok ($bigRun.Count -ge 1000 -and (Read-Apply $bigRun).status -ceq 'applied' -and @((Read-Apply $bigRun).files).Count -eq 1) "timing run ($phase) covers 1,000+ files and applies one file"
  }
} catch {
  $script:failed++; Write-Host "FAIL: $($_.Exception.Message) at $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  try { Assert-Grok (@(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue).Count -eq $realRunCount -and (@(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ',') -ceq $realRunNewest) 'K6a G10/V8: the real ~/.claude/state/runs folder count and newest folder names are unchanged' } catch {}
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  $resolved = [IO.Path]::GetFullPath($fixture)
  if ((Split-Path -Parent $resolved) -ne $tempRoot -or (Split-Path -Leaf $resolved) -notlike 'grok-engine-test-*') { throw 'unsafe test cleanup path' }
  if (Test-Path -LiteralPath $resolved) {
    Get-ChildItem -LiteralPath $resolved -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.IsReadOnly } | ForEach-Object { $_.IsReadOnly = $false }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
Write-Host "PASS: $script:passed FAIL: $script:failed"
if ($script:failed) { exit 1 }
