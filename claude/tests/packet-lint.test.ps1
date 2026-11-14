. (Join-Path $PSScriptRoot 'test-lib.ps1')
. (Join-Path $PSScriptRoot '..\bin\packet-lint.ps1')
# Isolation: tests without -Ontology must not read the repo ontology's certified lessons.
$noLessons = Join-Path ([IO.Path]::GetTempPath()) ('lint-nolessons-' + [guid]::NewGuid().ToString('N') + '.json')
[IO.File]::WriteAllText($noLessons, '{"lessons":[]}')
$script:realTestPacket = ${function:Test-Packet}
function Test-Packet {
  param([AllowEmptyString()][string]$Text, [switch]$AllowLarge, [string]$Ontology = $noLessons)
  & $script:realTestPacket -Text $Text -AllowLarge:$AllowLarge -Ontology $Ontology
}
$packet = @'
TIER: Important
TYPE: config
PACKET CHECK: ok
CHECKLIST: ok
DOCS CHECKED: n/a - built-ins
GOAL: test
SUCCESS CRITERIA: passes
FILES:
- claude/bin/a.ps1
CONSTRAINTS: local
DONE WHEN: green
VALIDATE:
- powershell -File tests/a.ps1
STOP RULES: stop
'@
$result = Test-Packet $packet
Assert-True ($result.ok -and $result.errors.Count -eq 0 -and $result.warnings.Count -eq 0) 'valid packet and array-shaped results'
foreach ($heading in @('GOAL','SUCCESS CRITERIA','FILES','CONSTRAINTS','DONE WHEN','VALIDATE','STOP RULES','DOCS CHECKED','PACKET CHECK','CHECKLIST')) {
  Assert-True (-not (Test-Packet ([regex]::Replace($packet, "(?m)^${heading}:.*\r?\n?", ''))).ok) "missing $heading"
}
foreach ($prefix in @('# ', '- ', '**', '## - **')) {
  $markdown = [regex]::Replace($packet, '(?m)^([A-Z][A-Z ]*):', ($prefix + '$1:'))
  Assert-True ((Test-Packet $markdown).ok) "markdown prefix $prefix"
}
Assert-True ((Test-Packet ($packet.Replace('GOAL:', '**GOAL**:').Replace('VALIDATE:', '**VALIDATE:**'))).ok) 'bold heading colon variants'
Assert-True (-not (Test-Packet ($packet.Replace('PACKET CHECK: ok','PACKET CHECK: okay'))).ok) 'marker must be ok'
Assert-True (-not (Test-Packet ($packet.Replace('PACKET CHECK: ok',"PACKET CHECK: no`nok"))).ok) 'ok must be on marker line'
Assert-True (-not (Test-Packet ($packet.Replace('- powershell -File tests/a.ps1','- manually inspect everything'))).ok) 'prose validate rejected'
Assert-True (-not (Test-Packet ($packet.Replace('- powershell -File tests/a.ps1', '').Replace('STOP RULES: stop', "STOP RULES: stop`nnode fake.js"))).ok) 'commands outside validate do not count'
foreach ($command in @('node a.js','npm test','pnpm test','npx tsc','python a.py','pytest','powershell a.ps1','pwsh a.ps1','git diff','dotnet test','cargo test','go test','Get-Item .','Invoke-Thing','Test-Path .','./tests/a.ps1','C:\tests\a.js','tests/a.py','`node a.js`')) {
  Assert-True ((Test-Packet ($packet.Replace('powershell -File tests/a.ps1', $command))).ok) "command $command"
}
Assert-True ((Test-Packet ($packet.Replace('VALIDATE:', 'VALIDATE: git diff').Replace('- powershell -File tests/a.ps1',''))).ok) 'inline command'
Assert-True ((Test-Packet ($packet.Replace('Important','Standard-A').Replace('CHECKLIST: ok',''))).ok) 'standard needs no checklist'
Assert-True (-not (Test-Packet ($packet.Replace('CHECKLIST: ok','') + "`nTIER: Standard-A")).ok) 'first tier controls checklist'
$large = $packet + "`n" + ('x' * 8192)
Assert-True (-not (Test-Packet $large).ok) 'oversized rejected'
Assert-True ((Test-Packet $large -AllowLarge).ok) 'large override'
$boundary = $packet + (' ' * (8192 - [Text.Encoding]::UTF8.GetByteCount($packet)))
Assert-True ((Test-Packet $boundary).ok) 'exact 8 KB accepted'
Assert-True (-not (Test-Packet ($boundary + [char]0xE9)).ok) 'UTF-8 bytes limit'
$many = $packet.Replace('- claude/bin/a.ps1', ((1..9 | ForEach-Object { "- src/file$_.ps1" }) -join "`n"))
Assert-True ((Test-Packet $many).ok -and (Test-Packet $many).warnings.Count -eq 1) 'nine paths only warn'
Assert-True ((Test-Packet ($packet.Replace('PACKET CHECK: ok','PACKET CHECK: ok (checked)').Replace('CHECKLIST: ok','CHECKLIST: ok (reviewed)'))).ok) 'marker explanations allowed'
foreach ($command in @('npm run test:unit','cargo test a::b','1. npm test','2) git diff','Run `npm test` after edits.','tools/check.cmd','C:\tools\check.exe','corepack pnpm test','uv run pytest','mvn test','gradle test','make test','bun test','deno test')) {
  Assert-True ((Test-Packet ($packet.Replace('- powershell -File tests/a.ps1',$command))).ok) "extended validate $command"
}
Assert-True ((Test-Packet ($packet.Replace('- powershell -File tests/a.ps1',"Expected: no errors`nnpm test"))).ok) 'unknown key does not close VALIDATE'
Assert-True ((Test-Packet ($packet.Replace('CONSTRAINTS:','CONSTRAINTS / NON-GOALS:'))).ok) 'combined known heading satisfies both keys'
foreach ($kind in @('Exploration','read-only review','-Sandbox read-only')) {
  $readonly = $packet.Replace('- powershell -File tests/a.ps1','n/a - inspect the diff').Replace('Important',$kind)
  Assert-True ((Test-Packet $readonly).ok) "read-only n/a: $kind"
}
Assert-True (-not (Test-Packet ($packet.Replace('- powershell -File tests/a.ps1','n/a - not needed'))).ok) 'write packet cannot use n/a'
Assert-True (-not (Test-Packet ($packet.Replace('Important','Exploration').Replace('- powershell -File tests/a.ps1','n/a'))).ok) 'n/a needs reason'
foreach ($command in @('n/a (review only).', 'Inspect using `rg -n pattern src`.', 'Select-String -Path src/*.ps1 -Pattern test','find /n "word" file.txt','javac -d out Test.java','java -cp out Test')) {
  Assert-True ((Test-Packet ($packet.Replace('Important','Exploration').Replace('- powershell -File tests/a.ps1',$command))).ok) "observed validation syntax $command"
}
foreach ($command in @('cd src; npm test', 'cd "path with spaces"; git diff', '$env:MODE="test"; pnpm test', '$env:X="one;two"; cd src; node test.js', 'Measure-Command { npm test }')) {
  Assert-True ((Test-Packet ($packet.Replace('- powershell -File tests/a.ps1',$command))).ok) "prefixed command: $command"
}
foreach ($prose in @('make sure','go through','find the errors','make certain everything works')) {
  Assert-True (-not (Test-Packet ($packet.Replace('- powershell -File tests/a.ps1',$prose))).ok) "reject prose: $prose"
}
foreach ($command in @('make test','go test ./...','find /n "word" file.txt')) {
  Assert-True ((Test-Packet ($packet.Replace('- powershell -File tests/a.ps1',$command))).ok) "keep executable syntax: $command"
}
$ontology = Join-Path $PSScriptRoot 'fixtures/packet-lessons.json'
$result = Test-Packet $packet -Ontology $ontology
Assert-True (-not $result.ok -and $result.errors.Count -eq 1 -and $result.errors[0] -match '\[resolve-conflicts\]') 'Important requires applicable lesson'
$covered = $packet + "`nKNOWN PITFALLS:`n- [resolve-conflicts] Resolve conflicting requirements."
$result = Test-Packet $covered -Ontology $ontology
Assert-True ($result.ok -and $result.warnings.Count -eq 0) 'applicable lesson present is clean; draft and deprecated ignored'
$result = Test-Packet ($packet.Replace('Important','Critical')) -Ontology $ontology
Assert-True (-not $result.ok) 'Critical requires applicable lesson'
$result = Test-Packet ($packet.Replace('Important','Standard-B')) -Ontology $ontology
Assert-True ($result.ok -and $result.warnings.Count -eq 1 -and $result.warnings[0] -match '\[resolve-conflicts\]') 'Standard-B missing lesson warns only'
Assert-True ((Test-Packet ($packet.Replace('TYPE: config','TYPE: ui')) -Ontology $ontology).ok) 'type filter excludes config lesson'
Assert-True ((Test-Packet ($packet.Replace('Important','Exploration')) -Ontology $ontology).ok) 'tier filter excludes lesson'
Assert-True (-not (Test-Packet ($packet + "`nCONTEXT: [resolve-conflicts]") -Ontology $ontology).ok) 'lesson outside pitfalls does not count'
Assert-True (-not (Test-Packet ($packet + "`nKNOWN PITFALLS: [resolve-conflicts-extra]") -Ontology $ontology).ok) 'lesson id must match exactly'
$inline = $packet.Replace('TIER: Important', 'TIER: Important | worker=example | TYPE: config | Dir = root')
# Remove the standalone type with either source line ending.
$inline = [regex]::Replace($inline, '(?m)^TYPE: config\r?\n', '')
Assert-True (-not (Test-Packet $inline -Ontology $ontology).ok) 'inline TYPE and first tier token select lesson'
Assert-True (-not (Test-Packet ($inline + "`nTYPE: ui") -Ontology $ontology).ok) 'inline TYPE takes precedence over standalone TYPE'
foreach ($body in @('type: ui', 'Type: ui', 'TYPE: document the format', ' TYPE: ui', '- TYPE: ui', 'TYPE: UI', 'TYPE: ui')) {
  $bodyPacket = $inline.Replace('- powershell -File tests/a.ps1', ($body + "`n- powershell -File tests/a.ps1"))
  $result = Test-Packet $bodyPacket -Ontology $ontology
  Assert-True ($result.errors.Count -eq 1 -and $result.errors[0] -match '\[resolve-conflicts\]') "TYPE body preserves VALIDATE and inline type: $body"
}
foreach ($typeHeading in @('TYPE: config', '## TYPE: config', '**TYPE**: config', '**TYPE:** config', '**TYPE: config**', '## **TYPE:** config')) {
  $typed = [regex]::Replace($packet, '(?m)^TYPE: config\r?\n', '')
  $typed = $typed.Replace('- powershell -File tests/a.ps1', ($typeHeading + "`n- powershell -File tests/a.ps1"))
  $result = Test-Packet $typed -Ontology $ontology
  Assert-True ($result.errors.Count -eq 1 -and $result.errors[0] -match '\[resolve-conflicts\]' -and $result.warnings.Count -eq 0) "standalone TYPE never closes VALIDATE: $typeHeading"
}
foreach ($tierValue in @('Important,', 'important', 'Important.', 'Critical/Important', 'CRITICAL')) {
  $result = Test-Packet ($packet.Replace('Important', $tierValue)) -Ontology $ontology
  Assert-True ($result.errors.Count -eq 1 -and $result.errors[0] -match '\[resolve-conflicts\]') "tier normalization enforces lesson: $tierValue"
  $result = Test-Packet ($covered.Replace('Important', $tierValue)) -Ontology $ontology
  Assert-True ($result.ok -and $result.warnings.Count -eq 0) "covered normalized tier is clean: $tierValue"
  $result = Test-Packet ($covered.Replace('Important', $tierValue).Replace('CHECKLIST: ok', '')) -Ontology $ontology
  Assert-True ($result.errors -contains 'Missing CHECKLIST: ok.') "normalized tier retains checklist rule: $tierValue"
}
$untyped = [regex]::Replace($packet, '(?m)^TYPE: config\r?\n', '')
foreach ($body in @('type: config', 'Type: config', 'TYPE: config prose', ' TYPE: config', '- TYPE: config', 'TYPE: CONFIG', '## Type: config')) {
  $bodyPacket = $untyped.Replace('- powershell -File tests/a.ps1', ($body + "`n- powershell -File tests/a.ps1"))
  $result = Test-Packet $bodyPacket -Ontology $ontology
  Assert-True ($result.ok -and $result.warnings.Count -eq 1 -and $result.warnings[0] -eq 'add TYPE: to receive typed lessons') "body TYPE lookalike is not metadata: $body"
}
$result = Test-Packet $untyped -Ontology $ontology
Assert-True ($result.ok -and $result.warnings -contains 'add TYPE: to receive typed lessons') 'untyped Important warns and skips typed lessons'
$result = Test-Packet ($untyped.Replace('Important','Standard-B')) -Ontology $ontology
Assert-True ($result.ok -and $result.warnings.Count -eq 0) 'untyped standard skips typed lessons quietly'
$result = Test-Packet ($packet.Replace('TYPE: config','TYPE: unknown')) -Ontology $ontology
Assert-True ($result.ok -and $result.warnings[0] -match 'Unknown TYPE') 'unknown TYPE warns'
Assert-True ((Test-Packet $packet -Ontology (Join-Path $PSScriptRoot 'fixtures/missing-ontology.json')).ok) 'missing ontology skips lesson checks'
$folder = New-TestFolder
try {
  $file = Join-Path $folder 'ontology.json'
  [IO.File]::WriteAllText($file, '{}')
  Assert-True ((Test-Packet $packet -Ontology $file).ok) 'missing lessons block skips checks'
  $o = Get-Content -Raw $ontology | ConvertFrom-Json
  $o.lessons[0].appliesTo = @{ types = @('*'); tiers = @('*') }
  [IO.File]::WriteAllText($file, ($o | ConvertTo-Json -Depth 10))
  Assert-True (-not (Test-Packet $untyped -Ontology $file).ok) 'wildcard lesson applies without TYPE'
  $result = Test-Packet ($untyped.Replace('Important','Skip')) -Ontology $file
  Assert-True ($result.ok -and $result.warnings.Count -eq 1) 'wildcard lesson applies to Skip as warning'
  foreach ($badJson in @('{"lessons": [', '{"lessons":[],"Lessons":[]}')) {
    [IO.File]::WriteAllText($file, $badJson)
    $result = $null
    try { $result = Test-Packet $packet -Ontology $file } catch { }
    Assert-True ($null -ne $result -and $result.ok -and $result.errors.Count -eq 0 -and
      $result.warnings.Count -eq 1 -and $result.warnings[0] -eq 'ontology unreadable: lesson checks skipped') 'malformed ontology returns one warning under Stop'
  }
} finally { Remove-TestFolder $folder }
Complete-Tests
