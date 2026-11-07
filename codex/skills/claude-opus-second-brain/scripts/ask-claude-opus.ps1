<#
.SYNOPSIS
  Ask Claude Code Opus/Fable for read-only second-brain feedback.

.DESCRIPTION
  This wrapper lets Codex call Claude as an independent reviewer/planner without granting
  edit or shell permissions. By default Claude can read/search non-secret files in the target
  directory, cannot edit files, cannot run shell commands, does not persist the session, and
  is capped by a small budget. It prefers Claude Opus 5 high, then falls back to Claude Fable 5
  medium, then Claude Opus 4.8 medium for retryable model/context/availability failures.
#>
[CmdletBinding()]
param(
  [string]$Dir = (Get-Location).Path,

  [string[]]$AddDir = @(),

  [ValidateSet('medium','high','xhigh','max')]
  [string]$Effort,

  [string]$PrimaryModel = 'claude-opus-5-5',

  [ValidateSet('medium','high','xhigh','max')]
  [string]$PrimaryEffort = 'high',

  [string]$FallbackModel = 'claude-fable-5-1',

  [ValidateSet('medium','high','xhigh','max')]
  [string]$FallbackEffort = 'medium',

  [string]$FinalFallbackModel = 'claude-opus-4-8',

  [ValidateSet('medium','high','xhigh','max')]
  [string]$FinalFallbackEffort = 'medium',

  [decimal]$MaxBudgetUsd = 2.00,

  [string]$OutFile,

  [string]$UsageFile,

  [switch]$NoUsageSummary,

  # Backward-compatible no-op: read tools are enabled by default unless -NoReadTools is set.
  [switch]$AllowReadTools,

  [switch]$NoReadTools,

  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$Prompt
)

$ErrorActionPreference = 'Stop'

$promptText = (@($Prompt) -join ' ').Trim()
if ([string]::IsNullOrWhiteSpace($promptText)) {
  throw "No prompt provided. Usage: ask-claude-opus.ps1 [-Dir <path>] [-AddDir <path>] [-NoReadTools] '<prompt>'"
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  throw "Claude CLI is not available on PATH."
}

# Verified 2026-08-06: inside a sandboxed `codex exec` (workspace-write) the nested claude
# CLI hangs with no output until timeout (sandbox blocks ~/.claude access). Warn early so
# the caller can abort instead of burning its own timeout budget. See SKILL.md.
if ($env:CODEX_SANDBOX -or $env:CODEX_SANDBOX_NETWORK_DISABLED) {
  Write-Warning "Running inside a Codex sandbox - the claude CLI will likely hang and time out here. Use the desktop/MCP context or 'codex exec -s danger-full-access' instead."
}

$resolvedDirs = @()
if ($NoReadTools) {
  $resolvedDirs = @()
} else {
  $allDirs = @($Dir) + @($AddDir)
  $resolvedDirs = foreach ($path in $allDirs) {
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      (Resolve-Path -LiteralPath $path).Path
    }
  }
  if (-not $resolvedDirs -or $resolvedDirs.Count -eq 0) {
    throw "At least one readable target directory is required unless -NoReadTools is set."
  }
}

$secondBrainPrompt = @"
You are Claude acting as a read-only second brain for Codex.

Rules:
- You may read/search non-secret files in the provided target directories.
- Do not edit files or run shell commands.
- Do not read, request, quote, summarize, or store secrets or raw environment values.
- Do not read .env, .env.*, private keys, token files, credential stores, or production secret stores unless Codex explicitly states the user requested that exact safe action.
- Prioritize blocking correctness, safety, architecture, verification, and simpler alternatives.
- Be concise and actionable.

$promptText
"@

function New-ClaudeArgs {
  param(
    [string]$ModelName,
    [string]$EffortLevel
  )

  $args = @(
    '--model', $ModelName,
    '--effort', $EffortLevel,
    '--permission-mode', 'plan',
    '--no-session-persistence',
    '--max-budget-usd', ([string]$MaxBudgetUsd),
    '--output-format', 'json',
    '--print'
  )

  if ($NoReadTools) {
    $args += @('--tools=""')
  } else {
    $args += @('--add-dir') + @($resolvedDirs) + @('--tools', 'Read,Grep,Glob')
  }

  return $args
}

