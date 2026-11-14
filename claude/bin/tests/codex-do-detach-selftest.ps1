<#
.SYNOPSIS
  Exercise detached worker lifecycle with disposable fake workers. Requires WMI access.
.PARAMETER LocalOnly
  Exercise preflight, notification logging, attach failure detection and status without WMI.
#>
param([switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fixtures\dispatch-packet.ps1')
$bin = Split-Path -Parent $PSScriptRoot
$dispatcher = Join-Path $bin 'codex-do.ps1'
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([char[]]@('\', '/'))
$fixture = Join-Path $tempRoot ('codex-do-detach-fixture-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$saved = @{}
$launchers = New-Object System.Collections.ArrayList
foreach ($name in @('CODEX_DO_STATE_DIR', 'CODEX_ACC_ROOT', 'CODEX_ACC_MAIN_HOME', 'CODEX_DO_BIN', 'CODEX_HOME', 'NODE_OPTIONS', 'FAKE_SANDBOX', 'CODEX_DO_NOTIFY', 'CODEX_DO_NO_FALLBACK', 'CODEX_DO_STALE_SECONDS')) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
function Assert-True($Condition, [string]$Name) {
  if (-not $Condition) { throw "SELFTEST FAIL: $Name" }
  Write-Host "SELFTEST PASS: $Name"
}
function Write-TestFile([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, $utf8)
}
function Invoke-TestRun([string[]]$Arguments) {
  $Arguments = @(ConvertTo-SelftestDispatchArguments -Arguments $Arguments -Folder $fixture)
  if (-not ($Arguments | Where-Object { $_ -in @('-Status','-Attach','-Cancel') })) { $Arguments = @('-NoRamCheck') + $Arguments }
  # PS 5.1 turns native stderr lines into ErrorRecords; under 'Stop' the -Attached path (stderr
  # passes straight through) would throw. Collect them as text instead (supervisor, 2026-10-09).
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $lines = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher @Arguments 2>&1 | ForEach-Object { "$_" }) }
  finally { $ErrorActionPreference = $prevPref }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
}
function Read-Record {
  return ([IO.File]::ReadAllText((Join-Path $fixture 'record.json')) | ConvertFrom-Json)
}
function Read-Run([string]$Text) {
  Assert-True ($Text -match 'run: (\d{8}-\d{6}-[0-9a-f]{4}) pid: (\d+) folder: (.+)') 'run announcement format'
  $id = $Matches[1]
  $folder = Join-Path $env:CODEX_DO_STATE_DIR "runs\$id"
  return [pscustomobject]@{ Id = $id; Folder = $folder; Meta = ([IO.File]::ReadAllText((Join-Path $folder 'run.json')) | ConvertFrom-Json) }
}
function Test-Alive([int]$ProcessId) {
  return ($null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}
function Wait-Until([scriptblock]$Condition, [string]$Name, [int]$Seconds = 15) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ($true) {
    # Records and heartbeat files may be observed between truncation and write.
    try { if (& $Condition) { return } } catch {}
    if ([DateTime]::UtcNow -ge $deadline) { throw "SELFTEST FAIL: $Name (timeout)" }
    Start-Sleep -Milliseconds 100
  }
}
function Start-TestRun([string]$Text, [string]$Name) {
  $Text = New-SelftestPacket $Text
  $spec = Join-Path $fixture "$Name.txt"
  $output = Join-Path $fixture "$Name.out"
  Write-TestFile $spec $Text
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -NoRamCheck -Dir "{1}" -SpecFile "{2}"' -f $dispatcher, $workDir, $spec
  if ($PSVersionTable.PSVersion.Major -le 5) {
    $processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
    [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
  }
  # Redirected stdout of the dispatcher is buffered until it exits (supervisor, 2026-10-09), so
  # discover the run from its new folder instead of waiting for the "run:" line.
  $runsDir = Join-Path $env:CODEX_DO_STATE_DIR 'runs'
  $known = @(Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $process = Start-Process -FilePath powershell -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $output -RedirectStandardError (Join-Path $fixture "$Name.err")
  $null = $process.Handle
  [void]$launchers.Add($process)
  $script:newRun = $null
  Wait-Until {
    $script:newRun = Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { $known -notcontains $_.Name -and (Test-Path -LiteralPath (Join-Path $_.FullName 'run.json')) -and
        ([IO.File]::ReadAllText((Join-Path $_.FullName 'run.json')) | ConvertFrom-Json).wrapperPid -gt 0 } |
      Select-Object -First 1
    $null -ne $script:newRun
  } "$Name run folder"
  $run = Read-Run ("run: $($script:newRun.Name) pid: 0 folder: $($script:newRun.FullName)")
  Wait-Until { (Test-Path -LiteralPath (Join-Path $fixture 'record.json')) -and ((Read-Record).stdin -ceq $Text) } "$Name fake startup"
  return [pscustomobject]@{ Process = $process; Run = $run; Record = (Read-Record) }
}
function Assert-Disabled($Record, [bool]$Expected, [string]$Name) {
  $joined = $Record.args -join ' '
  if ($Expected) {
    Assert-True ($joined.Contains('--disable multi_agent --disable multi_agent_v2')) $Name
  } else {
    Assert-True (-not (@($Record.args) -contains '--disable')) $Name
  }
}
try {
  New-Item -ItemType Directory -Path $fixture | Out-Null
  $workDir = Join-Path $fixture 'work space'
  $env:CODEX_DO_STATE_DIR = Join-Path $fixture 'state'
  $env:CODEX_ACC_ROOT = Join-Path $fixture 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixture 'main'
  $env:CODEX_DO_BIN = Join-Path $fixture 'fake-codex.cmd'
  $env:CODEX_HOME = $null
  $env:NODE_OPTIONS = '--no-warnings'
  $env:FAKE_SANDBOX = 'ok'
  $env:CODEX_DO_NOTIFY = '0'
  $env:CODEX_DO_NO_FALLBACK = $null
  foreach ($dir in @($workDir, $env:CODEX_ACC_ROOT, $env:CODEX_ACC_MAIN_HOME)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  # WMI does not inherit test environment variables. The fixture shim supplies only
  # its synthetic main-home path; production CODEX_HOME must come from run.cmd.
  Write-TestFile $env:CODEX_DO_BIN ((@(
    '@echo off',
    ('set "CODEX_ACC_MAIN_HOME={0}"' -f $env:CODEX_ACC_MAIN_HOME),
    ('"{0}" "%~dp0fake-codex.js" %*' -f $node),
    'exit /b %ERRORLEVEL%'
  ) -join "`r`n") + "`r`n")
  Write-TestFile (Join-Path $fixture 'fake-codex.js') @'
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const args = process.argv.slice(2);
if (args[0] === 'sandbox') {
  const mode = process.env.FAKE_SANDBOX;
  fs.appendFileSync(path.join(__dirname, 'sandbox.jsonl'), JSON.stringify({ args, cwd: process.cwd(), home: process.env.CODEX_HOME || null }) + '\n');
  if (mode === 'elevated-hangs-tree' && args.includes('windows.sandbox="elevated"')) {
    const child = spawn(process.execPath, [__filename, '--heartbeat-child', '--spawn-grandchild'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(__dirname, 'hung-probe-tree.json'), JSON.stringify({ shim: process.ppid, worker: process.pid, child: child.pid }));
    setTimeout(() => process.exit(1), 60000);
    return;
  }
  if (mode === 'elevated-hangs' && args.includes('windows.sandbox="elevated"')) {
    fs.writeFileSync(path.join(__dirname, 'hung-probe-pid.txt'), String(process.pid));
    setTimeout(() => process.exit(1), 30000);
    return;
  }
  if (mode === 'both-fail' || (mode === 'elevated-fails' && args.includes('windows.sandbox="elevated"'))) {
    console.error('windows sandbox failed: helper_unknown_error: setup refresh had errors');
    process.exit(1);
  }
  console.log('PREFLIGHT-OK');
  process.exit(0);
}
if (args.includes('--heartbeat-child')) {
  fs.writeFileSync(path.join(__dirname, `pid-${process.pid}.json`),
    JSON.stringify({ pid: process.pid, parentPid: process.ppid, role: 'descendant' }));
  const timer = setInterval(() => fs.writeFileSync(path.join(__dirname, `heartbeat-${process.pid}.txt`), String(Date.now())), 500);
  if (args.includes('--spawn-grandchild')) {
    setTimeout(() => spawn(process.execPath, [__filename, '--heartbeat-child'], { stdio: 'ignore' }), 200);
  }
  setTimeout(() => { clearInterval(timer); process.exit(0); }, 30000);
  return;
}
const stdin = fs.readFileSync(0);
const prompt = stdin.length ? stdin.toString('utf8') : args[args.length - 1];
const record = { args, cwd: process.cwd(), stdin: stdin.toString('utf8'),
  stdinHex: stdin.toString('hex'), home: process.env.CODEX_HOME || null,
  pid: process.pid, parentPid: process.ppid, nodeOptions: process.env.NODE_OPTIONS || null };
fs.writeFileSync(path.join(__dirname, 'record.json'), JSON.stringify(record));
fs.writeFileSync(path.join(__dirname, `pid-${process.pid}.json`), JSON.stringify(record));
const ci = args.indexOf('-C');
const cwd = ci >= 0 ? args[ci + 1] : process.cwd();
const oi = args.indexOf('-o');
if (oi >= 0) fs.writeFileSync(args[oi + 1], 'fake final answer\n');
const uuid = '01a0f557-3c5d-7310-ae36-b114768e3377';
const sessions = path.join(process.env.CODEX_HOME || process.env.CODEX_ACC_MAIN_HOME, 'sessions');
if (!path.resolve(sessions).toLowerCase().startsWith((path.resolve(__dirname) + path.sep).toLowerCase())) {
  throw new Error('SELFTEST FAIL: session destination escapes fixture');
}
fs.mkdirSync(sessions, { recursive: true });
fs.writeFileSync(path.join(sessions, `rollout-test-${uuid}.jsonl`),
  JSON.stringify({ type: 'session_meta', payload: { id: uuid, cwd } }) + '\n');
fs.writeFileSync(path.join(sessions, 'rollout-test-99999999-9999-7999-8999-999999999999.jsonl'),
  JSON.stringify({ type: 'session_meta', payload: { cwd: 'C:\\elsewhere' } }) + '\n');
console.log('fake first line');
console.error('fake stderr line');
if (prompt.includes('SANDBOX_FAILURE=1')) console.error('2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed: helper_unknown_error: setup refresh had errors');
if (prompt.includes('ECHO_MARKERS=1')) {
  console.log('Prompt: setup refresh had errors');
  console.log('+2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed');
  console.log('Failed to create unified exec process: helper_unknown_error: windows sandbox failed');
}
const sleep = Number((prompt.match(/SLEEP=(\d+)/) || [0, 0])[1]);
const code = Number((prompt.match(/EXIT=(\d+)/) || [0, 0])[1]);
const heartbeat = path.join(__dirname, `heartbeat-${process.pid}.txt`);
const beat = () => {
  fs.writeFileSync(heartbeat, String(Date.now()));
  if (prompt.includes('OUTPUT=1')) console.log('activity tick');
};
beat();
const timer = setInterval(beat, 500);
let spawner;
if (prompt.includes('SPAWN=1')) {
  let count = 0;
  spawner = setInterval(() => {
    spawn(process.execPath, [__filename, '--heartbeat-child', '--spawn-grandchild'], { stdio: 'ignore' });
    if (++count === 4) clearInterval(spawner);
  }, 200);
}
setTimeout(() => {
  clearInterval(timer);
  clearInterval(spawner);
  console.log('fake last line');
  process.exit(code);
}, sleep * 1000);
'@
  $uuid = '01a0f557-3c5d-7310-ae36-b114768e3377'
  if ($LocalOnly) {
    $empty = Invoke-TestRun @('-Status')
    Assert-True ($empty.Code -eq 0 -and $empty.Text.Contains('no runs in the last 24 h')) 'empty status exits zero'
    $env:FAKE_SANDBOX = 'elevated-fails'
    $fallback = Invoke-TestRun @('-Attached', '-Dir', $workDir, '-Resume', $uuid, 'fallback resume')
    Assert-True ($fallback.Code -eq 0 -and $fallback.Text.Contains('sandbox-mode: unelevated (fallback:') -and
      (Read-Record).args -contains 'windows.sandbox="unelevated"') 'attached resume uses working sandbox fallback'
    $recordBefore = [IO.File]::ReadAllText((Join-Path $fixture 'record.json'))
    $env:FAKE_SANDBOX = 'both-fail'
    $unavailable = Invoke-TestRun @('-Attached', '-Dir', $workDir, 'unavailable')
    Assert-True ($unavailable.Code -eq 73 -and $unavailable.Text.Contains('SANDBOX UNAVAILABLE:') -and
      [IO.File]::ReadAllText((Join-Path $fixture 'record.json')) -ceq $recordBefore) 'unavailable sandbox does not exec'
    $env:FAKE_SANDBOX = 'elevated-hangs'
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $timedOut = Invoke-TestRun @('-Attached', '-Dir', $workDir, 'timeout fallback')
    $hungPid = [int][IO.File]::ReadAllText((Join-Path $fixture 'hung-probe-pid.txt'))
    Write-Host ("TIMEOUT RESULT: exit={0}, seconds={1:0.00}, probeAlive={2}`n{3}" -f $timedOut.Code, $timer.Elapsed.TotalSeconds, (Test-Alive $hungPid), $timedOut.Text)
    Assert-True ($timedOut.Code -eq 0 -and $timer.Elapsed.TotalSeconds -lt 22 -and $timedOut.Text.Contains('timed out (20-second cap)') -and -not (Test-Alive $hungPid)) 'timed-out attempt and its shim child stop before fallback'
    $env:FAKE_SANDBOX = 'ok'
    . (Join-Path $bin 'codex-sandbox-lib.ps1')
    $homeBefore = $env:CODEX_HOME
    $selection = Select-CodexSandboxMode -CodexBin $env:CODEX_DO_BIN -Dir $workDir -AccountHome $env:CODEX_ACC_MAIN_HOME
    $probeRecord = Get-Content -LiteralPath (Join-Path $fixture 'sandbox.jsonl') | Select-Object -Last 1 | ConvertFrom-Json
    Assert-True ($selection.Mode -ceq 'elevated' -and $probeRecord.home -ceq $env:CODEX_ACC_MAIN_HOME -and $probeRecord.cwd -ceq $workDir -and $env:CODEX_HOME -ceq $homeBefore) 'preflight account home is child-only and cwd matches Dir'
    foreach ($marker in @('setup refresh had errors', 'Failed to create unified exec process', 'windows sandbox failed', 'helper_unknown_error')) {
      $routerLine = "2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed: helper_unknown_error: $marker"
      Assert-True ((Get-CodexSandboxFailure -Text $routerLine) -ceq $routerLine) "recognizes marker $marker"
      Assert-True (-not (Get-CodexSandboxFailure -Text "prefix $marker suffix")) "ignores echoed marker $marker"
    }
    $runs = Join-Path $env:CODEX_DO_STATE_DIR 'runs'
    $ownStarted = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    $entries = @(
      @{ id = '20261012-000000-0001'; state = 'done'; code = 0 },
      @{ id = '20261012-000000-0002'; state = 'failed 7'; code = 7 },
      @{ id = '20261012-000000-0003'; state = 'failed 72'; code = 0; marker = $true },
      @{ id = '20261012-000000-0004'; state = 'running'; live = $true },
      @{ id = '20261012-000000-0005'; state = 'STALE'; live = $true },
      @{ id = '20261012-000000-0006'; state = 'DIED' },
      @{ id = '20261012-000000-0007'; state = 'running'; tree = $true }
    )
    foreach ($entry in $entries) {
      $folder = Join-Path $runs $entry.id
      New-Item -ItemType Directory -Path $folder -Force | Out-Null
      $wrapperPid = if ($entry.live) { $PID } else { 2147483647 }
      $created = if ($entry.live) { $ownStarted } else { $null }
      Write-TestFile (Join-Path $folder 'run.json') (([ordered]@{ runId = $entry.id; dir = $workDir; model = 'fake'; account = 'main'; resume = ''; startedUtc = [DateTime]::UtcNow.AddMinutes(-12).ToString('o'); wrapperPid = $wrapperPid; wrapperCreationDate = $created }) | ConvertTo-Json)
      $output = if ($entry.marker) { '2026-10-12T10:20:30.123Z ERROR codex_core::tools::router: exec_command failed: setup refresh had errors ' + ('x' * 250) + "`n" + ("later line`n" * 250) } else { "fixture output`n" }
      Write-TestFile (Join-Path $folder 'out.log') $output
      Write-TestFile (Join-Path $folder 'activity.len') ([string]([Text.Encoding]::UTF8.GetByteCount($output)))
      if ($entry.state -eq 'STALE') { [IO.File]::SetLastWriteTimeUtc((Join-Path $folder 'out.log'), [DateTime]::UtcNow.AddMinutes(-11)) }
      if ($entry.tree) { Write-TestFile (Join-Path $folder 'tree.json') (ConvertTo-Json -InputObject @(@{ pid = $PID; parentPid = 0; created = $ownStarted })) }
      if ($entry.ContainsKey('code')) {
        Write-TestFile (Join-Path $folder 'exit.txt') ([string]$entry.code)
        $timer = [Diagnostics.Stopwatch]::StartNew()
        & powershell -NoProfile -ExecutionPolicy Bypass -Sta -File (Join-Path $bin 'codex-run-notify.ps1') -RunFolder $folder
        Assert-True ($LASTEXITCODE -eq 0 -and $timer.Elapsed.TotalSeconds -lt 15) 'notice exits zero within 15 seconds'
      }
    }
    $noticeLines = @(Get-Content -LiteralPath (Join-Path $runs 'notify.log'))
    Assert-True ($noticeLines.Count -eq 3 -and @($noticeLines | Where-Object { $_ -like '*|done|0' }).Count -eq 1 -and
      @($noticeLines | Where-Object { $_ -like '*|failed|0' }).Count -eq 1 -and @($noticeLines | Where-Object { $_ -like '*|failed|7' }).Count -eq 1) 'one completion log line per finished fixture'
    $failureFolder = Join-Path $runs '20261012-000000-0003'
    Assert-True (([IO.File]::ReadAllText((Join-Path $failureFolder 'run.json')) | ConvertFrom-Json).sandboxFailure) 'notifier records early sandbox failure beyond tail'
    $attached = Invoke-TestRun @('-Attach', '20261012-000000-0003')
    $failureLine = $attached.Text -split '\r?\n' | Where-Object { $_.StartsWith('WORKER SANDBOX FAILURE: ') } | Select-Object -First 1
    Assert-True ($attached.Code -eq 72 -and $failureLine.Length -eq ('WORKER SANDBOX FAILURE: '.Length + 200)) 'attach detects and truncates sandbox failure'
    $status = Invoke-TestRun @('-Status')
    foreach ($entry in $entries) { Assert-True ($status.Code -eq 0 -and $status.Text -match "$($entry.id).*$( [regex]::Escape($entry.state) )") "status $($entry.state)" }
    foreach ($conflict in @(@('-Status', 'dispatch'), @('-Status', '-Attach', 'last'), @('-Status', '-Cancel', 'last'), @('-Status', '-Attached'))) {
      Assert-True ((Invoke-TestRun $conflict).Code -eq 64) 'status rejects conflicting operation'
    }
    foreach ($folder in Get-ChildItem -LiteralPath $runs -Directory) { [IO.Directory]::SetCreationTimeUtc($folder.FullName, [DateTime]::UtcNow.AddHours(-2)) }
    $filtered = Invoke-TestRun @('-Status', '-Hours', '1')
    Assert-True ($filtered.Code -eq 0 -and $filtered.Text.Contains('no runs in the last 1 h')) 'status lookback filters old folders'
    Write-Host 'LOCAL SELFTEST COMPLETE'
    return
  }
  $spec = Join-Path $fixture 'packet.txt'
  $promptText = New-SelftestPacket "  literal %PATH% and a `"double quote`"`nsecond line EXIT=0`n"
  Write-TestFile $spec $promptText
  $result = Invoke-TestRun @('-Dir', $workDir, '-SpecFile', $spec)
  Assert-True ($result.Code -eq 0) ("R2 R3 detached exit 0 (actual {0}): {1}" -f $result.Code, $result.Text)
  Assert-True ($result.Text.Contains('fake first line') -and $result.Text.Contains('fake stderr line') -and $result.Text.Contains('fake last line')) 'R3 stdout and stderr tailed'
  Assert-True (([regex]::Matches($result.Text, 'fake first line')).Count -eq 1) 'R3 output not repeated'
  Assert-True ($result.Text.Contains("session: $uuid")) 'R3 session matches Dir'
  $record = Read-Record
  Assert-True ($record.nodeOptions -ceq $env:NODE_OPTIONS) 'F8 NODE_OPTIONS reaches detached worker'
  $expectedHex = -join ($utf8.GetBytes($promptText) | ForEach-Object { $_.ToString('x2') })
  Assert-True ($record.stdinHex -ceq $expectedHex) 'R2 stdin byte-exact with percent quotes and whitespace'
  Assert-True ($record.cwd -ceq $workDir) 'R2 detached cwd equals Dir'
  Assert-Disabled $record $true 'R7 detached disables both multi-agent features'
  $run = Read-Run $result.Text
  Assert-True ($run.Meta.sandboxMode -ceq 'elevated' -and $record.args -contains 'windows.sandbox="elevated"') 'default preflight selects elevated'
  Assert-True (@(Get-Content -LiteralPath (Join-Path $fixture 'sandbox.jsonl')).Count -eq 1) 'preflight runs once on default dispatch'
  $notifyLog = Join-Path $env:CODEX_DO_STATE_DIR 'runs\notify.log'
  Wait-Until { (Test-Path -LiteralPath $notifyLog) -and @(Get-Content -LiteralPath $notifyLog | Where-Object { $_ -like "*|$($run.Id)|done|0" }).Count -eq 1 } 'completion notice logs once without sound or toast'
  foreach ($file in @('stdin.txt', 'run.cmd', 'out.log', 'exit.txt', 'run.json')) {
    Assert-True (Test-Path -LiteralPath (Join-Path $run.Folder $file)) "R2 artifact $file"
  }
  Assert-True ($run.Meta.runId -ceq $run.Id -and $run.Meta.dir -ceq $workDir -and $run.Meta.model -ceq 'gpt-6-sol' -and $run.Meta.effort -ceq 'high' -and $run.Meta.account -ceq 'main' -and $run.Meta.wrapperPid -gt 0 -and $run.Meta.startedUtc -and $null -ne $run.Meta.resume) 'R2 run metadata'
  $ledger = Get-Content -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'dispatch-ledger.log')
  Assert-True (@($ledger | Where-Object { $_ -like "*|start|$($run.Meta.wrapperPid)|*" }).Count -eq 1 -and @($ledger | Where-Object { $_ -like "*|end|$($run.Meta.wrapperPid)|0" }).Count -eq 1) 'R3 ledger uses wrapper PID'
  # WMI-only regression: force the compiler fallback, then stop a hanging shim,
  # its worker, child and grandchild without touching an unrelated fixture PID.
  . (Join-Path $bin 'codex-sandbox-lib.ps1')
  $initializeProbe = (Get-Item Function:Initialize-CodexSandboxProcess).ScriptBlock
  try {
    function Initialize-CodexSandboxProcess { throw 'fixture Add-Type failure' }
    $env:FAKE_SANDBOX = 'elevated-hangs-tree'
    $probeTimer = [Diagnostics.Stopwatch]::StartNew()
    $selection = Select-CodexSandboxMode -CodexBin $env:CODEX_DO_BIN -Dir $workDir -AccountHome ''
    $probeTree = Get-Content -Raw -LiteralPath (Join-Path $fixture 'hung-probe-tree.json') | ConvertFrom-Json
    $probeGrandchildren = @(Get-ChildItem -LiteralPath $fixture -Filter 'pid-*.json' | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json } | Where-Object { $_.parentPid -eq $probeTree.child })
    Assert-True ($selection.Mode -ceq 'unelevated' -and $selection.Reason.Contains('timed out (20-second cap)') -and $probeTimer.Elapsed.TotalSeconds -lt 28) 'Start-Process timeout cleans up before fallback'
    Assert-True ($probeGrandchildren.Count -eq 1) 'hanging sandbox spawned a grandchild'
    foreach ($probePid in @($probeTree.shim, $probeTree.worker, $probeTree.child) + @($probeGrandchildren | ForEach-Object { $_.pid })) {
      Assert-True (-not (Test-Alive ([int]$probePid))) "fallback timeout stops exact probe PID $probePid"
    }
    Assert-True (Test-Alive $PID) 'fallback timeout leaves unrelated fixture process alive'
  } finally {
    Set-Item Function:Initialize-CodexSandboxProcess $initializeProbe
    $env:FAKE_SANDBOX = 'ok'
  }
  $result = Invoke-TestRun @('-Dir', $workDir, 'EXIT=7')
  Assert-True ($result.Code -eq 7 -and $result.Text.Contains("session: $uuid")) 'R3 detached exit 7 propagates'
  $result = Invoke-TestRun @('-Dir', $workDir, '-AllowSubAgents', 'EXIT=0')
  Assert-True ($result.Code -eq 0) 'R7 AllowSubAgents run succeeds'
  Assert-Disabled (Read-Record) $false 'R7 AllowSubAgents omits disable flags'
  Push-Location $fixture
  try { $result = Invoke-TestRun @('-Dir', 'work space', 'relative directory') }
  finally { Pop-Location }
  $record = Read-Record
  $ci = [array]::IndexOf(@($record.args), '-C')
  Assert-True ($result.Code -eq 0 -and $record.cwd -ceq $workDir -and $record.args[$ci + 1] -ceq $workDir) 'R2 relative Dir resolves once'
  Push-Location $fixture
  try { $result = Invoke-TestRun @('-Dir', $workDir, '-OutFile', 'relative-answer.txt', 'relative output') }
  finally { Pop-Location }
  Assert-True ($result.Code -eq 0 -and (Test-Path -LiteralPath (Join-Path $fixture 'relative-answer.txt')) -and
    -not (Test-Path -LiteralPath (Join-Path $workDir 'relative-answer.txt'))) 'G5 G6 relative OutFile uses caller cwd'

  $extraHome = Join-Path $env:CODEX_ACC_ROOT 'extra'
  New-Item -ItemType Directory -Path $extraHome | Out-Null
  Write-TestFile (Join-Path $extraHome 'auth.json') '{"tokens":{"id_token":"synthetic-fixture-only"}}'
  $result = Invoke-TestRun @('-Dir', $workDir, '-Account', 'extra', 'EXIT=0')
  Assert-True ($result.Code -eq 0 -and (Read-Record).home -ceq $extraHome) 'R2 non-main CODEX_HOME reaches worker'
  $lastProbe = Get-Content -LiteralPath (Join-Path $fixture 'sandbox.jsonl') | Select-Object -Last 1 | ConvertFrom-Json
  Assert-True ($lastProbe.home -ceq $extraHome -and $lastProbe.cwd -ceq $workDir) 'preflight uses selected account and working directory'

  $env:FAKE_SANDBOX = 'elevated-fails'
  $result = Invoke-TestRun @('-Dir', $workDir, 'fallback')
  $fallback = Read-Run $result.Text
  Assert-True ($result.Code -eq 0 -and $result.Text.Contains('sandbox-mode: unelevated (fallback:') -and
    (Read-Record).args -contains 'windows.sandbox="unelevated"' -and $fallback.Meta.sandboxMode -ceq 'unelevated') 'fallback is printed, passed and persisted'
  foreach ($strictArgs in @(@('-NoSandboxFallback'), @())) {
    $env:CODEX_DO_NO_FALLBACK = if ($strictArgs.Count) { $null } else { '1' }
    $before = @(Get-Content -LiteralPath (Join-Path $fixture 'sandbox.jsonl')).Count
    $strict = Invoke-TestRun (@('-Dir', $workDir) + $strictArgs + @('elevated required'))
    Assert-True ($strict.Code -eq 73 -and @(Get-Content -LiteralPath (Join-Path $fixture 'sandbox.jsonl')).Count -eq ($before + 1)) 'Critical dispatch probes elevated only for switch or environment opt-out'
  }
  $env:CODEX_DO_NO_FALLBACK = $null
  $env:FAKE_SANDBOX = 'both-fail'
  $recordBeforePreflight = [IO.File]::ReadAllText((Join-Path $fixture 'record.json'))
  $result = Invoke-TestRun @('-Dir', $workDir, 'unavailable')
  Assert-True ($result.Code -eq 73 -and $result.Text.Contains('SANDBOX UNAVAILABLE:') -and
    [IO.File]::ReadAllText((Join-Path $fixture 'record.json')) -ceq $recordBeforePreflight) 'both failures stop before exec'
  $env:FAKE_SANDBOX = 'ok'
  $result = Invoke-TestRun @('-Dir', $workDir, 'ECHO_MARKERS=1 EXIT=0')
  $clean = Read-Run $result.Text
  Assert-True ($result.Code -eq 0 -and -not $clean.Meta.sandboxFailure) 'clean worker echoes do not trigger sandbox failure'
  $result = Invoke-TestRun @('-Attach', $clean.Id)
  Assert-True ($result.Code -eq 0) 'attach ignores echoed marker text'
  Wait-Until { @(Get-Content -LiteralPath $notifyLog | Where-Object { $_ -like "*|$($clean.Id)|done|0" }).Count -eq 1 } 'notifier ignores echoed marker text'
  $result = Invoke-TestRun @('-Dir', $workDir, 'SANDBOX_FAILURE=1 EXIT=0')
  $failedSandbox = Read-Run $result.Text
  Assert-True ($result.Code -eq 72 -and $result.Text.Contains('WORKER SANDBOX FAILURE:') -and $failedSandbox.Meta.sandboxFailure) 'sandbox output overrides child exit zero'
  $result = Invoke-TestRun @('-Attach', $failedSandbox.Id)
  Assert-True ($result.Code -eq 72 -and $result.Text.Contains('WORKER SANDBOX FAILURE:')) 'attach detects sandbox failure'
  Wait-Until { @(Get-Content -LiteralPath $notifyLog | Where-Object { $_ -like "*|$($failedSandbox.Id)|failed|0" }).Count -eq 1 } 'failed sandbox completion logs once'
  $status = Invoke-TestRun @('-Status')
  Assert-True ($status.Code -eq 0 -and $status.Text -match 'done' -and $status.Text -match 'failed 72' -and $status.Text -match 'failed 7') 'status reports completed and failed workers'
  foreach ($conflict in @(@('-Status', 'dispatch'), @('-Status', '-Attach', 'last'), @('-Status', '-Cancel', 'last'), @('-Status', '-Attached'))) {
    Assert-True ((Invoke-TestRun $conflict).Code -eq 64) 'status rejects conflicting operation'
  }

  $dead = Start-TestRun 'SLEEP=30 EXIT=0 died' 'died'
  $status = Invoke-TestRun @('-Status')
  Assert-True ($status.Code -eq 0 -and $status.Text -match "$($dead.Run.Id).*running") 'status reports running SLEEP worker'
  # cmd keeps out.log open, so age it by threshold instead of mtime (supervisor 2026-10-12).
  $env:CODEX_DO_STALE_SECONDS = '2'
  Start-Sleep -Seconds 3
  $status = Invoke-TestRun @('-Status')
  Remove-Item Env:CODEX_DO_STALE_SECONDS
  Assert-True ($status.Text -match "$($dead.Run.Id).*STALE") 'status reports stale output'
  Stop-Process -Id $dead.Run.Meta.wrapperPid -Force -ErrorAction Stop
  Stop-Process -Id $dead.Record.pid -Force -ErrorAction Stop
  Assert-True ($dead.Process.WaitForExit(15000)) 'dead launcher observation completes'
  $status = Invoke-TestRun @('-Status')
  Assert-True ($status.Text -match "$($dead.Run.Id).*DIED" -and -not (Test-Path -LiteralPath (Join-Path $dead.Run.Folder 'exit.txt'))) 'status reports killed wrapper and worker without exit file'

  $active = Start-TestRun 'SLEEP=30 EXIT=0 OUTPUT=1' 'activity'
  $activityPath = Join-Path $active.Run.Folder 'activity.txt'
  Wait-Until { Test-Path -LiteralPath $activityPath } 'launcher records output growth'
  $activityBefore = [IO.File]::ReadAllText($activityPath)
  Wait-Until { [IO.File]::ReadAllText($activityPath) -ne $activityBefore } 'activity timestamp advances with output'
  $env:CODEX_DO_STALE_SECONDS = '2'
  $status = Invoke-TestRun @('-Status')
  Remove-Item Env:CODEX_DO_STALE_SECONDS
  Assert-True ($status.Text -match "$($active.Run.Id).*running") 'fresh activity prevents false STALE while cmd keeps log open'
  Assert-True (Test-Path -LiteralPath (Join-Path $active.Run.Folder 'activity.len')) 'launcher persists observed output length'
  Stop-Process -Id $active.Process.Id -Force
  $lengthBefore = [IO.File]::ReadAllText((Join-Path $active.Run.Folder 'activity.len'))
  Start-Sleep -Seconds 3
  $env:CODEX_DO_STALE_SECONDS = '2'
  $status = Invoke-TestRun @('-Status')
  Remove-Item Env:CODEX_DO_STALE_SECONDS
  Assert-True ($status.Text -match "$($active.Run.Id).*running" -and [IO.File]::ReadAllText((Join-Path $active.Run.Folder 'activity.len')) -ne $lengthBefore) 'Status detects new output without launcher or Attach observer'
  $activityBefore = [IO.File]::ReadAllText($activityPath)
  $lengthBefore = [IO.File]::ReadAllText((Join-Path $active.Run.Folder 'activity.len'))
  $attachProcess = Start-Process -FilePath powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Attach {1}' -f $dispatcher, $active.Run.Id) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'activity-attach.out')
  [void]$launchers.Add($attachProcess)
  Wait-Until { [IO.File]::ReadAllText($activityPath) -ne $activityBefore } 'Attach observer records subsequent output growth'
  Assert-True ([IO.File]::ReadAllText((Join-Path $active.Run.Folder 'activity.len')) -ne $lengthBefore) 'Attach persists observed output length'
  $cancelled = Invoke-TestRun @('-Cancel', $active.Run.Id)
  Assert-True ($cancelled.Code -eq 0 -and $attachProcess.WaitForExit(15000)) 'activity fixture is cancelled and observer finishes'

  $background = Start-TestRun 'SLEEP=8 EXIT=7 survival' 'survival'
  Assert-True ((Test-Path -LiteralPath (Join-Path $background.Run.Folder 'run.json')) -and
    -not (Test-Path -LiteralPath (Join-Path $background.Run.Folder 'exit.txt')) -and
    (Test-Alive $background.Record.pid) -and $background.Run.Meta.wrapperCreationDate) 'F3 run metadata and wrapper CreationDate exist while worker sleeps'
  $heartbeat = Join-Path $fixture "heartbeat-$($background.Record.pid).txt"
  Start-Sleep -Seconds 2
  Stop-Process -Id $background.Process.Id -Force -ErrorAction Stop
  $before = [IO.File]::ReadAllText($heartbeat)
  Wait-Until { [IO.File]::ReadAllText($heartbeat) -ne $before } 'R2 heartbeat survives dispatcher termination' 3
  Assert-True (Test-Alive $background.Record.pid) 'R2 detached worker survives killed dispatcher'
  $refused = Invoke-TestRun @('-Dir', $workDir, 'must not start')
  Assert-True ($refused.Code -eq 3 -and $refused.Text.Contains('REFUSED')) 'R4 live child lock refuses second dispatch'
  $attached = Invoke-TestRun @('-Attach', $background.Run.Id)
  Assert-True ($attached.Code -eq 7 -and $attached.Text.Contains('fake first line') -and $attached.Text.Contains('fake last line') -and $attached.Text.Contains("session: $uuid")) 'R5 attach replays tails and returns exit 7 and session'
  Assert-True ((Read-Record).pid -eq $background.Record.pid) 'R5 attach runs no codex'
  Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'dispatch-locks') -Filter '*.lock').Count -eq 0) 'R4 attach removes finished lock'
  $last = Invoke-TestRun @('-Attach', 'last')
  Assert-True ($last.Code -eq 7 -and $last.Text.Contains('fake last line')) 'R5 attach last selects newest run'
  $unfinishedFolder = Join-Path $env:CODEX_DO_STATE_DIR 'runs\20991231-235959-ffff'
  New-Item -ItemType Directory -Path $unfinishedFolder | Out-Null
  Write-TestFile (Join-Path $unfinishedFolder 'run.json') '{"wrapperPid":0}'
  $last = Invoke-TestRun @('-Attach', 'last')
  Assert-True ($last.Code -eq 7 -and $last.Text.Contains('fake last line')) 'Attach last skips unfinished metadata'
  $last = Invoke-TestRun @('-Cancel', 'last')
  Assert-True ($last.Code -eq 0) 'Cancel last skips unfinished metadata'
  $ledger = Get-Content -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'dispatch-ledger.log')
  Assert-True (@($ledger | Where-Object { $_ -like "*|end|$($background.Run.Meta.wrapperPid)|*" }).Count -eq 0) 'F10 attach writes no ledger end after launcher dies'

  $background = Start-TestRun 'SLEEP=30 EXIT=0 cancel SPAWN=1' 'cancel'
  $heartbeat = Join-Path $fixture "heartbeat-$($background.Record.pid).txt"
  Wait-Until {
    @(Get-ChildItem -LiteralPath $fixture -Filter 'pid-*.json' | Where-Object {
      ([IO.File]::ReadAllText($_.FullName) | ConvertFrom-Json).role -ceq 'descendant'
    }).Count -gt 0
  } 'R6 cancellation fixture has spawning descendants'
  $cancelled = Invoke-TestRun @('-Cancel', $background.Run.Id)
  Assert-True ($cancelled.Code -eq 0 -and $cancelled.Text.Contains([string]$background.Run.Meta.wrapperPid) -and $cancelled.Text.Contains([string]$background.Record.pid)) 'R6 cancel reports stopped PIDs'
  Wait-Until { -not (Test-Alive $background.Run.Meta.wrapperPid) -and -not (Test-Alive $background.Record.pid) } 'R6 cancelled processes gone'
  foreach ($file in Get-ChildItem -LiteralPath $fixture -Filter 'pid-*.json') {
    $descendant = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
    if ($descendant.role -ceq 'descendant') {
      Assert-True (-not (Test-Alive $descendant.pid)) "R6 descendant $($descendant.pid) stopped"
    }
  }
  $before = [IO.File]::ReadAllText($heartbeat)
  Start-Sleep -Milliseconds 1100
  Assert-True ([IO.File]::ReadAllText($heartbeat) -ceq $before) 'R6 heartbeat stops'
  Assert-True ([IO.File]::ReadAllText((Join-Path $background.Run.Folder 'exit.txt')).Trim() -ceq '130') 'R6 cancellation writes exit 130'
  $background.Process.WaitForExit()
  $cancelledAgain = Invoke-TestRun @('-Cancel', 'last')
  Assert-True ($cancelledAgain.Code -eq 0) 'R6 cancel last on completed run is harmless'
  $result = Invoke-TestRun @('-Dir', $workDir, 'after cancel')
  Assert-True ($result.Code -eq 0) 'R6 new dispatch accepted after cancellation'

  $orphan = Start-TestRun 'SLEEP=30 EXIT=0 orphan SPAWN=1' 'orphan'
  $treePath = Join-Path $orphan.Run.Folder 'tree.json'
  Wait-Until {
    (Test-Path -LiteralPath $treePath) -and
      @(([IO.File]::ReadAllText($treePath) | ConvertFrom-Json | ForEach-Object { $_ }) | Where-Object { $_.pid -eq $orphan.Record.pid -and $_.created }).Count -eq 1 -and
      @([IO.File]::ReadAllText($treePath) | ConvertFrom-Json | ForEach-Object { $_ }).Count -ge 3
  } 'G1 tree records fake before wrapper termination'
  $lockFile = Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'dispatch-locks') -Filter '*.lock' | Select-Object -First 1
  $lock = [IO.File]::ReadAllText($lockFile.FullName) | ConvertFrom-Json
  Assert-True ($lock.pid -eq $orphan.Process.Id -and
    [Math]::Abs((([datetime]$lock.pidStarted).ToUniversalTime() - $orphan.Process.StartTime.ToUniversalTime()).TotalSeconds) -lt 1 -and
    $lock.childPid -eq $orphan.Run.Meta.wrapperPid -and $lock.childStarted -eq $orphan.Run.Meta.wrapperCreationDate) 'G2 G6 lock stores actual dispatcher and wrapper start times'
  Stop-Process -Id $orphan.Run.Meta.wrapperPid -Force -ErrorAction Stop
  Assert-True ($orphan.Process.WaitForExit(15000)) 'G4 launcher finishes after wrapper loss'
  $orphan.Process.Refresh()
  $orphanOutput = [IO.File]::ReadAllText((Join-Path $fixture 'orphan.out'))
  Assert-True ($orphan.Process.ExitCode -eq 71 -and (Test-Path -LiteralPath $lockFile.FullName) -and
    (Test-Alive $orphan.Record.pid) -and $orphanOutput.Contains('worker still running without its wrapper; run: codex-do.ps1 -Cancel')) 'G4 G6 exit 71 retains orphan lock and prints cancellation instruction'
  $attachedOrphan = Invoke-TestRun @('-Attach', $orphan.Run.Id)
  Assert-True ($attachedOrphan.Code -eq 71 -and (Test-Path -LiteralPath $lockFile.FullName)) 'G4 attach also retains orphan lock'

  # Supervisor 2026-10-10: one worker per Dir. While A's orphan lives, B is REFUSED with the
  # reconnect/cancel hint, even though both of A's lock owners exited.
  $blocked = Invoke-TestRun @('-Dir', $workDir, 'SLEEP=1 EXIT=0 blocked')
  Assert-True ($blocked.Code -eq 3 -and $blocked.Text.Contains("-Cancel $($orphan.Run.Id)")) 'G4 live orphan refuses a new dispatch with cancel hint'
  $orphanHeartbeat = Join-Path $fixture "heartbeat-$($orphan.Record.pid).txt"
  $cancelled = Invoke-TestRun @('-Cancel', $orphan.Run.Id)
  Assert-True ($cancelled.Code -eq 0 -and -not (Test-Alive $orphan.Record.pid) -and
    [IO.File]::ReadAllText((Join-Path $orphan.Run.Folder 'exit.txt')).Trim() -ceq '130') 'G1 G6 dead-wrapper cancel stops recorded fake and writes 130'
  foreach ($file in Get-ChildItem -LiteralPath $fixture -Filter 'pid-*.json') {
    $descendant = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
    if ($descendant.role -ceq 'descendant') {
      Assert-True (-not (Test-Alive $descendant.pid)) "G1 orphan descendant $($descendant.pid) stopped"
    }
  }
  $orphanBeat = [IO.File]::ReadAllText($orphanHeartbeat)

  # After the cancel, the finished run never blocks; B starts. A second -Cancel of A must not touch B.
  $newer = Start-TestRun 'SLEEP=8 EXIT=0 newer' 'newer'
  $newerHeartbeat = Join-Path $fixture "heartbeat-$($newer.Record.pid).txt"
  $again = Invoke-TestRun @('-Cancel', $orphan.Run.Id)
  Assert-True ($again.Code -eq 0) 'G6 re-cancelling the finished old run is harmless'
  $newerBeat = [IO.File]::ReadAllText($newerHeartbeat)
  Wait-Until { [IO.File]::ReadAllText($newerHeartbeat) -ne $newerBeat } 'G6 newer worker heartbeat continues after cancelling old run' 3
  Start-Sleep -Milliseconds 600
  Assert-True ([IO.File]::ReadAllText($orphanHeartbeat) -ceq $orphanBeat -and (Test-Alive $newer.Record.pid)) 'G6 old heartbeat stops and newer worker stays alive'
  $newLock = Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'dispatch-locks') -Filter '*.lock' | Select-Object -First 1
  Assert-True ($null -ne $newLock -and (([IO.File]::ReadAllText($newLock.FullName) | ConvertFrom-Json).runId -ceq $newer.Run.Id)) 'G6 cancelling old run preserves newer lock'
  Assert-True ($newer.Process.WaitForExit(15000)) 'G6 newer worker finishes normally'
  $newer.Process.Refresh()
  Assert-True ($newer.Process.ExitCode -eq 0 -and [IO.File]::ReadAllText((Join-Path $newer.Run.Folder 'exit.txt')).Trim() -ceq '0') 'G6 newer run exits 0 after old run cancellation'
  $pinned = Invoke-TestRun @('-Attach', $orphan.Run.Id)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $orphan.Run.Folder 'session.txt')) -or $pinned.Text.Contains('session:')) 'session pin read path works'
  $result = Invoke-TestRun @('-Attached', '-Dir', $workDir, 'attached inline')
  Assert-True ($result.Code -eq 0 -and (Read-Record).stdin -ceq (New-SelftestPacket 'attached inline').Trim()) 'R1 Attached preserves packet prompt'
  Assert-Disabled (Read-Record) $false 'R7 Attached defaults to no disable flags'
  $result = Invoke-TestRun @('-Attached', '-NoSubAgents', '-Dir', $workDir, 'attached restricted')
  Assert-True ($result.Code -eq 0) 'R7 Attached NoSubAgents run succeeds'
  Assert-Disabled (Read-Record) $true 'R7 Attached NoSubAgents disables both features'
  $result = Invoke-TestRun @('-Dir', $workDir, '-Resume', $uuid, '-SpecFile', $spec)
  $record = Read-Record
  Assert-True ($result.Code -eq 0 -and $record.args[0] -ceq 'exec' -and $record.args[1] -ceq 'resume' -and $record.args[-2] -ceq $uuid -and $record.args[-1] -ceq '-' -and $record.stdinHex -ceq $expectedHex -and $record.cwd -ceq $workDir) 'R2 R7 detached resume UUID dash stdin and cwd'
  Assert-Disabled $record $true 'R7 detached resume disables both features'
  $result = Invoke-TestRun @('-Dir', $workDir, '-Resume', $uuid, '-AllowSubAgents', 'resume allowed')
  Assert-True ($result.Code -eq 0) 'R7 resume AllowSubAgents run succeeds'
  Assert-Disabled (Read-Record) $false 'R7 resume AllowSubAgents omits disable flags'
  foreach ($arguments in @(
    @('-Attach', 'last', 'invalid prompt'),
    @('-Cancel', 'last', 'invalid prompt'),
    @('-Attach', 'last', '-SpecFile', $spec),
    @('-Cancel', 'last', '-Resume', $uuid),
    @('-Attach', 'last', '-Cancel', 'last')
  )) {
    $result = Invoke-TestRun $arguments
    Assert-True ($result.Code -eq 64) "R8 usage conflict: $($arguments -join ' ')"
  }
  # A synthetic dead wrapper exercises the three-second missing-exit grace without WMI.
  $deadId = '20000101-000000-dead'
  $deadFolder = Join-Path $env:CODEX_DO_STATE_DIR "runs\$deadId"
  New-Item -ItemType Directory -Path $deadFolder | Out-Null
  Write-TestFile (Join-Path $deadFolder 'run.json') (([ordered]@{ runId = $deadId; dir = $workDir; model = 'fake'; effort = 'high'; account = 'main'; resume = ''; startedUtc = [DateTime]::UtcNow.ToString('o'); wrapperPid = 2147483647 }) | ConvertTo-Json)
  Write-TestFile (Join-Path $deadFolder 'out.log') "partial output`n"
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $result = Invoke-TestRun @('-Attach', $deadId)
  Assert-True ($result.Code -eq 71 -and $timer.Elapsed.TotalSeconds -ge 3 -and $result.Text.Contains('exit.txt') -and $result.Text.Contains('partial output')) 'R3 missing exit waits grace then exits 71'
  $beforeRuns = @(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory).Count
  $result = Invoke-TestRun @('-Dir', (Join-Path $fixture 'nonexistent-working-directory'), 'launch failure')
  Assert-True ($result.Code -eq 70 -and $result.Text.Contains('Win32_Process.Create failed')) 'R2 failed WMI launch exits 70'
  Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory).Count -eq $beforeRuns -and @(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'dispatch-locks') -Filter '*.lock').Count -eq 0) 'R2 failed launch cleans run folder and lock'
  $recordBefore = [IO.File]::ReadAllText((Join-Path $fixture 'record.json'))
  $result = Invoke-TestRun @('-Dir', (Join-Path $fixture 'percent%dir'), 'must not launch')
  Assert-True ($result.Code -eq 64 -and $result.Text.Contains('-Dir') -and $result.Text.Contains('%') -and
    [IO.File]::ReadAllText((Join-Path $fixture 'record.json')) -ceq $recordBefore -and
    @(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory).Count -eq $beforeRuns) 'F7 percent Dir rejected before launch'
  $normalizedDir = [IO.Path]::GetFullPath($workDir).TrimEnd([char[]]@('\', '/')).ToLowerInvariant()
  $sha1 = [Security.Cryptography.SHA1]::Create()
  try { $hash = -join ($sha1.ComputeHash($utf8.GetBytes($normalizedDir)) | ForEach-Object { $_.ToString('x2') }) }
  finally { $sha1.Dispose() }
  $lockPath = Join-Path $env:CODEX_DO_STATE_DIR ('dispatch-locks\' + $hash.Substring(0, 16) + '.lock')
  Write-TestFile $lockPath ''
  $result = Invoke-TestRun @('-Dir', $workDir, 'fresh empty lock')
  Assert-True ($result.Code -eq 3 -and $result.Text.Contains('REFUSED') -and
    [IO.File]::ReadAllText((Join-Path $fixture 'record.json')) -ceq $recordBefore) 'F5 fresh empty lock refused without launch'
  [IO.File]::SetLastWriteTimeUtc($lockPath, [DateTime]::UtcNow.AddMinutes(-2))
  $result = Invoke-TestRun @('-Dir', $workDir, 'old empty lock')
  Assert-True ($result.Code -eq 0 -and (Read-Record).stdin -ceq (New-SelftestPacket 'old empty lock') -and
    -not (Test-Path -LiteralPath $lockPath)) 'F5 two-minute-old empty lock reclaimed'
  foreach ($file in @($dispatcher, $PSCommandPath, (Join-Path $PSScriptRoot 'codex-do-resume-selftest.ps1'))) {
    $bytes = [IO.File]::ReadAllBytes($file)
    Assert-True (-not ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) -and -not $utf8.GetString($bytes).Contains("`r")) "R10 UTF-8 no BOM and LF: $(Split-Path -Leaf $file)"
  }
  foreach ($folder in Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory) {
    $finishedPath = Join-Path $folder.FullName 'exit.txt'
    if (-not (Test-Path -LiteralPath $finishedPath)) { continue }
    $finishedCode = [IO.File]::ReadAllText($finishedPath).Trim()
    if ($finishedCode -eq '130') { continue } # Cancellation stops the wrapper before notification.
    $finishedRun = [IO.File]::ReadAllText((Join-Path $folder.FullName 'run.json')) | ConvertFrom-Json
    Wait-Until { @(Get-Content -LiteralPath $notifyLog | Where-Object { $_ -like "*|$($finishedRun.runId)|*|$finishedCode" }).Count -eq 1 } 'each finished detached run logs exactly one notice'
    Wait-Until { -not (Test-Alive $finishedRun.wrapperPid) } 'notification wrapper finishes' 30
  }
  Write-Host 'SELFTEST COMPLETE'
} finally {
  # All cancellation and cleanup target exact fixture-owned PIDs, never process names.
  try {
    $runs = Join-Path $fixture 'state\runs'
    if (-not $LocalOnly -and (Test-Path -LiteralPath $runs)) {
      foreach ($folder in Get-ChildItem -LiteralPath $runs -Directory) {
        if (Test-Path -LiteralPath (Join-Path $folder.FullName 'run.json')) {
          $null = Invoke-TestRun @('-Cancel', $folder.Name)
        }
      }
    }
    foreach ($process in $launchers) {
      if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
      $process.Dispose()
    }
    foreach ($file in @(Get-ChildItem -LiteralPath $fixture -Filter 'pid-*.json' -ErrorAction SilentlyContinue | Where-Object { -not $LocalOnly })) {
      $record = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
      $candidate = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($record.pid)" -ErrorAction SilentlyContinue
      if ($candidate -and $candidate.CommandLine -and $candidate.CommandLine.IndexOf((Join-Path $fixture 'fake-codex.js'), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $record.pid -Force -ErrorAction SilentlyContinue
      }
    }
  } finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $resolved = [IO.Path]::GetFullPath($fixture)
    if ((Split-Path -Parent $resolved) -ne $tempRoot -or (Split-Path -Leaf $resolved) -notlike 'codex-do-detach-fixture-*') { throw 'SELFTEST FAIL: unsafe fixture cleanup path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  }
}
