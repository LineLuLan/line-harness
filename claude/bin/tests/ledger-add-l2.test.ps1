# Self-test: ledger-add -L2 handling when called through powershell -File (empty args are dropped by PS 5.1).
param([string]$Script = (Join-Path $PSScriptRoot '..\ledger-add.ps1'))
$ErrorActionPreference = 'Continue'  # native stderr must not become a terminating error
$log = Join-Path ([IO.Path]::GetTempPath()) ("ledger-l2-" + [guid]::NewGuid().ToString('n') + '.log')
$common = @('-Tier','Skip','-L1','pass','-L3','pass','-Note','t','-Worker','opus','-Type','config','-FailRounds','0','-Findings','L1:0,L2:0,L3:0','-Path',$log)
$fail = 0
function Check($name, $cond) { if ($cond) { "PASS $name" } else { "FAIL $name"; $script:fail++ } }
try {
  $out = & powershell -NoProfile -File $Script -Layer2 no @common 2>&1; $code = $LASTEXITCODE
  Check 'layer2=no without -L2 writes skipped' ($code -eq 0 -and "$out" -match '\|no\|pass\|skipped\|pass\|')
  # -L2:'' arrives as "-L2:" and swallows the next parameter name as its value; it must be rejected, not written.
  $out = & powershell -NoProfile -File $Script -Layer2 no -L2:'' @common 2>&1; $code = $LASTEXITCODE
  Check 'colon-empty -L2 that swallows -L1 is rejected' ($code -ne 0 -and "$out" -match 'is a parameter name')
  $out = & powershell -NoProfile -File $Script -Layer2 yes @common 2>&1; $code = $LASTEXITCODE
  Check 'layer2=yes without -L2 is rejected' ($code -ne 0 -and "$out" -match 'L2 is required')
  $out = & powershell -NoProfile -File $Script -Layer2 yes -L2 'Astra PASS' @common 2>&1; $code = $LASTEXITCODE
  Check 'layer2=yes with -L2 keeps value' ($code -eq 0 -and "$out" -match '\|yes\|pass\|Astra PASS\|pass\|')
  $lines = @(Get-Content -LiteralPath $log)
  Check 'exactly 2 lines written (rejected calls write nothing)' ($lines.Count -eq 2)
  # Intent: enforce Line's mandatory review tiers before any append. Status: regression cases.
  # Next: supervisor installation. Blockers: none. Confidence: child exits and exact file contents.
  foreach ($tier in @('Important', 'Critical')) {
    $tierArgs = $common.Clone(); $tierArgs[1] = $tier
    $before = [IO.File]::ReadAllText($log)
    $out = & powershell -NoProfile -File $Script -Layer2 no @tierArgs 2>&1; $code = $LASTEXITCODE
    Check "$tier without layer 2 rejects with guidance" ($code -ne 0 -and "$out" -match "Layer 2 is mandatory at $tier; pass -Waiver")
    Check "$tier rejection leaves file unchanged" ([IO.File]::ReadAllText($log) -ceq $before)
    $out = & powershell -NoProfile -File $Script -Layer2 no -Waiver 'STOP before code' @tierArgs 2>&1; $code = $LASTEXITCODE
    Check "$tier waiver appends note suffix" ($code -eq 0 -and [IO.File]::ReadAllLines($log)[-1].Contains('|t [waiver: STOP before code]|'))
  }
  $tierArgs = $common.Clone(); $tierArgs[1] = 'Standard-B'
  $out = & powershell -NoProfile -File $Script -Layer2 no @tierArgs 2>&1; $code = $LASTEXITCODE
  Check 'Standard-B without layer 2 unchanged' ($code -eq 0 -and "$out" -match '\|Standard-B\|no\|pass\|skipped\|pass\|t\|')
  $before = [IO.File]::ReadAllText($log)
  foreach ($waiver in @('a|b', "a`nb", ' ', ('x' * 121), '-Waiver')) {
    try {
      $null = & $Script -Tier Important -Layer2 no -L1 pass -L3 pass -Note t -Worker opus -Type config -FailRounds 0 -Findings 'L1:0,L2:0,L3:0' -Path $log -Waiver $waiver -ErrorAction Stop
      Check 'invalid waiver rejected' $false
    } catch { Check 'invalid waiver rejected' $true }
  }
  Check 'invalid waivers leave file unchanged' ([IO.File]::ReadAllText($log) -ceq $before)
} finally { Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue }
if ($fail) { "FAILED: $fail"; exit 1 } else { 'ALL PASS'; exit 0 }
