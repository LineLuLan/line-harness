# Intent: fail before a model call when Windows sandbox setup is broken.
# Status: bounded elevated/unelevated probes; child-only account environment.
# Next: supervisor validates against the installed CLI. Blockers: none in fixtures.
# Confidence: fake CLI covers selection and timeout without WMI.
function Read-CodexSharedText([string]$Path) {
  # Inherited redirect handles may still be open in a codex descendant; read with full sharing.
  if (-not [IO.File]::Exists($Path)) { return '' }
  $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try { return (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
}

function Initialize-CodexSandboxProcess {
  if ('CodexSandboxProcess' -as [type]) { return }
  # Start suspended so the shim cannot spawn outside the job before assignment.
  # Closing this private job kills only the probe and its descendants, even when
  # WMI/taskkill tree enumeration is unavailable. Output files avoid pipe-drain hangs.
  Add-Type -TypeDefinition @"
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public sealed class CodexSandboxProcess : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Startup {
        public int cb;
        public IntPtr reserved, desktop, title;
        public int x, y, width, height, charsX, charsY, fill, flags;
        public short show, reservedSize;
        public IntPtr reservedBytes, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr process, thread;
        public int pid, tid;
    }
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
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, string environment, string directory,
        ref Startup startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr job;
    public Process Child { get; private set; }
    public static CodexSandboxProcess Start(string executable, string arguments, string directory, string accountHome) {
        var result = new CodexSandboxProcess();
        var info = new ProcessInfo();
        try {
            result.job = CreateJobObject(IntPtr.Zero, null);
            if (result.job == IntPtr.Zero) throw new Win32Exception();
            var limits = new ExtendedLimits();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(result.job, 9, ref limits, Marshal.SizeOf(limits))) throw new Win32Exception();
            var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables()) variables[(string)entry.Key] = (string)entry.Value;
            if (String.IsNullOrEmpty(accountHome)) variables.Remove("CODEX_HOME");
            else variables["CODEX_HOME"] = accountHome;
            var block = new StringBuilder();
            foreach (var pair in variables) block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
            string environment = block.Append('\0').ToString();
            var startup = new Startup();
            startup.cb = Marshal.SizeOf(startup);
            var command = new StringBuilder("\"" + executable + "\" " + arguments);
            // CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000404,
                environment, directory, ref startup, out info)) throw new Win32Exception();
            if (!AssignProcessToJobObject(result.job, info.process)) throw new Win32Exception();
            result.Child = Process.GetProcessById(info.pid);
            var handle = result.Child.Handle; // Retain identity even after a fast exit.
            if (ResumeThread(info.thread) == UInt32.MaxValue) throw new Win32Exception();
            return result;
        } catch {
            if (info.process != IntPtr.Zero) TerminateProcess(info.process, 1);
            result.Dispose();
            throw;
        } finally {
            if (info.thread != IntPtr.Zero) CloseHandle(info.thread);
            if (info.process != IntPtr.Zero) CloseHandle(info.process);
        }
    }
    public void Dispose() {
        if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
        if (Child != null) { Child.Dispose(); Child = null; }
    }
}
"@
}

function Stop-CodexSandboxProbeTree {
  param([Diagnostics.Process]$Root, [datetime]$ProbeStartedUtc)

  # Stop each parent before enumerating its children: no new children can appear
  # after that parent's exit time. Creation bounds exclude recycled parent PIDs.
  $queue = New-Object Collections.Queue
  $owned = New-Object Collections.ArrayList
  $queue.Enqueue($Root)
  try {
    while ($queue.Count -gt 0) {
      $parent = $queue.Dequeue()
      $created = $parent.StartTime.ToUniversalTime()
      if (-not $parent.HasExited) { $parent.Kill() }
      if (-not $parent.WaitForExit(1000)) { throw "Cannot stop sandbox probe PID $($parent.Id)" }
      $exited = $parent.ExitTime.ToUniversalTime()
      foreach ($entry in @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $($parent.Id)" -OperationTimeoutSec 2 -ErrorAction Stop)) {
        if ($null -eq $entry.CreationDate) { continue }
        $born = $entry.CreationDate.ToUniversalTime()
        if ($born -lt $ProbeStartedUtc -or $born -lt $created -or $born -gt $exited) { continue }
        $descendant = $null
        try {
          $descendant = Get-Process -Id ([int]$entry.ProcessId) -ErrorAction Stop
          $null = $descendant.Handle
          if ([Math]::Abs(($descendant.StartTime.ToUniversalTime() - $born).TotalMilliseconds) -ge 1) { continue }
          [void]$owned.Add($descendant)
          $queue.Enqueue($descendant)
          $descendant = $null
        } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
          # The child already exited between enumeration and opening its handle.
        } finally { if ($null -ne $descendant) { $descendant.Dispose() } }
      }
    }
  } finally {
    # Even an enumeration error must stop every process already proved ours.
    foreach ($process in @($Root) + @($owned)) {
      try { if (-not $process.HasExited) { $process.Kill() } } catch {}
    }
    foreach ($process in $owned) { $process.Dispose() }
  }
}

