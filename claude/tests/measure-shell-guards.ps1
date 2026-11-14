. (Join-Path $PSScriptRoot 'hook-test-lib.ps1')
$hooks = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\hooks'))
$temp = New-TestFolder
function Get-Median($Values) {
    $sorted = @($Values | Sort-Object)
    return ($sorted[4] + $sorted[5]) / 2
}
try {
    $empty = Join-Path $temp 'empty.ps1'
    [IO.File]::WriteAllText($empty, '')
    $payload = New-ShellPayload 'echo hello' 'Bash'
    $samples = @{ combined = @(); separate = @(); baseline = @() }
    for ($i = 0; $i -lt 10; $i++) {
        foreach ($variant in @('baseline', 'combined', 'separate')) {
            $scripts = switch ($variant) {
                'baseline' { $empty }
                'combined' { Join-Path $hooks 'shell-guards.ps1' }
                'separate' { foreach ($name in @('git-push-guard.ps1', 'openrouter-model-guard.ps1', 'bash-heredoc-guard.ps1')) { Join-Path $hooks $name } }
            }
            $ms = 0
            foreach ($script in $scripts) {
                $result = Invoke-TestHook $script $payload $temp
                if ($result.ExitCode -ne 0 -or $result.Output -or $result.Error) { throw "Timing run failed: $script $($result.Error)" }
                $ms += $result.Milliseconds
            }
            $samples[$variant] += $ms
        }
    }
    foreach ($variant in @('combined', 'separate', 'baseline')) {
        '{0}: median of 10 = {1:N1} ms' -f $variant, (Get-Median $samples[$variant])
    }
} finally { Remove-TestFolder $temp }
