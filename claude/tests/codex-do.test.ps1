. (Join-Path $PSScriptRoot 'test-lib.ps1')
. (Join-Path $PSScriptRoot '..\bin\packet-lint.ps1')
. (Import-TestFunctions (Join-Path $PSScriptRoot '..\bin\codex-do.ps1'))
$text = 'GOAL: invalid packet'
Assert-True ((Get-DispatchPacket -Text $text).ExitCode -eq 74) 'new dispatch rejects invalid packet'
foreach ($mode in @('Status','Attach','Cancel','Resume')) {
  $params = @{ Text=$text }; $params[$mode] = $true
  Assert-True ((Get-DispatchPacket @params).ExitCode -eq 0) "$mode skips lint"
}
$packet = "GOAL: x`nSUCCESS CRITERIA: x`nFILES: a.ps1`nCONSTRAINTS: local`nDONE WHEN: done`nVALIDATE: git diff`nSTOP RULES: stop`nDOCS CHECKED: n/a`nPACKET CHECK: ok"
$result = Get-DispatchPacket -Text $packet
Assert-True ($result.ExitCode -eq 0 -and $result.Text.EndsWith('CONSTRAINTS: Do not spawn sub-agents.')) 'policy appended to outgoing prompt'
Assert-True ($packet -notmatch 'Do not spawn') 'input remains unchanged'
$already = $packet + "`nCONSTRAINTS: DO NOT SPAWN SUB-AGENTS."
Assert-True ((Get-DispatchPacket -Text $already).Text -ceq $already) 'policy case-insensitive and idempotent'
Assert-True ((Get-DispatchPacket -Text $packet -AllowSubAgents).Text -ceq $packet) 'AllowSubAgents does not append prohibition'
Assert-True ((Get-DispatchPacket -Text ($packet + (' ' * 8192)) -AllowLarge).ExitCode -eq 0) 'AllowLarge passed through'
$fixture = New-TestFolder
try {
  $spec = Join-Path $fixture 'packet.md'
  [IO.File]::WriteAllText($spec, 'GOAL: invalid', (New-Object Text.UTF8Encoding($false)))
  $dispatcher = Join-Path $PSScriptRoot '..\bin\codex-do.ps1'
  $binBefore = $env:CODEX_DO_BIN
  try {
    $env:CODEX_DO_BIN = Join-Path $fixture 'must-not-launch.exe'
    $rejection = (& powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -SpecFile $spec 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -eq 74 -and $rejection -match 'Missing SUCCESS CRITERIA' -and $rejection -notmatch 'must-not-launch') 'real entry point exits 74 before account/Codex work'
    $null = & powershell -NoProfile -ExecutionPolicy Bypass -File $dispatcher -AllowSubAgents -NoSubAgents -SpecFile $spec 2>&1
    Assert-True ($LASTEXITCODE -eq 64) 'usage validation still precedes lint'
    Assert-True ([IO.File]::ReadAllText($spec) -ceq 'GOAL: invalid') 'dispatch does not change packet file'
  } finally { $env:CODEX_DO_BIN = $binBefore }
  $sessions = Join-Path $fixture 'sessions'; $folder = Join-Path $fixture 'run'
  [void][IO.Directory]::CreateDirectory($sessions); [void][IO.Directory]::CreateDirectory($folder)
  $parent = '11111111-1111-1111-1111-111111111111'
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $sessions "rollout-$parent.jsonl"), (@{type='session_meta';payload=@{id=$parent;cwd=$fixture}} | ConvertTo-Json -Compress), $utf8)
  foreach ($i in 1..2) {
    $child = @{type='session_meta';payload=@{id="child$i";cwd=$fixture;source=@{subagent=@{thread_spawn=@{parent_thread_id=$parent}}}}}
    if ($i -eq 2) { $child.payload = @{id="child$i";cwd=$fixture;parent_thread_id=$parent} }
    [IO.File]::WriteAllText((Join-Path $sessions "rollout-child$i.jsonl"), ($child | ConvertTo-Json -Depth 8 -Compress), $utf8)
  }
  foreach ($source in @('agent','User')) {
    $id = if ($source -ceq 'agent') { '22222222-2222-2222-2222-222222222222' } else { '33333333-3333-3333-3333-333333333333' }
    $row = @{type='session_meta';payload=@{id=$id;cwd=$fixture;thread_source=$source}}
    [IO.File]::WriteAllText((Join-Path $sessions "rollout-$id.jsonl"), ($row | ConvertTo-Json -Depth 5 -Compress), $utf8)
  }
  Write-DispatchSubagents -AccountHome $fixture -Session $parent -RunFolder $folder
  Assert-True (-not (Test-Path (Join-Path $folder 'subagents.txt'))) 'telemetry is not written before exit publication'
  [IO.File]::WriteAllText((Join-Path $folder 'exit.txt'), '0', $utf8)
  $notice = (Write-DispatchSession -Dir $fixture -AccountHome $fixture -RunStarted (Get-Date).AddMinutes(-1) -RunFolder $folder 6>&1 | Out-String)
  Assert-True ([IO.File]::ReadAllText((Join-Path $folder 'session.txt')) -eq $parent) 'legacy user selected; children and non-user sources excluded case-sensitively'
  Assert-True ([IO.File]::ReadAllText((Join-Path $folder 'subagents.txt')).Trim() -eq '2' -and $notice -match 'spawned 2 sub-agent threads') 'child count and completion notice'
  $meta = @{dir=$fixture;accountHome=$fixture;resume=$parent;startedUtc=[datetime]::UtcNow.ToString('o')}
  [IO.File]::WriteAllText((Join-Path $folder 'run.json'), ($meta | ConvertTo-Json), $utf8)
  $completion = Join-Path $folder 'complete.ps1'
  $outLog = Join-Path $folder 'out.log'
  [IO.File]::WriteAllText($outLog, 'final worker output', $utf8)
  $outTime = [IO.File]::GetLastWriteTimeUtc($outLog)
  [IO.File]::WriteAllText($completion, (New-DispatchCompletionScript), $utf8)
  Remove-Item -LiteralPath (Join-Path $folder 'subagents.txt')
  $notice = (& powershell -NoProfile -ExecutionPolicy Bypass -File $completion -RunFolder $folder 2>&1 | Out-String)
  Assert-True ($LASTEXITCODE -eq 0 -and $notice -match 'spawned 2 sub-agent threads' -and [IO.File]::ReadAllText((Join-Path $folder 'subagents.txt')) -eq '2') 'standalone completion works without dispatcher observer'
  Assert-True ([IO.File]::ReadAllText($outLog) -ceq 'final worker output' -and [IO.File]::GetLastWriteTimeUtc($outLog) -eq $outTime) 'completion leaves published output unchanged'
  Remove-Item -LiteralPath (Join-Path $folder 'subagents.txt')
  $null = Write-DispatchSession -Dir $fixture -AccountHome (Join-Path $fixture 'missing') -RunStarted (Get-Date) -RunFolder $folder 6>&1
  Assert-True (-not (Test-Path (Join-Path $folder 'subagents.txt'))) 'scan failure leaves no count file'
  [IO.File]::WriteAllText((Join-Path $sessions 'rollout-broken.jsonl'), '{broken', $utf8)
  Write-DispatchSubagents -AccountHome $fixture -Session $parent -RunFolder $folder
  Assert-True ([IO.File]::ReadAllText((Join-Path $folder 'subagents.txt')) -eq '2') 'unparseable rollout is skipped without disabling count'
  Remove-Item -LiteralPath (Join-Path $sessions 'rollout-broken.jsonl')
  Write-DispatchSubagents -AccountHome $fixture -Session 'no-children' -RunFolder $folder
  Assert-True ([IO.File]::ReadAllText((Join-Path $folder 'subagents.txt')) -eq '0') 'successful zero count is recorded'
  $source = [IO.File]::ReadAllText($dispatcher)
  $publish = $source.IndexOf('$wrapper += ''move /y')
  $scan = $source.IndexOf('-f $completionPath, $runFolder, (Join-Path')
  Assert-True ($publish -gt 0 -and $scan -gt $publish) 'detached wrapper publishes exit before completion scan'
  Assert-True ($source -notmatch '>>.*\{2\}.*-f \$completionPath' -and $source -match "Join-Path \`$runFolder 'telemetry.log'") 'completion output uses separate telemetry log'
  $userId = '44444444-4444-4444-4444-444444444444'
  $row = @{type='session_meta';payload=@{id=$userId;cwd=$fixture;thread_source='user';parent_thread_id=$parent}}
  [IO.File]::WriteAllText((Join-Path $sessions "rollout-$userId.jsonl"), ($row | ConvertTo-Json -Depth 5 -Compress), $utf8)
  Remove-Item -LiteralPath (Join-Path $folder 'session.txt')
  $null = Write-DispatchSession -Dir $fixture -AccountHome $fixture -RunStarted (Get-Date).AddMinutes(-1) -RunFolder $folder 6>&1
  Assert-True ([IO.File]::ReadAllText((Join-Path $folder 'session.txt')) -eq $userId) 'explicit user source accepted even with parent id'
  . (Import-TestFunctions (Join-Path $PSScriptRoot '..\bin\codex-run-notify.ps1'))
  Write-DispatchSubagents -AccountHome $fixture -Session $parent -RunFolder $folder
  Assert-True ((Get-SubagentNotice $folder) -eq ' | spawned 3 sub-agent threads') 'toast includes positive subagent count'
  [IO.File]::WriteAllText((Join-Path $folder 'subagents.txt'), '0', $utf8)
  Assert-True ((Get-SubagentNotice $folder) -eq '') 'toast omits zero count'
  # Execute the actual live inheritance block with fixture metadata, without dispatching.
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($dispatcher, [ref]$tokens, [ref]$errors)
  $inherit = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text -match 'priorRunId' } | Select-Object -First 1
  $inheritHarness = [scriptblock]::Create('param($Resume, $Dir, $runsDir, $Model="default-model", $Effort="default-effort")' + "`n" + $inherit.Extent.Text + "`n" + '[pscustomobject]@{Model=$Model;Effort=$Effort}')
  function Read-CodexRunMetadata { param($Folder) [IO.File]::ReadAllText((Join-Path $Folder 'run.json')) | ConvertFrom-Json }
  $oldRun = Join-Path $fixture '20261113-000001-0001'
  $newRun = Join-Path $fixture '20261113-000002-0002'
  foreach ($dir in @($oldRun,$newRun)) { [void][IO.Directory]::CreateDirectory($dir) }
  [IO.Directory]::SetCreationTimeUtc($oldRun, [datetime]::UtcNow.AddMinutes(-2))
  [IO.File]::WriteAllText((Join-Path $oldRun 'run.json'), (@{dir=$fixture;model='prior-model';effort='high'} | ConvertTo-Json), $utf8)
  [IO.File]::WriteAllText((Join-Path $newRun 'run.json'), (@{dir=$fixture;model='latest-model';effort='max'} | ConvertTo-Json), $utf8)
  [IO.File]::WriteAllText((Join-Path $oldRun 'session.txt'), $parent, $utf8)
  [IO.File]::WriteAllText((Join-Path $newRun 'session.txt'), 'another-session', $utf8)
  $inherited = & $inheritHarness -Resume $parent -Dir $fixture -runsDir $fixture
  Assert-True ($inherited.Model -ceq 'prior-model' -and $inherited.Effort -ceq 'high') 'UUID resume inherits matching model/effort'
  $inherited = & $inheritHarness -Resume last -Dir $fixture -runsDir $fixture
  Assert-True ($inherited.Model -ceq 'latest-model' -and $inherited.Effort -ceq 'max') 'last resume inherits latest directory match'
  $inherited = & $inheritHarness -Resume $parent -Dir $fixture -runsDir $fixture -Model explicit-model
  Assert-True ($inherited.Model -ceq 'explicit-model' -and $inherited.Effort -ceq 'high') 'explicit model preserved while effort inherits'
  $inherited = & $inheritHarness -Resume $parent -Dir $fixture -runsDir $fixture -Effort low
  Assert-True ($inherited.Model -ceq 'prior-model' -and $inherited.Effort -ceq 'low') 'explicit effort preserved while model inherits'
  $inherited = & $inheritHarness -Resume last -Dir (Join-Path $fixture 'unrelated') -runsDir $fixture
  Assert-True ($inherited.Model -ceq 'default-model' -and $inherited.Effort -ceq 'default-effort') 'unmatched resume retains defaults'
} finally { Remove-TestFolder $fixture }
Complete-Tests
