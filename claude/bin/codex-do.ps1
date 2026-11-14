<#
.SYNOPSIS
  Delegate an implementation / GitHub task to Codex (GPT-6 Sol by default; -Model gpt-6-astra for Standard-B, Important, Critical).

.DESCRIPTION
  Detached by default: WMI launches a wrapper outside Claude Code's background process
  tree. In the 2026-10-09 Windows experiment, both Start-Process variants died when
  Claude stopped the task; Win32_Process.Create survived. Logs and metadata remain
  in CODEX_DO_STATE_DIR\runs (default: ~/.claude/state/runs) for attach and cancel.
  Detached prompts always use stdin and sub-agents are disabled to keep sessions resumable.
  Before exec/resume, a bounded sandbox preflight tries elevated, then unelevated.
  Exit 73 means neither sandbox works; exit 72 means captured output reports a sandbox failure.
  Attached output is not captured. Detached completion plays three sounds and a Windows
  toast from the wrapper itself; CODEX_DO_NOTIFY=0 suppresses both, retaining notify.log.
  Completion invariant: out.log is final once exit.txt is published. Later telemetry
  writes only to its own files, so attach can safely stop reading at exit publication.
  The wrapper forwards PATH and these caller variables when set: HTTPS_PROXY, HTTP_PROXY,
  NO_PROXY, OPENAI_BASE_URL, NODE_OPTIONS, NODE_EXTRA_CA_CERTS, CODEX_ACC_MAIN_HOME,
  CODEX_ACC_ROOT, CODEX_DO_NOTIFY. Other caller variables are not inherited by WMI.

  Thin wrapper around `codex exec`, LEAN MODE: runs with --ignore-user-config so the MCP
  servers in ~/.codex/config.toml never spawn (measured 2026-08-01: 48.7s -> 12.6s for the
  same task - MCP startup was pure waste for delegations, which use shell+repo, not MCP).
  Because config is ignored, model/effort/tier are ALWAYS passed explicitly:
  -m <Model, default gpt-6-sol> -c model_reasoning_effort=high -c service_tier=priority (Fast tier).

  Hybrid policy: Claude pre-fetches context (context7/codegraph/github MCPs run warm on the
  Claude side) and embeds verified facts into the spec. If Codex needs external info
  mid-task, it reports the blocker and Claude re-delegates (~12s/round). For long multi-turn
  collaborative sessions that genuinely need MCP inside Codex, use the `codex` MCP tool
  (full config) instead of this wrapper.

  Used by Claude Code to hand off CODING / IMPLEMENTATION / GITHUB work to Codex while
  Opus 4.8 keeps planning, debugging, and review. See ~/.claude/CLAUDE.md.

.PARAMETER Dir
  Working root Codex operates in. Defaults to the current directory.

.PARAMETER Sandbox
  read-only (analysis), workspace-write (default, edits files), or danger-full-access.

.PARAMETER NoSandboxFallback
  Critical-tier work: require elevated Windows sandbox. CODEX_DO_NO_FALLBACK=1
  has the same effect. An elevated probe failure exits 73 without trying unelevated.

.PARAMETER Fast
  Quick-iteration mode: drop reasoning effort to 'medium' (Line 2026-09-06: medium, not low, for stable output) instead
  of the default high. Use for small mechanical edits; omit for quality work.

.PARAMETER OutFile
  If set, Codex's final message is written to this file (passed through as `-o`).

.PARAMETER Resume
  Continue the SAME packet by session UUID or 'last': answer a STOP RULE blocker or fix
  after a review FAIL. A new packet always starts a fresh session; reviewers are always
  fresh sessions.

.PARAMETER Prompt
  The task instructions for Codex (all trailing args are joined).

.PARAMETER Attached
  Use the original Start-Process -NoNewWindow behavior and argument list. This worker
  remains in the caller's process tree and may die when Claude stops its background task.

.PARAMETER Attach
  Reconnect to a run ID or 'last', replay its log, then wait for its exit. Starts no worker.

.PARAMETER Cancel
  Stop a run ID or 'last' and its descendants by exact PID; record exit 130 if missing.

.PARAMETER Status
  List recent runs with state, elapsed time, and last-output age; starts no worker.
  -Status takes no -Dir or -Account.

.PARAMETER Hours
  Lookback for -Status in hours (default 24).

.PARAMETER AllowSubAgents
  Allow sub-agents in detached mode. Such sessions may not be resumable.

.PARAMETER NoSubAgents
  Disable multi_agent and multi_agent_v2 in Attached mode as well. Cannot be combined
  with AllowSubAgents. Detached mode disables both features by default.

.EXAMPLE
  codex-do.ps1 -Dir D:\01_Workspaces\creditminer -SpecFile .\health-packet.md

.EXAMPLE
  codex-do.ps1 -Sandbox read-only -SpecFile .\review-packet.md
#>
[CmdletBinding()]
param(
  [string]$Dir = (Get-Location).Path,
  [ValidateSet('read-only','workspace-write','danger-full-access')]
  [string]$Sandbox = 'workspace-write',
  [switch]$NoSandboxFallback,
  [switch]$Fast,
  [string]$OutFile,
  [string]$SpecFile,
  [string]$Account = '',
  [string]$Resume = '',
  [switch]$Attached,
  [string]$Attach = '',
  [string]$Cancel = '',
  [switch]$Status,
  [ValidateRange(1, 2147483647)][int]$Hours = 24,
  [switch]$AllowSubAgents,
  [switch]$NoSubAgents,
  [switch]$AllowLarge,
  [switch]$NoRamCheck,
  [ValidateSet('','low','medium','high','xhigh','max','ultra')]
  [string]$Effort = '',            # explicit reasoning effort; wins over -Fast (Line 2026-09-19: Terra ultra for exploration, Astra xhigh for super-hard)
  [string]$Model = 'gpt-6-sol',     # Line 2026-09-28: Sol for Skip + Standard-A; pass -Model gpt-6-astra for Standard-B, Important, Critical; gpt-6-luna for exploration tier 1
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Prompt
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'packet-lint.ps1')
. (Join-Path $PSScriptRoot 'ram-preflight.ps1')

function Get-DispatchPacket {
  param([string]$Text, [switch]$Status, [switch]$Attach, [switch]$Cancel, [switch]$Resume, [switch]$AllowLarge, [switch]$AllowSubAgents)
  $result = [pscustomobject]@{ ExitCode=0; Text=$Text; Errors=@(); Warnings=@() }
  if ($Status -or $Attach -or $Cancel) { return $result }
  if (-not $Resume) {
    $lint = Test-Packet -Text $Text -AllowLarge:$AllowLarge
    $result.Errors = $lint.errors; $result.Warnings = $lint.warnings
    if (-not $lint.ok) { $result.ExitCode = 74; return $result }
  }
  if (-not $AllowSubAgents -and -not [string]::IsNullOrWhiteSpace($Text) -and $Text -notmatch '(?i)Do not spawn sub-agents\.') {
    $result.Text += "`nCONSTRAINTS: Do not spawn sub-agents."
  }
  return $result
}

