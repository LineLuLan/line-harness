# Run the packet's stdin render with fresh dummy caches and no live account access.
. (Join-Path $PSScriptRoot 'test-lib.ps1')
$temp = New-TestFolder
$saved = @{}
$overrides = @{
    USERPROFILE = $temp; HOME = $temp; TEMP = $temp; TMP = $temp
    CODEX_ACC_MAIN_HOME = (Join-Path $temp 'codex')
    CODEX_ACC_ROOT = (Join-Path $temp 'accounts')
    CODEX_DO_STATE_DIR = (Join-Path $temp 'state')
    ULTRATHINK_TRAIL_OVERRIDE = (Join-Path $temp 'trail')
}
try {
    foreach ($name in $overrides.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process')
    }
    $cache = Join-Path $temp 'ultrathink-status'
    [void][IO.Directory]::CreateDirectory($cache)
    $reset = [DateTimeOffset]::UtcNow.AddDays(3.5)
    $fixtures = @{
        'accounts.json' = @{ claude = 'fixture'; codex = 'fixture' }
        'anthropic-usage.json' = @{ seven_day = @{ utilization = 60; resets_at = $reset.ToString('o') } }
        'codex-usage.json' = @{ weekly = @{ left = 40; usedPercent = 60; resetsAt = $reset.ToUnixTimeSeconds() } }
        'openrouter-usage.json' = @{}
    }
    foreach ($name in $fixtures.Keys) {
        [IO.File]::WriteAllText((Join-Path $cache $name), ($fixtures[$name] | ConvertTo-Json -Compress -Depth 5), [Text.UTF8Encoding]::new($false))
    }
    Push-Location (Join-Path $PSScriptRoot '..\..')
    try {
        cmd /d /c 'node claude/statusline-ultrathink.js < claude/tests/fixtures/statusline-input.json'
        if ($LASTEXITCODE -ne 0) { throw "Statusline exited $LASTEXITCODE" }
    } finally { Pop-Location }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    Remove-TestFolder $temp
}
