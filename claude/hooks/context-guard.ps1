# UserPromptSubmit hook: surface the statusline's context usage to Claude.
# Intent: checkpoint before compaction. Status: fixture-covered. Next: supervisor wiring.
# Blockers: none. Confidence: high; unreadable or stale cache stays silent.

try {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version 2.0
    # Speed (2026-11-12): .NET JSON and file APIs; the cmdlet versions add ~110 ms of module load.
    [void][Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
    $json = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
    $json.MaxJsonLength = 67108864   # default 2 MB: a long prompt would throw and silence the hook
    $hookInput = $json.DeserializeObject([Console]::In.ReadToEnd())
    $cachePath = $env:ULTRATHINK_CTX_OVERRIDE
    if (-not $cachePath) {
        if (-not $hookInput.ContainsKey('session_id')) { exit 0 }
        $sid = [string]$hookInput['session_id']
        if (-not $sid) { exit 0 }
        $cachePath = [IO.Path]::Combine($env:TEMP, 'ultrathink-status', "ctx-$sid.json")
    }
    if (-not [IO.File]::Exists($cachePath)) { exit 0 }
    $cache = $json.DeserializeObject([IO.File]::ReadAllText($cachePath))
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if (($now - [double]$cache['ts']) -gt 900) { exit 0 }
    # Floor, not [int]: [int] rounds 59.6 up to 60 and would fire one step early.
    $pct = [int][math]::Floor([double]$cache['pct'])
    # 2026-11-15 (Line): compaction handles long sessions; never nag Line about /clear or a fresh session.
    # Silent below 85%. At 85%+ keep the handoff file current (write or update it yourself) and keep working.
    if ($pct -lt 85) { exit 0 }
    $reminder = "[CONTEXT $pct%] Update the newest .handoff file now (silently, no question to Line), then continue the task. Do not ask Line to /clear; compaction handles context."
    [Console]::Out.WriteLine($reminder)
}
catch {}
exit 0
