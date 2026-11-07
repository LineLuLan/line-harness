# PreToolUse hook: deny git push unless Line has created a one-use approval flag.

function Get-BashCommandSkeleton {
    param([string]$Command)

    $builder = New-Object System.Text.StringBuilder
    $quote = [char]0
    $inComment = $false
    $escaped = $false

    for ($index = 0; $index -lt $Command.Length; $index++) {
        $character = $Command[$index]

        if ($inComment) {
            if ($character -eq "`n" -or $character -eq "`r") {
                $inComment = $false
                [void]$builder.Append($character)
            }
            else {
                [void]$builder.Append(' ')
            }
            continue
        }

        if ($quote -ne [char]0) {
            if ($quote -eq '"' -and $escaped) {
                $escaped = $false
                continue
            }
            if ($quote -eq '"' -and $character -eq '\') {
                $escaped = $true
                continue
            }
            if ($character -eq $quote) {
                $quote = [char]0
            }
            continue
        }

        if ($escaped) {
            [void]$builder.Append('Q')
            $escaped = $false
            continue
        }
        if ($character -eq '\') {
            $escaped = $true
            continue
        }
        if ($character -eq '"' -or $character -eq "'") {
            $quote = $character
            [void]$builder.Append('Q')
            continue
        }
        if ($character -eq '#' -and
            ($index -eq 0 -or
                [char]::IsWhiteSpace($Command[$index - 1]) -or
                ';|&()<>'.Contains([string]$Command[$index - 1]))) {
            $inComment = $true
            [void]$builder.Append(' ')
            continue
        }

        [void]$builder.Append($character)
    }

    return $builder.ToString()
}

function Test-GitPushCommand {
    param(
        [string]$Command,
        [string]$ToolName
    )

    if ($ToolName -eq 'Bash') {
        $bashCommandSkeleton = Get-BashCommandSkeleton -Command $Command
        $bashBoundaryPattern = '(?im)(?:^|&&\s*|\|\|\s*|[;|]\s*)' +
            '(?:command\s+)?git(?:\.exe|\.cmd)?\s+' +
            '(?:(?:(?:-C|-c|--exec-path|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)\s+\S+|' +
            '--(?:exec-path|git-dir|work-tree|namespace|super-prefix|config-env)=\S+|' +
            '-p|-P|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|' +
            '--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks)\s+)*' +
            'push(?=\s|$|[;&|])'
        return $bashCommandSkeleton -match $bashBoundaryPattern
    }

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(
        $Command,
        [ref]$tokens,
        [ref]$parseErrors
    )
    $commandAsts = @($ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst]
    }, $true))

    $globalFlags = @(
        '-p', '-P', '--paginate', '--no-pager', '--bare', '--no-replace-objects',
        '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
        '--icase-pathspecs', '--no-optional-locks'
    )
    $globalOptionsWithValues = @(
        '-C', '-c', '--exec-path', '--git-dir', '--work-tree', '--namespace',
        '--super-prefix', '--config-env'
    )

    foreach ($commandAst in $commandAsts) {
        $elements = @($commandAst.CommandElements | ForEach-Object {
            if ($_ -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
                $_.Value
            }
            elseif ($_ -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
                $_.NestedExpressions.Count -eq 0) {
                $_.Value
            }
            elseif ($_ -is [System.Management.Automation.Language.CommandParameterAst]) {
                '-' + $_.ParameterName
            }
            else {
                $null
            }
        })

        if ($elements.Count -lt 2 -or $elements[0] -notmatch '(?i)^git(?:\.exe|\.cmd)?$') {
            continue
        }

        $index = 1
        while ($index -lt $elements.Count) {
            $argument = [string]$elements[$index]
            if ([string]::IsNullOrWhiteSpace($argument)) {
                break
            }

            if ($globalFlags -contains $argument) {
                $index++
                continue
            }

            if ($globalOptionsWithValues -contains $argument) {
                $index += 2
                continue
            }

            if ($argument -match '(?i)^--(?:exec-path|git-dir|work-tree|namespace|super-prefix|config-env)=') {
                $index++
                continue
            }

            if ($argument -ieq 'push') {
                return $true
            }

            break
        }
    }

    return $false
}

$isPushCommand = $false
$denyJson = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Line''s rule: no push without an explicit order. Line creates the flag file allow-push-once to approve exactly one push."}}'

try {
    $rawInput = [Console]::In.ReadToEnd()
    $hookInput = $rawInput | ConvertFrom-Json

    if ($hookInput.tool_name -notin @('Bash', 'PowerShell')) {
        exit 0
    }

    $command = [string]$hookInput.tool_input.command
    if ([string]::IsNullOrWhiteSpace($command) -or
        -not (Test-GitPushCommand -Command $command -ToolName $hookInput.tool_name)) {
        exit 0
    }

    $isPushCommand = $true
    $flagPath = Join-Path $env:USERPROFILE '.claude\state\allow-push-once'
    $claimPath = '{0}.claimed-{1}-{2}' -f $flagPath, $PID, ([guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $flagPath -Destination $claimPath -ErrorAction Stop
    Remove-Item -LiteralPath $claimPath -Force -ErrorAction SilentlyContinue
    exit 0

}
catch {
    if ($isPushCommand) {
        # Fail closed for a matching push whenever the hook cannot verify approval.
        [Console]::Out.WriteLine($denyJson)
    }
}

exit 0
