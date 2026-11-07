<#
.SYNOPSIS
  Shared account discovery and read-only metadata for Line's Codex wrappers.
.NOTES
  Intent: isolate each login in its own home; authentication is never copied.
  Status: implemented; covered by codex-acc-selftest.ps1 with synthetic data.
  Next: supervisor installs the tested scripts. Blockers: none locally.
  Confidence: local behavior verified; real login is deliberately not exercised.
#>
function Get-CodexAccRoot {
  if ($env:CODEX_ACC_ROOT) { return [IO.Path]::GetFullPath($env:CODEX_ACC_ROOT) }
  return Join-Path $HOME '.codex-accounts'
}
function Get-CodexMainHome {
  if ($env:CODEX_ACC_MAIN_HOME) { return [IO.Path]::GetFullPath($env:CODEX_ACC_MAIN_HOME) }
  return Join-Path $HOME '.codex'
}
function Get-CodexActiveAccount {
  $path = Join-Path (Get-CodexAccRoot) 'active'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return 'main' }
  $name = [IO.File]::ReadAllText($path).Trim()
  if ([string]::IsNullOrWhiteSpace($name)) { return 'main' }
  return $name
}
function Resolve-CodexAccountHome {
  param([string]$Name)
  if ($Name -cnotmatch '\A[a-z0-9][a-z0-9-]{0,31}\z') { throw "codex-acc: invalid account name '$Name'." }
  if ($Name -ceq 'main') { return Get-CodexMainHome }
  $accountHome = Join-Path (Get-CodexAccRoot) $Name
  if (-not (Test-Path -LiteralPath $accountHome -PathType Container)) {
    throw "codex-acc: account '$Name' not found. Run: codex-acc.ps1 list"
  }
  return $accountHome
}
function Test-CodexAccountLoggedIn {
  param([Alias('Home')][string]$AccountHome)
  try {
    $auth = [IO.File]::ReadAllText((Join-Path $AccountHome 'auth.json')) | ConvertFrom-Json -ErrorAction Stop
    return (-not [string]::IsNullOrWhiteSpace([string]$auth.tokens.id_token) -or -not [string]::IsNullOrWhiteSpace([string]$auth.OPENAI_API_KEY))
  } catch { return $false }
}
function Get-CodexAccountInfo {
  param([string]$Name)
  $accountHome = Resolve-CodexAccountHome -Name $Name
  $info = [pscustomobject]@{
    Name = $Name; Home = $accountHome; Active = ($Name -ceq (Get-CodexActiveAccount))
    LoggedIn = (Test-CodexAccountLoggedIn -Home $accountHome)
    Email = $null; Plan = $null; WeeklyUsedPct = $null; WeeklyResetsAt = $null; PrimaryUsedPct = $null
  }
  try {
    $auth = [IO.File]::ReadAllText((Join-Path $accountHome 'auth.json')) | ConvertFrom-Json -ErrorAction Stop
    $payload = ([string]$auth.tokens.id_token).Split('.')[1].Replace('-', '+').Replace('_', '/')
    $payload = $payload.PadRight($payload.Length + ((4 - $payload.Length % 4) % 4), '=')
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json -ErrorAction Stop
    if ($claims.email) { $info.Email = [string]$claims.email }
    if ($claims.'https://api.openai.com/auth'.chatgpt_plan_type) { $info.Plan = [string]$claims.'https://api.openai.com/auth'.chatgpt_plan_type }
  } catch {} # Metadata is optional; do not expose tokens or parser errors.
  try {
    $latest = Get-ChildItem -LiteralPath (Join-Path $accountHome 'sessions') -Filter 'rollout-*.jsonl' -File -Recurse -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -ne $latest) {
      $lines = [IO.File]::ReadAllLines($latest.FullName)
      for ($i = $lines.Length - 1; $i -ge 0; $i--) {
        if (-not $lines[$i].Contains('"rate_limits"')) { continue }
        try {
          $event = $lines[$i] | ConvertFrom-Json -ErrorAction Stop
          $limits = $event.payload.rate_limits
          if ($null -eq $limits) { $limits = $event.rate_limits }
          if ($null -eq $limits) { continue }
          foreach ($window in @($limits.primary, $limits.secondary)) {
            if ($null -eq $window) { continue }
            if ($window.window_minutes -eq 10080) {
              $info.WeeklyUsedPct = $window.used_percent
              if ($null -ne $window.resets_at) {
                try { $info.WeeklyResetsAt = [DateTimeOffset]::FromUnixTimeSeconds([long]$window.resets_at).LocalDateTime.ToString('yyyy-MM-dd HH:mm') } catch {}
              }
            } else { $info.PrimaryUsedPct = $window.used_percent }
          }
          break
        } catch {} # A partially written last JSONL line is harmless.
      }
    }
  } catch {}
  return $info
}
