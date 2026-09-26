# Configuration

## Config Override Merge Semantics

Planner config overrides (`--config`, see [docs/operational-workflow.md](operational-workflow.md)) are merged onto the base config (`config/planner-config.json`) instead of replacing it wholesale.

Rules:

- top-level scalars like `defaultProfile` replace the base value when provided
- guidance and artifact arrays are merged as ordered unions
- per-phase guidance and artifact maps merge by phase key, then union their arrays
- profile `intakePolicy` merges by key
- `governanceDefaults` merges by key

Example:

`examples/planner-config.override.json` overrides only a few fields. Running with `--config` keeps the base config and adds:

- `founder feedback loop` to `startup.phase_1` guidance
- `third-party risk review` to `common.guidanceAreasByPhase.phase_3`
- a custom `breakGlassCadence`

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample-custom \
  --config examples/planner-config.override.json
```

The merged config is validated against `models/planner-config.schema.json`; override keys are checked structurally before merging.
