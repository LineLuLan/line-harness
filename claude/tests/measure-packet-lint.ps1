# Read-only corpus measurement; output contains aggregate counts, never packet text.
param([string]$RunsPath = 'C:\Users\ADMIN\.claude\state\runs')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\bin\packet-lint.ps1')
$files = @(Get-ChildItem -LiteralPath $RunsPath -Filter stdin.txt -File -Recurse -ErrorAction Stop)
$rejected = 0; $groups = @{}; $validationOnly = 0; $invalidValidation = 0
foreach ($file in $files) {
  $result = Test-Packet ([IO.File]::ReadAllText($file.FullName))
  if (-not $result.ok) { $rejected++ }
  foreach ($message in $result.errors) {
    if (-not $groups.ContainsKey($message)) { $groups[$message] = 0 }
    $groups[$message]++
  }
  if ($result.errors -contains 'VALIDATE has no runnable command.' -and $result.errors -notcontains 'Missing VALIDATE: heading.') {
    $invalidValidation++
    if ($result.errors.Count -eq 1) { $validationOnly++ }
  }
}
[pscustomobject]@{
  Total=$files.Count; Rejected=$rejected; Errors=$groups
  InvalidValidateWithHeading=$invalidValidation; RejectedOnlyForValidation=$validationOnly
} | ConvertTo-Json -Depth 4
