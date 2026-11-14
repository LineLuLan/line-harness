# Intent: remind the supervisor to delegate only when an inline edit is large (2026-11-12, Line).
#   -Mode check   PreToolUse Edit|Write|MultiEdit: non-blocking additionalContext when one edit adds
#                 more than 50 non-blank lines, or when this is the 3rd+ distinct file edited since the last prompt.
#   -Mode reset   UserPromptSubmit: clears distinct files, keeps the session line budget. Silent.
#   -Mode session SessionStart: prints one delegation line and prunes state files older than 24 h.
# Exempt: ~/.claude/projects/*/memory, any .handoff or .packets folder, Claude scratchpads, subagents (agent_id).
# State: <session_id>.json holds per-prompt paths; <session_id>.budget holds the session total.
# Reset deletes only the path list. Both modes lock the budget file, but reset never creates it.
# Intent: warn above 150 session lines; mark OVER BUDGET above 300. Never deny.
# Status: fixture-covered. Next: supervisor installs. Blockers: none. Confidence: high.
# Speed: .NET only, no nested functions; cmdlet JSON and path cmdlets add ~110 ms of module load.
# Fails open: any error = exit 0, no output. Never denies. Confidence: high.
param([string]$Mode = 'check')

$stateDir = [IO.Path]::Combine($env:USERPROFILE, '.claude', 'state', 'edit-delegation')

if ($Mode -eq 'session') {
    [Console]::Out.WriteLine('[DELEGATION] Multi-file or >50-line coding goes to the worker (codex-do.ps1, or an Opus subagent when Codex is off); inline Edit/Write is for small fixes. A PreToolUse hook warns on large inline edits.')
    try {
        if ([IO.Directory]::Exists($stateDir)) {
            $cut = [DateTime]::UtcNow.AddHours(-24)
            foreach ($f in [IO.Directory]::GetFiles($stateDir)) {
                if ([IO.Path]::GetExtension($f) -notin @('.json', '.budget')) { continue }
                if ([IO.File]::GetLastWriteTimeUtc($f) -lt $cut) { [IO.File]::Delete($f) }
            }
        }
    }
    catch {}
    exit 0
}

