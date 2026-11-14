. (Join-Path $PSScriptRoot 'test-lib.ps1')
. (Join-Path $PSScriptRoot '..\bin\ram-preflight.ps1')
$script:samples = @(2GB / 1KB); $script:index = 0; $script:sleeps = @()
function Get-CimInstance { param($ClassName, $ErrorAction)
  if ($ClassName -ne 'Win32_OperatingSystem') { throw 'wrong CIM class' }
  $i = [math]::Min($script:index, $script:samples.Count - 1); $script:index++
  [pscustomobject]@{ FreeVirtualMemory = $script:samples[$i] }
}
function Start-Sleep { param($Seconds) $script:sleeps += $Seconds }
Assert-True ((Wait-FreeRam) -eq $true -and $script:sleeps.Count -eq 0) 'enough RAM returns immediately'
# 2026-11-14 (Line): low memory never blocks or waits - one sample, a warning, and $true.
$script:samples = @(1GB / 1KB); $script:index = 0; $script:sleeps = @()
$w = @(); $res = Wait-FreeRam -MinGB 1.5 -TimeoutMin 10 -WarningVariable w
Assert-True ($res -eq $true -and $script:sleeps.Count -eq 0 -and $script:index -eq 1 -and $w.Count -eq 1) 'low RAM warns once, never sleeps, returns true'
$script:index = 0; $w = @()
Assert-True ((Wait-FreeRam -TimeoutMin 0 -WarningVariable w) -eq $true -and $w.Count -eq 1) 'zero timeout still returns true'
$script:messages = @()
function Write-Host { param($Object) $script:messages += [string]$Object }
function Get-Process { param($ErrorAction) 1..7 | ForEach-Object { [pscustomobject]@{ ProcessName = "p$_"; WorkingSet64 = $_ * 1MB; Secret = 'not printed' } } }
Write-RamDiagnostic
Remove-Item Function:Write-Host
Assert-True ($script:messages.Count -eq 6 -and $script:messages[0] -match '1.00 GB' -and $script:messages[1] -match 'p7.*7.*MB' -and ($script:messages -join '') -notmatch 'Secret|not printed|p1|p2') 'diagnostic only free RAM and top five names/MB'
$fixture = New-TestFolder
$script:index = 0; $script:samples = @((1GB / 1KB),(2GB / 1KB)); $script:messages = @()
function Write-Host { param($Object) $script:messages += [string]$Object }
$null = Wait-FreeRam -TimeoutMin 1 -WarningAction SilentlyContinue
Remove-Item Function:Write-Host
Assert-True ($script:messages.Count -eq 1 -and $script:messages[0] -match '1.00 GB commit headroom') 'one status line per call'
function Get-CimInstance { throw 'fixture CIM unavailable' }
$warnings = @()
$open = Wait-FreeRam -WarningVariable warnings
Assert-True ($open -eq $true -and $warnings.Count -eq 1) 'CIM failure warns and fails open'
try {
  # Intent: RAM status cannot block dispatch. Status: regression fixtures.
  # Next: supervisor host checks. Blockers: none. Confidence: real blocks with mocked RAM.
  # Execute the dispatcher's real preflight block in a child with only mocked boundaries.
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\bin\codex-do.ps1'), [ref]$tokens, [ref]$errors)
  $block = $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.Text -match 'Wait-FreeRam' } | Select-Object -First 1
  Assert-True ($block.Extent.Text -notmatch '(?m)^\s*exit\s+75\b') 'dispatcher has no exit 75 branch'
  $reviewSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\bin\codex-review.ps1'))
  Assert-True ($reviewSource -notmatch '(?m)^\s*(?:return|exit)\s+75\b') 'review has no exit 75 branch'
  $harness = @'
param([switch]$NoRamCheck)
$Attached = $true; $Attach = ''; $Cancel = ''; $cargs = @(); $accountName = 'main'
function Wait-FreeRam { param($MinGB,$TimeoutMin) Write-Host 'fixture RAM status'; return $false }
function Write-RamDiagnostic { Write-Output 'fixture RAM diagnostic' }
function Select-CodexSandboxMode { return [pscustomobject]@{Mode='elevated'} }
'@
  $path = Join-Path $fixture 'dispatch-preflight.ps1'
  [IO.File]::WriteAllText($path, $harness + "`n" + $block.Extent.Text, (New-Object Text.UTF8Encoding($false)))
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $path
  Assert-True ($LASTEXITCODE -eq 0 -and $output -contains 'fixture RAM status' -and $output -notcontains 'fixture RAM diagnostic') 'dispatcher calls RAM status and continues even on false'
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $path -NoRamCheck
  Assert-True ($LASTEXITCODE -eq 0 -and $output -notcontains 'fixture RAM status') 'dispatcher NoRamCheck skips wait'
  . (Import-TestFunctions (Join-Path $PSScriptRoot '..\bin\codex-review.ps1'))
  function Get-CodexActiveAccount { 'main' }
  function Resolve-CodexAccountHome { $fixture }
  function Invoke-Git { param($Arguments) if ($Arguments -contains '--is-inside-work-tree') { 'true' } else { $fixture } }
  function Get-ReviewDiff { 'fixture diff' }
  $script:reviewMessages = @()
  function Write-Result { param($Text) $script:reviewMessages += $Text }
  function Write-Gate { param($Name,$Status,$Reason) }
  function Wait-FreeRam { param($MinGB,$TimeoutMin) $script:waits++; $false }
  function Write-RamDiagnostic { $script:diagnostics++ }
  function Select-CodexSandboxMode { $script:probes++; [pscustomobject]@{Mode=$null;Reason='fixture stop'} }
  $Dir = $fixture; $SkipGates = $true; $SkipModel = $false; $NoRamCheck = $false
  $script:waits = 0; $script:diagnostics = 0; $script:probes = 0
  $binBefore = $env:CODEX_DO_BIN
  try {
    $env:CODEX_DO_BIN = Join-Path $fixture 'must-not-launch.exe'
    Assert-True ((Invoke-Main) -eq 3 -and $script:waits -eq 1 -and $script:diagnostics -eq 0 -and $script:probes -eq 1) 'review RAM status never blocks Codex preflight'
    Assert-True ($script:reviewMessages -notcontains 'VERDICT: BLOCKED (low RAM)') 'review low RAM never prints blocked verdict'
    $NoRamCheck = $true
    Assert-True ((Invoke-Main) -eq 3 -and $script:waits -eq 1 -and $script:probes -eq 2) 'review NoRamCheck bypasses RAM wait'
    $SkipModel = $true; $NoRamCheck = $false
    Assert-True ((Invoke-Main) -eq 0 -and $script:waits -eq 1 -and $script:probes -eq 2) 'review SkipModel bypasses all preflights'
  } finally { $env:CODEX_DO_BIN = $binBefore }
} finally { Remove-TestFolder $fixture }
Complete-Tests