function Test-TokenLimitError {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $false
  }

  return $Text -match '(?i)(context window|context limit|token limit|tokens? limit|max(?:imum)? context|max(?:imum)? tokens?|too many tokens|input.*too long|prompt.*too long|exceeds?.*(context|tokens?|limit)|request.*too large)'
}

function Test-NonRetryableClaudeError {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $false
  }

  return $Text -match '(?i)(auth|oauth|login|re-authenticate|api key|no api key|budget|maximum budget|permission denied|not allowed|invalid api key)'
}

function Test-FallbackEligibleError {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $true
  }

  if (Test-NonRetryableClaudeError -Text $Text) {
    return $false
  }

  return $Text -match '(?i)(context window|context limit|token limit|tokens? limit|max(?:imum)? context|max(?:imum)? tokens?|too many tokens|input.*too long|prompt.*too long|exceeds?.*(context|tokens?|limit)|request.*too large|model.*(unavailable|not available|unsupported)|overloaded|rate limit|temporarily unavailable|fallback|capacity|classifier|safety)'
}

function Invoke-ClaudePrint {
  param(
    [string]$ModelName,
    [string]$EffortLevel
  )

  $args = New-ClaudeArgs -ModelName $ModelName -EffortLevel $EffortLevel
  $commandOutput = $secondBrainPrompt | & claude @args 2>&1
  [pscustomobject]@{
    Model = $ModelName
    Effort = $EffortLevel
    Output = $commandOutput
    ExitCode = $LASTEXITCODE
  }
}

$modelPlan = @(
  [pscustomobject]@{ Model = $PrimaryModel; Effort = $(if ($Effort) { $Effort } else { $PrimaryEffort }); Reason = 'primary' }
)

if (-not [string]::IsNullOrWhiteSpace($FallbackModel)) {
  $modelPlan += [pscustomobject]@{ Model = $FallbackModel; Effort = $FallbackEffort; Reason = 'primary_failed_retryable' }
}

if (-not [string]::IsNullOrWhiteSpace($FinalFallbackModel)) {
  $modelPlan += [pscustomobject]@{ Model = $FinalFallbackModel; Effort = $FinalFallbackEffort; Reason = 'fallback_failed_retryable' }
}

$usedModel = $modelPlan[0].Model
$usedEffort = $modelPlan[0].Effort
$fallbackReason = $null
$result = $null

for ($i = 0; $i -lt $modelPlan.Count; $i++) {
  $entry = $modelPlan[$i]
  $result = Invoke-ClaudePrint -ModelName $entry.Model -EffortLevel $entry.Effort
  $usedModel = $entry.Model
  $usedEffort = $entry.Effort

  if ($result.ExitCode -eq 0) {
    break
  }

  $errorText = if ($result.Output) { ($result.Output -join [Environment]::NewLine) } else { '' }
  if ($i -ge ($modelPlan.Count - 1) -or -not (Test-FallbackEligibleError -Text $errorText)) {
    break
  }

  if (Test-TokenLimitError -Text $errorText) {
    $fallbackReason = "$($entry.Reason)_token_or_context_limit"
  } else {
    $fallbackReason = "$($entry.Reason)_model_or_availability_error"
  }
}

