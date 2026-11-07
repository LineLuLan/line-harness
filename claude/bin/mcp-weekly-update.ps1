# Intent: keep Line's pinned MCP packages current with validated, reversible config edits.
# Status: fixture-covered; logs contain package metadata only, never tool output or config lines.
# Next: supervisor installs the weekly task and smoke-tests toast delivery.
# Blockers: desktop toast unavailable in headless tests. Confidence: byte-preservation and rollback fixtures.
[CmdletBinding()]
param(
    [string]$ConfigPath = "$env:USERPROFILE\.codex\config.toml",
    [string]$CodexBin,
    [string]$NpmBin = 'npm.cmd',
    [string]$CodegraphBin,
    [string]$LogPath = "$env:USERPROFILE\.claude\state\mcp-weekly-update.log",
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$entries = New-Object Collections.ArrayList
$backup = $null
$writeStarted = $false
$validated = $false
$edits = @()
# The runner joins its private job BEFORE launching a CLI shim. Killing its exact
# PID closes the job's sole handle and terminates every tool descendant as well.
# This mirrors codex-sandbox-lib's job limits without copying tool output to disk.
$runner = @'
$ErrorActionPreference = 'Stop'
try {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class McpWeeklyJob {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long processTime, jobTime;
        public uint flags;
        public UIntPtr minimumWorkingSet, maximumWorkingSet;
        public uint activeProcessLimit;
        public UIntPtr affinity;
        public uint priorityClass, schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong readOperations, writeOperations, otherOperations, readBytes, writeBytes, otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits basic;
        public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    // Hold the non-inheritable job handle until this runner exits or is killed.
    static IntPtr job;
    public static void Enter() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.basic.flags = 0x2000;
        if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(limits))) throw new Win32Exception();
        using (var process = Process.GetCurrentProcess()) {
            if (!AssignProcessToJobObject(job, process.Handle)) throw new Win32Exception();
        }
    }
}
"@
    [McpWeeklyJob]::Enter()
    # Native stderr can contain sensitive diagnostics; the outer runner drains it without logging.
    $ErrorActionPreference = 'Continue'
    # Process.Start keeps the quoted command verbatim; PS 5.1 '&' re-quotes it and breaks
    # tool paths with spaces such as C:\Program Files\nodejs\npm.cmd (live failure 2026-10-12).
    $tool = New-Object Diagnostics.Process
    $tool.StartInfo.FileName = $env:ComSpec
    $tool.StartInfo.Arguments = '/d /v:off /s /c ' + $env:MCP_WEEKLY_COMMAND
    $tool.StartInfo.UseShellExecute = $false
    [void]$tool.Start()
    $tool.WaitForExit()
    exit $tool.ExitCode
} catch { exit 1 }
'@
$encodedRunner = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))

function Resolve-Tool([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
    return $null
}
function Invoke-BoundedTool([string]$Executable, [string[]]$Arguments) {
    $child = $null
    try {
        $resolved = Resolve-Tool $Executable
        if (-not $resolved) { throw 'Tool unavailable' }
        # Only package names, versions and fixed CLI arguments enter this command.
        # Reject cmd expansion characters in the executable path instead of interpreting them.
        if ($resolved -match '["%\r\n!]') { throw 'Unsupported executable path' }
        foreach ($argument in $Arguments) {
            if ($argument -notmatch '\A[@A-Za-z0-9._/=-]+\z') { throw 'Unsupported tool argument' }
        }
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = Join-Path $PSHOME 'powershell.exe'
        $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $encodedRunner
        $start.EnvironmentVariables['MCP_WEEKLY_COMMAND'] = '""{0}" {1}"' -f $resolved, ($Arguments -join ' ')
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $child = [Diagnostics.Process]::Start($start)
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(60000)) {
            # The retained process handle targets exactly the process we started, never a name.
            $child.Kill()
            return [pscustomobject]@{ Code = -1; Text = '' }
        }
        if (-not $stdout.Wait(1000) -or -not $stderr.Wait(1000)) { throw 'Tool stream did not close' }
        return [pscustomobject]@{ Code = $child.ExitCode; Text = $stdout.Result.Trim() }
    } catch {
        return [pscustomobject]@{ Code = -1; Text = '' }
    } finally {
        if ($null -ne $child) {
            try { if (-not $child.HasExited) { $child.Kill() } } catch {}
            $child.Dispose()
        }
    }
}
function Test-Version([string]$Value) {
    if ($Value -notmatch '\A\d+\.\d+\.\d+\z') { return $false }
    $parsed = $null
    return [version]::TryParse($Value, [ref]$parsed)
}
function Write-UpdateLog {
    $notices = @()
    foreach ($entry in $entries) {
        $line = '{0}|{1}|{2}|{3}|{4}' -f [DateTime]::UtcNow.ToString('o'), $entry.Package, $entry.Old, $entry.Latest, $entry.Status
        try {
            $folder = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($LogPath))
            [void][IO.Directory]::CreateDirectory($folder)
            [IO.File]::AppendAllText($LogPath, $line + "`n", $utf8)
        } catch {}
        if ($entry.Status -match '^(updated|failed:|report:)') {
            $notices += '{0} {1} -> {2}: {3}' -f $entry.Package, $entry.Old, $entry.Latest, $entry.Status
        }
    }
    if ($env:MCP_WEEKLY_NOTIFY -eq '0' -or $notices.Count -eq 0) { return }
    try {
        $title = 'MCP weekly update'
        $body = ($notices | Select-Object -First 6) -join '; '
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml(('<toast><visual><binding template="ToastGeneric"><text>{0}</text><text>{1}</text></binding></visual><audio silent="true"/></toast>' -f [Security.SecurityElement]::Escape($title), [Security.SecurityElement]::Escape($body)))
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    } catch {}
}

