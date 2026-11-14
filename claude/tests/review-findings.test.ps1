. (Join-Path $PSScriptRoot 'test-lib.ps1')
. (Join-Path $PSScriptRoot '..\bin\review-findings-lib.ps1')
. (Import-TestFunctions (Join-Path $PSScriptRoot '..\bin\codex-review.ps1'))
$text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures\review-findings.txt'))
$result = Get-ReviewFindings $text
Assert-True ($result.Counts.P0 -eq 1 -and $result.Counts.P1 -eq 5 -and $result.Counts.P2 -eq 1 -and $result.Counts.P3 -eq 1) 'all six formats counted'
Assert-True ($result.Findings.Count -eq 8) 'one finding per line'
$empty = Get-ReviewFindings 'No issues. P10 and XP1 are not severity labels.'
Assert-True ($empty.Findings.Count -eq 0 -and $empty.Counts.P1 -eq 0) 'no findings and false positives'
$multi = Get-ReviewFindings '- [P2] Severity: P1 same finding'
Assert-True ($multi.Findings.Count -eq 1 -and $multi.Counts.P1 -eq 1) 'conflicting labels count once at highest severity'
foreach ($zero in @('P1: none','P0 (0)','no P1','[P2] 0 findings','**P1** none','no [P1]','P3: no issues')) {
  Assert-True ((Get-ReviewFindings $zero).Findings.Count -eq 0) "zero summary: $zero"
}
foreach ($format in @('1. P1 - x','| P1 | x |','### P2')) {
  Assert-True ((Get-ReviewFindings $format).Findings.Count -eq 1) "new format: $format"
}
$block = Get-ReviewFindings "- [P1] Broken validation - file.ps1:12`n  Details explain the error.`n`n  Severity: P1`n- [P2] Another issue - file.ps1:30`nSeverity: P2"
Assert-True ($block.Findings.Count -eq 2 -and $block.Counts.P1 -eq 1 -and $block.Counts.P2 -eq 1) 'repeated block severity counted once'
Assert-True ($block.Findings[0].title -eq 'Broken validation' -and $block.Findings[0].location -eq 'file.ps1:12') 'legacy title and location preserved'
$fixture = New-TestFolder

# Intent: define the declared JSON contract before implementation. Status: regression suite.
# Next: supervisor review. Blockers: none. Confidence: schema and fence boundary cases.
function New-StructuredReview([string]$Json) {
  # Intent: build literal review fences. Status: test helper. Next: none. Blockers: none. Confidence: parser cases.
  return ('```findings' + "`n" + $Json + "`n" + '```')
}
$validJson = '{"severity":"P1","category":"scope-creep","title":"Extra work","location":"a.ps1:7","criterion":"C2"}'
$structuredText = New-StructuredReview ('[' + $validJson + ']')
$parsed = Get-StructuredFindings $structuredText
Assert-True ($parsed.Status -ceq 'ok' -and $parsed.Findings.Count -eq 1 -and $parsed.Violations -eq 0 -and $parsed.Findings[0].criterion -ceq 'C2') 'structured singleton object survives array unrolling'
Assert-True ((Get-StructuredFindings (New-StructuredReview '[]')).Status -ceq 'ok' -and (Get-StructuredFindings (New-StructuredReview '[]')).Findings.Count -eq 0) 'empty JSON array is valid'
Assert-True ((Get-StructuredFindings 'VERDICT: PASS').Status -ceq 'missing') 'missing block is explicit'
foreach ($json in @('{broken', '{}', 'null', '42', '"text"')) {
  Assert-True ((Get-StructuredFindings (New-StructuredReview $json)).Status -ceq 'invalid') "invalid JSON or non-array root: $json"
}
Assert-True ((Get-StructuredFindings ($structuredText + "`n" + (New-StructuredReview '[]'))).Findings.Count -eq 0) 'last findings block wins'
Assert-True ((Get-StructuredFindings ($structuredText + "`n" + (New-StructuredReview '{bad'))).Status -ceq 'invalid') 'invalid last block does not fall back'
# Touch-up 2026-11-15 (Fable L2 P3): surrounding spaces and list-indented fences are accepted; C2 plus newline is not a criterion.
Assert-True ((Get-StructuredFindings ($structuredText.Replace('```findings', '``` findings '))).Status -ceq 'ok') 'info string is trimmed'
Assert-True ((Get-StructuredFindings ("- item`n    ``````findings`n    []`n    ``````")).Status -ceq 'ok') 'list-indented fence is read'
Assert-True ((Get-StructuredFindings ("``````findings`n" + '[{"severity":"P2","category":"logic-bug","title":"t","location":null,"criterion":"C2\n"}]' + "`n``````")).Violations -eq 1) 'criterion with trailing newline is rejected'
foreach ($info in @('json','Findings','findings extra')) {
  Assert-True ((Get-StructuredFindings ($structuredText.Replace('```findings', ('```' + $info)))).Status -ceq 'missing') "info string must be exactly findings: $info"
}
Assert-True ((Get-StructuredFindings ('````text' + "`n" + $structuredText + "`n" + '````')).Status -ceq 'missing') 'example inside another fence is not a findings block'
Assert-True ((Get-StructuredFindings ('```findings' + "`n[]")).Status -ceq 'missing') 'unclosed fence is not a block'
foreach ($case in @(
  @{field='category';value='unknown'}, @{field='category';value='Scope-creep'},
  @{field='title';value=('x' * 201)}, @{field='title';value=''}, @{field='title';value=42},
  @{field='criterion';value='c2'}, @{field='criterion';value='C2x'}, @{field='criterion';value=2},
  @{field='severity';value='p1'}, @{field='severity';value='P4'}, @{field='location';value=42}
)) {
  $item = $validJson | ConvertFrom-Json
  $item.($case.field) = $case.value
  $json = '[' + $validJson + ',' + ($item | ConvertTo-Json -Compress) + ']'
  $parsed = Get-StructuredFindings (New-StructuredReview $json)
  Assert-True ($parsed.Status -ceq 'ok' -and $parsed.Findings.Count -eq 1 -and $parsed.Violations -eq 1 -and $parsed.InvalidIndexes[0] -eq 1) "invalid $($case.field) dropped and indexed: $($case.value)"
}
foreach ($json in @('[null]','[42]','[[]]','[[{}]]','[{"severity":"P1","category":"other","title":"x"}]')) {
  $parsed = Get-StructuredFindings (New-StructuredReview $json)
  Assert-True ($parsed.Status -ceq 'ok' -and $parsed.Findings.Count -eq 0 -and $parsed.Violations -eq 1) "non-object or missing fields dropped: $json"
}
$nullable = '[{"severity":"P3","category":"other","title":"' + ('x' * 200) + '","location":null,"criterion":null}]'
Assert-True ((Get-StructuredFindings (New-StructuredReview $nullable)).Findings.Count -eq 1) 'null fields and 200-character title accepted'
Assert-True ((Get-StructuredFindings (New-StructuredReview ($nullable.Replace('other','custom'))) -Ontology @('custom','other')).Findings.Count -eq 1) 'explicit ontology ids used'

