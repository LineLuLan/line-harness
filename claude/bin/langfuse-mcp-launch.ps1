# Launcher for the Langfuse MCP server (stdio).
# Loads LANGFUSE_* values from the TwoHearts workspace .env.local into THIS process's
# environment at runtime and starts the server. Values are never printed, logged, or written
# to any config file — they exist only in the child process env (per AGENTS.md secrets policy).
$ErrorActionPreference = 'Stop'
$envFile = 'D:\01_Workspaces\TwoHearts\.env.local'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*(LANGFUSE_[A-Z0-9_]+)\s*=\s*(.*)$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      if ($value) { Set-Item -Path "Env:$name" -Value $value }
    }
  }
}
# langfuse-mcp expects LANGFUSE_BASEURL in some versions; mirror BASE_URL to both spellings.
if ($env:LANGFUSE_BASE_URL -and -not $env:LANGFUSE_BASEURL) { $env:LANGFUSE_BASEURL = $env:LANGFUSE_BASE_URL }
& cmd /c npx.cmd -y langfuse-mcp@1.2.0
exit $LASTEXITCODE