function Select-CodexSandboxMode {
  param([string]$CodexBin, [string]$Dir, [AllowEmptyString()][string]$AccountHome = '', [switch]$NoSandboxFallback)

  $useJob = $true
  try { Initialize-CodexSandboxProcess }
  catch { $useJob = $false }
  $failures = @()
  $modes = if ($NoSandboxFallback -or $env:CODEX_DO_NO_FALLBACK -eq '1') { @('elevated') } else { @('elevated', 'unelevated') }
  foreach ($mode in $modes) {
    $probeStartedUtc = [DateTime]::UtcNow
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $probe = $null
    $child = $null
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('codex-sandbox-' + [guid]::NewGuid().ToString('N'))
    $outputPath = $temporary + '.stdout'
    $errorPath = $temporary + '.stderr'
    $reason = ''
    try {
      $arguments = '/d /v:off /s /c ""{0}" sandbox -c "windows.sandbox=\"{1}\"" -- cmd /c echo PREFLIGHT-OK <nul >"{2}" 2>"{3}""' -f $CodexBin, $mode, $outputPath, $errorPath
      if ($useJob) {
        try { $probe = [CodexSandboxProcess]::Start($env:ComSpec, $arguments, $Dir, $AccountHome); $child = $probe.Child }
        catch { $useJob = $false }
      }
      if (-not $useJob) {
        # A local compiler/job failure is not evidence that the sandbox failed.
        # File redirection prevents inherited pipe handles from defeating the cap.
        Write-Host 'sandbox preflight: job containment unavailable; using Start-Process with exact-PID timeout cleanup'
        $previousHome = $env:CODEX_HOME
        try {
          if ($AccountHome) { $env:CODEX_HOME = $AccountHome }
          else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
          if ($PSVersionTable.PSVersion.Major -le 5) {
            $processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
            [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
            [Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
          }
          $child = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $Dir -WindowStyle Hidden -PassThru
          $null = $child.Handle
        } finally {
          if ($null -eq $previousHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
          else { $env:CODEX_HOME = $previousHome }
        }
      }
      if (-not $child.WaitForExit([Math]::Max(0, 20000 - [int]$timer.ElapsedMilliseconds))) {
        if ($null -ne $probe) { $child.Kill() } # Closing the private job stops descendants.
        else { Stop-CodexSandboxProbeTree -Root $child -ProbeStartedUtc $probeStartedUtc }
        $reason = 'timed out (20-second cap)'
      } else {
        $output = Read-CodexSharedText $outputPath
        $errorOutput = Read-CodexSharedText $errorPath
        $child.Refresh()
        if ($child.ExitCode -eq 0 -and ($output + $errorOutput).Contains('PREFLIGHT-OK')) {
          return [pscustomobject]@{ Mode = $mode; Reason = ($failures -join '; ') }
        }
        $reason = @(($errorOutput + "`n" + $output) -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1) -join ''
        if (-not $reason) { $reason = "exit $($child.ExitCode), PREFLIGHT-OK missing" }
      }
    } catch { $reason = $_.Exception.Message -split '\r?\n' | Select-Object -First 1 }
    finally {
      if ($null -ne $probe) { $probe.Dispose() }
      elseif ($null -ne $child) { $child.Dispose() }
      foreach ($path in @($outputPath, $errorPath)) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    }
    $failures += "${mode}: $reason"
  }
  return [pscustomobject]@{ Mode = $null; Reason = ($failures -join '; ') }
}

function Get-CodexSandboxFailure {
  param([string]$Path, [string]$Text)

  # Only Codex's timestamped router errors count; prompt/diff/tool-output echoes do not.
  $pattern = '(?m)^(?:\x1b\[[0-9;]*m)*\d{4}-\d{2}-\d{2}T[0-9:.]+Z[ \t]+ERROR[ \t]+codex_core::tools::router:[^\r\n]*(setup refresh had errors|helper_\w+|windows sandbox)'
  $line = $null
  if ($Path) {
    if (-not [IO.File]::Exists($Path)) { return }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
    try {
      while (-not $reader.EndOfStream) {
        $candidate = $reader.ReadLine()
        if ($candidate -match $pattern) { $line = $candidate; break }
      }
    } finally { $reader.Dispose() }
  } else {
    $line = $Text -split '\r?\n' | Where-Object { $_ -match $pattern } | Select-Object -First 1
  }
  if ($null -ne $line) { return $line.Substring(0, [Math]::Min(200, $line.Length)) }
}

function Read-CodexRunMetadata {
  param([string]$Folder)

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { return ([IO.File]::ReadAllText((Join-Path $Folder 'run.json')) | ConvertFrom-Json) }
    catch [IO.IOException] { if ($attempt -eq 39) { throw }; Start-Sleep -Milliseconds 25 }
  }
}

function Update-CodexRunMetadata {
  param([string]$Folder, [hashtable]$Fields)

  # Observers and the notifier may finish together. Serialize metadata updates so
  # neither reads a partial JSON document nor drops the launcher's PID fields.
  $path = Join-Path $Folder 'run.json'
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $stream = $null
    $reader = $null
    try {
      $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true, 1024, $true)
      $record = $reader.ReadToEnd() | ConvertFrom-Json
      foreach ($name in $Fields.Keys) { $record | Add-Member -NotePropertyName $name -NotePropertyValue $Fields[$name] -Force }
      $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($record | ConvertTo-Json))
      $stream.Position = 0
      $stream.SetLength(0)
      $stream.Write($bytes, 0, $bytes.Length)
      return
    } catch [IO.IOException] { if ($attempt -eq 39) { throw }; Start-Sleep -Milliseconds 25 }
    finally {
      if ($null -ne $reader) { $reader.Dispose() }
      if ($null -ne $stream) { $stream.Dispose() }
    }
  }
}
