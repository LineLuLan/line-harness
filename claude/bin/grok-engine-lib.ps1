# Intent: UTF-8 git runner; K5d uses git only to list paths and to build the cosmetic worktree index, never to move file bytes. Status: shared. Next: none. Blockers: none. Confidence: offline byte fixtures.
# core.autocrlf=false is the default override; -RepoNewlines drops it so read-tree/update-index see Dir's own newline config (A12).
function Invoke-GrokGit {
  param([string]$Dir, [string[]]$Arguments, [switch]$RepoNewlines)
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = 'git'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
  $start.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
  # Git arguments contain no embedded quotes; double trailing backslashes before closing quotes.
  $native = if ($RepoNewlines) { @('-C', $Dir) + @($Arguments) } else { @('-c', 'core.autocrlf=false', '-C', $Dir) + @($Arguments) }
  $start.Arguments = (@($native | ForEach-Object {
    if ($_ -match '"') { throw 'Git argument contains a quote' }
    '"' + ($_ -replace '(\\+)$', '$1$1') + '"'
  }) -join ' ')
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $output = $stdout.Result
    $errorText = $stderr.Result
    if ($process.ExitCode -ne 0) { throw ("git {0}: {1}" -f $Arguments[0], ($errorText.Trim() -replace '[\r\n]+', ' ')) }
    return $output.TrimEnd([char[]]@("`r", "`n"))
  } finally { $process.Dispose() }
}

# Intent: report, never force, a worktree folder that git leaves behind (junctions inside it); recursive deletes could follow a junction (T5). Status: cleanup reporter. Next: none. Blockers: none. Confidence: forced fixture.
function Remove-GrokWorktreeChecked {
  param([string]$Dir, [string]$WorktreeDir)
  try { Remove-GrokWorktree -Dir $Dir -WorktreeDir $WorktreeDir }
  catch { return ($_.Exception.Message -replace '[\r\n]+', ' ') }
  if ([IO.Directory]::Exists($WorktreeDir)) { return 'worktree folder still present (junctions?)' }
  return $null
}

function Get-GrokNulFields {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return @() }
  return @($Text.Split([char]0) | Where-Object { $_.Length -gt 0 })
}

# Intent: keep copied paths inside the repository or worktree they came from. Status: shared path check. Next: none. Blockers: none. Confidence: relative git paths.
function Join-GrokChildPath {
  param([string]$Root, [string]$Relative)
  $clean = ($Relative -replace '/', '\').TrimEnd('\')
  if ([string]::IsNullOrWhiteSpace($clean)) { throw 'empty relative path' }
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $full = [IO.Path]::GetFullPath((Join-Path $rootFull $clean))
  $prefix = $rootFull + '\'
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "path escapes its root: $Relative" }
  return $full
}

