# Intent: require Line's Codex dispatch packets to record the supervisor's documentation check.
# Status: fixture-covered; read errors fail open so the dispatcher can report them.
# Next: supervisor installs and wires PreToolUse. Blockers: none. Confidence: high.
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
    if ($request.tool_name -notin @('PowerShell', 'Bash')) { exit 0 }
    $command = $request.tool_input.command
    if ($command -isnot [string] -or $command -notmatch '(?i)codex-do\.ps1') { exit 0 }
    if ($command -match '(?i)\s-(Status|Attach|Cancel|Resume)(?=\s|$)') { exit 0 }

    $pathToken = '(?:"(?<double>[^"]+)"|''(?<single>[^'']+)''|(?<bare>[^\s|]+))'
    $source = [regex]::Match($command, '(?i)\s-SpecFile\s+' + $pathToken)
    if (-not $source.Success) {
        $source = [regex]::Match($command, '(?i)\bGet-Content\s+(?:(?:-Raw|-LiteralPath)\s+)?' + $pathToken + '\s*\|')
    }
    $packet = $command
    if ($source.Success) {
        $path = $source.Groups['double'].Value + $source.Groups['single'].Value + $source.Groups['bare'].Value
        if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path $request.cwd $path }
        $packet = [IO.File]::ReadAllText($path)
    }
    if ($packet -match '(?im)^\s*DOCS CHECKED:\s*\S') { exit 0 }
    $reason = "Packet has no DOCS CHECKED line. If the task uses a library, SDK, framework, CLI, or external API: call context7 resolve-library-id then query-docs, embed the facts in the packet, and add 'DOCS CHECKED: <lib> <version> via context7 <date>'. Otherwise add 'DOCS CHECKED: n/a - <reason>'."
    $output = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } }
    [Console]::Out.WriteLine(($output | ConvertTo-Json -Compress -Depth 4))
} catch {}
exit 0
