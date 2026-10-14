---
type: overview
title: CLI run overview
description: The step order of one scripts/bootstrap-plan.js run (main), its two root directories, its exit codes, and which concept doc covers each later step.
tags: [overview, cli, exit-codes]
timestamp: 2026-10-11T16:10:35Z
sources:
  - scripts/bootstrap-plan.js
---

# CLI run overview

## What this covers

- One run of the planning CLI, `scripts/bootstrap-plan.js`, from argument
  parsing to the final summary line. The HTTP service in `server/` spawns the
  same script per request, so everything here also holds for a service run;
  see [HTTP generate pipeline](http-generate-pipeline.md) for what the
  service adds around it.

## Where to start reading

- `main()` drives the whole run inside one `try`/`catch`
  (`scripts/bootstrap-plan.js:3552-3673#"process.exit(EXIT_CODES.RUNTIME)"`).
  The rest of the file is helpers that `main()` calls in a fixed order.

## Step order

1. **Arguments.** `parseArgs` turns every flag into a field and rejects an
   unknown one with a usage error
   (`scripts/bootstrap-plan.js:79#"Unknown argument"`). `main()` then requires
   `--input`, rejects `--resume-from` together with `--rerun-from`, and
   requires `--outdir` unless `--validate-only` or `--clarify` is set
   (`scripts/bootstrap-plan.js:3561-3571#"Missing required argument: --outdir"`).
2. **Two roots.** `planforgeRoot` is the checkout the script lives in and
   `workingDir` is the process cwd
   (`scripts/bootstrap-plan.js:3574-3575#"const workingDir = process.cwd()"`).
   `--input` and `--outdir` resolve against the cwd, while the planner config
   and an override passed with `--config` resolve against the checkout
   (`scripts/bootstrap-plan.js:528-530#"const overrideConfig = readJson(resolvedOverridePath"`).
3. **Context.** The playbook adoption model, the scaffoldkit blueprint list,
   the planner config and the planning input are loaded before any planning
   happens
   (`scripts/bootstrap-plan.js:3577-3580#"const loadedInput = loadPlanningInput"`).
   The first two can come from sibling checkouts; see
   [External lookups](external-lookups.md).
4. **Clarify stop.** With `--clarify`, the run writes the clarification files
   and returns with exit 0 while any question is unanswered, unless
   `--auto-clarify` fills in the defaults; answered questions are folded into
   the input. With `--validate-only` the files are not written and the run does
   not stop: it reads existing answers, folds them in and continues
   (`scripts/bootstrap-plan.js:3584-3600#"input = clarification.enrichedInput"`).
5. **Previous run.** `--resume-from` or `--rerun-from` loads an earlier run;
   see [Rerun and resume](rerun-and-resume.md).
6. **Plan.** `buildOutput` infers phase and path, picks the architecture and
   blueprint, and builds tasks; the run then renders the index, builds the
   rerun report, and validates both the plan and the index against their
   schemas
   (`scripts/bootstrap-plan.js:3604-3614#"models/planforge-index.schema.json"`).
7. **Validate-only exit.** `--validate-only` stops here and writes nothing
   further
   (`scripts/bootstrap-plan.js:3616-3620#"Validation succeeded for input, config, and generated planning output."`);
   this holds with `--clarify` or `--auto-clarify` too, because step 4 skips
   its writes in validate-only mode.
8. **Writes.** The output tree is written in a fixed order and earlier-run
   state is copied in last; see
   [Output layout and conditional groups](output-layout.md).
9. **Install.** Unless `--no-install` is passed, `runNpmInstall` runs
   `npm install` in the outdir, but only when the outdir has a `package.json`
   (`scripts/bootstrap-plan.js:3488-3492#"if (!fs.existsSync(packageJsonPath))"`).
   The HTTP service always passes `--no-install`.

## Exit codes

`EXIT_CODES` defines three non-zero codes
(`scripts/bootstrap-plan.js:11-15#"RUNTIME: 3"`):

- `1` (usage): an unknown flag, a missing `--input` or `--outdir`, both
  previous-run flags at once, an unsupported `--format`
  (`scripts/bootstrap-plan.js:711-712#"Unsupported format"`), or a
  previous-run path that is neither a directory nor `plan-output.json`
  (`scripts/bootstrap-plan.js:2899#"must be a directory or plan-output.json"`).
- `2` (validation): input that is not valid JSON, a planning input, planner
  config or generated output that fails its schema
  (`scripts/bootstrap-plan.js:284-293#"Schema validation failed for"`), or a
  planner config or `--config` override that fails the structure checks of
  `validatePlannerConfigStructure` and
  `validatePlannerConfigOverrideStructure`
  (`scripts/bootstrap-plan.js:308#"Invalid planner config: ${message}"`,
  `scripts/bootstrap-plan.js:362#"Invalid planner config override: ${message}"`,
  `scripts/bootstrap-plan.js:399#"root must be an object"`).
- `3` (runtime): a file that cannot be read, a previous-run path that does
  not exist
  (`scripts/bootstrap-plan.js:2889#"Previous run path does not exist"`),
  a previous run without a plan output, a failed `npm install`
  (`scripts/bootstrap-plan.js:3522-3524#"EXIT_CODES.RUNTIME"`), and any error
  that is not a `CliError`
  (`scripts/bootstrap-plan.js:3663-3671#"process.exit(EXIT_CODES.RUNTIME)"`).

A clarify run that stops for answers and a `--help` run both exit 0.

## Key concept docs

- [Output layout and conditional groups](output-layout.md), which files every
  run writes and which groups depend on the plan.
- [Rerun and resume](rerun-and-resume.md), how an earlier run is compared and
  what is carried over.
- [HTTP generate pipeline](http-generate-pipeline.md), the service that wraps
  this run.
- [External lookups](external-lookups.md), the two sibling checkouts the CLI
  reads when present.
