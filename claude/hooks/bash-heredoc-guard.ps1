# Intent: block Bash heredocs before the local quoting failure wastes a tool turn.
# Status: fixture-covered. Next: supervisor installs and wires this hook. Blockers: none. Confidence: high.
try {
    $inputJson = [Console]::In.ReadToEnd()
    $request = $inputJson | ConvertFrom-Json -ErrorAction Stop
    if ($request.tool_name -ne 'Bash') { exit 0 }
    $command = $request.tool_input.command
    if ($command -isnot [string]) { exit 0 }
    if ($command -match '^\s*git\s+commit\b') { exit 0 }
    if ($command -match '(?<!<)<<(?!<)-?\s*[''"]?[A-Za-z_][A-Za-z0-9_]*[''"]?') {
        $reason = "Bash heredocs fail on this machine (97 'unexpected EOF' errors in 14 days, 2026-10-12 audit). Write file contents with the Write tool, run multi-line scripts with the PowerShell tool, or save a script file and run it."
        $output = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } }
        [Console]::Out.WriteLine(($output | ConvertTo-Json -Compress -Depth 4))
    }
} catch {}
exit 0
