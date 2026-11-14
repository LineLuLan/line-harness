. (Join-Path $PSScriptRoot 'hook-test-lib.ps1')
$temp = New-TestFolder
try {
    $probe = Join-Path $temp 'stdin-bytes.ps1'
    [IO.File]::WriteAllText($probe, @'
$bytes = [IO.MemoryStream]::new()
[Console]::OpenStandardInput().CopyTo($bytes)
[Console]::Out.WriteLine([Convert]::ToBase64String($bytes.ToArray()))
$bytes.Dispose()
'@)
    $payload = '{"text":"' + [char]0x00e9 + [char]0x4e2d + [char]::ConvertFromUtf32(0x1f642) + '"}'
    $expected = [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($payload))
    $encoding = [Console]::InputEncoding
    $result = Invoke-TestHook $probe $payload $temp
    Assert-True ([Console]::InputEncoding.Equals($encoding)) 'parent input encoding restored'
    Assert-True ($result.ExitCode -eq 0 -and -not $result.Error) 'stdin byte probe exits cleanly'
    if ($result.Output -cne $expected) { Write-Output ('Actual stdin bytes: ' + [BitConverter]::ToString([Convert]::FromBase64String($result.Output))) }
    Assert-True ($result.Output -ceq $expected) 'hook payload is exact UTF-8 without BOM'
} finally { Remove-TestFolder $temp }
Complete-Tests
