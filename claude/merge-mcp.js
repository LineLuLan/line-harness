// Merge the harness MCP servers into ~/.claude.json. Adds only servers that are missing; never changes existing ones.
// Usage: node merge-mcp.js <servers.json> <claude.json> <userFolder> [--apply]
const fs = require('fs');
const [src, dst, home, flag] = process.argv.slice(2);
const apply = flag === '--apply';
const servers = JSON.parse(fs.readFileSync(src, 'utf8')).mcpServers || {};
// JSON.parse keeps keys that differ only by case (PowerShell 5.1 ConvertFrom-Json does not).
const target = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst, 'utf8')) : {};
target.mcpServers = target.mcpServers || {};
const fix = (v) => typeof v === 'string' ? v.split('C:\\Users\\ADMIN').join(home) : v;
for (const [name, def] of Object.entries(servers)) {
  if (target.mcpServers[name]) { console.log(`keep existing MCP ${name}`); continue; }
  const copy = JSON.parse(JSON.stringify(def));
  if (copy.command) copy.command = fix(copy.command);
  if (Array.isArray(copy.args)) copy.args = copy.args.map(fix);
  target.mcpServers[name] = copy;
  console.log(`${apply ? 'added' : 'would add'} MCP ${name}`);
}
if (apply) {
  if (fs.existsSync(dst)) fs.copyFileSync(dst, `${dst}.bak-${Date.now()}`);
  fs.writeFileSync(dst, JSON.stringify(target, null, 2));
}
