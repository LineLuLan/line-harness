. (Join-Path $PSScriptRoot 'hook-test-lib.ps1')
$hooks = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\hooks'))
$combined = Join-Path $hooks 'shell-guards.ps1'
if (-not (Test-Path -LiteralPath $combined)) { throw 'shell-guards.ps1 is missing' }
$temp = New-TestFolder
$cases = @(
    @{ Name = 'plain PowerShell'; Command = 'Write-Host hello' },
    @{ Name = 'plain Windows payload'; Raw = '{"tool_name":"PowerShell","cwd":"D:\\repo","tool_input":{"command":"Write-Host hello"}}' },
    @{ Name = 'plain Bash'; Command = 'ls -la'; Tool = 'Bash' },
    @{ Name = 'push denied'; Command = 'git push origin main'; Deny = $true },
    @{ Name = 'push approved'; Command = 'git push origin main'; Flag = $true },
    @{ Name = 'Bash push denied'; Command = 'git push origin main'; Tool = 'Bash'; Deny = $true },
    @{ Name = 'Bash push approved'; Command = 'git push origin main'; Tool = 'Bash'; Flag = $true },
    @{ Name = 'git options'; Command = 'git -C repo --no-pager push origin main'; Deny = $true },
    @{ Name = 'Bash chain'; Command = 'echo ok && git -C repo push'; Tool = 'Bash'; Deny = $true },
    @{ Name = 'PowerShell quoted push'; Command = '& git "push"'; Deny = $true },
    @{ Name = 'PowerShell escaped push'; Command = 'git p`u`sh'; Deny = $true },
    @{ Name = 'push text'; Command = 'Write-Host "git push origin main"' },
    @{ Name = 'Bash quoted push text'; Command = 'echo "git push origin main"'; Tool = 'Bash' },
    @{ Name = 'Bash push comment'; Command = '# git push origin main'; Tool = 'Bash' },
    @{ Name = 'openrouter denied'; Command = 'curl https://openrouter.ai -d openai/gpt-6-astra'; Deny = $true },
    @{ Name = 'openrouter override'; Command = 'OPENROUTER_GUARD_OVERRIDE=1 curl https://openrouter.ai -d openai/gpt-6-astra' },
    @{ Name = 'openrouter allowed model'; Command = 'curl https://openrouter.ai -d openai/gpt-6-luna' },
    @{ Name = 'openrouter read'; Command = 'curl https://openrouter.ai/api/v1/models' },
    @{ Name = 'judge trigger without openrouter'; Command = 'node label-judges.mjs'; Deny = $true },
    @{ Name = 'judge dry run'; Command = 'node label-judges.mjs --dry-run' },
    @{ Name = 'panel trigger without openrouter'; Command = 'powershell -File run-panel.ps1'; Deny = $true },
    @{ Name = 'heredoc Bash'; Command = "cat <<'EOF'`nhello`nEOF"; Tool = 'Bash'; Deny = $true },
    @{ Name = 'heredoc PowerShell'; Command = "Write-Host '<<EOF'" },
    @{ Name = 'Bash here string'; Command = 'cat <<< hello'; Tool = 'Bash' },
    @{ Name = 'commit heredoc exemption'; Command = 'git commit -m "$(cat <<EOF)"'; Tool = 'Bash' },
    @{ Name = 'push before other denials'; Command = 'git push; node run-panel.ps1'; Deny = $true },
    @{ Name = 'approved push then denied panel'; Command = 'git push; node run-panel.ps1'; Flag = $true; Deny = $true },
    @{ Name = 'panel before heredoc'; Command = 'run-panel.ps1 <<EOF'; Tool = 'Bash'; Deny = $true },
    @{ Name = 'dispatcher mention'; Command = 'Write-Host codex-do.ps1' },
    @{ Name = 'malformed plain'; Raw = '{invalid' },
    @{ Name = 'malformed trigger'; Raw = '{invalid push openrouter <<' },
    @{ Name = 'escaped push'; Raw = '{"tool_name":"PowerShell","tool_input":{"command":"git p\u0075sh"}}'; Deny = $true },
    @{ Name = 'escaped heredoc'; Raw = '{"tool_name":"Bash","tool_input":{"command":"cat \u003c\u003cEOF"}}'; Deny = $true },
    @{ Name = 'other tool'; Command = 'git push'; Tool = 'Read' },
    @{ Name = 'missing command'; Raw = '{"tool_name":"Bash","tool_input":{}}' }
)
foreach ($command in @('git pu"s"h', "git pu''sh", 'g"i"t pu"s"h')) {
    $cases += @{ Name = "split token denied: $command"; Command = $command; Deny = $true }
    $cases += @{ Name = "split token approved: $command"; Command = $command; Flag = $true }
}
$cases += @(
    @{ Name = 'split OpenRouter raw match unchanged'; Command = 'curl https://open"router".ai -d openai/gpt-6-astra' },
    @{ Name = 'split heredoc raw match unchanged'; Command = 'cat <""<EOF'; Tool = 'Bash' }
)
try {
    $index = 0
    foreach ($case in $cases) {
        $index++
        $tool = 'PowerShell'
        if ($case.Tool) { $tool = $case.Tool }
        $payload = if ($case.ContainsKey('Raw')) { $case.Raw } else { New-ShellPayload $case.Command $tool }
        $results = @()
        $flags = @()
        foreach ($variant in @('old', 'new')) {
            $profile = Join-Path $temp "$index-$variant"
            $state = Join-Path $profile '.claude\state'
            [void][IO.Directory]::CreateDirectory($state)
            $flag = Join-Path $state 'allow-push-once'
            if ($case.Flag) { [IO.File]::WriteAllText($flag, '') }
            $scripts = @('shell-guards.ps1')
            if ($variant -eq 'old') {
                $scripts = @('git-push-guard.ps1', 'openrouter-model-guard.ps1')
                if ($tool -eq 'Bash' -or $case.Raw) { $scripts += 'bash-heredoc-guard.ps1' }
            }
            foreach ($script in $scripts) {
                $result = Invoke-TestHook (Join-Path $hooks $script) $payload $profile
                # Existing malformed JSON can emit stderr; its allow/deny contract is unchanged.
                if ((Get-HookDecision $result) -ne 'allow|' -or $result.ExitCode -ne 0) { break }
            }
            $results += $result
            $flags += [IO.File]::Exists($flag)
            if ($case.Flag) { Assert-True (-not (Test-Path -LiteralPath $flag)) "$($case.Name): $variant consumes flag" }
        }
        Assert-True ($flags[0] -eq $flags[1]) "$($case.Name): identical flag consumption"
        Assert-True ($results[0].ExitCode -eq $results[1].ExitCode -and
            (Get-HookDecision $results[0]) -ceq (Get-HookDecision $results[1])) "$($case.Name): identical exit, decision, reason"
        Assert-True (((Get-HookDecision $results[1]) -like 'deny|*') -eq [bool]$case.Deny) "$($case.Name): expected decision"
        Assert-True ($results[1].ExitCode -eq 0) "$($case.Name): hook exits zero"
    }
    # One-use approval, including a failure to claim a locked flag, stays fail-closed.
    $profile = Join-Path $temp 'one-use'
    $state = Join-Path $profile '.claude\state'
    [void][IO.Directory]::CreateDirectory($state)
    $flag = Join-Path $state 'allow-push-once'
    [IO.File]::WriteAllText($flag, '')
    $payload = New-ShellPayload 'git push'
    Assert-True ((Get-HookDecision (Invoke-TestHook $combined $payload $profile)) -eq 'allow|') 'first push consumes approval'
    Assert-True ((Get-HookDecision (Invoke-TestHook $combined $payload $profile)) -like 'deny|*') 'second push denied'
    [IO.File]::WriteAllText($flag, '')
    $lock = [IO.File]::Open($flag, 'Open', 'ReadWrite', 'None')
    try {
        $old = Invoke-TestHook (Join-Path $hooks 'git-push-guard.ps1') $payload $profile
        $new = Invoke-TestHook $combined $payload $profile
        Assert-True ((Get-HookDecision $old) -ceq (Get-HookDecision $new) -and (Get-HookDecision $new) -like 'deny|*') 'locked approval fails closed identically'
    } finally { $lock.Dispose() }
    # A poisoned sibling guard proves plain commands exit before calling any guard.
    $fastDir = Join-Path $temp 'fast-path'
    [void][IO.Directory]::CreateDirectory($fastDir)
    [IO.File]::Copy($combined, (Join-Path $fastDir 'shell-guards.ps1'))
    [IO.File]::WriteAllText((Join-Path $fastDir 'git-push-guard.ps1'), '[Console]::Out.WriteLine("unexpected guard call")')
    $plain = Invoke-TestHook (Join-Path $fastDir 'shell-guards.ps1') (New-ShellPayload 'ls -la' 'Bash') $temp
    Assert-True ($plain.ExitCode -eq 0 -and -not $plain.Output -and -not $plain.Error) 'plain Bash command takes fast path'
} finally { Remove-TestFolder $temp }
Complete-Tests
