# Intent: retain weekly snapshots of small harness evidence without worker runs or push flags.
# Status: fixture-covered. Next: supervisor installs the scheduled task and runs one host backup.
# Blockers: none. Confidence: temporary zip rename and retention fixture.
[CmdletBinding()]
param(
    [string]$StateDir = "$env:USERPROFILE\.claude\state",
    [string]$BackupDir = 'D:\Backups\state',
    [int]$Keep = 8
)
$ErrorActionPreference = 'Stop'
$tempPath = $null
try {
    if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) { throw [IO.DirectoryNotFoundException]::new() }
    if ($Keep -lt 1) { throw [ArgumentOutOfRangeException]::new('Keep') }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression

    $root = [IO.Path]::GetFullPath($StateDir).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $files = New-Object 'Collections.Generic.List[IO.FileInfo]'
    $folders = New-Object 'Collections.Generic.Stack[string]'
    $folders.Push($StateDir)
    while ($folders.Count -gt 0) {
        foreach ($item in @(Get-ChildItem -LiteralPath $folders.Pop() -Force)) {
            if ($item.PSIsContainer) {
                if ($item.Name -notin @('runs', 'dispatch-locks')) { $folders.Push($item.FullName) }
            } elseif ($item.Name -notlike 'allow-push*' -and $item.Extension -in @('.jsonl', '.log', '.json')) {
                $files.Add($item)
            }
        }
    }
    [void][IO.Directory]::CreateDirectory($BackupDir)
    $name = 'state-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip'
    $zipPath = Join-Path $BackupDir $name
    if (Test-Path -LiteralPath $zipPath) { throw [IO.IOException]::new() }
    $tempPath = Join-Path $BackupDir ('.' + $name + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $bytes = [long]0
    $stream = [IO.File]::Open($tempPath, [IO.FileMode]::CreateNew)
    try {
        $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($file in $files) {
                $entryName = $file.FullName.Substring($root.Length).Replace('\', '/')
                [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
                $bytes += $file.Length
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
    [IO.File]::Move($tempPath, $zipPath)
    $tempPath = $null

    $backups = @(Get-ChildItem -LiteralPath $BackupDir -File |
        Where-Object { $_.Name -match '^state-\d{8}-\d{6}\.zip$' } | Sort-Object Name -Descending)
    foreach ($oldBackup in ($backups | Select-Object -Skip $Keep)) { Remove-Item -LiteralPath $oldBackup.FullName -Force }
    $kb = [int][math]::Ceiling($bytes / 1KB)
    Write-Output ('state-backup: {0} files, {1} KB -> {2}' -f $files.Count, $kb, $zipPath)
    exit 0
} catch {
    if ($tempPath -and (Test-Path -LiteralPath $tempPath)) {
        try { Remove-Item -LiteralPath $tempPath -Force } catch {}
    }
    Write-Output ('state-backup: failed: ' + $_.Exception.GetType().Name)
    exit 1
}
