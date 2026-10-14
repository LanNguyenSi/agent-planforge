---
type: invariant
title: Output layout and conditional groups
description: LAYOUT_REGISTRY is the one list of generated paths; the specs, runbooks and governance groups are gated by the same predicate in the writer and in planforge-index.json; prompts/ and the runtime templates are written outside that index contract; a reused outdir keeps files from earlier runs.
tags: [output, layout, planforge-index, conditional-groups]
timestamp: 2026-10-11T16:10:35Z
sources:
  - scripts/bootstrap-plan.js
  - models/planforge-index.schema.json
---

# Output layout and conditional groups

## The invariant

- Every path that `planforge-index.json` names comes from `LAYOUT_REGISTRY`,
  and a conditional directory (`specs`, `runbooks`, `governance`) appears in
  the index of a run exactly when that run wrote it, because one predicate
  gates both the writer and the index entry.

## Where it's enforced

- `LAYOUT_REGISTRY` lists the root files, the always-present directories, the
  three conditional directories, the `planning/` and `exports/` files and the
  `.ai/` files
  (`scripts/bootstrap-plan.js:164-207#".ai/DECISIONS.md"`). The declaration
  order of `conditionalDirectories` fixes the order in which they are appended
  to the index
  (`scripts/bootstrap-plan.js:184-191#"governance:"`).
- `renderPlanforgeIndex` copies the registry maps and appends a conditional
  directory only when its `presence` flag is set
  (`scripts/bootstrap-plan.js:3120-3129#"directories[key] = dir"`).
- `main()` computes the flags: `specs` from `--clarify`, `runbooks` and
  `governance` from `shouldWriteRunbooks` and `shouldWriteGovernance`
  (`scripts/bootstrap-plan.js:3605-3609#"governance: shouldWriteGovernance(output)"`).
  `writeTemplateArtifacts` calls the same two predicates before writing
  `runbooks/release-readiness.md` and the four `governance/` files
  (`scripts/bootstrap-plan.js:3368-3377#"exception-register.md"`).
- The index is validated against `models/planforge-index.schema.json` before
  the output tree is written
  (`scripts/bootstrap-plan.js:3613-3614#"models/planforge-index.schema.json"`);
  a `--clarify` or `--auto-clarify` run has already written the two
  clarification files by then, unless `--validate-only` is set, which skips
  those writes
  (`scripts/bootstrap-plan.js:3585#"prepareClarifications("`),
  and the schema rejects unknown top-level and `context` keys
  (`models/planforge-index.schema.json:1-5#"additionalProperties"`,
  `models/planforge-index.schema.json:27-29#"additionalProperties"`). Its path
  maps (`rootFiles`, `directories`, `planning`, `exports`, `ai`) accept any
  alphanumeric key
  (`models/planforge-index.schema.json:80-85#"^[A-Za-z][A-Za-z0-9]*$"`), so
  the registry, not the schema, fixes which paths appear.
- The rerun report's `regeneratedArtifacts` list is built from registry
  entries too
  (`scripts/bootstrap-plan.js:2932-2939#"LAYOUT_REGISTRY.exports.scaffoldkit"`).

## Groups and their conditions

| Group | Written when | In the index |
|-------|--------------|--------------|
| Root files, `.planforge/docs/`, `.ai/`, `planning/`, `exports/scaffoldkit-input.json`, `adrs/`, `tasks/`, `.planforge/tooling/BRANCH_INFO.md` | every run that is not `--validate-only` and not stopped by `--clarify` | yes, always (as a file or as its directory) |
| `specs/clarifications.md` | `--clarify`, not with `--validate-only` | `specs`, when `--clarify` is set |
| `prompts/clarify-prompt.md` | `--clarify`, not with `--validate-only` | no |
| `runbooks/release-readiness.md` | phase is `phase_2` or `phase_3` | `runbooks`, same predicate |
| `governance/` (four files) | path is `enterprise` | `governance`, same predicate |
| `Makefile`, `Dockerfile.dev`, `docker-compose.dev.yml`, `.dockerignore`, `.husky-pre-commit`, `lint-staged.config.js` under `.planforge/tooling/` | `shouldWriteRuntimeTemplates` is true | only as the always-listed `tooling` directory |

Details behind the table:

- The always-written files come from the write sequence in `main()`
  (`scripts/bootstrap-plan.js:3637-3652#"preservePreviousRunArtifacts(previousRun"`).
  `BRANCH_INFO.md` is written unconditionally
  (`scripts/bootstrap-plan.js:3651#"writeBranchInfo(planforgeRoot"`), so the
  `.planforge/tooling` directory the index always lists exists on every run.
- The clarify step writes `specs/clarifications.md` and
  `prompts/clarify-prompt.md` under the outdir, or under the cwd when no
  `--outdir` is given
  (`scripts/bootstrap-plan.js:743-753#"clarify-prompt.md"`). The registry has
  no `prompts` entry, so the index never names that directory.
- `inferPath` returns `enterprise` only for `phase_3`
  (`scripts/bootstrap-plan.js:1166-1167#"return phase ==="`), and
  `shouldWriteRunbooks` is true for `phase_3`
  (`scripts/bootstrap-plan.js:213-218#"output.path ==="`), so a run with
  `governance/` always has `runbooks/` as well.
- `shouldWriteRuntimeTemplates` returns true when the outdir already has a
  `package.json`. Otherwise it reads the blueprint from
  `exports/scaffoldkit-input.json` (falling back to a root-level
  `scaffoldkit-input.json`), returns false for `cli-tool`, the two Symfony
  blueprints, and inputs that match the no-external-database or
  git-as-store heuristics, and returns true only for `nextjs-fullstack`,
  `nextjs-frontend`, `express-api`, `rest-api` and `saas-dashboard`
  (`scripts/bootstrap-plan.js:3403-3428#"has(blueprint)"`). The blueprint it
  reads is the one this run just wrote, because `writeOperationalArtifacts`
  runs before the check
  (`scripts/bootstrap-plan.js:3644-3646#"shouldWriteRuntimeTemplates(input"`).
  The two heuristics are regular expressions over the summary and
  constraints, plus the core features for the git one
  (`scripts/bootstrap-plan.js:1555-1560#"filesystem is the source of truth"`,
  `scripts/bootstrap-plan.js:1563-1569#"daily logs"`).
- `handoff/` is not part of the layout. `handoffPath` survives only to name
  the user-authored `handoff/runner` directory that a later run preserves;
  see [Rerun and resume](rerun-and-resume.md).

## What breaks it

- A new conditional writer added without a registry entry and a shared
  predicate: the files land on disk and the index does not mention them,
  which is the state `prompts/` is in today.
- A predicate called in only one of the two places (writer or index flags):
  the index then names a directory that is missing, or omits one that exists.
- A reused outdir. The run creates the outdir with `ensureDir` and writes files
  into it (`scripts/bootstrap-plan.js:3625-3628#"ensureDir(outdir)"`);
  `writeFile` only creates parent directories and overwrites
  (`scripts/bootstrap-plan.js:131-137#"fs.writeFileSync(targetPath"`), and no
  step removes files. A `governance/` or `runbooks/` directory, a runtime
  template or a task file from an earlier run into the same outdir therefore
  stays on disk when the new run does not write it, and the new index omits
  the directory. The index never names a directory that is absent; it can
  miss one that is present.
