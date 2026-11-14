. (Join-Path $PSScriptRoot 'hook-test-lib.ps1')
$hook = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\hooks\edit-delegation-guard.ps1'))
$temp = New-TestFolder
function Invoke-Edit([string]$Sid, [int]$Lines, [string]$Path = 'src/a.ps1', [string]$Agent = '', [string]$Tool = 'Edit') {
    $text = ((1..$Lines | ForEach-Object { "line $_" }) -join "`n")
    if ($Lines -eq 0) { $text = " `n`t" }
    $inputObject = @{ session_id = $Sid; tool_name = $Tool; tool_input = @{ file_path = (Join-Path $temp $Path) } }
    if ($Tool -eq 'Write') { $inputObject.tool_input.content = $text }
    elseif ($Tool -eq 'MultiEdit') { $inputObject.tool_input.edits = @(@{ old_string = ''; new_string = $text }) }
    else { $inputObject.tool_input.old_string = ''; $inputObject.tool_input.new_string = $text }
    if ($Agent) { $inputObject.agent_id = $Agent }
    return Invoke-EditPayload ($inputObject | ConvertTo-Json -Compress -Depth 6)
}
function Invoke-EditPayload([string]$Payload, [string]$Arguments = '') {
    $result = Invoke-TestHook $hook $Payload $temp $Arguments
    Assert-True ($result.ExitCode -eq 0 -and -not $result.Error) 'edit hook fails open with no stderr'
    if (-not $result.Output) { return '' }
    $output = ($result.Output | ConvertFrom-Json).hookSpecificOutput
    Assert-True (-not $output.permissionDecision) 'edit hook never denies'
    return [string]$output.additionalContext
}
try {
    Invoke-EditPayload '{"session_id":"no-edits"}' '-Mode reset' | Out-Null
    Assert-True (-not [IO.Directory]::Exists((Join-Path $temp '.claude/state/edit-delegation'))) 'reset without edits creates no state or directory'
    # Run reset in-process and report loaded assemblies after its script-scope exit.
    $probe = Join-Path $temp 'reset-probe.ps1'
    [IO.File]::WriteAllText($probe, @'
param([string]$Hook)
& $Hook -Mode reset
$loaded = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq 'System.Web.Extensions' })
[Console]::Out.WriteLine($loaded.Count)
'@)
    $probeResult = Invoke-TestHook $probe '{"session_id":"no-edits"}' $temp ('-Hook "' + $hook + '"')
    Assert-True ($probeResult.ExitCode -eq 0 -and $probeResult.Output -eq '0') 'reset does not load JSON serializer assembly'
    $msg = Invoke-Edit 'budget' 150
    Assert-True ($msg -notmatch '\[EDIT BUDGET\]' -and $msg -match 'DELEGATION WARNING') '150 is not over budget; original large-edit warning retained'
    $msg = Invoke-Edit 'budget' 1
    Assert-True ($msg -match '\[EDIT BUDGET\] 151 lines inline this session - delegate the rest') '151 triggers budget reminder'
    Invoke-EditPayload '{"session_id":"budget"}' '-Mode reset' | Out-Null
    $msg = Invoke-Edit 'budget' 149
    Assert-True ($msg -match '\[EDIT BUDGET\] 300 lines' -and $msg -notmatch 'OVER BUDGET') 'prompt reset preserves budget; 300 not over hard threshold'
    $msg = Invoke-Edit 'budget' 1
    Assert-True ($msg -match '\[EDIT BUDGET\] 301 lines inline this session - OVER BUDGET - delegate the rest') '301 marks OVER BUDGET'
    Assert-True ((Invoke-Edit 'budget' 0) -match '301 lines') 'blank lines do not increase budget'
    Assert-True ((Invoke-Edit 'other' 1) -eq '') 'sessions isolated'
    Assert-True ((Invoke-Edit 'budget' 100 'src/a.ps1' 'worker') -eq '') 'subagent exempt'
    foreach ($path in @('.packets/a.md', 'nested/.packets/a.md', '.handoff/a.md', '.claude/projects/test/memory/a.md', 'Temp/claude/test/scratchpad/a.md')) {
        Assert-True ((Invoke-Edit 'budget' 100 $path) -eq '') "$path exempt"
    }
    Assert-True ((Invoke-Edit 'budget' 0) -match '301 lines') 'exempt calls do not spend budget'
    Invoke-Edit 'files' 1 'src/a.ps1' | Out-Null
    Invoke-Edit 'files' 1 'src/b.ps1' | Out-Null
    Assert-True ((Invoke-Edit 'files' 1 'src/c.ps1') -match 'distinct file 3') 'original distinct file warning'
    Invoke-EditPayload '{"session_id":"files"}' '-Mode reset' | Out-Null
    Assert-True ((Invoke-Edit 'files' 1 'src/d.ps1') -eq '') 'prompt reset clears distinct files'
    Invoke-Edit 'tools' 100 'src/a.ps1' '' 'Write' | Out-Null
    Assert-True ((Invoke-Edit 'tools' 51 'src/a.ps1' '' 'MultiEdit') -match '151 lines') 'Write and MultiEdit accumulate'
    $payload = @{ session_id = 'unchanged'; tool_name = 'Edit'; tool_input = @{ file_path = (Join-Path $temp 'a'); old_string = "same`nold"; new_string = "same`nnew`n `n" } } | ConvertTo-Json -Compress -Depth 4
    Invoke-EditPayload $payload | Out-Null
    Assert-True ((Invoke-Edit 'unchanged' 150) -match '151 lines') 'unchanged and blank lines excluded'
    foreach ($entry in @(
        @{ Sid = 'duplicates'; Old = 'x'; New = "x`nx"; Expected = 1 },
        @{ Sid = 'removed-duplicate'; Old = "x`nx"; New = 'x'; Expected = 0 },
        @{ Sid = 'mixed-duplicates'; Old = "x`ny`nx"; New = "x`ny`nx`nx`ny"; Expected = 2 }
    )) {
        $payload = @{ session_id = $entry.Sid; tool_name = 'Edit'; tool_input = @{ file_path = (Join-Path $temp 'a'); old_string = $entry.Old; new_string = $entry.New } } | ConvertTo-Json -Compress -Depth 4
        Invoke-EditPayload $payload | Out-Null
        $msg = Invoke-Edit $entry.Sid 150
        if ($entry.Expected) { Assert-True ($msg -match "$([int]$entry.Expected + 150) lines inline") "$($entry.Sid): counts occurrences" }
        else { Assert-True ($msg -notmatch '\[EDIT BUDGET\]') 'removing duplicate does not add a line' }
    }
    $written = Join-Path $temp 'existing.ps1'
    [IO.File]::WriteAllText($written, "line 1`nline 2`nline 3")
    Invoke-Edit 'existing-write' 5 'existing.ps1' '' 'Write' | Out-Null
    Assert-True ((Invoke-Edit 'existing-write' 149) -match '151 lines') 'Write subtracts existing non-blank lines'
    $payload = @{ session_id = 'multi-pairs'; tool_name = 'MultiEdit'; tool_input = @{
        file_path = (Join-Path $temp 'a'); edits = @(
            @{ old_string = 'same'; new_string = "same`nnew" },
            @{ old_string = ''; new_string = "more`nlast" }
        )
    } } | ConvertTo-Json -Compress -Depth 6
    Invoke-EditPayload $payload | Out-Null
    Assert-True ((Invoke-Edit 'multi-pairs' 148) -match '151 lines') 'MultiEdit sums all edit pairs'
    Assert-True ((Invoke-Edit 'packets-lookalike' 151 '.packets-other/a.md') -match '151 lines') 'only the exact .packets folder is exempt'
    Invoke-EditPayload '{"session_id":"budget","agent_id":"worker"}' '-Mode reset' | Out-Null
    Assert-True ((Invoke-Edit 'budget' 0) -match '301 lines') 'subagent reset cannot reset supervisor budget'
    Assert-True ((Invoke-EditPayload '{"tool_name":"Edit"}') -eq '') 'missing session is ignored'
    $combinedState = Join-Path $temp '.claude/state/edit-delegation/prior-combined.json'
    [IO.File]::WriteAllText($combinedState, '{"files":["old-a","old-b"],"addedLines":150}')
    $probeResult = Invoke-TestHook $probe '{"session_id":"prior-combined"}' $temp ('-Hook "' + $hook + '"')
    Assert-True ($probeResult.ExitCode -eq 0 -and $probeResult.Output -eq '0') 'reset preserves prior combined budget without loading serializer'
    $msg = Invoke-Edit 'prior-combined' 1
    Assert-True ($msg -match '151 lines' -and $msg -notmatch 'distinct file 3') 'prior combined state keeps total and starts fresh prompt list'
    $budgetPath = Join-Path $temp '.claude/state/edit-delegation/prior-combined.budget'
    $budgetBefore = [IO.File]::ReadAllText($budgetPath)
    Invoke-EditPayload '{"session_id":"prior-combined"}' '-Mode reset' | Out-Null
    Assert-True (-not [IO.File]::Exists($combinedState) -and [IO.File]::ReadAllText($budgetPath) -ceq $budgetBefore) 'reset deletes only prompt list and leaves budget bytes unchanged'
    $state = Join-Path $temp '.claude/state/edit-delegation/legacy.json'
    [IO.File]::WriteAllText($state, '["old-a","old-b"]')
    Assert-True ((Invoke-Edit 'legacy' 1) -match 'distinct file 3') 'legacy file-list state retained'
    [IO.File]::WriteAllText($state, '{broken')
    Assert-True ((Invoke-Edit 'legacy' 1) -eq '') 'corrupt state fails open'
    Assert-True ((Invoke-EditPayload '{broken') -eq '') 'malformed input fails open'
    $lock = [IO.File]::Open($state, 'Open', 'ReadWrite', 'None')
    try { Assert-True ((Invoke-Edit 'legacy' 1) -eq '') 'locked state fails open' }
    finally { $lock.Dispose() }
} finally { Remove-TestFolder $temp }
Complete-Tests
