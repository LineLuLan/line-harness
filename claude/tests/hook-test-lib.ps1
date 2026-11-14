. (Join-Path $PSScriptRoot 'test-lib.ps1')

# Run real hook entry points with isolated homes; commands in the payload are never executed.
function Invoke-TestHook {
    param([string]$Hook, [string]$Payload, [string]$Profile, [string]$Arguments = '')
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'powershell.exe'
    $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Hook + '" ' + $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['USERPROFILE'] = $Profile
    $info.EnvironmentVariables.Remove('OPENROUTER_GUARD_OVERRIDE')
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        # .NET Framework lacks ProcessStartInfo.StandardInputEncoding. Start()
        # creates an auto-flushing writer using Console.InputEncoding and can emit
        # its preamble immediately. Select BOM-free UTF-8 only during startup.
        $inputEncoding = [Console]::InputEncoding
        try {
            [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
            [void]$process.Start()
        }
        finally { [Console]::InputEncoding = $inputEncoding }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        # StreamWriter may prepend a BOM when the parent console uses UTF-8.
        # Write exact bytes and close the base stream without flushing that writer.
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Payload)
        $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        $process.StandardInput.BaseStream.Close()
        $process.WaitForExit()
        $watch.Stop()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = $stdout.Result.Trim()
            Error = $stderr.Result.Trim()
            Milliseconds = $watch.Elapsed.TotalMilliseconds
        }
    }
    finally { $process.Dispose() }
}

function New-ShellPayload([string]$Command, [string]$Tool = 'PowerShell') {
    return @{ tool_name = $Tool; tool_input = @{ command = $Command } } | ConvertTo-Json -Compress -Depth 5
}

function Get-HookDecision($Result) {
    if (-not $Result.Output) { return 'allow|' }
    $output = ($Result.Output | ConvertFrom-Json).hookSpecificOutput
    return $output.permissionDecision + '|' + $output.permissionDecisionReason
}
