[CmdletBinding(DefaultParameterSetName='Direct')]
param(
  [ValidateSet(2,3)][int]$Layer,
  [Parameter(ParameterSetName='Direct')][ValidateSet('P0','P1','P2','P3')][string]$Severity,
  [Parameter(ParameterSetName='Direct')][string]$Category,
  [Parameter(ParameterSetName='Direct')][string]$Title,
  [Parameter(ParameterSetName='Direct')][string]$Location,
  [Parameter(ParameterSetName='Direct')][string]$Criterion,
  [Parameter(ParameterSetName='Direct')][string]$RunId,
  [Parameter(ParameterSetName='Direct')][string]$Quote,
  [Parameter(ParameterSetName='FromFile')][string]$FromFile,
  [string]$SpecFile,
  [string]$Reviewer,
  [ValidateSet('fable','supervisor','codex-review','other')][string]$Source,
  [string]$Dir,
  [string]$StateDir = $(if ($env:CODEX_DO_STATE_DIR) { $env:CODEX_DO_STATE_DIR } else { Join-Path $env:USERPROFILE '.claude\state' })
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'review-findings-lib.ps1')
# Intent: append validated facts and report invalid structured items for Line. Status: implemented.
# Next: supervisor records Fable/L3 reviews. Blockers: none. Confidence: invalid-input and batch fixtures.
if (-not $PSBoundParameters.ContainsKey('Layer')) { throw 'finding-add: Layer is required (2 or 3).' }
# This rule applies to command parameters, not to parsed review text.
foreach ($value in $PSBoundParameters.Values) {
  if ([string]$value -match '[|\r\n\u2028\u2029\x0B\x0C]') { throw 'finding-add: parameters must not contain pipes or line separators.' }
}
if ($PSCmdlet.ParameterSetName -eq 'FromFile') {
  if ([string]::IsNullOrWhiteSpace($FromFile) -or [string]::IsNullOrWhiteSpace($Reviewer)) {
    throw 'finding-add: FromFile and Reviewer are required for a review file.'
  }
  $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($FromFile)
  $structured = Get-StructuredFindings -Text ([IO.File]::ReadAllText($full, [Text.Encoding]::UTF8))
  if ($structured.Status -ne 'ok') {
    [Console]::Error.WriteLine('finding-add: findings block ' + $structured.Status)
    exit 1
  }
  $findings = @($structured.Findings)
  foreach ($invalidIndex in $structured.InvalidIndexes) {
    [Console]::Error.WriteLine("finding-add: finding index $invalidIndex failed the schema (zero-based)")
  }
} else {
  if ([string]::IsNullOrWhiteSpace($Severity) -or [string]::IsNullOrWhiteSpace($Category) -or [string]::IsNullOrWhiteSpace($Title)) {
    throw 'finding-add: Severity, Category and Title are required.'
  }
  if (@(Get-ReviewDefectCategories) -cnotcontains $Category) { throw "finding-add: unknown category '$Category'." }
  $findings = @([pscustomobject]@{ severity=$Severity.ToUpperInvariant(); category=$Category; title=$Title; location=$Location; block=$Quote })
}
foreach ($finding in $findings) {
  if ([string]::IsNullOrWhiteSpace($finding.title)) { throw 'finding-add: every finding must have a Title.' }
}
if (-not $findings.Count) {
  if ($PSCmdlet.ParameterSetName -eq 'FromFile' -and $structured.Violations -gt 0) { exit 1 }
  return
}
$specSha = Get-FindingSpecSha -SpecFile $SpecFile
$source = if ($Source) { $Source.ToLowerInvariant() } elseif ($Layer -eq 2) { 'fable' } else { 'supervisor' }
$facts = @(
  foreach ($finding in $findings) {
    $utc = [DateTime]::UtcNow.ToString('o')
    $findingCriterion = if ($PSCmdlet.ParameterSetName -eq 'FromFile') { $finding.criterion } else { $Criterion }
    $findingQuote = if ($PSCmdlet.ParameterSetName -eq 'FromFile') { $null } else { $Quote }
    New-FindingFact -Utc $utc -IdSeed $finding.title -Source $source -Layer $Layer `
      -Severity $finding.severity -Category $finding.category -Title $finding.title -Location $finding.location `
      -Criterion $findingCriterion -Reviewer $Reviewer -Dir $Dir -SpecFile $SpecFile -SpecSha $specSha -RunId $RunId -Quote $findingQuote
  }
)
Add-FindingFacts -Path (Join-Path $StateDir 'findings.jsonl') -Facts $facts
if ($PSCmdlet.ParameterSetName -eq 'FromFile' -and $structured.Violations -gt 0) { exit 1 }
