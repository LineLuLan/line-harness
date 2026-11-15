param(
    [switch]$Utf8Console,
    [string]$Only
)
$ErrorActionPreference = 'Stop'
if ($Utf8Console) {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [Console]::InputEncoding = [Text.Encoding]::UTF8
}

# Intent: run every harness test by filename. Status: dynamic runner. Next: supervisor host sweep. Blockers: none. Confidence: validated locally.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir '../..')).Path
$hubRoot = Join-Path $repoRoot 'hub'
$testDirs = @(
    (Join-Path $repoRoot 'claude/tests'),
    (Join-Path $repoRoot 'claude/bin/tests'),
    (Join-Path $hubRoot 'tests')
)
$files = @(
    foreach ($dir in $testDirs) {
        Get-ChildItem -LiteralPath $dir -File | Where-Object {
            $_.Name -like '*.test.ps1' -or $_.Name -like '*-selftest.ps1' -or $_.Name -like '*.test.js'
        }
    }
)
$files = @($files | Sort-Object FullName | Where-Object {
    $relative = $_.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
    -not $Only -or $relative.IndexOf($Only, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
$failed = 0

function Invoke-QuietExternal {
    param([string]$Command, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    & $Command @Arguments 2>&1 | Out-Null
    return $LASTEXITCODE
}

foreach ($file in @($files | Where-Object { $_.Extension -eq '.ps1' })) {
    $relative = $file.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
    # Intent: select offline tests without executing parameter discovery. Status: fixed. Next: host suite. Blockers: none. Confidence: parser and runner probes.
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    $offlineOnly = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'OfflineOnly' }).Count -gt 0
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $file.FullName)
    $suffix = ''
    if ($offlineOnly) { $arguments += '-OfflineOnly'; $suffix = ' (offline)' }
    $exitCode = Invoke-QuietExternal -Command 'powershell' -Arguments $arguments
    if ($exitCode -eq 0) {
        Write-Output "PASS $relative$suffix"
    } else {
        Write-Output "FAIL $relative (exit $exitCode)$suffix"
        $failed++
    }
}

$nodeGroups = @(
    @{ Label = 'claude Node group'; Directory = $repoRoot; Files = @($files | Where-Object { $_.Extension -eq '.js' -and $_.FullName.StartsWith((Join-Path $repoRoot 'claude') + '\', [StringComparison]::OrdinalIgnoreCase) }) },
    @{ Label = 'hub Node group'; Directory = $hubRoot; Files = @($files | Where-Object { $_.Extension -eq '.js' -and $_.FullName.StartsWith($hubRoot + '\', [StringComparison]::OrdinalIgnoreCase) }) }
)
foreach ($group in $nodeGroups) {
    if ($group.Files.Count -eq 0) { continue }
    Push-Location -LiteralPath $group.Directory
    try {
        $paths = @($group.Files | ForEach-Object { $_.FullName })
        $exitCode = Invoke-QuietExternal -Command 'node' -Arguments (@('--test', '--test-concurrency=1') + $paths)
    } finally {
        Pop-Location
    }
    if ($exitCode -eq 0) {
        Write-Output "PASS $($group.Label) ($($group.Files.Count) files)"
    } else {
        $groupPaths = @($group.Files | ForEach-Object { $_.FullName.Substring($repoRoot.Length + 1).Replace('\', '/') })
        Write-Output "FAIL $($group.Label) (exit $exitCode; $($group.Files.Count) files): $($groupPaths -join ', ')"
        $failed += $group.Files.Count
    }
}

Write-Output "Test files: $($files.Count) run, $failed failed"
if ($failed -gt 0) { exit 1 }
exit 0
