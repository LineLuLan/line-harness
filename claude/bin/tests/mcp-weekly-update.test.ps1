# Intent: prove Line's weekly MCP updates, rollback and secret-safe logs using fake tools only.
# Status: fixture coverage. Next: supervisor performs the desktop toast smoke test.
# Blockers: WinRT toast needs a desktop. Confidence: byte comparisons and fake process contracts.
$ErrorActionPreference = 'Stop'
$updater = Join-Path $PSScriptRoot '..\mcp-weekly-update.ps1'
$fixture = Join-Path ([IO.Path]::GetFullPath($env:TEMP)) ('mcp weekly fixture-' +[guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$saved = @{}
foreach ($name in @('MCP_WEEKLY_NOTIFY', 'MW_CASE', 'MW_ROOT')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$cases = 0
function Assert-True($Condition, $Message) { if (-not $Condition) { throw "FAIL: $Message" } }
function Write-Text($Path, $Text) { [IO.File]::WriteAllText($Path, $Text, $utf8) }
function Test-Update($Name, $Mode, [switch]$DryRun, [switch]$Crlf, [switch]$Retention) {
    $caseRoot = Join-Path $fixture $Name
    [void][IO.Directory]::CreateDirectory($caseRoot)
    $config = Join-Path $caseRoot 'config.toml'
    $log = Join-Path $caseRoot 'logs\weekly.log'
    $text = @'
# Preserve Unicode and every byte outside the MCP package tokens.
outside = "@upstash/context7-mcp@3.2.5"
[mcp_servers.context7]
args = [
    "@upstash/context7-mcp@3.2.5",
]
[mcp_servers.codegraph]
args = ["@colbymchenry/codegraph@1.5.0"]
[mcp_servers.private.env]
token = "SECRET-DO-NOT-LOG"
same_text = "@upstash/context7-mcp@3.2.5"
'@
    $text = $text.Replace("`r`n", "`n") + "`n# " + [char]0x0E44 + [char]0x0E17 + [char]0x0E22 + "`n"
    if ($Crlf) { $text = $text.Replace("`n", "`r`n") }
    Write-Text $config $text
    $before = [Convert]::ToBase64String([IO.File]::ReadAllBytes($config))
    if ($Retention) {
        foreach ($n in 1..6) {
            $path = "$config.bak-mcpweekly-2026100$n-000000"
            Write-Text $path 'old fixture backup'
            [IO.File]::SetLastWriteTimeUtc($path, [DateTime]::UtcNow.AddDays(-7 + $n))
        }
        Write-Text "$config.bak-unrelated" 'keep'
        Write-Text "$config.bak-mcpweekly-other.txt" 'keep'
    }
    $env:MW_CASE = $Mode
    $env:MW_ROOT = $caseRoot
    $arguments = @('-ConfigPath', $config, '-LogPath', $log, '-NpmBin', (Join-Path $fixture 'npm.cmd'),
        '-CodexBin', (Join-Path $fixture 'codex.cmd'), '-CodegraphBin', (Join-Path $fixture 'codegraph.cmd'))
    if ($DryRun) { $arguments += '-DryRun' }
    $output = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $updater @arguments 2>&1)
    Assert-True ($LASTEXITCODE -eq 0) "$Name exit code"
    $logText = [IO.File]::ReadAllText($log)
    Assert-True (($output -join "`n") -notmatch 'SECRET-DO-NOT-LOG' -and $logText -notmatch 'SECRET-DO-NOT-LOG') "$Name never exposes secret"
    $lines = @($logText.TrimEnd() -split "`n")
    Assert-True ($lines.Count -eq $(if ($Mode -eq 'report') { 3 } else { 2 })) "$Name one log per pin plus report"
    foreach ($line in $lines) { Assert-True ($line -match '^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\|[^|]+\|\d+\.\d+\.\d+\|[^|]+\|[^|]+$') "$Name structured UTC log" }
    $after = [Convert]::ToBase64String([IO.File]::ReadAllBytes($config))
    $backups = @(Get-ChildItem -LiteralPath $caseRoot -File | Where-Object { $_.Name -match '^config\.toml\.bak-mcpweekly-\d{8}-\d{6}$' })
    if ($Mode -eq 'newer' -and -not $DryRun) {
        # Only the token in the MCP section may change, including if a secret resembles a pin.
        $expected = $text.Replace(('    "@upstash/context7-mcp@3.2.5",'), ('    "@upstash/context7-mcp@4.3.0",'))
        Assert-True ($after -ceq [Convert]::ToBase64String($utf8.GetBytes($expected))) "$Name exact bytes except intended token"
        Assert-True ($backups.Count -eq 1 -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($backups[0].FullName)) -ceq $before) "$Name exact backup"
        Assert-True ($logText -match '\|@upstash/context7-mcp\|3.2.5\|4.3.0\|updated') "$Name updated log"
        Assert-True (([IO.File]::ReadAllText((Join-Path $caseRoot 'calls.log'))) -match 'codex mcp list --json') "$Name validated inventory"
    } else {
        Assert-True ($after -ceq $before) "$Name config byte identical"
        if ($DryRun) { $status = 'dry-run' }
        elseif ($Mode -in @('garbage', 'view-fails', 'timeout')) { $status = 'failed:npm-view' }
        elseif ($Mode -eq 'cache-fails') { $status = 'failed:cache-add' }
        elseif ($Mode -in @('validate-fails', 'invalid-json', 'missing-server')) { $status = 'failed:validate' }
        else { $status = 'current' }
        Assert-True ($logText -match ('\|' + [regex]::Escape($status) + '(\r?\n|$)')) "$Name log $status"
        if ($Mode -notin @('validate-fails', 'invalid-json', 'missing-server') -and -not $Retention) {
            Assert-True ($backups.Count -eq 0) "$Name no backup"
        }
    }
    if ($Retention) {
        Assert-True ($backups.Count -eq 4 -and -not (Test-Path -LiteralPath "$config.bak-mcpweekly-20261001-000000") -and
            -not (Test-Path -LiteralPath "$config.bak-mcpweekly-20261002-000000")) 'retains newest four backups'
        Assert-True ((Test-Path -LiteralPath "$config.bak-unrelated") -and (Test-Path -LiteralPath "$config.bak-mcpweekly-other.txt")) 'retention leaves unrelated files'
    }
    if ($Mode -eq 'report') {
        Assert-True ($logText -match '\|codegraph\|1.4.0\|1.5.0\|report:codegraph 1.4.0 -> 1.5.0 \(run codegraph upgrade with no Claude session open\)') 'global codegraph report'
    }
    if ($Crlf) { Assert-True ([IO.File]::ReadAllText($config) -notmatch '(?<!\r)\n') 'CRLF preserved' }
    if ($Mode -eq 'timeout') {
        $identity = [IO.File]::ReadAllText((Join-Path $caseRoot 'hanging-child.txt')).Split('|')
        $survivor = Get-Process -Id ([int]$identity[0]) -ErrorAction SilentlyContinue
        $alive = $false
        if ($null -ne $survivor) {
            try {
                $alive = $survivor.StartTime.ToUniversalTime().Ticks -eq [long]$identity[1] -and -not $survivor.HasExited
                # Clean up only this fixture's exact process if the regression returns.
                if ($alive) { $survivor.Kill() }
            } finally { $survivor.Dispose() }
        }
        Assert-True (-not $alive) 'timeout terminates the CLI child, not just its launcher'
    }
    $script:cases++
}
try {
    [void][IO.Directory]::CreateDirectory($fixture)
    $env:MCP_WEEKLY_NOTIFY = '0'
    foreach ($tool in @('npm', 'codex', 'codegraph')) {
        Write-Text (Join-Path $fixture "$tool.cmd") ("@echo off`r`n`"$PSHOME\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"%~dp0fake.ps1`" $tool %*`r`nexit /b %errorlevel%`r`n")
    }
    Write-Text (Join-Path $fixture 'fake.ps1') @'
param([string]$Tool, [Parameter(ValueFromRemainingArguments = $true)][string[]]$ToolArgs)
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::AppendAllText((Join-Path $env:MW_ROOT 'calls.log'), ($Tool + ' ' + ($ToolArgs -join ' ') + "`n"), $utf8)
if ($Tool -eq 'codex') {
    if (($ToolArgs -join ' ') -ne 'mcp list --json') { exit 9 }
    if ($env:MW_CASE -eq 'validate-fails') { exit 1 }
    if ($env:MW_CASE -eq 'invalid-json') { Write-Output '{broken'; exit 0 }
    if ($env:MW_CASE -eq 'missing-server') { Write-Output '[{"name":"codegraph"}]'; exit 0 }
    Write-Output '[{"name":"context7"},{"name":"codegraph"}]'; exit 0
}
if ($Tool -eq 'codegraph') {
    if (($ToolArgs -join ' ') -ne '--version') { exit 9 }
    if ($env:MW_CASE -eq 'report') { Write-Output '1.4.0' } else { Write-Output '1.6.2' }
    exit 0
}
if ($Tool -ne 'npm') { exit 9 }
if ($ToolArgs[0] -eq 'cache' -and $ToolArgs[1] -eq 'add') {
    if ($env:MW_CASE -eq 'cache-fails') { exit 1 }; exit 0
}
if ($ToolArgs[0] -ne 'view' -or $ToolArgs[2] -ne 'version') { exit 9 }
if ($ToolArgs[1] -eq '@colbymchenry/codegraph') {
    Write-Output '1.5.0'; exit 0
}
if ($env:MW_CASE -eq 'timeout') {
    [IO.File]::WriteAllText((Join-Path $env:MW_ROOT 'hanging-child.txt'), ($PID.ToString() + '|' + (Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks), $utf8)
    Start-Sleep -Seconds 120
    Write-Output '4.3.0'; exit 0
}
if ($env:MW_CASE -eq 'garbage') { Write-Output 'not-a-version'; exit 0 }
if ($env:MW_CASE -eq 'view-fails') { Write-Output '4.3.0'; exit 1 }
if ($env:MW_CASE -in @('current', 'report')) { Write-Output '3.2.5' } else { Write-Output '4.3.0' }
exit 0
'@
    Test-Update 'current' 'current'
    Test-Update 'newer' 'newer'
    Test-Update 'dry-run' 'newer' -DryRun
    Test-Update 'garbage' 'garbage'
    Test-Update 'view-fails' 'view-fails'
    Test-Update 'cache-fails' 'cache-fails'
    Test-Update 'validate-fails' 'validate-fails'
    Test-Update 'invalid-json' 'invalid-json'
    Test-Update 'missing-server' 'missing-server'
    Test-Update 'retention' 'current' -Retention
    Test-Update 'codegraph-report' 'report'
    Test-Update 'crlf' 'newer' -Crlf
    Test-Update 'timeout' 'timeout'
    $missingOutput = @(& powershell -NoProfile -ExecutionPolicy Bypass -File $updater -ConfigPath (Join-Path $fixture 'missing.toml') 2>&1)
    Assert-True ($LASTEXITCODE -eq 2 -and $missingOutput.Count -eq 0) 'missing config exits 2 silently'
    Write-Output "mcp weekly update: $cases cases plus missing config passed"
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $resolved = [IO.Path]::GetFullPath($fixture)
    if ((Split-Path -Parent $resolved) -ne [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') -or
        (Split-Path -Leaf $resolved) -notlike 'mcp weekly fixture-*') { throw 'Unsafe fixture cleanup path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
