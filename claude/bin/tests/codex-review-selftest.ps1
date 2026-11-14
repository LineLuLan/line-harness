<#
.SYNOPSIS
  Exercise codex-review.ps1 in a disposable repository, including two real reviews.
#>
[CmdletBinding()]
param([switch]$OfflineOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fixtures\dispatch-packet.ps1')
$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root 'codex-review.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('codex-review-fixture-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $fixtureRoot 'repo'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Assert-True($Condition, [string]$Message) {
  if (-not $Condition) { throw "SELFTEST FAIL: $Message" }
  Write-Host "SELFTEST PASS: $Message"
}
function Write-Fixture([string]$Text) {
  [IO.File]::WriteAllText((Join-Path $repo 'a.js'), $Text, $utf8)
}
function Invoke-Review([string]$Name, [string[]]$ReviewArgs) {
  if ($env:CODEX_DO_BIN -ne $originalBin) { $ReviewArgs = @('-NoRamCheck') + $ReviewArgs }
  if ($ReviewArgs -notcontains '-SpecFile' -and $ReviewArgs -notcontains '-Prompt') { $ReviewArgs += @('-SpecFile', $defaultPacket) }
  # Intent: one compact log per invocation, without prompt/diff leakage. Status: regression assertions.
  # Next: supervisor review. Blockers: none. Confidence: real JSONL reads after every child exit.
  $before = if (Test-Path -LiteralPath $env:CODEX_REVIEW_LOG -PathType Leaf) { [IO.File]::ReadAllText($env:CODEX_REVIEW_LOG) } else { '' }
  # Expected native stderr (log failure) is evidence, not a terminating test exception.
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe -NoProfile -File $helper @ReviewArgs 2>&1)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $savedPreference }
  if ($Name -ne 'log-unwritable') {
    $after = [IO.File]::ReadAllText($env:CODEX_REVIEW_LOG)
    Assert-True ($after.StartsWith($before)) "$Name preserves existing review log"
    $newLines = @($after.Substring($before.Length) -split "`n" | Where-Object { $_.Trim() })
    Assert-True ($newLines.Count -eq 1) "$Name appends exactly one log line"
    $entry = $newLines[0] | ConvertFrom-Json
    $expectedVerdict = if ($code -eq 0) { 'PASS' } elseif ($code -eq 1) { 'FAIL' } else { 'UNKNOWN' }
    $expectedFindings = if ($Name -eq 'mock-fail') { 4 } elseif ($Name -in @('subtraction', 'fixed')) { $null } else { 0 }
    Assert-True ($entry.verdict -ceq $expectedVerdict -and ($null -eq $expectedFindings -or @($entry.findings).Count -eq $expectedFindings)) "$Name logs verdict and findings count"
    # Intent: keep model attribution honest for Line. Status: regression checks.
    # Next: supervisor live checks. Blockers: none. Confidence: JSONL after actual child exits.
    $gatesOnly = $ReviewArgs -contains '-SkipModel'
    $expectedMode = if ($gatesOnly) { 'gates-only' } else { 'model' }
    $attribution = if ($gatesOnly) { $null -eq $entry.model -and $null -eq $entry.effort } else { $entry.model -and $entry.effort }
    Assert-True ($entry.utc -and $entry.dir -and $attribution -and $entry.mode -eq $expectedMode -and $null -ne $entry.gates) "$Name logs honest mode and metadata"
    if ($gatesOnly -or $Name -eq 'empty' -or $Name -eq 'prompt-criteria') { Assert-True ($entry.criteria -eq 'n/a') "$Name has no criteria review" }
    if ($Name -eq 'mock-pass') { Assert-True ($entry.criteria -eq 'none') 'missing CRITERIA logs none' }
    if ($Name -eq 'criteria-complete') { Assert-True ($entry.criteria -eq 'complete') 'all expected PASS logs complete' }
    if ($Name -in @('criteria-unknown','criteria-missing','criteria-duplicate','criteria-fail')) {
      Assert-True ($entry.criteria -eq 'incomplete') "$Name logs incomplete coverage"
    }
    Assert-True ($newLines[0] -notmatch 'A harmless comment|excluded-marker|FULL PACKET|diff --git') "$Name omits prompt and diff"
    if ($Name -eq 'mock-fail') {
      Assert-True ($entry.findings[0].severity -ceq 'P1' -and $entry.findings[0].location -ceq 'a.js:2' -and $entry.findings[0].title -ceq 'mock finding') 'finding fields parsed'
    }
    if ($Name -eq 'mock-pass') {
      Assert-True ($entry.specFile -ceq $packet -and $entry.dir -ceq $repo -and $entry.model -ceq 'gpt-6-astra' -and $entry.effort -ceq 'high' -and $entry.gates.secrets -ceq 'PASS' -and $entry.gates.lint -ceq 'SKIP') 'log records packet and gate statuses'
    }
    if ($Name -eq 'gates') { Assert-True ($entry.gates.secrets -ceq 'FAIL') 'log records failing gates' }
  }
  $body = ($output | ForEach-Object { "$_" }) -join "`r`n"
  [IO.File]::WriteAllText((Join-Path $fixtureRoot "$Name.output.txt"), $body, $utf8)
  Write-Host "REVIEW OUTPUT ($Name, exit $code):"
  Write-Host $body
  return [pscustomobject]@{ Code = $code; Text = $body; Stderr = (($output | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n") }
}
function Invoke-FixtureGit([string[]]$GitArgs) {
  & git -C $repo @GitArgs
  if ($LASTEXITCODE -ne 0) { throw "Fixture git failed: $GitArgs" }
}

Assert-True (Test-Path -LiteralPath $helper) 'helper exists'
New-Item -ItemType Directory -Path $repo -Force | Out-Null
$defaultPacket = Join-Path $fixtureRoot 'default-packet.txt'
[IO.File]::WriteAllText($defaultPacket, (New-SelftestPacket), $utf8)
# Refuse to overwrite a repository this test did not create.
$marker = Join-Path $fixtureRoot 'fixture-owned.txt'
if ((Test-Path -LiteralPath (Join-Path $repo '.git')) -and -not (Test-Path -LiteralPath $marker)) {
  throw 'Existing selftest/repo is not owned by this test.'
}
[IO.File]::WriteAllText($marker, 'Owned by run-selftest.ps1', $utf8)
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
  Invoke-FixtureGit @('init')
  Write-Fixture "function add(a,b) {`n  return a+b;`n}`n"
  Invoke-FixtureGit @('add', 'a.js')
  Invoke-FixtureGit @('-c', 'user.email=selftest@local', '-c', 'user.name=selftest', 'commit', '-m', 'selftest baseline')
}
$originalProfile = $env:USERPROFILE
$originalBin = $env:CODEX_DO_BIN
$originalMockMode = $env:REVIEW_SELFTEST_MODE
$originalMockRoot = $env:REVIEW_SELFTEST_ROOT
$originalNpmCache = $env:npm_config_cache
$originalSandbox = $env:FAKE_SANDBOX
$originalServers = $env:FAKE_MCP_SERVERS
$originalNoFallback = $env:CODEX_DO_NO_FALLBACK
$originalHome = $env:CODEX_HOME
$originalNotify = $env:CODEX_DO_NOTIFY
$originalPath = $env:Path
$originalAccounts = $env:CODEX_ACC_ROOT
$originalMainHome = $env:CODEX_ACC_MAIN_HOME
$originalReviewLog = $env:CODEX_REVIEW_LOG
try {
  $env:CODEX_REVIEW_LOG = Join-Path $fixtureRoot 'logs\reviews.jsonl'
  $env:CODEX_ACC_ROOT = Join-Path $fixtureRoot 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixtureRoot 'main'
  # Keep command-gate assertions while preventing real npm from running in this suite.
  $fakeNpmDir = Join-Path $fixtureRoot 'fake-npm'
  New-Item -ItemType Directory -Path $fakeNpmDir -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $fakeNpmDir 'npm.cmd'), "@echo off`r`nnode `"%~dp0npm-fixture.js`" %*`r`nexit /b %errorlevel%`r`n", $utf8)
  [IO.File]::WriteAllText((Join-Path $fakeNpmDir 'npm-fixture.js'), @'
const fs = require('fs');
const cp = require('child_process');
const args = process.argv.slice(2);
if (args[0] !== 'run') process.exit(9);
const command = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts[args[1]];
process.exit(cp.spawnSync(command, { shell: true, stdio: 'inherit' }).status || 0);
'@, $utf8)
  $env:Path = $fakeNpmDir + ';' + $originalPath
  $env:CODEX_DO_NO_FALLBACK = $null
  $env:FAKE_SANDBOX = 'ok'
  $env:FAKE_MCP_SERVERS = 'codex,node_repl'
  $env:USERPROFILE = Join-Path $fixtureRoot 'profile'
  $env:npm_config_cache = Join-Path $fixtureRoot 'npm-cache'
  New-Item -ItemType Directory -Path $env:USERPROFILE -Force | Out-Null
  # Main-home config declaring the MCP tables the review may disable (plugin servers have none).
  New-Item -ItemType Directory -Path $env:CODEX_ACC_MAIN_HOME -Force | Out-Null
  $configText = (@('codex', 'node_repl', 'context7', 'github', 'valid-name_1') | ForEach-Object { "[mcp_servers.$_]`ncommand = `"x`"`n" }) -join "`n"
  [IO.File]::WriteAllText((Join-Path $env:CODEX_ACC_MAIN_HOME 'config.toml'), $configText, (New-Object Text.UTF8Encoding $false))
  # An invalid override makes any accidental reviewer launch a test failure.
  $env:CODEX_DO_BIN = Join-Path $fixtureRoot 'must-not-launch.exe'
  Write-Fixture "function add(a,b) {`n  const apiKey = `"abcdefghijklmnop1234`";`n  console.log(`"x`");`n  return a+b;`n}`n"
  $result = Invoke-Review 'gates' @('-Dir', $repo)
  Assert-True ($result.Code -eq 1) 'gates exit 1'
  Assert-True ($result.Text -match 'GATE secrets: FAIL') 'secrets gate fails'
  Assert-True ($result.Text -match 'GATE console: FAIL') 'console gate fails'
  Assert-True ($result.Text -match 'VERDICT: FAIL \(gates\)') 'gate verdict fails'
  Assert-True ($result.Text -notmatch '(?m)^-> ') 'gates launch no Codex process'
  Assert-True ($result.Text -notmatch 'abcdefghijklmnop1234') 'secret is masked'
  Assert-True ($result.Text -match 'a.js:2:.*\*\*\*\*') 'secret location is accurate'
  Assert-True ($result.Text -match 'a.js:3:') 'console location is accurate'

  Write-Fixture "function add(a,b) {`n  return a+b;`n}`n"
  $result = Invoke-Review 'empty' @('-Dir', $repo)
  Assert-True ($result.Code -eq 0 -and $result.Text -match 'VERDICT: PASS \(empty diff\)') 'empty diff passes without Codex'

  $untracked = Join-Path $repo 'untracked.js'
  try {
    [IO.File]::WriteAllText($untracked, "console.log('untracked');`n", $utf8)
    $result = Invoke-Review 'untracked' @('-Dir', $repo)
    Assert-True ($result.Code -eq 1 -and $result.Text -match 'untracked.js:1:') 'untracked additions are gated'
  } finally { Remove-Item -LiteralPath $untracked -ErrorAction SilentlyContinue }

  $large = Join-Path $repo 'large.txt'
  try {
    [IO.File]::WriteAllText($large, ('x' * (401 * 1024)), $utf8)
    $result = Invoke-Review 'large' @('-Dir', $repo)
    Assert-True ($result.Code -eq 4 -and $result.Text -match 'DIFF TOO LARGE') '400 KB limit blocks review'
  } finally { Remove-Item -LiteralPath $large -ErrorAction SilentlyContinue }

  $nonGit = Join-Path $fixtureRoot 'non-git'
  New-Item -ItemType Directory -Path $nonGit -Force | Out-Null
  $result = Invoke-Review 'non-git' @('-Dir', $nonGit)
  Assert-True ($result.Code -eq 2 -and $result.Text -match 'NOT A GIT REPO') 'non-git directory exits 2'

  # These are transport tests, not substitutes for the live reviews below.
  $env:REVIEW_SELFTEST_ROOT = $fixtureRoot
  $env:CODEX_DO_BIN = Join-Path $fixtureRoot 'mock-codex.cmd'
  [IO.File]::WriteAllText($env:CODEX_DO_BIN, "@echo off`r`nnode `"%~dp0mock-codex.js`" %*`r`nexit /b %errorlevel%`r`n", $utf8)
  $mockScript = @'
const fs = require('fs');
const path = require('path');
const root = process.env.REVIEW_SELFTEST_ROOT;
const args = process.argv.slice(2);
const mode = process.env.REVIEW_SELFTEST_MODE;
if (args[0] === 'sandbox') {
  fs.appendFileSync(path.join(root, 'sandbox-count.txt'), 'probe\n');
  fs.writeFileSync(path.join(root, 'sandbox-record.json'), JSON.stringify({ args, home: process.env.CODEX_HOME || null }));
  if (process.env.FAKE_SANDBOX === 'both-fail' || (process.env.FAKE_SANDBOX === 'elevated-fails' && args.includes('windows.sandbox="elevated"'))) {
    console.error('windows sandbox failed: helper_unknown_error: setup refresh had errors');
    process.exit(1);
  }
  console.log('PREFLIGHT-OK');
  process.exit(0);
}
if (args.includes('mcp') && args.includes('list')) {
  fs.appendFileSync(path.join(root, 'mcp-count.txt'), 'probe\n');
  console.log(JSON.stringify((process.env.FAKE_MCP_SERVERS || '').split(',').filter(Boolean).map(name => ({ name, enabled: true }))));
  process.exit(0);
}
if (args.includes('--help')) {
  fs.appendFileSync(path.join(root, 'probe-count.txt'), 'probe\n');
  if (mode === 'supported') process.exit(0);
  process.stderr.write("error: unexpected argument '--ignore-user-config' found\n");
  process.exit(2);
}
const record = { Arguments: args, Input: fs.readFileSync(0, 'utf8'), Directory: process.cwd(), Home: process.env.CODEX_HOME || null };
fs.writeFileSync(path.join(root, 'mock-record.json'), JSON.stringify(record));
process.stderr.write('mock diagnostic\n');
if (mode === 'sandbox-marker') process.stderr.write('2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: error=exec_command failed: helper_unknown_error: setup refresh had errors\n');
if (mode === 'echo-markers') {
  process.stderr.write(record.Input + '\n');
  process.stderr.write('+2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed\n');
  process.stderr.write('Failed to create unified exec process: helper_unknown_error: windows sandbox failed: setup refresh had errors\n');
}
if (mode === 'unknown') {
  process.stderr.write('VERDICT: PASS\n');
  process.stdout.write(''); // real codex review: answer on stdout, diagnostics on stderr; empty answer = no verdict
} else if (mode === 'fail') {
  process.stdout.write('VERDICT: PASS\n- [P1] mock finding - a.js:2\n[P0] critical finding - C:\\work\\a.js:3\n- [P2] minor finding - space name.js:4\n[P3] optional finding - src/a.js:5\nVERDICT: FAIL\n');
} else if (mode.startsWith('criteria-')) {
  const answers = {
    'criteria-complete': 'CRITERIA:\nC1: PASS\nextra prose\nC2: PASS\nVERDICT: PASS\n',
    'criteria-unknown': 'CRITERIA:\nC1: PASS\nC2: UNKNOWN\nVERDICT: PASS\n',
    'criteria-missing': 'CRITERIA:\nC1: PASS\nVERDICT: PASS\n',
    'criteria-duplicate': 'CRITERIA:\nC1: PASS\nC1: PASS\nC2: PASS\nVERDICT: PASS\n',
    'criteria-fail': 'CRITERIA:\nC1: UNKNOWN\nVERDICT: FAIL\n'
  };
  process.stdout.write(answers[mode]);
} else {
  process.stdout.write('VERDICT: PASS\n');
}
'@
  [IO.File]::WriteAllText((Join-Path $fixtureRoot 'mock-codex.js'), $mockScript, $utf8)
  Write-Fixture "function add(a,b) {`n  // A harmless comment.`n  return a+b;`n}`n"
  $packet = Join-Path $fixtureRoot 'criteria packet.md'
  # Intent: later amendments and embedded fences survive prompt construction. Status: regression fixture.
  # Next: supervisor review. Blockers: none. Confidence: captured reviewer stdin.
  $packetText = (New-SelftestPacket ("AMENDMENT:`nPreserve three arguments instead.`nADDENDUM:`nKeep this extra context.`n" + ('`' * 7) + "`n")).Replace('FILES: fixture-only', "FILES:`nexcluded-marker")
  [IO.File]::WriteAllText($packet, $packetText, $utf8)
  $probeCount = Join-Path $fixtureRoot 'probe-count.txt'
  [IO.File]::WriteAllText($probeCount, '', $utf8)
  [IO.File]::WriteAllText((Join-Path $fixtureRoot 'mcp-count.txt'), '', $utf8)
  $env:REVIEW_SELFTEST_MODE = 'pass'
  $mockReport = Join-Path $fixtureRoot 'mock-report.txt'
  $result = Invoke-Review 'mock-pass' @('-Dir', $repo, '-SpecFile', $packet, '-OutFile', $mockReport)
  Assert-True ($result.Code -eq 0) 'mock PASS maps to exit 0'
  Assert-True ($result.Text.TrimEnd().EndsWith('VERDICT: PASS (criteria not reported)')) 'public output discloses missing criteria'
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  Assert-True ($record.Input.Contains("CRITERIA:`n1. Preserve addition.`n2. Preserve two arguments.`n`nFULL PACKET")) 'SUCCESS CRITERIA remains the binding block'
  Assert-True ($record.Input.Contains('P0 (blocks ship: wrong result, data loss, security)') -and $record.Input.Contains('P1 (must fix before merge)') -and $record.Input.Contains('P2 (should fix)') -and $record.Input.Contains('P3 (nit)') -and $record.Input.Contains('FAIL when at least one P0 or P1 finding exists') -and $record.Input -notmatch 'critical\|warning\|optional') 'prompt uses P0-P3 and P0/P1 failure threshold'
  $heading = 'FULL PACKET (context; sections named AMENDMENT or ADDENDUM override earlier criteria)'
  $fence = '`' * 8
  Assert-True ($record.Input.Contains("$heading`n${fence}text`n$packetText`n$fence")) 'full amendment packet uses a safe fence'
  Assert-True ($record.Input -match '(?m)^DIFF:' -and $record.Input -match 'A harmless comment') 'prompt contains multiline diff'
  Assert-True ($record.Arguments[-1] -eq '-' -and $record.Arguments -notcontains '--uncommitted' -and $record.Arguments -notcontains '--base') 'review receives stdin dash without conflicting flags'
  Assert-True ($record.Arguments -notcontains '--ignore-user-config') 'unsupported ignore-user-config is dropped'
  Assert-True ($record.Arguments -contains 'notify=[]' -and $record.Arguments -contains 'mcp_servers.codex.enabled=false' -and
    $record.Arguments -contains 'mcp_servers.node_repl.enabled=false') 'user config desktop notifications and present servers are disabled'
  Assert-True (@(Get-Content -LiteralPath (Join-Path $fixtureRoot 'mcp-count.txt')).Count -eq 1) 'MCP list is called once'
  Assert-True ($record.Directory -eq $repo) 'review working directory equals Dir'
  Assert-True (@(Get-Content -LiteralPath $probeCount).Count -eq 1) 'capability is probed once per invocation'
  foreach ($setting in @('model', 'model_reasoning_effort', 'service_tier', 'windows.sandbox')) {
    Assert-True (@($record.Arguments | Where-Object { $_ -like "$setting=*" }).Count -eq 1) "explicit setting $setting is retained"
  }
  $report = Get-Content -Raw -LiteralPath $mockReport
  Assert-True ($report -match 'mock diagnostic' -and $report -match 'VERDICT: PASS' -and $report -match 'GATE lint: SKIP') 'OutFile saves both streams and gates'
  $trail = Join-Path $env:USERPROFILE '.claude\state\dispatch-trail.log'
  Assert-True ((Get-Content -LiteralPath $trail | Select-Object -Last 1) -match '^\d+\|review\|gpt-6-astra\|high\|') 'dispatch trail uses review/model/effort fields'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.claude\state\dispatch-trail.lock'))) 'dispatch lock is released'

  # Intent: exercise coverage through SpecFile, model transport and logging. Status: offline fixtures.
  # Next: supervisor live review. Blockers: none. Confidence: actual exits and public verdicts.
  foreach ($mode in @('criteria-complete','criteria-unknown','criteria-missing','criteria-duplicate','criteria-fail')) {
    $env:REVIEW_SELFTEST_MODE = $mode
    $result = Invoke-Review $mode @('-Dir', $repo, '-SpecFile', $packet)
    $expectedCode = if ($mode -eq 'criteria-complete') { 0 } elseif ($mode -eq 'criteria-fail') { 1 } else { 6 }
    Assert-True ($result.Code -eq $expectedCode) "$mode returns expected code $expectedCode"
    if ($expectedCode -eq 6) { Assert-True ($result.Text -match 'VERDICT: INCOMPLETE \(') "$mode prints incomplete reason" }
  }
  $env:REVIEW_SELFTEST_MODE = 'criteria-unknown'
  $result = Invoke-Review 'prompt-criteria' @('-Dir', $repo, '-Prompt', 'Preserve addition.')
  Assert-True ($result.Code -eq 0 -and $result.Text.TrimEnd().EndsWith('VERDICT: PASS (with UNKNOWN criteria: C2)')) 'Prompt-only review retains prior unknown-criteria behavior'
  $env:REVIEW_SELFTEST_MODE = 'supported'
  $result = Invoke-Review 'mock-supported' @('-Dir', $repo, '-SkipGates', '-Prompt', (New-SelftestPacket 'Custom reviewer criteria.'))
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  Assert-True ($result.Code -eq 0 -and $record.Arguments -contains '--ignore-user-config') 'supported ignore-user-config is kept'
  Assert-True ($record.Arguments -notcontains 'notify=[]' -and $record.Arguments -notcontains 'mcp_servers.codex.enabled=false') 'ignore-user-config path needs no desktop overrides'
  Assert-True ($record.Input -match 'Custom reviewer criteria') 'trailing instructions reach stdin'
  Assert-True (@([regex]::Matches($result.Text, 'GATE \w+: SKIP \(-SkipGates\)')).Count -eq 4) 'SkipGates bypasses all four gates'
  $env:REVIEW_SELFTEST_MODE = 'fail'
  $result = Invoke-Review 'mock-fail' @('-Dir', $repo)
  Assert-True ($result.Code -eq 1) 'last reviewer verdict wins'
  $env:REVIEW_SELFTEST_MODE = 'unknown'
  $result = Invoke-Review 'mock-unknown' @('-Dir', $repo)
  Assert-True ($result.Code -eq 3 -and $result.Text -match 'VERDICT: UNKNOWN') 'diagnostics cannot substitute for a missing reviewer verdict'

  $env:REVIEW_SELFTEST_MODE = 'pass'
  $recordBefore = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'mock-record.json'))
  $env:FAKE_SANDBOX = 'both-fail'
  $result = Invoke-Review 'sandbox-unavailable' @('-Dir', $repo)
  Assert-True ($result.Code -eq 3 -and $result.Text -match 'VERDICT: UNKNOWN \(sandbox unavailable:' -and
    [IO.File]::ReadAllText((Join-Path $fixtureRoot 'mock-record.json')) -ceq $recordBefore) 'sandbox unavailable prevents model review'
  $env:FAKE_SANDBOX = 'elevated-fails'
  $result = Invoke-Review 'sandbox-fallback' @('-Dir', $repo)
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  Assert-True ($result.Code -eq 0 -and $result.Text.Contains('sandbox-mode: unelevated (fallback:') -and $record.Arguments -contains 'windows.sandbox="unelevated"') 'review uses fallback sandbox'
  foreach ($strictArgs in @(@('-NoSandboxFallback'), @())) {
    $env:CODEX_DO_NO_FALLBACK = if ($strictArgs.Count) { $null } else { '1' }
    $before = @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'sandbox-count.txt')).Count
    $result = Invoke-Review 'strict-sandbox' (@('-Dir', $repo) + $strictArgs)
    Assert-True ($result.Code -eq 3 -and $result.Text.Contains('VERDICT: UNKNOWN (sandbox unavailable:') -and
      @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'sandbox-count.txt')).Count -eq ($before + 1)) 'Critical review probes elevated only for switch or environment opt-out'
    $before = @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'sandbox-count.txt')).Count
    $workerArgs = @('-Attached', '-NoRamCheck', '-Dir', $repo) + $strictArgs + @('-SpecFile', $defaultPacket)
    $workerOutput = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'codex-do.ps1') @workerArgs)
    Assert-True ($LASTEXITCODE -eq 73 -and ($workerOutput -join "`n").Contains('SANDBOX UNAVAILABLE:') -and
      @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'sandbox-count.txt')).Count -eq ($before + 1)) 'Critical worker probes elevated only for switch or environment opt-out'
  }
  $env:CODEX_DO_NO_FALLBACK = $null
  $env:FAKE_SANDBOX = 'ok'

  $logPath = $env:CODEX_REVIEW_LOG
  try {
    $env:CODEX_REVIEW_LOG = $fixtureRoot
    $result = Invoke-Review 'log-unwritable' @('-Dir', $repo, '-SkipModel')
    Assert-True ($result.Code -eq 0 -and $result.Text.Contains('VERDICT: GATES-PASS (no model review)')) 'log write failure cannot fail gates-only review'
    Assert-True ($result.Stderr -match '^codex-review: review log failed: [A-Za-z.]+Exception$' -and $result.Text -notmatch [regex]::Escape($fixtureRoot)) 'log failure reports only exception type'
  } finally { $env:CODEX_REVIEW_LOG = $logPath }
  $env:REVIEW_SELFTEST_MODE = 'sandbox-marker'
  $result = Invoke-Review 'sandbox-marker' @('-Dir', $repo)
  Assert-True ($result.Code -eq 3 -and $result.Text.TrimEnd().EndsWith('VERDICT: UNKNOWN (sandbox failure)') -and $result.Text.Contains('WORKER SANDBOX FAILURE:')) 'sandbox failure overrides PASS answer'
  $env:REVIEW_SELFTEST_MODE = 'echo-markers'
  $env:CODEX_HOME = Join-Path $fixtureRoot 'inherited-home-must-not-reach-main'
  $result = Invoke-Review 'echoed-markers' @('-Dir', $repo, 'Prompt contains setup refresh had errors, Failed to create unified exec process, windows sandbox failed, helper_unknown_error.')
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  $probeRecord = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'sandbox-record.json') | ConvertFrom-Json
  Assert-True ($result.Code -eq 0 -and $result.Text.TrimEnd().EndsWith('VERDICT: PASS (criteria not reported)')) 'echoed prompt, diff and tool-output marker text do not fail a clean review'
  Assert-True ($null -eq $probeRecord.home -and $null -eq $record.Home) 'main review and native probe both remove inherited CODEX_HOME'
  . (Join-Path $root 'codex-sandbox-lib.ps1')
  $initializeProbe = (Get-Item Function:Initialize-CodexSandboxProcess).ScriptBlock
  try {
    function Initialize-CodexSandboxProcess { throw 'fixture Add-Type failure' }
    $selection = Select-CodexSandboxMode -CodexBin $env:CODEX_DO_BIN -Dir $repo -AccountHome ''
    $probeRecord = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'sandbox-record.json') | ConvertFrom-Json
    Assert-True ($selection.Mode -ceq 'elevated' -and $null -eq $probeRecord.home -and $env:CODEX_HOME.EndsWith('inherited-home-must-not-reach-main')) 'Add-Type failure falls back to a real probe and restores caller CODEX_HOME'
    $selection = Select-CodexSandboxMode -CodexBin $env:CODEX_DO_BIN -Dir $repo -AccountHome $fixtureRoot
    $probeRecord = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'sandbox-record.json') | ConvertFrom-Json
    Assert-True ($selection.Mode -ceq 'elevated' -and $probeRecord.home -ceq $fixtureRoot) 'Start-Process fallback selects the requested account home'
  } finally { Set-Item Function:Initialize-CodexSandboxProcess $initializeProbe }
  # Exercise exact-process cleanup with a synthetic WMI snapshot in this sandbox.
  # The detached suite separately checks real Win32_Process ancestry on Windows.
  $probeRoot = $null; $probeChild = $null
  $previousCim = Get-Item Function:Get-CimInstance -ErrorAction SilentlyContinue
  try {
    $probeStart = [DateTime]::UtcNow
    $probeRoot = Start-Process -FilePath powershell -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru
    $probeChild = Start-Process -FilePath powershell -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru
    $null = $probeRoot.Handle; $null = $probeChild.Handle
    $cimFilters = New-Object Collections.ArrayList
    function Get-CimInstance {
      param($ClassName, $Filter, $OperationTimeoutSec, $ErrorAction)
      [void]$cimFilters.Add($Filter)
      if ($Filter -ceq "ParentProcessId = $($probeRoot.Id)") {
        [pscustomobject]@{ ProcessId = $probeChild.Id; CreationDate = $probeChild.StartTime }
        # A reused parent PID must not make an older process part of this tree.
        [pscustomobject]@{ ProcessId = $PID; CreationDate = (Get-Process -Id $PID).StartTime }
      }
    }
    Stop-CodexSandboxProbeTree -Root $probeRoot -ProbeStartedUtc $probeStart
    Assert-True ($probeRoot.HasExited -and $probeChild.WaitForExit(1000) -and $cimFilters.Contains("ParentProcessId = $($probeChild.Id)")) 'fallback cleanup stops root and walks descendants by exact PID'
    Assert-True ($null -ne (Get-Process -Id $PID)) 'fallback cleanup rejects a process born before the probe'
  } finally {
    if ($previousCim) { Set-Item Function:Get-CimInstance $previousCim.ScriptBlock }
    else { Remove-Item Function:Get-CimInstance -ErrorAction SilentlyContinue }
    foreach ($process in @($probeRoot, $probeChild)) {
      if ($null -ne $process) { if (-not $process.HasExited) { $process.Kill() }; $process.Dispose() }
    }
  }
  $errorLine = '2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed: helper_unknown_error'
  foreach ($text in @('Prompt: setup refresh had errors', ('+' + $errorLine), 'Failed to create unified exec process: helper_unknown_error')) {
    Assert-True (-not (Get-CodexSandboxFailure -Text $text)) 'shared classifier rejects plain prompt, diff and tool output'
  }
  Assert-True ((Get-CodexSandboxFailure -Text $errorLine) -ceq $errorLine) 'shared classifier accepts timestamped router error'
  $coloredError = [string][char]27 + '[31m' + $errorLine
  Assert-True ((Get-CodexSandboxFailure -Text $coloredError) -ceq $coloredError) 'ANSI-prefixed sandbox router error is detected'
  Assert-True (-not (Get-CodexSandboxFailure -Text '2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed: CreateProcess: file not found')) 'non-sandbox router CreateProcess error is ignored'
  $env:CODEX_HOME = $originalHome

  # Completion logging must survive absent, corrupt and exclusively locked metadata.
  $env:CODEX_DO_NOTIFY = '0'
  foreach ($metadataKind in @('missing', 'corrupt', 'locked')) {
    $noticeFolder = Join-Path $fixtureRoot ('runs\notice-' + $metadataKind)
    New-Item -ItemType Directory -Path $noticeFolder -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $noticeFolder 'exit.txt'), '0', $utf8)
    [IO.File]::WriteAllText((Join-Path $noticeFolder 'out.log'), $errorLine, $utf8)
    $lock = $null
    try {
      if ($metadataKind -ne 'missing') { [IO.File]::WriteAllText((Join-Path $noticeFolder 'run.json'), '{invalid json', $utf8) }
      if ($metadataKind -eq 'locked') { $lock = [IO.File]::Open((Join-Path $noticeFolder 'run.json'), 'Open', 'ReadWrite', 'None') }
      & powershell -NoProfile -ExecutionPolicy Bypass -Sta -File (Join-Path $root 'codex-run-notify.ps1') -RunFolder $noticeFolder
      Assert-True ($LASTEXITCODE -eq 0 -and @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'runs\notify.log') | Where-Object { $_ -like "*|notice-$metadataKind|failed|0" }).Count -eq 1) "completion logs before $metadataKind metadata access"
    } finally { if ($null -ne $lock) { $lock.Dispose() } }
  }
  $stateBefore = $env:CODEX_DO_STATE_DIR
  $accountsBefore = $env:CODEX_ACC_ROOT
  $mainBefore = $env:CODEX_ACC_MAIN_HOME
  $staleBefore = $env:CODEX_DO_STALE_SECONDS
  try {
    $env:CODEX_DO_STATE_DIR = $fixtureRoot
    $env:CODEX_ACC_ROOT = Join-Path $fixtureRoot 'accounts'
    $env:CODEX_ACC_MAIN_HOME = Join-Path $fixtureRoot 'main'
    $env:CODEX_DO_STALE_SECONDS = '600'
    $dispatcher = Join-Path $root 'codex-do.ps1'
    $completed = Join-Path $fixtureRoot 'runs\20261012-000001-0001'
    $unfinished = Join-Path $fixtureRoot 'runs\20261012-000002-0002'
    $live = Join-Path $fixtureRoot 'runs\20261012-000003-0003'
    foreach ($folder in @($completed, $unfinished, $live)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    $meta = @{ runId = '20261012-000001-0001'; dir = $repo; model = 'fake'; account = 'main'; resume = ''; startedUtc = [DateTime]::UtcNow.AddMinutes(-12).ToString('o'); wrapperPid = 2147483647 }
    [IO.File]::WriteAllText((Join-Path $completed 'run.json'), ($meta | ConvertTo-Json), $utf8)
    [IO.File]::WriteAllText((Join-Path $completed 'exit.txt'), '7', $utf8)
    [IO.File]::WriteAllText((Join-Path $completed 'out.log'), 'finished fixture: setup refresh had errors', $utf8)
    [IO.File]::WriteAllText((Join-Path $unfinished 'run.json'), '{"wrapperPid":0}', $utf8)
    [IO.Directory]::SetCreationTimeUtc($unfinished, [DateTime]::UtcNow.AddSeconds(1))
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Attach last) -join "`n"
    Assert-True ($LASTEXITCODE -eq 7 -and $resultText.Contains('finished fixture')) 'Attach last skips wrapperPid zero and ignores plain markers'
    $meta.runId = '20261012-000003-0003'
    $meta.wrapperPid = $PID
    $meta.wrapperCreationDate = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    [IO.File]::WriteAllText((Join-Path $live 'run.json'), ($meta | ConvertTo-Json), $utf8)
    $log = Join-Path $live 'out.log'
    $activity = Join-Path $live 'activity.txt'
    [IO.File]::WriteAllText($log, 'live fixture', $utf8)
    [IO.File]::WriteAllText((Join-Path $live 'activity.len'), '12', $utf8)
    [IO.File]::SetLastWriteTimeUtc($log, [DateTime]::UtcNow.AddMinutes(-12))
    [IO.File]::WriteAllText($activity, [DateTime]::UtcNow.ToString('o'), $utf8)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($LASTEXITCODE -eq 0 -and $resultText -match '20261012-000003-0003.*running') 'fresh activity overrides old output mtime'
    [IO.File]::WriteAllText($activity, [DateTime]::UtcNow.AddMinutes(-13).ToString('o'), $utf8)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($resultText -match '20261012-000003-0003.*STALE') 'old activity and old output are STALE'
    [IO.File]::SetLastWriteTimeUtc($log, [DateTime]::UtcNow)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($resultText -match '20261012-000003-0003.*running') 'fresh output mtime overrides old activity'
    # Keep the log handle open: directory metadata need not expose its current size.
    $writer = [IO.File]::Open($log, 'Append', 'Write', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
      $bytes = $utf8.GetBytes(' more output')
      $writer.Write($bytes, 0, $bytes.Length); $writer.Flush()
      [IO.File]::SetLastWriteTimeUtc($log, [DateTime]::UtcNow.AddMinutes(-12))
      $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
      Assert-True ($resultText -match '20261012-000003-0003.*running' -and [IO.File]::ReadAllText((Join-Path $live 'activity.len')) -ceq '24') 'Status detects growth through an open log handle without an observer'
      Assert-True ([IO.File]::ReadAllText($activity) -match '^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$') 'activity remains one UTC ISO line'
    } finally { $writer.Dispose() }
    $meta.runId = '20261012-000002-0002'; $meta.wrapperPid = 0
    $meta.startedUtc = [DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText((Join-Path $unfinished 'run.json'), ($meta | ConvertTo-Json), $utf8)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($resultText -match '20261012-000002-0002.*starting') 'unpublished wrapper starts with a 30 second grace period'
    $meta.startedUtc = [DateTime]::UtcNow.AddSeconds(-31).ToString('o')
    [IO.File]::WriteAllText((Join-Path $unfinished 'run.json'), ($meta | ConvertTo-Json), $utf8)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($resultText -match '20261012-000002-0002.*DIED') 'unpublished wrapper becomes DIED after grace period'
    $cached = Read-CodexRunMetadata -Folder $completed
    Assert-True ($null -ne $cached.PSObject.Properties['sandboxFailure'] -and $cached.sandboxFailure -eq $false) 'Status persists a negative sandbox scan'
    [IO.File]::WriteAllText((Join-Path $completed 'out.log'), $errorLine, $utf8)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($resultText -match '20261012-000001-0001.*failed 7') 'Status skips rescanning a cached negative result'
    $cached.PSObject.Properties.Remove('sandboxFailure')
    [IO.File]::WriteAllText((Join-Path $completed 'run.json'), ($cached | ConvertTo-Json), $utf8)
    $resultText = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -Status) -join "`n"
    Assert-True ($resultText -match '20261012-000001-0001.*failed 72' -and (Read-CodexRunMetadata -Folder $completed).sandboxFailure -eq $true) 'Status persists a positive sandbox scan'
  } finally {
    $env:CODEX_DO_STATE_DIR = $stateBefore
    $env:CODEX_ACC_ROOT = $accountsBefore
    $env:CODEX_ACC_MAIN_HOME = $mainBefore
    $env:CODEX_DO_STALE_SECONDS = $staleBefore
  }
  $env:REVIEW_SELFTEST_MODE = 'pass'
  # Only servers with an [mcp_servers.<name>] table get overrides; plugin servers such as code-review do not.
  $env:FAKE_MCP_SERVERS = 'code-review,context7,cua_repl'
  $result = Invoke-Review 'plugin-mcp-servers' @('-Dir', $repo)
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  Assert-True ($result.Code -eq 0 -and $record.Arguments -contains 'mcp_servers.context7.enabled=false' -and
    @($record.Arguments | Where-Object { $_ -like 'mcp_servers.*' }).Count -eq 1) 'plugin servers without a config table get no override'
  foreach ($servers in @('codex', 'node_repl', '')) {
    $env:FAKE_MCP_SERVERS = $servers
    $result = Invoke-Review ('servers-' + $servers) @('-Dir', $repo)
    $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
    Assert-True ($result.Code -eq 0 -and $record.Arguments -contains 'notify=[]') 'user config always disables notify'
    foreach ($server in @('codex', 'node_repl')) {
      Assert-True (($record.Arguments -contains "mcp_servers.$server.enabled=false") -eq ($servers -eq $server)) "override only present server $server"
    }
  }
  $env:FAKE_MCP_SERVERS = 'context7,github,codex'
  $result = Invoke-Review 'all-mcp-servers' @('-Dir', $repo)
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  Assert-True ($result.Code -eq 0 -and $record.Arguments -contains 'notify=[]') 'all-server inventory preserves notify suppression'
  foreach ($server in @('context7', 'github', 'codex')) {
    Assert-True ($record.Arguments -contains "mcp_servers.$server.enabled=false") "disables inventory server $server"
  }
  $env:FAKE_MCP_SERVERS = 'context7,with.dot,with space,valid-name_1'
  $result = Invoke-Review 'unsafe-mcp-names' @('-Dir', $repo)
  $record = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot 'mock-record.json') | ConvertFrom-Json
  Assert-True ($result.Code -eq 0 -and $record.Arguments -contains 'mcp_servers.context7.enabled=false' -and
    $record.Arguments -contains 'mcp_servers.valid-name_1.enabled=false') 'valid names retain MCP overrides'
  Assert-True ($record.Arguments -notcontains 'mcp_servers.with.dot.enabled=false' -and
    $record.Arguments -notcontains 'mcp_servers.with space.enabled=false' -and
    @($record.Arguments | Where-Object { $_ -like 'mcp_servers.*' }).Count -eq 2) 'dot and space names get no override'
  $env:FAKE_SANDBOX = 'both-fail'
  $probesBefore = @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'sandbox-count.txt')).Count
  $result = Invoke-Review 'skip-model' @('-Dir', $repo, '-SkipModel')
  Assert-True ($result.Code -eq 0 -and @(Get-Content -LiteralPath (Join-Path $fixtureRoot 'sandbox-count.txt')).Count -eq $probesBefore) 'SkipModel never preflights'
  $env:FAKE_SANDBOX = 'ok'

  $env:CODEX_DO_BIN = Join-Path $fixtureRoot 'must-not-launch.exe'
  $result = Invoke-Review 'base-empty' @('-Dir', $repo, '-Base', 'HEAD')
  Assert-True ($result.Code -eq 0 -and $result.Text -match 'empty diff') 'Base excludes uncommitted changes'

  $packageFile = Join-Path $repo 'package.json'
  try {
    [IO.File]::WriteAllText($packageFile, '{"scripts":{"typecheck":"node -e \"process.exit(0)\"","lint":"node -e \"process.exit(1)\""}}', $utf8)
    $result = Invoke-Review 'npm-gates' @('-Dir', $repo)
    Assert-True ($result.Code -eq 1 -and $result.Text -match 'GATE typecheck: PASS' -and $result.Text -match 'GATE lint: FAIL') 'npm scripts run in the fixture and propagate failures'
    Assert-True ($result.Text -notmatch '(?m)^-> ') 'npm failure blocks Codex'
  } finally { Remove-Item -LiteralPath $packageFile -ErrorAction SilentlyContinue }

  $spaced = Join-Path $repo 'space name.js'
  try {
    [IO.File]::WriteAllText($spaced, "console.log('spaced');`n", $utf8)
    $result = Invoke-Review 'spaced-path' @('-Dir', $repo)
    Assert-True ($result.Code -eq 1 -and $result.Text -match 'space name.js:1:') 'console gate recognizes paths with spaces'
  } finally { Remove-Item -LiteralPath $spaced -ErrorAction SilentlyContinue }

  $mutationScript = Join-Path $repo 'lint-fixture.cjs'
  try {
    [IO.File]::WriteAllText($mutationScript, "require('fs').appendFileSync('a.js', '\nconsole.log(1);\n');", $utf8)
    [IO.File]::WriteAllText($packageFile, '{"scripts":{"lint":"node lint-fixture.cjs"}}', $utf8)
    $result = Invoke-Review 'gate-mutation' @('-Dir', $repo)
    Assert-True ($result.Code -eq 1 -and $result.Text -match 'GATE console: FAIL' -and $result.Text -match 'a.js:6:') 'scan includes changes made by command gates'
  } finally {
    Remove-Item -LiteralPath $packageFile -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $mutationScript -ErrorAction SilentlyContinue
  }

  $dummySecrets = @(('sk-' + ('A' * 20)), ('ghp_' + ('B' * 20)), ('AKIA' + ('C' * 16)), '-----BEGIN RSA PRIVATE KEY-----', 'fixture-password-value')
  Write-Fixture ("function add(a,b) {`n  return a+b;`n}`n" + ($dummySecrets[0..3] -join "`n") + "`nconst PASSWORD = 'fixture-password-value';`n")
  try {
    Invoke-FixtureGit @('add', 'a.js')
    $result = Invoke-Review 'staged-secrets' @('-Dir', $repo)
    Assert-True ($result.Code -eq 1 -and $result.Text -match 'GATE secrets: FAIL \(5 added lines\)') 'all five secret patterns are detected in staged changes'
    foreach ($secret in $dummySecrets) {
      Assert-True (-not $result.Text.Contains($secret)) 'matched synthetic secret is absent from output'
    }
  } finally { Invoke-FixtureGit @('reset', '--', 'a.js') }
  Write-Fixture "function add(a,b) {`n  // Return the sum.`n  return a+b;`n}`n"

  $tsconfig = Join-Path $repo 'tsconfig.json'
  $fakeTools = Join-Path $fixtureRoot 'tools'
  $testOriginalPath = $env:Path
  $npxLog = Join-Path $fixtureRoot 'npx-args.txt'
  try {
    New-Item -ItemType Directory -Path $fakeTools -Force | Out-Null
    [IO.File]::WriteAllText($tsconfig, '{}', $utf8)
    [IO.File]::WriteAllText((Join-Path $fakeTools 'npx.cmd'), "@echo off`r`necho %*>>`"%REVIEW_SELFTEST_ROOT%\npx-args.txt`"`r`nexit /b 0`r`n", $utf8)
    [IO.File]::WriteAllText($npxLog, '', $utf8)
    $env:Path = $fakeTools + ';' + $testOriginalPath
    $env:CODEX_DO_BIN = Join-Path $fixtureRoot 'mock-codex.cmd'
    $env:REVIEW_SELFTEST_MODE = 'pass'
    $result = Invoke-Review 'tsc-fallback' @('-Dir', $repo)
    $npxArgs = @(Get-Content -LiteralPath $npxLog)
    Assert-True ($result.Code -eq 0 -and $result.Text -match 'GATE typecheck: PASS') 'available tsc fallback runs'
    Assert-True ($npxArgs.Count -eq 2 -and $npxArgs[0] -eq '--no-install tsc --version' -and $npxArgs[1] -eq '--no-install tsc --noEmit -p tsconfig.json') 'tsc probe and gate receive exact arguments'
    [IO.File]::WriteAllText((Join-Path $fakeTools 'npx.cmd'), "@echo off`r`nexit /b 1`r`n", $utf8)
    $result = Invoke-Review 'tsc-unavailable' @('-Dir', $repo)
    Assert-True ($result.Code -eq 0 -and $result.Text -match 'GATE typecheck: SKIP \(no typecheck script or installed tsc\)') 'unavailable tsc fallback skips'
  } finally {
    $env:Path = $testOriginalPath
    Remove-Item -LiteralPath $tsconfig -ErrorAction SilentlyContinue
  }

  if (-not $OfflineOnly) {
    $env:CODEX_DO_BIN = $originalBin
    Write-Fixture "function add(a,b) {`n  return a-b;`n}`n"
    $result = Invoke-Review 'subtraction' @('-Dir', $repo, '-Effort', 'low', '-Prompt', (New-SelftestPacket 'Criteria: add(a,b) must return the sum of a and b.'))
    Assert-True ($result.Text -match '(?m)^-> ') 'real reviewer launched'
    Assert-True ($result.Code -eq 1 -and $result.Text -match '(?m)^VERDICT: FAIL(?: \(criteria not reported\))?\s*$') 'subtraction review fails'
    Assert-True ($result.Text -match '(?i)subtract|a\s*-\s*b|difference') 'reviewer identifies subtraction'
    Write-Fixture "function add(a,b) {`n  // Return the sum.`n  return a+b;`n}`n"
    $reviewFile = Join-Path $fixtureRoot 'pass-report.txt'
    $result = Invoke-Review 'fixed' @('-Dir', $repo, '-Effort', 'low', '-OutFile', $reviewFile, '-Prompt', (New-SelftestPacket 'Criteria: add(a,b) must return the sum of a and b.'))
    Assert-True ($result.Code -eq 0 -and $result.Text -match '(?m)^VERDICT: PASS(?: \(criteria not reported\))?\s*$') 'fixed review passes'
    $report = [IO.File]::ReadAllText($reviewFile)
    Assert-True ($report -match 'GATE secrets: PASS' -and $report -match 'VERDICT: PASS') 'OutFile includes gates and reviewer output'
  }
  Write-Host 'SELFTEST COMPLETE'
} finally {
  $env:USERPROFILE = $originalProfile
  $env:CODEX_DO_BIN = $originalBin
  $env:REVIEW_SELFTEST_MODE = $originalMockMode
  $env:REVIEW_SELFTEST_ROOT = $originalMockRoot
  $env:npm_config_cache = $originalNpmCache
  $env:FAKE_SANDBOX = $originalSandbox
  $env:FAKE_MCP_SERVERS = $originalServers
  $env:CODEX_DO_NO_FALLBACK = $originalNoFallback
  $env:CODEX_HOME = $originalHome
  $env:CODEX_DO_NOTIFY = $originalNotify
  $env:Path = $originalPath
  $env:CODEX_ACC_ROOT = $originalAccounts
  $env:CODEX_ACC_MAIN_HOME = $originalMainHome
  $env:CODEX_REVIEW_LOG = $originalReviewLog
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  $expectedParent = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
  if ((Split-Path -Parent $resolvedFixture) -ne $expectedParent -or (Split-Path -Leaf $resolvedFixture) -notlike 'codex-review-fixture-*') { throw 'Unsafe review fixture cleanup path' }
  if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
