$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$claudeDir = Split-Path -Parent $root
$hook = Join-Path $claudeDir 'hooks\context-guard.ps1'
$statusline = Join-Path $claudeDir 'statusline-ultrathink.js'
$fixtureRoot = Join-Path $env:TEMP ('context-guard-selftest-' + [guid]::NewGuid().ToString('N'))
$savedOverride = $env:ULTRATHINK_CTX_OVERRIDE
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
$maxHookMs = 0

function Assert-True($condition, $label) {
    if (-not $condition) { throw "FAIL: $label" }
    [Console]::Out.WriteLine("PASS: $label")
}

function Assert-Hook($label, $expected, $inputJson = '{"session_id":"t1","prompt":"x"}') {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $output = @($inputJson | powershell -NoProfile -ExecutionPolicy Bypass -File $hook 2>&1)
    $code = $LASTEXITCODE
    $timer.Stop()
    $script:maxHookMs = [Math]::Max($script:maxHookMs, $timer.ElapsedMilliseconds)
    Assert-True ($code -eq 0) "$label exit 0"
    Assert-True (($output -join "`n") -ceq $expected) "$label output"
    Assert-True ($timer.ElapsedMilliseconds -lt 1000) "$label under 1 second"
}

try {
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    $fixture = Join-Path $fixtureRoot 'fixture.json'
    $env:ULTRATHINK_CTX_OVERRIDE = $fixture
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $cases = @(
        @{ Pct = 45; Expected = '' },         @{ Pct = 59; Expected = '' },         @{ Pct = 60; Expected = '' },         @{ Pct = 79; Expected = '' },         @{ Pct = 84; Expected = '' },
        @{ Pct = 85; Expected = '[CONTEXT 85%] Update the newest .handoff file now (silently, no question to Line), then continue the task. Do not ask Line to /clear; compaction handles context.' },
        @{ Pct = 92; Expected = '[CONTEXT 92%] Update the newest .handoff file now (silently, no question to Line), then continue the task. Do not ask Line to /clear; compaction handles context.' }
    )
    foreach ($case in $cases) {
        @{ pct = $case.Pct; ts = $now; model = 'Selftest' } | ConvertTo-Json -Compress | Set-Content -LiteralPath $fixture -Encoding UTF8
        Assert-Hook "pct $($case.Pct)" $case.Expected
    }
    @{ pct = 90; ts = $now - 1200 } | ConvertTo-Json -Compress | Set-Content -LiteralPath $fixture -Encoding UTF8
    Assert-Hook 'stale cache' ''
    'not json' | Set-Content -LiteralPath $fixture -Encoding UTF8
    Assert-Hook 'invalid cache JSON' ''
    '{"pct":90}' | Set-Content -LiteralPath $fixture -Encoding UTF8
    Assert-Hook 'missing timestamp' ''
    Assert-Hook 'invalid hook JSON' '' 'not json'
    $env:ULTRATHINK_CTX_OVERRIDE = Join-Path $fixtureRoot 'missing.json'
    Assert-Hook 'missing cache' ''

    & node --check $statusline
    Assert-True ($LASTEXITCODE -eq 0) 'node syntax'

    # Isolate existing account/cache reads and disable background refreshes.
    # The real statusline still reads stdin and writes its context cache normally.
    $env:TEMP = $fixtureRoot
    $env:TMP = $fixtureRoot
    $preload = Join-Path $fixtureRoot 'isolate.cjs'
    @'
const os = require('os');
os.homedir = () => __dirname;
require('child_process').spawn = () => ({ unref() {} });
'@ | Set-Content -LiteralPath $preload -Encoding ASCII
    $sessionId = 't1-selftest-' + [guid]::NewGuid().ToString('N')
    $sample = @{ session_id = $sessionId; model = @{ display_name = 'Claude Selftest' }; context_window = @{ used_percentage = 92 }; cwd = $fixtureRoot }
    $rendered = @($sample | ConvertTo-Json -Compress | & node --require $preload $statusline)
    Assert-True ($LASTEXITCODE -eq 0) 'statusline exit 0'
    Assert-True ($rendered.Count -eq 4) 'statusline renders four lines'
    $cacheDir = Join-Path $env:TEMP 'ultrathink-status'
    $cacheFile = Join-Path $cacheDir ("ctx-$sessionId.json")
    Assert-True (Test-Path -LiteralPath $cacheFile) 'statusline creates session cache'
    $cache = Get-Content -Raw -LiteralPath $cacheFile | ConvertFrom-Json
    Assert-True ($cache.pct -eq $sample.context_window.used_percentage) 'cached pct matches stdin'
    Assert-True ($cache.model -ceq 'Selftest') 'cached model matches display name'
    Assert-True ([Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $cache.ts) -lt 10) 'cached timestamp is current epoch seconds'
    $env:ULTRATHINK_CTX_OVERRIDE = $null
    Assert-Hook 'computed cache path' $cases[6].Expected ('{"session_id":"' + $sessionId + '","prompt":"x"}')
    $sample.session_id = ''
    $null = $sample | ConvertTo-Json -Compress | & node --require $preload $statusline
    Assert-True ($LASTEXITCODE -eq 0) 'empty session statusline exit 0'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $cacheDir 'ctx-.json'))) 'empty session creates no cache'
    [Console]::Out.WriteLine("PASS: all assertions; slowest hook including PowerShell startup ${maxHookMs} ms")
}
finally {
    $env:ULTRATHINK_CTX_OVERRIDE = $savedOverride
    $env:TEMP = $savedTemp
    $env:TMP = $savedTmp
    # Delete only this run's uniquely named fixture directory, after checking it.
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $expectedParent = [IO.Path]::GetFullPath($savedTemp).TrimEnd('\')
    if ((Split-Path -Parent $resolved) -ne $expectedParent -or (Split-Path -Leaf $resolved) -notlike 'context-guard-selftest-*') {
        throw "Unsafe fixture cleanup path: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
