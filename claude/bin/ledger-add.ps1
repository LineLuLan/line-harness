[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Skip','Standard-A','Standard-B','Important','Critical','Exploration')][string]$Tier,
  [Parameter(Mandatory=$true)][ValidateSet('yes','no')][string]$Layer2,
  [Parameter(Mandatory=$true)][AllowEmptyString()][string]$L1,
  [AllowEmptyString()][string]$L2 = '',
  [Parameter(Mandatory=$true)][AllowEmptyString()][string]$L3,
  [Parameter(Mandatory=$true)][AllowEmptyString()][string]$Note,
  [Parameter(Mandatory=$true)][string]$Worker,
  [Parameter(Mandatory=$true)][ValidateSet('ui','collector','review','research','docs','config','other')][string]$Type,
  [Parameter(Mandatory=$true)][ValidateRange(0,2147483647)][int]$FailRounds,
  [Parameter(Mandatory=$true)][ValidatePattern('\AL1:[0-9]+,L2:[0-9]+,L3:[0-9]+\z')][string]$Findings,
  [string[]]$RunIds = @(),
  [string]$SpecFile,
  [string]$RunsRoot = (Join-Path $env:USERPROFILE '.claude\state\runs'),
  [string]$Path = (Join-Path $env:USERPROFILE '.claude\state\review-ledger.log')
)
$ErrorActionPreference = 'Stop'
if ($Findings -cnotmatch '\AL1:[0-9]+,L2:[0-9]+,L3:[0-9]+\z') { throw 'Findings must be L1:n,L2:n,L3:n.' }
$Tier = @('Skip','Standard-A','Standard-B','Important','Critical','Exploration') | Where-Object { $_ -ieq $Tier } | Select-Object -First 1
$Layer2 = $Layer2.ToLowerInvariant()
$Type = $Type.ToLowerInvariant()
foreach ($value in @($L1,$L2,$L3,$Note,$Worker)) {
  if ($value -match '\A-(Tier|Layer2|L1|L2|L3|Note|Worker|Type|FailRounds|Findings|RunIds|SpecFile|RunsRoot|Path)\z') { throw "Value '$value' is a parameter name: an empty argument was dropped. Omit -L2 instead of passing ''." }
}
# PS 5.1 drops '' arguments under powershell -File, so -L2 is optional: layer2=no means 'skipped'.
if (-not $L2) {
  if ($Layer2 -eq 'no') { $L2 = 'skipped' } else { throw 'L2 is required when -Layer2 yes (the layer-2 review verdict).' }
}
# Intent: link a ledger line to the codex-do runs of its packet (runs=<id>,...) for Line Hub.
# Status: hash match on run.json specSha256; stdin.txt text match for runs without it.
# Next: none. Blockers: none. Confidence: fixture tests (hash, fallback, age, no match).
function ConvertTo-SpecLines([string]$Text) {
  $lines = @(($Text -replace "`r`n", "`n" -replace "`r", "`n") -split "`n" | ForEach-Object { $_.TrimEnd() })
  $end = $lines.Count
  while ($end -gt 0 -and $lines[$end - 1] -eq '') { $end-- }
  if ($end -eq 0) { return ,@() }
  return ,@($lines[0..($end - 1)])
}
if ($SpecFile -and -not $RunIds.Count) {
  $specFull = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SpecFile)
  if (-not [IO.File]::Exists($specFull)) { throw "SpecFile not found: $SpecFile" }
  $specBytes = [IO.File]::ReadAllBytes($specFull)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $specHash = -join ($hasher.ComputeHash($specBytes) | ForEach-Object { $_.ToString('x2') }) } finally { $hasher.Dispose() }
  $specText = (ConvertTo-SpecLines ([IO.File]::ReadAllText($specFull, [Text.Encoding]::UTF8))) -join "`n"
  $cutoff = (Get-Date).ToUniversalTime().AddDays(-14)
  $matched = @()
  $root = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RunsRoot)
  if ([IO.Directory]::Exists($root)) {
    foreach ($folder in (Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -cmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z' })) {
      $metaPath = Join-Path $folder.FullName 'run.json'
      if (-not [IO.File]::Exists($metaPath)) { continue }
      try {
        $meta = [IO.File]::ReadAllText($metaPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $started = ([datetime]$meta.startedUtc).ToUniversalTime()
      } catch { continue }
      if ($started -lt $cutoff) { continue }
      $isMatch = $false
      if ($meta.PSObject.Properties['specSha256'] -and $meta.specSha256) {
        $isMatch = [string]$meta.specSha256 -ieq $specHash
      } else {
        $stdinPath = Join-Path $folder.FullName 'stdin.txt'
        if ([IO.File]::Exists($stdinPath)) {
          $stdinLines = ConvertTo-SpecLines ([IO.File]::ReadAllText($stdinPath, [Text.Encoding]::UTF8))
          $isMatch = ($stdinLines -join "`n") -ceq $specText
          # codex-do appends "CONSTRAINTS: Do not spawn sub-agents." when the packet lacks it.
          if (-not $isMatch -and $stdinLines.Count -and $stdinLines[-1] -match '\A\s*(CONSTRAINTS:\s*)?Do not spawn sub-agents\.\z') {
            $trimmed = if ($stdinLines.Count -gt 1) { ConvertTo-SpecLines ($stdinLines[0..($stdinLines.Count - 2)] -join "`n") } else { @() }
            $isMatch = ($trimmed -join "`n") -ceq $specText
          }
        }
      }
      if ($isMatch) { $matched += [pscustomobject]@{ Id = $folder.Name; Started = $started } }
    }
  }
  $RunIds = @($matched | Sort-Object Started, Id | ForEach-Object { $_.Id })
  if (-not $RunIds.Count) { [Console]::Error.WriteLine('ledger-add: warning: no codex-do run matched the spec') }
}
# Intent: one validated UTF-8 record per call, including concurrent completions.
# Status: append under exclusive writer access. Next: supervisor installation.
# Blockers: none. Confidence: format, rejection and encoding tests.
foreach ($value in (@($Tier,$Layer2,$L1,$L2,$L3,$Note,$Worker,$Type,$Findings) + $RunIds)) {
  if ($value -match '[|\r\n\u2028\u2029\x0B\x0C]') { throw 'Ledger values must not contain pipes or line separators.' }
}
$line = '{0}|{1}|{2}|{3}|{4}|{5}|{6}|worker={7}|type={8}|fail_rounds={9}|findings={10}' -f
  (Get-Date -Format 'yyyy-MM-dd'), $Tier, $Layer2, $L1, $L2, $L3, $Note, $Worker, $Type, $FailRounds, $Findings
if ($RunIds.Count) { $line += '|runs=' + ($RunIds -join ',') }
$full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
[void][IO.Directory]::CreateDirectory((Split-Path -Parent $full))
$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($line + "`n")
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  $stream = $null
  try {
    $stream = [IO.File]::Open($full, 'Append', 'Write', 'Read')
  } catch [IO.IOException] {
    if ($attempt -eq 39) { throw }
    Start-Sleep -Milliseconds 25
    continue
  }
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  break
}
Write-Output $line
