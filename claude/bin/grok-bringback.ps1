# Intent: keep the wrapper entry out of the dot-sourced library. Status: thin caller. Next: none. Blockers: none. Confidence: bring-back fixtures call this script.
param(
  [Parameter(Mandatory = $true)][string]$RunFolder,
  [Parameter(Mandatory = $true)][int]$GrokExit
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'grok-engine-lib.ps1')
Invoke-GrokBringBack -RunFolder $RunFolder -GrokExit $GrokExit
