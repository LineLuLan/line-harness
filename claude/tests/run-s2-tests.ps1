param([switch]$Utf8Console)
$ErrorActionPreference = 'Stop'
if ($Utf8Console) {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [Console]::InputEncoding = [Text.Encoding]::UTF8
}
Write-Output "Console input=$([Console]::InputEncoding.WebName) output=$([Console]::OutputEncoding.WebName)"
# Intent: retire the packet hook test; dispatcher lint owns packet checks. Status: runner updated.
# Next: supervisor host sweep. Blockers: none. Confidence: retained suites unchanged.
foreach ($suite in @(
    'hook-input.test.ps1', 'shell-guards.test.ps1', 'edit-budget.test.ps1',
    '../bin/tests/bash-heredoc-guard.test.ps1'
)) {
    Write-Output "Running $suite"
    $LASTEXITCODE = 0
    & (Join-Path $PSScriptRoot $suite)
    if ($LASTEXITCODE -ne 0) { throw "$suite exited $LASTEXITCODE" }
}
& node --test --test-concurrency=1 (Join-Path $PSScriptRoot 'statusline-pace.test.js') (Join-Path $PSScriptRoot '../bin/tests/statusline-codexhome.test.js') (Join-Path $PSScriptRoot '../bin/tests/statusline-runs.test.js')
if ($LASTEXITCODE -ne 0) { throw "Node tests exited $LASTEXITCODE" }
Write-Output 'S2 suites passed'
