. (Join-Path $PSScriptRoot 'test-lib.ps1')
. (Import-TestFunctions (Join-Path $PSScriptRoot '..\bin\codex-review.ps1'))
# Offline only: parser, verdict rules, paths warning on a temp repo, and the JSONL log. No Codex launch.

# Intent: require honest criterion coverage for Line. Status: regression cases.
# Next: supervisor live review. Blockers: none. Confidence: parser and entry-point fixtures.
# --- CRITERIA parsing and verdict rules ---
$allPass = Resolve-ReviewVerdict "Looks fine.`nCRITERIA:`nC1: PASS - warning printed`nC2: PASS - parsed`nVERDICT: PASS"
Assert-True ($allPass.Code -eq 0 -and $allPass.VerdictLine -eq 'VERDICT: PASS' -and $allPass.Criteria.Count -eq 2) 'all PASS keeps PASS'
Assert-True ($allPass.Messages -contains 'CRITERIA: C1 PASS, C2 PASS') 'summary line lists criteria'
Assert-True ($allPass.Criteria[0].id -eq 'C1' -and $allPass.Criteria[0].status -eq 'PASS' -and $allPass.Criteria[0].reason -eq 'warning printed') 'criterion fields parsed'
Assert-True ((@($allPass.Criteria[0].PSObject.Properties.Name) -join ',') -ceq 'id,status,reason') 'criterion schema'

$override = Resolve-ReviewVerdict "CRITERIA:`nC1: PASS - ok`nC2: FAIL - no prompt line`nC3: FAIL - missing test`nVERDICT: PASS"
Assert-True ($override.Code -eq 1 -and $override.Verdict -eq 'FAIL' -and $override.VerdictLine -eq 'VERDICT: FAIL') 'criterion FAIL overrides reviewer PASS'
Assert-True (($override.Messages -contains 'VERDICT OVERRIDE: criterion C2 FAIL') -and ($override.Messages -contains 'VERDICT OVERRIDE: criterion C3 FAIL')) 'override lines printed'
$alreadyFail = Resolve-ReviewVerdict "CRITERIA:`nC1: FAIL - x`nVERDICT: FAIL"
Assert-True ($alreadyFail.Code -eq 1 -and -not ($alreadyFail.Messages -match 'OVERRIDE')) 'no override line when reviewer already said FAIL'
$noVerdictFail = Resolve-ReviewVerdict "Not verified`nCRITERIA:`nC1: FAIL - x"
Assert-True ($noVerdictFail.Code -eq 1) 'criterion FAIL decides an answer without a verdict'

$unknown = Resolve-ReviewVerdict "CRITERIA:`nC1: PASS - ok`nC2: UNKNOWN - not in diff`nC3: unknown - unclear`nVERDICT: PASS"
Assert-True ($unknown.Code -eq 6 -and $unknown.VerdictLine -eq 'VERDICT: INCOMPLETE (UNKNOWN criteria: C2, C3)' -and $unknown.CriteriaStatus -eq 'incomplete') 'UNKNOWN criteria return INCOMPLETE'
Assert-True ($unknown.Verdict -eq 'UNKNOWN') 'INCOMPLETE maps to UNKNOWN for the log'

$missing = Resolve-ReviewVerdict "All good.`nVERDICT: PASS" -ExpectedIds @('C1')
Assert-True ($missing.Code -eq 0 -and $missing.Criteria.Count -eq 0 -and $missing.VerdictLine -eq 'VERDICT: PASS (criteria not reported)' -and $missing.CriteriaStatus -eq 'none') 'missing block keeps verdict logic'
Assert-True ($missing.Messages -contains 'CRITERIA: no per-criterion verdicts') 'missing block note printed'
$missingFail = Resolve-ReviewVerdict "- [P1] Broken - a.ps1:1" -ExpectedIds @('C1')
Assert-True ($missingFail.Code -eq 1 -and $missingFail.Criteria.Count -eq 0 -and $missingFail.VerdictLine -eq 'VERDICT: FAIL (criteria not reported)') 'missing block keeps tag-based FAIL'
$empty = Resolve-ReviewVerdict ''
Assert-True ($empty.Code -eq 3 -and $empty.VerdictLine -eq 'VERDICT: UNKNOWN (no verdict line)') 'empty answer stays UNKNOWN'
$garbled = @(Get-ReviewCriteria "CRITERIA:`nthe reviewer wrote prose here`nC1: PASS")
Assert-True ($garbled.Count -eq 1) 'unexpected prose does not hide following criteria'

