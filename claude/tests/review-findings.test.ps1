. (Join-Path $PSScriptRoot 'test-lib.ps1')
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
  $reviewAnswer = $text; $exitCode = 1
  Write-ReviewLog
  $reviewAnswer = ''; $exitCode = 0
  Write-ReviewLog
  $lines = [IO.File]::ReadAllLines($log)
  $first = $lines[0] | ConvertFrom-Json; $second = $lines[1] | ConvertFrom-Json
  Assert-True ($lines.Count -eq 2 -and $first.utc -and $first.dir -eq $fixture -and $first.model -eq 'fixture' -and $first.effort -eq 'high' -and $first.verdict -eq 'FAIL' -and $first.specFile -eq 'packet.md' -and $first.gates.lint -eq 'PASS') 'live log fields and override path preserved'
  Assert-True ($first.findings.Count -eq 8 -and @($first.findings | Where-Object { $_.severity -eq 'P1' }).Count -eq 5 -and $second.findings.Count -eq 0) 'JSONL findings include empty arrays'
  Assert-True ((@($first.findings[0].PSObject.Properties.Name) -join ',') -ceq 'severity,location,title') 'live finding schema unchanged'
  Assert-True ([IO.File]::ReadAllBytes($log)[0] -eq 123) 'review JSONL UTF-8 without BOM'
  $script = Join-Path $PSScriptRoot '..\bin\codex-review.ps1'
  # Run actual gates-only entry point against a path-limited empty diff; no Codex launch.
  $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Dir $repo -SkipModel -SkipGates -Paths '__no_such_test_path__'
  $last = [IO.File]::ReadAllLines($log)[2] | ConvertFrom-Json
  Assert-True ($LASTEXITCODE -eq 0 -and $last.verdict -eq 'PASS' -and $last.gates.typecheck -eq 'SKIP' -and $last.findings.Count -eq 0 -and $last.mode -eq 'gates-only' -and $last.criteria -eq 'n/a' -and $null -eq $last.model -and $null -eq $last.effort) 'actual SkipModel run is logged'
} finally { $env:CODEX_REVIEW_LOG = $logBefore; Remove-TestFolder $fixture }
Complete-Tests
