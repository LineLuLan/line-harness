# Restore Line Harness files to their places. Dry run by default; -Apply copies.
# Existing files are backed up to <target>.bak-<timestamp> before they are replaced.
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$h = $env:USERPROFILE
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$map = @(
  @('claude\CLAUDE.md', "$h\.claude\CLAUDE.md"),
  @('claude\settings.json', "$h\.claude\settings.json"),
  @('claude\statusline-ultrathink.js', "$h\.claude\statusline-ultrathink.js"),
  @('claude\bin', "$h\.claude\bin"),
  @('claude\hooks', "$h\.claude\hooks"),
  @('claude\commands', "$h\.claude\commands"),
  @('claude\skills', "$h\.claude\skills"),
  @('codex\AGENTS.md', "$h\.codex\AGENTS.md"),
  @('codex\config.toml', "$h\.codex\config.toml"),
  @('codex\hooks.json', "$h\.codex\hooks.json"),
  @('codex\hooks', "$h\.codex\hooks"),
  @('codex\rules', "$h\.codex\rules"),
  @('codex\skills', "$h\.codex\skills"),
  @('home\AGENTS.md', "$h\AGENTS.md"),
  @('terminal\windows-terminal-settings.json', "$h\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json")
)
foreach ($m in $map) {
  $src = Join-Path $PSScriptRoot $m[0]; $dst = $m[1]
  if (-not (Test-Path -LiteralPath $src)) { continue }
  if (-not $Apply) { "would copy {0} -> {1}" -f $m[0], $dst; continue }
  if (Test-Path -LiteralPath $dst) { Copy-Item -LiteralPath $dst -Destination "$dst.bak-$stamp" -Recurse -Force }
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $dst))
  if ((Get-Item -LiteralPath $src).PSIsContainer) { Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force }
  else { Copy-Item -LiteralPath $src -Destination $dst -Force }
  "copied {0} -> {1}" -f $m[0], $dst
}
if (-not $Apply) { 'Dry run only. Run again with -Apply to copy.' }