$output = $result.Output
$exitCode = $result.ExitCode
if ($output) {
  $rawOutput = ($output -join [Environment]::NewLine).Trim()
  $renderedOutput = $rawOutput
  $usageSummary = $null
  $usageJson = $null

  try {
    $json = $rawOutput | ConvertFrom-Json -ErrorAction Stop
    if ($json.result) {
      $renderedOutput = [string]$json.result
    }

    $modelUsage = $json.modelUsage
    $primaryModelName = $null
    $primaryModelUsage = $null
    if ($modelUsage) {
      $modelUsageProperties = @($modelUsage.PSObject.Properties)
      $selectedModelUsage = $modelUsageProperties |
        Where-Object { $_.Name -eq $usedModel } |
        Select-Object -First 1

      if (-not $selectedModelUsage) {
        $selectedModelUsage = $modelUsageProperties |
          Where-Object { $_.Name -like 'claude-fable*' -or $_.Name -like 'claude-opus*' } |
          Select-Object -First 1
      }

      if ($selectedModelUsage) {
        $primaryModelName = $selectedModelUsage.Name
        $primaryModelUsage = $selectedModelUsage.Value
      }
    }

    if (-not $primaryModelUsage -and $json.usage) {
      $primaryModelName = 'aggregate'
      $primaryModelUsage = $json.usage
    }

    if ($primaryModelUsage) {
      $inputTokens = if ($primaryModelUsage.inputTokens -ne $null) { $primaryModelUsage.inputTokens } else { $primaryModelUsage.input_tokens }
      $outputTokens = if ($primaryModelUsage.outputTokens -ne $null) { $primaryModelUsage.outputTokens } else { $primaryModelUsage.output_tokens }
      $cacheReadTokens = if ($primaryModelUsage.cacheReadInputTokens -ne $null) { $primaryModelUsage.cacheReadInputTokens } else { $primaryModelUsage.cache_read_input_tokens }
      $cacheCreateTokens = if ($primaryModelUsage.cacheCreationInputTokens -ne $null) { $primaryModelUsage.cacheCreationInputTokens } else { $primaryModelUsage.cache_creation_input_tokens }
      $costUsd = if ($primaryModelUsage.costUSD -ne $null) { $primaryModelUsage.costUSD } else { $json.total_cost_usd }
      $totalTokensUsed = 0
      foreach ($tokenCount in @($inputTokens, $outputTokens, $cacheReadTokens, $cacheCreateTokens)) {
        if ($tokenCount -ne $null) {
          $totalTokensUsed += [int64]$tokenCount
        }
      }

      $usageObject = [ordered]@{
        model = $primaryModelName
        effort = $usedEffort
        primary_model = $PrimaryModel
        primary_effort = $(if ($Effort) { $Effort } else { $PrimaryEffort })
        fallback_model = $FallbackModel
        fallback_effort = $FallbackEffort
        final_fallback_model = $FinalFallbackModel
        final_fallback_effort = $FinalFallbackEffort
        fallback_reason = $fallbackReason
        total_tokens_used = $totalTokensUsed
        input_tokens = $inputTokens
        output_tokens = $outputTokens
        cache_read_input_tokens = $cacheReadTokens
        cache_creation_input_tokens = $cacheCreateTokens
        total_cost_usd = $costUsd
        total_cli_cost_usd = $json.total_cost_usd
        duration_ms = $json.duration_ms
      }
      $usageJson = $usageObject | ConvertTo-Json -Depth 6
      $usageSummary = @(
        ''
        '[Claude usage]'
        "model: $($usageObject.model)"
        "effort: $($usageObject.effort)"
        "primary_model: $($usageObject.primary_model)"
        "primary_effort: $($usageObject.primary_effort)"
        "fallback_model: $($usageObject.fallback_model)"
        "fallback_effort: $($usageObject.fallback_effort)"
        "final_fallback_model: $($usageObject.final_fallback_model)"
        "final_fallback_effort: $($usageObject.final_fallback_effort)"
        "fallback_reason: $($usageObject.fallback_reason)"
        "total_tokens_used: $($usageObject.total_tokens_used)"
        "input_tokens: $($usageObject.input_tokens)"
        "output_tokens: $($usageObject.output_tokens)"
        "cache_read_input_tokens: $($usageObject.cache_read_input_tokens)"
        "cache_creation_input_tokens: $($usageObject.cache_creation_input_tokens)"
        "total_cost_usd: $($usageObject.total_cost_usd)"
      ) -join [Environment]::NewLine
    }
  } catch {
    $renderedOutput = $rawOutput
  }

  if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
    $outPath = $OutFile
    $parent = Split-Path -Parent $outPath
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path -LiteralPath $parent)) {
      New-Item -ItemType Directory -Path $parent | Out-Null
    }
    Set-Content -LiteralPath $outPath -Value $renderedOutput -Encoding UTF8
  }

  if (-not [string]::IsNullOrWhiteSpace($UsageFile) -and $usageJson) {
    $usagePath = $UsageFile
    $usageParent = Split-Path -Parent $usagePath
    if (-not [string]::IsNullOrWhiteSpace($usageParent) -and -not (Test-Path -LiteralPath $usageParent)) {
      New-Item -ItemType Directory -Path $usageParent | Out-Null
    }
    Set-Content -LiteralPath $usagePath -Value $usageJson -Encoding UTF8
  }

  Write-Output $renderedOutput
  if (-not $NoUsageSummary -and $usageSummary) {
    Write-Output $usageSummary
  }
}
exit $exitCode
