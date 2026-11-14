$ErrorActionPreference = 'Stop'
$script:passed = 0
$script:failed = 0
function Assert-True($Condition, [string]$Name) {
  if ($Condition) { $script:passed++; Write-Host "PASS $Name" }
  else { $script:failed++; Write-Host "FAIL $Name" }
}
function Assert-Throws([scriptblock]$Action, [string]$Name) {
  $threw = $false
  try { & $Action | Out-Null } catch { $threw = $true }
  Assert-True $threw $Name
}
function Import-TestFunctions([string]$Path) {
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors -join "`n") }
  $definitions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)
  # Export only definitions, so dispatcher tests cannot launch Codex or read account state.
  return [scriptblock]::Create(($definitions.Extent.Text -join "`n"))
}
function Complete-Tests {
  Write-Host "PASS: $script:passed FAIL: $script:failed"
  if ($script:failed) { exit 1 }
}
function New-TestFolder {
  $folder = Join-Path ([IO.Path]::GetTempPath()) ('harness-test-' + [guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($folder)
  return $folder
}
function Remove-TestFolder([string]$Folder) {
  $full = [IO.Path]::GetFullPath($Folder)
  if ((Split-Path $full -Parent) -ne ([IO.Path]::GetTempPath()).TrimEnd('\') -or
      (Split-Path $full -Leaf) -notlike 'harness-test-*') { throw 'Unsafe test cleanup' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
