# Parse-check PowerShell files for packet VALIDATE blocks. Prints each syntax error; exit 0 = all clean, 1 = errors, 2 = file missing.
# Intent: replace hand-written "ParseFile(...,[ref]$null,[ref]$e)" one-liners, which break under outer-shell quoting and always print 0.
param([Parameter(Mandatory=$true, ValueFromRemainingArguments=$true)][string[]]$Files)
$bad = 0
foreach ($f in $Files) {
  $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($f)
  if (-not [IO.File]::Exists($full)) { Write-Output "MISSING $f"; exit 2 }
  $tokens = $null; $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($full, [ref]$tokens, [ref]$errors)
  if ($errors.Count) {
    $bad += $errors.Count
    foreach ($e in $errors) { Write-Output ("ERROR {0}:{1}: {2}" -f $f, $e.Extent.StartLineNumber, $e.Message) }
  } else { Write-Output "OK $f" }
}
if ($bad) { exit 1 } else { exit 0 }
