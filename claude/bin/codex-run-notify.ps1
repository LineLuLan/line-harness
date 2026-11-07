<#
.SYNOPSIS
  Notify Line when a detached run finishes, independently of its observer.
.DESCRIPTION
  Logs done/failed, displays a Windows toast, and plays the Stop sound three times.
  CODEX_DO_NOTIFY=0 suppresses toast and sound but retains the log entry.
  Delivery runs in a bounded child: notification failures never change worker exit.
#>
param([Parameter(Mandatory = $true)][string]$RunFolder, [switch]$Deliver)
$ErrorActionPreference = 'Stop'

# Intent: completion survives launcher termination without delaying the worker.
# Status: exit.txt is already published; delivery has a 14-second process budget.
# Next: supervisor checks toast and WPF sound on Line's desktop.
# Blockers: desktop APIs unavailable in headless fixtures. Confidence: log path testable.
if (-not $Deliver) {
  $child = $null
  try {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $PSHOME 'powershell.exe'
    $start.Arguments = '-NoProfile -ExecutionPolicy Bypass -Sta -File "{0}" -RunFolder "{1}" -Deliver' -f $PSCommandPath, $RunFolder.TrimEnd('\')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $child = [Diagnostics.Process]::Start($start)
    if (-not $child.WaitForExit(14000)) { $child.Kill() }
  } catch {} finally { if ($null -ne $child) { $child.Dispose() } }
  exit 0
}

try {
  . (Join-Path $PSScriptRoot 'codex-sandbox-lib.ps1')
  $runId = Split-Path -Leaf $RunFolder
  $code = -1
  try {
    $exitText = [IO.File]::ReadAllText((Join-Path $RunFolder 'exit.txt')).Trim()
    if (-not [int]::TryParse($exitText, [ref]$code)) { $code = -1 }
  } catch {}
  $outputPath = Join-Path $RunFolder 'out.log'
  $tail = @(Get-Content -LiteralPath $outputPath -Tail 200 -ErrorAction SilentlyContinue) -join "`n"
  $failure = Get-CodexSandboxFailure -Text $tail
  # Also catch an early failure that scrolled out of the tail while the observer was gone.
  if (-not $failure) { $failure = Get-CodexSandboxFailure -Path $outputPath }
  $state = if ($code -eq 0 -and -not $failure) { 'done' } else { 'failed' }
  $log = Join-Path (Split-Path -Parent $RunFolder) 'notify.log'
  # Log before touching run.json: locked, missing or corrupt metadata must not
  # erase completion evidence. The folder name and final output are sufficient.
  $entry = '{0}|{1}|{2}|{3}' -f [DateTime]::UtcNow.ToString('o'), $runId, $state, $code
  # Multiple workers may finish together. FileShare.None plus retry preserves each line.
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $stream = $null
    try {
      $stream = [IO.File]::Open($log, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
      $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($entry + "`n")
      $stream.Write($bytes, 0, $bytes.Length)
      break
    } catch [IO.IOException] { Start-Sleep -Milliseconds 25 }
    finally { if ($null -ne $stream) { $stream.Dispose() } }
  }
  if ($env:CODEX_DO_NOTIFY -ne '0') {
    try {
      $sound = Join-Path $env:USERPROFILE '.claude\hooks\notify-sound.ps1'
      if (Test-Path -LiteralPath $sound) {
        # Playback owns its lifetime; the delivery deadline only bounds toast/metadata.
        Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -Sta -File "{0}" -Repeat 3' -f $sound) -WindowStyle Hidden
      }
    } catch {}
  }
  if ($failure) {
    try { Update-CodexRunMetadata -Folder $RunFolder -Fields @{ sandboxFailure = $true } } catch {}
  }
  if ($env:CODEX_DO_NOTIFY -eq '0') { exit 0 }
  $run = Read-CodexRunMetadata -Folder $RunFolder
  $title = if ($state -eq 'done') { 'Codex worker done' } else { 'Codex worker FAILED' }
  $minutes = [Math]::Round(([IO.File]::GetLastWriteTimeUtc((Join-Path $RunFolder 'exit.txt')) - ([datetime]$run.startedUtc).ToUniversalTime()).TotalMinutes, 1)
  $body = '{0} | {1} | exit {2} | {3} min' -f $run.runId, (Split-Path -Leaf $run.dir), $code, $minutes
  try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml(('<toast><visual><binding template="ToastGeneric"><text>{0}</text><text>{1}</text></binding></visual><audio silent="true"/></toast>' -f [Security.SecurityElement]::Escape($title), [Security.SecurityElement]::Escape($body)))
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
  } catch {}
} catch {}
exit 0
