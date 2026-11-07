# PostToolUse hook: report console.log statements after Edit or Write without blocking.

try {
    $rawInput = [Console]::In.ReadToEnd()
    $hookInput = $rawInput | ConvertFrom-Json

    if ($hookInput.tool_name -notin @('Edit', 'Write')) {
        exit 0
    }

    $filePath = [string]$hookInput.tool_input.file_path
    if ([string]::IsNullOrWhiteSpace($filePath) -or $filePath -notmatch '(?i)\.(ts|tsx|js|jsx)$') {
        exit 0
    }

    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        exit 0
    }

    $lineNumbers = @(Select-String -LiteralPath $filePath -Pattern 'console\.log' -AllMatches |
        Select-Object -ExpandProperty LineNumber)

    if ($lineNumbers.Count -gt 0) {
        $warning = 'WARN: console.log at {0}:{1} - remove before commit' -f `
            $filePath, ($lineNumbers -join ',')
        [Console]::Out.WriteLine($warning)
    }
}
catch {
    # Report-only hook: malformed input or file access failures never block.
}

exit 0
