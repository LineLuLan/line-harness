<#
.SYNOPSIS
  Delegate an implementation / GitHub task to Codex (GPT-6.2 Sol by default; -Model gpt-6.2-astra for Standard-B, Important, Critical).

.DESCRIPTION
  Detached by default: WMI launches a wrapper outside Claude Code's background process
  tree. In the 2026-10-09 Windows experiment, both Start-Process variants died when
  Claude stopped the task; Win32_Process.Create survived. Logs and metadata remain
  in CODEX_DO_STATE_DIR\runs (default: ~/.claude/state/runs) for attach and cancel.
  Detached prompts always use stdin and sub-agents are disabled to keep sessions resumable.
  Before exec/resume, a bounded sandbox preflight tries elevated, then unelevated.
  Exit 73 means neither sandbox works; exit 72 means captured output reports a sandbox failure.
  Exit 74 means packet lint failed; 75 is retired (RAM only reports); exit 76 means the
  resume session already used more than 50M tokens: start fresh and report to Line.
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
  -m <Model, default gpt-6.2-sol> -c model_reasoning_effort=high -c service_tier=priority (Fast tier).

  Hybrid policy: Claude pre-fetches context (context7/github MCPs run warm on the
  Claude side) and embeds verified facts into the spec. If Codex needs external info
  mid-task, it reports the blocker and Claude re-delegates (~12s/round). For long multi-turn
  collaborative sessions that genuinely need MCP inside Codex, use the `codex` MCP tool
  (full config) instead of this wrapper.

  Used by Claude Code to hand off CODING / IMPLEMENTATION / GITHUB work to Codex while
  Opus 5.5 keeps planning, debugging, and review. See ~/.claude/CLAUDE.md.

.PARAMETER Dir
  Working root Codex operates in. Defaults to the current directory.

.PARAMETER Engine
  auto (default), codex, or grok (detached worktree isolation and byte-exact bring-back; undo with -Undo).
  Precedence: -Engine codex|grok > env CODEX_DO_ENGINE (codex|grok|auto) > <stateDir>\engine.txt > auto.
  Auto picks grok when the Codex weekly used % (status line cache, CODEX_DO_USAGE_CACHE_DIR overrides
  <TEMP>\ultrathink-status) is >= the ontology's codexUsed3 (fallback 95) with fresh data; Critical packets
  never auto-switch. K6a: -Resume continues on the engine that owns the session (run.json of the newest run for -Dir, or the run whose
  session.txt equals the UUID); -Attached, -Account (ignored) and -Sandbox read-only work on grok.

.PARAMETER SetEngine
  codex, grok or auto: write <stateDir>\engine.txt and print the effective engine; show: print the mode,
  its source and the Codex used %, change nothing. Takes no other option.

.PARAMETER Sandbox
  read-only (analysis), workspace-write (default, edits files), or danger-full-access.
  On grok: read-only = --sandbox read-only plus read/search tools only, and nothing is brought back; the others use grok's workspace profile.

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

.PARAMETER Undo
  Reverse an applied Grok run: a run ID or 'last' (newest applied Grok run; a bound -Dir
  limits 'last' to that Dir). Restores each file only if it still holds the run's bytes,
  takes the Dir lock, starts no worker. Exit 0 all restored or already undone, 79 some
  files skipped, 2 no undo bundle, 3 Dir busy, 64 usage error or unknown run.

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
  # Intent: K5e - engine by precedence (flag > CODEX_DO_ENGINE > engine.txt > auto); auto keeps Codex while it has quota. Status: auto default. Next: host validation. Blockers: none. Confidence: grok-engine tests.
  [ValidateSet('auto','codex','grok')][string]$Engine = 'auto',
  # Intent: K5e - Line swaps the engine any time; 'show' only reads (E4). Status: maintenance path. Next: host -SetEngine show. Blockers: none. Confidence: grok-engine tests.
  [ValidateSet('codex','grok','auto','show')][string]$SetEngine,
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
  # Intent: K5d - reverse an applied Grok run from its undo bundle. Status: maintenance path like -Cancel. Next: host check. Blockers: none. Confidence: grok-engine tests.
  [string]$Undo = '',
  [ValidateRange(1, 2147483647)][int]$Hours = 24,
  [switch]$AllowSubAgents,
  [switch]$NoSubAgents,
  [switch]$AllowLarge,
  [switch]$NoRamCheck,
  [ValidateSet('','low','medium','high','xhigh','max','ultra')]
  [string]$Effort = '',            # explicit reasoning effort; wins over -Fast (Line 2026-09-19: Terra ultra for exploration, Astra xhigh for super-hard)
  [string]$Model = 'gpt-6.2-sol',     # Line 2026-09-28: Sol for Skip + Standard-A; pass -Model gpt-6.2-astra for Standard-B, Important, Critical; gpt-6-luna for exploration tier 1. Line 2026-11-20: 6.2
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Prompt
)

$ErrorActionPreference = 'Stop'
# Intent: reject incompatible Grok flags before lint or account discovery. K6a: -Attached, -Resume, -Account and -Sandbox work on grok now (handled after the engine decision).
# Status: K6a. Next: host validation. Blockers: none. Confidence: early-exit tests.
if ($Engine -eq 'grok' -and -not ($Status -or $Attach -or $Cancel -or $Undo)) {
  # -Fast is accepted and ignored for Grok: the default model is already build-fast (K5c).
  if ($PSBoundParameters.ContainsKey('Model') -and $Model -notlike 'grok*') { Write-Host 'codex-do: -Engine grok requires a grok model'; exit 2 }
  if ($Effort -eq 'ultra') { Write-Host 'codex-do: -Engine grok does not support -Effort ultra'; exit 2 }
}
. (Join-Path $PSScriptRoot 'packet-lint.ps1')
. (Join-Path $PSScriptRoot 'ram-preflight.ps1')
# Intent: K5e - the engine decision lives in the lib, so it loads for every path (it has no param block). Status: unconditional. Next: none. Blockers: none. Confidence: resume baseline copies it.
. (Join-Path $PSScriptRoot 'grok-engine-lib.ps1')
$stateDir = if ($env:CODEX_DO_STATE_DIR) { [IO.Path]::GetFullPath($env:CODEX_DO_STATE_DIR) } else { Join-Path $env:USERPROFILE '.claude\state' }
$ontologyPath = if ($env:ULTRATHINK_ONTOLOGY) { $env:ULTRATHINK_ONTOLOGY } else { Join-Path $PSScriptRoot '..\ontology\harness.ontology.json' }

