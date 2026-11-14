. (Join-Path $PSScriptRoot 'test-lib.ps1')
$writer = Join-Path $PSScriptRoot '..\bin\ledger-add.ps1'
$fixture = New-TestFolder
try {
  $path = Join-Path $fixture 'nested\ledger.log'
  $params = @{ Tier='Important'; Layer2='yes'; L1='0'; L2='1'; L3='0'; Note='Line fixture'; Worker='fixture-model'; Type='review'; FailRounds=1; Findings='L1:0,L2:1,L3:0'; Path=$path }
  $line = & $writer @params -RunIds a,b
  $expected = (Get-Date -Format yyyy-MM-dd) + '|Important|yes|0|1|0|Line fixture|worker=fixture-model|type=review|fail_rounds=1|findings=L1:0,L2:1,L3:0|runs=a,b'
  Assert-True ($line -ceq $expected -and [IO.File]::ReadAllText($path) -ceq ($expected + "`n")) 'exact one line and printed result'
  $null = & $writer @params
  $bytes = [IO.File]::ReadAllBytes($path)
  Assert-True ($bytes[0] -ne 239 -and [IO.File]::ReadAllLines($path).Count -eq 2) 'append without BOM'
  foreach ($pair in @(@('Tier','wrong'), @('Layer2','maybe'), @('Type','code'), @('Findings','L1:1,L2:2'), @('Findings','L1:-1,L2:0,L3:0'), @('FailRounds',-1), @('Note','a|b'), @('Worker',"a`nb"), @('L2',"a`rb"), @('RunIds',@('a',"b|c")))) {
    $bad = $params.Clone(); $bad[$pair[0]] = $pair[1]
    Assert-Throws { & $writer @bad } "reject $($pair[0]): $($pair[1])"
  }
  Assert-True ([IO.File]::ReadAllLines($path).Count -eq 2) 'rejects leave ledger unchanged'
  $mixed = $params.Clone(); $mixed.Tier='important'; $mixed.Layer2='YES'; $mixed.Type='UI'
  $normal = & $writer @mixed
  Assert-True ($normal -cmatch '\|Important\|yes\|' -and $normal -cmatch '\|type=ui\|') 'enum case normalised'
  foreach ($code in @(0x2028,0x2029,0x0B,0x0C)) {
    $bad = $params.Clone(); $bad.Note = 'before' + [char]$code + 'after'
    Assert-Throws { & $writer @bad } "reject line separator $code"
  }
  $profileBefore = $env:USERPROFILE
  try {
    $env:USERPROFILE = $fixture
    $default = $params.Clone(); $default.Remove('Path')
    $null = & $writer @default
    Assert-True (Test-Path (Join-Path $fixture '.claude\state\review-ledger.log')) 'default path in test profile'
  } finally { $env:USERPROFILE = $profileBefore }

  # -SpecFile run linking against a fake runs root (never the real runs folder).
  $runsRoot = Join-Path $fixture 'runs'
  $utf8 = New-Object Text.UTF8Encoding($false)
  function New-FakeRun([string]$Id, [datetime]$Started, [string]$Stdin, $Sha) {
    $folder = Join-Path $runsRoot $Id
    [void][IO.Directory]::CreateDirectory($folder)
    $meta = [ordered]@{ runId = $Id; dir = 'D:\x'; startedUtc = $Started.ToUniversalTime().ToString('o') }
    if ($null -ne $Sha) { $meta.specFile = 'D:\x\p.md'; $meta.specSha256 = $Sha }
    [IO.File]::WriteAllText((Join-Path $folder 'run.json'), ($meta | ConvertTo-Json), $utf8)
    [IO.File]::WriteAllText((Join-Path $folder 'stdin.txt'), $Stdin, $utf8)
  }
  function Get-Sha([string]$File) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return -join ($h.ComputeHash([IO.File]::ReadAllBytes($File)) | ForEach-Object { $_.ToString('x2') }) } finally { $h.Dispose() }
  }
  $spec = Join-Path $fixture 'packet.md'
  [IO.File]::WriteAllText($spec, "GOAL: link runs.  `r`nSUCCESS CRITERIA: x`r`n`r`n", $utf8)
  $sha = Get-Sha $spec
  $now = Get-Date
  New-FakeRun '20261101-100000-aaa1' $now.AddHours(-2) 'different text' $sha          # hash match, newer
  New-FakeRun '20261101-090000-aaa2' $now.AddHours(-3) "GOAL: link runs.`nSUCCESS CRITERIA: x`nCONSTRAINTS: Do not spawn sub-agents.`n" $null  # stdin fallback with appended line
  New-FakeRun '20261101-080000-aaa3' $now.AddDays(-15) 'GOAL: link runs.' $sha        # older than 14 days
  New-FakeRun '20261101-070000-aaa4' $now.AddHours(-1) "GOAL: link runs.`nSUCCESS CRITERIA: x" ('0' * 64)  # hash present but different: no fallback
  New-FakeRun '20261101-060000-aaa5' $now.AddHours(-4) "GOAL: other`n" $null          # stdin mismatch
  $linkPath = Join-Path $fixture 'link.log'
  $link = $params.Clone(); $link.Path = $linkPath
  $linked = & $writer @link -SpecFile $spec -RunsRoot $runsRoot
  $base = (Get-Date -Format yyyy-MM-dd) + '|Important|yes|0|1|0|Line fixture|worker=fixture-model|type=review|fail_rounds=1|findings=L1:0,L2:1,L3:0'
  Assert-True ($linked -ceq ($base + '|runs=20261101-090000-aaa2,20261101-100000-aaa1')) 'hash + stdin fallback matches sorted by start, old and mismatched ignored'
  $explicit = & $writer @link -SpecFile $spec -RunsRoot $runsRoot -RunIds x1
  Assert-True ($explicit -ceq ($base + '|runs=x1')) 'explicit -RunIds wins over -SpecFile'
  $plain = & $writer @link
  Assert-True ($plain -ceq $base) 'line format unchanged without -SpecFile'

  $lone = Join-Path $fixture 'lone.md'
  [IO.File]::WriteAllText($lone, "GOAL: nothing ran this.`n", $utf8)
  $errFile = Join-Path $fixture 'stderr.txt'
  $outFile = Join-Path $fixture 'stdout.txt'
  $noMatchPath = Join-Path $fixture 'nomatch.log'
  $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$writer,'-Tier','Important','-Layer2','yes','-L1','0','-L2','1','-L3','0','-Note','Line fixture','-Worker','fixture-model','-Type','review','-FailRounds','1','-Findings','L1:0,L2:1,L3:0','-Path',$noMatchPath,'-SpecFile',$lone,'-RunsRoot',$runsRoot)
  $proc = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList ($argList | ForEach-Object { '"' + $_ + '"' }) -NoNewWindow -Wait -PassThru -RedirectStandardError $errFile -RedirectStandardOutput $outFile
  $errText = [IO.File]::ReadAllText($errFile)
  Assert-True ($proc.ExitCode -eq 0 -and $errText -match 'no codex-do run matched the spec') 'no match: warning on stderr, exit 0'
  Assert-True ([IO.File]::ReadAllText($noMatchPath) -ceq ($base + "`n")) 'no match: line still written without runs field'
} finally { Remove-TestFolder $fixture }
Complete-Tests
