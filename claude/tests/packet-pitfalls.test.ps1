. (Join-Path $PSScriptRoot 'test-lib.ps1')
$scriptPath = Join-Path $PSScriptRoot '..\bin\packet-pitfalls.ps1'
$ontology = Join-Path $PSScriptRoot 'fixtures/packet-lessons.json'
$folder = New-TestFolder
try {
  $file = Join-Path $folder 'findings.jsonl'
  $utc = [DateTimeOffset]::UtcNow.AddDays(-1).ToString('o')
  $rows = @(
    @{ utc = $utc; category = 'ps51-traps' }
    @{ utc = $utc; category = 'ps51-traps'; kind = 'finding' }
    @{ utc = $utc; category = 'ps51-traps'; kind = 'finding' }
    @{ utc = $utc; category = 'ps51-traps'; kind = 'format-violation' }
    @{ utc = $utc; category = 'ps51-traps'; kind = $null }
    @{ utc = $utc; category = 'PS51-TRAPS' }
    @{ utc = 'bad'; category = 'ps51-traps' }
    @{ utc = 1; category = 'ps51-traps' }
    @{ utc = '2026-02-30T12:00:00Z'; category = 'ps51-traps' }
    @{ utc = [DateTimeOffset]::UtcNow.AddDays(-15).ToString('o'); category = 'ps51-traps' }
    @{ utc = [DateTimeOffset]::UtcNow.AddDays(1).ToString('o'); category = 'ps51-traps' }
    @{ utc = $utc; category = 'contradiction' }
    @{ utc = $utc; category = 'contradiction' }
    @{ utc = $utc; category = 'contradiction' }
    @{ utc = $utc; category = 'other' }
    @{ utc = $utc; category = 'other' }
    @{ utc = $utc; category = 'unknown' }
  )
  $arrayRow = '[{"utc":"' + $utc + '","category":"ps51-traps"}]'
  $lines = @($rows | ForEach-Object { $_ | ConvertTo-Json -Compress }) + @('{broken', 'null', '[]', $arrayRow)
  [IO.File]::WriteAllLines($file, $lines)
  $result = @(& $scriptPath -Tier Important -Type config -StateDir $folder -Ontology $ontology)
  Assert-True ($result.Count -eq 3 -and $result[0] -eq 'KNOWN PITFALLS:') 'ready block has header, lesson and advisory'
  Assert-True ($result[1] -eq '- [resolve-conflicts] Resolve conflicting requirements.') 'certified lesson printed first'
  Assert-True ($result[2] -eq '- [ps51-traps] Check PowerShell 5.1 syntax. (advisory: 3 findings in 14 days)') 'only valid recent finding rows count; draft does not suppress advisory'
  $result = @(& $scriptPath -Tier Important -Type ui -StateDir $folder -Ontology $ontology)
  Assert-True ($result.Count -eq 3 -and $result[1] -match '^\- \[contradiction\].*advisory: 3') 'inapplicable certified lesson does not suppress advisory'
  $result = @(& $scriptPath -Tier Important -StateDir $folder -Ontology $ontology)
  Assert-True ($result.Count -eq 3 -and ($result -join "`n") -notmatch 'resolve-conflicts') 'without TYPE only wildcard lessons apply'
  $missing = Join-Path $folder 'missing'
  $result = @(& $scriptPath -Tier Important -Type config -StateDir $missing -Ontology $ontology)
  Assert-True ($result.Count -eq 2 -and $result[1] -match '\[resolve-conflicts\]') 'missing findings keeps lessons'
  $result = @(& $scriptPath -Tier Exploration -Type config -StateDir $missing -Ontology $ontology)
  Assert-True ($result.Count -eq 1 -and $result[0] -eq 'KNOWN PITFALLS: none recorded') 'empty result prints none recorded'
  $result = @(& $scriptPath -Tier Important -StateDir $folder -Ontology $missing)
  Assert-True ($result.Count -eq 1 -and $result[0] -eq 'KNOWN PITFALLS: none recorded') 'missing ontology has no categories or lessons'
  $o = Get-Content -Raw $ontology | ConvertFrom-Json
  $o.lessons[0].appliesTo = @{ types = @('*'); tiers = @('*') }
  $wildcard = Join-Path $folder 'ontology.json'
  [IO.File]::WriteAllText($wildcard, ($o | ConvertTo-Json -Depth 10))
  $result = @(& $scriptPath -Tier Skip -StateDir $missing -Ontology $wildcard)
  Assert-True ($result.Count -eq 2 -and $result[1] -match '\[resolve-conflicts\]') 'wildcards apply without TYPE at any tier'
  . (Join-Path $PSScriptRoot '..\bin\packet-lint.ps1')
  $packet = "TIER: Skip`nPACKET CHECK: ok`nDOCS CHECKED: n/a`nGOAL: test`nSUCCESS CRITERIA: pass`nFILES: test.ps1`nCONSTRAINTS: local`nDONE WHEN: green`nVALIDATE: node test.js`nSTOP RULES: stop`n" + ($result -join "`n")
  $lint = Test-Packet $packet -Ontology $wildcard
  Assert-True ($lint.ok -and $lint.warnings.Count -eq 0) 'generated block satisfies lint using the same selection'
  foreach ($tierValue in @('Important,', 'important', 'Important.', 'Critical/Important', 'CRITICAL')) {
    $result = @(& $scriptPath -Tier $tierValue -Type config -StateDir $missing -Ontology $ontology)
    Assert-True ($result.Count -eq 2 -and $result[1] -match '\[resolve-conflicts\]') "generator normalizes tier: $tierValue"
  }
  Push-Location (Split-Path $folder -Parent)
  try {
    $result = @()
    try { $result = @(& $scriptPath -Tier Important -Type config -StateDir (Split-Path $folder -Leaf) -Ontology $ontology) } catch { }
    Assert-True ($result.Count -eq 3 -and $result[2] -match 'advisory: 3 findings') 'relative StateDir follows PowerShell location'
  } finally { Pop-Location }
  foreach ($badJson in @('{"lessons": [', '{"lessons":[],"Lessons":[]}')) {
    [IO.File]::WriteAllText($wildcard, $badJson)
    $stderr = New-Object IO.StringWriter
    $previousError = [Console]::Error
    $result = @()
    try {
      [Console]::SetError($stderr)
      $result = @(& $scriptPath -Tier Important -Type config -StateDir $folder -Ontology $wildcard)
    } catch { } finally { [Console]::SetError($previousError) }
    Assert-True ($result.Count -eq 1 -and $result[0] -eq 'KNOWN PITFALLS: none recorded') 'malformed ontology still prints block'
    Assert-True ($stderr.ToString().Trim() -eq 'ontology unreadable: lesson checks skipped') 'malformed ontology prints exactly one stderr warning'
    $stderr.Dispose()
  }
  $o = Get-Content -Raw $ontology | ConvertFrom-Json
  $o.defectCategories = @($o.defectCategories) + @(1..7 | ForEach-Object { @{ id = "category-$_"; countermeasure = "Check category $_." } })
  [IO.File]::WriteAllText($wildcard, ($o | ConvertTo-Json -Depth 10))
  $lines = New-Object 'Collections.Generic.List[string]'
  foreach ($category in $o.defectCategories) {
    $count = switch ($category.id) { 'other' { 30 } 'contradiction' { 20 } 'category-6' { 8 } 'category-7' { 9 } default { 3 } }
    for ($i = 0; $i -lt $count; $i++) { $lines.Add((@{ utc = $utc; category = $category.id } | ConvertTo-Json -Compress)) }
  }
  [IO.File]::WriteAllLines($file, $lines.ToArray())
  $result = @(& $scriptPath -Tier Important -Type config -StateDir $folder -Ontology $wildcard)
  Assert-True ($result.Count -eq 8 -and $result[1] -match '\[resolve-conflicts\]') 'cap applies only to advisories, preserving certified lessons'
  $ids = @($result | Where-Object { $_ -match 'advisory: \d+ findings' } | ForEach-Object { if ($_ -match '\[([^\]]+)\]') { $Matches[1] } })
  Assert-True (($ids -join ',') -eq 'category-7,category-6,ps51-traps,category-1,category-2') 'top five counts descending, ties by ontology order'
  Assert-True ($result[-1] -eq '- advisory: 3 more categories with 3+ findings omitted') 'omission count excludes other and categories covered by lessons'
  Assert-True (($result -join "`n") -notmatch '\[other\]') 'other never produces an advisory even with the most findings'
  [IO.File]::WriteAllText($file, ((1..3 | ForEach-Object { @{ utc = $utc; category = 'other' } | ConvertTo-Json -Compress }) -join "`n"))
  $result = @(& $scriptPath -Tier Exploration -StateDir $folder -Ontology $wildcard)
  Assert-True ($result.Count -eq 1 -and $result[0] -eq 'KNOWN PITFALLS: none recorded') 'other alone does not produce an omission line'
  . (Import-TestFunctions $scriptPath)
  $instant = [datetime]::UtcNow.AddDays(-1)
  foreach ($value in @($instant, $instant.ToLocalTime(), $instant.ToString('o'), ([DateTimeOffset]$instant).ToOffset([TimeSpan]::FromHours(7)).ToString('o'))) {
    $parsed = $null
    try { $parsed = ConvertTo-PacketFindingUtc -Value $value } catch { }
    Assert-True ($null -ne $parsed -and $parsed.UtcDateTime -eq $instant -and $parsed.Offset -eq [TimeSpan]::Zero) 'datetime or ISO string converts to the same UTC instant'
  }
} finally { Remove-TestFolder $folder }
Complete-Tests
