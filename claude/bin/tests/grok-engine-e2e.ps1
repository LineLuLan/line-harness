<# Host only: powershell -NoProfile -ExecutionPolicy Bypass -File claude/bin/tests/grok-engine-e2e.ps1
   Uses WMI and a fake CLI; no Grok account, network, or model calls. #>
# Intent: exercise the actual durable wrapper for Line. Status: supervisor host check. Next: run outside sandbox. Blockers: WMI. Confidence: asserts real artifacts and original working-tree state.
$ErrorActionPreference = 'Stop'
$bin = Split-Path -Parent $PSScriptRoot
$source = Split-Path -Parent (Split-Path -Parent $bin)
. (Join-Path $bin 'grok-engine-lib.ps1')
. (Join-Path $PSScriptRoot 'fixtures/dispatch-packet.ps1')
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$fixture = Join-Path $tempRoot ('grok-engine-e2e-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$saved = @{}; $launchers = @(); $passed = 0; $failed = 0
$saved['USERPROFILE_STATE'] = Join-Path $env:USERPROFILE '.claude\state'
foreach ($name in @('CODEX_DO_ENGINE','CODEX_DO_USAGE_CACHE_DIR','ULTRATHINK_ONTOLOGY','CODEX_ACC_ROOT','CODEX_ACC_MAIN_HOME','CODEX_DO_STATE_DIR','GROK_DO_BIN','CODEX_DO_NOTIFY','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Assert-Host($Condition, [string]$Name) {
  if (-not $Condition) { throw "FAIL: $Name" }
  $script:passed++; Write-Host "PASS: $Name"
}
# The launcher still holds its redirected output open; read it with sharing.
function Read-HostShared([string]$Path) {
  $stream = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try { return (New-Object IO.StreamReader($stream)).ReadToEnd() } finally { $stream.Dispose() }
}
function Write-HostFixture([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $utf8) }
function Wait-HostCondition([scriptblock]$Condition, [string]$Name) {
  $deadline = [datetime]::UtcNow.AddSeconds(60)
  while ($true) {
    try { if (& $Condition) { return } } catch {}
    if ([datetime]::UtcNow -gt $deadline) { throw "FAIL: timed out waiting for $Name" }
    Start-Sleep -Milliseconds 100
  }
}
function Invoke-HostDispatcher([string[]]$Arguments) {
  $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bin 'codex-do.ps1') @Arguments 2>&1)
  return [pscustomobject]@{ Code=$LASTEXITCODE; Text=($output -join "`n") }
}
try {
  $env:GIT_CONFIG_COUNT='1'; $env:GIT_CONFIG_KEY_0='safe.directory'; $env:GIT_CONFIG_VALUE_0='*'
  $env:CODEX_DO_STATE_DIR = Join-Path $fixture 'state space'
  $env:GROK_DO_BIN = Join-Path $PSScriptRoot 'fixtures/fake-grok.cmd'
  $env:CODEX_DO_NOTIFY = '0'
  New-Item -ItemType Directory -Path $fixture | Out-Null
  # Intent: K5e U1 - the 'auto' scenario runs without -Engine: no CODEX_DO_ENGINE, a temp hot cache for the temp main account, the repo ontology. Status: K5e touch-up. Next: none. Blockers: none. Confidence: run.json engine and engineSource.
  Remove-Item Env:CODEX_DO_ENGINE -ErrorAction SilentlyContinue
  $env:CODEX_ACC_ROOT = Join-Path $fixture 'accounts'
  $env:CODEX_ACC_MAIN_HOME = Join-Path $fixture 'codex-main'
  $env:CODEX_DO_USAGE_CACHE_DIR = Join-Path $fixture 'usage-cache'
  $env:ULTRATHINK_ONTOLOGY = Join-Path $source 'claude\ontology\harness.ontology.json'
  New-Item -ItemType Directory -Path $env:CODEX_ACC_ROOT, $env:CODEX_ACC_MAIN_HOME, $env:CODEX_DO_USAGE_CACHE_DIR | Out-Null
  Write-HostFixture (Join-Path $env:CODEX_DO_USAGE_CACHE_DIR 'codex-usage.json') ('{"weekly":{"left":4,"usedPercent":96,"resetsAt":' + [DateTimeOffset]::UtcNow.AddDays(2).ToUnixTimeSeconds() + '}}')
  $repo = Join-Path $fixture 'original repo'
  [void](Invoke-GrokGit -Dir $source -Arguments @('clone','--shared','--quiet','--', $source, $repo))
  [void](Invoke-GrokGit -Dir $repo -Arguments @('config','core.autocrlf','false'))
  $tracked = Join-Path $repo 'README.md'
  $baseText = [IO.File]::ReadAllText($tracked).Replace("`r`n", "`n") + "`nLine's earlier change`n"
  Write-HostFixture (Join-Path $repo 'notes with space.txt') 'earlier notes'
  # Intent: K6a G10 - the real runs folder must not change. Status: K6a. Next: none. Blockers: none. Confidence: count at the end.
  $realRuns = Join-Path $saved['USERPROFILE_STATE'] 'runs'
  $realRunCount = @(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue).Count
  # V8: also the newest folder names, so a test run that replaced a real one is caught.
  $realRunNewest = (@(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ',')
  $thorough = Get-GrokRuleText
  $sessions = @{}; $worktrees = @{}; $runIds = @{}
  # K6a scenarios: resume (auto -Resume last continues the 'auto' run's grok session), readonly (-Sandbox read-only -OutFile), attached (-Attached -Account main).
  # V2: resume-kept resumes the conflict run's session by UUID: its kept worktree is moved aside, then the resume proceeds.
  foreach ($scenario in @('applied','conflict','cancel','observer-gone','auto','resume','readonly','attached','resume-kept')) {
    Write-HostFixture $tracked $baseText
    if (Test-Path -LiteralPath (Join-Path $repo 'a.txt')) { [IO.File]::Delete((Join-Path $repo 'a.txt')) }
    $spec = Join-Path $fixture "$scenario.txt"
    Write-HostFixture $spec (New-SelftestPacket 'Offline Grok fixture: edit README.md and create a.txt.')
    $known = @(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    $roAnswer = Join-Path $fixture 'ro answer.txt'
    $extra = switch ($scenario) {
      'auto' { '' }
      'resume' { '-Resume last ' }
      'resume-kept' { '-Resume ' + $sessions['conflict'] + ' ' }
      'readonly' { '-Engine grok -Sandbox read-only -OutFile "' + $roAnswer + '" ' }
      'attached' { '-Engine grok -Attached -Account main ' }
      default { '-Engine grok ' }
    }
    $argsText = '-NoProfile -ExecutionPolicy Bypass -File "{0}" {3}-NoRamCheck -Dir "{1}" -SpecFile "{2}"' -f (Join-Path $bin 'codex-do.ps1'), $repo, $spec, $extra
    $process = Start-Process -FilePath powershell -ArgumentList $argsText -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture "$scenario.out") -RedirectStandardError (Join-Path $fixture "$scenario.err")
    $null = $process.Handle; $launchers += $process
    $script:folder = $null
    Wait-HostCondition {
      $script:folder = Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin $known -and (Test-Path -LiteralPath (Join-Path $_.FullName 'fake-started.json')) } | Select-Object -First 1
      $null -ne $script:folder -and ([IO.File]::ReadAllText((Join-Path $script:folder.FullName 'run.json')) | ConvertFrom-Json).wrapperPid -gt 0
    } "$scenario fake startup"
    $runFolder = $folder.FullName
    $meta = [IO.File]::ReadAllText((Join-Path $runFolder 'run.json')) | ConvertFrom-Json
    $record = [IO.File]::ReadAllText((Join-Path $runFolder 'fake-started.json')) | ConvertFrom-Json
    Assert-Host ($meta.engine -eq 'grok' -and $meta.dir -eq $repo -and $meta.model -eq 'grok-4.7-build-fast' -and $meta.effort -eq 'xhigh') "$scenario engine, defaults (xhigh) and original Dir"
    $expectedSource = if (@('auto','resume','resume-kept') -contains $scenario) { 'auto' } else { 'flag' }
    Assert-Host ($meta.engine -eq 'grok' -and $meta.engineSource -eq $expectedSource) "$scenario run.json engine grok, engineSource $expectedSource"
    $expectedMode = if ($scenario -eq 'readonly') { 'read-only' } else { 'grok-workspace' }
    Assert-Host ($meta.sandboxMode -eq $expectedMode -and $meta.account -eq '' -and $meta.accountHome -eq '') "$scenario no Codex account; sandboxMode $expectedMode"
    # Intent: K6a criterion 6 / G6 - the argv fake-grok received and run.cmd both carry the K6a flags and the rule text intact (semicolons, commas, colons). Status: K6a. Next: none. Blockers: none. Confidence: raw %* echo.
    $argv = [IO.File]::ReadAllText((Join-Path $runFolder 'fake-argv.txt'))
    $runCmd = [IO.File]::ReadAllText((Join-Path $runFolder 'run.cmd'))
    $rulesText = if ($scenario -eq 'readonly') { Get-GrokRuleText -ReadOnly } else { $thorough }
    Assert-Host ($argv.Contains('"--effort" "xhigh"') -and $argv.Contains('"--no-subagents"') -and $argv.Contains('"--max-turns" "300"') -and $argv.Contains('"--no-plan"') -and $argv.Contains('"--disable-web-search"') -and $argv.Contains('"--rules" "' + $rulesText + '"') -and $runCmd.Contains('"--rules" "' + $rulesText + '"') -and $rulesText.Contains(';') -and $rulesText.Contains(':') -and ($scenario -eq 'readonly' -or $rulesText.Contains(','))) "$scenario argv and run.cmd carry xhigh, --no-subagents, --max-turns 300 and the intact --rules text"
    if ($scenario -eq 'readonly') { Assert-Host ($argv.Contains('"--sandbox" "read-only"') -and $argv.Contains('"--tools" "read_file,grep,list_dir"') -and $argv.Contains('"--disallowed-tools" "run_terminal_cmd,search_replace,write,Agent,use_tool,search_tool"')) 'readonly argv: --sandbox read-only, read/search tools only' }
    else { Assert-Host ($argv.Contains('"--sandbox" "workspace"') -and $argv.Contains('"--disallowed-tools" "Agent,use_tool,search_tool"') -and -not $argv.Contains('"--tools"')) "$scenario argv: --sandbox workspace" }
    Assert-Host ($argv.Contains('"--deny" "MCPTool(*)"') -and $runCmd.Contains('set "GROK_CLAUDE_MCPS_ENABLED=false"') -and $runCmd.Contains('set "GROK_CURSOR_MCPS_ENABLED=false"')) "$scenario blocks MCP tools: --deny MCPTool(*) in argv, MCP scan env off in run.cmd"
    Assert-Host ($record.sessionId -match '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') "$scenario fake session id is UUID-shaped"
    if ($scenario -eq 'resume') {
      Assert-Host ($argv.StartsWith('"--prompt-file"') -and $argv.Contains('"--resume" "' + $sessions['auto'] + '"') -and $record.resume -eq $sessions['auto'] -and $record.sessionId -eq $sessions['auto'] -and $meta.resume -eq $sessions['auto'] -and -not $argv.Contains('--fork-session') -and -not $argv.Contains('--restore-code')) 'resume: grok --resume <auto session id>, no --fork-session or --restore-code'
      Assert-Host ($meta.worktreeDir -eq $worktrees['auto'] -and $record.cwd -eq $worktrees['auto'] -and $record.prompt.Contains('The working directory has been reset to a fresh snapshot of the original repository; edits from earlier runs that were not applied are gone - re-check the files before editing.')) 'resume: fresh snapshot at the prior run''s worktree path; V6 preamble'
      Wait-HostCondition { (Read-HostShared (Join-Path $fixture 'resume.out')).Contains('codex-do: engine grok') } 'resume engine line'
      Assert-Host ((Read-HostShared (Join-Path $fixture 'resume.out')).Contains("codex-do: engine grok (auto: -Resume continues grok session $($sessions['auto']) from run $($runIds['auto']) ")) 'resume: auto picks grok because the session is grok''s; V5 line names the owner run'
    } elseif ($scenario -eq 'resume-kept') {
      Wait-HostCondition { (Read-HostShared (Join-Path $fixture 'resume-kept.out')).Contains('codex-do: kept worktree of grok run') } 'resume-kept line'
      $keptOut = Read-HostShared (Join-Path $fixture 'resume-kept.out')
      $keptMatch = [regex]::Match($keptOut, 'codex-do: kept worktree of grok run ' + [regex]::Escape($runIds['conflict']) + ' moved to (.+-kept-\d{8}-\d{6})')
      Assert-Host ($argv.Contains('"--resume" "' + $sessions['conflict'] + '"') -and $meta.worktreeDir -eq $worktrees['conflict'] -and $keptMatch.Success -and (Test-Path -LiteralPath $keptMatch.Groups[1].Value) -and [IO.File]::ReadAllText((Join-Path $keptMatch.Groups[1].Value 'a.txt')) -ceq 'fake new file') "resume-kept: the finished exit-77 run's kept worktree was moved aside (bytes kept) and the resume runs at its path"
    } else { Assert-Host (-not $argv.Contains('"--resume"')) "$scenario argv has no --resume" }
    $sessions[$scenario] = $record.sessionId; $worktrees[$scenario] = $meta.worktreeDir; $runIds[$scenario] = $meta.runId
    Assert-Host ($meta.manifest -and (Test-Path -LiteralPath $meta.manifest) -and $null -eq $meta.PSObject.Properties['baselineTree']) "$scenario run.json records the manifest, no baselineTree"
    Assert-Host ($meta.specSha256 -eq (Get-FileHash -LiteralPath $spec -Algorithm SHA256).Hash.ToLowerInvariant()) "$scenario ledger spec hash preserved"
    Assert-Host ($record.cwd -eq $meta.worktreeDir -and $record.tracked -ceq $baseText -and $record.notes -ceq 'earlier notes') "$scenario isolated cwd contains dirty state"
    Assert-Host ($record.prompt.StartsWith("You are a worker in Line's harness.") -and $record.prompt.Contains('STOP BEFORE EDITING')) "$scenario guard preamble"
    Assert-Host ([IO.File]::ReadAllText($tracked) -ceq $baseText -and -not (Test-Path -LiteralPath (Join-Path $repo 'a.txt'))) "$scenario original unchanged during run"
    $busy = Invoke-HostDispatcher @('-Engine','grok','-NoRamCheck','-Dir',$repo,'-SpecFile',$spec)
    Assert-Host ($busy.Code -eq 3) "$scenario original Dir lock refuses overlap"
    if ($scenario -eq 'cancel') {
      $cancelled = Invoke-HostDispatcher @('-Cancel',$meta.runId)
      Assert-Host ($cancelled.Code -eq 0 -and $cancelled.Text.Contains($meta.worktreeDir)) 'cancel reports preserved worktree'
      Assert-Host ((Test-Path -LiteralPath $meta.worktreeDir) -and -not (Test-Path -LiteralPath (Join-Path $runFolder 'apply.json')) -and [IO.File]::ReadAllText((Join-Path $runFolder 'exit.txt')).Trim() -eq '130') 'cancel never applies and publishes 130'
    } else {
      if ($scenario -eq 'conflict') { Write-HostFixture $tracked "concurrent edit`n" }
      if ($scenario -eq 'observer-gone') { $process.Kill(); $process.WaitForExit() }
      Write-HostFixture (Join-Path $runFolder 'fake-release') 'go'
      Wait-HostCondition { Test-Path -LiteralPath (Join-Path $runFolder 'exit.txt') } "$scenario durable completion"
      $expected = if ($scenario -eq 'conflict') { 77 } else { 0 }
      Assert-Host ([IO.File]::ReadAllText((Join-Path $runFolder 'exit.txt')).Trim() -eq [string]$expected) "$scenario final exit $expected"
      $marker = [IO.File]::ReadAllText((Join-Path $runFolder 'apply.json'))
      $applied = $marker | ConvertFrom-Json
      if ($scenario -eq 'readonly') {
        Assert-Host ($applied.status -eq 'read-only' -and ((@($applied.changedPaths) | Sort-Object) -join '|') -eq 'a.txt|README.md' -and -not (Test-Path -LiteralPath $meta.worktreeDir) -and [IO.File]::ReadAllText($tracked) -ceq $baseText -and -not (Test-Path -LiteralPath (Join-Path $repo 'a.txt')) -and -not (Test-Path -LiteralPath (Join-Path $runFolder 'undo'))) 'readonly: nothing applied, changed paths recorded, worktree removed, no undo bundle'
        Assert-Host ([IO.File]::ReadAllText($roAnswer) -ceq 'fake answer') 'readonly: -OutFile holds the final answer from out.log'
      } elseif ($scenario -eq 'conflict') {
        Assert-Host ($applied.status -eq 'conflict' -and (Test-Path -LiteralPath $meta.worktreeDir) -and [IO.File]::ReadAllText($tracked) -ceq "concurrent edit`n") 'conflict keeps both versions'
      } else {
        Assert-Host ($applied.status -eq 'applied' -and -not (Test-Path -LiteralPath $meta.worktreeDir) -and [IO.File]::ReadAllText($tracked) -ceq ($baseText + "fake edit`n") -and [IO.File]::ReadAllText((Join-Path $repo 'a.txt')) -ceq 'fake new file') "$scenario wrapper brought back edits"
      }
      Wait-HostCondition { [IO.File]::ReadAllText((Join-Path $runFolder 'session.txt')) -eq $record.sessionId } "$scenario completion telemetry"
      $attached = Invoke-HostDispatcher @('-Attach',$meta.runId)
      Assert-Host ($attached.Code -eq $expected -and $attached.Text.Contains($(if ($scenario -eq 'readonly') { 'grok read-only: nothing applied (warning: 2 changed path(s) discarded)' } else { 'grok patch:' })) -and [IO.File]::ReadAllText((Join-Path $runFolder 'apply.json')) -ceq $marker) "$scenario attach replays without reapplying"
      $status = Invoke-HostDispatcher @('-Status')
      $expectedState = if ($expected) { 'failed 77' } else { 'done' }
      Assert-Host ($status.Code -eq 0 -and $status.Text.Contains($expectedState)) "$scenario status"
      Wait-HostCondition { [IO.File]::ReadAllText((Join-Path $env:CODEX_DO_STATE_DIR 'runs/notify.log')).Contains("|$($meta.runId)|") } "$scenario notification"
      # Intent: K5d undo round trip through the real dispatcher. Status: criterion 9. Next: none. Blockers: none. Confidence: exact text.
      if ($scenario -eq 'applied') {
        Assert-Host ($attached.Text.Contains("undo: codex-do.ps1 -Undo $($meta.runId)")) 'applied result prints the undo command'
        $undone = Invoke-HostDispatcher @('-Undo', $meta.runId)
        Assert-Host ($undone.Code -eq 0 -and $undone.Text.Contains("undo $($meta.runId) in $repo") -and [IO.File]::ReadAllText($tracked) -ceq $baseText -and -not (Test-Path -LiteralPath (Join-Path $repo 'a.txt'))) 'applied -Undo restores README.md and removes a.txt'
        $again = Invoke-HostDispatcher @('-Undo', 'last', '-Dir', $repo)
        Assert-Host ($again.Code -eq 2 -and [IO.File]::ReadAllText($tracked) -ceq $baseText) 'second -Undo last finds no applied run'
        $repeat = Invoke-HostDispatcher @('-Undo', $meta.runId)
        Assert-Host ($repeat.Code -eq 0 -and $repeat.Text.Contains('already undone')) '-Undo by run id is already undone'
      }
    }
    if (-not $process.HasExited) { Assert-Host ($process.WaitForExit(15000)) "$scenario observer ended" }
    Wait-HostCondition { $null -eq (Get-Process -Id $meta.wrapperPid -ErrorAction SilentlyContinue) } "$scenario wrapper ended"
    if ($scenario -eq 'attached') {
      $attachedOut = [IO.File]::ReadAllText((Join-Path $fixture 'attached.out'))
      Assert-Host ($process.ExitCode -eq 0 -and [IO.File]::ReadAllText((Join-Path $runFolder 'exit.txt')).Trim() -eq '0' -and $attachedOut.Contains('codex-do: -Attached is the default on grok (detached + wait)') -and $attachedOut.Contains('codex-do: -Account ignored on grok') -and $attachedOut.Contains('grok patch: applied')) "attached: -Attached waits like -Attach and returns the run exit code ($($process.ExitCode)); -Account ignored with one line"
    }
    if ($scenario -eq 'auto') { Assert-Host ([IO.File]::ReadAllText((Join-Path $fixture 'auto.out')).Contains('codex-do: engine grok (auto: Codex weekly 96% used)')) 'auto observer printed the engine line' }
  }
} catch { $failed++; Write-Host $_.Exception.Message }
finally {
  # Stop launchers first; discover even runs that failed before fake-started.json was published.
  foreach ($process in $launchers) {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
  }
  foreach ($folder in @(Get-ChildItem -LiteralPath (Join-Path $env:CODEX_DO_STATE_DIR 'runs') -Directory -ErrorAction SilentlyContinue)) {
    $metaPath = Join-Path $folder.FullName 'run.json'
    if (Test-Path -LiteralPath $metaPath) {
      $meta = [IO.File]::ReadAllText($metaPath) | ConvertFrom-Json
      if ($meta.wrapperPid -gt 0) {
        $cleanup = Invoke-HostDispatcher @('-Cancel',$meta.runId)
        if ($cleanup.Code -ne 0) { $failed++; Write-Host "FAIL: cleanup $($meta.runId): $($cleanup.Text)" }
      }
    }
  }
  try { if ($null -ne $realRunCount) { Assert-Host (@(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue).Count -eq $realRunCount -and (@(Get-ChildItem -LiteralPath $realRuns -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ',') -ceq $realRunNewest) 'K6a G10/V8: the real ~/.claude/state/runs folder count and newest folder names are unchanged' } } catch { $failed++; Write-Host $_.Exception.Message }
  foreach ($name in $saved.Keys) { if ($name -ne 'USERPROFILE_STATE') { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') } }
  $resolved = [IO.Path]::GetFullPath($fixture)
  if ((Split-Path -Parent $resolved) -ne $tempRoot -or (Split-Path -Leaf $resolved) -notlike 'grok-engine-e2e-*') { throw 'unsafe host fixture cleanup path' }
  if ($failed) { Write-Host "Host evidence retained: $resolved" }
  elseif (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Host "PASS: $passed FAIL: $failed"
if ($failed) { exit 1 }