try {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { exit 2 }
    $ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
    $original = [IO.File]::ReadAllBytes($ConfigPath)
    $text = $utf8.GetString($original)
    $section = $null
    foreach ($line in [regex]::Matches($text, '(?m)^.*$')) {
        if ($line.Value -match '^\s*\[') {
            $section = $null
            if ($line.Value -match '^\s*\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$') { $section = $Matches[1] }
            continue
        }
        if (-not $section -or $line.Value -match '^\s*#') { continue }
        foreach ($pin in [regex]::Matches($line.Value, '"(@[a-z0-9._-]+/[a-z0-9._-]+|[a-z0-9._-]+)@(\d+\.\d+\.\d+)"')) {
            [void]$entries.Add([pscustomobject]@{
                Package = $pin.Groups[1].Value; Old = $pin.Groups[2].Value; Latest = $pin.Groups[2].Value
                Section = $section; Index = $line.Index + $pin.Index; Length = $pin.Length; Status = 'failed:npm-view'
            })
        }
    }
    foreach ($entry in $entries) {
        $view = Invoke-BoundedTool $NpmBin @('view', $entry.Package, 'version')
        if ($view.Code -ne 0 -or -not (Test-Version $view.Text) -or -not (Test-Version $entry.Old)) { continue }
        if ([version]$view.Text -le [version]$entry.Old) { $entry.Status = 'current'; continue }
        $entry.Latest = $view.Text
        $cache = Invoke-BoundedTool $NpmBin @('cache', 'add', ($entry.Package + '@' + $entry.Latest))
        if ($cache.Code -ne 0) { $entry.Status = 'failed:cache-add'; continue }
        if ($DryRun) { $entry.Status = 'dry-run' }
        else { $entry.Status = 'pending'; $edits += $entry }
    }
    if ($edits.Count -gt 0) {
        try {
            # Work by original token offsets, not global Replace: identical text in env secrets is untouched.
            foreach ($entry in ($edits | Sort-Object Index -Descending)) {
                $replacement = '"{0}@{1}"' -f $entry.Package, $entry.Latest
                $text = $text.Remove($entry.Index, $entry.Length).Insert($entry.Index, $replacement)
            }
            $backup = $ConfigPath + '.bak-mcpweekly-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
            # Copy refuses a timestamp collision, preserving the prior backup instead of overwriting it.
            [IO.File]::Copy($ConfigPath, $backup)
            $writeStarted = $true
            [IO.File]::WriteAllBytes($ConfigPath, $utf8.GetBytes($text))
            if (-not $CodexBin) { $CodexBin = Resolve-Tool 'codex.cmd' }
            $inventory = Invoke-BoundedTool $CodexBin @('mcp', 'list', '--json')
            if ($inventory.Code -ne 0 -or $inventory.Text -notmatch '^\s*\[') { throw 'Invalid inventory' }
            $servers = @($inventory.Text | ConvertFrom-Json -ErrorAction Stop | ForEach-Object { $_ })
            foreach ($entry in $edits) {
                if (@($servers | Where-Object { $_.name -ceq $entry.Section }).Count -eq 0) { throw 'Missing server' }
            }
            $validated = $true
            foreach ($entry in $edits) { $entry.Status = 'updated' }
        } catch {
            foreach ($entry in $edits) { $entry.Status = $(if ($writeStarted) { 'failed:validate' } else { 'failed:backup' }) }
            if ($writeStarted) { [IO.File]::WriteAllBytes($ConfigPath, [IO.File]::ReadAllBytes($backup)); $writeStarted = $false }
        }
    }

    $backupPattern = '^' + [regex]::Escape([IO.Path]::GetFileName($ConfigPath)) + '\.bak-mcpweekly-\d{8}-\d{6}$'
    $backups = @(Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($ConfigPath)) -File |
        Where-Object { $_.Name -match $backupPattern } | Sort-Object Name -Descending)
    foreach ($oldBackup in ($backups | Select-Object -Skip 4)) { Remove-Item -LiteralPath $oldBackup.FullName -Force }

    if (-not $CodegraphBin) { $CodegraphBin = Resolve-Tool 'codegraph.cmd' }
    if ($CodegraphBin) {
        $installed = Invoke-BoundedTool $CodegraphBin @('--version')
        if ($installed.Code -eq 0 -and (Test-Version $installed.Text)) {
            $latest = Invoke-BoundedTool $NpmBin @('view', '@colbymchenry/codegraph', 'version')
            if ($latest.Code -eq 0 -and (Test-Version $latest.Text) -and [version]$installed.Text -lt [version]$latest.Text) {
                [void]$entries.Add([pscustomobject]@{
                    Package = 'codegraph'; Old = $installed.Text; Latest = $latest.Text
                    Status = ('report:codegraph {0} -> {1} (run codegraph upgrade with no Claude session open)' -f $installed.Text, $latest.Text)
                })
            }
        }
    }
} catch {
    # Never expose an exception: parser and native diagnostics can include config secrets.
    if ($writeStarted -and -not $validated -and $backup) {
        try { [IO.File]::WriteAllBytes($ConfigPath, [IO.File]::ReadAllBytes($backup)) } catch {}
        foreach ($entry in $edits) { $entry.Status = 'failed:validate' }
    }
} finally {
    try { Write-UpdateLog } catch {}
}
exit 0
