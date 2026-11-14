$script:reviewOntologyWarnings = @{}
function Get-ReviewDefectCategories {
  param([string]$OntologyPath = (Join-Path $PSScriptRoot '..\ontology\harness.ontology.json'))
  # Intent: share Line's category vocabulary across review ingestion paths. Status: implemented.
  # Next: ontology updates flow through this reader. Blockers: none. Confidence: invalid/locked/fallback fixtures.
  try {
    if (Test-Path -LiteralPath $OntologyPath -PathType Leaf -ErrorAction Stop) {
      $ontology = [IO.File]::ReadAllText($OntologyPath, [Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
      $entries = $ontology.defectCategories
      if ($entries -isnot [array] -or -not $entries.Count) { throw 'Missing category list' }
      $ids = @()
      foreach ($entry in $entries) {
        if ($null -eq $entry -or $entry.id -isnot [string] -or
            $entry.id -cnotmatch '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' -or $ids -ccontains $entry.id) {
          throw 'Invalid category id'
        }
        $ids += $entry.id
      }
      if ($ids -cnotcontains 'other') { throw 'Missing other category' }
      return $ids
    }
  } catch {
    if (-not $script:reviewOntologyWarnings.ContainsKey($OntologyPath)) {
      $script:reviewOntologyWarnings[$OntologyPath] = $true
      [Console]::Error.WriteLine('codex-review: ontology unavailable; using built-in defect categories')
    }
  }
  return @('contradiction','sandbox-validate','salvage-resume','ui-widths','docs-style',
    'encoding','docs-sync','source-of-truth','concurrency','fixture-secret','real-path',
    'formatter-lint','env-tools','scope-creep','ps51-traps','missing-criterion',
    'unverified-claim','logic-bug','other')
}

function Get-ReviewFindings {
  param([AllowEmptyString()][string]$Text)
  # Intent: count finding blocks, excluding zero summaries and repeated severity metadata.
  # Status: retains live severity/location/title fields. Next: supervisor review.
  # Blockers: none. Confidence: format, block and live logger fixtures.
  $counts = [ordered]@{ P0=0; P1=0; P2=0; P3=0 }
  $findings = New-Object 'Collections.Generic.List[object]'
  $active = $null
  $pattern = '(?i)\[(?<severity>P[0-3])\]|\b(?<severity>P[0-3]):|\*\*(?<severity>P[0-3])\*\*|\bSeverity:\s*(?<severity>P[0-3])\b|(?:^|\s)-\s*(?<severity>P[0-3])\s*-|\b(?<severity>P[0-3])\s*\([^)]+\)|^\s*\d+[.)]\s+(?<severity>P[0-3])\s*-|\|\s*(?<severity>P[0-3])\s*\||^\s*#{1,6}\s+(?<severity>P[0-3])\b'
  foreach ($line in ($Text -split '\r?\n')) {
    # Only headers introduce findings; severity references in prose and summaries do not.
    if ($line -notmatch '(?i)^\s*(?:(?:[-*]|\d+[.)]|#{1,6})\s+)*(?:\|\s*)?(?:\[P[0-3]\]|\*\*P[0-3]\*\*|P[0-3]\b|(?:\*\*)?Severity:)') {
      if ($line -match '^\s*#{1,6}\s+|^\s*\d+[.)]\s+') { $active = $null }
      continue
    }
    $labels = @(
      foreach ($match in [regex]::Matches($line, $pattern)) {
        $label = $match.Groups['severity']
        $before = $line.Substring(0, $label.Index)
        $after = $line.Substring($label.Index + $label.Length) -replace '^[\s\]\[()*_:|-]+', ''
        if ($before -match '(?i)\bno\s*[\[*]*$' -or $after -match '(?i)^(?:none|zero|0)\b|^no\s+(?:findings?|issues?)\b') { continue }
        $label.Value.ToUpperInvariant()
      }
    )
    if (-not $labels.Count) {
      if ($line -match '^\s*#{1,6}\s+|^\s*\d+[.)]\s+') { $active = $null }
      continue
    }
    $severity = $labels | Sort-Object | Select-Object -First 1
    # A standalone Severity field belongs to the current block, even after body/blank lines.
    if ($null -ne $active -and $line -match '(?i)^\s*(?:[-*]\s+)?(?:\*\*)?Severity:\s*(?:\*\*)?\[?P[0-3]\]?(?:\*\*)?\s*$') {
      if ($severity -clt $active.severity) { $active.severity = $severity }
      continue
    }
    $title = [regex]::Replace($line, $pattern, '').Trim(' ', '-', '*', '#', '|', ':')
    $location = ''
    if ($title -match '^(?<title>.*?)\s+-\s+(?<location>.+:\d+(?::\d+)?)\s*$') {
      $location = $Matches['location'].Trim(); $title = $Matches['title'].Trim()
    } elseif ($title -match '(?<location>(?:[A-Za-z]:)?[^\s|]+:\d+(?::\d+)?)') { $location = $Matches['location'] }
    $active = [pscustomobject]@{ severity=$severity; location=$location; title=$title }
    $findings.Add($active)
  }
  foreach ($finding in $findings) { $counts[$finding.severity]++ }
  [pscustomobject]@{ Counts=$counts; Findings=@($findings.ToArray()) }
}

function Get-StructuredFindings {
  param([AllowEmptyString()][string]$Text, [string[]]$Ontology = @(Get-ReviewDefectCategories))
  # Intent: validate reviewer-declared facts without inferring fields from prose. Status: implemented.
  # Next: supervisor review. Blockers: none. Confidence: JSON, schema and fence boundary fixtures.
  $result = [pscustomobject]@{ Status='missing'; Findings=@(); Violations=0; InvalidIndexes=@() }
  $fence = ''; $isFindings = $false; $body = New-Object Text.StringBuilder
  $json = $null
  foreach ($line in ($Text -split '\r?\n')) {
    if ($fence) {
      $closing = '^[ \t]*' + [regex]::Escape($fence[0]) + '{' + $fence.Length + ',}[ \t]*$'
      if ($line -cmatch $closing) {
        if ($isFindings) { $json = $body.ToString() }
        $fence = ''
      } elseif ($isFindings) { [void]$body.AppendLine($line) }
    } else {
      # Touch-up (Fable L2 P3): live models indent fences inside lists and leave trailing spaces.
      $opening = [regex]::Match($line, '^[ \t]*(?<fence>`{3,}|~{3,})(?<info>.*)$')
      if ($opening.Success) {
        $fence = $opening.Groups['fence'].Value
        $isFindings = $fence[0] -ceq '`' -and $opening.Groups['info'].Value.Trim() -ceq 'findings'
        [void]$body.Clear()
      }
    }
  }
  if ($null -eq $json) { return $result }
  $result.Status = 'invalid'
  try {
    # The leading bracket distinguishes [] from null/scalars after pipeline array unrolling.
    if (-not $json.TrimStart().StartsWith('[')) { return $result }
    $items = @(ConvertFrom-Json -InputObject $json -ErrorAction Stop)
    # Windows PowerShell emits the root array as one pipeline object, including singleton arrays.
    if ($items.Count -eq 1 -and $items[0] -is [array]) { $items = $items[0] }
  } catch { return $result }
  $valid = New-Object 'Collections.Generic.List[object]'
  $invalidIndexes = New-Object 'Collections.Generic.List[int]'
  for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items[$index]
    $isValid = $item -is [pscustomobject]
    if ($isValid) {
      foreach ($field in @('severity','category','title','location','criterion')) {
        if (@($item.PSObject.Properties.Name) -cnotcontains $field) { $isValid = $false }
      }
      $isValid = $isValid -and $item.severity -is [string] -and @('P0','P1','P2','P3') -ccontains $item.severity -and
        $item.category -is [string] -and $Ontology -ccontains $item.category -and
        $item.title -is [string] -and -not [string]::IsNullOrWhiteSpace($item.title) -and $item.title.Length -le 200 -and
        ($null -eq $item.location -or ($item.location -is [string] -and $item.location.Length -le 200)) -and
        ($null -eq $item.criterion -or ($item.criterion -is [string] -and $item.criterion -cmatch '\AC[0-9]+\z'))
    }
    if ($isValid) {
      $valid.Add([pscustomobject]@{ severity=$item.severity; category=$item.category; title=$item.title; location=$item.location; criterion=$item.criterion })
    } else { $invalidIndexes.Add($index) }
  }
  $result.Status = 'ok'
  $result.Findings = @($valid.ToArray())
  $result.Violations = $invalidIndexes.Count
  $result.InvalidIndexes = @($invalidIndexes.ToArray())
  return $result
}

function Get-FindingSha256 {
  param([byte[]]$Bytes)
  # Intent: stable byte hashes for packet links and fact ids. Status: shared helper.
  # Next: none. Blockers: none. Confidence: hashes checked against Get-FileHash in tests.
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return -join ($hasher.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) }
  finally { $hasher.Dispose() }
}

