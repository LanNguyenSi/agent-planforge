# scaffoldkit → planforge Workflow Guide

## Overview

This guide explains the end-to-end workflow for using **scaffoldkit** and **agent-planforge** together to generate a production-ready project.

## The Two Tools

### scaffoldkit
**Purpose:** Generate initial project structure (files, configs, boilerplate)

**Responsibilities:**
- Creates file structure (Dockerfile, docker-compose, Makefile)
- Generates basic AI context files (.ai/AGENTS.md, .ai/ARCHITECTURE.md)
- Sets up development environment
- Creates pre-commit hooks
- Generates README and documentation stubs

**Output:** A runnable project skeleton with infrastructure files

### agent-planforge
**Purpose:** Enrich the skeleton with detailed planning artifacts

**Responsibilities:**
- Generates task breakdown (8 tasks in waves)
- Creates ADRs (Architecture Decision Records)
- Generates execution prompts for AI agents
- Creates handoff manifests
- Enriches AI context files with planning details
- Generates package.json with correct dependencies

**Output:** A planning-complete project ready for development

## File Ownership Model

### scaffoldkit Owns (Generated First)
- `Dockerfile.dev`, `docker-compose.dev.yml`
- `Makefile` (basic structure)
- `.ai/AGENTS.md`, `.ai/ARCHITECTURE.md` (initial versions)
- `.husky-pre-commit`, `lint-staged.config.js`
- `README.md` (initial version)

### planforge Owns (Enriches/Replaces)
- `tasks/*.md` (8 task files)
- `docs/adrs/*.md` (Architecture Decision Records)
- `prompts/*.md` (AI agent prompts)
- `docs/runner/*.json` (handoff manifests)
- `.ai/*` files (enriched with planning context)
- `package.json` (with complete dependencies)
- `plan-output.json`, `handoff-manifest.json`

### Shared (Modified by Both)
- `.ai/ARCHITECTURE.md`: scaffoldkit creates, planforge enriches
- `.ai/DECISIONS.md`: scaffoldkit creates, planforge enriches
- `Makefile`: scaffoldkit creates base, planforge may add hooks

## End-to-End Workflow

### Step 1: Run scaffoldkit

```bash
# Install scaffoldkit (if not already installed)
cd /path/to/scaffoldkit
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

# Generate project
scaffoldkit new nextjs-fullstack \\
  --var project_name=my-app \\
  --var db_provider=sqlite \\
  --var auth_strategy=jwt \\
  --var use_docker=true \\
  --var use_analytics=true \\
  --non-interactive
```

**What happens:**
- Creates `my-app/` directory
- Generates infrastructure files (Docker, Makefile)
- Creates basic `.ai/` context
- Sets up pre-commit hooks
- Initializes git repository

**Commit the scaffoldkit output:**
```bash
cd my-app
git add .
git commit -m "chore: scaffoldkit initial structure"
```

### Step 2: Create planforge-input.json

Create `planforge-input.json` in your project:

```json
{
  "projectName": "my-app",
  "summary": "A modern web application with authentication and analytics",
  "targetUsers": [
    "End users who need secure access",
    "Administrators who manage the system"
  ],
  "coreFeatures": [
    "User authentication with JWT",
    "Analytics dashboard",
    "Data management"
  ],
  "constraints": [
    "Must support SQLite",
    "Must be dockerized"
  ],
  "architectureShape": "Next.js App Router fullstack",
  "plannerProfile": "product",
  "teamSize": 3,
  "productionExpectedSoon": true
}
```

### Step 3: Run planforge

```bash
# Run from anywhere (no cd required thanks to PR #40!)
/path/to/agent-planforge/scripts/bootstrap-plan.js \\
  --input /path/to/my-app/planforge-input.json \\
  --outdir /path/to/my-app \\
  --install
```

**What happens:**
- Reads your planforge-input.json
- Loads config from planforge repo (automatic, no copying needed)
- Generates 8 tasks in `tasks/` directory
- Creates ADRs in `docs/adrs/`
- Generates AI prompts in `prompts/`
- Enriches `.ai/` files
- Creates `package.json` with dependencies
- Runs `npm install` (if --install flag used)

**Commit the planforge output:**
```bash
cd my-app
git add .
git commit -m "chore: planforge task breakdown and planning artifacts"
```

### Step 4: Review the Output

**Task breakdown:**
```bash
ls tasks/
# 001-api-foundation.md
# 002-ui-foundation.md
# 003-user-authentication-with-jwt.md
# 004-analytics-dashboard.md
# 005-data-management.md
# 006-integration-coverage.md
# 007-production-readiness.md
# 008-documentation.md
```

**ADRs (Architecture Decision Records):**
```bash
ls docs/adrs/
# 0001-architecture.md
# 0002-data-store.md
# 0003-authentication.md
```

**AI Prompts:**
```bash
ls prompts/
# architecture-analysis.md
# task-001.md
# task-002.md
# ...
```

### Step 5: Execute Tasks

**Option A: Manual Implementation**
Read `tasks/001-api-foundation.md` and implement according to the guidance.

**Option B: AI Agent Implementation**
```bash
# Use Claude Code / Codex / etc
claude code --task tasks/001-api-foundation.md
```

**Option C: Automated Workflow**
Use the handoff manifest for automation:
```bash
cat docs/runner/handoff-manifest.json
# Contains task sequence, dependencies, acceptance criteria
```

## Common Scenarios

### Scenario 1: Changing Configuration

If you need to change planforge configuration:

