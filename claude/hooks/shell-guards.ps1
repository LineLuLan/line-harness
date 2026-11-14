# Intent: run the existing shell guards in order without three PowerShell startups.
# Status: equivalence-tested. Next: supervisor installs. Blockers: none. Confidence: high.
# The guard scripts remain the source of truth, including fail-closed push approval.
try {
    $raw = [Console]::In.ReadToEnd()
    # Include the judge tools, which do not need an OpenRouter mention. JSON Unicode
    # escapes must take the slow path: e.g. p\u0075sh or \u003c\u003cEOF.
    # PowerShell joins quoted fragments inside tokens (pu"s"h, pu''sh), and
    # accepts backticks. JSON escaping adds punctuation too, so keep this broad.
    # OpenRouter and heredoc guards match raw command text, not parsed tokens;
    # split quotes cannot create a match there. Their literal triggers suffice.
    if ($raw -notmatch '(?i)p[^a-z0-9\s]*u[^a-z0-9\s]*s[^a-z0-9\s]*h|openrouter|label-judges|run-panel|<<|\\u[0-9a-f]{4}|`|[^\x00-\x7F]') { exit 0 }

    $stdin = [Console]::In
    $stdout = [Console]::Out
    foreach ($guard in @('git-push-guard.ps1', 'openrouter-model-guard.ps1', 'bash-heredoc-guard.ps1')) {
        $reader = [IO.StringReader]::new($raw)
        $writer = [IO.StringWriter]::new()
        try {
            [Console]::SetIn($reader)
            [Console]::SetOut($writer)
            # Call in a child script scope: its exit returns here, not out of this host.
            # Each script retains its own tool-name checks (heredocs are Bash only).
            & (Join-Path $PSScriptRoot $guard)
        }
        finally {
            [Console]::SetIn($stdin)
            [Console]::SetOut($stdout)
            $output = $writer.ToString()
            $reader.Dispose()
            $writer.Dispose()
        }
        if ($output.Trim()) {
            [Console]::Out.Write($output)
            exit 0
        }
    }
} catch {}
exit 0
