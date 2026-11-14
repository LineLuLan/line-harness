. (Join-Path $PSScriptRoot 'test-lib.ps1')
$add = Join-Path $PSScriptRoot '..\bin\finding-add.ps1'
$fixture = New-TestFolder
$beforeState = $env:CODEX_DO_STATE_DIR
try {
  $state = Join-Path $fixture 'state'
  $env:CODEX_DO_STATE_DIR = $state
  $path = Join-Path $state 'findings.jsonl'
  & $add -Layer 3 -Severity P1 -Category scope-creep -Title 'Extra behaviour' -StateDir $state
  $lines = [IO.File]::ReadAllLines($path)
  $fact = $lines[0] | ConvertFrom-Json
  Assert-True ($lines.Count -eq 1 -and $fact.source -eq 'supervisor' -and $fact.layer -eq 3 -and $fact.category -eq 'scope-creep' -and $fact.severity -eq 'P1') 'direct call writes typed supervisor fact'
  Assert-True ($fact.kind -ceq 'finding' -and ($fact.PSObject.Properties.Name | Select-Object -Last 1) -ceq 'kind') 'direct row kind is last property'
  Assert-True ($fact.id -cmatch '^[0-9a-f]{16}$' -and $fact.utc) 'fact has id and utc'
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $expected = -join ($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($fact.utc + $fact.title)) | ForEach-Object { $_.ToString('x2') }) } finally { $hasher.Dispose() }
  Assert-True ($fact.id -ceq $expected.Substring(0,16)) 'direct id hashes utc plus title'
  foreach ($field in @('location','criterion','specFile','specSha','runId','reviewer','quote','dir')) {
    Assert-True ($null -eq $fact.$field) "omitted $field is null"
  }
  Assert-True ([IO.File]::ReadAllBytes($path)[0] -eq 123) 'facts are UTF-8 without BOM'
  $original = [IO.File]::ReadAllText($path)
  foreach ($bad in @(
    @{Layer=2;Severity='P1';Category='unknown';Title='Bad'},
    @{Layer=2;Severity='P1';Category='other'},
    @{Severity='P1';Category='other';Title='Missing layer'},
    @{Layer=2;Category='other';Title='Missing severity'},
    @{Layer=2;Severity='P1';Title='Missing category'},
    @{Layer=2;Severity='P1';Category='other';Title="Bad|title"},
    @{Layer=2;Severity='P1';Category='other';Title="Bad`ntitle"},
    @{Layer=2;Severity='P1';Category='other';Title=' ';Reviewer='x'},
    @{Layer=2;Severity='P1';Category='other';Title='Bad quote';Quote="bad`nquote"}
  )) {
    Assert-Throws { & $add @bad -StateDir $state } 'invalid direct input rejected'
    Assert-True ([IO.File]::ReadAllText($path) -ceq $original) 'rejection writes nothing'
  }
  $review = Join-Path $PSScriptRoot 'fixtures\review-findings-tagged.txt'
  Assert-Throws { & $add -FromFile $review -Layer 2 -StateDir $state } 'FromFile requires reviewer'
  & $add -FromFile $review -Layer 2 -Reviewer 'Fable' -Dir $fixture
  $facts = @([IO.File]::ReadAllLines($path) | ConvertFrom-Json)
  Assert-True ($facts.Count -eq 4 -and ($facts[1..3].category -join ',') -eq 'scope-creep,encoding,other') 'FromFile parses all three findings using env state directory'
  Assert-True (@($facts | Where-Object { $_.kind -cne 'finding' }).Count -eq 0) 'all direct and imported facts have finding kind'
  Assert-True ($facts[1].source -eq 'fable' -and $facts[1].reviewer -eq 'Fable' -and $facts[1].criterion -eq 'C2' -and $facts[1].location -eq 'src/a.ps1:12' -and $null -eq $facts[1].quote) 'FromFile keeps declared source attribution and null quote'
  Assert-True ($null -eq $facts[3].criterion) 'declared null criterion is retained'
  $empty = Join-Path $fixture 'empty.txt'
  [IO.File]::WriteAllText($empty, 'VERDICT: PASS')
  $emptyState = Join-Path $fixture 'empty-state'
  foreach ($content in @('VERDICT: PASS', ('```findings' + "`n{bad`n" + '```'))) {
    [IO.File]::WriteAllText($empty, $content)
    $stderr = Join-Path $fixture 'import-stderr.txt'
    $process = Start-Process powershell -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $add + '"'),'-FromFile',('"' + $empty + '"'),'-Layer','3','-Reviewer','supervisor','-StateDir',('"' + $emptyState + '"')) -RedirectStandardError $stderr
    Assert-True ($process.ExitCode -eq 1 -and -not (Test-Path $emptyState) -and [IO.File]::ReadAllText($stderr).Contains('findings block')) 'missing or invalid block exits 1 with no write'
    $process.Dispose()
  }
  [IO.File]::WriteAllText($empty, ('```findings' + "`n[]`n" + '```'))
  & $add -FromFile $empty -Layer 3 -Reviewer supervisor -StateDir $emptyState
  Assert-True (-not (Test-Path $emptyState)) 'explicit empty array creates no directory or log'
  $mixed = '```findings' + "`n" + '[{"severity":"P2","category":"other","title":"Valid | title","location":null,"criterion":null},null,{"severity":"P1","category":"unknown","title":"Invalid","location":null,"criterion":null}]' + "`n" + '```'
  [IO.File]::WriteAllText($empty, $mixed)
  $process = Start-Process powershell -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $add + '"'),'-FromFile',('"' + $empty + '"'),'-Layer','2','-Reviewer','Fable','-StateDir',('"' + $emptyState + '"')) -RedirectStandardError $stderr
  $mixedFacts = @([IO.File]::ReadAllLines((Join-Path $emptyState 'findings.jsonl')) | ConvertFrom-Json)
  $errors = [IO.File]::ReadAllText($stderr)
  Assert-True ($process.ExitCode -eq 1 -and $mixedFacts.Count -eq 1 -and $mixedFacts[0].title -ceq 'Valid | title' -and $null -eq $mixedFacts[0].quote -and $errors.Contains('index 1') -and $errors.Contains('index 2')) 'mixed batch writes valid rows and reports zero-based invalid indexes on stderr with exit 1'
  $process.Dispose()
  $allInvalidState = Join-Path $fixture 'all-invalid-state'
  [IO.File]::WriteAllText($empty, ('```findings' + "`n[null]`n" + '```'))
  $process = Start-Process powershell -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $add + '"'),'-FromFile',('"' + $empty + '"'),'-Layer','2','-Reviewer','Fable','-StateDir',('"' + $allInvalidState + '"')) -RedirectStandardError $stderr
  Assert-True ($process.ExitCode -eq 1 -and -not (Test-Path $allInvalidState) -and [IO.File]::ReadAllText($stderr).Contains('index 0')) 'all-invalid batch exits 1 and creates no log'
  $process.Dispose()
  $spec = Join-Path $fixture 'packet.md'
  [IO.File]::WriteAllText($spec, 'packet')
  & $add -Layer 2 -Severity P2 -Category encoding -Title 'Text' -Location 'x:1' -Criterion C3 -SpecFile $spec -RunId 'explicit' -Reviewer Fable -Quote ('x' * 250) -Dir $fixture
  $last = [IO.File]::ReadAllLines($path)[4] | ConvertFrom-Json
  Assert-True ($last.specSha -eq (Get-FileHash $spec -Algorithm SHA256).Hash.ToLowerInvariant() -and $last.runId -eq 'explicit' -and $last.quote.Length -eq 200 -and $last.criterion -eq 'C3') 'direct metadata and bounded quote retained'
  & $add -Layer 2 -Severity P2 -Category logic-bug -Title 'External review' -Source other -Reviewer gpt-6-astra
  $last = [IO.File]::ReadAllLines($path)[5] | ConvertFrom-Json
  Assert-True ($last.source -ceq 'other' -and $last.reviewer -ceq 'gpt-6-astra') 'explicit other source preserves reviewer'
  & $add -FromFile $review -Layer 3 -Reviewer gpt-6-astra -Source codex-review
  $last = [IO.File]::ReadAllLines($path)[6] | ConvertFrom-Json
  Assert-True ($last.source -ceq 'codex-review' -and $last.layer -eq 3) 'source override also applies to imported findings'
  $original = [IO.File]::ReadAllText($path)
  Assert-Throws { & $add -Layer 2 -Severity P2 -Category other -Title 'Bad source' -Source invalid } 'unknown source is rejected'
  Assert-True ([IO.File]::ReadAllText($path) -ceq $original) 'invalid source writes nothing'
} finally { $env:CODEX_DO_STATE_DIR = $beforeState; Remove-TestFolder $fixture }
Complete-Tests
