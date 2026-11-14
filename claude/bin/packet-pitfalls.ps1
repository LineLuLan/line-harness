# Intent: supply certified rules and recent category advisories before dispatch.
# Status: complete. Next: P3 lesson certification. Blockers: none. Confidence: isolated fixtures.
param(
  [Parameter(Mandatory=$true)][string]$Tier,
  [string]$Type,
  [string]$StateDir = (Join-Path $HOME '.claude\state'),
  [string]$Ontology = ''
)
# Touch-up 2026-11-15 (live e2e, ps51-traps): $PSScriptRoot is empty in a param default under powershell -File on 5.1.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Ontology) { $Ontology = Join-Path $scriptDir '..\ontology\harness.ontology.json' }
. (Join-Path $scriptDir 'packet-lint.ps1')
$Tier = Get-PacketTier $Tier
$StateDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($StateDir)

# Intent: accept JSON timestamps from both Windows PowerShell and newer parsers.
# Status: complete. Next: none. Blockers: none. Confidence: string and datetime fixtures.
function ConvertTo-PacketFindingUtc {
  param([object]$Value)
  if ($Value -is [datetime]) { return [DateTimeOffset]($Value.ToUniversalTime()) }
  if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') { return $null }
  $utc = [DateTimeOffset]::MinValue
  if ([DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None, [ref]$utc)) { return $utc.ToUniversalTime() }
  return $null
}

# Intent: count only dated finding facts in the past 14 days, including legacy rows.
# Status: complete. Next: none. Blockers: none. Confidence: malformed/date/kind fixtures.
function Get-RecentPacketFindingCounts {
  param([string]$Path)
  $counts = New-Object 'Collections.Generic.Dictionary[string,int]'
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $counts }
  $now = [DateTimeOffset]::UtcNow
  $cutoff = $now.AddDays(-14)
  foreach ($line in [IO.File]::ReadLines($Path)) {
    # ConvertFrom-Json unwraps singleton arrays in 5.1; only object lines are facts.
    if (-not $line.TrimStart().StartsWith('{')) { continue }
    try { $row = ConvertFrom-Json -InputObject $line -ErrorAction Stop } catch { continue }
    if ($null -eq $row -or $row -isnot [pscustomobject]) { continue }
    if ($null -ne $row.PSObject.Properties['kind'] -and $row.kind -cne 'finding') { continue }
    $utc = ConvertTo-PacketFindingUtc -Value $row.utc
    if ($null -eq $utc) { continue }
    if ($utc -lt $cutoff -or $utc -gt $now -or $row.category -isnot [string] -or -not $row.category) { continue }
    if (-not $counts.ContainsKey($row.category)) { $counts[$row.category] = 0 }
    $counts[$row.category]++
  }
  return $counts
}

$knowledge = $null
try {
  if (Test-Path -LiteralPath $Ontology -PathType Leaf -ErrorAction Stop) {
    $knowledge = Get-Content -LiteralPath $Ontology -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  }
} catch { [Console]::Error.WriteLine('ontology unreadable: lesson checks skipped') }
$lines = New-Object 'Collections.Generic.List[string]'
$lessons = @(Get-ApplicablePacketLessons -Lessons $knowledge.lessons -Tier $Tier -Type $Type)
foreach ($lesson in $lessons) { $lines.Add("- [$($lesson.id)] $($lesson.rule)") }
$counts = Get-RecentPacketFindingCounts -Path (Join-Path $StateDir 'findings.jsonl')
$order = 0
$advisories = @(foreach ($category in $knowledge.defectCategories) {
  if ($category.id -cne 'other' -and $counts[$category.id] -ge 3 -and @($lessons | Where-Object { $_.category -ceq $category.id }).Count -eq 0) {
    [pscustomobject]@{ Category = $category; Count = $counts[$category.id]; Order = $order }
  }
  $order++
})
foreach ($advisory in @($advisories | Sort-Object @{ Expression = 'Count'; Descending = $true }, Order | Select-Object -First 5)) {
  $category = $advisory.Category
  $lines.Add("- [$($category.id)] $($category.countermeasure) (advisory: $($advisory.Count) findings in 14 days)")
}
if ($advisories.Count -gt 5) { $lines.Add("- advisory: $($advisories.Count - 5) more categories with 3+ findings omitted") }
if ($lines.Count) { 'KNOWN PITFALLS:'; $lines.ToArray() } else { 'KNOWN PITFALLS: none recorded' }
