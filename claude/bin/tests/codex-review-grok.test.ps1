# Intent: prove codex-review.ps1 sends layer-2 review to fake grok (never real grok or codex) and leaves Dir bytes unchanged. Status: K6b. Next: host real grok review. Blockers: none. Confidence: temp cache, temp accounts, fake-grok argv.
$ErrorActionPreference = 'Stop'
$bin = Split-Path -Parent $PSScriptRoot
$review = Join-Path $bin 'codex-review.ps1'
$fake = Join-Path $PSScriptRoot 'fixtures\fake-grok.cmd'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = Join-Path ([IO.Path]::GetTempPath()) ('codex-review-grok-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $root 'repo'
$cacheDir = Join-Path $root 'cache'
$stateDir = Join-Path $root 'state'
$profile = Join-Path $root 'profile'
$accRoot = Join-Path $root 'accounts'
$mainHome = Join-Path $root 'main-home'
$codexHome = Join-Path $root 'codex-home'
$logPath = Join-Path $root 'logs\reviews.jsonl'
$argvPath = Join-Path $root 'fake-argv.txt'
$envPath = Join-Path $root 'fake-env.txt'
$specPath = Join-Path $root 'packet.md'
$ontologyPath = Join-Path $root 'ontology.json'
$missingBin = Join-Path $root 'missing-codex.exe'
$missingGrok = Join-Path $root 'missing-grok.exe'
$script:failed = 0
$saved = @{}
foreach ($name in @(
  'CODEX_DO_ENGINE','CODEX_DO_USAGE_CACHE_DIR','CODEX_DO_STATE_DIR','ULTRATHINK_ONTOLOGY','CODEX_REVIEW_LOG',
  'GROK_DO_BIN','CODEX_DO_BIN','USERPROFILE','CODEX_ACC_ROOT','CODEX_ACC_MAIN_HOME','CODEX_HOME',
  'FAKE_GROK_ARGV','FAKE_GROK_ANSWER','FAKE_GROK_EXIT','FAKE_GROK_ENV','CODEX_DO_NO_FALLBACK'
)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Assert-Review($Condition, [string]$Name, [string]$Detail) {
  if ($Condition) { Write-Host "PASS: $Name"; return }
  $script:failed++
  Write-Host "FAIL: $Name"
  if ($Detail) { Write-Host $Detail }
}
function Set-TestEnv([string]$Name, [string]$Value) {
  if ($null -eq $Value -or $Value -eq '') { Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue }
  else { Set-Item -Path "Env:$Name" -Value $Value }
}
function Write-Cache([int]$Used) {
  Write-CacheFile (Join-Path $cacheDir 'codex-usage.json') $Used
}
function Write-Answer([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, $utf8)
}
function Set-Fake([string]$AnswerPath, [string]$ExitCode) {
  Set-TestEnv 'FAKE_GROK_ARGV' $argvPath
  Set-TestEnv 'FAKE_GROK_ANSWER' $AnswerPath
  Set-TestEnv 'FAKE_GROK_EXIT' $ExitCode
  Set-TestEnv 'FAKE_GROK_ENV' $envPath
  if (Test-Path -LiteralPath $argvPath) { Remove-Item -LiteralPath $argvPath -Force }
  if (Test-Path -LiteralPath $envPath) { Remove-Item -LiteralPath $envPath -Force }
}
function Get-FakeEnv {
  if (Test-Path -LiteralPath $envPath) { return [IO.File]::ReadAllText($envPath) }
  return ''
}
function Write-CacheFile([string]$Path, [int]$Used) {
  $json = '{"weekly":{"usedPercent":' + $Used + ',"resetsAt":1893456000}}'
  [IO.File]::WriteAllText($Path, $json, $utf8)
}
function Invoke-GrokReview([string[]]$Arguments) {
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $review @Arguments 2>&1)
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = (($output | ForEach-Object { "$_" }) -join "`n") }
  } finally { $ErrorActionPreference = $savedPreference }
}
function Get-LastLog {
  $line = @(Get-Content -LiteralPath $logPath | Where-Object { $_.Trim() })[-1]
  return ($line | ConvertFrom-Json)
}
function Get-RepoStamp([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $items = New-Object System.Collections.Generic.List[string]
  foreach ($entry in (New-Object IO.DirectoryInfo($full)).EnumerateFileSystemInfos('*', [IO.SearchOption]::AllDirectories)) {
    $relative = $entry.FullName.Substring($full.Length + 1).Replace('\', '/')
    if ($relative -eq '.git' -or $relative.StartsWith('.git/')) { continue }
    if ($entry -is [IO.DirectoryInfo]) { $items.Add('D ' + $relative) }
    else { $items.Add('F ' + $relative + ' ' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($entry.FullName))) }
  }
  $array = $items.ToArray()
  [Array]::Sort($array, [StringComparer]::Ordinal)
  return ($array -join "`n")
}
function Assert-GrokArgv([string]$Argv, [string]$Model, [string]$Effort, [string]$EnvText) {
  # Intent: K6b-fix1 - quoted flag/value pairs, plus the read-only plan's MCP deny list and child env. Status: fix1. Next: none. Blockers: none. Confidence: fake argv and set GROK_ file.
  $pairs = @(
    @('-m', $Model),
    @('--effort', $Effort),
    @('--output-format', 'plain'),
    @('--sandbox', 'read-only'),
    @('--tools', 'read_file,grep,list_dir'),
    @('--disallowed-tools', 'run_terminal_cmd,search_replace,write,Agent,use_tool,search_tool'),
    @('--max-turns', '80'),
    @('--deny', 'MCPTool(*)')
  )
  foreach ($pair in $pairs) {
    $needle = '"' + $pair[0] + '" "' + $pair[1] + '"'
    if (-not $Argv.Contains($needle)) { return "missing $needle" }
  }
  foreach ($flag in @('--prompt-file','--cwd','--always-approve','--no-plan','--disable-web-search','--no-subagents','--no-auto-update')) {
    $needle = '"' + $flag + '"'
    if (-not $Argv.Contains($needle)) { return "missing $needle" }
  }
  if ($EnvText -notmatch '(?m)^GROK_CLAUDE_MCPS_ENABLED=false\s*$') { return 'missing GROK_CLAUDE_MCPS_ENABLED=false' }
  if ($EnvText -notmatch '(?m)^GROK_CURSOR_MCPS_ENABLED=false\s*$') { return 'missing GROK_CURSOR_MCPS_ENABLED=false' }
  return ''
}

$passAnswer = @'
CRITERIA:
C1: PASS - the line stays
VERDICT: PASS
```findings
[]
```
'@
$failAnswer = @'
CRITERIA:
C1: FAIL - wrong result
[P1] sample bug - a.txt:1
VERDICT: FAIL
```findings
[{"severity":"P1","category":"logic-bug","title":"sample bug","location":"a.txt:1","criterion":"C1"}]
```
'@
$bareAnswer = @'
The diff looks fine.
No explicit verdict is present.
'@
$packet = @'
TIER: Important | TYPE: review
GOAL: review the diff
SUCCESS CRITERIA:
1. The reviewed line stays.
FILES: a.txt
CONSTRAINTS: local
NON-GOALS: none
DONE WHEN: tested
VALIDATE: n/a
STOP RULES: stop
PACKET CHECK: ok
DOCS CHECKED: n/a - fixture
'@

try {
  foreach ($dir in @($root, $repo, $cacheDir, $stateDir, $profile, $accRoot, $mainHome, $codexHome, (Split-Path $logPath))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [IO.File]::WriteAllText($specPath, $packet, $utf8)
  [IO.File]::WriteAllText($ontologyPath, '{"quota":{"thresholds":{"codexUsed3":95}}}', $utf8)
  Write-Answer (Join-Path $root 'pass.txt') $passAnswer
  Write-Answer (Join-Path $root 'fail.txt') $failAnswer
  Write-Answer (Join-Path $root 'bare.txt') $bareAnswer
  Write-Answer (Join-Path $root 'empty.txt') ''
  Set-TestEnv 'CODEX_DO_ENGINE' $null
  Set-TestEnv 'CODEX_DO_USAGE_CACHE_DIR' $cacheDir
  Set-TestEnv 'CODEX_DO_STATE_DIR' $stateDir
  Set-TestEnv 'ULTRATHINK_ONTOLOGY' $ontologyPath
  Set-TestEnv 'CODEX_REVIEW_LOG' $logPath
  Set-TestEnv 'GROK_DO_BIN' $fake
  Set-TestEnv 'CODEX_DO_BIN' $missingBin
  Set-TestEnv 'USERPROFILE' $profile
  Set-TestEnv 'CODEX_ACC_ROOT' $accRoot
  Set-TestEnv 'CODEX_ACC_MAIN_HOME' $mainHome
  Set-TestEnv 'CODEX_HOME' $codexHome
  Set-TestEnv 'CODEX_DO_NO_FALLBACK' $null
  & git -C $repo init | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
  & git -C $repo config user.email 'grok-review@local'
  & git -C $repo config user.name 'grok-review'
  [IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "base`n", $utf8)
  & git -C $repo add 'a.txt'
  & git -C $repo commit -m 'base' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
  [IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "base`nchanged`n", $utf8)
  $stamp = Get-RepoStamp $repo
  $common = @('-NoRamCheck','-Dir',$repo,'-SpecFile',$specPath)

  Write-Cache 96
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $pass = Invoke-GrokReview ($common + @('-Engine','auto'))
  $argv = if (Test-Path -LiteralPath $argvPath) { [IO.File]::ReadAllText($argvPath) } else { '' }
  $argvProblem = Assert-GrokArgv $argv 'grok-4.7-build-fast' 'xhigh' (Get-FakeEnv)
  $promptGone = $true
  $promptUnderTemp = $false
  if ($argv -match '--prompt-file"\s+"([^"]+)"') {
    $promptUnderTemp = $Matches[1].StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)
    $promptGone = -not (Test-Path -LiteralPath $Matches[1])
  } else { $promptGone = $false }
  $log = Get-LastLog
  $trailPath = Join-Path $profile '.claude\state\dispatch-trail.log'
  $trail = if (Test-Path -LiteralPath $trailPath) { @(Get-Content -LiteralPath $trailPath)[-1] } else { '' }
  $gateAt = $pass.Text.IndexOf('GATE secrets: PASS')
  $lineAt = $pass.Text.IndexOf('codex-review: reviewer grok (auto: Codex weekly 96% used)')
  $passDetail = $pass.Text + "`nARGV:`n" + $argv + "`nTRAIL:`n" + $trail + "`nARG: " + $argvProblem
  Assert-Review ($pass.Code -eq 0 -and $argvProblem -eq '' -and $promptGone -and $promptUnderTemp -and $log.engine -ceq 'grok' -and $log.model -ceq 'grok-4.7-build-fast' -and $log.effort -ceq 'xhigh' -and $log.verdict -ceq 'PASS' -and $gateAt -ge 0 -and $lineAt -gt $gateAt -and $trail -match '\|review\|grok-4.7-build-fast\|xhigh\|' -and (Get-RepoStamp $repo) -ceq $stamp) 'auto hot cache PASS exits 0, logs grok, argv flags, trail, unchanged repo' $passDetail

  Set-Fake (Join-Path $root 'fail.txt') '0'
  $fail = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  $failLog = Get-LastLog
  $factsPath = Join-Path (Split-Path $logPath) 'findings.jsonl'
  $factLines = @(Get-Content -LiteralPath $factsPath | Where-Object { $_.Trim() })
  $sample = $null
  foreach ($factLine in $factLines) {
    $parsed = $factLine | ConvertFrom-Json
    if ($parsed.title -ceq 'sample bug') { $sample = $parsed }
  }
  Assert-Review ($fail.Code -eq 1 -and $null -ne $sample -and $sample.reviewer -ceq 'grok-4.7-build-fast' -and $sample.kind -ceq 'finding' -and @($failLog.findings).Count -ge 1 -and $failLog.engine -ceq 'grok') 'FAIL findings record reviewer grok-4.7-build-fast' $fail.Text

  Set-Fake (Join-Path $root 'empty.txt') '0'
  $empty = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  Assert-Review ($empty.Code -eq 3 -and $empty.Text -match 'VERDICT: UNKNOWN \(grok exit 0\)') 'empty answer exits 3' $empty.Text

  Set-Fake (Join-Path $root 'bare.txt') '0'
  $bare = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  Assert-Review ($bare.Code -eq 3 -and $bare.Text -match 'VERDICT: UNKNOWN \(no verdict line\)' -and $bare.Text -notmatch 'VERDICT: PASS') 'answer without VERDICT line exits 3' $bare.Text

  Set-Fake (Join-Path $root 'pass.txt') '1'
  $badExit = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  Assert-Review ($badExit.Code -eq 3 -and $badExit.Text -match 'VERDICT: UNKNOWN \(grok exit 1\)') 'FAKE_GROK_EXIT 1 exits 3' $badExit.Text

  Write-Cache 40
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $cool = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  $coolLog = Get-LastLog
  Assert-Review ($cool.Code -eq 3 -and $cool.Text -notmatch 'reviewer grok' -and -not (Test-Path -LiteralPath $argvPath) -and $coolLog.engine -ceq 'codex') 'auto cool cache stays on codex' $cool.Text

  Write-Cache 96
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $forced = Invoke-GrokReview ($common + @('-Engine','codex','-SkipGates'))
  $forcedLog = Get-LastLog
  Assert-Review ($forced.Code -eq 3 -and $forced.Text -notmatch 'reviewer grok' -and -not (Test-Path -LiteralPath $argvPath) -and $forcedLog.engine -ceq 'codex') '-Engine codex forces codex on a hot cache' $forced.Text

  Set-Fake (Join-Path $root 'pass.txt') '0'
  $skipped = Invoke-GrokReview ($common + @('-Engine','grok','-SkipModel'))
  $skippedLog = Get-LastLog
  $hasEngine = @($skippedLog.PSObject.Properties.Name) -contains 'engine'
  Assert-Review ($skipped.Code -eq 0 -and $skipped.Text -match 'GATES-PASS' -and $skipped.Text -notmatch 'reviewer grok' -and $skipped.Text -notmatch 'grok engine library' -and -not (Test-Path -LiteralPath $argvPath) -and $hasEngine -and $null -eq $skippedLog.engine) '-SkipModel prints no engine line' $skipped.Text

  Set-Fake (Join-Path $root 'pass.txt') '0'
  $noSandbox = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates','-NoSandboxFallback'))
  Assert-Review ($noSandbox.Code -eq 3 -and $noSandbox.Text -match 'VERDICT: UNKNOWN \(grok has no enforced sandbox\)' -and -not (Test-Path -LiteralPath $argvPath)) '-NoSandboxFallback refuses grok' $noSandbox.Text

  Set-TestEnv 'GROK_DO_BIN' $missingGrok
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $missing = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates'))
  Assert-Review ($missing.Code -eq 3 -and $missing.Text -match 'VERDICT: UNKNOWN \(grok CLI not found\)' -and -not (Test-Path -LiteralPath $argvPath)) 'missing grok binary exits 3' $missing.Text
  Set-TestEnv 'GROK_DO_BIN' $fake

  Set-Fake (Join-Path $root 'pass.txt') '0'
  $ignored = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates','-Model','gpt-6-astra','-Effort','ultra'))
  $ignoredArgv = if (Test-Path -LiteralPath $argvPath) { [IO.File]::ReadAllText($argvPath) } else { '' }
  $ignoredLog = Get-LastLog
  Assert-Review ($ignored.Code -eq 0 -and $ignoredLog.model -ceq 'grok-4.7-build-fast' -and $ignoredLog.effort -ceq 'xhigh' -and (Assert-GrokArgv $ignoredArgv 'grok-4.7-build-fast' 'xhigh' (Get-FakeEnv)) -eq '') 'non-grok -Model and -Effort ultra use the grok plan' ($ignored.Text + "`n" + $ignoredArgv)

  Set-Fake (Join-Path $root 'pass.txt') '0'
  $bound = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates','-Model','grok-4.7','-Effort','high'))
  $boundArgv = if (Test-Path -LiteralPath $argvPath) { [IO.File]::ReadAllText($argvPath) } else { '' }
  $boundLog = Get-LastLog
  Assert-Review ($bound.Code -eq 0 -and $boundLog.model -ceq 'grok-4.7' -and $boundLog.effort -ceq 'high' -and (Assert-GrokArgv $boundArgv 'grok-4.7' 'high' (Get-FakeEnv)) -eq '') 'bound grok -Model and -Effort are kept' ($bound.Text + "`n" + $boundArgv)

  $criticalSpec = Join-Path $root 'critical.md'
  $criticalText = $packet.Replace('TIER: Important', 'TIER: Critical')
  [IO.File]::WriteAllText($criticalSpec, $criticalText, $utf8)
  $criticalOut = Join-Path $root 'critical-out.txt'
  Write-Cache 96
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $criticalAuto = Invoke-GrokReview (@('-NoRamCheck','-Dir',$repo,'-SpecFile',$criticalSpec,'-Engine','auto','-SkipGates','-OutFile',$criticalOut))
  $criticalAutoLog = Get-LastLog
  $criticalOutText = if (Test-Path -LiteralPath $criticalOut) { [IO.File]::ReadAllText($criticalOut) } else { '' }
  $criticalMessage = 'codex-review: Critical packet stays on Codex; use an Opus subagent if Codex is out'
  Assert-Review ($criticalAuto.Code -eq 3 -and $criticalAuto.Text.Contains($criticalMessage) -and $criticalOutText.Contains($criticalMessage) -and $criticalAuto.Text -notmatch 'codex-do:' -and $criticalAuto.Text -notmatch 'reviewer grok' -and -not (Test-Path -LiteralPath $argvPath) -and $criticalAutoLog.engine -ceq 'codex') 'Critical auto hot cache stays on codex with the Critical message' $criticalAuto.Text

  Set-Fake (Join-Path $root 'pass.txt') '0'
  $criticalManual = Invoke-GrokReview (@('-NoRamCheck','-Dir',$repo,'-SpecFile',$criticalSpec,'-Engine','grok','-SkipGates'))
  $criticalWarn = 'codex-review: warning: Critical packet runs on Grok by manual choice (flag: -Engine grok)'
  Assert-Review ($criticalManual.Code -eq 0 -and $criticalManual.Text.Contains($criticalWarn) -and $criticalManual.Text -notmatch 'codex-do:' -and (Test-Path -LiteralPath $argvPath) -and $criticalManual.Text.Contains('codex-review: reviewer grok (flag: -Engine grok)')) 'manual grok on a Critical packet warns and runs grok' $criticalManual.Text

  if (-not (Get-Command Get-CodexUsageCachePath -ErrorAction SilentlyContinue)) { . (Join-Path $bin 'grok-engine-lib.ps1') }
  if (-not (Get-Command Resolve-CodexAccountHome -ErrorAction SilentlyContinue)) { . (Join-Path $bin 'codex-acc-lib.ps1') }
  $workHome = Join-Path ([IO.Path]::GetFullPath($accRoot)) 'work'
  New-Item -ItemType Directory -Path $workHome -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetFullPath($accRoot)) 'active'), "work`n", $utf8)
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $loggedOut = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates'))
  Assert-Review ($loggedOut.Code -eq 0 -and $loggedOut.Text -notmatch 'not logged in' -and (Test-Path -LiteralPath $argvPath) -and $loggedOut.Text.Contains('codex-review: reviewer grok (flag: -Engine grok)')) 'manual grok reviews when the active Codex account is not logged in' $loggedOut.Text
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $loggedOutAuto = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  $loggedOutLog = Get-LastLog
  Assert-Review ($loggedOutAuto.Code -eq 5 -and $loggedOutAuto.Text -match 'not logged in' -and -not (Test-Path -LiteralPath $argvPath) -and $loggedOutLog.engine -ceq 'codex') 'auto with a not-logged-in account exits 5 on codex' $loggedOutAuto.Text

  [IO.File]::WriteAllText((Join-Path $workHome 'auth.json'), '{"OPENAI_API_KEY":"fixture"}', $utf8)
  $resolvedWork = Resolve-CodexAccountHome -Name 'work'
  $workCache = Get-CodexUsageCachePath -CacheDir $cacheDir -AccountName 'work' -AccountHome $resolvedWork
  Write-Cache 40
  Write-CacheFile $workCache 96
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $workHot = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  Assert-Review ($workHot.Code -eq 0 -and $workHot.Text.Contains('codex-review: reviewer grok (auto: Codex weekly 96% used)') -and (Test-Path -LiteralPath $argvPath)) 'auto reads the active account cache (work 96 / main 40) and uses grok' $workHot.Text
  Write-Cache 96
  Write-CacheFile $workCache 40
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $workCool = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  $workCoolLog = Get-LastLog
  Assert-Review ($workCool.Code -eq 3 -and $workCool.Text -notmatch 'reviewer grok' -and -not (Test-Path -LiteralPath $argvPath) -and $workCoolLog.engine -ceq 'codex') 'auto reads the active account cache (work 40 / main 96) and stays on codex' $workCool.Text
  Remove-Item -LiteralPath (Join-Path ([IO.Path]::GetFullPath($accRoot)) 'active') -Force

  Write-Cache 40
  [IO.File]::WriteAllText((Join-Path $stateDir 'engine.txt'), "grok`n", $utf8)
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $fromFile = Invoke-GrokReview ($common + @('-SkipGates'))
  Assert-Review ($fromFile.Code -eq 0 -and $fromFile.Text.Contains('codex-review: reviewer grok (file: engine.txt says grok)') -and (Test-Path -LiteralPath $argvPath)) 'engine.txt=grok is the file source' $fromFile.Text
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $fileAuto = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  $fileAutoLog = Get-LastLog
  Assert-Review ($fileAuto.Code -eq 3 -and $fileAuto.Text -notmatch 'reviewer grok' -and -not (Test-Path -LiteralPath $argvPath) -and $fileAutoLog.engine -ceq 'codex') 'engine.txt=grok + -Engine auto on a cool cache stays on codex' $fileAuto.Text
  Remove-Item -LiteralPath (Join-Path $stateDir 'engine.txt') -Force

  Set-TestEnv 'CODEX_DO_ENGINE' 'grok'
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $fromEnv = Invoke-GrokReview ($common + @('-SkipGates'))
  Assert-Review ($fromEnv.Code -eq 0 -and $fromEnv.Text.Contains('codex-review: reviewer grok (env: CODEX_DO_ENGINE=grok)') -and (Test-Path -LiteralPath $argvPath)) 'CODEX_DO_ENGINE=grok is the env source' $fromEnv.Text
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $envSkip = Invoke-GrokReview ($common + @('-SkipModel'))
  $envSkipLog = Get-LastLog
  $envSkipHasEngine = @($envSkipLog.PSObject.Properties.Name) -contains 'engine'
  Assert-Review ($envSkip.Code -eq 0 -and $envSkip.Text -match 'GATES-PASS' -and $envSkip.Text -notmatch 'reviewer grok' -and $envSkip.Text -notmatch 'codex-review:' -and -not (Test-Path -LiteralPath $argvPath) -and $envSkipHasEngine -and $null -eq $envSkipLog.engine) 'env grok + -SkipModel prints no engine line' $envSkip.Text
  Set-TestEnv 'CODEX_DO_ENGINE' $null
  Write-Cache 96

  $changedBytes = [IO.File]::ReadAllBytes((Join-Path $repo 'a.txt'))
  & git -C $repo checkout -- 'a.txt' | Out-Null
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $emptyDiff = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates'))
  $emptyDiffLog = Get-LastLog
  Assert-Review ($emptyDiff.Code -eq 0 -and $emptyDiff.Text.Contains('VERDICT: PASS (empty diff)') -and -not (Test-Path -LiteralPath $argvPath) -and $emptyDiffLog.engine -ceq 'grok' -and $emptyDiffLog.model -ceq 'grok-4.7-build-fast' -and $emptyDiffLog.effort -ceq 'xhigh') 'empty diff on manual grok logs engine grok and the grok model' ($emptyDiff.Text + "`n" + ($emptyDiffLog | ConvertTo-Json -Compress))
  [IO.File]::WriteAllBytes((Join-Path $repo 'a.txt'), $changedBytes)

  $secretBytes = [IO.File]::ReadAllBytes((Join-Path $repo 'a.txt'))
  [IO.File]::WriteAllText((Join-Path $repo 'a.txt'), ([Text.Encoding]::UTF8.GetString($secretBytes) + "apiKey = `"abcdefghijklmn`"`n"), $utf8)
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $gateFail = Invoke-GrokReview ($common + @('-Engine','grok'))
  $gateFailLog = Get-LastLog
  Assert-Review ($gateFail.Code -eq 1 -and $gateFail.Text.Contains('VERDICT: FAIL (gates)') -and -not (Test-Path -LiteralPath $argvPath) -and $gateFailLog.engine -ceq 'grok' -and $gateFailLog.model -ceq 'grok-4.7-build-fast') 'gate FAIL on manual grok logs engine grok and the grok model' $gateFail.Text
  [IO.File]::WriteAllBytes((Join-Path $repo 'a.txt'), $secretBytes)

  [IO.File]::WriteAllText((Join-Path $repo 'a.txt'), ('x' * 500000), $utf8)
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $tooBig = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates'))
  $tooBigLog = Get-LastLog
  Assert-Review ($tooBig.Code -eq 4 -and $tooBig.Text.Contains('DIFF TOO LARGE') -and -not (Test-Path -LiteralPath $argvPath) -and $tooBigLog.engine -ceq 'grok' -and $tooBigLog.model -ceq 'grok-4.7-build-fast') 'oversized diff on manual grok logs engine grok and exits 4' $tooBig.Text
  [IO.File]::WriteAllBytes((Join-Path $repo 'a.txt'), $changedBytes)

  Set-TestEnv 'FAKE_GROK_EXIT' $null
  Set-TestEnv 'FAKE_GROK_ANSWER' (Join-Path $root 'missing-answer.txt')
  Set-TestEnv 'FAKE_GROK_ARGV' $null
  Set-TestEnv 'FAKE_GROK_ENV' $null
  & cmd.exe /c "`"$fake`" x >nul 2>&1"
  Assert-Review ($LASTEXITCODE -eq 0) 'unset FAKE_GROK_EXIT defaults to 0' "exit=$LASTEXITCODE"
  Set-Fake (Join-Path $root 'pass.txt') '0'

  $copy = Join-Path $root 'nolib'
  New-Item -ItemType Directory -Path $copy -Force | Out-Null
  foreach ($file in @('codex-review.ps1','codex-acc-lib.ps1','codex-sandbox-lib.ps1','ram-preflight.ps1','review-findings-lib.ps1','packet-lint.ps1')) {
    Copy-Item -LiteralPath (Join-Path $bin $file) -Destination (Join-Path $copy $file)
  }
  $savedReview = $review
  $review = Join-Path $copy 'codex-review.ps1'
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $noLib = Invoke-GrokReview ($common + @('-Engine','grok','-SkipGates'))
  Assert-Review ($noLib.Code -eq 3 -and $noLib.Text -match 'VERDICT: UNKNOWN \(grok engine library not found\)' -and -not (Test-Path -LiteralPath $argvPath)) 'missing library with -Engine grok exits 3' $noLib.Text
  Set-Fake (Join-Path $root 'pass.txt') '0'
  $noLibAuto = Invoke-GrokReview ($common + @('-Engine','auto','-SkipGates'))
  Assert-Review ($noLibAuto.Code -eq 3 -and $noLibAuto.Text -notmatch 'reviewer grok' -and $noLibAuto.Text -notmatch 'grok engine library' -and -not (Test-Path -LiteralPath $argvPath)) 'missing library with auto stays on codex' $noLibAuto.Text
  $review = $savedReview

  Assert-Review ((Get-RepoStamp $repo) -ceq $stamp) 'repo bytes unchanged after every grok review' ''
} finally {
  foreach ($name in @($saved.Keys)) {
    if ($null -eq $saved[$name]) { Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue }
    else { Set-Item -Path "Env:$Name" -Value $saved[$name] }
  }
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($script:failed) { Write-Host "FAILED $($script:failed)"; exit 1 }
Write-Host 'GROK REVIEW TESTS COMPLETE'
exit 0
