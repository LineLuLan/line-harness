<#
.SYNOPSIS
  Verify Line's account isolation using disposable homes and a fake Codex only.
#>
$ErrorActionPreference = 'Stop'
$bin = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $PSScriptRoot ('codex-acc-fixture-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$saved = @{}
foreach ($name in @('CODEX_ACC_ROOT', 'CODEX_ACC_MAIN_HOME', 'CODEX_DO_BIN', 'CODEX_HOME', 'USERPROFILE', 'ACC_TEST_RECORD', 'ACC_TEST_AUTH', 'ACC_TEST_EXIT')) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
function Assert-True($Condition, [string]$Label) {
  if (-not $Condition) { throw "SELFTEST FAIL: $Label" }
  Write-Host "SELFTEST PASS: $Label"
}
function Write-TestFile([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, $utf8)
}
function New-TestAuth([string]$Email) {
  $payload = @{ email = $Email; 'https://api.openai.com/auth' = @{ chatgpt_plan_type = 'pro' } } | ConvertTo-Json -Compress
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  return (@{ tokens = @{ id_token = "eyJhbGciOiJub25lIn0.$encoded." } } | ConvertTo-Json -Compress)
}
function Invoke-TestScript([string]$Script, [string[]]$Arguments) {
  $lines = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin $Script) @Arguments 2>&1)
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
}
function Assert-Run([string]$Script, [string[]]$Arguments, [string]$ExpectedHome, [int]$ExpectedCode = 0) {
  Write-TestFile $env:ACC_TEST_RECORD 'not called'
  $result = Invoke-TestScript $Script $Arguments
  if ($result.Code -ne $ExpectedCode) { throw "$Script expected exit $ExpectedCode, got $($result.Code): $($result.Text)" }
  Assert-True ($true) "$Script exit $ExpectedCode ($($Arguments -join ' '))"
  Assert-True (([IO.File]::ReadAllText($env:ACC_TEST_RECORD).Trim()) -ceq $ExpectedHome) "$Script child CODEX_HOME correct"
}
try {
  New-Item -ItemType Directory -Path $fixture | Out-Null
  $env:CODEX_ACC_ROOT = Join-Path $fixture 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixture 'main'
  $env:USERPROFILE = Join-Path $fixture 'profile'
  $env:CODEX_HOME = $null
  $env:ACC_TEST_RECORD = Join-Path $fixture 'called-home.txt'
  $env:ACC_TEST_AUTH = Join-Path $fixture 'synthetic-auth.json'
  $env:ACC_TEST_EXIT = '0'
  $env:CODEX_DO_BIN = Join-Path $fixture 'fake-codex.cmd'
  foreach ($dir in @($env:USERPROFILE, $env:CODEX_ACC_MAIN_HOME, (Join-Path $env:CODEX_ACC_MAIN_HOME '.sandbox'), (Join-Path $env:CODEX_ACC_MAIN_HOME '.sandbox-bin'), (Join-Path $env:CODEX_ACC_MAIN_HOME 'skills'), (Join-Path $env:CODEX_ACC_MAIN_HOME 'rules'), (Join-Path $env:CODEX_ACC_MAIN_HOME 'sessions/2026/09/28'))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  Write-TestFile (Join-Path $env:CODEX_ACC_MAIN_HOME 'config.toml') 'model = "fixture"'
  Write-TestFile (Join-Path $env:CODEX_ACC_MAIN_HOME 'AGENTS.md') 'Fixture instructions'
  Write-TestFile (Join-Path $env:CODEX_ACC_MAIN_HOME '.sandbox/fixture.txt') 'sandbox fixture'
  Write-TestFile (Join-Path $env:CODEX_ACC_MAIN_HOME '.sandbox-bin/fixture.txt') 'sandbox bin fixture'
  Write-TestFile (Join-Path $env:CODEX_ACC_MAIN_HOME 'auth.json') (New-TestAuth 'main@example.test')
  Write-TestFile $env:ACC_TEST_AUTH (New-TestAuth 'work@example.test')
  $limits = '{"payload":{"rate_limits":{"primary":{"window_minutes":300,"used_percent":12.5},"secondary":{"window_minutes":10080,"used_percent":41,"resets_at":1790640000}}}}'
  Write-TestFile (Join-Path $env:CODEX_ACC_MAIN_HOME 'sessions/2026/09/28/rollout-x.jsonl') ($limits + "`n" + '{"payload":{"message":"later event"}}')
  Write-TestFile $env:CODEX_DO_BIN @'
@echo off
if defined CODEX_HOME (
  >"%ACC_TEST_RECORD%" echo %CODEX_HOME%
) else (
  >"%ACC_TEST_RECORD%" echo NONE
)
if "%~1"=="login" copy /y "%ACC_TEST_AUTH%" "%CODEX_HOME%\auth.json" >nul
if "%~1"=="review" echo VERDICT: PASS
node "%~dp0fake-args.js" %*
exit /b %ACC_TEST_EXIT%
'@
  Write-TestFile (Join-Path $fixture 'fake-args.js') "require('fs').writeFileSync(process.env.ACC_TEST_RECORD + '.args', JSON.stringify(process.argv.slice(2)));"
  $before = @{}
  Get-ChildItem -LiteralPath $env:CODEX_ACC_MAIN_HOME -Recurse -File | ForEach-Object { $before[$_.FullName] = (Get-FileHash -LiteralPath $_.FullName).Hash }

  Assert-True (Test-Path -LiteralPath (Join-Path $bin 'codex-acc-lib.ps1')) 'shared helper exists'
  . (Join-Path $bin 'codex-acc-lib.ps1')
  Assert-True ((Get-CodexActiveAccount) -ceq 'main') 'unset active means main'
  $info = Get-CodexAccountInfo -Name main
  Assert-True ($info.Email -ceq 'main@example.test' -and $info.Plan -ceq 'pro' -and $info.WeeklyUsedPct -eq 41 -and $info.PrimaryUsedPct -eq 12.5) 'synthetic JWT claims and weekly 41 / primary 12.5 decoded'
  $expectedReset = [DateTimeOffset]::FromUnixTimeSeconds(1790640000).LocalDateTime.ToString('yyyy-MM-dd HH:mm')
  Assert-True ($info.WeeklyResetsAt -ceq $expectedReset) 'weekly reset converted to local time'
  $result = Invoke-TestScript 'codex-acc.ps1' @('add', 'work', '-NoLogin')
  $workHome = Join-Path $env:CODEX_ACC_ROOT 'work'
  Assert-True ($result.Code -eq 0 -and $result.Text.Contains('codex-acc.ps1 login work')) 'add -NoLogin prints deferred login command'
  foreach ($entry in @('config.toml', 'AGENTS.md', '.sandbox/fixture.txt', '.sandbox-bin/fixture.txt')) {
    Assert-True (Test-Path -LiteralPath (Join-Path $workHome $entry)) "add copies $entry"
  }
  foreach ($entry in @('skills', 'rules')) {
    $link = Get-Item -LiteralPath (Join-Path $workHome $entry)
    Assert-True ($link.LinkType -eq 'Junction' -and $link.Target -eq (Join-Path $env:CODEX_ACC_MAIN_HOME $entry)) "add creates $entry junction"
  }
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $workHome 'auth.json')) -and -not (Test-Path -LiteralPath (Join-Path $workHome 'sessions'))) 'add does not copy auth or sessions'
  foreach ($bad in @('main', 'acc1', 'acc2', '../bad', 'Bad', 'bad_name', ('a' * 33), 'work')) {
    $result = Invoke-TestScript 'codex-acc.ps1' @('add', $bad, '-NoLogin')
    Assert-True ($result.Code -ne 0) "add refuses $bad"
  }
  $active = Join-Path $env:CODEX_ACC_ROOT 'active'
  Write-TestFile $active 'main'
  $result = Invoke-TestScript 'codex-acc.ps1' @('use', 'work')
  Assert-True ($result.Code -eq 3 -and [IO.File]::ReadAllText($active) -ceq 'main') 'use rejects logged-out account with exit 3 and preserves active'
  Assert-Run 'codex-acc.ps1' @('login', 'work') $workHome
  Write-TestFile (Join-Path $workHome 'config.toml') 'stale'
  Write-TestFile (Join-Path $workHome 'AGENTS.md') 'stale'
  $result = Invoke-TestScript 'codex-acc.ps1' @('use', 'work')
  Assert-True ($result.Code -eq 0 -and [IO.File]::ReadAllText($active).Trim() -ceq 'work' -and $result.Text.Contains('active: work (work@example.test)')) 'use succeeds after fake login'
  Assert-True ([IO.File]::ReadAllBytes($active)[0] -ne 239) 'active file has no BOM'
  foreach ($entry in @('config.toml', 'AGENTS.md')) {
    Assert-True ((Get-FileHash (Join-Path $workHome $entry)).Hash -ceq (Get-FileHash (Join-Path $env:CODEX_ACC_MAIN_HOME $entry)).Hash) "use re-syncs $entry"
  }
  $result = Invoke-TestScript 'codex-acc.ps1' @('list')
  Assert-True ($result.Code -eq 0 -and $result.Text.Contains('main@example.test') -and $result.Text.Contains('work@example.test') -and $result.Text -match '41' -and $result.Text -match '\*\s+work') 'list contains both emails, active marker, and weekly 41'
  $result = Invoke-TestScript 'codex-acc.ps1' @('status')
  Assert-True ($result.Code -eq 0 -and $result.Text.Contains($workHome)) 'status includes active home'
  $result = Invoke-TestScript 'codex-acc.ps1' @('env', 'main')
  Assert-True ($result.Text.Trim() -ceq 'Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue') 'env main removes override'
  $result = Invoke-TestScript 'codex-acc.ps1' @('env', 'work')
  Assert-True ($result.Text.Trim() -ceq ("`$env:CODEX_HOME='" + $workHome + "'")) 'env extra account is exact'
  $result = Invoke-TestScript 'codex-acc.ps1' @('unknown')
  Assert-True ($result.Code -eq 64 -and $result.Text -match 'Usage') 'unknown command exits 64 with usage'
  Assert-Run 'codex-acc.ps1' @('run', '--', '--help') $workHome
  Assert-Run 'codex-acc.ps1' @('run', '-Account', 'main', '--', '--help') 'NONE'
  $argRunner = Join-Path $fixture 'forward-args.ps1'
  Write-TestFile $argRunner @'
