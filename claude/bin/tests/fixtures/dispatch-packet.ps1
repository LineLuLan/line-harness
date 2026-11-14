# Shared offline packet and argument adapter; all generated specs stay in the test fixture.
function New-SelftestPacket {
  param([string]$Text = '')
  $packet = @'
TIER: Standard-A
PACKET CHECK: ok
DOCS CHECKED: n/a - disposable offline fixtures
GOAL: Exercise the fake Codex transport.
SUCCESS CRITERIA:
1. Preserve addition.
2. Preserve two arguments.
FILES: fixture-only
CONSTRAINTS: Do not spawn sub-agents. Use only the fake test executable.
DONE WHEN: The fixture assertions pass.
VALIDATE: powershell -NoProfile -File fixture.test.ps1
STOP RULES: Stop if the fake executable is unavailable.
CONTEXT:
'@
  return $packet + "`n" + $Text
}
function ConvertTo-SelftestDispatchArguments {
  param([string[]]$Arguments, [string]$Folder)
  if (@($Arguments | Where-Object { $_ -in @('-Status','-Attach','-Cancel') }).Count) { return $Arguments }
  $result = New-Object 'Collections.Generic.List[string]'
  $switches = @('-Attached','-NoSubAgents','-AllowSubAgents','-Fast','-NoSandboxFallback','-NoRamCheck','-AllowLarge')
  for ($i = 0; $i -lt $Arguments.Count; $i++) {
    $arg = $Arguments[$i]
    if ($arg.StartsWith('-')) {
      $result.Add($arg)
      if ($arg -notin $switches) { $i++; $result.Add($Arguments[$i]) }
    } else {
      $spec = Join-Path $Folder ('dispatch-' + [guid]::NewGuid().ToString('N') + '.txt')
      [IO.File]::WriteAllText($spec, (New-SelftestPacket ($Arguments[$i..($Arguments.Count - 1)] -join ' ')), (New-Object Text.UTF8Encoding($false)))
      $result.Add('-SpecFile'); $result.Add($spec)
      break
    }
  }
  return $result.ToArray()
}