$fallback = @(Get-ReviewDefectCategories -OntologyPath (Join-Path $fixture 'missing.json'))
Assert-True ($fallback.Count -eq 19 -and ($fallback -join ',') -eq ((Get-ReviewDefectCategories) -join ',')) 'fallback matches all 19 ontology ids'
$customOntology = Join-Path $fixture 'ontology.json'
[IO.File]::WriteAllText($customOntology, '{"defectCategories":[{"id":"custom"},{"id":"other"}]}')
Assert-True (((Get-ReviewDefectCategories -OntologyPath $customOntology) -join ',') -ceq 'custom,other') 'loader reads supplied ontology'
# Intent: ontology damage must not disable review evidence. Status: fallback regressions.
# Next: supervisor review. Blockers: none. Confidence: invalid JSON/list and exclusive-lock fixtures.
$stderrBefore = [Console]::Error
$warningCapture = New-Object IO.StringWriter
try {
  [Console]::SetError($warningCapture)
  foreach ($invalid in @('{}','{"defectCategories":[]}','{"defectCategories":null}',
    '{"defectCategories":{ "id":"other" }}','{"defectCategories":[null]}',
    '{"defectCategories":[{"id":42}]}','{"defectCategories":[{"id":"bad id"}]}',
    '{"defectCategories":[{"id":"other"},{"id":"other"}]}','{"defectCategories":[{"id":"custom"}]}','{broken')) {
    [IO.File]::WriteAllText($customOntology, $invalid)
    try {
      $actual = @(Get-ReviewDefectCategories -OntologyPath $customOntology)
      Assert-True (($actual -join ',') -ceq ($fallback -join ',')) "invalid ontology falls back: $invalid"
    } catch { Assert-True $false "invalid ontology must not throw: $invalid" }
  }
  $lockedPath = Join-Path $fixture 'locked-ontology.json'
  [IO.File]::WriteAllText($lockedPath, '{}')
  $lock = [IO.File]::Open($lockedPath, 'Open', 'ReadWrite', 'None')
  try {
    try {
      $actual = @(Get-ReviewDefectCategories -OntologyPath $lockedPath)
      Assert-True (($actual -join ',') -ceq ($fallback -join ',')) 'locked ontology falls back'
    } catch { Assert-True $false 'locked ontology must not throw' }
  } finally { $lock.Dispose() }
} finally { [Console]::SetError($stderrBefore); $warningCapture.Dispose() }
$stateBefore = $env:CODEX_DO_STATE_DIR
$env:CODEX_DO_STATE_DIR = Join-Path $fixture 'state'
$spec = Join-Path $fixture 'packet.md'
[IO.File]::WriteAllText($spec, 'fixture packet')
$sha = (Get-FileHash -LiteralPath $spec -Algorithm SHA256).Hash.ToLowerInvariant()
foreach ($case in @(
  @{id='older';dir=$fixture;sha=$sha;started='2026-11-14T10:00:00Z'},
  @{id='newest';dir=($fixture + '\');sha=$sha;started='2026-11-15T10:00:00Z'},
  @{id='other-dir';dir=($fixture + '\other');sha=$sha;started='2026-11-16T10:00:00Z'},
  @{id='other-sha';dir=$fixture;sha='wrong';started='2026-11-16T10:00:00Z'},
  @{id='stdin-only';dir=$fixture;sha=$null;started='2026-11-16T10:00:00Z'},
  @{id='bad-date';dir=$fixture;sha=$sha;started='not-a-date'}
)) {
  $folder = Join-Path $env:CODEX_DO_STATE_DIR ('runs\' + $case.id)
  [void][IO.Directory]::CreateDirectory($folder)
  [IO.File]::WriteAllText((Join-Path $folder 'run.json'), (@{dir=$case.dir;specSha256=$case.sha;startedUtc=$case.started} | ConvertTo-Json))
  [IO.File]::WriteAllText((Join-Path $folder 'stdin.txt'), 'fixture packet')
}
Assert-True ((Get-FindingRunId -SpecSha $sha -Dir $fixture) -eq 'newest') 'run link selects newest matching hash and normalized directory'
Assert-True ($null -eq (Get-FindingRunId -SpecSha 'absent' -Dir $fixture) -and $null -eq (Get-FindingRunId -Dir $fixture)) 'run link has no stdin fallback'
Assert-True ((Get-ReviewFindings 'Findings: P1 (2), P2 (1)').Findings.Count -eq 0) 'summary counts are not findings'
Assert-True ((Get-ReviewFindings "- [P1] Real finding - a.ps1:1`n  This body references [P2] but adds no finding.`n  Severity: P1").Findings.Count -eq 1) 'severity mention in body is not a finding'
Assert-True ((Get-ReviewFindings "[P1] First finding`n### Second finding`nSeverity: P2").Findings.Count -eq 2) 'unlabelled heading starts a new finding block'
$logBefore = $env:CODEX_REVIEW_LOG
try {
  $log = Join-Path $fixture 'reviews.jsonl'
  $env:CODEX_REVIEW_LOG = $log
  $Dir = $fixture; $SpecFile = 'packet.md'; $Model = 'fixture'; $Effort = 'high'
  $gateResults = [ordered]@{lint='PASS'}; $utf8NoBom = New-Object Text.UTF8Encoding($false)
  # Intent: distinguish model and gates evidence. Status: log schema regression.
  # Next: supervisor live check. Blockers: none. Confidence: actual gates entry point.
  $SkipModel = $false; $criteriaStatus = 'none'
  $reviewAnswer = $text + "`n" + $structuredText; $exitCode = 1
  Write-ReviewLog
  $reviewAnswer = ''; $exitCode = 0
  Write-ReviewLog
  $lines = [IO.File]::ReadAllLines($log)
  $first = $lines[0] | ConvertFrom-Json; $second = $lines[1] | ConvertFrom-Json
  Assert-True ($lines.Count -eq 2 -and $first.utc -and $first.dir -eq $fixture -and $first.model -eq 'fixture' -and $first.effort -eq 'high' -and $first.verdict -eq 'FAIL' -and $first.specFile -eq 'packet.md' -and $first.gates.lint -eq 'PASS') 'live log fields and override path preserved'
  Assert-True ($first.findings.Count -eq 8 -and @($first.findings | Where-Object { $_.severity -eq 'P1' }).Count -eq 5 -and $second.findings.Count -eq 0) 'JSONL findings include empty arrays'
  Assert-True ((@($first.findings[0].PSObject.Properties.Name) -join ',') -ceq 'severity,location,title') 'live finding schema unchanged'
  Assert-True ([IO.File]::ReadAllBytes($log)[0] -eq 123) 'review JSONL UTF-8 without BOM'
  $factsPath = Join-Path $fixture 'findings.jsonl'
  $facts = @([IO.File]::ReadAllLines($factsPath) | ConvertFrom-Json)
  Assert-True ($facts.Count -eq 1 -and $facts[0].source -eq 'codex-review' -and $facts[0].layer -eq 2 -and $facts[0].utc -eq $first.utc) 'only structured facts share review utc'
  $SpecFile = $spec; $reviewAnswer = $structuredText; $exitCode = 1
  Write-ReviewLog
  $linked = [IO.File]::ReadAllLines($factsPath)[1] | ConvertFrom-Json
  Assert-True ($linked.specSha -eq $sha -and $linked.runId -eq 'newest' -and $linked.criterion -eq 'C2' -and $linked.category -eq 'scope-creep') 'typed fact links packet run and named criterion'

  foreach ($case in @(
    @{text='VERDICT: PASS';title='Review findings block missing'},
    @{text=(New-StructuredReview '{bad');title='Review findings block is not valid JSON'},
    @{text=(New-StructuredReview ('[' + $validJson + ',null]'));title='1 findings failed the schema'}
  )) {
    $reviewAnswer = $case.text; $exitCode = 0
    $beforeCount = [IO.File]::ReadAllLines($factsPath).Count
    Write-ReviewLog
    $newFacts = @([IO.File]::ReadAllLines($factsPath) | Select-Object -Skip $beforeCount | ConvertFrom-Json)
    $violation = $newFacts[-1]
    $expectedCount = if ($case.title -like '1 *') { 2 } else { 1 }
    Assert-True ($newFacts.Count -eq $expectedCount -and $violation.kind -ceq 'format-violation' -and $null -eq $violation.severity -and $violation.category -ceq 'other' -and $violation.title -ceq $case.title -and $violation.layer -eq 2 -and $null -eq $violation.quote) 'format violation supplements only valid facts'
    Assert-True ($violation.id -ceq (Get-FindingSha256 ([Text.Encoding]::UTF8.GetBytes($violation.utc + 'violation'))).Substring(0,16)) 'violation id hashes utc plus violation'
    Assert-True (($violation.PSObject.Properties.Name | Select-Object -Last 1) -ceq 'kind') 'kind is last property'
  }
  $beforeCount = [IO.File]::ReadAllLines($factsPath).Count
  $SkipModel = $true; $reviewAnswer = $structuredText
  Write-ReviewLog
  $SkipModel = $false; $reviewAnswer = ''; $exitCode = 0
  Write-ReviewLog
  Assert-True ([IO.File]::ReadAllLines($factsPath).Count -eq $beforeCount) 'SkipModel and empty answers add no model facts or violations'
  $reviewAnswer = ''; $exitCode = 0
  $script = Join-Path $PSScriptRoot '..\bin\codex-review.ps1'
  # Run actual gates-only entry point against a path-limited empty diff; no Codex launch.
  $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Dir $repo -SkipModel -SkipGates -Paths '__no_such_test_path__'
  $last = [IO.File]::ReadAllLines($log)[-1] | ConvertFrom-Json
  Assert-True ($LASTEXITCODE -eq 0 -and $last.verdict -eq 'PASS' -and $last.gates.typecheck -eq 'SKIP' -and $last.findings.Count -eq 0 -and $last.mode -eq 'gates-only' -and $last.criteria -eq 'n/a' -and $null -eq $last.model -and $null -eq $last.effort) 'actual SkipModel run is logged'
  # Intent: both streams use the path resolved before parsing, even if the environment changes.
  # Status: regression for the single-resolution contract. Next: none. Blockers: none. Confidence: real append paths.
  $parserBefore = (Get-Item Function:Get-ReviewFindings).ScriptBlock
  $changedLog = Join-Path $fixture 'changed\reviews.jsonl'
  try {
    function Get-ReviewFindings {
      param([string]$Text)
      # Intent: simulate an environment change during parsing. Status: test-only replacement.
      # Next: restored in finally. Blockers: none. Confidence: destination assertions.
      $env:CODEX_REVIEW_LOG = $changedLog
      & $parserBefore -Text $Text
    }
    $reviewAnswer = '[P1] Stable destination - a.ps1:1' + "`n" + $structuredText; $exitCode = 1
    $beforeCount = [IO.File]::ReadAllLines($factsPath).Count
    Write-ReviewLog
    $last = [IO.File]::ReadAllLines($log)[-1] | ConvertFrom-Json
    Assert-True ($last.findings[0].title -eq 'Stable destination' -and [IO.File]::ReadAllLines($factsPath).Count -eq ($beforeCount + 1) -and -not (Test-Path (Split-Path -Parent $changedLog))) 'both logs keep the single resolved destination'
  } finally { Set-Item Function:Get-ReviewFindings $parserBefore; $env:CODEX_REVIEW_LOG = $log }
} finally { $env:CODEX_REVIEW_LOG = $logBefore; $env:CODEX_DO_STATE_DIR = $stateBefore; Remove-TestFolder $fixture }
Complete-Tests
