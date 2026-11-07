# Intent: OpenRouter credits pay only for the model under test (openai/gpt-6-luna). Judge panels and any other
# model run on Claude CLI agents and Codex sessions. Incident 2026-10-25: a 40-row judge pilot was sent to
# OpenRouter (Opus 5.5 + three GPT-6 judges, 0.94 USD from the wallet) against Line's rule.
# Status: fixture-tested on install (see tests at the end of the install turn). Next: none. Blockers: none. Confidence: high.
# Denies a Bash or PowerShell command when:
#   (a) it launches the judge tooling for real: label-judges.mjs without --dry-run/--self-test, or run-panel.ps1;
#   (b) it mentions OpenRouter (OPENROUTER_API_KEY or openrouter.ai) together with a provider/model id that is not
#       openai/gpt-6-luna (for example anthropic/claude-opus-5.5, openai/gpt-6-astra, openai/gpt-6.1-sol).
# Read-only probes of the OpenRouter catalog or key endpoint carry no model id and pass. Codex -Model flags carry no
# provider prefix and pass. Set OPENROUTER_GUARD_OVERRIDE=1 in the command only after Line wrote the exception in chat.
try {
    $inputJson = [Console]::In.ReadToEnd()
    $request = $inputJson | ConvertFrom-Json -ErrorAction Stop
    if ($request.tool_name -ne 'Bash' -and $request.tool_name -ne 'PowerShell') { exit 0 }
    $command = $request.tool_input.command
    if ($command -isnot [string]) { exit 0 }
    if ($command -match 'OPENROUTER_GUARD_OVERRIDE=1') { exit 0 }

    $reason = $null
    if ($command -match 'label-judges\.mjs' -and $command -notmatch '--dry-run|--self-test') {
        $reason = 'label-judges.mjs sends judge traffic to OpenRouter. Line 2026-10-25: OpenRouter credits are only for openai/gpt-6-luna; judges run as Claude CLI agents and Codex sessions (LABELLING_PLAN_v1.md path B).'
    } elseif ($command -match 'run-panel\.ps1') {
        $reason = 'run-panel.ps1 launches the paid OpenRouter judge panel. Line 2026-10-25: judges run as Claude CLI agents and Codex sessions, never through OpenRouter.'
    } elseif ($command -match 'OPENROUTER_API_KEY|openrouter\.ai') {
        $ids = [regex]::Matches($command, '(?i)\b(anthropic|openai|google|x-ai|moonshotai|qwen|deepseek|meta-llama|mistralai|amazon|cohere|perplexity|nvidia|microsoft|typesafe)/[a-z0-9][a-z0-9._:-]*') | ForEach-Object { $_.Value.ToLowerInvariant() } | Sort-Object -Unique
        $bad = @($ids | Where-Object { $_ -ne 'openai/gpt-6-luna' })
        if ($bad.Count -gt 0) {
            $reason = "OpenRouter call with model(s) $($bad -join ', '). Line 2026-10-25: OpenRouter credits pay only for openai/gpt-6-luna (the model under test). Judges and every other model run on Claude CLI agents or Codex sessions. If Line wrote an exception in chat, add OPENROUTER_GUARD_OVERRIDE=1 to the command."
        }
    }
    if ($reason) {
        $output = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } }
        [Console]::Out.WriteLine(($output | ConvertTo-Json -Compress -Depth 4))
    }
} catch {}
exit 0
