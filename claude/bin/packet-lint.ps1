# Intent: use CHECKLIST's case-insensitive word boundary for lesson tiers too.
# Status: complete. Next: none. Blockers: none. Confidence: punctuation and case fixtures.
function Get-PacketTier {
  param([string]$Value)
  foreach ($name in @('Skip','Standard-A','Standard-B','Important','Critical','Exploration')) {
    if ($Value -match ('^\s*' + [regex]::Escape($name) + '\b')) { return $name }
  }
  return ($Value.Trim() -split '[\s|]+', 2)[0]
}

# Intent: keep lint and generated blocks on the same certified lesson selection.
# Status: complete. Next: P3 lesson certification. Blockers: none. Confidence: fixture tests.
function Get-ApplicablePacketLessons {
  param([object[]]$Lessons, [string]$Tier, [string]$Type)
  $Tier = Get-PacketTier $Tier
  foreach ($lesson in $Lessons) {
    if ($null -eq $lesson -or $lesson.status -cne 'certified') { continue }
    if (($lesson.appliesTo.tiers -contains '*' -or $lesson.appliesTo.tiers -contains $Tier) -and
        ($lesson.appliesTo.types -ccontains '*' -or ($Type -and $lesson.appliesTo.types -ccontains $Type))) {
      $lesson
    }
  }
}

