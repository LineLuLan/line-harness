<#
.SYNOPSIS
  Verify codex-do resume and normal-run compatibility with a disposable fake Codex.
#>
$ErrorActionPreference = 'Stop'
$bin = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $bin
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([char[]]@('\', '/'))
$fixture = Join-Path $tempRoot ('codex-do-resume-fixture-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$saved = @{}
foreach ($name in @('CODEX_DO_STATE_DIR', 'CODEX_ACC_ROOT', 'CODEX_ACC_MAIN_HOME', 'CODEX_DO_BIN', 'CODEX_HOME', 'USERPROFILE', 'RESUME_TEST_RECORD', 'RESUME_TEST_EXIT', 'RESUME_TEST_ROLLOUT', 'CLAUDE_CODE_SESSION_ID', 'FAKE_SANDBOX')) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
function Assert-True($Condition, [string]$Name) {
  if (-not $Condition) { throw "SELFTEST FAIL: $Name" }
  Write-Host "SELFTEST PASS: $Name"
}
function Write-TestFile([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, $utf8)
}
function Invoke-TestRun([string]$Script, [string[]]$Arguments) {
  if ($Script -eq (Join-Path $bin 'codex-do.ps1')) { $Arguments = @('-Attached') + $Arguments }
  $lines = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1)
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
}
function Read-Record {
  return ([IO.File]::ReadAllText($env:RESUME_TEST_RECORD) | ConvertFrom-Json)
}
function Assert-ArgumentsEqual($Actual, $Expected, [string]$Name) {
  Assert-True ((ConvertTo-Json -InputObject @($Actual) -Compress) -ceq (ConvertTo-Json -InputObject @($Expected) -Compress)) $Name
}
function Assert-FileEncoding([string]$Path, [string]$Name) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $content = [Text.Encoding]::UTF8.GetString($bytes)
  Assert-True ($bytes.Length -gt 3 -and -not ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) -and -not $content.Contains("`r`n")) $Name
}
try {
  New-Item -ItemType Directory -Path $fixture | Out-Null
  $baselineDir = Join-Path $fixture 'baseline'
  $workDir = Join-Path $fixture 'work'
  $env:CODEX_ACC_ROOT = Join-Path $fixture 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixture 'main'
  $env:USERPROFILE = Join-Path $fixture 'profile'
  $env:CODEX_DO_STATE_DIR = Join-Path $env:USERPROFILE '.claude\state'
  $env:CODEX_HOME = $null
  $env:CLAUDE_CODE_SESSION_ID = 'fixture-supervisor'
  $env:RESUME_TEST_RECORD = Join-Path $fixture 'record.json'
  $env:RESUME_TEST_EXIT = '0'
  $env:FAKE_SANDBOX = 'ok'
  $env:RESUME_TEST_ROLLOUT = '1'
  $env:CODEX_DO_BIN = Join-Path $fixture 'fake-codex.cmd'
  foreach ($dir in @($baselineDir, $workDir, $env:CODEX_ACC_ROOT, $env:CODEX_ACC_MAIN_HOME, $env:USERPROFILE)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $baselineLines = @(& git -C $repo show HEAD:bin/codex-do.ps1)
  if ($LASTEXITCODE -ne 0 -or $baselineLines.Count -eq 0) { throw 'SELFTEST FAIL: git baseline unavailable' }
  $baselineScript = Join-Path $baselineDir 'codex-do.ps1'
  # HEAD now defaults to detached mode; this fixture compares the Attached transport.
  $baselineText = (($baselineLines -join "`n") + "`n").Replace('[switch]$Attached,', '[switch]$Attached = $true,')
  Write-TestFile $baselineScript $baselineText
  [IO.File]::Copy((Join-Path $bin 'codex-acc-lib.ps1'), (Join-Path $baselineDir 'codex-acc-lib.ps1'))
  $sandboxLibrary = Join-Path $bin 'codex-sandbox-lib.ps1'
  if (Test-Path -LiteralPath $sandboxLibrary) { [IO.File]::Copy($sandboxLibrary, (Join-Path $baselineDir 'codex-sandbox-lib.ps1')) }

  Write-TestFile $env:CODEX_DO_BIN @'
@echo off
node "%~dp0fake-codex.js" %*
exit /b %ERRORLEVEL%
'@
  Write-TestFile (Join-Path $fixture 'fake-codex.js') @'
const fs = require('fs');
const path = require('path');
if (process.argv[2] === 'sandbox') {
  const mode = process.env.FAKE_SANDBOX;
  if (mode === 'both-fail' || (mode === 'elevated-fails' && process.argv.includes('windows.sandbox="elevated"'))) {
    console.error('windows sandbox failed: helper_unknown_error: setup refresh had errors');
    process.exit(1);
  }
  console.log('PREFLIGHT-OK');
  process.exit(0);
}
process.exitCode = Number(process.env.RESUME_TEST_EXIT || 0);
const record = {
  args: process.argv.slice(2),
  cwd: process.cwd(),
  stdin: fs.readFileSync(0, 'utf8')
};
fs.writeFileSync(process.env.RESUME_TEST_RECORD, JSON.stringify(record));
if (process.env.RESUME_TEST_ROLLOUT === '1') {
  const dir = path.join(process.env.CODEX_ACC_MAIN_HOME, 'sessions', '2026', '10', '01');
  fs.mkdirSync(dir, { recursive: true });
  // Like real Codex: session_meta records -C when given, else the process working directory.
  const a = process.argv.slice(2); const ci = a.indexOf('-C');
  const metaCwd = ci >= 0 ? a[ci + 1] : process.cwd();
  fs.writeFileSync(path.join(dir, 'rollout-2026-10-01T10-00-00-01a0f557-3c5d-7310-ae36-b114768e3377.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: '01a0f557-3c5d-7310-ae36-b114768e3377', cwd: metaCwd } }) + '\n');
  // A concurrent worker in another directory writes a newer rollout; it must never be reported.
  fs.writeFileSync(path.join(dir, 'rollout-2026-10-01T10-00-01-99999999-9999-7999-8999-999999999999.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: '99999999-9999-7999-8999-999999999999', cwd: 'C:\\elsewhere' } }) + '\n');
}
'@
  $script = Join-Path $bin 'codex-do.ps1'
  $uuid = '01a0f557-3c5d-7310-ae36-b114768e3377'
  $trail = Join-Path $env:USERPROFILE '.claude\state\dispatch-trail.log'

  # Compare actual child arguments, not the wrapper's display line.
  $normalCases = @(
    @('-Dir', $workDir, 'one line'),
    @('-Dir', $workDir, '-Model', 'gpt-6-luna', '-Fast', '-Sandbox', 'read-only', '-OutFile', (Join-Path $fixture 'answer.txt'), 'one line'),
    @('-Dir', $workDir, '-Model', 'gpt-6-sol', '-Effort', 'xhigh', '-Fast', 'one line')
  )
  foreach ($case in $normalCases) {
    $baseline = Invoke-TestRun $baselineScript $case
    Assert-True ($baseline.Code -eq 0) 'baseline run exits 0'
    $expected = @(Read-Record).Args
    $current = Invoke-TestRun $script $case
    Assert-True ($current.Code -eq 0 -and $current.Text.Contains("session: $uuid")) 'normal run exits 0 and prints session'
    Assert-ArgumentsEqual (Read-Record).Args $expected 'normal arguments equal HEAD baseline'
  }
  $normalTrail = @(Get-Content -LiteralPath $trail | Select-Object -Last 1)[0]
  Assert-True (($normalTrail -split '\|')[1] -ceq 'do') 'normal dispatch trail kind is do'

  $resume = Invoke-TestRun $script @('-Dir', $workDir, '-Resume', $uuid, '-Model', 'gpt-6-sol', 'follow up')
  $record = Read-Record
  $expectedResume = @('exec', 'resume', '--ignore-user-config', '-m', 'gpt-6-sol', '--skip-git-repo-check', '-c', 'service_tier=priority', '-c', 'windows.sandbox="elevated"', '-c', 'model_reasoning_effort=high', '-c', 'sandbox_mode="workspace-write"', $uuid, '-')
  Assert-True ($resume.Code -eq 0 -and $resume.Text.Contains("session: $uuid")) 'UUID resume exits 0 and prints session'
  Assert-ArgumentsEqual $record.Args $expectedResume 'UUID resume arguments and default sandbox'
  Assert-True (@($record.Args | Where-Object { $_ -ceq '-s' -or $_ -ceq '-C' }).Count -eq 0) 'resume omits -s and -C'
  Assert-True ($record.cwd -ceq $workDir -and $record.stdin -ceq 'follow up') 'resume working directory and inline prompt stdin'
  $resumeTrail = @(Get-Content -LiteralPath $trail | Select-Object -Last 1)[0]
  Assert-True (($resumeTrail -split '\|')[1] -ceq 'resume') 'resume dispatch trail kind is resume'

  $multiLine = "line one`nline two"
  $resume = Invoke-TestRun $script @('-Dir', $workDir, '-Resume', 'last', '-Model', 'gpt-6-luna', '-Fast', '-Sandbox', 'read-only', $multiLine)
  $record = Read-Record
  Assert-True ($resume.Code -eq 0 -and $resume.Text.Contains("session: $uuid")) 'last resume exits 0 and prints session'
  Assert-True ($record.Args[-2] -ceq '--last' -and $record.Args[-1] -ceq '-') 'last resume ends --last -'
  Assert-True (@($record.Args | Where-Object { $_ -ceq 'sandbox_mode="read-only"' }).Count -eq 1) 'resume read-only sandbox config'
  Assert-True (@($record.Args | Where-Object { $_ -ceq 'gpt-6-luna' }).Count -eq 1 -and @($record.Args | Where-Object { $_ -ceq 'model_reasoning_effort=medium' }).Count -eq 1) 'resume model and Fast effort'
  Assert-True ($record.stdin -ceq $multiLine) 'multiline resume prompt arrives on stdin'

  $specPath = Join-Path $fixture 'packet.txt'
  Write-TestFile $specPath "packet first`npacket second`n"
  $resume = Invoke-TestRun $script @('-Dir', $workDir, '-Resume', $uuid, '-Effort', 'xhigh', '-SpecFile', $specPath, '-OutFile', (Join-Path $fixture 'resume-out.txt'))
  $record = Read-Record
  Assert-True ($resume.Code -eq 0 -and $record.stdin -ceq "packet first`npacket second") 'SpecFile resume prompt arrives on stdin'
  Assert-True (@($record.Args | Where-Object { $_ -ceq 'model_reasoning_effort=xhigh' }).Count -eq 1 -and $record.Args[-4] -ceq '-o') 'resume explicit effort and OutFile'

  Remove-Item -LiteralPath $env:RESUME_TEST_RECORD -Force
  $invalid = Invoke-TestRun $script @('-Dir', $workDir, '-Resume', 'garbage', 'follow up')
  Assert-True ($invalid.Code -eq 64 -and $invalid.Text.Contains("codex-do: -Resume must be 'last' or a session UUID") -and -not (Test-Path -LiteralPath $env:RESUME_TEST_RECORD)) 'invalid resume exits 64 before fake binary'

  $env:RESUME_TEST_EXIT = '7'
  $failedChild = Invoke-TestRun $script @('-Dir', $workDir, '-Resume', $uuid, 'follow up')
  Assert-True ($failedChild.Code -eq 7 -and $failedChild.Text.Contains("session: $uuid")) 'resume child exit 7 propagates and prints session'
  $env:RESUME_TEST_EXIT = '0'

  $env:RESUME_TEST_ROLLOUT = '0'
  Remove-Item -LiteralPath (Join-Path $env:CODEX_ACC_MAIN_HOME 'sessions') -Recurse -Force
  $unknown = Invoke-TestRun $script @('-Dir', $workDir, 'one line')
  Assert-True ($unknown.Code -eq 0 -and $unknown.Text.Contains('session: unknown')) 'missing rollout prints unknown without changing exit'

  Assert-FileEncoding $script 'codex-do UTF-8 without BOM and LF'
  Assert-FileEncoding $PSCommandPath 'selftest UTF-8 without BOM and LF'
  Write-Host 'SELFTEST COMPLETE'
} finally {
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  $resolved = [IO.Path]::GetFullPath($fixture)
  if ((Split-Path -Parent $resolved) -ne $tempRoot -or (Split-Path -Leaf $resolved) -notlike 'codex-do-resume-fixture-*') { throw 'SELFTEST FAIL: unsafe fixture cleanup path' }
  if (Test-Path -LiteralPath $resolved) {
    Get-ChildItem -LiteralPath $resolved -Recurse -Directory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | ForEach-Object { [IO.Directory]::Delete($_.FullName) }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