```bash
# Create override in your project
cat > planforge-config.override.json << 'EOF'
{
  "waves": {
    "wave_0": { "label": "Custom Foundation" }
  }
}
EOF

# Run with override
/path/to/agent-planforge/scripts/bootstrap-plan.js \\
  --input planforge-input.json \\
  --outdir . \\
  --config planforge-config.override.json
```

### Scenario 2: Re-running planforge

If you need to regenerate planning artifacts:

```bash
# planforge won't overwrite existing files by default
# To force regeneration, remove old files first:
rm -rf tasks/ docs/adrs/ prompts/ plan-output.json

# Re-run planforge
/path/to/agent-planforge/scripts/bootstrap-plan.js \\
  --input planforge-input.json \\
  --outdir .
```

### Scenario 3: Adding More Features

To add features after initial generation:

1. Update `planforge-input.json` with new features
2. Re-run planforge (it will generate new tasks)
3. Review and implement the new tasks

## Path Resolution (PR #40 Fix)

### Internal planforge Paths
These resolve from the planforge repository:
- `config/planner-config.json`
- `config/stack-patterns.json`
- `models/*.schema.json`
- Template files

### User-Provided Paths
These resolve from your current working directory:
- `--input planforge-input.json`
- `--outdir .`
- `--config planforge-config.override.json`

**Example:**
```bash
# You are in: /home/user/projects/my-app
# planforge is in: /opt/agent-planforge

/opt/agent-planforge/scripts/bootstrap-plan.js \\
  --input planforge-input.json \\  # Looks in /home/user/projects/my-app/
  --outdir .                        # Outputs to /home/user/projects/my-app/

# Config loaded from: /opt/agent-planforge/config/
# No manual copying needed!
```

## Best Practices

### 1. Version Control Strategy

**Commit after each stage:**
```bash
git commit -m "chore: scaffoldkit structure"      # After Step 1
git commit -m "chore: planforge planning"         # After Step 3
git commit -m "feat: implement task 001"          # After each task
```

### 2. Don't Edit Generated Files Directly

Files that will be regenerated:
- `tasks/*.md`
- `docs/adrs/*.md`
- `prompts/*.md`
- `plan-output.json`

If you need changes, update `planforge-input.json` and re-run.

### 3. Customize in the Right Place

**scaffoldkit customization:**
- Modify blueprint templates in scaffoldkit repo
- Or use `--var` flags to override variables

**planforge customization:**
- Create `planforge-config.override.json`
- Edit `planforge-input.json` for project-specific changes

### 4. CI/CD Integration

```yaml
# .github/workflows/scaffold.yml
name: Scaffold Project

on:
  workflow_dispatch:
    inputs:
      project_name:
        required: true

jobs:
  scaffold:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install scaffoldkit
        run: |
          git clone https://github.com/LanNguyenSi/scaffoldkit
          cd scaffoldkit
          python3 -m venv .venv
          .venv/bin/pip install -e .
      
      - name: Generate structure
        run: |
          scaffoldkit/venv/bin/scaffoldkit new nextjs-fullstack \\
            --var project_name=${{ inputs.project_name }} \\
            --var db_provider=sqlite \\
            --non-interactive
      
      - name: Run planforge
        run: |
          git clone https://github.com/LanNguyenSi/agent-planforge
          agent-planforge/scripts/bootstrap-plan.js \\
            --input ${{ inputs.project_name }}/planforge-input.json \\
            --outdir ${{ inputs.project_name }}
```

## Troubleshooting

### Issue: "config/planner-config.json not found"

**Old behavior (before PR #40):** You had to copy config files manually.

**New behavior (after PR #40):** Configs are auto-loaded from planforge repo.

**Fix:** Update to latest agent-planforge (PR #40 merged).

### Issue: "Invalid --var format"

**Problem:** Using `--var` with old scaffoldkit version.

**Fix:** Update to latest scaffoldkit (PR #21 merged).

### Issue: Files getting overwritten

**Explanation:** planforge enriches some files scaffoldkit creates.

**Expected behavior:**
- `.ai/ARCHITECTURE.md`: scaffoldkit creates basic structure, planforge adds planning details
- `Makefile`: scaffoldkit creates targets, planforge may add hooks

**Not a bug:** This is intentional enrichment, not a conflict.

## FAQ

**Q: Do I need to copy config files manually?**
A: No! After PR #40, configs are loaded from planforge repo automatically.

**Q: Can I run scaffoldkit and planforge in different directories?**
A: Yes! Use full paths for both tools. They work from anywhere.

**Q: What if I skip scaffoldkit and only use planforge?**
A: planforge expects some basic structure. Use scaffoldkit first for best results.

**Q: Can I use planforge without scaffoldkit?**
A: Yes, but you'll need to create the basic project structure manually.

**Q: How do I update just the planning artifacts?**
A: Remove `tasks/`, `docs/adrs/`, `prompts/` and re-run planforge.

**Q: Can I customize the task templates?**
A: Yes, modify templates in agent-planforge repo or create a fork.

## Related Documentation

- [scaffoldkit README](https://github.com/LanNguyenSi/scaffoldkit)
- [agent-planforge README](https://github.com/LanNguyenSi/agent-planforge)
- [Blueprint Variables](../blueprints/nextjs-fullstack/blueprint.yaml)
- [Planning Input Schema](../models/planning-input.schema.json)
- [Stack Patterns](../config/stack-patterns.json)

## Changelog

**2026-03-23:**
- Added workflow guide (Issue #38)
- Documented PR #40 path resolution fix
- Added PR #21 non-interactive mode examples
- Added CI/CD integration example