function Get-FindingSpecSha {
  param([string]$SpecFile)
  # Intent: hash the actual packet bytes, with no stdin inference. Status: implemented.
  # Next: none. Blockers: none. Confidence: found/missing packet tests.
  if ($SpecFile -and (Test-Path -LiteralPath $SpecFile -PathType Leaf)) {
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SpecFile)
    return Get-FindingSha256 -Bytes ([IO.File]::ReadAllBytes($full))
  }
  return $null
}

function Get-FindingRunId {
  param([string]$SpecSha, [string]$Dir,
    [string]$StateDir = $(if ($env:CODEX_DO_STATE_DIR) { $env:CODEX_DO_STATE_DIR } else { Join-Path $env:USERPROFILE '.claude\state' }))
  # Intent: link a finding only to the newest run of the same packet and working directory.
  # Status: hash-only lookup, corrupt metadata skipped. Next: none. Blockers: none. Confidence: run fixtures.
  if (-not $SpecSha -or -not $Dir) { return $null }
  $runs = Join-Path $StateDir 'runs'
  if (-not (Test-Path -LiteralPath $runs -PathType Container)) { return $null }
  $fullDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Dir).TrimEnd('\','/')
  $matchingRuns = @(
    foreach ($folder in (Get-ChildItem -LiteralPath $runs -Directory)) {
      try {
        $meta = [IO.File]::ReadAllText((Join-Path $folder.FullName 'run.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
        if (-not $meta.dir -or -not $meta.startedUtc -or $meta.specSha256 -ine $SpecSha) { continue }
        $runDir = [IO.Path]::GetFullPath([string]$meta.dir).TrimEnd('\','/')
        if ($runDir -ine $fullDir) { continue }
        $started = [DateTimeOffset]::Parse([string]$meta.startedUtc).UtcDateTime
        [pscustomobject]@{ Id=$folder.Name; Started=$started }
      } catch { continue }
    }
  )
  $latest = $matchingRuns | Sort-Object Started, Id -Descending | Select-Object -First 1
  if ($null -ne $latest) { return $latest.Id }
  return $null
}

function New-FindingFact {
  param([string]$Utc, [string]$IdSeed, [string]$Source, [int]$Layer, [string]$Severity,
    [string]$Category, [string]$Title, [string]$Location, [string]$Criterion, [string]$Reviewer,
    [string]$Dir, [string]$SpecFile, [string]$SpecSha, [string]$RunId, [string]$Quote,
    [ValidateSet('finding','format-violation')][string]$Kind = 'finding')
  # Intent: one consistent nullable schema for all review layers. Status: quote capped at 200 chars.
  # Next: Hub consumer. Blockers: none. Confidence: direct and review schema fixtures.
  $id = (Get-FindingSha256 -Bytes ([Text.Encoding]::UTF8.GetBytes($Utc + $IdSeed))).Substring(0,16)
  [pscustomobject][ordered]@{
    id=$id; utc=$Utc; source=$Source; layer=$Layer; severity=$(if ($Severity) { $Severity } else { $null }); category=$Category; title=$Title
    location=$(if ($Location) { $Location } else { $null })
    criterion=$(if ($Criterion) { $Criterion } else { $null })
    reviewer=$(if ($Reviewer) { $Reviewer } else { $null })
    dir=$(if ($Dir) { $Dir } else { $null })
    specFile=$(if ($SpecFile) { $SpecFile } else { $null })
    specSha=$(if ($SpecSha) { $SpecSha } else { $null })
    runId=$(if ($RunId) { $RunId } else { $null })
    quote=$(if ($Quote) { $Quote.Substring(0, [Math]::Min(200, $Quote.Length)) } else { $null })
    kind=$Kind
  }
}

function Add-FindingFacts {
  param([string]$Path, [object[]]$Facts)
  # Intent: append complete JSON lines, with no file creation for empty reviews. Status: implemented.
  # Next: supervisor installation. Blockers: none. Confidence: empty, append and failure fixtures.
  if (-not $Facts.Count) { return }
  $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  $lines = @($Facts | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 5 })
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $full))
  [IO.File]::AppendAllText($full, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
}