$messy = @(Get-ReviewCriteria "**CRITERIA:**`n  - C1 :   pass   -   spaced out  `n* **C2**: Fail - bold id`n`nC3: unknown`nVERDICT: FAIL")
Assert-True ($messy.Count -eq 3 -and $messy[0].status -eq 'PASS' -and $messy[0].reason -eq 'spaced out' -and $messy[1].id -eq 'C2' -and $messy[1].status -eq 'FAIL' -and $messy[2].status -eq 'UNKNOWN' -and $messy[2].reason -eq '') 'extra spaces, bullets, bold and lower-case status'
$twoBlocks = @(Get-ReviewCriteria "CRITERIA:`nC1: FAIL - draft`nlater...`nCRITERIA:`nC1: PASS - final")
Assert-True ($twoBlocks.Count -eq 1 -and $twoBlocks[0].status -eq 'PASS') 'last CRITERIA block wins'
Assert-True (@(Get-ReviewCriteria "SUCCESS CRITERIA:`nC1: FAIL - echoed packet").Count -eq 0) 'packet heading is not a reviewer block'

# Coverage comes from top-level numeric ids, not subitems or subsequent sections.
$specText = "GOAL: fixture`nSUCCESS CRITERIA:`n1. first`n   a) detail`n   2. nested`n3. third`nFILES:`n4. not a criterion"
$ids = @(Get-ExpectedReviewCriteria $specText)
Assert-True (($ids -join ',') -eq 'C1,C3') 'expected ids only from top-level success criteria'
$partial = Resolve-ReviewVerdict "CRITERIA:`nC1: PASS`nVERDICT: PASS" -ExpectedIds $ids
Assert-True ($partial.Code -eq 6 -and $partial.VerdictLine -eq 'VERDICT: INCOMPLETE (missing criteria: C3)') 'missing expected id is incomplete'
$complete = Resolve-ReviewVerdict "CRITERIA:`nC1: PASS`nprose`nC3: PASS`nVERDICT: PASS" -ExpectedIds $ids
Assert-True ($complete.Code -eq 0 -and $complete.CriteriaStatus -eq 'complete') 'all expected ids PASS is complete'
$duplicate = Resolve-ReviewVerdict "CRITERIA:`nC1: PASS`nC01: PASS`nC3: PASS`nVERDICT: PASS" -ExpectedIds $ids
Assert-True ($duplicate.Code -eq 6 -and $duplicate.Criteria.Count -eq 3 -and $duplicate.VerdictLine -match 'duplicated criteria: C1') 'duplicate ids retained and incomplete'
$failWins = Resolve-ReviewVerdict "CRITERIA:`nC1: UNKNOWN`nVERDICT: FAIL" -ExpectedIds $ids
Assert-True ($failWins.Code -eq 1 -and $failWins.VerdictLine -eq 'VERDICT: FAIL' -and $failWins.CriteriaStatus -eq 'incomplete') 'reviewer FAIL wins over incomplete'
$duplicateFail = Resolve-ReviewVerdict "CRITERIA:`nC1: PASS`nC1: FAIL`nC3: PASS`nVERDICT: PASS" -ExpectedIds $ids
Assert-True ($duplicateFail.Code -eq 1 -and $duplicateFail.CriteriaStatus -eq 'incomplete') 'duplicate FAIL is not hidden by earlier PASS'
$emptyBlock = Resolve-ReviewVerdict "CRITERIA:`njust prose`nVERDICT: PASS" -ExpectedIds $ids
Assert-True ($emptyBlock.Code -eq 6) 'empty block with expected ids is incomplete'
$promptOnly = Resolve-ReviewVerdict 'VERDICT: PASS'
Assert-True ($promptOnly.Code -eq 0 -and $promptOnly.VerdictLine -eq 'VERDICT: PASS' -and $promptOnly.CriteriaStatus -eq 'n/a') 'Prompt-only review without criteria remains unchanged'

$promptUnknown = Resolve-ReviewVerdict "CRITERIA:`nC1: UNKNOWN`nVERDICT: PASS" -CriteriaApplicable:$false
Assert-True ($promptUnknown.Code -eq 0 -and $promptUnknown.CriteriaStatus -eq 'n/a' -and $promptUnknown.VerdictLine -eq 'VERDICT: PASS (with UNKNOWN criteria: C1)') 'Prompt-only unknown criteria preserve prior verdict behavior'