function Get-DispatchPacket {
  param([string]$Text, [switch]$Status, [switch]$Attach, [switch]$Cancel, [switch]$Resume, [switch]$AllowLarge, [switch]$AllowSubAgents, [switch]$Undo)
  $result = [pscustomobject]@{ ExitCode=0; Text=$Text; Errors=@(); Warnings=@() }
  if ($Status -or $Attach -or $Cancel -or $Undo) { return $result }
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

# Intent: K5e criterion 4 - -SetEngine writes engine.txt atomically or (show) only reads; it needs no packet, no lint and no worker, and reports the effective engine for a non-Critical packet with the active account's Codex used %. Status: maintenance path, exits before lint (E11). Next: host -SetEngine show. Blockers: none. Confidence: grok-engine tests.
if ($PSBoundParameters.ContainsKey('SetEngine')) {
  if (@($PSBoundParameters.Keys | Where-Object { $_ -notin @('SetEngine', 'Verbose', 'Debug', 'ErrorAction', 'WarningAction', 'InformationAction', 'ErrorVariable', 'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer', 'PipelineVariable') }).Count -gt 0) {
    Write-Host 'codex-do: usage error: -SetEngine codex|grok|auto|show is mutually exclusive with dispatch, -Status, -Attach, -Cancel, and -Undo.'
    exit 64
  }
  if ($SetEngine -ne 'show') {
    try { $enginePath = Write-DispatchEngineFile -StateDir $stateDir -Value $SetEngine }
    catch { Write-Host ('codex-do: cannot write engine.txt: ' + ($_.Exception.Message -replace '[\r\n]+', ' ')); exit 1 }
    Write-Host "codex-do: engine mode saved: $SetEngine ($enginePath)"
  }
  . (Join-Path $PSScriptRoot 'codex-acc-lib.ps1')
  $engineCache = $null
  try {
    $engineAccount = Get-CodexActiveAccount
    $engineHome = Resolve-CodexAccountHome -Name $engineAccount
    $engineCache = Read-CodexUsageCache -Path (Get-CodexUsageCachePath -CacheDir (Get-CodexUsageCacheDir) -AccountName $engineAccount -AccountHome $engineHome)
  } catch { $engineCache = $null } # E6: an account error only makes the used % unknown.
  $engineUsed = Get-CodexWeeklyUsed $engineCache
  $engineFile = Read-DispatchEngineFile -StateDir $stateDir
  $engineMode = Get-DispatchEngineMode -EnvValue $env:CODEX_DO_ENGINE -FileValue $engineFile
  $engineThreshold = Get-DispatchEngineThreshold -OntologyPath $ontologyPath
  $engineView = Resolve-DispatchEngine -EnvValue $env:CODEX_DO_ENGINE -FileValue $engineFile -Cache $engineCache -Threshold $engineThreshold
  foreach ($line in @($engineView.messages)) { Write-Host $line }
  Write-Host ('codex-do: engine mode: {0} ({1})' -f $engineMode.mode, $engineMode.origin)
  Write-Host ('codex-do: Codex weekly used: {0}' -f $(if ($null -ne $engineUsed) { Format-CodexUsedPercent -Used $engineUsed -Threshold $engineThreshold } else { 'unknown' }))
  Write-Host ('codex-do: effective engine for a non-Critical packet: {0} ({1}: {2})' -f $engineView.engine, $engineView.source, $engineView.reason)
  exit 0
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
# Intent: -Undo takes only a run and an optional -Dir filter (A1, A6). Status: usage gate before lint. Next: none. Blockers: none. Confidence: exclusivity tests.
if ($PSBoundParameters.ContainsKey('Undo') -and (-not $Undo -or @($PSBoundParameters.Keys | Where-Object { $_ -notin @('Undo', 'Dir', 'Verbose', 'Debug', 'ErrorAction', 'WarningAction', 'InformationAction', 'ErrorVariable', 'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer', 'PipelineVariable') }).Count -gt 0)) {
  Write-Host 'codex-do: usage error: -Undo <runId|last> [-Dir <repo>] is mutually exclusive with dispatch, -Status, -Attach, and -Cancel.'
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
$packet = Get-DispatchPacket -Text $promptText -Status:$Status -Attach:([bool]$Attach) -Cancel:([bool]$Cancel) -Resume:([bool]$Resume) -AllowLarge:$AllowLarge -AllowSubAgents:$AllowSubAgents -Undo:([bool]$Undo)
foreach ($message in $packet.Warnings) { Write-Warning "codex-do: $message" }
if ($packet.ExitCode) {
  foreach ($message in $packet.Errors) { Write-Host "codex-do: $message" }
  exit $packet.ExitCode
}
$promptText = $packet.Text
. (Join-Path $PSScriptRoot 'codex-acc-lib.ps1')
. (Join-Path $PSScriptRoot 'codex-sandbox-lib.ps1')
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
    # Intent: reconnect using durable engine identity. Status: legacy means Codex. Next: host attach/cancel. Blockers: none. Confidence: metadata authority.
    $Engine = if ($run.engine -eq 'grok') { 'grok' } else { 'codex' }
  } catch { Write-Host "codex-do: cannot load run ${runId}: $($_.Exception.Message)"; exit 64 }
}
# Intent: resolve the -Undo run and take Dir from its undo bundle (A1, A6, A7); $runId stays null so the Dir lock carries no runId. Status: K5d. Next: host check. Blockers: none. Confidence: dispatcher tests.
$undoRunId = $null
if ($Undo) {
  $undoRunId = $Undo
  if ($Undo -ceq 'last') {
    $undoFilter = if ($PSBoundParameters.ContainsKey('Dir')) { [IO.Path]::GetFullPath($Dir) } else { '' }
    $undoRunId = Get-GrokUndoCandidate -RunsDir $runsDir -Dir $undoFilter
    if (-not $undoRunId) { Write-Host 'codex-do: no applied Grok run to undo'; exit 2 }
  }
  if ($undoRunId -cnotmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z') { Write-Host 'codex-do: expected an existing run ID or last'; exit 64 }
  $runFolder = Join-Path $runsDir $undoRunId
  if (-not (Test-Path -LiteralPath (Join-Path $runFolder 'run.json'))) { Write-Host "codex-do: unknown run $undoRunId"; exit 64 }
  try { $run = Read-CodexRunMetadata -Folder $runFolder } catch { Write-Host "codex-do: cannot load run ${undoRunId}: $($_.Exception.Message)"; exit 64 }
  if ($run.engine -ne 'grok' -or -not (Test-Path -LiteralPath (Join-Path $runFolder 'undo\undo.json'))) { Write-Host "codex-do: no undo bundle for run $undoRunId"; exit 2 }
  try {
    $Dir = [string]([IO.File]::ReadAllText((Join-Path $runFolder 'undo\undo.json')) | ConvertFrom-Json).dir
    if ([string]::IsNullOrWhiteSpace($Dir)) { throw 'undo bundle has no dir' }
  } catch { Write-Host "codex-do: cannot read the undo bundle of ${undoRunId}: $($_.Exception.Message)"; exit 2 }
  $Engine = 'grok'
}
$accountHome = $null
# Intent: K5e criterion 3 / E6 - a dispatch picks its engine after lint, before the account and the grok-only option fallback: phase (a) flag/env/file;
# a manual grok skips account resolution; phase (b) resolves the account as before (exit 5) and applies the auto rule to that account's cache.
# -Status/-Attach/-Cancel/-Undo never read the cache: their engine comes from run.json (or is codex for -Status).
# Status: K5e. Next: host check. Blockers: none. Confidence: function-level tests (E9) and pre-launch dispatcher tests.
$engineDispatch = -not ($Status -or $Attach -or $Cancel -or $Undo)
$engineSource = ''
$engineDecision = $null
if ($Status) { $Engine = 'codex' }
$resumeOwner = $null
if ($engineDispatch) {
  # Intent: K6a G1 - resolve who owns the -Resume session once, before the engine decision and before Codex account resolution. Status: K6a. Next: host -Resume run. Blockers: none. Confidence: owner fixtures.
  $resumeOwnerName = ''
  if ($Resume) {
    $resumeOwner = Get-GrokResumeOwner -RunsDir $runsDir -Dir $Dir -Resume $Resume
    $resumeOwnerName = $resumeOwner.owner
  }
  $engineArguments = @{
    Explicit = $(if ($PSBoundParameters.ContainsKey('Engine')) { $Engine } else { '' })
    EnvValue = $env:CODEX_DO_ENGINE
    FileValue = (Read-DispatchEngineFile -StateDir $stateDir)
    Tier = [string](Get-PacketSections -Text $promptText).Tier
    Threshold = (Get-DispatchEngineThreshold -OntologyPath $ontologyPath)
    ResumeOwner = $resumeOwnerName
    # V5: the engine line names the owner run, e.g. 'engine grok (file: -Resume continues grok session <id> from run <runId> <start>)'.
    ResumeLabel = $(if ($resumeOwnerName -eq 'grok') { '{0} from run {1} {2}' -f $resumeOwner.session, $resumeOwner.runId, [string]$resumeOwner.run.startedUtc } else { '' })
  }
  $engineMode = Get-DispatchEngineMode -Explicit $engineArguments.Explicit -EnvValue $engineArguments.EnvValue -FileValue $engineArguments.FileValue
  if ($engineMode.mode -eq 'grok' -or $resumeOwnerName -eq 'grok' -or ($Resume -and $engineMode.source -eq 'flag')) {
    $engineDecision = Resolve-DispatchEngine @engineArguments -Cache $null
    if ($engineDecision.exitCode) {
      foreach ($line in @($engineDecision.messages)) { Write-Host $line }
      exit $engineDecision.exitCode
    }
  }
  # Phase (b) resolves the Codex account unless a manual grok stands.
  $Engine = if ($null -ne $engineDecision) { $engineDecision.engine } else { 'codex' }
}
# Intent: Grok dispatch and reconnection never resolve Codex accounts. Status: engine branch. Next: host check. Blockers: none. Confidence: no account dependency in Grok path.
if ($Engine -eq 'codex') {
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
} else { $accountName = ''; $accountHome = '' }
if ($engineDispatch) {
  if ($null -eq $engineDecision) {
    $usageCache = $null
    if ($engineMode.mode -eq 'auto') {
      $usageCache = Read-CodexUsageCache -Path (Get-CodexUsageCachePath -CacheDir (Get-CodexUsageCacheDir) -AccountName $accountName -AccountHome $accountHome)
    }
    $engineDecision = Resolve-DispatchEngine @engineArguments -Cache $usageCache
  }
  foreach ($line in @($engineDecision.messages)) { Write-Host $line }
  if ($engineDecision.exitCode) { exit $engineDecision.exitCode }
  $Engine = $engineDecision.engine
  # U5: run.json engineSource = flag|env|file|auto, or '<source>-fallback' (env-fallback, file-fallback, auto-fallback) when
  # a codex-owned or unknown -Resume turned a grok decision into codex (K6a). A grok decision never falls back, so Get-GrokOptionPlan still sees the plain source.
  $engineSource = $engineDecision.recordSource
  if ($Engine -eq 'grok') {
    Write-Host (Format-DispatchEngineLine $engineDecision)
    $accountName = ''; $accountHome = ''
    # Intent: K6a G7/G12/criterion 4 - -Attached is a no-op on grok (it always runs detached and this observer waits); -Account does not apply. Status: K6a. Next: none. Blockers: none. Confidence: e2e attached scenario.
    if ($Attached) { Write-Host 'codex-do: -Attached is the default on grok (detached + wait)'; $Attached = $false }
    if ($PSBoundParameters.ContainsKey('Account')) { Write-Host 'codex-do: -Account ignored on grok' }
  }
}
# Intent: K6a criterion 3 / G8 - -Sandbox read-only = a read-only grok run (no bring-back); workspace-write and danger-full-access run grok's workspace profile.
# A grok resume keeps the owning run's profile when -Sandbox is omitted and exits 2 when -Sandbox names another one (grok refuses a profile change on resume, probe 6).
# Status: K6a. Next: none. Blockers: none. Confidence: dispatcher tests.
$grokReadOnly = $false
$grokResumeSession = ''
$grokResumeWorktree = ''
if ($Engine -eq 'grok' -and $engineDispatch) {
  if ($Sandbox -eq 'danger-full-access') { Write-Host 'codex-do: grok runs -Sandbox danger-full-access as its workspace profile' }
  $grokReadOnly = $Sandbox -eq 'read-only'
  if ($Resume) {
    $ownerRun = $resumeOwner.run
    # V3: a UUID resume must name the Dir its owner run worked on ('last' is already looked up by Dir).
    if ($Resume -cne 'last' -and -not [string]::Equals([IO.Path]::GetFullPath([string]$ownerRun.dir).TrimEnd('\','/'), [IO.Path]::GetFullPath($Dir).TrimEnd('\','/'), [StringComparison]::OrdinalIgnoreCase)) {
      Write-Host "codex-do: grok session $($resumeOwner.session) belongs to $($ownerRun.dir), not -Dir $([IO.Path]::GetFullPath($Dir))"
      exit 2
    }
    $ownerReadOnly = [string]$ownerRun.sandboxMode -eq 'read-only'
    if (-not $PSBoundParameters.ContainsKey('Sandbox')) { $grokReadOnly = $ownerReadOnly }
    elseif ($grokReadOnly -ne $ownerReadOnly) {
      $ownerProfile = if ($ownerReadOnly) { 'read-only' } else { 'workspace' }
      Write-Host "codex-do: grok session $($resumeOwner.session) was started with sandbox $ownerProfile; -Sandbox $Sandbox cannot resume it"
      exit 2
    }
    # G5: the grok session id must be a UUID like Codex's (probe 1: grok 1.0.88 prints UUIDv7 ids).
    if ($resumeOwner.session -notmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') {
      Write-Host "codex-do: grok run $($resumeOwner.runId) has no session id to resume"
      exit 2
    }
    # G2: grok reopens a session only in the folder it started in (probe 3: a new --cwd fails, "This session's folder no longer exists, so nothing ran"),
    # so the new snapshot goes to the prior run's worktree path (probe 4: resumed there with the same session id). That path must be free.
    $grokResumeWorktree = [string]$ownerRun.worktreeDir
    if (-not $grokResumeWorktree) { Write-Host "codex-do: grok run $($resumeOwner.runId) records no worktree path; cannot resume"; exit 78 }
    # V2: a worktree still at that path is handled under the Dir lock in the launch block (finished run: moved aside; running run: exit 78).
    $grokResumeSession = $resumeOwner.session
    # G9: the 50M rule for grok sums the session's end-event tokens over its runs; no 3-resume counter (prose rule).
    $grokTokens = Get-GrokSessionTokens -RunsDir $runsDir -Session $grokResumeSession
    if ($null -ne $grokTokens -and $grokTokens -gt 50000000) {
      $millions = ($grokTokens / 1000000.0).ToString('0.######', [Globalization.CultureInfo]::InvariantCulture)
      Write-Host "codex-do: session $grokResumeSession already used $($millions)M tokens (> 50M rule) - start a fresh session and report to Line"
      exit 76
    }
    if ($null -eq $grokTokens) { Write-Host "codex-do: warning: token usage unavailable for session $grokResumeSession; continuing resume" }
    $Resume = $grokResumeSession
  }
}
if ($Attached) { $promptText = $promptText.Trim() }
if (-not ($Status -or $Attach -or $Cancel -or $Undo) -and [string]::IsNullOrWhiteSpace($promptText)) {
  throw "No task prompt provided. Usage: codex-do.ps1 [-Dir <path>] [-Sandbox <mode>] [-Fast] [-SpecFile <f>] [-OutFile <f>] '<task>'"
}

# Intent: preserve Line's model choice across resumes instead of silently using dispatch defaults.
# Status: newest matching durable run supplies only omitted flags. Next: supervisor WMI validation.
# Blockers: none for Attached fixtures. Confidence: UUID, last, defaults and override regressions.
# K6a: a grok resume was prepared above (owner, worktree, 50M cap); this block is the unchanged Codex path.
if ($Resume -and $Engine -ne 'grok' -and -not ($Attach -or $Cancel)) {
  $priorRun = $null
  $priorRunId = $null
  $resumeDir = [IO.Path]::GetFullPath($Dir).TrimEnd([char[]]@('\', '/'))
  # Creation time distinguishes runs launched in the same second; metadata writes do not reorder them.
  foreach ($folder in @(Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -cmatch '\A\d{8}-\d{6}-[0-9a-f]{4}\z' } | Sort-Object CreationTimeUtc, Name -Descending)) {
    try {
      $candidate = Read-CodexRunMetadata -Folder $folder.FullName
      # K6a G1: Codex model/effort inheritance never takes a grok-owned run.
      if ($candidate.engine -eq 'grok') { continue }
      # A resolved 'last' UUID must belong to the account being resumed.
      if ($candidate.account -and $candidate.account -ine $accountName) { continue }
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
  # Intent: cap Line's resumed sessions before sandbox probes or worker launch. Status: enforced.
  # Next: supervisor installation. Blockers: missing usage warns and continues. Confidence: fixture regressions.
  $resumeSession = $Resume
  if ($Resume -ceq 'last') {
    $resumeSession = $null
    if ($priorRunId) {
      try {
        $resolvedSession = [IO.File]::ReadAllText((Join-Path (Join-Path $runsDir $priorRunId) 'session.txt')).Trim()
        if ($resolvedSession -match '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') {
          $resumeSession = $resolvedSession
          $Resume = $resolvedSession # Launch exactly the session whose usage was checked.
        }
      } catch {} # No durable session ID: retain Codex's --last fallback below.
    }
  }
  $highestTokens = $null
  if ($resumeSession) {
    try {
      $rollout = Get-ChildItem -LiteralPath (Join-Path $accountHome 'sessions') -Filter "rollout-*-$resumeSession.jsonl" -File -Recurse -ErrorAction Stop |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
      if ($null -ne $rollout) {
        $reader = [IO.File]::OpenText($rollout.FullName)
        try {
          while ($null -ne ($usageLine = $reader.ReadLine())) {
            if (-not $usageLine.Contains('"total_token_usage"')) { continue }
            try {
              $usageEvent = $usageLine | ConvertFrom-Json -ErrorAction Stop
              $tokens = 0L
              if ([long]::TryParse([string]$usageEvent.payload.info.total_token_usage.total_tokens, [ref]$tokens) -and $tokens -ge 0) {
                if ($null -eq $highestTokens -or $tokens -gt $highestTokens) { $highestTokens = $tokens }
              }
            } catch {} # Partial or malformed JSONL events do not hide earlier usage.
          }
        } finally { $reader.Dispose() }
      }
    } catch {} # Missing or unreadable optional telemetry must not prevent a resume.
  }
  if ($null -ne $highestTokens -and $highestTokens -gt 50000000) {
    $millions = ($highestTokens / 1000000.0).ToString('0.######', [Globalization.CultureInfo]::InvariantCulture)
    Write-Host "codex-do: session $resumeSession already used $($millions)M tokens (> 50M rule) - start a fresh session and report to Line"
    exit 76
  }
  if ($null -eq $highestTokens) { Write-Host "codex-do: warning: token usage unavailable for session $Resume; continuing resume" }
}
$codexModel = $Model
$codexEffort = if ($Effort) { $Effort } elseif ($Fast) { 'medium' } else { 'high' }
# Intent: Grok model/effort/speed flags come from one pure lib function; run.json records them. Status: K5c. Next: host timing check. Blockers: none. Confidence: grok-engine tests.
$grokPlan = $null
if ($Engine -eq 'grok' -and -not ($Status -or $Attach -or $Cancel -or $Undo)) {
  # Intent: K5e E1 - a grok chosen by env, file or auto ignores a non-grok -Model and -Effort ultra with one line. Status: K5e. Next: none. Blockers: none. Confidence: Get-GrokOptionPlan tests.
  $grokOptions = Get-GrokOptionPlan -Source $engineSource -Model $Model -ModelGiven:($PSBoundParameters.ContainsKey('Model')) -Effort $Effort -EffortGiven:($PSBoundParameters.ContainsKey('Effort'))
  if ($grokOptions.line) { Write-Host $grokOptions.line }
  $grokPlan = Get-GrokLaunchPlan -Tier ([string](Get-PacketSections -Text $promptText).Tier) -Model $Model -Effort $Effort -Fast:$Fast `
    -ModelGiven:($grokOptions.modelGiven) -EffortGiven:($grokOptions.effortGiven) -ReadOnly:$grokReadOnly -ResumeSession $grokResumeSession
  $codexModel = $grokPlan.model; $codexEffort = $grokPlan.effort
}
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
if ($Engine -eq 'grok') {
  # Intent: resolve Grok without Codex binaries or account state. Status: override supported. Next: host smoke test. Blockers: none. Confidence: explicit missing-binary exit.
  $codexBin = if ($env:GROK_DO_BIN) { $env:GROK_DO_BIN } else { Join-Path $env:USERPROFILE '.grok\bin\grok.exe' }
  if (-not ($Status -or $Attach -or $Cancel -or $Undo) -and -not (Test-Path -LiteralPath $codexBin -PathType Leaf)) {
    Write-Host 'codex-do: grok CLI not found'; exit 73
  }
} elseif (-not [string]::IsNullOrEmpty($env:CODEX_DO_BIN)) {
  $codexBin = $env:CODEX_DO_BIN
} else {
  # Prefer the npm-global codex (0.146+) over the desktop-managed standalone that wins PATH
  # resolution (stuck at 0.135). Falls back to PATH `codex` if the npm shim is absent.
  $codexBin = Join-Path $env:APPDATA 'npm\codex.cmd'
  if (-not (Test-Path $codexBin)) { $codexBin = 'codex' }
}

if (-not ($Status -or $Attached -or $Attach -or $Cancel -or $Undo)) {
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
      # Intent: Grok completion uses its wrapper's exit code. Status: no Codex log interpretation. Next: host test. Blockers: none. Confidence: engine from metadata.
      $failure = if ($Run.engine -eq 'grok') { $null } else { Get-CodexSandboxFailure -Path $outputPath }
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

# Intent: one Dir-lock acquisition shared by dispatch and -Undo (K5d A1: extracted, no behaviour change). Status: stale-lock rules unchanged. Next: none. Blockers: none. Confidence: detach selftest + grok-engine lock test.
function Enter-DispatchDirLock {
  param([string]$Path, [string]$Directory, [string]$StartedUtc)

  $lockRetries = 0
  while ($true) {
    try {
      Write-DispatchLockFile -Path $Path -Directory $Directory -StartedUtc $StartedUtc -ChildPid $null -CreateNew
      return
    } catch [System.IO.IOException], [UnauthorizedAccessException] {
      $existingLock = $null
      $staleStream = $null
      $staleReader = $null
      try {
        $staleStream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
        $staleReader = New-Object IO.StreamReader($staleStream)
        try { $existingLock = $staleReader.ReadToEnd() | ConvertFrom-Json } catch {}
        $lockStarted = [datetime]::MinValue
        $validLock = $null -ne $existingLock -and $existingLock.pidStarted -and
          [datetime]::TryParse([string]$existingLock.pidStarted, [ref]$lockStarted) -and $null -ne $existingLock.pid
        $unreadableFresh = -not $validLock -and
          ([DateTime]::UtcNow - [IO.File]::GetLastWriteTimeUtc($Path)).TotalSeconds -le 60
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
        [IO.File]::Delete($Path)
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
  # Intent: replay wrapper-owned patch results without a second writer. Status: read only. Next: host attach. Blockers: none. Confidence: idempotence fixture.
  if ($Engine -eq 'grok') { Write-GrokApplyResult -RunFolder $Folder }
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
  # Intent: make Grok telemetry durable and independent of Codex rollout discovery. Status: generated from shared parser. Next: host test. Blockers: none. Confidence: JSONL fixture.
  if ($Engine -eq 'grok') {
    $lines += 'function Get-GrokSessionId {{ {0} }}' -f (Get-Command Get-GrokSessionId -CommandType Function).Definition
  }
  foreach ($name in @('Get-DispatchRollouts','Get-DispatchSessionMeta','Get-DispatchParentId','Write-DispatchSubagents','Write-DispatchSession')) {
    $lines += 'function {0} {{ {1} }}' -f $name, (Get-Command $name -CommandType Function).Definition
  }
  $lines += 'try { $run = Get-Content -Raw -LiteralPath (Join-Path $RunFolder ''run.json'') | ConvertFrom-Json; Write-DispatchSession -Dir $run.dir -AccountHome $run.accountHome -Resume $run.resume -RunStarted ([datetime]$run.startedUtc) -RunFolder $RunFolder -Engine $run.engine } catch {}'
  return ($lines -join "`n")
}
function Write-DispatchSession {
  param([string]$Dir, [string]$AccountHome, [string]$Resume, [datetime]$RunStarted, [string]$RunFolder = '', [string]$Engine = 'codex')

  # Intent: choose telemetry by run metadata even in generated complete.ps1. Status: Grok skips rollouts. Next: host check. Blockers: none. Confidence: last JSON sessionId.
  if ($Engine -eq 'grok') {
    $session = Get-GrokSessionId -LogPath (Join-Path $RunFolder 'out.log')
    if ($session -ne 'unknown') {
      try { [IO.File]::WriteAllText((Join-Path $RunFolder 'session.txt'), $session, (New-Object Text.UTF8Encoding($false))) } catch {}
    }
    Write-Host "session: $session"
    return
  }
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
          # Intent: preserve Grok's durable exit 77 in status. Status: metadata-selected engine. Next: host test. Blockers: none. Confidence: no Codex sandbox override.
          if ($metadata.engine -eq 'grok') { $sandboxFailure = $false }
          elseif ($null -eq $metadata.PSObject.Properties['sandboxFailure']) {
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

if (-not ($Attach -or $Cancel -or $Undo)) {
  # Intent: validate Grok's root before any run or lock is created. Status: fail closed. Next: host check. Blockers: none. Confidence: root/HEAD fixtures.
  if ($Engine -eq 'grok') {
    try {
      Test-GrokRepository -Dir $Dir
      $grokRoot = [IO.Path]::GetFullPath($Dir).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
      if (($stateDir.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar).StartsWith($grokRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Grok state directory must be outside the original working tree'
      }
    }
    catch { Write-Host ("codex-do: " + ($_.Exception.Message -replace '[\r\n]+', ' ')); exit 78 }
  }
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
  if ($Engine -eq 'grok') { $selection = [pscustomobject]@{ Mode = $(if ($grokReadOnly) { 'read-only' } else { 'grok-workspace' }) } }
  else {
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

# Intent: -Undo writes Dir only under the same Dir lock a dispatch takes; the lock has this pid and no runId (A1). Status: K5d. Next: host check. Blockers: none. Confidence: lock-refusal and stale-lock tests.
if ($Undo) {
  Enter-DispatchDirLock -Path $dispatchLockFile -Directory $normalizedDir -StartedUtc $dispatchStartedUtc
  $undoCode = 2
  try {
    Write-Host "undo $undoRunId in $Dir"
    $undoCode = Invoke-GrokUndo -RunFolder $runFolder
  } catch {
    Write-Host ("codex-do: undo failed: " + ($_.Exception.Message -replace '[\r\n]+', ' '))
    $undoCode = 79
  } finally { Remove-OwnedDispatchLock -Path $dispatchLockFile -StartedUtc $dispatchStartedUtc }
  exit $undoCode
}

if ($Attach -or $Cancel) {
  if ($Cancel) {
    # Intent: do not kill a live wrapper that owns bring-back; seal a dead one's run with 77 and keep apply.json as written. Status: G3 fix2. Next: host cancel. Blockers: none. Confidence: live and dead wrapper fixtures.
    if ($Engine -eq 'grok' -and (Test-Path -LiteralPath (Join-Path $runFolder 'apply.json')) -and -not (Test-Path -LiteralPath (Join-Path $runFolder 'exit.txt'))) {
      if ((Test-DispatchProcessAlive -ProcessId ([int]$run.wrapperPid) -CreationDate $run.wrapperCreationDate) -or (Test-RunTreeAlive -Folder $runFolder)) {
        Write-Host 'grok bring-back in progress; retry in a few seconds'
        exit 3
      }
      try { Write-GrokExitCode -RunFolder $runFolder -Code 77 } catch { Write-Host "codex-do: cannot publish exit.txt: $($_.Exception.Message)"; exit 71 }
    }
    try { Stop-DetachedRun -Run $run -Folder $runFolder } catch { Write-Host $_.Exception.Message; exit 71 }
    # Intent: cancel without applying partial edits. Status: preserve recovery worktree. Next: host cancellation. Blockers: none. Confidence: wrapper-only bring-back.
    if ($Engine -eq 'grok' -and $run.worktreeDir -and (Test-Path -LiteralPath ([string]$run.worktreeDir))) { Write-Host "grok worktree: kept $($run.worktreeDir)" }
    Remove-OwnedDispatchLock -Path $dispatchLockFile -RunId $runId
    exit 0
  }
  $exitCode = Wait-DetachedRun -Folder $runFolder -Run $run -Replay
  Complete-RunObservation -Folder $runFolder -RunId $runId -ExitCode $exitCode -LockPath $dispatchLockFile
  Write-DispatchSession -Dir $Dir -AccountHome $accountHome -Resume $Resume -RunStarted ([datetime]$run.startedUtc) -RunFolder $runFolder -Engine $Engine
  exit $exitCode
}
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss-') + [guid]::NewGuid().ToString('N').Substring(0, 4)

Enter-DispatchDirLock -Path $dispatchLockFile -Directory $normalizedDir -StartedUtc $dispatchStartedUtc
$ownsDispatchLock = $true

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
  $grokWorktree = $null
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
    # Intent: build Grok's detached snapshot and argument vector under the original Dir lock. Status: no original working-tree writes. Next: host smoke test. Blockers: none. Confidence: library tests.
    if ($Engine -eq 'grok') {
      # K6a G2: a resume recreates the snapshot at the prior run's worktree path (grok reopens a session only in its first folder).
      $worktreeDir = if ($grokResumeWorktree) { $grokResumeWorktree } else { Join-Path (Join-Path $stateDir 'grok-wt') $runId }
      # Intent: V2 (K6a touch-up) - under the Dir lock: a resume needs the prior run finished (exit.txt published, wrapper and tree gone); its kept worktree is moved aside, never deleted,
      # and stale registrations are pruned before worktree add. Status: K6a touch-up. Next: none. Blockers: none. Confidence: e2e resume-kept + dispatcher alive test.
      if ($grokResumeWorktree) {
        $priorFolder = $resumeOwner.folder
        $priorAlive = (Test-DispatchProcessAlive -ProcessId ([int]$resumeOwner.run.wrapperPid) -CreationDate $resumeOwner.run.wrapperCreationDate) -or (Test-RunTreeAlive -Folder $priorFolder)
        if ($priorAlive -or -not (Test-Path -LiteralPath (Join-Path $priorFolder 'exit.txt'))) {
          $why = if ($priorAlive) { 'is still running' } else { 'has no exit.txt (run codex-do.ps1 -Cancel ' + $resumeOwner.runId + ' to seal it)' }
          Write-Host "codex-do: grok run $($resumeOwner.runId) $why; cannot -Resume its session yet"
          exit 78
        }
        try {
          $keptPath = Initialize-GrokResumeWorktree -Dir $Dir -WorktreeDir $worktreeDir
          if ($keptPath) { Write-Host "codex-do: kept worktree of grok run $($resumeOwner.runId) moved to $keptPath" }
        } catch { Write-Host ("codex-do: cannot prepare the resume worktree: " + ($_.Exception.Message -replace '[\r\n]+', ' ')); exit 78 }
      }
      try { $grokWorktree = New-GrokWorktree -Dir $Dir -WorktreeDir $worktreeDir -RunFolder $runFolder }
      catch { Write-Host ("codex-do: " + ($_.Exception.Message -replace '[\r\n]+', ' ')); exit 78 }
      $promptText = "You are a worker in Line's harness. Execute the task packet below. If a SUCCESS CRITERIA line conflicts with CONSTRAINTS, NON-GOALS or existing tests, or if a file outside FILES must change, STOP BEFORE EDITING and report the conflict; do not work around it. Never commit, push, or edit files outside the current directory." + $(if ($grokResumeSession) { ' The working directory has been reset to a fresh snapshot of the original repository; edits from earlier runs that were not applied are gone - re-check the files before editing.' } else { '' }) + "`n`n" + $promptText
      $cargs = @('--prompt-file', $stdinPath, '--cwd', $grokWorktree.worktreeDir) + @($grokPlan.args)
      foreach ($rule in @('Bash(git push*)','Bash(git commit*)','Bash(git reset*)','Bash(git restore*)','Bash(git clean*)','Bash(git worktree*)','Bash(git stash*)','Bash(git checkout*)','Bash(git switch*)','Bash(git checkout-index*)','Bash(git apply*)','Bash(git merge*)','Bash(git rebase*)','Bash(git revert*)','Bash(git cherry-pick*)','Bash(git pull*)','Bash(git am*)','Bash(git read-tree*)','Bash(git config*)','Bash(git -C*)')) {
        $cargs += @('--deny', $rule)
      }
    }
    # Intent: record child-thread telemetry even if the observing dispatcher dies.
    # Status: wrapper publishes exit.txt before running best-effort telemetry.
    # Next: supervisor detached smoke test. Blockers: none. Confidence: synthetic rollouts.
    $completionPath = Join-Path $runFolder 'complete.ps1'
    [IO.File]::WriteAllText($completionPath, (New-DispatchCompletionScript), $utf8NoBom)
    [IO.File]::WriteAllText($stdinPath, $promptText, $utf8NoBom)
    [IO.File]::WriteAllText($outputPath, '', $utf8NoBom)
    if ($Engine -eq 'codex') {
      if ($Resume) { $cargs += '-' } else { $cargs += 'Execute the full task specification provided on stdin.' }
    }
    $nativeArguments = (($cargs | ForEach-Object { ConvertTo-NativeArgument -Argument ([string]$_) }) -join ' ')
    $wrapper = @('@echo off', 'chcp 65001 >nul', ('set "PATH={0}"' -f $env:PATH.Replace('%', '%%')))
    if ($Engine -eq 'codex') {
      if ($accountName -cne 'main') { $wrapper += 'set "CODEX_HOME={0}"' -f $accountHome.Replace('%', '%%') }
      else { $wrapper += 'set "CODEX_HOME="' }
    }
    foreach ($name in @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'OPENAI_BASE_URL', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'CODEX_ACC_MAIN_HOME', 'CODEX_ACC_ROOT', 'CODEX_DO_NOTIFY')) {
      $value = [Environment]::GetEnvironmentVariable($name, 'Process')
      if ($null -ne $value) { $wrapper += 'set "{0}={1}"' -f $name, $value.Replace('%', '%%') }
    }
    # Intent: publish exit only after the single writer finishes bring-back. Status: wrapper owns durability. Next: host conflict test. Blockers: none. Confidence: library exit assertions.
    if ($Engine -eq 'grok') {
      # K6a: no MCP server starts for a grok worker (Get-GrokLaunchPlan env; values have no cmd specials).
      foreach ($name in @($grokPlan.env.Keys)) { $wrapper += 'set "{0}={1}"' -f $name, $grokPlan.env[$name] }
      $wrapper += 'call "{0}" {1} < NUL > "{2}" 2>&1' -f $codexBin, $nativeArguments, $outputPath
      # Intent: release Windows' current-directory handle before worktree removal. Status: save Grok status before cd. Next: host E2E. Blockers: none. Confidence: reproduced directory sharing violation.
      $wrapper += 'set "GROK_EXIT=%ERRORLEVEL%"'
      $wrapper += 'cd /d "{0}"' -f $runFolder
      $wrapper += '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "{0}" -RunFolder "{1}" -GrokExit %GROK_EXIT% > "{2}" 2>&1' -f (Join-Path $PSScriptRoot 'grok-bringback.ps1'), $runFolder, (Join-Path $runFolder 'bring-back.log')
      # Intent: a bring-back script that never starts or dies early still seals the run. Status: G4 fix2. Next: none. Blockers: none. Confidence: run.cmd text test.
      $wrapper += 'if not exist "{0}" (> "{0}.tmp" echo 77 & move /y "{0}.tmp" "{0}" >nul)' -f $exitPath
    } else {
      $wrapper += 'call "{0}" {1} < "{2}" > "{3}" 2>&1' -f $codexBin, $nativeArguments, $stdinPath, $outputPath
      $wrapper += '> "{0}.tmp" echo %ERRORLEVEL%' -f $exitPath
      $wrapper += 'move /y "{0}.tmp" "{0}" >nul' -f $exitPath
    }
    $wrapper += '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "{0}" -RunFolder "{1}" > "{2}" 2>&1' -f $completionPath, $runFolder, (Join-Path $runFolder 'telemetry.log')
    # Intent: notify Line even when the observer has been terminated.
    # Status: notice follows durable exit publication and cannot change exit.txt.
    # Next: desktop smoke test. Blockers: none. Confidence: fixture log assertions.
    $wrapper += '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Sta -File "{0}" -RunFolder "{1}"' -f (Join-Path $PSScriptRoot 'codex-run-notify.ps1'), $runFolder
    [IO.File]::WriteAllText($wrapperPath, (($wrapper -join "`n") + "`n"), $utf8NoBom)
    # K6a G12: the echo cuts the --rules value to 40 characters.
    $echoArgs = if ($Engine -eq 'grok') { Format-GrokArgsEcho -Arguments @($cargs) } else { $cargs -join ' ' }
    Write-Host "-> $codexBin $echoArgs  [detached prompt via stdin, $($promptText.Length) chars]" -ForegroundColor DarkGray
    if ($Engine -eq 'codex') { Write-Host "account: $accountName" }
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
      engineSource = $engineSource                                 # K5e: flag|env|file|auto, or <source>-fallback (U5)
    }
    # Intent: retain original dir/spec hash for locks and ledger linking. Status: additive Grok metadata. Next: host ledger check. Blockers: none. Confidence: isolated worktree address.
    if ($Engine -eq 'grok') {
      $run.engine = 'grok'; $run.worktreeDir = $grokWorktree.worktreeDir; $run.manifest = $grokWorktree.manifest
      # K6a G8: the wrapper's bring-back writes the final answer here before it publishes exit.txt.
      if ($OutFile) { $run.outFile = $OutFile }
    }
    [IO.File]::WriteAllText((Join-Path $runFolder 'run.json'), ($run | ConvertTo-Json), $utf8NoBom)
    try {
      $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
      $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = 'cmd.exe /d /v:off /s /c ""{0}""' -f $wrapperPath  # /s + outer quotes: paths with space plus &()@| keep their quotes
        CurrentDirectory = $(if ($Engine -eq 'grok') { $grokWorktree.worktreeDir } else { [IO.Path]::GetFullPath($Dir) })
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
      # Intent: discard a snapshot only when no worker launched. Status: prune on removal. Next: host launch-failure check. Blockers: none. Confidence: child PID gate.
      if ($null -ne $grokWorktree) { Remove-GrokWorktree -Dir $Dir -WorktreeDir $grokWorktree.worktreeDir }
      foreach ($name in @('stdin.txt', 'out.log', 'run.cmd', 'run.json', 'complete.ps1', 'manifest.json')) {
        Remove-Item -LiteralPath (Join-Path $runFolder $name) -Force -ErrorAction SilentlyContinue
      }
      # Non-recursive: remove only this newly created folder, and only if empty.
      [IO.Directory]::Delete($runFolder)
    }
  }
  Write-DispatchSession -Dir $Dir -AccountHome $accountHome -Resume $Resume -RunStarted $runStarted -RunFolder $runFolder -Engine $Engine
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