try {
    $raw = [Console]::In.ReadToEnd()

    if ($Mode -eq 'reset') {
        # Hook session ids are plain UUIDs. Escaped field names in prompt text cannot match.
        if ([regex]::IsMatch($raw, '"agent_id"\s*:\s*"(?:\\.|[^"\\])+"')) { exit 0 }
        $match = [regex]::Match($raw, '"session_id"\s*:\s*"([^"\\]+)"')
        if (-not $match.Success) { exit 0 }
        $stem = [IO.Path]::Combine($stateDir, [regex]::Replace($match.Groups[1].Value, '[^A-Za-z0-9_.-]', '_'))
        $lock = $null
        try {
            if ([IO.File]::Exists($stem + '.budget')) {
                for ($attempt = 0; $attempt -lt 5 -and -not $lock; $attempt++) {
                    try { $lock = [IO.File]::Open($stem + '.budget', [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
                    catch { [Threading.Thread]::Sleep(10) }
                }
                if (-not $lock) { exit 0 }
            }
            if ([IO.File]::Exists($stem + '.json')) {
                # Prior combined objects still hold the session budget. Leave them
                # for check-mode migration; only path arrays are disposable here.
                # This format check uses no JSON serializer and writes no state.
                if (-not [IO.File]::ReadAllText($stem + '.json').TrimStart().StartsWith('{')) {
                    [IO.File]::Delete($stem + '.json')
                }
            }
        }
        finally { if ($lock) { $lock.Dispose() } }
        exit 0
    }

    [void][Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
    $json = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
    $json.MaxJsonLength = 67108864
    $request = $json.DeserializeObject($raw)
    $sid = [string]$request['session_id']
    if (-not $sid) { exit 0 }
    # Subagents are the worker when Codex is off; the reminder targets the main (supervisor) thread only.
    if ($request.ContainsKey('agent_id') -and $request['agent_id']) { exit 0 }

    $tool = [string]$request['tool_name']
    if ($tool -ne 'Edit' -and $tool -ne 'Write' -and $tool -ne 'MultiEdit') { exit 0 }
    $ti = $request['tool_input']
    $path = [string]$ti['file_path']
    if (-not $path) { exit 0 }
    $full = [IO.Path]::GetFullPath($path)
    if ($full -match '(?i)\\\.claude\\projects\\[^\\]+\\memory(\\|$)' -or
        $full -match '(?i)\\\.handoff(\\|$)' -or
        $full -match '(?i)\\\.packets(\\|$)' -or
        $full -match '(?i)\\Temp\\claude\\.*\\scratchpad(\\|$)') { exit 0 }

    # Match each non-blank occurrence once, so x -> x,x adds one line.
    $pairs = [System.Collections.Generic.List[object]]::new()
    if ($tool -eq 'Write') {
        $old = ''
        if ([IO.File]::Exists($full)) { $old = [IO.File]::ReadAllText($full) }
        $pairs.Add(@($old, [string]$ti['content']))
    }
    elseif ($tool -eq 'Edit') { $pairs.Add(@([string]$ti['old_string'], [string]$ti['new_string'])) }
    else { foreach ($e in @($ti['edits'])) { $pairs.Add(@([string]$e['old_string'], [string]$e['new_string'])) } }
    $added = 0
    foreach ($pair in $pairs) {
        if (-not $pair[1]) { continue }
        $oldCounts = [System.Collections.Generic.Dictionary[string,int]]::new([StringComparer]::Ordinal)
        if ($pair[0]) {
            foreach ($l in ($pair[0] -split "`r?`n")) {
                $t = $l.Trim()
                if ($t.Length -eq 0) { continue }
                if (-not $oldCounts.ContainsKey($t)) { $oldCounts[$t] = 0 }
                $oldCounts[$t]++
            }
        }
        foreach ($l in ($pair[1] -split "`r?`n")) {
            $t = $l.Trim()
            if ($t.Length -eq 0) { continue }
            if ($oldCounts.ContainsKey($t) -and $oldCounts[$t] -gt 0) { $oldCounts[$t]-- }
            else { $added++ }
        }
    }

    # Per-session state, read-modify-write under an exclusive lock (FileShare.None) so parallel tool
    # calls of one session do not lose each other's files. Up to 5 tries x 10 ms; then fail open:
    # the file list counts as empty and nothing is written. Malformed content counts as empty.
    $stateFile = [IO.Path]::Combine($stateDir, ([regex]::Replace($sid, '[^A-Za-z0-9_.-]', '_') + '.json'))
    $budgetFile = [IO.Path]::ChangeExtension($stateFile, '.budget')
    $files = [System.Collections.Generic.List[string]]::new()
    $key = $full.ToLowerInvariant()
    $isNew = $true
    $total = [long]0
    $fs = $null
    try {
        if (-not [IO.Directory]::Exists($stateDir)) { [void][IO.Directory]::CreateDirectory($stateDir) }
        for ($try = 0; $try -lt 5 -and -not $fs; $try++) {
            try { $fs = [IO.File]::Open($budgetFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
            catch { [Threading.Thread]::Sleep(10) }
        }
        if ($fs) {
            $buf = [byte[]]::new([int]$fs.Length)
            $read = 0
            while ($read -lt $buf.Length) { $r = $fs.Read($buf, $read, $buf.Length - $read); if ($r -le 0) { break }; $read += $r }
            $text = [Text.Encoding]::UTF8.GetString($buf, 0, $read)
            [void][long]::TryParse($text.Trim(), [ref]$total)
            $total = [Math]::Max(0, $total)
            if ([IO.File]::Exists($stateFile)) {
                try {
                    $saved = $json.DeserializeObject([IO.File]::ReadAllText($stateFile))
                    $arr = $saved
                    if ($saved -is [System.Collections.IDictionary]) {
                        # Migrate the prior combined state on the next edit.
                        # Begin a fresh prompt list on upgrade, retaining its budget
                        # even if a delete-only reset ran before this first edit.
                        $arr = @()
                        $total = [Math]::Max($total, [long]$saved['addedLines'])
                    }
                    if ($arr -is [object[]]) { foreach ($f in $arr) { if ($f -is [string]) { $files.Add($f) } } }
                }
                catch { $files.Clear() }
            }
            $isNew = -not $files.Contains($key)
            if ($isNew) { $files.Add($key) }
            $total += $added
            $bytes = [Text.Encoding]::UTF8.GetBytes($total.ToString([Globalization.CultureInfo]::InvariantCulture))
            $fs.SetLength(0); $fs.Write($bytes, 0, $bytes.Length)
            [IO.File]::WriteAllText($stateFile, $json.Serialize($files.ToArray()), [Text.UTF8Encoding]::new($false))
        }
        else { $files.Add($key) }
    }
    catch { $files.Clear(); $files.Add($key) }
    finally { if ($fs) { $fs.Dispose() } }

    $why = $null
    if ($added -gt 50) { $why = "this edit adds about $added lines" }
    elseif ($isNew -and $files.Count -ge 3) { $why = "this is distinct file $($files.Count) edited inline since Line's last prompt" }
    $msg = ''
    if ($why) {
        $msg = "[DELEGATION WARNING] Large inline edit: $why. Work over ~50 lines or 3+ files goes to the worker: codex-do.ps1 with a task packet, or an Opus subagent when Codex is off. Continue inline only for touch-ups to a worker diff or mechanical edits (AGENTS.md section 15)."
    }
    if ($total -gt 150) {
        $over = if ($total -gt 300) { 'OVER BUDGET - ' } else { '' }
        if ($msg) { $msg += ' ' }
        $msg += "[EDIT BUDGET] $total lines inline this session - ${over}delegate the rest"
    }
    if (-not $msg) { exit 0 }
    [Console]::Out.WriteLine('{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"' + $msg.Replace('\', '\\').Replace('"', '\"') + '"}}')
}
catch {}
exit 0
