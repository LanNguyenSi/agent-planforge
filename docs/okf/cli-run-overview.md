---
type: overview
title: CLI run overview
description: The step order of one scripts/bootstrap-plan.js run (main), its two root directories, its exit codes, and which concept doc covers each later step.
tags: [overview, cli, exit-codes]
timestamp: 2026-10-11T15:44:44Z
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
  (`scripts/bootstrap-plan.js:3550-3663#"process.exit(EXIT_CODES.RUNTIME)"`).
  The rest of the file is helpers that `main()` calls in a fixed order.

## Step order

1. **Arguments.** `parseArgs` turns every flag into a field and rejects an
   unknown one with a usage error
   (`scripts/bootstrap-plan.js:79#"Unknown argument"`). `main()` then requires
   `--input`, rejects `--resume-from` together with `--rerun-from`, and
   requires `--outdir` unless `--validate-only` or `--clarify` is set
   (`scripts/bootstrap-plan.js:3559-3569#"Missing required argument: --outdir"`).
2. **Two roots.** `planforgeRoot` is the checkout the script lives in and
   `workingDir` is the process cwd
   (`scripts/bootstrap-plan.js:3572-3573#"const workingDir = process.cwd()"`).
   `--input` and `--outdir` resolve against the cwd, while the planner config
   and an override passed with `--config` resolve against the checkout
   (`scripts/bootstrap-plan.js:528-530#"const overrideConfig = readJson(resolvedOverridePath"`).
3. **Context.** The playbook adoption model, the scaffoldkit blueprint list,
   the planner config and the planning input are loaded before any planning
   happens
   (`scripts/bootstrap-plan.js:3575-3578#"const loadedInput = loadPlanningInput"`).
   The first two can come from sibling checkouts; see
   [External lookups](external-lookups.md).
4. **Clarify stop.** With `--clarify`, the run writes the clarification files
   and returns with exit 0 while any question is unanswered, unless
   `--auto-clarify` fills in the defaults; answered questions are folded into
   the input
   (`scripts/bootstrap-plan.js:3582-3590#"input = clarification.enrichedInput"`).
5. **Previous run.** `--resume-from` or `--rerun-from` loads an earlier run;
   see [Rerun and resume](rerun-and-resume.md).
6. **Plan.** `buildOutput` infers phase and path, picks the architecture and
   blueprint, and builds tasks; the run then renders the index, builds the
   rerun report, and validates both the plan and the index against their
   schemas
   (`scripts/bootstrap-plan.js:3594-3604#"models/planforge-index.schema.json"`).
7. **Validate-only exit.** `--validate-only` stops here and writes nothing
   further
   (`scripts/bootstrap-plan.js:3606-3610#"Validation succeeded for input, config, and generated planning output."`);
   with `--clarify` or `--auto-clarify` the clarification files from step 4
   are already on disk.
8. **Writes.** The output tree is written in a fixed order and earlier-run
   state is copied in last; see
   [Output layout and conditional groups](output-layout.md).
9. **Install.** Unless `--no-install` is passed, `runNpmInstall` runs
   `npm install` in the outdir, but only when the outdir has a `package.json`
   (`scripts/bootstrap-plan.js:3486-3490#"if (!fs.existsSync(packageJsonPath))"`).
   The HTTP service always passes `--no-install`.

## Exit codes

`EXIT_CODES` defines three non-zero codes
(`scripts/bootstrap-plan.js:11-15#"RUNTIME: 3"`):

- `1` (usage): an unknown flag, a missing `--input` or `--outdir`, both
  previous-run flags at once, or an unsupported `--format`
  (`scripts/bootstrap-plan.js:711-712#"Unsupported format"`).
- `2` (validation): input that is not valid JSON, or a planning input,
  planner config or generated output that fails its schema
  (`scripts/bootstrap-plan.js:284-293#"Schema validation failed for"`).
- `3` (runtime): a file that cannot be read, a previous run without a plan
  output, a failed `npm install`
  (`scripts/bootstrap-plan.js:3520-3522#"EXIT_CODES.RUNTIME"`), and any error
  that is not a `CliError`
  (`scripts/bootstrap-plan.js:3653-3661#"process.exit(EXIT_CODES.RUNTIME)"`).

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
