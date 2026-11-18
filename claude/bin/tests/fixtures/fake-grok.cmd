@echo off
rem Intent: deterministic offline Grok lifecycle fixture; K6a: accepts --resume/--fork-session/--rules/--no-subagents, echoes its raw argv to fake-argv.txt (run folder) or FAKE_GROK_ARGV, prints UUID session ids (the resumed id on --resume, a new one with --fork-session) and an end event with usage.total_tokens. K6b: when FAKE_GROK_ANSWER is set, write argv if FAKE_GROK_ARGV is set, type that file and exit FAKE_GROK_EXIT (default 0, set before the answer block) before the default mode. K6b-fix1: FAKE_GROK_ENV receives `set GROK_`. Status: host-only fake. Next: run E2E. Blockers: WMI in sandbox. Confidence: no network or model calls.
set "FAKE_GROK_RAW=%*"
set "FAKE_GROK_CWD="
set "FAKE_GROK_PROMPT="
set "FAKE_GROK_RESUME="
set "FAKE_GROK_FORK="
:parse
if "%~1"=="" goto run
if "%~1"=="--cwd" set "FAKE_GROK_CWD=%~2"
if "%~1"=="--prompt-file" set "FAKE_GROK_PROMPT=%~2"
if "%~1"=="--resume" set "FAKE_GROK_RESUME=%~2"
if "%~1"=="--fork-session" set "FAKE_GROK_FORK=1"
shift
goto parse
:run
if not defined FAKE_GROK_EXIT set "FAKE_GROK_EXIT=0"
if defined FAKE_GROK_ARGV powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText($env:FAKE_GROK_ARGV,[string]$env:FAKE_GROK_RAW,(New-Object Text.UTF8Encoding($false)))"
if defined FAKE_GROK_ENV set GROK_>"%FAKE_GROK_ENV%"
if defined FAKE_GROK_ANSWER (
type "%FAKE_GROK_ANSWER%"
exit /b %FAKE_GROK_EXIT%
)
if not defined FAKE_GROK_CWD exit /b 90
if not defined FAKE_GROK_PROMPT exit /b 91
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $u=New-Object Text.UTF8Encoding($false); $r=Split-Path -Parent $env:FAKE_GROK_PROMPT; $w=$env:FAKE_GROK_CWD; $argvPath=if ($env:FAKE_GROK_ARGV) { $env:FAKE_GROK_ARGV } else { Join-Path $r 'fake-argv.txt' }; [IO.File]::WriteAllText($argvPath,[string]$env:FAKE_GROK_RAW,$u); $id=if ($env:FAKE_GROK_RESUME -and -not $env:FAKE_GROK_FORK) { $env:FAKE_GROK_RESUME } else { [guid]::NewGuid().ToString() }; $t=Join-Path $w 'README.md'; $before=[IO.File]::ReadAllText($t); $record=@{cwd=$PWD.Path; worktree=$w; tracked=$before; notes=[IO.File]::ReadAllText((Join-Path $w 'notes with space.txt')); prompt=[IO.File]::ReadAllText($env:FAKE_GROK_PROMPT); sessionId=$id; resume=[string]$env:FAKE_GROK_RESUME; argv=[string]$env:FAKE_GROK_RAW}; [IO.File]::WriteAllText((Join-Path $r 'fake-started.json'),($record|ConvertTo-Json),$u); Write-Output (@{sessionId=$id} | ConvertTo-Json -Compress); while(-not (Test-Path -LiteralPath (Join-Path $r 'fake-release'))){ Write-Output (@{type='heartbeat'} | ConvertTo-Json -Compress); Start-Sleep -Milliseconds 200 }; [IO.File]::WriteAllText($t,($before + 'fake edit' + [char]10),$u); [IO.File]::WriteAllText((Join-Path $w 'a.txt'),'fake new file',$u); Write-Output (@{type='tool_call';toolName='write'} | ConvertTo-Json -Compress); Write-Output (@{type='text';data='fake '} | ConvertTo-Json -Compress); Write-Output (@{type='text';data='answer'} | ConvertTo-Json -Compress); Write-Output (@{type='end';sessionId=$id;usage=@{total_tokens=1000}} | ConvertTo-Json -Compress)"
exit /b %ERRORLEVEL%
