# Output Layout Migration

## Why This Changed

Older `agent-planforge` output wrote many machine-oriented JSON files directly into the project root.

The current layout keeps the root focused on human and agent entry points:

- `AGENTS.md`
- `CLAUDE.md`
- `planforge-index.json`
- `PROJECT.md`

Planning prose and machine-oriented artifacts now live in grouped directories.

## New Layout

- `.planforge/docs/` for planning prose (charter, architecture overview, delivery plan, intake questionnaire)
- `.planforge/tooling/` for generic tooling templates (Makefile, Docker dev files, pre-commit helpers, BRANCH_INFO)
- `planning/` for planning state and rerun metadata
- `handoff/` for orchestration and runner state
- `exports/` for downstream tool exports
- `.ai/` for agent-facing context

## Removed Artifacts

As of the runner-vision removal, `agent-planforge` no longer emits `handoff/manifest.json`, `handoff/runner-contract.json`, `handoff/runner/`, `prompts/*.md` role packs, or `exports/devreview.json` at all. The `handoff/` directory and the related rows in the table below are retained only to explain pre-removal outputs, so people reading older generated packages can still resolve where those files came from. Current runs do not produce them.

## Old To New Paths

| Old path | New path |
|---|---|
| `plan-output.json` | `planning/plan-output.json` |
| `structured-input.json` | `planning/structured-input.json` |
| `rerun-report.json` | `planning/rerun-report.json` |
| `rerun-summary.md` | `planning/rerun-summary.md` |
| `handoff-manifest.json` | `handoff/manifest.json` |
| `runner-contract.json` | `handoff/runner-contract.json` |
| `runner/` | `handoff/runner/` |
| `scaffoldkit-input.json` | `exports/scaffoldkit-input.json` |
| `.devreview.json` | `exports/devreview.json` |
| `project-charter.md` | `.planforge/docs/project-charter.md` |
| `architecture-overview.md` | `.planforge/docs/architecture-overview.md` |
| `delivery-plan.md` | `.planforge/docs/delivery-plan.md` |
| `intake-questionnaire.md` | `.planforge/docs/intake-questionnaire.md` |
| `Makefile` | `.planforge/tooling/Makefile` |
| `Dockerfile.dev` | `.planforge/tooling/Dockerfile.dev` |
| `docker-compose.dev.yml` | `.planforge/tooling/docker-compose.dev.yml` |
| `.dockerignore` | `.planforge/tooling/.dockerignore` |
| `.husky-pre-commit` | `.planforge/tooling/.husky-pre-commit` |
| `lint-staged.config.js` | `.planforge/tooling/lint-staged.config.js` |
| `BRANCH_INFO.md` | `.planforge/tooling/BRANCH_INFO.md` |

## Compatibility Notes

- Use `planforge-index.json` as the machine-readable source of truth for the generated layout.
- Use `AGENTS.md` as the human-readable entry point for coding agents.
- `analyze-artifacts` and rerun/resume flows understand the new structure.
- Some read paths still tolerate older locations when consuming previous outputs, but new runs should use the new paths.

## Recommended Reading Order

1. `AGENTS.md`
2. `planforge-index.json`
3. `.ai/AGENTS.md`
4. `.ai/ARCHITECTURE.md`
5. `.ai/TASKS.md`
6. `.ai/DECISIONS.md`

## Updating Existing Automation

If you have scripts or agents that previously read root-level JSON files, update them to:

1. Read `planforge-index.json` first.
2. Resolve file locations from the index instead of hard-coding paths.
3. Fall back to the old root paths only when you must support already-generated legacy outputs.