# Intent: reject incomplete packets before spending a worker run.
# Status: dot-sourceable lint with local ontology input. Next: supervisor installs after review.
# Blockers: none. Confidence: packet fixtures cover headings, commands and byte limits.
function Test-Packet {
  param([AllowEmptyString()][string]$Text, [switch]$AllowLarge,
    [string]$Ontology = (Join-Path $PSScriptRoot '..\ontology\harness.ontology.json'))
  $errors = New-Object 'Collections.Generic.List[string]'
  $warnings = New-Object 'Collections.Generic.List[string]'
  $sections = @{}
  $keys = 'GOAL|BUSINESS REASON|CONTEXT|SUCCESS CRITERIA|FILES|PATTERNS|CONSTRAINTS|NON-GOALS|DONE WHEN|VALIDATE|STOP RULES|ROLLBACK|TIER|KNOWN PITFALLS|PACKET CHECK|CHECKLIST|DOCS CHECKED'
  $heading = '(?i)^[#>*\s-]*(?<key>(?:' + $keys + ')(?:\s*/\s*(?:' + $keys + '))*)(?:\*\*)?\s*(?:\([^)\r\n]*\)\s*)?:\s*(?:\*\*)?\s*(?<value>.*)$'
  $current = ''
  $tier = $null
  $inlineType = $null
  $type = $null
  $markers = @{}
  foreach ($line in ($Text -split '\r?\n')) {
    # TYPE is metadata, never a section boundary; lowercase prose remains body text.
    if ($line -cmatch '^(?:## )?(?:\*\*)?TYPE(?:\*\*)?:(?:\*\*)? (?<type>[a-z][a-z0-9-]*)(?:\*\*)?$') {
      if ($null -eq $type) { $type = $Matches['type'] }
      continue
    }
    if ($line -match $heading) {
      $current = @($Matches['key'].ToUpperInvariant() -split '\s*/\s*')
      $value = $Matches['value']
      foreach ($key in $current) {
        if ($key -in @('PACKET CHECK','CHECKLIST') -and $value -match '^ok\b') { $markers[$key] = $true }
        if (-not $sections.ContainsKey($key)) { $sections[$key] = New-Object 'Collections.Generic.List[string]' }
        $sections[$key].Add($value)
        if ($key -eq 'TIER' -and $null -eq $tier) {
          $tier = Get-PacketTier $value
          if ($value -match '(?i)\|\s*TYPE:\s*([^|]+)(?:\||$)') { $inlineType = $Matches[1].Trim() }
        }
      }
    } elseif ($current) { foreach ($key in $current) { $sections[$key].Add($line) } }
  }
  if ($null -ne $inlineType) { $type = $inlineType }
  if ($type -and @('ui','collector','review','research','docs','config','other') -cnotcontains $type) {
    $warnings.Add("Unknown TYPE: $type.")
  }
  if (-not $type -and $tier -in @('Important','Critical')) { $warnings.Add('add TYPE: to receive typed lessons') }
  $knowledge = $null
  try {
    if (Test-Path -LiteralPath $Ontology -PathType Leaf -ErrorAction Stop) {
      $knowledge = Get-Content -LiteralPath $Ontology -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    }
  } catch { $warnings.Add('ontology unreadable: lesson checks skipped') }
  if ($null -ne $knowledge) {
    $pitfalls = ''
    if ($sections.ContainsKey('KNOWN PITFALLS')) { $pitfalls = $sections['KNOWN PITFALLS'] -join "`n" }
    foreach ($lesson in @(Get-ApplicablePacketLessons -Lessons $knowledge.lessons -Tier $tier -Type $type)) {
      if (-not $pitfalls.Contains('[' + $lesson.id + ']')) {
        $message = "KNOWN PITFALLS missing certified lesson [$($lesson.id)]."
        if ($tier -in @('Important','Critical')) { $errors.Add($message) } else { $warnings.Add($message) }
      }
    }
  }
  foreach ($name in @('GOAL','SUCCESS CRITERIA','FILES','CONSTRAINTS','DONE WHEN','VALIDATE','STOP RULES','DOCS CHECKED')) {
    if (-not $sections.ContainsKey($name)) { $errors.Add("Missing ${name}: heading.") }
  }
  foreach ($name in @('PACKET CHECK', 'CHECKLIST')) {
    if ($name -eq 'CHECKLIST' -and $tier -notmatch '^(Important|Critical)\b') { continue }
    if (-not $markers.ContainsKey($name)) {
      $errors.Add("Missing ${name}: ok.")
    }
  }
  # Accept command lines, including list/code prefixes and quoted script paths.
  $prefix = '^(?:(?:[-*]|\d+[.)])\s+)?`?(?:&\s+)?'
  $executable = '(?:node|npm|pnpm|npx|python|pytest|powershell|pwsh|git|dotnet|cargo|go|corepack|uv|mvn|gradle|java|javac|make|bun|deno|rg|grep|findstr|find|bash)(?:\.exe|\.cmd)?|(?:Get|Invoke|Test|Select)-[A-Za-z][\w-]*|"[^"\r\n]+\.(?:ps1|js|py|cmd|exe)"|''[^''\r\n]+\.(?:ps1|js|py|cmd|exe)''|[^\s`"'']+\.(?:ps1|js|py|cmd|exe)'
  $command = $prefix + '(?:Measure-Command|' + $executable + ')(?:\s|`|$)'
  $isCommand = {
    param([string]$Candidate)
    $Candidate = $Candidate.Trim() -replace '^(?:[-*]|\d+[.)])\s+', ''
    # Strip only setup statements, respecting semicolons inside quoted values.
    $setup = '^(?:cd\s+|\$env:\w+\s*=\s*)(?:"[^"\r\n]*"|''[^''\r\n]*''|[^;"''\r\n])+;\s*'
    while ($Candidate -match $setup) { $Candidate = $Candidate.Substring($Matches[0].Length).TrimStart() }
    if ($Candidate -match '^(make|go|find)\s+([a-z]+)\b' -and
        $Candidate -notmatch '(?:^|\s)[-/\\.]|[/\\]' -and
        $Candidate -notmatch '^(?:make\s+(?:test|check|build|clean|all|install)|go\s+(?:test|build|run|vet|fmt|version|mod|list))\b') { return $false }
    return ($Candidate -match $command)
  }
  $hasCommand = $false
  if ($sections.ContainsKey('VALIDATE')) {
    foreach ($line in $sections['VALIDATE']) {
      if (& $isCommand $line) { $hasCommand = $true }
      foreach ($code in [regex]::Matches($line, '`([^`]+)`')) {
        if (& $isCommand $code.Groups[1].Value) { $hasCommand = $true }
      }
      if (($tier -match '\bExploration\b' -or $Text -match '\bread-only\b') -and $line.Trim() -match '^(?:[-*]\s+)?n/a\s*(?:-\s*\S|\(\s*[^\s)]+.*\))') { $hasCommand = $true }
    }
  }
  if (-not $hasCommand) {
    $errors.Add('VALIDATE has no runnable command.')
  }
  if (-not $AllowLarge -and [Text.Encoding]::UTF8.GetByteCount($Text) -gt 8KB) {
    $errors.Add('Packet exceeds 8 KB (UTF-8); use -AllowLarge to override.')
  }
  if ($sections.ContainsKey('FILES')) {
    $paths = [regex]::Matches(($sections['FILES'] -join "`n"), '(?i)(?:[A-Z]:)?[\w.@-]+(?:[/\\][\w.@-]+)+|[\w@-]+\.[A-Z0-9]+')
    if ($paths.Count -gt 8) { $warnings.Add("FILES lists $($paths.Count) paths (more than 8).") }
  }
  [pscustomobject]@{ ok = ($errors.Count -eq 0); errors = @($errors.ToArray()); warnings = @($warnings.ToArray()) }
}
