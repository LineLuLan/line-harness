---
description: Database work — migrations, schemas, queries, models. Backup-first, rollback-planned.
verified: 2026-08
allowed-tools: Task, Read, Edit, Write, Grep, Glob, Bash(npm:*), Bash(npx:*), Bash(bun:*), Bash(git:*), Bash(docker:*), Bash(psql:*), Bash(mysql:*), Bash(redis-cli:*), Bash(sqlite3:*), Bash(python:*), Bash(alembic:*), Bash(drizzle-kit:*), AskUserQuestion
---

# Database Development Mode

Scoped workflow for all database work. Backup-first approach with mandatory rollback planning.

## STEP 0: Confidence Check & Doc Lookup

**Before writing any migration or query**, verify you understand the ORM/DB syntax:
- If unsure about Drizzle schema syntax, SQLAlchemy model definitions, Alembic migration patterns, or raw SQL for a specific DB, use **Context7 MCP** (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`) to look up the latest docs
- Database mistakes can cause data loss. Only proceed when confident.
- Do NOT guess at migration syntax — look it up first.

## SCOPE BOUNDARY

**IN SCOPE — Only touch these:**
- Migration files (create new, modify pending)
- Model/entity definitions (Drizzle schemas, SQLAlchemy models)
- Seed files and fixtures
- Database query logic (repositories, DAOs, query builders)
- Database connection configuration
- Index definitions

**OUT OF SCOPE — Do NOT touch:**
- Application business logic (use `/backend`)
- API route handlers or controllers
- Frontend code
- Infrastructure configs beyond DB connection (use `/cloud`)

**NEVER without explicit user confirmation:**
- Drop tables or columns
- Delete seed/migration files
- Modify already-applied migrations
- Change column types on existing data (potential data loss)

---

## STEP 1: Identify Database Stack

### Preferred Stack (use these when starting fresh)
| ORM | Language | Databases |
|-----|----------|-----------|
| **Drizzle** | TypeScript/JavaScript | MySQL, PostgreSQL, SQLite |
| **SQLAlchemy** | Python | MySQL, PostgreSQL, SQLite |
| **Raw clients** | Any | Redis, MySQL, PostgreSQL, SQLite |

### Detection (adapt to whatever the project actually uses)
```bash
# Scan for ANY database dependencies
cat package.json 2>/dev/null | grep -iE "drizzle|prisma|typeorm|knex|sequelize|mongoose|pg|mysql|sqlite|redis|ioredis" || echo "No JS DB packages"
cat requirements.txt 2>/dev/null | grep -iE "sqlalchemy|alembic|django|peewee|tortoise|pymysql|psycopg|redis|sqlite" || \
  cat pyproject.toml 2>/dev/null | grep -iE "sqlalchemy|alembic|django|databases" || echo "No Python DB packages"

# Find migration directories (search broadly)
find . -maxdepth 3 -type d -name "migrations" -o -name "alembic" -o -name "drizzle" 2>/dev/null | head -10

# Find schema/model files
find . -maxdepth 4 -type f \( -name "schema.*" -o -name "models.*" -o -name "*.entity.*" \) 2>/dev/null | grep -v node_modules | head -10

# Check running DB services
docker ps --format "{{.Names}}\t{{.Image}}" 2>/dev/null | grep -iE "mysql|postgres|redis|sqlite|mongo|mariadb" || echo "No DB containers"
```

**If the project uses an ORM/DB not listed above**: Adapt accordingly. Read the project's existing migration files and schema definitions to understand the conventions before making changes. The preferred stack above is for new projects — always match what already exists.

Tell the user:
> "Database scope: [detected ORM/tool] with [detected DB]. I'll only touch [migrations/models/queries]. No application logic changes."

---

## STEP 2: Schema Change Planning

For ANY schema modification:

```markdown
### Planned Schema Change

**Table**: [name]
**Operation**: [ADD COLUMN / DROP COLUMN / CREATE TABLE / ALTER TYPE / ADD INDEX]

**Migration (up)**:
[exact SQL or ORM migration code]

**Migration (down / rollback)**:
[exact reverse operation]

**Data impact**:
- Existing rows affected: [YES (how) / NO]
- Nullable: [YES/NO]
- Default value: [value or NONE]
- Breaking change for app: [YES (what breaks) / NO]
```

**Ask for confirmation** before generating the migration.

---

## STEP 3: Implementation

### Migration Workflow

1. **Generate migration** (don't hand-write if ORM supports generation):
   ```bash
   # Drizzle (TypeScript)
   npx drizzle-kit generate

   # SQLAlchemy / Alembic (Python)
   alembic revision --autogenerate -m "[descriptive_name]"

   # Other ORMs — read existing migration files to learn the project's generate command
   # Check package.json scripts, Makefile, or README for project-specific commands
   ```

2. **Review generated migration** — Read the file, verify it matches the plan

3. **Apply migration** (local/dev only):
   ```bash
   # Drizzle
   npx drizzle-kit push   # dev
   npx drizzle-kit migrate # production-style

   # SQLAlchemy / Alembic
   alembic upgrade head

   # Other — find the project's apply command in scripts or docs
   ```

4. **Update models/types** if needed after migration

### Query Logic
- Use the ORM's query builder — no raw SQL unless performance requires it
- Parameterize ALL queries (never string-concatenate user input)
- Add appropriate indexes for new query patterns
- Consider N+1 query risks for related data

---

## STEP 4: Seed Data (If Applicable)

If the schema change needs seed data:
1. Update seed files to include the new fields/tables
2. Ensure seeds are idempotent (can run multiple times safely)
3. Use realistic data formats (don't assume email formats, ID structures — check existing seeds)

---

## STEP 5: Verification

```bash
# Migration applied cleanly? (use whichever applies to the project)
# Drizzle: check drizzle output from push/migrate
# Alembic: alembic current
# Other: check migration status via the project's tooling

# TypeScript projects — type check
npx tsc --noEmit --pretty 2>&1 | tail -30

# Python projects — type check (if configured)
mypy . 2>/dev/null | tail -20 || python -m py_compile [changed_files]

# Tests pass (queries still work)?
npm test -- --watchAll=false 2>&1 | tail -30  # JS/TS
pytest 2>&1 | tail -30  # Python

# Rollback verification (only run if user confirms):
# Drizzle: npx drizzle-kit drop
# Alembic: alembic downgrade -1
```

---

## STEP 6: Report

```markdown
## Database Changes Complete

**ORM**: [Prisma/TypeORM/Knex/etc.]
**Migration**: [migration name/file]

### Schema Changes
| Table | Column | Type | Operation |
|-------|--------|------|-----------|
| [table] | [column] | [type] | ADD/ALTER/DROP |

### Rollback Plan
```
[exact rollback command or SQL]
```

### Verification
- Migration applied: YES/NO
- TypeScript: PASS/FAIL
- Tests: PASS/FAIL
- Rollback tested: YES/NO/SKIPPED

### Data Impact
- Existing data affected: [YES (how) / NO]
- Backfill needed: [YES (what) / NO]
```