if ($Status -and @($PSBoundParameters.Keys | Where-Object { $_ -notin @('Status', 'Hours', 'Verbose', 'Debug', 'ErrorAction', 'WarningAction', 'InformationAction', 'ErrorVariable', 'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer', 'PipelineVariable') }).Count -gt 0) {
  Write-Host 'codex-do: usage error: -Status is mutually exclusive with dispatch, -Attach, and -Cancel.'
  exit 64
}
if (($Attach -and $Cancel) -or (($Attach -or $Cancel) -and
    ($PSBoundParameters.ContainsKey('Prompt') -or $PSBoundParameters.ContainsKey('SpecFile') -or
     $PSBoundParameters.ContainsKey('Resume') -or $Attached)) -or ($AllowSubAgents -and $NoSubAgents)) {
  Write-Host 'codex-do: usage error: dispatch, -Attach, and -Cancel are mutually exclusive; choose only one sub-agent policy.'
  exit 64
}
if ($Resume -and $Resume -cne 'last' -and $Resume -notmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') {
  Write-Host "codex-do: -Resume must be 'last' or a session UUID"
  exit 64
}
# Lint before account discovery or sandbox probes: rejected packets start no Codex process.
# -SpecFile keeps multi-line packets out of command-line quoting and leaves the source intact.
$promptText = @($Prompt) -join ' '
$specFullPath = $null; $specSha256 = $null
if ($SpecFile -and -not ($Status -or $Attach -or $Cancel)) {
  if (-not (Test-Path -LiteralPath $SpecFile)) { throw "SpecFile not found: $SpecFile" }
  $specFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SpecFile)
  $specBytes = [IO.File]::ReadAllBytes($specFullPath)
  # run.json records the spec hash so ledger-add.ps1 -SpecFile can link ledger lines to runs.
  $specHasher = [Security.Cryptography.SHA256]::Create()
  try { $specSha256 = -join ($specHasher.ComputeHash($specBytes) | ForEach-Object { $_.ToString('x2') }) } finally { $specHasher.Dispose() }
  $promptText = [IO.File]::ReadAllText($specFullPath, [Text.Encoding]::UTF8)
}
$packet = Get-DispatchPacket -Text $promptText -Status:$Status -Attach:([bool]$Attach) -Cancel:([bool]$Cancel) -Resume:([bool]$Resume) -AllowLarge:$AllowLarge -AllowSubAgents:$AllowSubAgents
foreach ($message in $packet.Warnings) { Write-Warning "codex-do: $message" }
if ($packet.ExitCode) {
  foreach ($message in $packet.Errors) { Write-Host "codex-do: $message" }
  exit $packet.ExitCode
}
$promptText = $packet.Text
. (Join-Path $PSScriptRoot 'codex-acc-lib.ps1')
. (Join-Path $PSScriptRoot 'codex-sandbox-lib.ps1')
$stateDir = if ($env:CODEX_DO_STATE_DIR) { [IO.Path]::GetFullPath($env:CODEX_DO_STATE_DIR) } else { Join-Path $env:USERPROFILE '.claude\state' }
$runsDir = Join-Path $stateDir 'runs'
$runId = $null
$runFolder = $null
$run = $null
if ($Attach -or $Cancel) {
  $runId = if ($Attach) { $Attach } else { $Cancel }
  if ($runId -ceq 'last') {
    $latestRun = Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -cmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'run.json')) } |
      Where-Object {
        try { [int](Read-CodexRunMetadata -Folder $_.FullName).wrapperPid -gt 0 } catch { $false }
      } |
      Sort-Object CreationTimeUtc -Descending | Select-Object -First 1
    if ($null -ne $latestRun) { $runId = $latestRun.Name }
  }
  if ($runId -cnotmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z') {
    Write-Host 'codex-do: expected an existing run ID or last'
    exit 64
  }
  $runFolder = Join-Path $runsDir $runId
  try {
    $run = Read-CodexRunMetadata -Folder $runFolder
    if ($run.runId -cne $runId -or -not $run.dir -or [int]$run.wrapperPid -le 0 -or -not $run.startedUtc) { throw 'invalid run metadata' }
    $Dir = [string]$run.dir
    $Account = [string]$run.account
    $Resume = [string]$run.resume
  } catch { Write-Host "codex-do: cannot load run ${runId}: $($_.Exception.Message)"; exit 64 }
}
$accountHome = $null
try {
  $accountName = if ($Account) { $Account } else { Get-CodexActiveAccount }
  $accountHome = Resolve-CodexAccountHome -Name $accountName
  if (-not ($Status -or $Attached -or $Attach -or $Cancel) -and $accountHome -match '[%!^]') {
    Write-Host 'codex-do: account home must not contain %, !, or ^ in detached mode.'
    exit 64
  }
  if (-not ($Status -or $Attach -or $Cancel) -and $accountName -cne 'main' -and -not (Test-CodexAccountLoggedIn -Home $accountHome)) {
    throw "codex-acc: account '$accountName' is not logged in. Run: codex-acc.ps1 login $accountName"
  }
} catch {
  if (-not ($Status -or $Attach -or $Cancel)) { Write-Host $_.Exception.Message; exit 5 }
  # Reconnection and cancellation remain available after an account home is removed.
  $accountHome = $null
}
if ($Attached) { $promptText = $promptText.Trim() }
if (-not ($Status -or $Attach -or $Cancel) -and [string]::IsNullOrWhiteSpace($promptText)) {
  throw "No task prompt provided. Usage: codex-do.ps1 [-Dir <path>] [-Sandbox <mode>] [-Fast] [-SpecFile <f>] [-OutFile <f>] '<task>'"
}

