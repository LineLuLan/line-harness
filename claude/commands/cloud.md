---
description: Cloud infrastructure — Docker, K8s, Terraform, deployment configs. Safety-first workflow.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(docker:*), Bash(docker-compose:*), Bash(kubectl:*), Bash(terraform:*), Bash(git:*), Bash(lsof:*), Bash(netstat:*), Bash(curl:*), Bash(cat:*), Bash(ls:*), AskUserQuestion
---

# Cloud Infrastructure Mode

Scoped workflow for infrastructure work. Safety-first approach inspired by Anthropic's Data Infrastructure team's K8s debugging and screenshot-driven diagnosis.

## STEP 0: Confidence Check & Doc Lookup

**Before modifying any infrastructure config**, verify you understand the tool's behavior:
- If unsure about Docker Compose syntax, K8s resource specs, Terraform providers, or nginx directives, use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to look up the latest docs
- Infrastructure mistakes can take down services. Only proceed when confident.
- Do NOT guess at config syntax — look it up first.

## SCOPE BOUNDARY

**IN SCOPE — Only touch these:**
- Docker files (`Dockerfile`, `docker-compose.yml`, `.dockerignore`)
- Kubernetes configs (`*.yaml`, `*.yml` in k8s/deploy/infra dirs)
- Terraform files (`*.tf`, `*.tfvars`)
- CI/CD configs (`.github/workflows/`, `Jenkinsfile`, etc.)
- Nginx/reverse proxy configs
- Environment variable templates (`.env.example`, NOT `.env`)
- Deployment scripts

**OUT OF SCOPE — Do NOT touch:**
- Application source code (use `/frontend` or `/backend`)
- Database schemas or migrations (use `/database`)
- Application tests
- Secret values or `.env` files with real credentials

**NEVER without explicit user confirmation:**
- Delete or overwrite running containers/pods
- Modify production configs
- Change resource limits or scaling settings
- Alter networking rules or security groups

---

## STEP 1: Environment Verification (MANDATORY)

Before ANY infrastructure work, verify the actual state:

```bash
# What's running?
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker not running"

# What ports are in use?
lsof -i -P -n | grep LISTEN 2>/dev/null | head -20

# Current context
kubectl config current-context 2>/dev/null || echo "No K8s context"

# Git state
git branch --show-current
```

**Do NOT assume architecture — verify each point, report findings, then proceed.**

Tell the user:
> "Infrastructure scope: Currently [X containers running / Y services active]. I'll be working on [specific configs]. No application code changes."

---

## STEP 2: Screenshot-Driven Debugging (When Applicable)

If the user provides dashboard screenshots (GCP Console, AWS Console, Grafana, etc.):
1. Analyze the screenshot systematically: status indicators, error messages, resource utilization
2. Cross-reference with config files
3. Propose specific diagnosis before making changes

If working blind (no screenshots):
1. Gather logs first:
   ```bash
   docker-compose logs --tail=50 [service] 2>&1
   # or
   kubectl logs [pod] --tail=50 2>&1
   ```
2. Check resource status
3. Identify the issue before changing anything

---

## STEP 3: Change Planning

**Before modifying ANY infrastructure file:**

1. Show the user what you plan to change and why:
   ```
   PLANNED CHANGES:
   - [file]: [what will change] — [why]
   RISK LEVEL: [LOW/MEDIUM/HIGH]
   ROLLBACK: [how to undo if this breaks]
   ```

2. For HIGH risk changes, ask for explicit confirmation before proceeding

3. For Terraform changes, always run plan first:
   ```bash
   terraform plan 2>&1 | tail -30
   ```

---

## STEP 4: Implementation

### Safety Protocol
- Always backup configs before modifying: `cp file file.bak`
- Make one change at a time, verify, then proceed
- For Docker Compose: `docker-compose config` to validate before applying
- For K8s: `kubectl apply --dry-run=client -f file.yaml` to validate
- For Terraform: `terraform plan` then `terraform apply` only with user approval

### Common Patterns
- Port conflicts: Check `lsof -i :PORT` before claiming a port
- Volume mounts: Verify host paths exist before mounting
- Environment variables: Check `.env.example` for required vars
- Networking: Verify service names match between configs

---

## STEP 5: Verification

```bash
# Docker: services healthy?
docker-compose ps 2>/dev/null

# K8s: pods running?
kubectl get pods 2>/dev/null | head -20

# Connectivity: can services reach each other?
curl -s http://localhost:PORT/health 2>/dev/null || echo "Service not reachable"

# Logs: any errors after changes?
docker-compose logs --tail=20 2>&1 | grep -i error || echo "No errors"
```

---

## STEP 6: Report

```markdown
## Infrastructure Changes Complete

**Environment**: [local/staging/production]
**Services affected**: [list]

### Changes
- [file]: [what changed and why]

### Verification
- Services running: YES/NO
- Health checks passing: YES/NO
- No new errors in logs: YES/NO

### Rollback (if needed)
- [exact commands to undo changes]
```
