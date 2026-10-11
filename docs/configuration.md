# Configuration

## Config Override Merge Semantics

Planner config overrides (`--config`, see [docs/operational-workflow.md](operational-workflow.md)) are merged onto the base config (`config/planner-config.json`) instead of replacing it wholesale.

Rules:

- top-level scalars like `defaultProfile` replace the base value when provided
- guidance and artifact arrays are merged as ordered unions
- per-phase guidance and artifact maps merge by phase key, then union their arrays
- profile `intakePolicy` merges by key
- `governanceDefaults` merges by key

A relative `--config` path is resolved against the agent-planforge checkout, not the current directory. `--input`, `--outdir`, `--rerun-from` and `--resume-from` resolve against the current directory. Pass an absolute path when the override file lives outside the checkout.

Example:

`examples/planner-config.override.json` overrides only a few fields. Running with `--config` keeps the base config and:

- switches `defaultProfile` from `product` to `startup`, so inputs without `plannerProfile` (including `examples/sample-input.json`) are planned with the startup profile
- adds `discovery notes` to `common.guidanceAreasByPhase.phase_0` and `third-party risk review` to `common.guidanceAreasByPhase.phase_3`
- adds `third-party dependency register` to `common.artifactsByPhase.phase_3`
- adds `founder feedback loop` to the startup profile's `phase_1` guidance
- sets the startup `intakePolicy.nfrPriority` to `low`
- replaces `governanceDefaults.breakGlassCadence`

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample-custom \
  --config examples/planner-config.override.json
```

The merged config is validated against `models/planner-config.schema.json`; override keys are checked structurally before merging.

## Planner Config Keys

`config/planner-config.json` and override files use these keys. An override file with any other key is rejected with a validation error.

- `version`: non-empty string
- `defaultProfile`: `startup`, `product`, `enterprise` or `platform`; used when the input has no `plannerProfile`
- `common.guidanceAreasBase`: guidance areas for every phase
- `common.guidanceAreasByPhase`: guidance areas per phase (`phase_0` to `phase_3`)
- `common.artifactsBase`: recommended artifacts for every phase
- `common.artifactsByPhase`: recommended artifacts per phase
- `profiles.<startup|product|enterprise|platform>.guidanceAreaAdditionsByPhase`: profile-specific guidance areas per phase
- `profiles.<profile>.artifactAdditionsByPhase`: profile-specific artifacts per phase
- `profiles.<profile>.intakePolicy.nfrPriority`: `high`, `medium` or `low`
- `profiles.<profile>.intakePolicy.nfrBlocking`: boolean
- `governanceDefaults.accessReviewCadence`, `productionAccessCadence`, `administrativeAccessCadence`, `thirdPartyAccessCadence`, `breakGlassCadence`: cadence strings used in the generated governance documents

## Environment Variables (CLI)

`scripts/bootstrap-plan.js` reads two optional environment variables that point at sibling checkouts:

| Variable | Default | Effect |
|---|---|---|
| `AGENT_ENGINEERING_PLAYBOOK_ROOT` | `../agent-engineering-playbook` next to the agent-planforge checkout | When `<root>/models/adoption-model.json` exists, it replaces the bundled `models/playbook-adoption-model.json`; otherwise the bundled model is used. Generated playbook links are GitHub URLs either way. |
| `SCAFFOLDKIT_ROOT` | `../scaffoldkit` next to the agent-planforge checkout | When `<root>/src/scaffoldkit/blueprints/` exists, the recommended blueprint is the first candidate available there, and `blueprintValidatedLocally` in `exports/scaffoldkit-input.json` says whether it was found. Otherwise the first candidate is used and the flag is `false`. |
