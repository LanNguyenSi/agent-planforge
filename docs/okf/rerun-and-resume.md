---
type: module
title: Rerun and resume
description: How --resume-from and --rerun-from locate an earlier run, what planning/rerun-report.json compares, and why both flags copy the same user-authored entries into the new outdir; the two flags differ only in the mode label.
tags: [module, cli, rerun, resume]
timestamp: 2026-10-11T12:43:21Z
sources:
  - scripts/bootstrap-plan.js
  - tests/bootstrap-plan.test.js
---

# Rerun and resume

## Responsibility

- Owns the comparison of a new run with an earlier one and the copy of
  user-authored state from the earlier outdir into the new one. It does not
  decide what a run generates: the planning output is built the same way with
  or without a previous run.

## Entry points

- The `--resume-from <dir>` and `--rerun-from <dir>` flags
  (`scripts/bootstrap-plan.js:57-61#"args.rerunFrom = argv[i + 1]"`), which
  cannot be combined
  (`scripts/bootstrap-plan.js:3563-3564#"not both"`).
- `main()` loads the previous run from whichever flag is set and derives the
  mode label `resume`, `rerun` or `fresh` from which one it was
  (`scripts/bootstrap-plan.js:3592-3593#"const rerunMode"`).

## Locating the previous run

- `loadPreviousRun` is called with the cwd
  (`scripts/bootstrap-plan.js:3592#"loadPreviousRun(workingDir"`), and
  `resolveRunDirectory` resolves the given path against it
  (`scripts/bootstrap-plan.js:2885#"path.resolve(repoRoot, runPath)"`), so a
  relative path resolves against the directory the command runs in, not
  against the checkout.
- `resolveRunDirectory` accepts a directory, or a file named
  `plan-output.json`; for a file inside `planning/` the run root is two levels
  up. A missing path is a runtime error (exit 3), and any other file is a usage
  error (exit 1)
  (`scripts/bootstrap-plan.js:2884-2897#"must be a directory or plan-output.json"`).
- The plan output is looked up at `planning/plan-output.json`, then at a
  root-level `plan-output.json`
  (`scripts/bootstrap-plan.js:2900-2905#"candidates.find"`). If neither exists
  the run stops with exit 3
  (`scripts/bootstrap-plan.js:2913-2916#"Previous run is missing"`).

## The rerun report

`buildRerunReport` returns the object that `writeOperationalArtifacts` writes
to `planning/rerun-report.json` and renders into `planning/rerun-summary.md`
on every run, including a fresh one
(`scripts/bootstrap-plan.js:3349-3350#"rerun-summary.md"`).

- **Fresh run.** With no previous run the report has `sourceRun: null`, empty
  change lists and an empty `preservedArtifacts`
  (`scripts/bootstrap-plan.js:2939-2946#"preservedArtifacts: []"`).
- **`regeneratedArtifacts`** is a fixed list of six registry paths
  (plan output, `PROJECT.md`, charter, architecture overview, delivery plan,
  scaffoldkit export), not a list of what changed
  (`scripts/bootstrap-plan.js:2930-2936#"LAYOUT_REGISTRY.exports.scaffoldkit"`).
- **`changedAssumptions`** names each of fourteen input fields whose value in
  the previous run's `inputSnapshot` differs from the new input, compared by
  `JSON.stringify`
  (`scripts/bootstrap-plan.js:2952-2967#"!valuesEqual(previousInput[field], input[field])"`).
- **`changedRecommendations`** can hold `phase`, `path`,
  `architectureRecommendation` (compared by `optionId`),
  `recommendedPlaybooks`, and `executionWaveSelection` (the task ids of the
  first execution wave)
  (`scripts/bootstrap-plan.js:2969-2986#"executionWaveSelection"`).
- **`preservedArtifacts`** lists which of six fixed candidates exist in the
  previous run's directory: `handoff/runner`, `handoff-status.json`,
  `resume-notes.md`, `reviews`, `notes` and `runner`
  (`scripts/bootstrap-plan.js:2989-2997#"preservedCandidates.filter"`). These
  names appear nowhere else in the script, so no writer emits them; they are
  entries a user or an agent placed in the earlier outdir.

## Preservation runs in both modes

- `buildRerunReport` fills `preservedArtifacts` without looking at the mode,
  and `main()` calls `preservePreviousRunArtifacts` after every writer, for
  every non-validate run
  (`scripts/bootstrap-plan.js:3641-3642#"preservePreviousRunArtifacts(previousRun"`).
  So `--rerun-from` copies the same entries as `--resume-from`; the flag only
  changes the `mode` value in the report and summary.
- `preservePreviousRunArtifacts` skips an entry whose source and target
  resolve to the same path, which happens when the new outdir is the previous
  run's directory
  (`scripts/bootstrap-plan.js:3299-3310#"copyDirectoryContents(sourcePath, targetPath)"`).
- `copyDirectoryContents` copies recursively, overwrites files of the same
  name and leaves other files in the target alone
  (`scripts/bootstrap-plan.js:3285-3296#"fs.copyFileSync(sourcePath, targetPath)"`).

## Key files

- `scripts/bootstrap-plan.js`, all of the logic above.
- `tests/bootstrap-plan.test.js`, the resume case: a base run, a hand-made
  `handoff/runner/custom-note.txt`, a resumed run with a changed summary, and
  assertions on `mode`, `changedAssumptions`, `preservedArtifacts` and the
  copied file
  (`tests/bootstrap-plan.test.js:801-833#"handoffRunnerFile(resumedOutdir"`).
  No test passes `--rerun-from`.

## Related

- The HTTP service never passes either flag, so a service run is always a
  fresh run; see [HTTP generate pipeline](http-generate-pipeline.md).
- [Output layout and conditional groups](output-layout.md) covers the files a
  run writes before the preservation step.
