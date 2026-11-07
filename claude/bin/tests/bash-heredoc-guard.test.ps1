$ErrorActionPreference = 'Stop'
$hook = Join-Path (Join-Path $PSScriptRoot '..\..') 'hooks\bash-heredoc-guard.ps1'
$reason = "Bash heredocs fail on this machine (97 'unexpected EOF' errors in 14 days, 2026-10-12 audit). Write file contents with the Write tool, run multi-line scripts with the PowerShell tool, or save a script file and run it."

function Test-Hook($name, $inputJson, $denied) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $result = $inputJson | powershell -NoProfile -ExecutionPolicy Bypass -File $hook
    $watch.Stop()
    if ($LASTEXITCODE -ne 0) { throw "$name exited $LASTEXITCODE" }
    if ($watch.ElapsedMilliseconds -ge 1000) { throw "$name took $($watch.ElapsedMilliseconds) ms" }
    $lines = @($result)
    if ($denied) {
        if ($lines.Count -ne 1) { throw "$name expected one JSON line, got $($lines.Count)" }
        $expected = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } } | ConvertTo-Json -Compress -Depth 4
        if ($lines[0] -cne $expected) { throw "$name returned unexpected JSON: $($lines[0])" }
    } elseif ($lines.Count -ne 0) { throw "$name should allow silently: $result" }
}

function New-HookInput($tool, $command) {
    return @{ tool_name = $tool; tool_input = @{ command = $command } } | ConvertTo-Json -Compress -Depth 4
}

Test-Hook 'quoted delimiter' (New-HookInput 'Bash' "cat > a.md <<'EOF'`nhi`nEOF") $true
Test-Hook 'python delimiter' (New-HookInput 'Bash' 'python - <<EOF') $true
Test-Hook 'tab-stripping delimiter' (New-HookInput 'Bash' 'cat <<-END') $true
Test-Hook 'git commit exemption' (New-HookInput 'Bash' "git commit -m `"`$(cat <<'EOF'`nmsg`nEOF`n)`"") $false
Test-Hook 'here-string' (New-HookInput 'Bash' 'grep x <<< "$y"') $false
Test-Hook 'plain command' (New-HookInput 'Bash' 'ls -la') $false
Test-Hook 'other tool' (New-HookInput 'PowerShell' "cat <<'EOF'") $false
Test-Hook 'invalid JSON' '{invalid' $false
Write-Output 'bash heredoc guard: 8 cases passed'