param($Script)
& $Script run -- --message 'two words' 'a"b' '' 'tail\'
'@
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $argRunner (Join-Path $bin 'codex-acc.ps1')
  $forwarded = [IO.File]::ReadAllText($env:ACC_TEST_RECORD + '.args') | ConvertFrom-Json
  Assert-True ($forwarded.Count -eq 5 -and $forwarded[0] -ceq '--message' -and $forwarded[1] -ceq 'two words' -and $forwarded[2] -ceq 'a"b' -and $forwarded[3] -ceq '' -and $forwarded[4] -ceq 'tail\') 'run forwards flags, spaces, quotes, empty arguments, and backslashes'
  Assert-Run 'codex-do.ps1' @('-Account', 'work', '-Dir', $fixture, 'fixture') $workHome
  Assert-Run 'codex-do.ps1' @('-Dir', $fixture, 'fixture') $workHome
  Assert-Run 'codex-do.ps1' @('-Account', 'main', '-Dir', $fixture, 'fixture') 'NONE'
  $result = Invoke-TestScript 'codex-do.ps1' @('-Account', 'missing', '-Dir', $fixture, 'fixture')
  Assert-True ($result.Code -eq 5 -and $result.Text.Contains("account 'missing' not found")) 'do missing account exits 5'
  New-Item -ItemType Directory -Path (Join-Path $env:CODEX_ACC_ROOT 'loggedout') | Out-Null
  $result = Invoke-TestScript 'codex-do.ps1' @('-Account', 'loggedout', '-Dir', $fixture, 'fixture')
  Assert-True ($result.Code -eq 5) 'do logged-out account exits 5'

  # Reuse the scratch repository's baseline locally, without creating a commit.
  $repo = Join-Path $fixture 'repo'
  & git clone --quiet --no-hardlinks (Split-Path -Parent $bin) $repo
  if ($LASTEXITCODE -ne 0) { throw 'local fixture clone failed' }
  $result = Invoke-TestScript 'codex-review.ps1' @('-Dir', $repo, '-Account', 'missing')
  Assert-True ($result.Code -eq 5 -and $result.Text -notmatch 'GATE ') 'review missing account fails before gates even with empty diff'
  Write-TestFile (Join-Path $repo 'fixture.txt') 'review fixture'
  $result = Invoke-TestScript 'codex-review.ps1' @('-Dir', $repo, '-Account', 'missing', '-SkipModel')
  Assert-True ($result.Code -eq 0 -and $result.Text.Contains('VERDICT: PASS (gates only, -SkipModel)')) "review -SkipModel ignores account and retains gates-only behavior: $($result.Text)"
  Assert-Run 'codex-review.ps1' @('-Dir', $repo, '-Account', 'work', '-SkipGates') $workHome
  Assert-Run 'codex-review.ps1' @('-Dir', $repo, '-SkipGates') $workHome
  Assert-Run 'codex-review.ps1' @('-Dir', $repo, '-Account', 'main', '-SkipGates') 'NONE'
  $result = Invoke-TestScript 'codex-review.ps1' @('-Dir', $repo, '-Account', 'missing', '-SkipGates')
  Assert-True ($result.Code -eq 5) 'review missing account exits 5'

  # Execute in one PowerShell process so restoration is measured in the actual caller.
  $runner = Join-Path $fixture 'restore.ps1'
  Write-TestFile $runner @'
param($Script, $Fixture, $Repo, $Mode, $AccountHome)
$ErrorActionPreference = 'Stop'
foreach ($previous in @($null, 'caller-home')) {
  $env:CODEX_HOME = $previous
  try {
    if ($Mode -eq 'do') { & $Script -Dir $Fixture -Account work fixture }
    elseif ($Mode -eq 'review') { & $Script -Dir $Repo -Account work -SkipGates }
    else { & $Script run -Account work -- --help }
  } catch { if ($env:ACC_TEST_EXIT -eq '0') { throw } }
  if ($env:CODEX_HOME -cne $previous) { throw 'Caller CODEX_HOME was not restored' }
}
Write-Host 'RESTORED'
'@
  foreach ($mode in @('do', 'review', 'acc')) {
    $scriptName = if ($mode -eq 'acc') { 'codex-acc.ps1' } else { "codex-$mode.ps1" }
    foreach ($code in @('0', '7')) {
      $env:ACC_TEST_EXIT = $code
      $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $runner (Join-Path $bin $scriptName) $fixture $repo $mode $workHome 2>&1)
      Assert-True (($output -join "`n") -match 'RESTORED') "$scriptName restores caller env (child exit $code)"
    }
  }
  $env:ACC_TEST_EXIT = '0'
  Write-TestFile (Join-Path $workHome 'auth.json') '{bad json'
  Assert-True (-not (Test-CodexAccountLoggedIn -Home $workHome)) 'malformed auth is logged out'
  Assert-True ($null -eq (Get-CodexAccountInfo -Name work).Email) 'malformed auth info is null without error'
  Write-TestFile (Join-Path $workHome 'auth.json') '{"OPENAI_API_KEY":"synthetic-presence-only"}'
  Assert-True (Test-CodexAccountLoggedIn -Home $workHome) 'API key presence counts as logged in'
  $after = @(Get-ChildItem -LiteralPath $env:CODEX_ACC_MAIN_HOME -Recurse -File)
  Assert-True ($after.Count -eq $before.Count) 'main file set unchanged'
  foreach ($file in $after) {
    Assert-True ((Get-FileHash -LiteralPath $file.FullName).Hash -ceq $before[$file.FullName]) "main byte-identical: $($file.Name)"
  }
  foreach ($file in @('codex-acc.ps1', 'codex-acc-lib.ps1')) {
    $path = Join-Path $bin $file
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0 -and [IO.File]::ReadAllBytes($path)[0] -ne 239) "$file parses in PowerShell $($PSVersionTable.PSVersion) without BOM"
  }
  Write-Host 'SELFTEST COMPLETE: fake homes and fake binary only'
} finally {
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  $resolved = [IO.Path]::GetFullPath($fixture)
  if ((Split-Path -Parent $resolved) -ne [IO.Path]::GetFullPath($PSScriptRoot) -or (Split-Path -Leaf $resolved) -notlike 'codex-acc-fixture-*') { throw 'Unsafe fixture cleanup path' }
  if (Test-Path -LiteralPath $resolved) {
    # Unlink junctions first; do not traverse their targets during recursive cleanup.
    Get-ChildItem -LiteralPath $resolved -Recurse -Directory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | ForEach-Object { [IO.Directory]::Delete($_.FullName) }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
