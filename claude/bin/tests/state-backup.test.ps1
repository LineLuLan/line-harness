# Intent: verify evidence selection, safe retention, and error output using temp folders only.
# Status: fixture test. Next: supervisor registers the weekly task. Blockers: none. Confidence: zip entries and exit codes.
$ErrorActionPreference = 'Stop'
$backupScript = Join-Path $PSScriptRoot '..\state-backup.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('state backup fixture-' + [guid]::NewGuid().ToString('N'))
$stateDir = Join-Path $fixture 'state with spaces'
$backupDir = Join-Path $fixture 'backup with spaces'
$utf8 = New-Object Text.UTF8Encoding($false)
$passed = 0
$failed = 0
function Assert-True($Condition, [string]$Name) {
    if ($Condition) { $script:passed++; Write-Host "PASS $Name" }
    else { $script:failed++; Write-Host "FAIL $Name" }
}
function Write-Fixture([string]$RelativePath, [string]$Text) {
    $path = Join-Path $stateDir $RelativePath
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
    [IO.File]::WriteAllText($path, $Text, $utf8)
}
try {
    [void][IO.Directory]::CreateDirectory($stateDir)
    [void][IO.Directory]::CreateDirectory($backupDir)
    Write-Fixture 'runs\x.log' 'exclude run'
    Write-Fixture 'dispatch-locks\a.json' 'exclude lock'
    Write-Fixture 'allow-push-once' 'exclude flag'
    Write-Fixture 'allow-push-once.json' 'exclude flag with allowed extension'
    Write-Fixture 'findings.jsonl' 'finding'
    Write-Fixture 'sub\r.log' 'review'
    Write-Fixture 'a.txt' 'exclude text'
    foreach ($name in @('state-20000101-000000.zip', 'state-20000102-000000.zip', 'state-20000103-000000.zip', 'other.zip')) {
        [IO.File]::WriteAllText((Join-Path $backupDir $name), 'fixture', $utf8)
    }

    $output = @(& (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $backupScript -StateDir $stateDir -BackupDir $backupDir -Keep 2 2>&1)
    Assert-True ($LASTEXITCODE -eq 0 -and $output.Count -eq 1 -and $output[0] -match ('^state-backup: 2 files, \d+ KB -> ' + [regex]::Escape($backupDir) + '\\state-\d{8}-\d{6}\.zip$')) 'one success line and exit 0'
    $backups = @(Get-ChildItem -LiteralPath $backupDir -File | Where-Object { $_.Name -match '^state-\d{8}-\d{6}\.zip$' } | Sort-Object Name -Descending)
    Assert-True ($backups.Count -eq 2 -and $backups[1].Name -ceq 'state-20000103-000000.zip') 'keeps newest two snapshots by name'
    Assert-True ((Test-Path -LiteralPath (Join-Path $backupDir 'other.zip')) -and -not (Test-Path -LiteralPath (Join-Path $backupDir 'state-20000102-000000.zip'))) 'unrelated zip survives pruning'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($backups[0].FullName)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') } | Sort-Object)
        Assert-True ($names.Count -eq 2 -and $names[0] -ceq 'findings.jsonl' -and $names[1] -ceq 'sub/r.log') 'zip holds exactly eligible evidence'
    } finally { $zip.Dispose() }

    $missing = Join-Path $fixture 'missing state'
    $errorOutput = @(& (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $backupScript -StateDir $missing -BackupDir $backupDir 2>&1)
    Assert-True ($LASTEXITCODE -eq 1 -and $errorOutput.Count -eq 1 -and $errorOutput[0] -ceq 'state-backup: failed: DirectoryNotFoundException') 'missing state fails without path disclosure'
} finally {
    $full = [IO.Path]::GetFullPath($fixture)
    if ((Split-Path $full -Parent) -ne ([IO.Path]::GetTempPath()).TrimEnd('\') -or (Split-Path $full -Leaf) -notlike 'state backup fixture-*') { throw 'Unsafe test cleanup' }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}
Write-Host "PASS: $passed FAIL: $failed"
if ($failed) { exit 1 }