# --- Paths warning with a temp git repo ---
$fixture = New-TestFolder
$savedPreference = $ErrorActionPreference
try {
  $repo = Join-Path $fixture 'repo'
  [void][IO.Directory]::CreateDirectory($repo)
  $ErrorActionPreference = 'Continue'
  & git -C $repo init -q 2>$null
  & git -C $repo config user.email 'test@example.invalid'
  & git -C $repo config user.name 'test'
  & git -C $repo config core.autocrlf false
  [void][IO.Directory]::CreateDirectory((Join-Path $repo 'src'))
  [void][IO.Directory]::CreateDirectory((Join-Path $repo 'web'))
  [IO.File]::WriteAllText((Join-Path $repo 'src\a.js'), "a`n")
  [IO.File]::WriteAllText((Join-Path $repo 'web\b.js'), "b`n")
  & git -C $repo add -A 2>$null
  & git -C $repo commit -q -m init 2>$null
  $ErrorActionPreference = $savedPreference
  [IO.File]::WriteAllText((Join-Path $repo 'src\a.js'), "a2`n")
  [IO.File]::WriteAllText((Join-Path $repo 'web\b.js'), "b2`n")
  [IO.File]::WriteAllText((Join-Path $repo 'web\new.js'), "n`n")
  $Base = $null
  $Paths = @('src')
  $excluded = @(Get-PathsExcludedFiles $repo)
  Assert-True ($excluded.Count -eq 2 -and $excluded -contains 'web/b.js' -and $excluded -contains 'web/new.js') 'excluded tracked and untracked files listed'
  Assert-True ((Get-PathsScopeNote $excluded) -like 'Other files in this change are outside the reviewed diff on purpose.*review only what is shown.') 'prompt line added when files are excluded'
  $Paths = @('src', 'web')
  $none = @(Get-PathsExcludedFiles $repo)
  Assert-True ($none.Count -eq 0 -and (Get-PathsScopeNote $none) -eq '') 'nothing excluded: no warning, no prompt line'
  $Paths = @()
  Assert-True (@(Get-PathsExcludedFiles $repo).Count -eq 0) 'no -Paths: no warning'

  # End-to-end through the real entry point (gates only, no Codex).
  $script = Join-Path $PSScriptRoot '..\bin\codex-review.ps1'
  $logBefore = $env:CODEX_REVIEW_LOG
  $env:CODEX_REVIEW_LOG = Join-Path $fixture 'reviews.jsonl'
  try {
    $out = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $script -Dir $repo -SkipModel -SkipGates -Paths 'src' *>&1 | ForEach-Object { "$_" })
    Assert-True ($LASTEXITCODE -eq 0 -and ($out -contains 'PATHS WARNING: 2 changed file(s) outside -Paths: web/b.js, web/new.js')) 'script prints PATHS WARNING'
    # -File cannot pass a string array; -Command binds -Paths as two pathspecs.
    $out = @(& powershell -NoProfile -ExecutionPolicy Bypass -Command "& '$script' -Dir '$repo' -SkipModel -SkipGates -Paths 'src','web'; exit `$LASTEXITCODE" *>&1 | ForEach-Object { "$_" })
    Assert-True ($LASTEXITCODE -eq 0 -and ($out -contains 'VERDICT: GATES-PASS (no model review)') -and -not ($out -match 'PATHS WARNING')) 'script prints no warning when nothing is excluded'

    # --- JSONL log contains criteria ---
    $Dir = $fixture; $SpecFile = 'packet.md'; $Model = 'fixture'; $Effort = 'high'
    $gateResults = [ordered]@{lint='PASS'}; $utf8NoBom = New-Object Text.UTF8Encoding($false)
    $reviewAnswer = "CRITERIA:`nC1: PASS - ok`nC2: FAIL - broken`nVERDICT: PASS"; $exitCode = 1
    $SkipModel = $false; $criteriaStatus = 'complete'
    Write-ReviewLog
    $reviewAnswer = 'VERDICT: PASS'; $exitCode = 0; $criteriaStatus = 'none'
    Write-ReviewLog
    $lines = [IO.File]::ReadAllLines($env:CODEX_REVIEW_LOG)
    $withCriteria = $lines[$lines.Count - 2] | ConvertFrom-Json
    $without = $lines[$lines.Count - 1] | ConvertFrom-Json
    Assert-True ($withCriteria.criteria -eq 'complete' -and $withCriteria.mode -eq 'model' -and $withCriteria.criterionResults.Count -eq 2 -and $withCriteria.criterionResults[1].id -eq 'C2' -and $withCriteria.criterionResults[1].status -eq 'FAIL' -and $withCriteria.criterionResults[1].reason -eq 'broken') 'reviews.jsonl entry contains criteria'
    Assert-True ($lines[$lines.Count - 1] -match '"criterionResults":\[\]' -and $without.findings.Count -eq 0 -and $without.criteria -eq 'none') 'reviews.jsonl records none and empty criterion results'
  } finally { $env:CODEX_REVIEW_LOG = $logBefore }
} finally { $ErrorActionPreference = $savedPreference; Remove-TestFolder $fixture }
Complete-Tests