# Intent: refuse invalid roots before creating dispatch state. Status: fail closed. Next: none. Blockers: none. Confidence: subdirectory and unborn fixtures.
function Test-GrokRepository {
  param([string]$Dir)
  $top = Invoke-GrokGit -Dir $Dir -Arguments @('rev-parse','--show-toplevel')
  if ([IO.Path]::GetFullPath($top).TrimEnd('\','/') -ine [IO.Path]::GetFullPath($Dir).TrimEnd('\','/')) {
    throw 'Grok Dir must be the repository toplevel'
  }
  [void](Invoke-GrokGit -Dir $Dir -Arguments @('rev-parse','--verify','HEAD^{commit}'))
}

# Intent: an untracked nested repository cannot be copied file-by-file. Status: fail closed before launch. Next: none. Blockers: none. Confidence: directory entry from ls-files.
function Assert-GrokNoNestedRepository {
  param([string]$Dir)
  $raw = Invoke-GrokGit -Dir $Dir -Arguments @('-c','core.quotepath=false','ls-files','--others','--exclude-standard','-z')
  foreach ($relative in @(Get-GrokNulFields $raw)) {
    $trimmed = $relative.TrimEnd('/','\')
    try { $isFolder = [IO.Directory]::Exists((Join-GrokChildPath -Root $Dir -Relative $trimmed)) }
    catch [IO.PathTooLongException] { throw "path too long: $trimmed" }
    if ($isFolder) {
      throw "untracked nested git repository: $trimmed"
    }
  }
}

# Intent: unregister discarded worktrees and prune on every removal. Status: shared cleanup. Next: none. Blockers: none. Confidence: applied fixture.
function Remove-GrokWorktree {
  param([string]$Dir, [string]$WorktreeDir)
  try { [void](Invoke-GrokGit -Dir $Dir -Arguments @('worktree','remove','--force','--', $WorktreeDir)) }
  finally { [void](Invoke-GrokGit -Dir $Dir -Arguments @('worktree','prune')) }
}

# Intent: byte-exact file transport between Dir and the Grok worktree; git only lists paths. Status: K5d engine. Next: host smoke test. Blockers: none. Confidence: autocrlf true/false fixtures.
# Every file byte moves through [IO.File] or FileStream; git never converts content for setup, bring-back or undo.

# Intent: one ordinal (case-sensitive) path map for every path set (A4). Status: shared helper. Next: none. Blockers: none. Confidence: case-rename fixture.
function New-GrokPathMap {
  param([switch]$IgnoreCase)
  $comparer = if ($IgnoreCase) { [StringComparer]::OrdinalIgnoreCase } else { [StringComparer]::Ordinal }
  return ,(New-Object 'System.Collections.Generic.Dictionary[string,object]' ($comparer))
}

function Convert-GrokHashHex {
  param([byte[]]$Bytes)
  return ([BitConverter]::ToString($Bytes) -replace '-', '').ToLowerInvariant()
}

# Intent: one streamed SHA256 per file. Status: shared helper. Next: none. Blockers: none. Confidence: byte fixtures.
function Get-GrokFileSha256 {
  param([string]$Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  $stream = $null
  try {
    $stream = [IO.File]::OpenRead($Path)
    return (Convert-GrokHashHex $sha.ComputeHash($stream))
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $sha.Dispose()
  }
}

# Intent: copy bytes into a NEW file and hash them in the same pass. Status: shared by temp writes and undo blobs. Next: none. Blockers: none. Confidence: binary fixture.
function Copy-GrokFileHashed {
  param([string]$Source, [string]$Destination)
  $sha = [Security.Cryptography.SHA256]::Create()
  $in = $null; $out = $null
  try {
    # T7: share ReadWrite|Delete so a file another program holds open for writing (a live log) can still be copied; the hash is of the bytes actually written.
    $in = New-Object IO.FileStream($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $out = New-Object IO.FileStream($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $buffer = New-Object byte[] 81920
    while (($read = $in.Read($buffer, 0, $buffer.Length)) -gt 0) {
      [void]$sha.TransformBlock($buffer, 0, $read, $null, 0)
      $out.Write($buffer, 0, $read)
    }
    [void]$sha.TransformFinalBlock($buffer, 0, 0)
    $out.Flush($true)
    return (Convert-GrokHashHex $sha.Hash)
  } finally {
    if ($null -ne $in) { $in.Dispose() }
    if ($null -ne $out) { $out.Dispose() }
    $sha.Dispose()
  }
}

# Intent: temp files live next to their target so Replace/Move stay on one volume (A8, A9). Status: caller deletes in finally. Next: none. Blockers: none. Confidence: rollback fixture.
function New-GrokTempCopy {
  param([string]$Source, [string]$Folder, [string]$ExpectedSha)
  $temporary = Join-Path $Folder ('.grok-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp')
  $ok = $false
  try {
    $hash = Copy-GrokFileHashed -Source $Source -Destination $temporary
    if ($hash -cne $ExpectedSha) { throw "content changed while copying: $Source" }
    $ok = $true
    return $temporary
  } finally { if (-not $ok -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

# Intent: setup and bring-back never treat the engine's own temp files as content (A9). Status: name filter. Next: none. Blockers: none. Confidence: unit check.
function Test-GrokTempName {
  param([string]$Relative)
  $leaf = ($Relative -split '[\\/]')[-1]
  return ($leaf -match '\A\.grok-.{8}\.tmp\z')
}

# Intent: JSON state files are replaced atomically and written UTF-8 without BOM. Status: shared writer. Next: none. Blockers: none. Confidence: state fixtures.
function Write-GrokJsonFile {
  param([string]$Path, [object]$Value)
  $utf8 = New-Object Text.UTF8Encoding($false)
  $temporary = $Path + '.' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp'
  try {
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 6), $utf8)
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

function Read-GrokJsonFile {
  param([string]$Path)
  return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}

function Test-GrokReadOnly {
  param([string]$Path)
  return (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReadOnly) -ne 0)
}

function Test-GrokFolderEmpty {
  param([string]$Path)
  $entries = [IO.Directory]::EnumerateFileSystemEntries($Path).GetEnumerator()
  try { return (-not $entries.MoveNext()) } finally { $entries.Dispose() }
}

# Intent: true when the folder or any folder between it and the root is a junction or other reparse point (T2). Status: helper. Next: none. Blockers: none. Confidence: Dir junction fixture.
function Test-GrokReparseFolder {
  param([string]$Root, [string]$Relative)
  foreach ($folder in @(@(Get-GrokAncestors $Relative) + @($Relative))) {
    $full = Join-GrokChildPath -Root $Root -Relative $folder
    if ([IO.Directory]::Exists($full) -and (([IO.File]::GetAttributes($full) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $true }
  }
  return $false
}

# Intent: remove only folders that are empty again, deepest first, never the root and never a junction or anything inside one (T2). Status: shared by apply, rollback and undo (A5). Next: none. Blockers: none. Confidence: swap and Dir-junction fixtures.
function Remove-GrokEmptyFolders {
  param([string]$Root, [string[]]$Relative)
  $ordered = @($Relative | Where-Object { $_ } | Sort-Object -Property Length -Descending)
  foreach ($folder in $ordered) {
    try {
      $full = Join-GrokChildPath -Root $Root -Relative $folder
      if (Test-GrokReparseFolder -Root $Root -Relative $folder) { continue }
      if ([IO.Directory]::Exists($full) -and (Test-GrokFolderEmpty $full)) { [IO.Directory]::Delete($full) }
    } catch {} # A folder that cannot be removed only leaves an empty folder behind.
  }
}

# Intent: a crash can leave .grok-????????.tmp files; delete those older than 10 minutes, only in the folders about to be written (F7a); only the engine's own lowercase-hex names (T1); never a path the run's manifest lists (T9; no manifest set = no sweep); an unreadable folder never fails the caller (T6). Status: best effort. Next: none. Blockers: none. Confidence: age and tracked-temp fixtures.
function Remove-GrokStaleTemps {
  param([string]$Root, [string[]]$Relative, [object]$Protected)
  if ($null -eq $Protected) { return }
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $folders = New-GrokPathMap -IgnoreCase
  foreach ($path in @($Relative | Where-Object { $_ })) {
    try { $folders[[IO.Path]::GetDirectoryName((Join-GrokChildPath -Root $Root -Relative $path))] = $true } catch {}
  }
  $cutoff = [DateTime]::UtcNow.AddMinutes(-10)
  foreach ($folder in @($folders.Keys)) {
    try {
      if (-not [IO.Directory]::Exists($folder)) { continue }
      foreach ($file in (New-Object IO.DirectoryInfo($folder)).EnumerateFiles('.grok-*.tmp')) {
        if ($file.Name -cnotmatch '\A\.grok-[0-9a-f]{8}\.tmp\z' -or $file.LastWriteTimeUtc -ge $cutoff) { continue }
        if ($Protected.ContainsKey($file.FullName.Substring($rootFull.Length + 1).Replace('\', '/'))) { continue }
        try { $file.Delete() } catch {}
      }
    } catch {} # T6: access denied or a vanished folder only skips the sweep there.
  }
}

# Intent: every path the run's manifest names (files, aliases, tracked temp-named files) as one case-insensitive set for the sweep (T9). Status: helper. Next: none. Blockers: none. Confidence: tracked-temp fixture.
function Get-GrokProtectedSet {
  param([object]$Manifest)
  $set = New-GrokPathMap -IgnoreCase
  foreach ($file in @($Manifest.files)) { if ($file) { $set[[string]$file.path] = $true } }
  foreach ($alias in @($Manifest.aliases)) { if ($alias) { $set[[string]$alias.path] = $true } }
  foreach ($path in @($Manifest.protected)) { if ($path) { $set[[string]$path] = $true } }
  return ,$set
}

function Get-GrokAncestors {
  param([string]$Relative)
  $parts = @($Relative -split '/')
  $result = @()
  for ($index = 1; $index -lt $parts.Count; $index++) { $result += (($parts[0..($index - 1)]) -join '/') }
  return $result
}

# Intent: one spelling per folder (first seen wins, case-insensitive) so the manifest equals the worktree's on-disk names (F1). Status: setup canonicaliser. Next: none. Blockers: none. Confidence: case-collision fixtures.
function Get-GrokCanonicalPath {
  param([string]$Relative, [object]$Folders)
  $parts = $Relative.Split('/')
  $prefix = ''
  for ($index = 0; $index -lt $parts.Count - 1; $index++) {
    $key = if ($prefix) { $prefix + '/' + $parts[$index] } else { $parts[$index] }
    if ($Folders.ContainsKey($key)) { $prefix = [string]$Folders[$key] } else { $Folders[$key] = $key; $prefix = $key }
  }
  if ($prefix) { return ($prefix + '/' + $parts[-1]) }
  return $parts[-1]
}

# Intent: list Dir's files for the snapshot: tracked (minus gitlinks and paths missing on disk) plus untracked not-ignored, each under one canonical spelling; case-only duplicates become aliases (F1). Status: K5d setup list. Next: none. Blockers: none. Confidence: missing, gitlink, nested and case-collision fixtures.
function Get-GrokSourceFiles {
  param([string]$Dir)
  $paths = New-Object 'System.Collections.Generic.List[string]'
  $aliases = New-Object 'System.Collections.Generic.List[object]'
  $folders = New-GrokPathMap -IgnoreCase
  $files = New-GrokPathMap -IgnoreCase
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  $tracked = New-GrokPathMap
  $protected = New-Object 'System.Collections.Generic.List[string]'
  $staged = Invoke-GrokGit -Dir $Dir -Arguments @('-c','core.quotepath=false','ls-files','-z','--cached','--stage')
  foreach ($record in @(Get-GrokNulFields $staged)) {
    $tab = $record.IndexOf([char]9)
    $space = $record.IndexOf(' ')
    if ($tab -lt 0 -or $space -lt 0) { throw "unexpected ls-files record: $record" }
    if ($record.Substring(0, $space) -eq '160000') { continue }
    $candidates.Add($record.Substring($tab + 1))
    $tracked[$record.Substring($tab + 1)] = $true
  }
  $others = Invoke-GrokGit -Dir $Dir -Arguments @('-c','core.quotepath=false','ls-files','-z','--others','--exclude-standard')
  foreach ($relative in @(Get-GrokNulFields $others)) {
    $trimmed = $relative.TrimEnd('/')
    try { $isFolder = $relative.EndsWith('/') -or [IO.Directory]::Exists((Join-GrokChildPath -Root $Dir -Relative $trimmed)) }
    catch [IO.PathTooLongException] { throw "path too long: $trimmed" }
    if ($isFolder) { throw "untracked nested git repository: $trimmed" }
    $candidates.Add($trimmed)
  }
  foreach ($relative in $candidates) {
    # A9 skip; a TRACKED temp-named file is Line's own and is recorded so the sweep never deletes it (T9).
    if (Test-GrokTempName $relative) { if ($tracked.ContainsKey($relative) -and -not $protected.Contains($relative)) { $protected.Add($relative) }; continue }
    try { $exists = [IO.File]::Exists((Join-GrokChildPath -Root $Dir -Relative $relative)) }
    catch [IO.PathTooLongException] { throw "path too long: $relative" }
    if (-not $exists) { continue }
    $canonical = Get-GrokCanonicalPath -Relative $relative -Folders $folders
    if ($files.ContainsKey($canonical)) {
      # Same physical file under another spelling (or a repeated unmerged stage): keep the first, record the alias.
      $kept = [string]$files[$canonical]
      if ($relative -cne $kept) {
        # T4: in a case-sensitive folder both spellings are real, different files; the engine cannot represent that.
        $keptLeaf = $kept.Split('/')[-1]; $aliasLeaf = $relative.Split('/')[-1]
        if ($keptLeaf -cne $aliasLeaf) {
          $parent = [IO.Path]::GetDirectoryName((Join-GrokChildPath -Root $Dir -Relative $relative))
          $names = @((New-Object IO.DirectoryInfo($parent)).EnumerateFiles() | ForEach-Object { $_.Name })
          if (($names -ccontains $keptLeaf) -and ($names -ccontains $aliasLeaf)) { throw "case-sensitive folder not supported: $relative" }
        }
        $aliases.Add([ordered]@{ path = $relative; canonical = $kept })
      }
      continue
    }
    $files[$canonical] = $canonical
    $paths.Add($canonical)
  }
  return [pscustomobject]@{ paths = $paths; aliases = $aliases.ToArray(); protected = $protected.ToArray() }
}

# Intent: snapshot Line's working tree byte for byte into a no-checkout worktree and record a manifest. Status: K5d setup; one-pass stream copy hashes exactly the bytes written to the worktree copy (supervisor-approved 2026-11-18 over File.Copy + re-read: ~2.5 s vs ~12 s for 1,156 files). Next: host smoke test. Blockers: none. Confidence: autocrlf true/false byte fixtures + manifest-equals-copy test.
function New-GrokWorktree {
  param([string]$Dir, [string]$WorktreeDir, [string]$RunFolder)
  Test-GrokRepository -Dir $Dir
  $root = [IO.Path]::GetFullPath($Dir).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
  foreach ($path in @($WorktreeDir, $RunFolder)) {
    if (([IO.Path]::GetFullPath($path).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Grok run state and worktree must be outside the original working tree'
    }
  }
  Assert-GrokNoNestedRepository -Dir $Dir
  if (Test-Path -LiteralPath $WorktreeDir) { throw 'Grok worktree destination already exists' }
  $manifestPath = Join-Path $RunFolder 'manifest.json'
  $attempted = $false
  try {
    $attempted = $true
    # --no-checkout: git never writes file content; every byte below comes from Dir through one FileStream copy that hashes what it writes.
    [void](Invoke-GrokGit -Dir $Dir -Arguments @('worktree','add','--detach','--no-checkout', $WorktreeDir, 'HEAD'))
    $worktreeFull = [IO.Path]::GetFullPath($WorktreeDir).TrimEnd('\','/')
    $entries = New-Object 'System.Collections.Generic.List[object]'
    $sourceList = Get-GrokSourceFiles -Dir $Dir
    foreach ($relative in $sourceList.paths) {
      try {
        $source = Join-GrokChildPath -Root $Dir -Relative $relative
        $destination = Join-GrokChildPath -Root $worktreeFull -Relative $relative
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $hash = Copy-GrokFileHashed -Source $source -Destination $destination
        # A3: ReadOnly is cleared on the worktree copy only, never in Dir.
        $attributes = [IO.File]::GetAttributes($destination)
        if ($attributes -band [IO.FileAttributes]::ReadOnly) { [IO.File]::SetAttributes($destination, ($attributes -bxor [IO.FileAttributes]::ReadOnly)) }
        $size = (New-Object IO.FileInfo($destination)).Length
        $entries.Add([ordered]@{ path = $relative; sha256 = $hash; size = $size })
      } catch [IO.PathTooLongException] { throw "path too long: $relative" }
    }
    # Cosmetic index so Grok's git status/diff look clean; it never touches file bytes and failures are ignored.
    try { [void](Invoke-GrokGit -Dir $worktreeFull -RepoNewlines -Arguments @('read-tree','HEAD')) } catch {}
    try { [void](Invoke-GrokGit -Dir $worktreeFull -RepoNewlines -Arguments @('update-index','-q','--refresh')) } catch {}
    $manifestValue = [ordered]@{ version = 1; files = $entries.ToArray() }
    if ($sourceList.aliases.Count -gt 0) { $manifestValue.aliases = $sourceList.aliases }
    if ($sourceList.protected.Count -gt 0) { $manifestValue.protected = $sourceList.protected }
    Write-GrokJsonFile -Path $manifestPath -Value $manifestValue
    return [pscustomobject]@{ worktreeDir = $worktreeFull; manifest = [IO.Path]::GetFullPath($manifestPath); count = $entries.Count }
  } catch {
    $reason = $_.Exception.Message
    if ([IO.File]::Exists($manifestPath)) { try { [IO.File]::Delete($manifestPath) } catch {} }
    if ($attempted) {
      try { Remove-GrokWorktree -Dir $Dir -WorktreeDir $WorktreeDir }
      catch { $reason += '; cleanup: ' + $_.Exception.Message }
    }
    throw ($reason -replace '[\r\n]+', ' ')
  }
}

# Intent: exact-case file list of the worktree; the index is never the authority. Reparse points are never followed; they are returned separately (F7c). Status: K5d bring-back. Next: none. Blockers: none. Confidence: case-rename and junction fixtures.
function Get-GrokWorktreeFiles {
  param([string]$Root)
  $set = New-GrokPathMap
  $reparse = New-GrokPathMap -IgnoreCase
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $prefixLength = $rootFull.Length + 1
  $stack = New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push($rootFull)
  while ($stack.Count -gt 0) {
    $folder = $stack.Pop()
    foreach ($entry in (New-Object IO.DirectoryInfo($folder)).EnumerateFileSystemInfos()) {
      if ($entry.Name -eq '.git') { continue }
      $relative = $entry.FullName.Substring($prefixLength).Replace('\', '/')
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { $reparse[$relative] = $true; continue }
      if ($entry -is [IO.DirectoryInfo]) { $stack.Push($entry.FullName) }
      else { $set[$relative] = $true }
    }
  }
  return [pscustomobject]@{ files = $set; reparse = $reparse }
}

# Intent: Windows device names (nul, con, aux, prn, com1-9, lpt1-9, with or without an extension) in any path part (T3). Status: helper. Next: none. Blockers: none. Confidence: nul fixture.
function Test-GrokDeviceName {
  param([string]$Relative)
  foreach ($part in $Relative.Split('/')) {
    if ($part.Split('.')[0].TrimEnd(' ') -match '\A(con|prn|aux|nul|com[1-9]|lpt[1-9])\z') { return $true }
  }
  return $false
}

# Intent: a manifest path at or under a reparse point is never classed as deleted (F7c). Status: helper. Next: none. Blockers: none. Confidence: junction fixture.
function Test-GrokUnderReparse {
  param([string]$Relative, [object]$Reparse)
  if ($Reparse.Count -eq 0) { return $false }
  if ($Reparse.ContainsKey($Relative)) { return $true }
  foreach ($ancestor in @(Get-GrokAncestors $Relative)) { if ($Reparse.ContainsKey($ancestor)) { return $true } }
  return $false
}

# Intent: classify the worker's result against the manifest by hash; untouched files never appear. Status: K5d bring-back. Next: none. Blockers: none. Confidence: per-kind fixtures.
function Get-GrokChangeSet {
  param([string]$WorktreeDir, [object[]]$ManifestFiles)
  $manifest = New-GrokPathMap
  foreach ($file in $ManifestFiles) { $manifest[[string]$file.path] = $file }
  $candidates = New-GrokPathMap
  $folded = New-GrokPathMap -IgnoreCase
  $skipped = New-Object 'System.Collections.Generic.List[object]'
  foreach ($path in $manifest.Keys) { $candidates[$path] = $true; $folded[$path] = $true }
  $cached = Invoke-GrokGit -Dir $WorktreeDir -Arguments @('-c','core.quotepath=false','ls-files','-z','--cached')
  $others = Invoke-GrokGit -Dir $WorktreeDir -Arguments @('-c','core.quotepath=false','ls-files','-z','--others','--exclude-standard')
  foreach ($relative in @(Get-GrokNulFields $cached)) { $candidates[$relative] = $true; $folded[$relative] = $true }
  foreach ($relative in @(Get-GrokNulFields $others)) {
    # A10: a directory entry (the worker ran git init) is never recursed or copied.
    if ($relative.EndsWith('/')) { $skipped.Add([pscustomobject][ordered]@{ path = $relative.TrimEnd('/'); reason = 'nested repository' }); continue }
    $candidates[$relative] = $true; $folded[$relative] = $true
  }
  $listing = Get-GrokWorktreeFiles -Root $WorktreeDir
  $actual = $listing.files
  # A file whose name differs only in case from a git-known path is that path renamed (git folds case, the disk does not).
  foreach ($relative in @($actual.Keys)) {
    if (-not $candidates.ContainsKey($relative) -and $folded.ContainsKey($relative)) { $candidates[$relative] = $true }
  }
  $keys = [string[]]@($candidates.Keys)
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $changed = @(); $added = @(); $deleted = @()
  foreach ($relative in $keys) {
    if (Test-GrokTempName $relative) { continue }
    $inManifest = $manifest.ContainsKey($relative)
    $isFile = $actual.ContainsKey($relative)
    if ($inManifest -and $isFile) {
      $full = Join-GrokChildPath -Root $WorktreeDir -Relative $relative
      $post = Get-GrokFileSha256 $full
      if ($post -cne [string]$manifest[$relative].sha256) {
        $changed += [pscustomobject]@{ path = $relative; pre = [string]$manifest[$relative].sha256; post = $post; source = $full }
      }
    } elseif ($inManifest -and (Test-GrokUnderReparse -Relative $relative -Reparse $listing.reparse)) {
      $skipped.Add([pscustomobject][ordered]@{ path = $relative; reason = 'reparse point' })
    } elseif ($inManifest) {
      $deleted +=[pscustomobject]@{ path = $relative; pre = [string]$manifest[$relative].sha256; post = $null; source = $null }
    } elseif ($isFile) {
      # T3: a worker file Windows cannot address normally (device name, escaping path) is skipped, never fatal.
      $full = $null
      if (-not (Test-GrokDeviceName $relative)) {
        try { $full = Join-GrokChildPath -Root $WorktreeDir -Relative $relative } catch { $full = $null }
      }
      if ($null -eq $full) { $skipped.Add([pscustomobject][ordered]@{ path = $relative; reason = 'unsupported path' }); continue }
      $added += [pscustomobject]@{ path = $relative; pre = $null; post = (Get-GrokFileSha256 $full); source = $full }
    }
  }
  return [pscustomobject]@{ changed = $changed; added = $added; deleted = $deleted; skipped = $skipped.ToArray() }
}

# Intent: one place answers "does Dir still hold the expected bytes" (null = no file). Status: re-check before every write. Next: none. Blockers: none. Confidence: race fixture overrides it.
function Test-GrokTargetState {
  param([string]$Target, [AllowNull()][string]$Sha)
  if ([string]::IsNullOrEmpty($Sha)) { return (-not [IO.File]::Exists($Target)) }
  if (-not [IO.File]::Exists($Target)) { return $false }
  return ((Get-GrokFileSha256 $Target) -ceq $Sha)
}

# Intent: no write starts unless every touched Dir path still matches the snapshot. Status: K5d conflict gate. Next: none. Blockers: none. Confidence: conflict fixtures.
function Get-GrokConflicts {
  param([string]$Dir, [object]$Changes)
  $conflicts = New-Object 'System.Collections.Generic.List[string]'
  $deletedFolded = New-GrokPathMap -IgnoreCase
  foreach ($item in @($Changes.deleted)) { $deletedFolded[$item.path] = $true }
  foreach ($item in @(@($Changes.changed) + @($Changes.deleted))) {
    $target = Join-GrokChildPath -Root $Dir -Relative $item.path
    if (-not (Test-GrokTargetState -Target $target -Sha $item.pre)) { $conflicts.Add($item.path) }
  }
  foreach ($item in @($Changes.added)) {
    $target = Join-GrokChildPath -Root $Dir -Relative $item.path
    $blocked = $false
    # A4: an added path equal to a deleted path ignoring case is a case rename; its delete runs first.
    if (-not $deletedFolded.ContainsKey($item.path) -and [IO.File]::Exists($target)) { $blocked = $true }
    if ([IO.Directory]::Exists($target)) {
      foreach ($inner in [IO.Directory]::EnumerateFiles($target, '*', [IO.SearchOption]::AllDirectories)) {
        $innerRelative = $item.path + '/' + $inner.Substring($target.Length + 1).Replace('\', '/')
        if (-not $deletedFolded.ContainsKey($innerRelative)) { $blocked = $true; break }
      }
    }
    foreach ($ancestor in @(Get-GrokAncestors $item.path)) {
      if ([IO.File]::Exists((Join-GrokChildPath -Root $Dir -Relative $ancestor)) -and -not $deletedFolded.ContainsKey($ancestor)) { $blocked = $true }
    }
    if ($blocked) { $conflicts.Add($item.path) }
  }
  return $conflicts.ToArray()
}

# Intent: put one Dir path back to its pre-run bytes only when it still holds this run's bytes. Status: shared by rollback and -Undo (A2, A3). Next: none. Blockers: none. Confidence: undo fixtures.
function Restore-GrokUndoEntry {
  param([string]$Dir, [string]$UndoDir, [object]$Entry, [string[]]$CreatedDirs = @())
  $target = Join-GrokChildPath -Root $Dir -Relative ([string]$Entry.path)
  $existedBefore = [bool]$Entry.existedBefore
  $exists = [IO.File]::Exists($target)
  $current = if ($exists) { Get-GrokFileSha256 $target } else { $null }
  if ((-not $existedBefore -and -not $exists) -or ($existedBefore -and $exists -and $current -ceq [string]$Entry.preSha256)) {
    return [pscustomobject]@{ status = 'restored'; reason = '' }
  }
  $atPost = if ([string]::IsNullOrEmpty([string]$Entry.postSha256)) { -not $exists } else { $exists -and $current -ceq [string]$Entry.postSha256 }
  if (-not $atPost) {
    $why = if (-not $exists -and [IO.Directory]::Exists($target)) { 'path is a directory' } else { 'changed after the run' }
    return [pscustomobject]@{ status = 'skipped'; reason = $why }
  }
  if ($exists -and (Test-GrokReadOnly $target)) { return [pscustomobject]@{ status = 'skipped'; reason = 'read-only' } }
  if (-not $existedBefore) {
    [IO.File]::Delete($target)
    return [pscustomobject]@{ status = 'restored'; reason = '' }
  }
  if ([IO.Directory]::Exists($target)) {
    if (([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return [pscustomobject]@{ status = 'skipped'; reason = 'path is a junction' } }
    # F2: a file that became a deeper folder tree: first drop the run's own now-empty sub-folders, deepest first.
    $prefix = [string]$Entry.path + '/'
    Remove-GrokEmptyFolders -Root $Dir -Relative ([string[]]@($CreatedDirs | Where-Object { $_ -and $_.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }))
    if (-not (Test-GrokFolderEmpty $target)) { return [pscustomobject]@{ status = 'skipped'; reason = 'path is a directory' } }
    [IO.Directory]::Delete($target)
  }
  $folder = [IO.Path]::GetDirectoryName($target)
  [void][IO.Directory]::CreateDirectory($folder)
  $temporary = $null
  try {
    $temporary = New-GrokTempCopy -Source (Join-Path $UndoDir ([string]$Entry.blob)) -Folder $folder -ExpectedSha ([string]$Entry.preSha256)
    if ($exists) { [IO.File]::Replace($temporary, $target, [NullString]::Value) } else { [IO.File]::Move($temporary, $target) }
  } finally { if ($null -ne $temporary -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
  return [pscustomobject]@{ status = 'restored'; reason = '' }
}

# Intent: undo the entries this apply wrote, newest first, then drop folders it created (A5). Status: rollback path. Next: none. Blockers: none. Confidence: read-only fixture.
function Invoke-GrokRollback {
  param([string]$Dir, [string]$UndoDir, [object[]]$Entries, [string[]]$CreatedDirs)
  $unrestored = @()
  for ($index = $Entries.Count - 1; $index -ge 0; $index--) {
    $entry = $Entries[$index]
    try { $result = Restore-GrokUndoEntry -Dir $Dir -UndoDir $UndoDir -Entry $entry -CreatedDirs $CreatedDirs }
    catch { $result = [pscustomobject]@{ status = 'skipped'; reason = $_.Exception.Message } }
    if ($result.status -ne 'restored') { $unrestored += [string]$entry.path }
  }
  Remove-GrokEmptyFolders -Root $Dir -Relative $CreatedDirs
  return $unrestored
}

# Intent: bring the worker's files back byte for byte with a conflict gate, an undo bundle first, atomic writes and rollback. Status: K5d replaces git diff/apply. Next: host smoke test. Blockers: none. Confidence: fixture matrix x autocrlf true/false.
function New-GrokApplyResult {
  param([string]$RunFolder)
  $run = Read-GrokJsonFile (Join-Path $RunFolder 'run.json')
  if ($run.engine -ne 'grok' -or [string]::IsNullOrWhiteSpace([string]$run.dir) -or [string]::IsNullOrWhiteSpace([string]$run.worktreeDir) -or [string]::IsNullOrWhiteSpace([string]$run.manifest)) {
    throw 'invalid Grok run metadata'
  }
  $dir = [string]$run.dir
  $worktree = [string]$run.worktreeDir
  $runId = if ($run.runId) { [string]$run.runId } else { Split-Path -Leaf $RunFolder }
  $manifest = Read-GrokJsonFile ([string]$run.manifest)
  if ($manifest.version -ne 1 -or $null -eq $manifest.PSObject.Properties['files']) { throw 'invalid Grok manifest' }
  $changes = Get-GrokChangeSet -WorktreeDir $worktree -ManifestFiles @($manifest.files)
  $skipped = @($changes.skipped)
  # F3: [Array]::Sort(keys, items) does not reorder items in PS 5.1; sort the keys alone and rebuild.
  $writeMap = New-GrokPathMap
  foreach ($item in @(@($changes.changed) + @($changes.added))) { $writeMap[[string]$item.path] = $item }
  $writeKeys = [string[]]@($writeMap.Keys)
  [Array]::Sort($writeKeys, [StringComparer]::Ordinal)
  $writeArray = [object[]]@($writeKeys | ForEach-Object { $writeMap[$_] })
  $deletes = [object[]]@($changes.deleted)
  $keepWorktree = $skipped.Count -gt 0
  if ($writeArray.Count -eq 0 -and $deletes.Count -eq 0) {
    $body = [ordered]@{ status = 'empty' }
    if ($keepWorktree) { $body.skipped = $skipped }
    else {
      $reason = Remove-GrokWorktreeChecked -Dir $dir -WorktreeDir $worktree
      if ($reason) { $body.cleanupReason = $reason }
    }
    return [pscustomobject]@{ Body = $body; Code = 0 }
  }
  $conflicts = @(Get-GrokConflicts -Dir $dir -Changes $changes)
  if ($conflicts.Count -gt 0) {
    return [pscustomobject]@{ Body = [ordered]@{ status = 'conflict'; conflicts = $conflicts; reason = ('Dir changed during the run: {0} path(s)' -f $conflicts.Count) }; Code = 77 }
  }
  # A5 order: deletes first, then changed/added; both in ordinal path order.
  $operations = @($deletes) + @($writeArray)
  $createdDirs = New-GrokPathMap -IgnoreCase
  foreach ($item in $writeArray) {
    foreach ($ancestor in @(Get-GrokAncestors $item.path)) {
      if (-not [IO.Directory]::Exists((Join-GrokChildPath -Root $dir -Relative $ancestor))) { $createdDirs[$ancestor] = $true }
    }
  }
  $createdList = [string[]]@($createdDirs.Keys)
  # Undo bundle before the first Dir write (criterion 4).
  $undoDir = Join-Path $RunFolder 'undo'
  if (Test-Path -LiteralPath $undoDir) { throw 'undo bundle already exists' }
  [void][IO.Directory]::CreateDirectory((Join-Path $undoDir 'files'))
  $entries = @()
  for ($index = 0; $index -lt $operations.Count; $index++) {
    $item = $operations[$index]
    $existedBefore = -not [string]::IsNullOrEmpty($item.pre)
    $blob = $null
    if ($existedBefore) {
      $blob = 'files/{0}.bin' -f $index
      $blobHash = Copy-GrokFileHashed -Source (Join-GrokChildPath -Root $dir -Relative $item.path) -Destination (Join-Path $undoDir $blob)
      if ($blobHash -cne $item.pre) {
        return [pscustomobject]@{ Body = [ordered]@{ status = 'conflict'; conflicts = @($item.path); reason = 'Dir changed while saving undo data' }; Code = 77 }
      }
    }
    $entries += [pscustomobject][ordered]@{ path = $item.path; existedBefore = $existedBefore; preSha256 = $item.pre; postSha256 = $item.post; blob = $blob }
  }
  $undoPath = Join-Path $undoDir 'undo.json'
  $bundle = [ordered]@{ version = 1; runId = $runId; dir = $dir; state = 'pending'; createdDirs = $createdList; entries = $entries }
  Write-GrokJsonFile -Path $undoPath -Value $bundle
  Remove-GrokStaleTemps -Root $dir -Relative ([string[]]@($operations | ForEach-Object { $_.path })) -Protected (Get-GrokProtectedSet $manifest)
  $done = @()
  $failure = $null
  $failureStatus = 'error'
  $current = $null
  try {
    for ($index = 0; $index -lt $operations.Count; $index++) {
      $item = $operations[$index]
      $current = $entries[$index]
      $target = Join-GrokChildPath -Root $dir -Relative $item.path
      if (-not (Test-GrokTargetState -Target $target -Sha $item.pre)) { $failureStatus = 'conflict'; throw "Dir changed during apply: $($item.path)" }
      if ($null -eq $item.post) {
        if (Test-GrokReadOnly $target) { throw "target is read-only: $($item.path)" }
        [IO.File]::Delete($target)
        $done += $current
        if ($index -eq $deletes.Count - 1) {
          # After the last delete: remove folders the deletes left empty, never Dir itself.
          $emptied = @()
          foreach ($deletedItem in $deletes) { $emptied += @(Get-GrokAncestors $deletedItem.path) }
          Remove-GrokEmptyFolders -Root $dir -Relative $emptied
        }
        continue
      }
      if ($null -ne $item.pre -and (Test-GrokReadOnly $target)) { throw "target is read-only: $($item.path)" }
      $folder = [IO.Path]::GetDirectoryName($target)
      [void][IO.Directory]::CreateDirectory($folder)
      $temporary = $null
      try {
        $temporary = New-GrokTempCopy -Source $item.source -Folder $folder -ExpectedSha $item.post
        if ($null -ne $item.pre) { [IO.File]::Replace($temporary, $target, [NullString]::Value) } else { [IO.File]::Move($temporary, $target) }
      } finally { if ($null -ne $temporary -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
      $done += $current
    }
  } catch {
    $failure = ($_.Exception.Message -replace '[\r\n]+', ' ')
  }
  if ($null -ne $failure) {
    $rollbackEntries = @($done)
    # An 'error' write may still have landed; a 'conflict' path belongs to someone else and is never touched.
    if ($failureStatus -eq 'error' -and $null -ne $current -and ($done -notcontains $current)) { $rollbackEntries += $current }
    $unrestored = @(Invoke-GrokRollback -Dir $dir -UndoDir $undoDir -Entries $rollbackEntries -CreatedDirs $createdList)
    $bundle.state = if ($unrestored.Count -gt 0) { 'failed' } else { 'rolled-back' }
    try { Write-GrokJsonFile -Path $undoPath -Value $bundle } catch {}
    $body = [ordered]@{ status = $failureStatus; reason = $failure; undo = $undoPath }
    if ($failureStatus -eq 'conflict') { $body.conflicts = @($current.path) }
    if ($unrestored.Count -gt 0) { $body.unrestored = $unrestored }
    if ($skipped.Count -gt 0) { $body.skipped = $skipped }
    return [pscustomobject]@{ Body = $body; Code = 77 }
  }
  # F5: every Dir write landed; a failed state write must not turn that into 'error'. The bundle stays 'pending' on disk, which -Undo <runId> accepts.
  $stateWarning = $null
  $bundle.state = 'applied'
  try { Write-GrokJsonFile -Path $undoPath -Value $bundle }
  catch { $stateWarning = 'undo state write failed (bundle left pending; -Undo <runId> still works): ' + ($_.Exception.Message -replace '[\r\n]+', ' ') }
  $body = [ordered]@{ status = 'applied'; files = [string[]]@($writeArray | ForEach-Object { $_.path }); deleted = [string[]]@($deletes | ForEach-Object { $_.path }); undo = $undoPath }
  if ($stateWarning) { $body.warning = $stateWarning }
  if ($keepWorktree) { $body.skipped = $skipped }
  else {
    $reason = Remove-GrokWorktreeChecked -Dir $dir -WorktreeDir $worktree
    if ($reason) { $body.cleanupReason = $reason }
  }
  return [pscustomobject]@{ Body = $body; Code = 0 }
}

# Intent: pick the newest applied, undoable Grok run, optionally for one Dir (A7). Status: K5d -Undo last. Next: none. Blockers: none. Confidence: two-run fixture.
function Get-GrokUndoCandidate {
  param([string]$RunsDir, [string]$Dir = '')
  if (-not (Test-Path -LiteralPath $RunsDir)) { return '' }
  $names = [string[]]@(Get-ChildItem -LiteralPath $RunsDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -cmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z' } | ForEach-Object { $_.Name })
  [Array]::Sort($names, [StringComparer]::Ordinal)
  [Array]::Reverse($names)
  $wanted = if ($Dir) { [IO.Path]::GetFullPath($Dir).TrimEnd('\','/') } else { '' }
  foreach ($name in $names) {
    $folder = Join-Path $RunsDir $name
    try {
      $run = Read-GrokJsonFile (Join-Path $folder 'run.json')
      if ($run.engine -ne 'grok') { continue }
      if ($wanted -and -not [string]::Equals([IO.Path]::GetFullPath([string]$run.dir).TrimEnd('\','/'), $wanted, [StringComparison]::OrdinalIgnoreCase)) { continue }
      if ((Read-GrokJsonFile (Join-Path $folder 'apply.json')).status -ne 'applied') { continue }
      if ((Read-GrokJsonFile (Join-Path $folder 'undo\undo.json')).state -ne 'applied') { continue }
      return $name
    } catch {} # Runs without readable state are not candidates.
  }
  return ''
}

# Intent: reverse an applied Grok run file by file, skipping anything Line changed since. Status: K5d -Undo. Next: host check. Blockers: none. Confidence: undo fixtures.
function Invoke-GrokUndo {
  param([string]$RunFolder)
  $undoDir = Join-Path $RunFolder 'undo'
  $undoPath = Join-Path $undoDir 'undo.json'
  if (-not (Test-Path -LiteralPath $undoPath)) { Write-Host 'grok undo: no undo bundle'; return 2 }
  $bundle = Read-GrokJsonFile $undoPath
  switch ([string]$bundle.state) {
    'undone' { Write-Host 'grok undo: already undone'; return 0 }
    'rolled-back' { Write-Host 'grok undo: nothing to undo (the apply was rolled back)'; return 0 }
  }
  if (@('applied','partial','pending','failed') -notcontains [string]$bundle.state) { Write-Host "grok undo: unknown bundle state '$($bundle.state)'"; return 2 }
  $dir = [string]$bundle.dir
  # F7b: never recreate a Dir that is gone.
  if ([string]::IsNullOrWhiteSpace($dir) -or -not [IO.Directory]::Exists($dir)) { Write-Host "grok undo: Dir no longer exists: $dir"; return 2 }
  $protectedSet = $null
  try { $protectedSet = Get-GrokProtectedSet (Read-GrokJsonFile ([string](Read-GrokJsonFile (Join-Path $RunFolder 'run.json')).manifest)) } catch {} # No readable manifest: no sweep.
  Remove-GrokStaleTemps -Root $dir -Relative ([string[]]@(@($bundle.entries) | ForEach-Object { $_.path })) -Protected $protectedSet
  $earlier = New-GrokPathMap
  $resultPath = Join-Path $undoDir 'undo-result.json'
  if ([string]$bundle.state -eq 'partial' -and (Test-Path -LiteralPath $resultPath)) {
    try { foreach ($path in @((Read-GrokJsonFile $resultPath).restored)) { if ($path) { $earlier[[string]$path] = $true } } } catch {}
  }
  $restored = @(); $skipped = @()
  $entries = @($bundle.entries)
  for ($index = $entries.Count - 1; $index -ge 0; $index--) {
    $entry = $entries[$index]
    $path = [string]$entry.path
    if ($earlier.ContainsKey($path)) { $restored += $path; Write-Host "restored: $path (earlier undo)"; continue }
    try { $result = Restore-GrokUndoEntry -Dir $dir -UndoDir $undoDir -Entry $entry -CreatedDirs ([string[]]@($bundle.createdDirs)) }
    catch { $result = [pscustomobject]@{ status = 'skipped'; reason = ($_.Exception.Message -replace '[\r\n]+', ' ') } }
    if ($result.status -eq 'restored') { $restored += $path; Write-Host "restored: $path" }
    else { $skipped += [pscustomobject][ordered]@{ path = $path; reason = $result.reason }; Write-Host "skipped: $path ($($result.reason))" }
  }
  Remove-GrokEmptyFolders -Root $dir -Relative ([string[]]@($bundle.createdDirs))
  Write-GrokJsonFile -Path $resultPath -Value ([ordered]@{ restored = [string[]]$restored; skipped = [object[]]$skipped })
  $bundle.state = if ($skipped.Count -gt 0) { 'partial' } else { 'undone' }
  Write-GrokJsonFile -Path $undoPath -Value $bundle
  Write-Host ('grok undo: {0} restored, {1} skipped' -f $restored.Count, $skipped.Count)
  if ($skipped.Count -gt 0) { return 79 }
  return 0
}

# Intent: parse structured Grok telemetry, never answer text. Status: last sessionId wins. Next: none. Blockers: none. Confidence: noisy JSONL fixture.
function Get-GrokSessionId {
  param([string]$LogPath)
  $session = 'unknown'
  if (-not (Test-Path -LiteralPath $LogPath)) { return $session }
  foreach ($line in [IO.File]::ReadLines($LogPath)) {
    try {
      $event = $line | ConvertFrom-Json -ErrorAction Stop
      if ($event.sessionId -is [string] -and -not [string]::IsNullOrWhiteSpace($event.sessionId)) { $session = $event.sessionId }
    } catch {} # Non-JSON and partial lines are not session evidence.
  }
  return $session
}

# Intent: observations replay the durable result without applying again (A12 wording); a crash mid-apply is flagged so Line runs -Undo (F4). Status: read only. Next: host attach check. Blockers: none. Confidence: marker fixtures.
function Write-GrokApplyResult {
  param([string]$RunFolder)
  $path = Join-Path $RunFolder 'apply.json'
  if (-not (Test-Path -LiteralPath $path)) { return }
  $runId = Split-Path -Leaf $RunFolder
  try { $meta = [IO.File]::ReadAllText((Join-Path $RunFolder 'run.json')) | ConvertFrom-Json; if ($meta.runId) { $runId = [string]$meta.runId } } catch {}
  $result = $null
  try { $result = [IO.File]::ReadAllText($path) | ConvertFrom-Json } catch {}
  $undoState = $null
  try { $undoState = [string]([IO.File]::ReadAllText((Join-Path $RunFolder 'undo\undo.json')) | ConvertFrom-Json).state } catch {}
  if (($null -eq $result -or $result.status -ne 'applied') -and @('pending','failed') -contains $undoState) {
    Write-Host "grok patch: INCOMPLETE APPLY - run codex-do.ps1 -Undo $runId"
  }
  if ($null -eq $result) { return } # A claimed but incomplete marker is not a completed result.
  try {
    switch ($result.status) {
      'applied' {
        $line = "grok patch: applied $(@($result.files).Count) file(s)"
        if (@($result.deleted).Count -gt 0) { $line += ", deleted $(@($result.deleted).Count)" }
        Write-Host $line
        foreach ($item in @($result.skipped)) { if ($item) { Write-Host "grok patch: skipped $($item.path) ($($item.reason))" } }
        if ($result.warning) { Write-Host "grok patch: warning $($result.warning)" }
        Write-Host "undo: codex-do.ps1 -Undo $runId"
      }
      'read-only' {
        $line = 'grok read-only: nothing applied'
        $count = @($result.changedPaths | Where-Object { $_ }).Count
        if ($count -gt 0) { $line += " (warning: $count changed path(s) discarded)" }
        if ($result.warning) { $line += " (warning: $($result.warning))" }
        if ($result.cleanupReason) { $line += " (worktree not removed: $($result.cleanupReason))" }
        Write-Host $line
      }
      'empty' {
        Write-Host 'grok patch: empty'
        foreach ($item in @($result.skipped)) { if ($item) { Write-Host "grok patch: skipped $($item.path) ($($item.reason))" } }
      }
      'conflict' {
        foreach ($conflictPath in @($result.conflicts)) { if ($conflictPath) { Write-Host "grok patch: conflict $conflictPath" } }
        if ($result.reason) { Write-Host "grok patch: error $($result.reason)" }
        foreach ($lost in @($result.unrestored)) { if ($lost) { Write-Host "grok patch: NOT RESTORED $lost" } }
        $run = [IO.File]::ReadAllText((Join-Path $RunFolder 'run.json')) | ConvertFrom-Json
        Write-Host "grok patch: CONFLICT - kept $($run.worktreeDir)"
      }
      'error' {
        Write-Host "grok patch: error $($result.reason)"
        foreach ($lost in @($result.unrestored)) { if ($lost) { Write-Host "grok patch: NOT RESTORED $lost" } }
        $run = [IO.File]::ReadAllText((Join-Path $RunFolder 'run.json')) | ConvertFrom-Json
        if ($run.worktreeDir) { Write-Host "grok patch: ERROR - kept $($run.worktreeDir)" }
      }
      'skipped' {
        $run = [IO.File]::ReadAllText((Join-Path $RunFolder 'run.json')) | ConvertFrom-Json
        Write-Host "grok patch: SKIPPED ($($result.reason)) - kept $($run.worktreeDir)"
      }
    }
  } catch {} # Missing run.json only shortens the replay.
}

function Write-GrokExitCode {
  param([string]$RunFolder, [int]$Code)
  $exitPath = Join-Path $RunFolder 'exit.txt'
  $temporary = Join-Path $RunFolder ('exit-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $utf8 = New-Object Text.UTF8Encoding($false)
  try {
    [IO.File]::WriteAllText($temporary, ("{0}`n" -f $Code), $utf8)
    try { [IO.File]::Move($temporary, $exitPath) }
    catch [IO.IOException] { if (-not (Test-Path -LiteralPath $exitPath)) { throw } }
  } finally { if (Test-Path -LiteralPath $temporary) { [IO.File]::Delete($temporary) } }
}

# Intent: one wrapper owns bring-back through exit publication; a non-zero Grok exit never applies. Status: CreateNew claim; K5d byte engine. Next: host lifecycle checks. Blockers: none. Confidence: applied, empty, skipped, error, and conflict fixtures.
function Invoke-GrokBringBack {
  param([string]$RunFolder, [int]$GrokExit)
  $marker = Join-Path $RunFolder 'apply.json'
  $claim = $null
  $claimed = $false
  $code = 77
  try {
    try { $claim = [IO.File]::Open($marker, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None); $claimed = $true }
    catch [IO.IOException] { if (Test-Path -LiteralPath $marker) { return }; throw }
    $utf8 = New-Object Text.UTF8Encoding($false)
    $payload = $null
    $built = $null
    try {
      # Intent: K6a G3 - a read-only run (run.json sandboxMode read-only) never applies: worktree removed, grok's exit published, no undo bundle. Status: K6a. Next: none. Blockers: none. Confidence: lib fixtures.
      # V1 (K6a touch-up): fail closed - run.json is read with retries; if it still cannot be read the throw lands in the catch below: status error, exit 77, worktree kept, nothing applied.
      $readOnly = [string](Read-GrokRunJson -RunFolder $RunFolder).sandboxMode -eq 'read-only'
      if ($readOnly) {
        $code = $GrokExit
        $payload = New-GrokReadOnlyResult -RunFolder $RunFolder
      } elseif ($GrokExit -ne 0) {
        $code = $GrokExit
        $payload = @{ status = 'skipped'; reason = ('grok exit {0}' -f $GrokExit) }
      } else {
        $built = New-GrokApplyResult -RunFolder $RunFolder
        $code = [int]$built.Code
        $payload = $built.Body
      }
      $bytes = $utf8.GetBytes(($payload | ConvertTo-Json -Depth 6))
      $claim.Write($bytes, 0, $bytes.Length)
      $claim.Flush($true)
    } catch {
      # fix2 G5: the files are already in Dir once status is applied; the CreateNew claim prevents a second apply, so keep 'applied' and Grok's exit.
      $reason = ($_.Exception.Message -replace '[\r\n]+', ' ')
      if ($null -ne $built -and $built.Body.status -eq 'applied') {
        $code = $GrokExit
        $payload = $built.Body
        $payload.warning = 'marker write failed: ' + $reason
      } else {
        $code = 77
        $payload = @{ status = 'error'; reason = $reason }
      }
      try {
        $claim.SetLength(0)
        $bytes = $utf8.GetBytes(($payload | ConvertTo-Json -Depth 6))
        $claim.Write($bytes, 0, $bytes.Length)
        $claim.Flush($true)
      } catch {}
    }
  } catch {
    $code = 77
  } finally { if ($null -ne $claim) { $claim.Dispose() } }
  if (-not $claimed) {
    try { Write-GrokExitCode -RunFolder $RunFolder -Code 77 } catch {}
    return
  }
  # Intent: K6a G8 - -OutFile gets the final answer before exit publication, so a waiting observer finds it. Status: best effort. Next: none. Blockers: none. Confidence: lib fixture.
  try {
    $outFile = [string](Read-GrokJsonFile (Join-Path $RunFolder 'run.json')).outFile
    if ($outFile) { [IO.File]::WriteAllText($outFile, (Get-GrokFinalText -LogPath (Join-Path $RunFolder 'out.log')), (New-Object Text.UTF8Encoding($false))) }
  } catch {} # A missing answer file never changes the run's result.
  try { Write-GrokExitCode -RunFolder $RunFolder -Code $code }
  catch { try { Write-GrokExitCode -RunFolder $RunFolder -Code 77 } catch {}; throw }
  Write-GrokApplyResult -RunFolder $RunFolder
}

# Intent: K6a G3 - the read-only result body: changedPaths (worktree vs manifest, never applied), worktree removed. Status: K6a. Next: none. Blockers: none. Confidence: lib fixtures.
function New-GrokReadOnlyResult {
  param([string]$RunFolder)
  $run = Read-GrokJsonFile (Join-Path $RunFolder 'run.json')
  $body = [ordered]@{ status = 'read-only' }
  try {
    $manifest = Read-GrokJsonFile ([string]$run.manifest)
    $changes = Get-GrokChangeSet -WorktreeDir ([string]$run.worktreeDir) -ManifestFiles @($manifest.files)
    $paths = [string[]]@(@(@($changes.changed) + @($changes.added) + @($changes.deleted)) | Where-Object { $_ } | ForEach-Object { [string]$_.path })
    if ($paths.Count -gt 0) { [Array]::Sort($paths, [StringComparer]::Ordinal); $body.changedPaths = $paths }
  } catch { $body.warning = 'change check failed: ' + ($_.Exception.Message -replace '[\r\n]+', ' ') }
  $reason = Remove-GrokWorktreeChecked -Dir ([string]$run.dir) -WorktreeDir ([string]$run.worktreeDir)
  if ($reason) { $body.cleanupReason = $reason }
  return $body
}

# Intent: K6a - the system-prompt rule grok gets through --rules (Line 2026-11-18: Grok must finish the packet thoroughly; G11 wording). Read-only runs get the short rule (G8).
# Status: K6a. Next: none. Blockers: none. Confidence: probe 1 accepted the text through run.cmd quoting.
function Get-GrokRuleText {
  param([switch]$ReadOnly)
  if ($ReadOnly) { return 'Do not edit any file. Investigate and report findings with file:line evidence; end with a structured report.' }
  return ('You are a worker executing a task packet. Finish every SUCCESS CRITERION completely; never stop at a partial or placeholder solution. ' +
    'Read the files before editing. Run every VALIDATE command and fix failures until they pass or a STOP RULE applies; skip commands marked host-only and list them. ' +
    'Write the tests the packet asks for. Do not edit files outside FILES. If a STOP RULE applies, stop and report the exact blocker instead of guessing. ' +
    'End with a report that lists each criterion with file:line proof and the VALIDATE output tails.')
}

# Intent: K6a G6 - the rule travels on run.cmd's `call` line; cmd expands % and ^ there and " & | < > ! would break the quoting, so they are refused, as are line breaks. Status: K6a. Next: none. Blockers: none. Confidence: unit test per character.
function Assert-GrokRuleText {
  param([string]$Text)
  if ($Text -match '["%^&|<>!\r\n]') { throw 'Grok rule text must not contain " % ^ & | < > ! or a line break' }
}

# Intent: one pure place picks Grok's model, effort and speed flags. K6a (Line 2026-11-18): effort xhigh for every tier unless -Effort is given; --no-subagents, --max-turns 300 and the
# THOROUGH --rules text (one argument); -ReadOnly = --sandbox read-only (advisory on Windows: grok enforces sandboxes only on Linux/macOS) plus a read/search tool allowlist and
# the short rule; -ResumeSession puts --resume <id> first in the plan's args (codex-do puts --prompt-file and --cwd before them; no --fork-session: probe 4 resumed in place; never --restore-code). Status: K6a; tier still unused; -Fast is a no-op.
# Next: host timing check. Blockers: none. Confidence: unit tests + probes 1-6 (2026-11-18).
function Get-GrokLaunchPlan {
  param([string]$Tier = '', [string]$Model = '', [string]$Effort = '', [switch]$Fast, [switch]$ModelGiven, [switch]$EffortGiven, [switch]$ReadOnly, [string]$ResumeSession = '')
  $chosenModel = if ($ModelGiven -and $Model) { $Model } else { 'grok-4.7-build-fast' }
  $chosenEffort = if ($EffortGiven -and $Effort) { $Effort } else { 'xhigh' }
  $rules = Get-GrokRuleText -ReadOnly:$ReadOnly
  Assert-GrokRuleText $rules
  $arguments = @()
  if ($ResumeSession) { $arguments += @('--resume', $ResumeSession) }
  $arguments += @('-m', $chosenModel, '--effort', $chosenEffort, '--output-format', 'streaming-json', '--always-approve')
  if ($ReadOnly) {
    # Supervisor note 2026-11-18: tool ids from ~/.grok/docs/user-guide/14-headless-mode.md (the shell tool is run_terminal_cmd); probe 5 listed only read_file, list_dir, grep plus MCP meta-tools.
    $arguments += @('--sandbox', 'read-only', '--tools', 'read_file,grep,list_dir', '--disallowed-tools', 'run_terminal_cmd,search_replace,write,Agent,use_tool,search_tool')
  } else {
    $arguments += @('--sandbox', 'workspace', '--disallowed-tools', 'Agent,use_tool,search_tool')
  }
  $arguments += @('--max-turns', '300', '--no-auto-update', '--no-plan', '--disable-web-search', '--no-subagents', '--rules', $rules)
  # Intent: K6a supervisor decision 2 - workers run with no MCP tools (Line: lean workers; github__create_or_update_file/push_files/merge are outside effects). Three layers, no tool names listed:
  # the deny rule MCPTool(*) blocks every MCP tool from any source (~/.grok/docs/user-guide/22-permissions-and-safety.md "MCP Rules"; deny wins under --always-approve),
  # use_tool/search_tool (the MCP meta-tools) are removed, and env turns off the Claude/Cursor MCP config scan (26-config-reference.md compat rows); V7: no documented switch exists for project .mcp.json or .grok/config.toml, so those servers may still start but their calls are denied.
  # Status: K6a. Next: none. Blockers: none. Confidence: probe 7 (2026-11-18) listed no MCP tool and no meta-tool; github__get_me could not be called.
  $arguments += @('--deny', 'MCPTool(*)')
  $environment = [ordered]@{ GROK_CLAUDE_MCPS_ENABLED = 'false'; GROK_CURSOR_MCPS_ENABLED = 'false' }
  $sandbox = if ($ReadOnly) { 'read-only' } else { 'workspace' }
  return [pscustomobject]@{ model = $chosenModel; effort = $chosenEffort; args = $arguments; rules = $rules; sandbox = $sandbox; env = $environment }
}

# Intent: K6a G12 - the dispatch echo shows the --rules value cut to 40 characters. Status: K6a. Next: none. Blockers: none. Confidence: unit test.
function Format-GrokArgsEcho {
  param([string[]]$Arguments)
  $shown = New-Object 'System.Collections.Generic.List[string]'
  for ($index = 0; $index -lt $Arguments.Count; $index++) {
    $value = [string]$Arguments[$index]
    if ($index -gt 0 -and $Arguments[$index - 1] -ceq '--rules' -and $value.Length -gt 40) { $value = $value.Substring(0, 40) + '...' }
    $shown.Add($value)
  }
  return ($shown.ToArray() -join ' ')
}

# Intent: K6a G1 - who owns a -Resume session, resolved once before the engine decision: 'last' = the newest run (creation time, then name) for -Dir, any engine;
# a UUID = the newest run whose session.txt equals it (case-insensitive). engine grok in run.json = grok, anything else = codex; no match = unknown.
# Status: K6a. Next: none. Blockers: none. Confidence: fixture run folders.
function Get-GrokResumeOwner {
  param([string]$RunsDir, [string]$Dir, [string]$Resume)
  $none = [pscustomobject]@{ owner = 'unknown'; runId = ''; folder = ''; session = ''; run = $null }
  if (-not $RunsDir -or -not (Test-Path -LiteralPath $RunsDir)) { return $none }
  $wanted = [IO.Path]::GetFullPath($Dir).TrimEnd('\','/')
  $folders = @(Get-ChildItem -LiteralPath $RunsDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -cmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z' } | Sort-Object CreationTimeUtc, Name -Descending)
  foreach ($folder in $folders) {
    try {
      $run = Read-GrokJsonFile (Join-Path $folder.FullName 'run.json')
      $session = ''
      $sessionPath = Join-Path $folder.FullName 'session.txt'
      if ([IO.File]::Exists($sessionPath)) { $session = ([IO.File]::ReadAllText($sessionPath)).Trim() }
      if ($Resume -ceq 'last') {
        if (-not $run.dir -or -not [string]::Equals([IO.Path]::GetFullPath([string]$run.dir).TrimEnd('\','/'), $wanted, [StringComparison]::OrdinalIgnoreCase)) { continue }
      } elseif ($session -ine $Resume) { continue }
      $owner = if ($run.engine -eq 'grok') { 'grok' } else { 'codex' }
      return [pscustomobject]@{ owner = $owner; runId = $folder.Name; folder = $folder.FullName; session = $session; run = $run }
    } catch {} # Unreadable run folders are not evidence.
  }
  return $none
}

# Intent: V1 (K6a touch-up) - run.json through a retrying reader (5 tries, 100 ms apart): a transient sharing violation or a half-written file must not decide a run's fate. Throws after the last try.
# Status: K6a touch-up. Next: none. Blockers: none. Confidence: locked-file fixture.
function Read-GrokRunJson {
  param([string]$RunFolder)
  $path = Join-Path $RunFolder 'run.json'
  for ($attempt = 1; ; $attempt++) {
    try { return (Read-GrokJsonFile $path) }
    catch { if ($attempt -ge 5) { throw }; Start-Sleep -Milliseconds 100 }
  }
}

# Intent: V2 (K6a touch-up) - prepare the prior run's worktree path for a grok resume: prune stale registrations (a folder deleted by hand), then move a kept worktree
# (left by a finished exit-77 or failed run) aside with `git worktree move` to <path>-kept-<yyyyMMdd-HHmmss>, prune again. The caller checks the prior run has finished.
# Returns the kept path or ''. Status: K6a touch-up. Next: none. Blockers: none. Confidence: kept and registered-but-missing fixtures.
function Initialize-GrokResumeWorktree {
  param([string]$Dir, [string]$WorktreeDir, [string]$Stamp = ([DateTime]::Now.ToString('yyyyMMdd-HHmmss')))
  [void](Invoke-GrokGit -Dir $Dir -Arguments @('worktree','prune'))
  $kept = ''
  if (Test-Path -LiteralPath $WorktreeDir) {
    $kept = $WorktreeDir.TrimEnd('\','/') + '-kept-' + $Stamp
    if (Test-Path -LiteralPath $kept) { throw "kept worktree destination already exists: $kept" }
    [void](Invoke-GrokGit -Dir $Dir -Arguments @('worktree','move', $WorktreeDir, $kept))
    [void](Invoke-GrokGit -Dir $Dir -Arguments @('worktree','prune'))
  }
  return $kept
}

# Intent: K6a G9 - tokens a grok session used: the sum of usage.total_tokens from the final 'end' event of each run whose session.txt equals the session
# (field names from probe 1, grok 1.0.88: end.usage.total_tokens = input + cache read + cache creation + output; V4: a final 'error' event counts too).
# Runs without session.txt are not counted. $null when no run has that number.
# Status: K6a. Next: none. Blockers: none. Confidence: fixture logs.
function Get-GrokSessionTokens {
  param([string]$RunsDir, [string]$Session)
  if (-not $RunsDir -or -not (Test-Path -LiteralPath $RunsDir)) { return $null }
  $total = $null
  foreach ($folder in @(Get-ChildItem -LiteralPath $RunsDir -Directory -ErrorAction SilentlyContinue)) {
    try {
      $sessionPath = Join-Path $folder.FullName 'session.txt'
      if (-not [IO.File]::Exists($sessionPath) -or ([IO.File]::ReadAllText($sessionPath)).Trim() -ine $Session) { continue }
      $logPath = Join-Path $folder.FullName 'out.log'
      if (-not [IO.File]::Exists($logPath)) { continue }
      $last = $null # V4: the final 'end' or 'error' event (an error can still report spend).
      foreach ($line in [IO.File]::ReadLines($logPath)) {
        if (-not ($line.Contains('"end"') -or $line.Contains('"error"'))) { continue }
        try { $event = $line | ConvertFrom-Json -ErrorAction Stop; if (@('end', 'error') -contains [string]$event.type) { $last = $event } } catch {}
      }
      $tokens = 0L
      if ($null -ne $last -and $null -ne $last.usage -and [long]::TryParse([string]$last.usage.total_tokens, [ref]$tokens) -and $tokens -ge 0) {
        if ($null -eq $total) { $total = 0L }
        $total += $tokens
      }
    } catch {} # Unreadable telemetry only lowers the count; the caller warns when nothing is known.
  }
  return $total
}

# Intent: K6a G8 - the final answer for -OutFile: the 'text' deltas after the last tool event in out.log (streaming-json). Status: K6a. Next: none. Blockers: none. Confidence: fixture log.
function Get-GrokFinalText {
  param([string]$LogPath)
  if (-not [IO.File]::Exists($LogPath)) { return '' }
  $builder = New-Object Text.StringBuilder
  foreach ($line in [IO.File]::ReadLines($LogPath)) {
    try { $event = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    if ($event.type -eq 'text' -and $event.data -is [string]) { [void]$builder.Append($event.data) }
    elseif (@('tool_call', 'tool_call_update') -contains [string]$event.type) { [void]$builder.Clear() }
  }
  return $builder.ToString()
}

# ---------------------------------------------------------------------------
# K5e engine swap (Line 2026-11-18: never take Codex while it has quota; move to Grok when it runs out; swap any time).
# Precedence: explicit -Engine codex|grok > env CODEX_DO_ENGINE > <stateDir>\engine.txt > auto. "auto" at any level = the auto rule.
# Auto rule: Codex weekly used (usedPercent, else 100 - left) >= threshold (ontology quota.thresholds.codexUsed3, fallback 95)
# AND (resetsAt in the future, or resetsAt missing and dataTs < 24 h old). Anything missing or unparseable -> codex.
# The status line (statusline-ultrathink.js codexAutoGrok) applies the same rule; keep both in step.
# ---------------------------------------------------------------------------

# Intent: one numeric test for JSON values (ConvertFrom-Json yields int, long, decimal or double). Status: K5e helper. Next: none. Blockers: none. Confidence: unit tests.
function Test-DispatchEngineNumber {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value) { return $false }
  if (-not ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [single])) { return $false }
  $number = [double]$Value
  return -not ([double]::IsNaN($number) -or [double]::IsInfinity($number))
}

# Intent: Codex weekly used % from the status line cache: usedPercent if numeric, else 100 - left; $null when unknown. Status: K5e. Next: none. Blockers: none. Confidence: unit tests.
function Get-CodexWeeklyUsed {
  param([AllowNull()][object]$Cache)
  if ($null -eq $Cache) { return $null }
  try {
    $weekly = $Cache.weekly
    if ($null -eq $weekly) { return $null }
    if (Test-DispatchEngineNumber $weekly.usedPercent) { return [double]$weekly.usedPercent }
    if (Test-DispatchEngineNumber $weekly.left) { return (100 - [double]$weekly.left) }
  } catch {}
  return $null
}

# Intent: U4 - a used % label never contradicts the decision: whole percent, but one decimal when rounding would reach the threshold the raw value misses (94.6 -> "94.6%"). Status: K5e touch-up. Next: none. Blockers: none. Confidence: unit test.
function Format-CodexUsedPercent {
  param([double]$Used, [double]$Threshold = 95)
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $rounded = [math]::Round($Used)
  # One decimal, cut (not rounded) so 94.96 shows 94.9%, never 95.0%.
  if ($rounded -ge $Threshold -and $Used -lt $Threshold) { return (([math]::Floor($Used * 10) / 10).ToString('0.0', $culture) + '%') }
  return ($rounded.ToString('0', $culture) + '%')
}

# Intent: the auto rule as a pure function of the cache, the threshold and the clock (E5: resetsAt epoch seconds or ISO, dataTs ISO, any parse failure -> codex). Status: K5e. Next: none. Blockers: none. Confidence: unit tests.
function Get-CodexQuotaState {
  param([AllowNull()][object]$Cache, [double]$Threshold = 95, [DateTimeOffset]$Now = [DateTimeOffset]::UtcNow)
  $used = Get-CodexWeeklyUsed $Cache
  if ($null -eq $used) {
    $why = if ($null -eq $Cache) { 'no Codex usage data' } else { 'Codex usage data unreadable' }
    return [pscustomobject]@{ grok = $false; used = $null; reason = $why }
  }
  $label = 'Codex weekly {0} used' -f (Format-CodexUsedPercent -Used $used -Threshold $Threshold)
  if ($used -lt $Threshold) { return [pscustomobject]@{ grok = $false; used = $used; reason = $label } }
  $fresh = $false
  try {
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $resets = $Cache.weekly.resetsAt
    if ($null -ne $resets -and -not ($resets -is [string] -and $resets.Length -eq 0)) {
      # U2: a number above 1e11 is already milliseconds (1e11 s is year 5138; 1e11 ms is 1973).
      if (Test-DispatchEngineNumber $resets) {
        $resetMs = [double]$resets; if ($resetMs -le 1e11) { $resetMs = $resetMs * 1000 }
        $resetAt = [DateTimeOffset]::FromUnixTimeMilliseconds([long][math]::Round($resetMs))
      }
      elseif ($resets -is [string]) { $resetAt = [DateTimeOffset]::Parse($resets, $culture) }
      elseif ($resets -is [datetime]) { $resetAt = [DateTimeOffset]$resets }
      else { throw 'unsupported resetsAt' }
      $fresh = $resetAt -gt $Now
    } else {
      $stamp = $Cache.dataTs
      if ($stamp -is [string] -and $stamp.Length -gt 0) { $dataAt = [DateTimeOffset]::Parse($stamp, $culture) }
      elseif ($stamp -is [datetime]) { $dataAt = [DateTimeOffset]$stamp }
      else { throw 'no dataTs' }
      $fresh = ($Now - $dataAt).TotalHours -lt 24
    }
  } catch { $fresh = $false } # Unparseable reset or data time: never switch on old or unknown data.
  if (-not $fresh) { return [pscustomobject]@{ grok = $false; used = $used; reason = "$label, usage data out of date" } }
  return [pscustomobject]@{ grok = $true; used = $used; reason = $label }
}

# Intent: the manual part of the precedence (flag > env > file), no I/O; origin says where an 'auto' came from (for -SetEngine show). Status: K5e. Next: none. Blockers: none. Confidence: precedence matrix.
function Get-DispatchEngineMode {
  param([AllowNull()][AllowEmptyString()][string]$Explicit = '', [AllowNull()][AllowEmptyString()][string]$EnvValue = '', [AllowNull()][AllowEmptyString()][string]$FileValue = '')
  $messages = New-Object 'System.Collections.Generic.List[string]'
  $explicitValue = ([string]$Explicit).Trim().ToLowerInvariant()
  if ($explicitValue -eq 'codex' -or $explicitValue -eq 'grok') {
    return [pscustomobject]@{ mode = $explicitValue; source = 'flag'; origin = 'flag'; reason = "-Engine $explicitValue"; messages = [string[]]@() }
  }
  # E12b: an explicit -Engine auto skips env and file.
  if ($explicitValue -eq 'auto') { return [pscustomobject]@{ mode = 'auto'; source = 'auto'; origin = 'flag'; reason = ''; messages = [string[]]@() } }
  $envText = ([string]$EnvValue).Trim()
  if ($envText) {
    $envMode = $envText.ToLowerInvariant()
    if ($envMode -eq 'codex' -or $envMode -eq 'grok') {
      return [pscustomobject]@{ mode = $envMode; source = 'env'; origin = 'env'; reason = "CODEX_DO_ENGINE=$envMode"; messages = [string[]]@() }
    }
    if ($envMode -eq 'auto') { return [pscustomobject]@{ mode = 'auto'; source = 'auto'; origin = 'env'; reason = ''; messages = [string[]]@() } }
    $messages.Add("codex-do: warning: CODEX_DO_ENGINE='$envText' is not codex, grok or auto; ignored")
  }
  $fileText = ([string]$FileValue).Trim()
  if ($fileText) {
    $fileMode = $fileText.ToLowerInvariant()
    if ($fileMode -eq 'codex' -or $fileMode -eq 'grok') {
      return [pscustomobject]@{ mode = $fileMode; source = 'file'; origin = 'file'; reason = "engine.txt says $fileMode"; messages = $messages.ToArray() }
    }
    if ($fileMode -eq 'auto') { return [pscustomobject]@{ mode = 'auto'; source = 'auto'; origin = 'file'; reason = ''; messages = $messages.ToArray() } }
    $messages.Add("codex-do: warning: engine.txt says '$fileText' (not codex, grok or auto); ignored")
  }
  return [pscustomobject]@{ mode = 'auto'; source = 'auto'; origin = 'default'; reason = ''; messages = $messages.ToArray() }
}

# Intent: K5e criterion 1 - the whole engine decision as one pure function: precedence, auto rule, Critical rule and (K6a) -Resume by session owner.
# I/O only through the explicit -StateDir/-CacheDir/-OntologyPath inputs, used when the matching value is not passed.
# Output: engine codex|grok, source flag|env|file|auto, reason, fellBack, messages (lines to print, in order), exitCode (0 or 2),
# recordSource (U5: what run.json engineSource records - the source, or '<source>-fallback' when a codex-owned or unknown -Resume turned a grok choice into codex).
# K6a G1/G4: -Account/-Attached/-Sandbox never reject or fall back any more. -ResumeOwner ('' = no -Resume) comes from Get-GrokResumeOwner:
# grok -> grok whatever auto/env/file say (exit 2 for -Engine codex; Critical gets the manual-choice warning); codex|unknown -> the K5e Codex path (exit 2 for -Engine grok).
# Status: K6a. Next: host -Resume run. Blockers: none. Confidence: function-level matrix in grok-engine.test.ps1.
function Resolve-DispatchEngine {
  param(
    [AllowNull()][AllowEmptyString()][string]$Explicit = '',
    [AllowNull()][AllowEmptyString()][string]$EnvValue = '',
    [AllowNull()][AllowEmptyString()][string]$FileValue = '',
    [AllowNull()][AllowEmptyString()][string]$Tier = '',
    [AllowNull()][object]$Cache = $null,
    [double]$Threshold = 95,
    [DateTimeOffset]$Now = [DateTimeOffset]::UtcNow,
    [ValidateSet('', 'grok', 'codex', 'unknown')][AllowEmptyString()][string]$ResumeOwner = '',
    [AllowEmptyString()][string]$ResumeLabel = '',  # V5: '<session> from run <runId> <startedUtc>' for the engine line
    [string]$StateDir = '',
    [string]$CacheDir = '',
    [string]$CacheSuffix = '',
    [string]$OntologyPath = ''
  )
  if ($StateDir -and -not $PSBoundParameters.ContainsKey('FileValue')) { $FileValue = Read-DispatchEngineFile -StateDir $StateDir }
  if ($OntologyPath -and -not $PSBoundParameters.ContainsKey('Threshold')) { $Threshold = Get-DispatchEngineThreshold -OntologyPath $OntologyPath }
  $mode = Get-DispatchEngineMode -Explicit $Explicit -EnvValue $EnvValue -FileValue $FileValue
  $messages = New-Object 'System.Collections.Generic.List[string]'
  foreach ($line in @($mode.messages)) { if ($line) { $messages.Add($line) } }
  $critical = ([string]$Tier).Trim() -eq 'Critical'
  $decision = [pscustomobject]@{ engine = 'codex'; source = $mode.source; reason = $mode.reason; fellBack = $false; messages = [string[]]@(); exitCode = 0; recordSource = $mode.source }
  if ($ResumeOwner -eq 'grok') {
    if ($mode.mode -eq 'codex' -and $mode.source -eq 'flag') {
      $messages.Add('codex-do: this -Resume session belongs to grok; -Engine codex cannot resume it')
      $decision.exitCode = 2
    } else {
      $decision.engine = 'grok'; $decision.reason = if ($ResumeLabel) { '-Resume continues grok session ' + $ResumeLabel } else { '-Resume continues the grok session' }
      if ($critical) { $messages.Add("codex-do: warning: Critical packet runs on Grok by manual choice ($($mode.source): -Resume of a grok session)") }
    }
    $decision.messages = $messages.ToArray()
    return $decision
  }
  $resuming = $ResumeOwner -eq 'codex' -or $ResumeOwner -eq 'unknown'
  if ($CacheDir -and $mode.mode -eq 'auto' -and -not $PSBoundParameters.ContainsKey('Cache')) {
    $Cache = Read-CodexUsageCache -Path (Join-Path $CacheDir "codex-usage$CacheSuffix.json")
  }
  if ($mode.mode -ne 'auto') {
    $decision.engine = $mode.mode
    if ($mode.mode -eq 'grok') {
      if ($resuming) {
        if ($mode.source -eq 'flag') {
          if ($ResumeOwner -eq 'codex') { $messages.Add('codex-do: this -Resume session belongs to codex; -Engine grok cannot resume it') }
          else { $messages.Add('codex-do: -Engine grok can only resume a grok session; no grok run records this one') }
          $decision.exitCode = 2
        } else {
          $messages.Add("codex-do: -Resume continues on codex (engine $($mode.source) ignored)")
          $decision.engine = 'codex'; $decision.fellBack = $true; $decision.reason = '-Resume continues on codex'
        }
      } elseif ($critical) {
        $messages.Add("codex-do: warning: Critical packet runs on Grok by manual choice ($($mode.source): $($mode.reason))")
      }
    }
    if ($decision.fellBack) { $decision.recordSource = $mode.source + '-fallback' }
    $decision.messages = $messages.ToArray()
    return $decision
  }
  $quota = Get-CodexQuotaState -Cache $Cache -Threshold $Threshold -Now $Now
  $decision.reason = $quota.reason
  if ($quota.grok) {
    if ($critical) {
      $messages.Add('codex-do: Critical packet stays on Codex; use an Opus subagent if Codex is out')
    } elseif ($resuming) {
      $messages.Add('codex-do: -Resume continues on codex (engine auto ignored)')
      $decision.fellBack = $true
    } else {
      $decision.engine = 'grok'
    }
  }
  if ($decision.fellBack) { $decision.recordSource = 'auto-fallback' }
  $decision.messages = $messages.ToArray()
  return $decision
}
# Intent: the one line a grok decision prints, e.g. "codex-do: engine grok (auto: Codex weekly 96% used)". Status: K5e. Next: none. Blockers: none. Confidence: worked-example test.
function Format-DispatchEngineLine {
  param([object]$Decision)
  return ('codex-do: engine {0} ({1}: {2})' -f $Decision.engine, $Decision.source, $Decision.reason)
}

# Intent: U6 - the reasoning efforts grok accepts. Source: grok 1.0.88 (2fe3608f7398), checked 2026-11-18: `grok --help` lists
# `--reasoning-effort <EFFORT>` [alias --effort] without a value set; the binary's own validation message reads
# "invalid reasoning effort: ... (expected one of: none, minimal, low, medium, high, xhigh, max)". Status: K5e touch-up. Next: re-check on a grok upgrade. Blockers: none. Confidence: one source (binary string).
function Get-GrokEffortValues { return @('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max') }

# Intent: E1/U6 - when grok was not chosen by the flag, a non-grok -Model and an -Effort grok does not accept (Codex-only 'ultra') are ignored with one line; the plan then uses its defaults (build-fast, xhigh since K6a). Status: K5e. Next: none. Blockers: none. Confidence: unit tests.
function Get-GrokOptionPlan {
  param([string]$Source = '', [string]$Model = '', [switch]$ModelGiven, [string]$Effort = '', [switch]$EffortGiven)
  $modelKept = [bool]$ModelGiven; $effortKept = [bool]$EffortGiven
  $ignored = @()
  if ($Source -ne 'flag') {
    $defaults = Get-GrokLaunchPlan # One source for the default model and effort.
    if ($modelKept -and $Model -notlike 'grok*') { $ignored += "-Model $Model (uses $($defaults.model))"; $modelKept = $false }
    if ($effortKept -and (Get-GrokEffortValues) -notcontains $Effort) { $ignored += "-Effort $Effort (uses $($defaults.effort))"; $effortKept = $false }
  }
  $line = if ($ignored.Count -gt 0) { 'codex-do: grok ignores {0}; engine {1}' -f ($ignored -join ', '), $Source } else { '' }
  return [pscustomobject]@{ modelGiven = $modelKept; effortGiven = $effortKept; line = $line }
}

# Intent: engine.txt is one line (codex|grok|auto); a missing or unreadable file reads as ''. Status: K5e. Next: none. Blockers: none. Confidence: unit tests.
function Read-DispatchEngineFile {
  param([string]$StateDir)
  try { return ([IO.File]::ReadAllText((Join-Path $StateDir 'engine.txt'))).Trim() } catch { return '' }
}

# Intent: write engine.txt atomically (temp file in the same folder, then Move or Replace), UTF-8 without BOM, one line.
# Two writers at once: each uses its own temp file; a lost Move/Replace race or a sharing violation retries (40 x 25 ms), the last writer wins.
# Status: K5e. Next: none. Blockers: none. Confidence: concurrent -SetEngine test.
function Write-DispatchEngineFile {
  param([string]$StateDir, [ValidateSet('codex', 'grok', 'auto')][string]$Value)
  [void][IO.Directory]::CreateDirectory($StateDir)
  $path = Join-Path $StateDir 'engine.txt'
  $utf8 = New-Object Text.UTF8Encoding($false)
  for ($attempt = 0; ; $attempt++) {
    $temporary = Join-Path $StateDir ('engine-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp')
    try {
      [IO.File]::WriteAllText($temporary, $Value + "`n", $utf8)
      if ([IO.File]::Exists($path)) { [IO.File]::Replace($temporary, $path, [NullString]::Value) }
      else { [IO.File]::Move($temporary, $path) }
      return $path
    } catch [IO.IOException], [UnauthorizedAccessException] {
      if ($attempt -ge 40) { throw }
      Start-Sleep -Milliseconds 25
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
  }
}

# Intent: threshold source of truth = ontology quota.thresholds.codexUsed3; 95 when missing or unreadable. Status: K5e. Next: none. Blockers: none. Confidence: unit tests.
function Get-DispatchEngineThreshold {
  param([string]$OntologyPath)
  try {
    $value = ([IO.File]::ReadAllText($OntologyPath) | ConvertFrom-Json).quota.thresholds.codexUsed3
    if (Test-DispatchEngineNumber $value) { return [double]$value }
  } catch {}
  return [double]95
}

# Intent: the status line's cache folder (Node os.tmpdir() = TEMP, else TMP); CODEX_DO_USAGE_CACHE_DIR overrides it for tests. Status: K5e. Next: none. Blockers: none. Confidence: dispatcher tests.
function Get-CodexUsageCacheDir {
  if ($env:CODEX_DO_USAGE_CACHE_DIR) { return $env:CODEX_DO_USAGE_CACHE_DIR }
  $temp = if ($env:TEMP) { $env:TEMP } elseif ($env:TMP) { $env:TMP } else { [IO.Path]::GetTempPath() }
  return (Join-Path $temp 'ultrathink-status')
}

# Intent: same cache name as statusline-ultrathink.js codexCacheSuffix: '' for main, else '-' + first 16 hex of SHA-256 (UTF-8) of the account home
# string exactly as Resolve-CodexAccountHome returns it (e.g. C:\Users\ADMIN\.codex-accounts\work). Status: K5e (E7). Next: none. Blockers: none. Confidence: cross-language test.
function Get-CodexUsageCacheSuffix {
  param([string]$AccountName, [string]$AccountHome)
  if ($AccountName -ceq 'main' -or [string]::IsNullOrEmpty($AccountHome)) { return '' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hex = Convert-GrokHashHex $sha.ComputeHash((New-Object Text.UTF8Encoding($false)).GetBytes($AccountHome)) } finally { $sha.Dispose() }
  return ('-' + $hex.Substring(0, 16))
}

function Get-CodexUsageCachePath {
  param([string]$CacheDir, [string]$AccountName, [string]$AccountHome)
  return (Join-Path $CacheDir ('codex-usage{0}.json' -f (Get-CodexUsageCacheSuffix -AccountName $AccountName -AccountHome $AccountHome)))
}

# Intent: U3 - the status line rewrites the cache in place; a file that exists but fails to read or parse is retried once after ~100 ms before it counts as no data. Status: K5e touch-up. Next: none. Blockers: none. Confidence: malformed-file test.
function Read-CodexUsageCache {
  param([string]$Path)
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    if (-not [IO.File]::Exists($Path)) { return $null }
    try { return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json -ErrorAction Stop) }
    catch { if ($attempt -eq 0) { Start-Sleep -Milliseconds 100 } }
  }
  return $null
}