# Intent: preserve Line's model choice across resumes instead of silently using dispatch defaults.
# Status: newest matching durable run supplies only omitted flags. Next: supervisor WMI validation.
# Blockers: none for Attached fixtures. Confidence: UUID, last, defaults and override regressions.
if ($Resume -and -not ($Attach -or $Cancel)) {
  $priorRun = $null
  $priorRunId = $null
  $resumeDir = [IO.Path]::GetFullPath($Dir).TrimEnd([char[]]@('\', '/'))
  # Creation time distinguishes runs launched in the same second; metadata writes do not reorder them.
  foreach ($folder in @(Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -cmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z' } | Sort-Object CreationTimeUtc, Name -Descending)) {
    try {
      $candidate = Read-CodexRunMetadata -Folder $folder.FullName
      if (-not $candidate.model -or $candidate.effort -notin @('low', 'medium', 'high', 'xhigh', 'max', 'ultra')) { continue }
      if ($Resume -ceq 'last') {
        if (-not $candidate.dir -or [IO.Path]::GetFullPath([string]$candidate.dir).TrimEnd([char[]]@('\', '/')) -ine $resumeDir) { continue }
      } else {
        $sessionPath = Join-Path $folder.FullName 'session.txt'
        if ([IO.File]::ReadAllText($sessionPath).Trim() -ine $Resume) { continue }
      }
      $priorRun = $candidate
      $priorRunId = $folder.Name
      break
    } catch {} # Missing/partially written metadata cannot prevent a resume with defaults.
  }
  if ($null -ne $priorRun) {
    if (-not $PSBoundParameters.ContainsKey('Model')) { $Model = [string]$priorRun.model }
    if (-not $PSBoundParameters.ContainsKey('Effort')) { $Effort = [string]$priorRun.effort }
    if (-not $PSBoundParameters.ContainsKey('Model') -or -not $PSBoundParameters.ContainsKey('Effort')) {
      Write-Host "resume: inheriting model $($priorRun.model) effort $($priorRun.effort) from run $priorRunId"
    }
  } else { Write-Host 'resume: no prior run found; using defaults' }
}
$codexModel = $Model
$codexEffort = if ($Effort) { $Effort } elseif ($Fast) { 'medium' } else { 'high' }
if (-not $Attached) { $Dir = [IO.Path]::GetFullPath($Dir) }
if (-not $Attached -and $OutFile -and -not [IO.Path]::IsPathRooted($OutFile)) {
  $OutFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile)
}
$cargs = @('exec', '--ignore-user-config', '-m', $codexModel,       # lean: no MCP startup (saves ~36s)
           '-s', $Sandbox, '-C', $Dir, '--skip-git-repo-check',
           '-c', 'service_tier=priority',                            # Fast/priority tier: always on
           '-c', 'windows.sandbox="elevated"')                       # --ignore-user-config drops [windows] sandbox="elevated" from config.toml; without it Windows silently downgrades workspace-write to read-only (verified 2026-08-01)
$cargs += @('-c', "model_reasoning_effort=$codexEffort")            # medium for -Fast; high otherwise
if ($OutFile) { $cargs += @('-o', $OutFile) }
if ($Resume) {
  $cargs = @('exec', 'resume', '--ignore-user-config', '-m', $codexModel,
             '--skip-git-repo-check', '-c', 'service_tier=priority',
             '-c', 'windows.sandbox="elevated"',
             '-c', "model_reasoning_effort=$codexEffort",
             '-c', "sandbox_mode=`"$Sandbox`"")
  if ($OutFile) { $cargs += @('-o', $OutFile) }
  if (($Attached -and $NoSubAgents) -or (-not $Attached -and -not $AllowSubAgents)) {
    $cargs += @('--disable', 'multi_agent', '--disable', 'multi_agent_v2')
  }
  if ($Resume -ceq 'last') { $cargs += '--last' } else { $cargs += $Resume }
} elseif (($Attached -and $NoSubAgents) -or (-not $Attached -and -not $AllowSubAgents)) {
  $cargs += @('--disable', 'multi_agent', '--disable', 'multi_agent_v2')
}

# Test hook, also useful if the npm shim moves.
if (-not [string]::IsNullOrEmpty($env:CODEX_DO_BIN)) {
  $codexBin = $env:CODEX_DO_BIN
} else {
  # Prefer the npm-global codex (0.146+) over the desktop-managed standalone that wins PATH
  # resolution (stuck at 0.135). Falls back to PATH `codex` if the npm shim is absent.
  $codexBin = Join-Path $env:APPDATA 'npm\codex.cmd'
  if (-not (Test-Path $codexBin)) { $codexBin = 'codex' }
}

if (-not ($Status -or $Attached -or $Attach -or $Cancel)) {
  foreach ($value in @(
    @{ Name = '-Dir'; Value = $Dir }, @{ Name = '-OutFile'; Value = $OutFile },
    @{ Name = '-Model'; Value = $Model }, @{ Name = 'codexBin'; Value = $codexBin },
    @{ Name = 'state directory'; Value = $stateDir }, @{ Name = 'bin directory'; Value = $PSScriptRoot }
  )) {
    if ($value.Value -match '[%!^]') {
      Write-Host "codex-do: $($value.Name) must not contain %, !, or ^ in detached mode."
      exit 64
    }
  }
  if ($env:PATH.Length -gt 7000) {
    Write-Host 'codex-do: PATH exceeds 7000 characters; shorten it before a detached launch.'
    exit 64
  }
}

function Write-DispatchTrail {
  $lockHandle = $null
  $lockFile = $null
  try {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $trailFile = Join-Path $stateDir 'dispatch-trail.log'
    $lockFile = Join-Path $stateDir 'dispatch-trail.lock'
    for ($attempt = 0; $attempt -lt 20 -and $null -eq $lockHandle; $attempt++) {
      try {
        $lockHandle = [System.IO.File]::Open(
          $lockFile,
          [System.IO.FileMode]::CreateNew,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )
      } catch [System.IO.IOException] {
        try {
          $lock = Get-Item -LiteralPath $lockFile -ErrorAction Stop
          if (([DateTime]::UtcNow - $lock.LastWriteTimeUtc).TotalSeconds -gt 30) {
            Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
          }
        } catch {}
        Start-Sleep -Milliseconds 10
      }
    }
    if ($null -eq $lockHandle) { return }
    $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $sessionId = if ($null -eq $env:CLAUDE_CODE_SESSION_ID) { '' } else { $env:CLAUDE_CODE_SESSION_ID }
    $kind = if ($Resume) { 'resume' } else { 'do' }
    [System.IO.File]::AppendAllText($trailFile, "$epoch|$kind|$codexModel|$codexEffort|$sessionId`r`n", $utf8NoBom)
    $trailLines = @(Get-Content -LiteralPath $trailFile)
    if ($trailLines.Count -gt 200) {
      $kept = @($trailLines | Select-Object -Last 200)
      [System.IO.File]::WriteAllText(
        $trailFile,
        (($kept -join [Environment]::NewLine) + [Environment]::NewLine),
        $utf8NoBom
      )
    }
  } catch {} finally {
    if ($null -ne $lockHandle) {
      try { $lockHandle.Dispose() } catch {}
      try { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

function Write-DispatchLedger {
  param([string]$Entry)

  $lockHandle = $null
  $lockFile = $null
  try {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $ledgerFile = Join-Path $stateDir 'dispatch-ledger.log'
    $lockFile = Join-Path $stateDir 'dispatch-ledger.lock'
    for ($attempt = 0; $attempt -lt 20 -and $null -eq $lockHandle; $attempt++) {
      try {
        $lockHandle = [System.IO.File]::Open(
          $lockFile,
          [System.IO.FileMode]::CreateNew,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )
      } catch [System.IO.IOException] {
        try {
          $lock = Get-Item -LiteralPath $lockFile -ErrorAction Stop
          if (([DateTime]::UtcNow - $lock.LastWriteTimeUtc).TotalSeconds -gt 30) {
            Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
          }
        } catch {}
        Start-Sleep -Milliseconds 10
      }
    }
    if ($null -eq $lockHandle) { return }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($ledgerFile, "$Entry`r`n", $utf8NoBom)
    $ledgerLines = @(Get-Content -LiteralPath $ledgerFile)
    if ($ledgerLines.Count -gt 300) {
      $kept = @($ledgerLines | Select-Object -Last 300)
      [System.IO.File]::WriteAllText(
        $ledgerFile,
        (($kept -join [Environment]::NewLine) + [Environment]::NewLine),
        $utf8NoBom
      )
    }
  } catch {} finally {
    if ($null -ne $lockHandle) {
      try { $lockHandle.Dispose() } catch {}
      try { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

function Test-DispatchProcessAlive {
  param([int]$ProcessId, [object]$CreationDate)

  if ($ProcessId -le 0 -or -not $CreationDate) { return $false }
  $process = $null
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    # StartTime is the OS process creation time, also exposed by WMI as CreationDate.
    # Avoid a WMI round trip on each poll (and keep Attached mode independent of WMI).
    $createdUtc = $process.StartTime.ToUniversalTime()
    return (-not $process.HasExited -and
      [Math]::Abs(($createdUtc - ([datetime]$CreationDate).ToUniversalTime()).TotalSeconds) -lt 1)
  } catch {
    return $false
  } finally {
    if ($null -ne $process) { $process.Dispose() }
  }
}

function Get-DispatchLockJson {
  param(
    [string]$Directory,
    [string]$StartedUtc,
    [object]$ChildPid,
    [object]$ChildStarted
  )

  $record = [ordered]@{
    pid = $PID
    pidStarted = $dispatcherStartedUtc
    dir = $Directory
    startedUtc = $StartedUtc
  }
  if ($null -ne $ChildPid) {
    $record.childPid = [int]$ChildPid
    $record.childStarted = $ChildStarted
  }
  if ($runId) { $record.runId = $runId }
  return ($record | ConvertTo-Json -Compress)
}

function Write-DispatchLockFile {
  param(
    [string]$Path,
    [string]$Directory,
    [string]$StartedUtc,
    [object]$ChildPid,
    [object]$ChildStarted,
    [switch]$CreateNew
  )

  $mode = if ($CreateNew) { [System.IO.FileMode]::CreateNew } else { [System.IO.FileMode]::Create }
  $stream = $null
  try {
    for ($attempt = 0; $null -eq $stream; $attempt++) {
      try {
        $stream = [System.IO.File]::Open($Path, $mode, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      } catch [IO.IOException] {
        $failure = $_.Exception
        while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
        $nativeError = $failure.HResult -band 0xffff
        # A competing dispatcher briefly holds an inspection handle. Retry only the
        # owner's update, for at most three seconds; CreateNew still refuses immediately.
        if ($CreateNew -or $nativeError -notin @(32, 33) -or $attempt -ge 150) { throw }
        Start-Sleep -Milliseconds 20
      }
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $bytes = $utf8NoBom.GetBytes((Get-DispatchLockJson -Directory $Directory -StartedUtc $StartedUtc -ChildPid $ChildPid -ChildStarted $ChildStarted))
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function ConvertTo-NativeArgument {
  param([AllowEmptyString()][string]$Argument)

  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Argument.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes++
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes))
      $backslashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Update-RunOutputActivity {
  param([string]$Folder)

  $logPath = Join-Path $Folder 'out.log'
  if (-not [IO.File]::Exists($logPath)) { return }
  # Serialize observers through activity.len and read the open file's true size;
  # cmd can hold its handle open without refreshing directory metadata.
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    $lengthStream = $null; $logStream = $null; $reader = $null
    try {
      $lengthStream = [IO.File]::Open((Join-Path $Folder 'activity.len'), 'OpenOrCreate', 'ReadWrite', 'None')
      $logStream = [IO.File]::Open($logPath, 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      $length = $logStream.Length
      $reader = New-Object IO.StreamReader($lengthStream, [Text.Encoding]::UTF8, $true, 1024, $true)
      $previous = $reader.ReadToEnd()
      if ($previous -cne [string]$length) {
        $utf8 = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText((Join-Path $Folder 'activity.txt'), [DateTime]::UtcNow.ToString('o'), $utf8)
        $bytes = $utf8.GetBytes([string]$length)
        $lengthStream.Position = 0; $lengthStream.SetLength(0)
        $lengthStream.Write($bytes, 0, $bytes.Length)
      }
      return
    } catch [IO.IOException] { if ($attempt -eq 9) { throw }; Start-Sleep -Milliseconds 25 }
    finally {
      if ($null -ne $reader) { $reader.Dispose() }
      if ($null -ne $logStream) { $logStream.Dispose() }
      if ($null -ne $lengthStream) { $lengthStream.Dispose() }
    }
  }
}

function Wait-DetachedRun {
  param([string]$Folder, [object]$Run, [switch]$Replay)

  $WrapperPid = [int]$Run.wrapperPid
  $CreationDate = $Run.wrapperCreationDate
  $nextTreeUpdate = [datetime]::MinValue
  $outputPath = Join-Path $Folder 'out.log'
  $exitPath = Join-Path $Folder 'exit.txt'
  $position = 0L
  $missingSince = $null
  $buffer = New-Object byte[] 8192
  $decoder = [Text.Encoding]::UTF8.GetDecoder()
  $characters = New-Object char[] ([Text.Encoding]::UTF8.GetMaxCharCount($buffer.Length))
  while ($true) {
    # Check completion before reading: a published exit means the log is already final.
    $finished = Test-Path -LiteralPath $exitPath
    if (-not $finished -and [DateTime]::UtcNow -ge $nextTreeUpdate) {
      try {
        $tree = @(Get-RunProcessTree -Run $Run -Folder $Folder)
        Write-RunTree -Folder $Folder -Tree $tree
      } catch {
        # Retain the previous evidence if enumeration or publication temporarily fails.
        Write-Host "codex-do: cannot refresh tree.json: $($_.Exception.Message)"
      }
      $nextTreeUpdate = [DateTime]::UtcNow.AddSeconds(2)
    }
    if (Test-Path -LiteralPath $outputPath) {
      try { Update-RunOutputActivity -Folder $Folder }
      catch { Write-Host "codex-do: cannot record output activity: $($_.Exception.Message)" }
      $stream = [IO.File]::Open($outputPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      try {
        [void]$stream.Seek($position, [IO.SeekOrigin]::Begin)
        $remaining = $stream.Length - $position
        while ($remaining -gt 0) {
          $count = $stream.Read($buffer, 0, [int][Math]::Min($remaining, $buffer.Length))
          if ($count -eq 0) { break }
          # Decoder retains an incomplete UTF-8 sequence across reads and polling cycles.
          $charCount = $decoder.GetChars($buffer, 0, $count, $characters, 0, $false)
          if ($charCount -gt 0) { Write-Host -NoNewline ([string]::new($characters, 0, $charCount)) }
          $position += $count
          $remaining -= $count
        }
      } finally { $stream.Dispose() }
    }
    if ($finished) {
      $charCount = $decoder.GetChars($buffer, 0, 0, $characters, 0, $true)
      if ($charCount -gt 0) { Write-Host -NoNewline ([string]::new($characters, 0, $charCount)) }
      $code = 0
      if (-not [int]::TryParse([IO.File]::ReadAllText($exitPath).Trim(), [ref]$code)) {
        Write-Host "codex-do: invalid exit.txt in $Folder"
        return 71
      }
      $failure = Get-CodexSandboxFailure -Path $outputPath
      if ($failure) {
        Write-Host "WORKER SANDBOX FAILURE: $failure"
        try { Update-CodexRunMetadata -Folder $Folder -Fields @{ sandboxFailure = $true } }
        catch { Write-Host "codex-do: cannot record sandbox failure: $($_.Exception.Message)" }
        return 72
      }
      return $code
    }
    if (Test-DispatchProcessAlive -ProcessId $WrapperPid -CreationDate $CreationDate) {
      $missingSince = $null
    } elseif ($null -eq $missingSince) {
      $missingSince = [DateTime]::UtcNow
    } elseif (([DateTime]::UtcNow - $missingSince).TotalSeconds -ge 3) {
      # A cancellation may publish exit.txt during the last read; drain it next iteration.
      if (Test-Path -LiteralPath $exitPath) { continue }
      $charCount = $decoder.GetChars($buffer, 0, 0, $characters, 0, $true)
      if ($charCount -gt 0) { Write-Host -NoNewline ([string]::new($characters, 0, $charCount)) }
      Write-Host "codex-do: wrapper PID $WrapperPid is gone and exit.txt is still missing after 3 seconds ($Folder)"
      return 71
    }
    Start-Sleep -Milliseconds 500
  }
}

function Remove-OwnedDispatchLock {
  param([string]$Path, [string]$RunId, [string]$StartedUtc)

  $stream = $null
  $reader = $null
  try {
    # Deny competing readers/writers while checking ownership. Allow deletion through
    # this handle so a second observer cannot read the old lock then delete its successor.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
    $reader = New-Object IO.StreamReader($stream)
    $record = $reader.ReadToEnd() | ConvertFrom-Json
    $owned = if ($RunId) { $record.runId -ceq $RunId } else { $record.pid -eq $PID -and $record.startedUtc -ceq $StartedUtc }
    if ($owned) { [IO.File]::Delete($Path) }
  } catch {} finally {
    if ($null -ne $reader) { $reader.Dispose() }
    elseif ($null -ne $stream) { $stream.Dispose() }
  }
}

function Read-RunTree {
  param([string]$Folder)

  $path = Join-Path $Folder 'tree.json'
  if (-not (Test-Path -LiteralPath $path)) { return }
  $entries = @()
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try {
      $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      $reader = New-Object IO.StreamReader($stream)
      # PS 5.1 ConvertFrom-Json emits a JSON array as ONE object; ForEach-Object unrolls it
      # (supervisor fix 2026-10-10: [int]$entry.pid threw Object[] -> Int32 in -Cancel).
      try { $entries = @($reader.ReadToEnd() | ConvertFrom-Json | ForEach-Object { $_ }) }
      finally { $reader.Dispose() }
      break
    } catch {
      # Mid-replace or locked: retry; an unreadable snapshot yields no seeds, never an abort.
      $entries = @()
      Start-Sleep -Milliseconds 50
    }
  }
  foreach ($entry in $entries) {
    if ($null -ne $entry -and [int]$entry.pid -gt 0 -and $entry.created) {
      $created = ([datetime]$entry.created).ToUniversalTime().ToString('o')
      [pscustomobject]@{ pid = [int]$entry.pid; parentPid = [int]$entry.parentPid; created = $created }
    }
  }
}

function Get-RunProcessTree {
  param([object]$Run, [string]$Folder, [object[]]$KnownParents = @(), [hashtable]$StoppedAt = @{})

  $live = @{}
  foreach ($process in @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)) {
    # PID 0 and protected processes can expose null CreationDate. They are not evidence.
    if ($process.ProcessId -le 0 -or $null -eq $process.CreationDate) { continue }
    $live[[int]$process.ProcessId] = [pscustomobject]@{
      pid = [int]$process.ProcessId; parentPid = [int]$process.ParentProcessId
      created = $process.CreationDate.ToUniversalTime().ToString('o')
    }
  }
  $seeds = @(Read-RunTree -Folder $Folder) + @($KnownParents)
  if ($Run.wrapperCreationDate) {
    $seeds = @([pscustomobject]@{ pid = [int]$Run.wrapperPid; parentPid = 0; created = ([datetime]$Run.wrapperCreationDate).ToUniversalTime().ToString('o') }) + $seeds
  }
  $queue = New-Object Collections.Queue
  $seen = @{}
  $result = New-Object Collections.ArrayList
  foreach ($seed in $seeds) {
    if ($null -eq $seed -or -not $seed.created -or [int]$seed.pid -le 0) { continue }
    $key = "$($seed.pid)|$($seed.created)"
    if ($seen.ContainsKey($key)) { continue }
    $current = $live[[int]$seed.pid]
    if ($null -ne $current -and
        ([datetime]$current.created).ToUniversalTime().ToString('yyyyMMddHHmmss') -ceq
        ([datetime]$seed.created).ToUniversalTime().ToString('yyyyMMddHHmmss')) {
      $seen[$key] = $true
      $queue.Enqueue($current)
      [void]$result.Add($current)
    } elseif ($StoppedAt.ContainsKey($key)) {
      # Only this cancellation's previously verified, terminated parents qualify.
      # Their exact exit times bound late children; a reused dead PID is never a seed.
      $seen[$key] = $true
      $queue.Enqueue($seed)
    }
  }
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    $parentKey = "$($parent.pid)|$($parent.created)"
    foreach ($child in $live.Values) {
      $key = "$($child.pid)|$($child.created)"
      if ($seen.ContainsKey($key) -or $child.parentPid -ne $parent.pid) { continue }
      $created = ([datetime]$child.created).ToUniversalTime()
      if ($created -lt ([datetime]$parent.created).ToUniversalTime()) { continue }
      if ($StoppedAt.ContainsKey($parentKey) -and $created -gt $StoppedAt[$parentKey]) { continue }
      $seen[$key] = $true
      [void]$result.Add($child)
      $queue.Enqueue($child)
    }
  }
  return $result.ToArray()
}

function Write-RunTree {
  param([string]$Folder, [object[]]$Tree)

  $path = Join-Path $Folder 'tree.json'
  # Best effort (supervisor fix 2026-10-10): the launcher and -Cancel both write tree.json, and
  # File.Replace fails while the other holds it. A missed snapshot must never abort a wait or a
  # cancel; the next snapshot (about 2 s later) or the live walk covers it.
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    $temporary = Join-Path $Folder ('tree-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
      [IO.File]::WriteAllText($temporary, (ConvertTo-Json -InputObject @($Tree) -Compress), (New-Object Text.UTF8Encoding($false)))
      if (Test-Path -LiteralPath $path) { [IO.File]::Replace($temporary, $path, $null) }
      else {
        try { [IO.File]::Move($temporary, $path) } catch [IO.IOException] {
          if (-not (Test-Path -LiteralPath $path)) { throw }
          [IO.File]::Replace($temporary, $path, $null)
        }
      }
      return
    } catch {
      Start-Sleep -Milliseconds 50
    } finally {
      if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
  }
}

function Test-RunTreeAlive {
  param([string]$Folder)

  foreach ($entry in @(Read-RunTree -Folder $Folder)) {
    if (Test-DispatchProcessAlive -ProcessId $entry.pid -CreationDate $entry.created) { return $true }
  }
  return $false
}

function Complete-RunObservation {
  param([string]$Folder, [string]$RunId, [int]$ExitCode, [string]$LockPath)

  if ($ExitCode -eq 71 -and (Test-RunTreeAlive -Folder $Folder)) {
    Write-Host "worker still running without its wrapper; run: codex-do.ps1 -Cancel $RunId"
    return
  }
  Remove-OwnedDispatchLock -Path $LockPath -RunId $RunId
}

function Stop-DetachedRun {
  param([object]$Run, [string]$Folder)

  $exitPath = Join-Path $Folder 'exit.txt'
  # A finished run can still leave verified descendants alive; stop them, keep its exit code.
  $alreadyFinished = Test-Path -LiteralPath $exitPath
  $known = @{}
  $stoppedAt = @{}
  $stopped = New-Object Collections.ArrayList
  while ($true) {
    $tree = @(Get-RunProcessTree -Run $Run -Folder $Folder -KnownParents @($known.Values) -StoppedAt $stoppedAt)
    if ($tree.Count -eq 0) { break }
    Write-RunTree -Folder $Folder -Tree $tree
    # Wrapper first prevents normal exit publication racing cancellation. Subsequent
    # snapshots use verified parent lifetimes to include late children and grandchildren.
    foreach ($entry in $tree) {
      $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
      if ($null -eq $process) { continue }
      try {
        $null = $process.Handle
        if ($process.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmss') -cne
            ([datetime]$entry.created).ToUniversalTime().ToString('yyyyMMddHHmmss')) { continue }
        $key = "$($entry.pid)|$($entry.created)"
        $known[$key] = $entry
        if (-not $process.HasExited) {
          $process.Kill()
          $process.WaitForExit()
          [void]$stopped.Add($entry.pid)
        }
        $stoppedAt[$key] = $process.ExitTime.ToUniversalTime()
      } catch {
        if (Test-DispatchProcessAlive -ProcessId $entry.pid -CreationDate $entry.created) { throw }
      } finally { $process.Dispose() }
    }
  }
  if (-not (Test-Path -LiteralPath $exitPath)) {
    $temporary = Join-Path $Folder ('cancel-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
      [IO.File]::WriteAllText($temporary, "130`n", (New-Object Text.UTF8Encoding($false)))
      try { [IO.File]::Move($temporary, $exitPath) } catch [IO.IOException] {
        if (-not (Test-Path -LiteralPath $exitPath)) { throw }
      }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
  }
  if ($stopped.Count -eq 0 -and $alreadyFinished) { Write-Host 'stopped PIDs: none (run already finished)' }
  elseif ($stopped.Count -eq 0) { Write-Host 'nothing verified to stop' }
  else { Write-Host "stopped PIDs: $($stopped -join ', ')" }
}

function Get-DispatchRollouts {
  param([string]$AccountHome)
  Get-ChildItem -LiteralPath (Join-Path $AccountHome 'sessions') -Filter 'rollout-*.jsonl' -File -Recurse -ErrorAction Stop
}
function Get-DispatchSessionMeta {
  param([string]$Path)
  # Forked rollouts can repeat parent metadata later; only the first line owns the file.
  $meta = Get-Content -LiteralPath $Path -TotalCount 1 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($meta.type -ceq 'session_meta') { return $meta.payload }
}
function Get-DispatchParentId {
  param($Meta)
  if ($Meta.parent_thread_id) { return [string]$Meta.parent_thread_id }
  if ($Meta.source.subagent.thread_spawn.parent_thread_id) { return [string]$Meta.source.subagent.thread_spawn.parent_thread_id }
}
function Write-DispatchSubagents {
  param([string]$AccountHome, [string]$Session, [string]$RunFolder)
  if (-not $RunFolder -or $Session -eq 'unknown' -or -not (Test-Path -LiteralPath (Join-Path $RunFolder 'exit.txt'))) { return }
  try {
    $count = 0
    foreach ($rollout in @(Get-DispatchRollouts -AccountHome $AccountHome)) {
      try { $meta = Get-DispatchSessionMeta -Path $rollout.FullName } catch { continue }
      if ((Get-DispatchParentId -Meta $meta) -eq $Session) { $count++ }
    }
    [IO.File]::WriteAllText((Join-Path $RunFolder 'subagents.txt'), [string]$count, (New-Object Text.UTF8Encoding($false)))
    if ($count -gt 0) { Write-Host "codex-do: spawned $count sub-agent threads" }
  } catch {} # Telemetry must not turn a successful run into an error.
}
function New-DispatchCompletionScript {
  $lines = @('param([string]$RunFolder)', '$ErrorActionPreference = ''Stop''')
  foreach ($name in @('Get-DispatchRollouts','Get-DispatchSessionMeta','Get-DispatchParentId','Write-DispatchSubagents','Write-DispatchSession')) {
    $lines += 'function {0} {{ {1} }}' -f $name, (Get-Command $name -CommandType Function).Definition
  }
  $lines += 'try { $run = Get-Content -Raw -LiteralPath (Join-Path $RunFolder ''run.json'') | ConvertFrom-Json; Write-DispatchSession -Dir $run.dir -AccountHome $run.accountHome -Resume $run.resume -RunStarted ([datetime]$run.startedUtc) -RunFolder $RunFolder } catch {}'
  return ($lines -join "`n")
}
function Write-DispatchSession {
  param([string]$Dir, [string]$AccountHome, [string]$Resume, [datetime]$RunStarted, [string]$RunFolder = '')

  # Supervisor fix 2026-10-10 (Astra P2): a run folder pins its own session, so -Attach to an
  # older run never reports a newer run's session from the same Dir.
  $pinned = if ($RunFolder) { Join-Path $RunFolder 'session.txt' } else { $null }
  if ($pinned -and (Test-Path -LiteralPath $pinned)) {
    $session = ([IO.File]::ReadAllText($pinned)).Trim()
    Write-Host "session: $session"
    Write-DispatchSubagents -AccountHome $AccountHome -Session $session -RunFolder $RunFolder
    return
  }
  # Intent: expose the worker transcript ID from the resolved account home for follow-up packets.
  # Status: best-effort discovery after child exit. Next: supervisor installs this tested wrapper.
  # Blockers: none locally. Confidence: fake-home self-test covers known and missing rollouts.
  $session = 'unknown'
  try {
    if ($Resume -and $Resume -cne 'last') {
      $session = $Resume.ToLowerInvariant()
    } else {
      # Concurrent workers share the sessions folder (verified 2026-10-01: newest-file picked another
      # worker's run). Match only rollouts whose session_meta cwd equals this run's -Dir.
      $cutoff = $runStarted.AddSeconds(-2)
      $wantDir = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
      $latest = Get-DispatchRollouts -AccountHome $AccountHome |
        Where-Object { $_.LastWriteTime -ge $cutoff } |
        Sort-Object LastWriteTime -Descending |
        Where-Object {
          $meta = $null
          try { $meta = Get-DispatchSessionMeta -Path $_.FullName } catch {}
          # Preserve live's case-sensitive user-source filter and legacy fallback.
          $null -ne $meta -and $meta.cwd -and
            ($meta.thread_source -ceq 'user' -or ($null -eq $meta.PSObject.Properties['thread_source'] -and -not (Get-DispatchParentId -Meta $meta))) -and
            ([IO.Path]::GetFullPath([string]$meta.cwd).TrimEnd('\') -ieq $wantDir)
        } |
        Select-Object -First 1
      if ($null -ne $latest -and $latest.BaseName -match '([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\z') {
        $session = $Matches[1]
      }
    }
  } catch {}
  if ($pinned -and $session -cne 'unknown') {
    try { [IO.File]::WriteAllText($pinned, $session, (New-Object Text.UTF8Encoding($false))) } catch {}
  }
  Write-Host "session: $session"
  Write-DispatchSubagents -AccountHome $AccountHome -Session $session -RunFolder $RunFolder
}

if ($Status) {
  $now = [DateTime]::UtcNow
  $cutoff = if ($Hours -ge ($now - [datetime]::MinValue).TotalHours) { [datetime]::MinValue } else { $now.AddHours(-$Hours) }
  $rows = @(
    foreach ($folder in @(Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.CreationTimeUtc -ge $cutoff } | Sort-Object Name)) {
      $metadataPath = Join-Path $folder.FullName 'run.json'
      if (-not (Test-Path -LiteralPath $metadataPath)) { continue }
      try {
        $metadata = Read-CodexRunMetadata -Folder $folder.FullName
        $started = ([datetime]$metadata.startedUtc).ToUniversalTime()
        $logPath = Join-Path $folder.FullName 'out.log'
        Update-RunOutputActivity -Folder $folder.FullName
        $lastOutput = if (Test-Path -LiteralPath $logPath) { [IO.File]::GetLastWriteTimeUtc($logPath) } else { $started }
        $activityPath = Join-Path $folder.FullName 'activity.txt'
        $activityUtc = [datetime]::MinValue
        try {
          if ([datetime]::TryParse([IO.File]::ReadAllText($activityPath), [ref]$activityUtc) -and $activityUtc.ToUniversalTime() -gt $lastOutput) {
            $lastOutput = $activityUtc.ToUniversalTime()
          }
        } catch {} # An absent or concurrently written timestamp leaves mtime as the fallback.
        $outputAge = [Math]::Max(0, ($now - $lastOutput).TotalSeconds)
        $finishedPath = Join-Path $folder.FullName 'exit.txt'
        $elapsedEnd = $now
        if (Test-Path -LiteralPath $finishedPath) {
          $code = 71
          $parsed = 0
          if ([int]::TryParse([IO.File]::ReadAllText($finishedPath).Trim(), [ref]$parsed)) { $code = $parsed }
          if ($null -eq $metadata.PSObject.Properties['sandboxFailure']) {
            $sandboxFailure = [bool](Get-CodexSandboxFailure -Path $logPath)
            Update-CodexRunMetadata -Folder $folder.FullName -Fields @{ sandboxFailure = $sandboxFailure }
          } else { $sandboxFailure = [bool]$metadata.sandboxFailure }
          if ($sandboxFailure) { $code = 72 }
          $runState = if ($code -eq 0) { 'done' } else { "failed $code" }
          $elapsedEnd = [IO.File]::GetLastWriteTimeUtc($finishedPath)
        } elseif ([int]$metadata.wrapperPid -eq 0 -and ($now - $started).TotalSeconds -lt 30) {
          $runState = 'starting'
        } elseif ((Test-DispatchProcessAlive -ProcessId $metadata.wrapperPid -CreationDate $metadata.wrapperCreationDate) -or (Test-RunTreeAlive -Folder $folder.FullName)) {
          # Stale = no output for 10 minutes; CODEX_DO_STALE_SECONDS overrides for tests (cmd holds out.log open, so tests cannot age its mtime).
          $staleSeconds = 600; if ($env:CODEX_DO_STALE_SECONDS -match '^\d+$') { $staleSeconds = [int]$env:CODEX_DO_STALE_SECONDS }
          $runState = if ($outputAge -ge $staleSeconds) { 'STALE' } else { 'running' }
        } else { $runState = 'DIED' }
        [pscustomobject]@{
          runId = $metadata.runId; Dir = Split-Path -Leaf $metadata.dir; model = $metadata.model; state = $runState
          elapsed = ('{0:0.0} min' -f [Math]::Max(0, ($elapsedEnd - $started).TotalMinutes))
          'last-output age' = ('{0:0.0} min' -f ($outputAge / 60))
        }
      } catch { Write-Host "codex-do: cannot read run $($folder.Name): $($_.Exception.Message)" }
    }
  )
  if ($rows.Count -eq 0) { Write-Host "no runs in the last $Hours h" }
  else { $rows | Format-Table -AutoSize | Out-String -Width 4096 | Write-Host }
  exit 0
}

if (-not ($Attach -or $Cancel)) {
  # Intent: report RAM without blocking Line's sessions. Status: unreachable exit 75 removed.
  # Next: supervisor host check. Blockers: none. Confidence: false-result and skip fixtures.
  if (-not $NoRamCheck) { [void](Wait-FreeRam -MinGB 1.5 -TimeoutMin 10) }
  # Intent: prove shell availability before spending a model call.
  # Status: one selection per dispatch, shared by exec and resume.
  # Next: supervisor live validation. Blockers: none. Confidence: fixture coverage.
  if (-not $Attached -and -not (Test-Path -LiteralPath $Dir -PathType Container)) {
    Write-Host 'codex-do: Win32_Process.Create failed: working directory does not exist.'
    exit 70
  }
  $preflightHome = if ($accountName -cne 'main') { $accountHome } else { '' }
  $selection = Select-CodexSandboxMode -CodexBin $codexBin -Dir $Dir -AccountHome $preflightHome -NoSandboxFallback:$NoSandboxFallback
  if (-not $selection.Mode) { Write-Host "codex-do: SANDBOX UNAVAILABLE: $($selection.Reason)"; exit 73 }
  $sandboxNotice = "sandbox-mode: $($selection.Mode)"
  if ($selection.Mode -eq 'unelevated') { $sandboxNotice += " (fallback: $($selection.Reason))" }
  Write-Host $sandboxNotice
  # Preserve the existing elevated argument vector byte-for-byte.
  $cargs = @($cargs | ForEach-Object {
    if ($_ -ceq 'windows.sandbox="elevated"') { 'windows.sandbox="{0}"' -f $selection.Mode } else { $_ }
  })
}

$normalizedDir = [System.IO.Path]::GetFullPath($Dir).TrimEnd([char[]]@('\', '/')).ToLowerInvariant()
$sha1 = [System.Security.Cryptography.SHA1]::Create()
try {
  $hashBytes = $sha1.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalizedDir))
} finally {
  $sha1.Dispose()
}
$lockHash = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
$lockDir = Join-Path $stateDir 'dispatch-locks'
New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
$dispatchLockFile = Join-Path $lockDir (($lockHash.Substring(0, 16)) + '.lock')
$dispatchStartedUtc = [DateTime]::UtcNow.ToString('o')
$dispatcherProcess = [Diagnostics.Process]::GetCurrentProcess()
try { $dispatcherStartedUtc = $dispatcherProcess.StartTime.ToUniversalTime().ToString('o') }
finally { $dispatcherProcess.Dispose() }
$ownsDispatchLock = $false

if ($Attach -or $Cancel) {
  if ($Cancel) {
    try { Stop-DetachedRun -Run $run -Folder $runFolder } catch { Write-Host $_.Exception.Message; exit 71 }
    Remove-OwnedDispatchLock -Path $dispatchLockFile -RunId $runId
    exit 0
  }
  $exitCode = Wait-DetachedRun -Folder $runFolder -Run $run -Replay
  Complete-RunObservation -Folder $runFolder -RunId $runId -ExitCode $exitCode -LockPath $dispatchLockFile
  Write-DispatchSession -Dir $Dir -AccountHome $accountHome -Resume $Resume -RunStarted ([datetime]$run.startedUtc) -RunFolder $runFolder
  exit $exitCode
}
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss-') + [guid]::NewGuid().ToString('N').Substring(0, 4)

$lockRetries = 0
while (-not $ownsDispatchLock) {
  try {
    Write-DispatchLockFile -Path $dispatchLockFile -Directory $normalizedDir -StartedUtc $dispatchStartedUtc -ChildPid $null -CreateNew
    $ownsDispatchLock = $true
  } catch [System.IO.IOException], [UnauthorizedAccessException] {
    $existingLock = $null
    $staleStream = $null
    $staleReader = $null
    try {
      $staleStream = [IO.File]::Open($dispatchLockFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
      $staleReader = New-Object IO.StreamReader($staleStream)
      try { $existingLock = $staleReader.ReadToEnd() | ConvertFrom-Json } catch {}
      $lockStarted = [datetime]::MinValue
      $validLock = $null -ne $existingLock -and $existingLock.pidStarted -and
        [datetime]::TryParse([string]$existingLock.pidStarted, [ref]$lockStarted) -and $null -ne $existingLock.pid
      $unreadableFresh = -not $validLock -and
        ([DateTime]::UtcNow - [IO.File]::GetLastWriteTimeUtc($dispatchLockFile)).TotalSeconds -le 60
      # Supervisor fix 2026-10-10 (Fable P2-1/P2-3): the lock's run folder is the authority.
      # A finished run (exit.txt present) never blocks; a run whose recorded tree is still
      # alive always blocks, even after its launcher and wrapper died.
      $lockRunFolder = $null
      if ($validLock -and $existingLock.runId -and ([string]$existingLock.runId) -match '^\d{8}-\d{6}-[0-9a-f]{4}$') {
        $lockRunFolder = Join-Path $runsDir ([string]$existingLock.runId)
      }
      $lockRunFinished = $null -ne $lockRunFolder -and (Test-Path -LiteralPath (Join-Path $lockRunFolder 'exit.txt'))
      $lockRunOrphanAlive = $null -ne $lockRunFolder -and -not $lockRunFinished -and (Test-RunTreeAlive -Folder $lockRunFolder)
      # Legacy lock (written by the pre-2026-10-10 script, no pidStarted): keep the old rule,
      # live pid or childPid = busy, so an upgrade never reclaims a running worker's Dir (Fable P2-5).
      $legacyLockAlive = $false
      if (-not $validLock -and $null -ne $existingLock -and $null -ne $existingLock.pid -and -not $existingLock.pidStarted) {
        foreach ($legacyPid in @($existingLock.pid, $existingLock.childPid)) {
          if ($null -ne $legacyPid -and [int]$legacyPid -gt 0 -and $null -ne (Get-Process -Id ([int]$legacyPid) -ErrorAction SilentlyContinue)) { $legacyLockAlive = $true }
        }
      }
      if (-not $lockRunFinished -and ($unreadableFresh -or $lockRunOrphanAlive -or $legacyLockAlive -or ($validLock -and (
          (Test-DispatchProcessAlive -ProcessId ([int]$existingLock.pid) -CreationDate $existingLock.pidStarted) -or
          (Test-DispatchProcessAlive -ProcessId ([int]$existingLock.childPid) -CreationDate $existingLock.childStarted))))) {
        $hint = if ($existingLock -and $existingLock.runId) { " Reconnect: codex-do.ps1 -Attach $($existingLock.runId). Stop: codex-do.ps1 -Cancel $($existingLock.runId)." } else { '' }
        Write-Host "REFUSED: another worker is active in this Dir (PID $($existingLock.pid), child PID $($existingLock.childPid) since $($existingLock.startedUtc)). Bundle the work into that run or wait.$hint"
        exit 3
      }
      [IO.File]::Delete($dispatchLockFile)
    } catch [IO.FileNotFoundException] {
      # The previous owner finished between our create attempt and stale-lock read.
    } catch [IO.IOException], [UnauthorizedAccessException] {
      # Sharing violations and delete-pending files are transient, including access
      # denied from CreateNew. Retry the whole acquisition after releasing our handles.
    } finally {
      if ($null -ne $staleReader) { $staleReader.Dispose() }
      elseif ($null -ne $staleStream) { $staleStream.Dispose() }
    }
    if ($lockRetries -ge 10) {
      Write-Host 'REFUSED: cannot acquire the Dir lock after 10 retries.'
      exit 3
    }
    $lockRetries++
    Start-Sleep -Milliseconds 50
  }
}

$stdinTempFile = $null
$childProcess = $null
$childPid = $null
$ledgerStarted = $false
$ledgerEnded = $false
$exitCode = 1
$runStarted = $null

if (-not $Attached) {
  # Intent: keep Line's workers alive outside Claude's background task process tree.
  # Status: WMI-only detached launch, durable stdin/log/exit/metadata, reconnect and cancel.
  # Next: supervisor runs detached lifecycle self-test outside the worker sandbox.
  # Blockers: sandbox denies WMI; no fallback launcher is safe for this requirement.
  # Confidence: Attached regression and parser checks locally; WMI integration pending.
  $completed = $false
  $createdRunFolder = $false
  try {
    $runFolder = Join-Path $runsDir $runId
    New-Item -ItemType Directory -Path $runsDir -Force | Out-Null
    New-Item -ItemType Directory -Path $runFolder -ErrorAction Stop | Out-Null
    $createdRunFolder = $true
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    $stdinPath = Join-Path $runFolder 'stdin.txt'
    $outputPath = Join-Path $runFolder 'out.log'
    $exitPath = Join-Path $runFolder 'exit.txt'
    $wrapperPath = Join-Path $runFolder 'run.cmd'
    # Intent: record child-thread telemetry even if the observing dispatcher dies.
    # Status: wrapper publishes exit.txt before running best-effort telemetry.
    # Next: supervisor detached smoke test. Blockers: none. Confidence: synthetic rollouts.
    $completionPath = Join-Path $runFolder 'complete.ps1'
    [IO.File]::WriteAllText($completionPath, (New-DispatchCompletionScript), $utf8NoBom)
    [IO.File]::WriteAllText($stdinPath, $promptText, $utf8NoBom)
    [IO.File]::WriteAllText($outputPath, '', $utf8NoBom)
    if ($Resume) { $cargs += '-' } else { $cargs += 'Execute the full task specification provided on stdin.' }
    $nativeArguments = (($cargs | ForEach-Object { ConvertTo-NativeArgument -Argument ([string]$_) }) -join ' ')
    $wrapper = @('@echo off', 'chcp 65001 >nul', ('set "PATH={0}"' -f $env:PATH.Replace('%', '%%')))
    if ($accountName -cne 'main') { $wrapper += 'set "CODEX_HOME={0}"' -f $accountHome.Replace('%', '%%') }
    else { $wrapper += 'set "CODEX_HOME="' }
    foreach ($name in @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'OPENAI_BASE_URL', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'CODEX_ACC_MAIN_HOME', 'CODEX_ACC_ROOT', 'CODEX_DO_NOTIFY')) {
      $value = [Environment]::GetEnvironmentVariable($name, 'Process')
      if ($null -ne $value) { $wrapper += 'set "{0}={1}"' -f $name, $value.Replace('%', '%%') }
    }
    $wrapper += 'call "{0}" {1} < "{2}" > "{3}" 2>&1' -f $codexBin, $nativeArguments, $stdinPath, $outputPath
    $wrapper += '> "{0}.tmp" echo %ERRORLEVEL%' -f $exitPath
    $wrapper += 'move /y "{0}.tmp" "{0}" >nul' -f $exitPath
    $wrapper += '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "{0}" -RunFolder "{1}" > "{2}" 2>&1' -f $completionPath, $runFolder, (Join-Path $runFolder 'telemetry.log')
    # Intent: notify Line even when the observer has been terminated.
    # Status: notice follows durable exit publication and cannot change exit.txt.
    # Next: desktop smoke test. Blockers: none. Confidence: fixture log assertions.
    $wrapper += '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Sta -File "{0}" -RunFolder "{1}"' -f (Join-Path $PSScriptRoot 'codex-run-notify.ps1'), $runFolder
    [IO.File]::WriteAllText($wrapperPath, (($wrapper -join "`n") + "`n"), $utf8NoBom)
    Write-Host "-> $codexBin $($cargs -join ' ')  [detached prompt via stdin, $($promptText.Length) chars]" -ForegroundColor DarkGray
    Write-Host "account: $accountName"
    Write-DispatchTrail
    $runStarted = Get-Date
    # Publish enough metadata for a fast worker's notice before starting the wrapper.
    $run = [ordered]@{
      runId = $runId; dir = [IO.Path]::GetFullPath($Dir); model = $codexModel
      effort = $codexEffort; account = $accountName; resume = $Resume
      accountHome = $accountHome
      sandboxMode = $selection.Mode
      startedUtc = $runStarted.ToUniversalTime().ToString('o'); wrapperPid = 0
      wrapperCreationDate = $null
      specFile = $specFullPath; specSha256 = $specSha256
    }
    [IO.File]::WriteAllText((Join-Path $runFolder 'run.json'), ($run | ConvertTo-Json), $utf8NoBom)
    try {
      $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
      $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = 'cmd.exe /d /v:off /s /c ""{0}""' -f $wrapperPath  # /s + outer quotes: paths with space plus &()@| keep their quotes
        CurrentDirectory = [IO.Path]::GetFullPath($Dir)
        ProcessStartupInformation = $startup
      } -ErrorAction Stop
    } catch {
      Write-Host "codex-do: Win32_Process.Create failed: $($_.Exception.Message)"
      exit 70
    }
    if ($created.ReturnValue -ne 0) {
      Write-Host "codex-do: Win32_Process.Create failed with ReturnValue $($created.ReturnValue)"
      exit 70
    }
    $childPid = [int]$created.ProcessId
    $wrapperProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $childPid" -ErrorAction SilentlyContinue
    # An already-finished wrapper may disappear before the query; do not invent its date
    # or prevent attachment to its completed log. Live wrappers retain the actual identity.
    $wrapperCreationDate = if ($wrapperProcess -and $null -ne $wrapperProcess.CreationDate) { $wrapperProcess.CreationDate.ToUniversalTime().ToString('o') } else { $null }
    if ($null -eq $wrapperCreationDate) {
      # Supervisor fix 2026-10-10 (Fable P2-2): a transient WMI query miss must not leave a live
      # wrapper without identity (no lock protection, no cancel path). Fall back to Get-Process.
      try { $wrapperCreationDate = (Get-Process -Id $childPid -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o') } catch {}
    }
    $run.wrapperPid = $childPid
    $run.wrapperCreationDate = $wrapperCreationDate
    Update-CodexRunMetadata -Folder $runFolder -Fields @{ wrapperPid = $childPid; wrapperCreationDate = $wrapperCreationDate }
    Write-Host "run: $runId pid: $childPid folder: $runFolder"
    Write-DispatchLockFile -Path $dispatchLockFile -Directory $normalizedDir -StartedUtc $dispatchStartedUtc -ChildPid $childPid -ChildStarted $wrapperCreationDate
    $epochStart = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Write-DispatchLedger -Entry "$epochStart|start|$childPid|$normalizedDir"
    $exitCode = Wait-DetachedRun -Folder $runFolder -Run $run
    $completed = $true
    $epochEnd = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Write-DispatchLedger -Entry "$epochEnd|end|$childPid|$exitCode"
  } finally {
    # An interrupted observer must leave the child's lock and durable files intact.
    if ($completed) {
      Complete-RunObservation -Folder $runFolder -RunId $runId -ExitCode $exitCode -LockPath $dispatchLockFile
    } elseif ($null -eq $childPid) {
      Remove-OwnedDispatchLock -Path $dispatchLockFile -RunId $runId
    }
    if ($createdRunFolder -and $null -eq $childPid) {
      foreach ($name in @('stdin.txt', 'out.log', 'run.cmd', 'run.json', 'complete.ps1')) {
        Remove-Item -LiteralPath (Join-Path $runFolder $name) -Force -ErrorAction SilentlyContinue
      }
      # Non-recursive: remove only this newly created folder, and only if empty.
      [IO.Directory]::Delete($runFolder)
    }
  }
  Write-DispatchSession -Dir $Dir -AccountHome $accountHome -Resume $Resume -RunStarted $runStarted -RunFolder $runFolder
  exit $exitCode
}

try {
  # The cmd.exe shim truncates command-line arguments at the first newline (verified
  # 2026-08-06: multi-line specs silently arrived as their first line only). Multi-line
  # prompts therefore go through stdin, which `codex exec` appends to the prompt.
  $isMultiLine = $promptText -match "`r?`n"
  $runFolder = Join-Path $runsDir $runId
  if (-not (Test-Path -LiteralPath $runFolder -PathType Container)) { $runFolder = '' }
  if ($Resume) {
    $cargs += '-'
    Write-Host "-> $codexBin $($cargs -join ' ')  [resume prompt via stdin, $($promptText.Length) chars]" -ForegroundColor DarkGray
  } elseif ($isMultiLine) {
    $cargs += 'Execute the full task specification provided on stdin.'
    Write-Host "-> $codexBin $($cargs -join ' ')  [multi-line spec via stdin, $($promptText.Length) chars]" -ForegroundColor DarkGray
  } else {
    $cargs += $promptText
    Write-Host "-> $codexBin $($cargs -join ' ')" -ForegroundColor DarkGray
  }
  Write-Host "account: $accountName"
  Write-DispatchTrail

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $stdinTempFile = [System.IO.Path]::GetTempFileName()
  $stdinText = if ($Resume -or $isMultiLine) { $promptText } else { '' }
  [System.IO.File]::WriteAllText($stdinTempFile, $stdinText, $utf8NoBom)

  $nativeArguments = (($cargs | ForEach-Object { ConvertTo-NativeArgument -Argument ([string]$_) }) -join ' ')
  if ($PSVersionTable.PSVersion.Major -le 5) {
    # Start-Process 5.1 rejects inherited environments containing both PATH and Path.
    $processPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::Process)
    [Environment]::SetEnvironmentVariable('PATH', $null, [EnvironmentVariableTarget]::Process)
    [Environment]::SetEnvironmentVariable('Path', $processPath, [EnvironmentVariableTarget]::Process)
  }
  $prevHome = $env:CODEX_HOME
  try {
    if ($accountName -cne 'main') { $env:CODEX_HOME = $accountHome }
    else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    $runStarted = Get-Date
    if ($Resume) {
      $childProcess = Start-Process -FilePath $codexBin -ArgumentList $nativeArguments -WorkingDirectory $Dir -NoNewWindow -PassThru -RedirectStandardInput $stdinTempFile
    } else {
      $childProcess = Start-Process -FilePath $codexBin -ArgumentList $nativeArguments -NoNewWindow -PassThru -RedirectStandardInput $stdinTempFile
    }
  } finally {
    if ($null -eq $prevHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    else { $env:CODEX_HOME = $prevHome }
  }
  $null = $childProcess.Handle
  $childPid = $childProcess.Id
  $attachedChildStarted = $null
  try { $attachedChildStarted = $childProcess.StartTime.ToUniversalTime().ToString('o') } catch {}
  $epochStart = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  Write-DispatchLedger -Entry "$epochStart|start|$childPid|$normalizedDir"
  $ledgerStarted = $true
  Write-DispatchLockFile -Path $dispatchLockFile -Directory $normalizedDir -StartedUtc $dispatchStartedUtc -ChildPid $childPid -ChildStarted $attachedChildStarted

  $childProcess.WaitForExit()
  $childProcess.Refresh()
  $exitCode = $childProcess.ExitCode
  $epochEnd = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  Write-DispatchLedger -Entry "$epochEnd|end|$childPid|$exitCode"
  $ledgerEnded = $true
} finally {
  if ($null -ne $childProcess) {
    try {
      if (-not $childProcess.HasExited) { $childProcess.WaitForExit() }
      $childProcess.Refresh()
      $exitCode = $childProcess.ExitCode
    } catch {}
    if ($ledgerStarted -and -not $ledgerEnded) {
      $epochEnd = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      Write-DispatchLedger -Entry "$epochEnd|end|$childPid|$exitCode"
    }
    try { $childProcess.Dispose() } catch {}
  }
  if ($null -ne $stdinTempFile) {
    try { Remove-Item -LiteralPath $stdinTempFile -Force -ErrorAction SilentlyContinue } catch {}
  }
  if ($ownsDispatchLock) {
    Remove-OwnedDispatchLock -Path $dispatchLockFile -StartedUtc $dispatchStartedUtc
  }
}
if ($runFolder) { [IO.File]::WriteAllText((Join-Path $runFolder 'exit.txt'), [string]$exitCode, (New-Object Text.UTF8Encoding($false))) }
Write-DispatchSession -Dir $Dir -AccountHome $accountHome -Resume $Resume -RunStarted $runStarted -RunFolder $runFolder
exit $exitCode
