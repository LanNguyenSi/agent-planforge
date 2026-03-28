# Operational Workflow

## 1. Start With The Best Available Input

Run the planner with either structured JSON or heuristic parsing for text or markdown:

```bash
node scripts/bootstrap-plan.js --input examples/sample-input.json --outdir out/sample
node scripts/bootstrap-plan.js --input examples/sample-input.md --format markdown --outdir out/sample-md
```

Use `--validate-only` when you want schema and generation validation without writing artifacts.

If the source input is still underspecified, generate clarification questions first:

```bash
node scripts/bootstrap-plan.js --input examples/minimal-input.json --clarify
node scripts/bootstrap-plan.js --input examples/minimal-input.json --outdir out/sample --auto-clarify
```

## 2. Review The First Planning Package

If you previously relied on root-level JSON artifacts, first read `docs/output-layout-migration.md`.

After each run, review these files first:

- `AGENTS.md`
- `CLAUDE.md`
- `planforge-index.json`
- `planning/structured-input.json`
- `planning/plan-output.json`
- `project-charter.md`
- `architecture-overview.md`
- `delivery-plan.md`
- `planning/rerun-summary.md`

If the input was parsed from text or markdown, check `planning/structured-input.json` before trusting the backlog.

When a clarification pass was used, review `specs/clarifications.md` before trusting downstream task slicing.

## 3. Use The Handoff Bundle

The handoff contract is split across:

- `handoff/manifest.json` for orchestration order, dependencies, policies, and approval gates
- `handoff/runner-contract.json` for status and result file conventions
- `handoff/runner/<step-id>/` for per-step input, status, result, and blocker files

Agents should read the prompt export for their step, update `handoff/runner/<step-id>/status.json` while working, and write final outputs into `handoff/runner/<step-id>/result.json`.

## 4. Know When Review Is Required

Default review flow:

- intake clarification before architecture or delivery continues
- architecture review before execution scales beyond the first wave
- governance review for enterprise-path work before execution continues
- explicit human approval for execution on stricter profiles

Do not skip approval gates by editing the manifest manually. Update the plan and rerun instead.

## 5. Rerun Or Resume Deliberately

Use `--rerun-from` when you want a fresh planning pass with explicit diff reporting:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample-rerun \
  --rerun-from out/sample
```

Use `--resume-from` when you want the new run to preserve manual step state such as `handoff/runner/`, `reviews/`, or `notes/`:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample-resume \
  --resume-from out/sample
```

Review:

- `planning/rerun-report.json`
- `planning/rerun-summary.md`

These identify changed assumptions, changed recommendations, regenerated artifacts, and preserved run-state artifacts.

## 6. Downstream Exports

Every run also emits:

- `exports/scaffoldkit-input.json` for codebase scaffolding
- `exports/devreview.json` for PR review policy
- `.ai/` context files for coding agents

Treat these as generated derivatives of the planning package. If the plan changes materially, rerun the planner instead of editing them by hand.
When ScaffoldKit is available, `exports/scaffoldkit-input.json` can be used directly with `scaffoldkit from-planforge`.

## 7. Run Consistency Analysis Before Implementation

After planning artifacts exist, run:

```bash
node scripts/analyze-artifacts.js --outdir out/sample
```

Review:

- `outputs/consistency-report.md`
- `prompts/analyze-prompt.md`

Use the report as a CI gate or pre-implementation sanity check when tasks, plan output, or task markdown may have drifted.
