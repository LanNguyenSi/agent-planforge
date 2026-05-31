# scaffoldkit -> planforge Workflow Guide

## Overview

Use `scaffoldkit` to create an initial runnable codebase.
Use `agent-planforge` to generate planning, governance, and downstream execution artifacts for that codebase.

The tools are related, but they do not own the same files.

## Current Division Of Responsibility

### scaffoldkit

Typical responsibilities:

- create the application skeleton
- initialize `package.json` and the dependency baseline
- create starter infrastructure such as Docker, CI, or Makefile files
- create starter documentation and repository structure

### agent-planforge

Current responsibilities:

- read planning input and infer a first delivery phase and path
- generate planning artifacts such as `.planforge/docs/project-charter.md`, `.planforge/docs/architecture-overview.md`, `.planforge/docs/delivery-plan.md`
- generate ADRs in `adrs/`
- generate task documents in `tasks/`
- generate prompt exports in `prompts/`
- generate orchestration files such as `handoff/manifest.json`, `handoff/runner-contract.json`, and `handoff/runner/`
- generate `.ai/` context files for downstream coding agents
- generate governance starter artifacts for enterprise-path plans

Important: `agent-planforge` does not generate `package.json`.
If a `package.json` already exists in the output directory, `--install` will run `npm install` there after artifact generation.

## File Ownership Model

If you are updating older automation that expected root-level JSON artifacts, read `docs/output-layout-migration.md` before wiring the new output paths.

### scaffoldkit Owns First

- application source tree
- `package.json`
- baseline Docker or runtime files
- initial repository automation

### planforge Generates Or Replaces

- `planning/plan-output.json`
- `planning/structured-input.json`
- `.planforge/docs/project-charter.md`
- `.planforge/docs/architecture-overview.md`
- `.planforge/docs/delivery-plan.md`
- `adrs/*.md`
- `tasks/*.md`
- `prompts/*.md`
- `AGENTS.md`
- `.ai/AGENTS.md`
- `.ai/ARCHITECTURE.md`
- `.ai/TASKS.md`
- `.ai/DECISIONS.md`
- `handoff/manifest.json`
- `handoff/runner-contract.json`
- `handoff/runner/`
- `planning/rerun-report.json`
- `planning/rerun-summary.md`
- `exports/scaffoldkit-input.json`
- `exports/devreview.json`
- `governance/` when the enterprise path applies
- `runbooks/` when production-oriented phases apply

### planforge Tooling Templates (under `.planforge/tooling/`)

- `.planforge/tooling/Makefile`
- `.planforge/tooling/Dockerfile.dev`, `.planforge/tooling/docker-compose.dev.yml`, `.planforge/tooling/.dockerignore`
- `.planforge/tooling/.husky-pre-commit`, `.planforge/tooling/lint-staged.config.js`
- `.planforge/tooling/BRANCH_INFO.md`

planforge writes its generic tooling templates under `.planforge/tooling/`, so they no longer overwrite scaffoldkit's blueprint-specific root `Makefile`, Docker, or pre-commit files. scaffoldkit owns the root copies; treat planforge's as reference templates to wire in deliberately.

## End-To-End Workflow

### 1. Generate The Project Skeleton

You can either run scaffoldkit first and then enrich the result with planforge, or let planforge recommend a scaffold and run scaffoldkit from that export afterward.

### 2. Create Planning Input

Create a planning input file inside the target project, for example `planforge-input.json`:

```json
{
  "projectName": "my-app",
  "summary": "A modern web application with authentication and analytics.",
  "targetUsers": [
    "end users",
    "administrators"
  ],
  "coreFeatures": [
    "user authentication",
    "analytics dashboard",
    "data management"
  ],
  "constraints": [
    "must support SQLite",
    "must be dockerized"
  ],
  "plannerProfile": "product",
  "teamSize": 3,
  "productionExpectedSoon": true
}
```

Use only fields defined by `models/planning-input.schema.json`.

### 3. Run planforge

