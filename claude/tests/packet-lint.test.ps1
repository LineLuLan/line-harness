. (Join-Path $PSScriptRoot 'test-lib.ps1')
. (Join-Path $PSScriptRoot '..\bin\packet-lint.ps1')
$packet = @'
TIER: Important
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
Complete-Tests
