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
- `AGENTS.md`
- `.ai/AGENTS.md`
- `.ai/ARCHITECTURE.md`
- `.ai/TASKS.md`
- `.ai/DECISIONS.md`
- `planning/rerun-report.json`
- `planning/rerun-summary.md`
- `exports/scaffoldkit-input.json`
- `governance/` when the enterprise path applies
- `runbooks/` for `phase_2` and `phase_3`

See [Phase, Path, And Profile](architecture.md#phase-path-and-profile) for when these apply.

### planforge Tooling Templates (under `.planforge/tooling/`)

- `.planforge/tooling/Makefile`
- `.planforge/tooling/Dockerfile.dev`, `.planforge/tooling/docker-compose.dev.yml`, `.planforge/tooling/.dockerignore`
- `.planforge/tooling/.husky-pre-commit`, `.planforge/tooling/lint-staged.config.js`
- `.planforge/tooling/BRANCH_INFO.md`

`BRANCH_INFO.md` is always written. The Makefile, Docker and pre-commit templates are written only under the conditions listed in [Output Layout](operational-workflow.md#output-layout): the output directory already contains a `package.json`, or the recommended blueprint is one of the web or API blueprints listed there and the input neither rules out an external database nor uses git as its store.

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

Use only fields defined by `models/planning-input.schema.json`; unknown keys fail validation. The fields are listed in [Inputs And Outputs](architecture.md#inputs-and-outputs).

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
  --outdir /path/to/my-app \
  --clarify
```

The run writes `specs/clarifications.md` into the output directory and stops while questions are unanswered. Fill in the `Answer:` lines and rerun the same command. Without `--outdir`, the files, and after a completed run the whole planning package, are written into the current directory. See the clarification loop in [operational-workflow.md](operational-workflow.md#1-start-with-the-best-available-input).

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

Then inspect:

- `adrs/`
- `tasks/`
- `governance/` when present
- `runbooks/` when present

### 5. Commit The Planning Baseline

Commit the generated artifacts once the plan looks credible.

### 6. Lead With The Build

Start building from the plan:

- read `.planforge/docs/architecture-overview.md` for the shape of the system
- work the tasks in `tasks/` in dependency order, following `.ai/TASKS.md`
- keep `PROJECT.md` and `.ai/` as standing context while you implement

## Import Into ScaffoldKit

If local ScaffoldKit is available, you can use the generated `exports/scaffoldkit-input.json` directly:

```bash
scaffoldkit from-planforge /path/to/my-app/exports/scaffoldkit-input.json --target /path/to/my-app
```

`agent-planforge` now recommends real ScaffoldKit blueprints and includes `suggestedVariables` so ScaffoldKit can scaffold from the plan without manual re-entry.

### Export Fields

`exports/scaffoldkit-input.json` has these fields:

| Field | Content |
|---|---|
| `version` | export format version (`1.1`) |
| `exportedBy` | `agent-planforge` |
| `projectName` | from the planning input |
| `summary` | from the planning input |
| `blueprint` | recommended scaffoldkit blueprint |
| `blueprintCandidates` | candidate blueprints in order of preference |
| `blueprintReason` | why the blueprint was chosen |
| `blueprintConfidence` | `strong`, `medium` or `weak` |
| `blueprintValidatedLocally` | whether the blueprint was found in a local scaffoldkit checkout |
| `agentMustCreateStructure` | `true` exactly when `blueprintConfidence` is `weak` |
| `scaffoldExecutionSummary` | how to treat the scaffold |
| `scaffoldExecutionReason` | why manual structure work may be needed |
| `plannerProfile` | profile used for the plan |
| `architecture` | `shape`, `optionId`, `phase`, `path` |
| `stack` | `hint`, `dataStore`, `integrations` |
| `features` | the input's `coreFeatures` |
| `constraints` | the input's `constraints` |
| `suggestedVariables` | blueprint variables derived from the plan |
| `playbooks` | recommended playbook URLs |
| `aiContextFiles` | the `.ai/` context files |

`blueprintConfidence: weak` sets `agentMustCreateStructure` to `true` and means the scaffold is only a partial fit. `blueprintValidatedLocally` is `true` only when the blueprint was found in a local scaffoldkit checkout (see `SCAFFOLDKIT_ROOT` in [configuration.md](configuration.md#environment-variables-cli)).

## Re-Running Safely

Planforge overwrites its generated artifacts in the selected output directory.
Do not rely on manual cleanup as the normal rerun workflow.

`--rerun-from <dir>` and `--resume-from <dir>` behave the same way: both compare the previous run with the new one, write `planning/rerun-report.json` and `planning/rerun-summary.md`, and copy `reviews/`, `notes/`, `resume-notes.md`, `handoff-status.json`, `runner/` and `handoff/runner/` from the previous run into the new output directory when they exist. The only difference is the `mode` recorded in the report (`rerun` or `resume`). To start without old run state, run without either flag.

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

`analyze-artifacts.js` exits 1 when the report contains a critical issue, 1 on a usage error, and 2 on a runtime error. See [operational-workflow.md](operational-workflow.md#7-other-cli-options) for the exit codes of `bootstrap-plan.js`.