```bash
node /path/to/agent-planforge/scripts/bootstrap-plan.js \
  --input /path/to/my-app/planforge-input.json \
  --outdir /path/to/my-app
```

If the input is still underspecified, do a clarification pass first:

```bash
node /path/to/agent-planforge/scripts/bootstrap-plan.js \
  --input /path/to/my-app/planforge-input.json \
  --clarify
```

Or continue with default answers:

```bash
node /path/to/agent-planforge/scripts/bootstrap-plan.js \
  --input /path/to/my-app/planforge-input.json \
  --outdir /path/to/my-app \
  --auto-clarify
```

If the output directory already contains a valid `package.json`, planforge will run `npm install` by default after generation.
Use `--no-install` when you only want the planning artifacts.

### 4. Review The Generated Package

Start with:

- `AGENTS.md`
- `CLAUDE.md`
- `planforge-index.json`
- `planning/structured-input.json`
- `planning/plan-output.json`
- `.planforge/docs/project-charter.md`
- `.planforge/docs/architecture-overview.md`
- `.planforge/docs/delivery-plan.md`
- `.ai/AGENTS.md`
- `handoff/manifest.json`

Then inspect:

- `adrs/`
- `tasks/`
- `prompts/`
- `handoff/runner/`
- `governance/` when present
- `runbooks/` when present

### 5. Commit The Planning Baseline

Commit the generated artifacts once the plan looks credible.

### 6. Execute From The Handoff Bundle

Use:

- `handoff/manifest.json` for orchestration order, dependencies, and approval gates
- `handoff/runner-contract.json` for step status conventions
- `prompts/` for role-specific prompt inputs
- `.ai/` for shared coding context

## Import Into ScaffoldKit

If local ScaffoldKit is available, you can use the generated `exports/scaffoldkit-input.json` directly:

```bash
scaffoldkit from-planforge /path/to/my-app/exports/scaffoldkit-input.json --target /path/to/my-app
```

`agent-planforge` now recommends real ScaffoldKit blueprints and includes `suggestedVariables` so ScaffoldKit can scaffold from the plan without manual re-entry.

## Re-Running Safely

Planforge overwrites its generated artifacts in the selected output directory.
Do not rely on manual cleanup as the normal rerun workflow.

Use these modes deliberately:

- `--rerun-from <dir>` for a fresh planning pass plus changed-assumption reporting
- `--resume-from <dir>` when runner state or manual execution notes should be preserved into a new output directory

Examples:

```bash
node /path/to/agent-planforge/scripts/bootstrap-plan.js \
  --input /path/to/my-app/planforge-input.json \
  --outdir /path/to/my-app-rerun \
  --rerun-from /path/to/my-app
```

```bash
node /path/to/agent-planforge/scripts/bootstrap-plan.js \
  --input /path/to/my-app/planforge-input.json \
  --outdir /path/to/my-app-resume \
  --resume-from /path/to/my-app
```

## Config Overrides

Override files are merged onto the base planner config and then validated.

Use the same structure as `config/planner-config.json`, but only specify the fields you want to add or replace.

Valid example:

```json
{
  "profiles": {
    "startup": {
      "guidanceAreaAdditionsByPhase": {
        "phase_1": [
          "founder feedback loop"
        ]
      }
    }
  },
  "governanceDefaults": {
    "breakGlassCadence": "After every use"
  }
}
```

Run with:

```bash
node /path/to/agent-planforge/scripts/bootstrap-plan.js \
  --input /path/to/my-app/planforge-input.json \
  --outdir /path/to/my-app \
  --config /path/to/my-app/planforge-config.override.json
```

## Consistency Check

After artifact generation, run:

```bash
node /path/to/agent-planforge/scripts/analyze-artifacts.js \
  --outdir /path/to/my-app
```

Review:

- `outputs/consistency-report.md`
- `prompts/analyze-prompt.md`

Use this before implementation if task documents, prompts, or plan outputs may have drifted.
