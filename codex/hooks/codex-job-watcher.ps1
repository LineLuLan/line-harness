# OPTIONAL - the Claude Code harness already notifies on background task completion; install only if you want an audible beep.
# Launcher mode starts one hidden daemon. Daemon mode watches terminal Codex job states.

param(
    [switch]$Daemon
)

$disableFile = Join-Path $env:USERPROFILE '.ultrathink\codex-beep-disabled'
if (Test-Path -LiteralPath $disableFile) {
    exit 0
}

$stateDirectory = Join-Path $env:USERPROFILE '.claude\state'
$pidFile = Join-Path $stateDirectory 'codex-job-watcher.pid'
$stampFile = Join-Path $stateDirectory 'codex-job-watcher.stamp'
$codexState = Join-Path $env:USERPROFILE '.claude\plugins\data\codex-openai-codex\state'
$pollIntervalSeconds = 5

if (-not (Test-Path -LiteralPath $stateDirectory)) {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
}

if ($Daemon) {
    try {
        [System.IO.File]::WriteAllText($pidFile, [string]$PID)
        if (-not (Test-Path -LiteralPath $stampFile)) {
            [System.IO.File]::WriteAllText($stampFile, '')
        }

        while (-not (Test-Path -LiteralPath $disableFile)) {
            $stampTime = (Get-Item -LiteralPath $stampFile).LastWriteTimeUtc
            $shouldBeep = $false

            if (Test-Path -LiteralPath $codexState) {
                $jobPattern = Join-Path $codexState '*\jobs\*.json'
                $newJobFiles = Get-ChildItem -Path $jobPattern -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.LastWriteTimeUtc -gt $stampTime }

                foreach ($jobFile in $newJobFiles) {
                    try {
                        $job = Get-Content -Raw -LiteralPath $jobFile.FullName | ConvertFrom-Json
                        if ($job.status -in @('completed', 'failed', 'cancelled')) {
                            $shouldBeep = $true
                            break
                        }
                    }
                    catch {
                        continue
                    }
                }
            }

            if ($shouldBeep) {
                [System.Media.SystemSounds]::Asterisk.Play()
            }

            [System.IO.File]::WriteAllText($stampFile, '')
            Start-Sleep -Seconds $pollIntervalSeconds
        }
    }
    finally {
        if (Test-Path -LiteralPath $pidFile) {
            $recordedPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($recordedPid -eq [string]$PID) {
                Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
            }
        }
    }

    exit 0
}

if (Test-Path -LiteralPath $pidFile) {
    $existingPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingPid -match '^\d+$') {
        $existingProcess = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
        if ($null -ne $existingProcess) {
            exit 0
        }
    }
}

$daemonArguments = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    ('"{0}"' -f $PSCommandPath),
    '-Daemon'
)
$daemonProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $daemonArguments -WindowStyle Hidden -PassThru
[System.IO.File]::WriteAllText($pidFile, [string]$daemonProcess.Id)
exit 0
