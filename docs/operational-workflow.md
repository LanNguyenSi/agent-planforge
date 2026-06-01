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
- `.planforge/docs/project-charter.md`
- `.planforge/docs/architecture-overview.md`
- `.planforge/docs/delivery-plan.md`
- `planning/rerun-summary.md`

If the input was parsed from text or markdown, check `planning/structured-input.json` before trusting the backlog.

When a clarification pass was used, review `specs/clarifications.md` before trusting downstream task slicing.

## 3. Know When Review Is Required

Default review flow:

- intake clarification before architecture or delivery continues
- architecture review before execution scales beyond the first wave
- governance review for enterprise-path work before execution continues
- explicit human approval for execution on stricter profiles

## 4. Rerun Or Resume Deliberately

Use `--rerun-from` when you want a fresh planning pass with explicit diff reporting:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample-rerun \
  --rerun-from out/sample
```

Use `--resume-from` when you want the new run to preserve manual run state such as `reviews/` or `notes/`:

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

## 5. Downstream Exports

Every run also emits:

- `exports/scaffoldkit-input.json` for codebase scaffolding
- `.ai/` context files for coding agents

Treat these as generated derivatives of the planning package. If the plan changes materially, rerun the planner instead of editing them by hand.
When ScaffoldKit is available, `exports/scaffoldkit-input.json` can be used directly with `scaffoldkit from-planforge`.

## 6. Run Consistency Analysis Before Implementation

After planning artifacts exist, run:

```bash
node scripts/analyze-artifacts.js --outdir out/sample
```

Review:

- `outputs/consistency-report.md`
- `prompts/analyze-prompt.md`

Use the report as a CI gate or pre-implementation sanity check when tasks, plan output, or task markdown may have drifted.
