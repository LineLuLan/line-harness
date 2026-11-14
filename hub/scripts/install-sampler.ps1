<#
Intent: register (or remove) the Task Scheduler task that runs the Line Hub system sampler every minute.
Status: v8. The task starts conhost.exe --headless (no console window) -> node <hub>\collector\sample-system.js --quiet,
  as the current user, only while that user is logged on (no stored password). One instance at a time;
  a run that is still busy makes the next start skip (IgnoreNew). Each run stops after 2 minutes at most.
Usage:  powershell -NoProfile -File install-sampler.ps1           # register or update
        powershell -NoProfile -File install-sampler.ps1 -Remove   # unregister
Next: none. Blockers: none. Confidence: syntax-checked; the supervisor registers it.
#>
[CmdletBinding()]
param(
  [switch]$Remove,
  [string]$TaskName = 'LineHub-SystemSample',
  [string]$Node = ''
)
$ErrorActionPreference = 'Stop'
if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed scheduled task $TaskName"
  } else { Write-Output "No scheduled task named $TaskName" }
  return
}
$sampler = Join-Path (Split-Path -Parent $PSScriptRoot) 'collector\sample-system.js'
if (-not (Test-Path -LiteralPath $sampler)) { throw "Sampler not found: $sampler" }
if (-not $Node) { $Node = (Get-Command node.exe -ErrorAction Stop).Source }
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$arguments = '--headless "{0}" "{1}" --quiet' -f $Node, $sampler
$action = New-ScheduledTaskAction -Execute $conhost -Argument $arguments -WorkingDirectory (Split-Path -Parent $sampler)
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Line Hub: one RAM / commit / disk / top-process sample per minute (hub/collector/sample-system.js).' -Force | Out-Null
Write-Output "Registered $TaskName every 1 minute: $conhost $arguments"
