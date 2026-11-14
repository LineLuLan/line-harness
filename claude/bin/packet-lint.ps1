# Intent: reject incomplete packets before spending a worker run.
# Status: pure, dot-sourceable lint. Next: supervisor installs after review.
# Blockers: none. Confidence: packet fixtures cover headings, commands and byte limits.
function Test-Packet {
  param([AllowEmptyString()][string]$Text, [switch]$AllowLarge)
  $errors = New-Object 'Collections.Generic.List[string]'
  $warnings = New-Object 'Collections.Generic.List[string]'
  $sections = @{}
  $keys = 'GOAL|BUSINESS REASON|CONTEXT|SUCCESS CRITERIA|FILES|PATTERNS|CONSTRAINTS|NON-GOALS|DONE WHEN|VALIDATE|STOP RULES|ROLLBACK|TIER|PACKET CHECK|CHECKLIST|DOCS CHECKED'
  $heading = '(?i)^[#>*\s-]*(?<key>(?:' + $keys + ')(?:\s*/\s*(?:' + $keys + '))*)(?:\*\*)?\s*(?:\([^)\r\n]*\)\s*)?:\s*(?:\*\*)?\s*(?<value>.*)$'
  $current = ''
  $tier = $null
  $markers = @{}
  foreach ($line in ($Text -split '\r?\n')) {
    if ($line -match $heading) {
      $current = @($Matches['key'].ToUpperInvariant() -split '\s*/\s*')
      $value = $Matches['value']
      foreach ($key in $current) {
        if ($key -in @('PACKET CHECK','CHECKLIST') -and $value -match '^ok\b') { $markers[$key] = $true }
        if (-not $sections.ContainsKey($key)) { $sections[$key] = New-Object 'Collections.Generic.List[string]' }
        $sections[$key].Add($value)
        if ($key -eq 'TIER' -and $null -eq $tier) { $tier = $value }
      }
    } elseif ($current) { foreach ($key in $current) { $sections[$key].Add($line) } }
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
