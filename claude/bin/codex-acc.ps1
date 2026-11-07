<#
.SYNOPSIS
  Manage Line's isolated Codex account homes without copying authentication.
.NOTES
  Intent: keep refresh tokens owned by the CLI in one home per account.
  Status: implemented with fake-home self-tests. Next: supervisor installation.
  Blockers: real account login is interactive. Confidence: local tests only.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'codex-acc-lib.ps1')

function Show-CodexAccUsage {
  Write-Host 'Usage: codex-acc.ps1 list | status | add <name> [-NoLogin] | login <name> | use <name> | run [-Account <name>] [-- codex args...] | env [<name>]'
  exit 64
}
function Show-CodexAccounts {
  param([object[]]$Accounts)
  $Accounts | Select-Object @{n='Active';e={if ($_.Active) { '*' } else { ' ' }}}, Name, Email, Plan,
    @{n='Weekly used %';e={$_.WeeklyUsedPct}}, @{n='Weekly reset';e={$_.WeeklyResetsAt}},
    @{n='Logged in';e={if ($_.LoggedIn) { 'yes' } else { 'no' }}} | Format-Table -AutoSize | Out-String -Width 4096 | Write-Host
}
function Sync-CodexAccountConfig {
  param([string]$AccountHome)
  # Do not let an account junction redirect these writes into the main home.
  if ((Get-Item -LiteralPath $AccountHome).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'codex-acc: account home must not be a junction or symlink for config sync.' }
  foreach ($file in @('config.toml', 'AGENTS.md')) {
    $source = Join-Path (Get-CodexMainHome) $file
    $target = Join-Path $AccountHome $file
    if (Test-Path -LiteralPath $target) {
      if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "codex-acc: refusing linked config file '$file'." }
    }
    if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination $target -Force }
  }
}
function Copy-CodexSandbox {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($entry in Get-ChildItem -LiteralPath $Source -Force) {
    if ($entry.Name -eq 'auth.json' -or $entry.Name -like '*.auth.json' -or $entry.Name -in @('sessions', 'history', 'history.jsonl')) { continue }
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'codex-acc: sandbox bootstrap contains a link; cannot safely copy it.' }
    $target = Join-Path $Destination $entry.Name
    if ($entry.PSIsContainer) { Copy-CodexSandbox -Source $entry.FullName -Destination $target }
    else { Copy-Item -LiteralPath $entry.FullName -Destination $target }
  }
}
function ConvertTo-CodexNativeArgument {
  param([AllowEmptyString()][string]$Argument)
  # Match the Windows argv quoting used by codex-do/review, including empty args.
  $builder = New-Object Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Argument.ToCharArray()) {
    if ($character -eq '\') { $backslashes++; continue }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes))
      $backslashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}
function Invoke-CodexAccount {
  param([string]$AccountHome, [string[]]$CodexArguments, [switch]$SetHome)
  $codexBin = if ($env:CODEX_DO_BIN) { $env:CODEX_DO_BIN } else { Join-Path $env:APPDATA 'npm\codex.cmd' }
  $prevHome = $env:CODEX_HOME
  $child = $null
  try {
    if ($SetHome) { $env:CODEX_HOME = $AccountHome }
    if ($PSVersionTable.PSVersion.Major -le 5) {
      $processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
      [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
      [Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
    }
    $launch = @{ FilePath = $codexBin; NoNewWindow = $true; PassThru = $true }
    if ($CodexArguments.Count -gt 0) { $launch.ArgumentList = (($CodexArguments | ForEach-Object { ConvertTo-CodexNativeArgument ([string]$_) }) -join ' ') }
    $child = Start-Process @launch
    $null = $child.Handle
    $child.WaitForExit()
    $child.Refresh()
    $script:codexExitCode = $child.ExitCode
  } finally {
    if ($null -eq $prevHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    else { $env:CODEX_HOME = $prevHome }
    if ($null -ne $child) { $child.Dispose() }
  }
}

try {
  if ($args.Count -eq 0) { Show-CodexAccUsage }
  $command = [string]$args[0]
  $rest = @($args | Select-Object -Skip 1)
  switch -CaseSensitive ($command) {
    'list' {
      if ($rest.Count) { Show-CodexAccUsage }
      $names = @('main')
      if (Test-Path -LiteralPath (Get-CodexAccRoot) -PathType Container) {
        $names += @(Get-ChildItem -LiteralPath (Get-CodexAccRoot) -Directory | Where-Object { $_.Name -cmatch '\A[a-z0-9][a-z0-9-]{0,31}\z' -and $_.Name -cne 'main' } | Sort-Object Name | ForEach-Object { $_.Name })
      }
      Show-CodexAccounts @($names | ForEach-Object { Get-CodexAccountInfo -Name $_ })
    }
    'status' {
      if ($rest.Count) { Show-CodexAccUsage }
      $info = Get-CodexAccountInfo -Name (Get-CodexActiveAccount)
      Show-CodexAccounts @($info)
      Write-Host "home: $($info.Home)"
    }
    'add' {
      if ($rest.Count -lt 1 -or $rest.Count -gt 2 -or ($rest.Count -eq 2 -and $rest[1] -ne '-NoLogin')) { Show-CodexAccUsage }
      $name = [string]$rest[0]
      if ($name -cnotmatch '\A[a-z0-9][a-z0-9-]{0,31}\z' -or $name -in @('main', 'acc1', 'acc2')) { throw "codex-acc: invalid or reserved account name '$name'." }
      $accountHome = Join-Path (Get-CodexAccRoot) $name
      if (Test-Path -LiteralPath $accountHome) { throw "codex-acc: account '$name' already exists." }
      New-Item -ItemType Directory -Path (Get-CodexAccRoot) -Force | Out-Null
      New-Item -ItemType Directory -Path $accountHome | Out-Null
      Sync-CodexAccountConfig -AccountHome $accountHome
      foreach ($folder in @('.sandbox', '.sandbox-bin')) {
        $source = Join-Path (Get-CodexMainHome) $folder
        if (Test-Path -LiteralPath $source -PathType Container) { Copy-CodexSandbox -Source $source -Destination (Join-Path $accountHome $folder) }
      }
      foreach ($folder in @('skills', 'rules')) {
        $source = Join-Path (Get-CodexMainHome) $folder
        if (Test-Path -LiteralPath $source -PathType Container) { New-Item -ItemType Junction -Path (Join-Path $accountHome $folder) -Target $source | Out-Null }
      }
      if ($rest.Count -eq 2) { Write-Host "codex-acc.ps1 login $name" }
      else {
        Invoke-CodexAccount -AccountHome $accountHome -CodexArguments @('login') -SetHome
        Show-CodexAccounts @((Get-CodexAccountInfo -Name $name))
        exit $codexExitCode
      }
    }
    'login' {
      if ($rest.Count -ne 1) { Show-CodexAccUsage }
      $accountHome = Resolve-CodexAccountHome -Name $rest[0]
      Invoke-CodexAccount -AccountHome $accountHome -CodexArguments @('login') -SetHome
      exit $codexExitCode
    }
    'use' {
      if ($rest.Count -ne 1) { Show-CodexAccUsage }
      $name = [string]$rest[0]
      try { $accountHome = Resolve-CodexAccountHome -Name $name }
      catch { Write-Host $_.Exception.Message; exit 3 }
      if (-not (Test-CodexAccountLoggedIn -Home $accountHome)) { Write-Host "codex-acc: account '$name' is not logged in. Run: codex-acc.ps1 login $name"; exit 3 }
      if ($name -cne 'main') { Sync-CodexAccountConfig -AccountHome $accountHome }
      New-Item -ItemType Directory -Path (Get-CodexAccRoot) -Force | Out-Null
      [IO.File]::WriteAllText((Join-Path (Get-CodexAccRoot) 'active'), "$name`n", (New-Object Text.UTF8Encoding $false))
      $info = Get-CodexAccountInfo -Name $name
      Write-Host "active: $name ($($info.Email))"
    }
    'run' {
      $name = Get-CodexActiveAccount
      if ($rest.Count -gt 0 -and $rest[0] -eq '-Account') {
        if ($rest.Count -lt 2) { Show-CodexAccUsage }
        $name = [string]$rest[1]
        $rest = @($rest | Select-Object -Skip 2)
      }
      if ($rest.Count -gt 0 -and $rest[0] -eq '--') { $rest = @($rest | Select-Object -Skip 1) }
      $accountHome = Resolve-CodexAccountHome -Name $name
      Invoke-CodexAccount -AccountHome $accountHome -CodexArguments $rest -SetHome:($name -cne 'main')
      exit $codexExitCode
    }
    'env' {
      if ($rest.Count -gt 1) { Show-CodexAccUsage }
      $name = if ($rest.Count) { [string]$rest[0] } else { Get-CodexActiveAccount }
      $accountHome = Resolve-CodexAccountHome -Name $name
      if ($name -ceq 'main') { Write-Output 'Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue' }
      else { Write-Output ("`$env:CODEX_HOME='" + $accountHome.Replace("'", "''") + "'") }
    }
    default { Show-CodexAccUsage }
  }
} catch {
  Write-Host "codex-acc: operation failed ($($_.Exception.Message))"
  exit 1
}
