# Intent: prove Line's packet docs gate accepts documented work and fails open on unreadable input.
# Status: fixture coverage. Next: supervisor wires the hook after validation.
# Blockers: none. Confidence: deterministic stdin and file fixtures.
$ErrorActionPreference = 'Stop'
$hook = Join-Path (Join-Path $PSScriptRoot '..\..') 'hooks\packet-docs-guard.ps1'
$fixture = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('packet-docs-fixture-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$reason = "Packet has no DOCS CHECKED line. If the task uses a library, SDK, framework, CLI, or external API: call context7 resolve-library-id then query-docs, embed the facts in the packet, and add 'DOCS CHECKED: <lib> <version> via context7 <date>'. Otherwise add 'DOCS CHECKED: n/a - <reason>'."
$cases = 0
function Test-Hook($Name, $InputJson, $Denied) {
    $result = @($InputJson | powershell -NoProfile -ExecutionPolicy Bypass -File $hook)
    if ($LASTEXITCODE -ne 0) { throw "$Name exited $LASTEXITCODE" }
    if ($Denied) {
        if ($result.Count -ne 1) { throw "$Name expected one JSON line" }
        $decision = $result[0] | ConvertFrom-Json
        if ($decision.hookSpecificOutput.hookEventName -cne 'PreToolUse' -or
            $decision.hookSpecificOutput.permissionDecision -cne 'deny' -or
            $decision.hookSpecificOutput.permissionDecisionReason -cne $reason) { throw "$Name returned incorrect denial" }
    } elseif ($result.Count -ne 0) { throw "$Name should allow silently" }
    $script:cases++
}
function New-HookInput($Command, $Tool = 'PowerShell') {
    return @{ tool_name = $Tool; tool_input = @{ command = $Command }; cwd = $fixture } | ConvertTo-Json -Compress -Depth 4
}
try {
    [void][IO.Directory]::CreateDirectory($fixture)
    $yes = Join-Path $fixture 'yes.md'
    $no = Join-Path $fixture 'no.md'
    $space = Join-Path $fixture 'packet with spaces.md'
    [IO.File]::WriteAllText($yes, "GOAL: x`nDOCS CHECKED: test 1.0.0 via context7 2026-10-12`n", $utf8)
    [IO.File]::WriteAllText($no, "GOAL: x`n", $utf8)
    [IO.File]::WriteAllText($space, "DOCS CHECKED: n/a - x`n", $utf8)
    Test-Hook 'SpecFile documented' (New-HookInput "codex-do.ps1 -SpecFile $yes") $false
    Test-Hook 'SpecFile undocumented' (New-HookInput "codex-do.ps1 -SpecFile $no") $true
    Test-Hook 'double quoted path' (New-HookInput "codex-do.ps1 -SpecFile `"$space`"") $false
    Test-Hook 'single quoted path' (New-HookInput "codex-do.ps1 -SpecFile '$space'" 'Bash') $false
    Test-Hook 'relative path' (New-HookInput 'codex-do.ps1 -SpecFile yes.md') $false
    Test-Hook 'relative missing docs' (New-HookInput 'codex-do.ps1 -SpecFile no.md') $true
    Test-Hook 'inline documented' (New-HookInput "codex-do.ps1 -Dir repo `"GOAL: x`nDOCS CHECKED: n/a - x`n`"") $false
    Test-Hook 'inline undocumented' (New-HookInput 'codex-do.ps1 -Dir repo "GOAL: x"') $true
    Test-Hook 'empty docs' (New-HookInput "codex-do.ps1`nDOCS CHECKED:   ") $true
    Test-Hook 'case insensitive' (New-HookInput "CODEX-DO.PS1`n  docs checked: n/a - x") $false
    Test-Hook 'Get-Content raw' (New-HookInput "Get-Content -Raw '$yes' | powershell -File codex-do.ps1") $false
    Test-Hook 'Get-Content no docs' (New-HookInput "Get-Content -Raw '$no' | powershell -File codex-do.ps1") $true
    Test-Hook 'Get-Content bare' (New-HookInput 'Get-Content yes.md | powershell -File codex-do.ps1') $false
    Test-Hook 'Get-Content LiteralPath' (New-HookInput "Get-Content -LiteralPath '$space' | powershell -File codex-do.ps1") $false
    Test-Hook 'SpecFile takes precedence' (New-HookInput "Get-Content '$yes' | codex-do.ps1 -SpecFile '$no'`nDOCS CHECKED: n/a - inline") $true
    foreach ($parameter in @('-Status', '-Attach last', '-Cancel last', '-Resume last', '-sTaTuS')) {
        Test-Hook $parameter (New-HookInput "codex-do.ps1 $parameter") $false
    }
    Test-Hook 'parameter prefix is not exempt' (New-HookInput 'codex-do.ps1 -StatusExtra') $true
    Test-Hook 'other command' (New-HookInput 'Write-Host hello') $false
    Test-Hook 'missing SpecFile' (New-HookInput 'codex-do.ps1 -SpecFile missing.md') $false
    Test-Hook 'missing piped file' (New-HookInput 'Get-Content missing.md | codex-do.ps1') $false
    Test-Hook 'Read tool' (New-HookInput 'codex-do.ps1' 'Read') $false
    Test-Hook 'malformed JSON' '{invalid' $false
    $lock = [IO.File]::Open($no, 'Open', 'ReadWrite', 'None')
    try { Test-Hook 'unreadable SpecFile' (New-HookInput "codex-do.ps1 -SpecFile '$no'") $false }
    finally { $lock.Dispose() }
    Write-Output "packet docs guard: $cases cases passed"
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if ((Split-Path -Parent $resolved) -ne [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') -or
        (Split-Path -Leaf $resolved) -notlike 'packet-docs-fixture-*') { throw 'Unsafe fixture cleanup path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
