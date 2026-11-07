# SessionStart hook: suggest CodeGraph indexing for large, unindexed Git repositories.

try {
    $codegraphCommand = Get-Command -Name 'codegraph' -CommandType Application, ExternalScript -ErrorAction SilentlyContinue
    if ($null -eq $codegraphCommand) {
        exit 0
    }

    $isInsideWorkTree = @(& git rev-parse --is-inside-work-tree 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or $isInsideWorkTree -ne 'true') {
        exit 0
    }

    $repositoryRoot = @(& git rev-parse --show-toplevel 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repositoryRoot)) {
        exit 0
    }

    $codegraphDirectory = Join-Path $repositoryRoot '.codegraph'
    if (Test-Path -LiteralPath $codegraphDirectory -PathType Container) {
        exit 0
    }

    $codeFileCount = @(& git ls-files -- *.ts *.tsx *.js *.jsx *.py *.go *.rs *.java 2>$null).Count
    if ($LASTEXITCODE -ne 0) {
        exit 0
    }

    if ($codeFileCount -ge 100) {
        [Console]::Out.WriteLine("[CODEGRAPH] This repository is not indexed ($codeFileCount code files). One-time index: run 'codegraph init' to enable graph navigation. Verify risky details with rg after refactors - the index can go stale.")
    }
}
catch {
    # Fail open: SessionStart hooks must never block the harness.
}

exit 0

