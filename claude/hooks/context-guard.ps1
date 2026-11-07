# UserPromptSubmit hook: surface the statusline's context usage to Claude.
# Intent: checkpoint before compaction. Status: fixture-covered. Next: supervisor wiring.
# Blockers: none. Confidence: high; unreadable or stale cache stays silent.

try {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version 2.0
    $hookInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $cachePath = $env:ULTRATHINK_CTX_OVERRIDE
    if (-not $cachePath) {
        $sid = $hookInput.session_id
        if (-not $sid) { exit 0 }
        $cachePath = Join-Path $env:TEMP ("ultrathink-status\ctx-$sid.json")
    }
    if (-not (Test-Path -LiteralPath $cachePath -PathType Leaf)) { exit 0 }
    $cache = Get-Content -Raw -LiteralPath $cachePath | ConvertFrom-Json
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if (($now - [double]$cache.ts) -gt 900) { exit 0 }
    $pct = [int]$cache.pct
    if ($pct -lt 60) { exit 0 }
    if ($pct -lt 70) {
        $reminder = "[CONTEXT $pct% - CHECKPOINT] Write progress notes (memory or handoff) before the next large step."
    }
    elseif ($pct -lt 80) {
        $reminder = "[CONTEXT $pct% - OFFER HANDOFF] Offer /handoff to Line before starting any major task. Prefer subagents for exploration."
    }
    else {
        $reminder = "[CONTEXT $pct% - HANDOFF MANDATORY] Run /handoff now and do not start new work in this session (CLAUDE.md Context Thresholds)."
    }
    [Console]::Out.WriteLine($reminder)
}
catch {}
exit 0
