# Output Layout Migration

## Why This Changed

Older `agent-planforge` output wrote many machine-oriented JSON files directly into the project root.

The current layout keeps the root focused on human and agent entry points:

- `AGENTS.md`
- `CLAUDE.md`
- `planforge-index.json`
- `PROJECT.md`
- `project-charter.md`
- `architecture-overview.md`
- `delivery-plan.md`

Machine-oriented artifacts now live in grouped directories.

## New Layout

- `planning/` for planning state and rerun metadata
- `handoff/` for orchestration and runner state
- `exports/` for downstream tool exports
- `.ai/` for agent-facing context

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
