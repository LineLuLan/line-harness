# PostToolUse hook: report TypeScript errors after Edit or Write without blocking.

try {
    $rawInput = [Console]::In.ReadToEnd()
    $hookInput = $rawInput | ConvertFrom-Json

    if ($hookInput.tool_name -notin @('Edit', 'Write')) {
        exit 0
    }

    $filePath = [string]$hookInput.tool_input.file_path
    if ([string]::IsNullOrWhiteSpace($filePath) -or $filePath -notmatch '(?i)\.tsx?$') {
        exit 0
    }

    $resolvedFilePath = [System.IO.Path]::GetFullPath($filePath)
    $searchDirectory = [System.IO.Path]::GetDirectoryName($resolvedFilePath)
    $tsconfigPath = $null

    while (-not [string]::IsNullOrWhiteSpace($searchDirectory)) {
        $candidate = Join-Path $searchDirectory 'tsconfig.json'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $tsconfigPath = $candidate
            break
        }

        $parentDirectory = [System.IO.Directory]::GetParent($searchDirectory)
        if ($null -eq $parentDirectory) {
            break
        }

        $searchDirectory = $parentDirectory.FullName
    }

    if ($null -eq $tsconfigPath) {
        exit 0
    }

    $npxCommand = Get-Command -Name 'npx.cmd', 'npx' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $npxCommand) {
        exit 0
    }

    $projectDirectory = Split-Path -Parent $tsconfigPath
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()

    try {
        $process = Start-Process -FilePath $npxCommand.Source `
            -ArgumentList @('tsc', '--noEmit', '--pretty', 'false', '--project', 'tsconfig.json') `
            -WorkingDirectory $projectDirectory `
            -NoNewWindow `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        if (-not $process.WaitForExit(20000)) {
            try {
                $process.Kill()
            }
            catch {
                # Report-only hook: a failed cleanup must not block the tool call.
            }

            [Console]::Out.WriteLine('typecheck skipped (timeout)')
            exit 0
        }

        if ($process.ExitCode -ne 0) {
            $outputLines = @(
                @(Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue)
                @(Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue)
            ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
                Select-Object -Last 15

            foreach ($line in $outputLines) {
                [Console]::Out.WriteLine([string]$line)
            }
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}
catch {
    # Report-only hook: malformed input or execution failures never block.
}

exit 0
