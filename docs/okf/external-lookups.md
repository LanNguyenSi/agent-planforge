---
type: runbook
title: External lookups (scaffoldkit and engineering playbook)
description: The two optional sibling checkouts the CLI reads (SCAFFOLDKIT_ROOT and AGENT_ENGINEERING_PLAYBOOK_ROOT), what each changes in the output, how to point a direct CLI run at them or force the bundled fallback, and how to verify the result.
tags: [runbook, cli, scaffoldkit, playbooks, environment]
timestamp: 2026-10-11T12:43:21Z
sources:
  - scripts/bootstrap-plan.js
  - scripts/refresh-example-outputs.js
  - models/playbook-adoption-model.json
---

# External lookups (scaffoldkit and engineering playbook)

This runbook covers a direct `scripts/bootstrap-plan.js` run. Both lookups are
optional: without them the CLI falls back to data bundled in this repository.

## When to use this

- `exports/scaffoldkit-input.json` shows `"blueprintValidatedLocally": false`
  and you want the blueprint checked against a local scaffoldkit checkout.
- You want the recommended playbook lists taken from a local
  agent-engineering-playbook adoption model instead of the bundled copy.
- You want a run that ignores any sibling checkouts, for reproducible output.

## What the CLI reads

- **Playbook adoption model.** `loadPlaybookContext` reads
  `AGENT_ENGINEERING_PLAYBOOK_ROOT`, defaulting to
  `../agent-engineering-playbook` next to this checkout. If
  `<root>/models/adoption-model.json` exists it is used; otherwise the bundled
  `models/playbook-adoption-model.json` is
  (`scripts/bootstrap-plan.js:1085-1101#"model: readJson(bundledModelPath, bundledModelPath)"`).
  The model only feeds the per-phase playbook lists in `recommendedPlaybooks`.
  Every emitted entry is a URL: the in-repo planning playbook first, then each
  model path appended to `ENGINEERING_PLAYBOOK_BASE`
  (`scripts/bootstrap-plan.js:1323-1342#"return Array.from(new Set(mandatory))"`,
  `scripts/bootstrap-plan.js:1134-1143#"ENGINEERING_PLAYBOOK_BASE}/"`).
- **Scaffoldkit blueprints.** `loadScaffoldkitContext` reads
  `SCAFFOLDKIT_ROOT`, defaulting to `../scaffoldkit` next to this checkout. If
  `<root>/src/scaffoldkit/blueprints/` exists, its subdirectory names become
  the available blueprints; otherwise the list is empty
  (`scripts/bootstrap-plan.js:1105-1109#"const blueprintsDir"`,
  `scripts/bootstrap-plan.js:1111-1114#"availableBlueprints: []"`,
  `scripts/bootstrap-plan.js:1118-1121#".sort()"`).
  With a root found, the recommended blueprint is the first candidate that is
  available, falling back to the first candidate, and `validatedLocally` is
  whether the chosen one is available; without a root it is the first
  candidate and `validatedLocally` is false
  (`scripts/bootstrap-plan.js:1784-1795#"validatedLocally: scaffoldkitContext.root ? available.has(blueprint) : false"`).
  The result reaches `exports/scaffoldkit-input.json` as `blueprint` and
  `blueprintValidatedLocally`
  (`scripts/bootstrap-plan.js:3245-3256#"blueprintValidatedLocally: recommendation.validatedLocally"`).
  `.planforge/docs/architecture-overview.md` always renders its scaffold
  guidance with an empty context, so it does not reflect the local checkout
  (`scripts/bootstrap-plan.js:2664-2665#"availableBlueprints: []"`).
- A relative value in either variable resolves against the cwd; the defaults
  resolve against the checkout
  (`scripts/bootstrap-plan.js:1086-1088#"../agent-engineering-playbook"`,
  `scripts/bootstrap-plan.js:1106-1108#"../scaffoldkit"`). Neither root path
  is written into the generated files; only the model contents and the
  blueprint names affect the output.

## Preconditions

- Dependencies installed in the repository root (`npm ci`), since the CLI
  loads `ajv`.
- For the scaffoldkit lookup: a scaffoldkit checkout that has
  `src/scaffoldkit/blueprints/<name>/` directories.
- For the playbook lookup: an agent-engineering-playbook checkout with
  `models/adoption-model.json`.

## Steps

1. Point the CLI at the checkouts and run it:

   ```bash
   SCAFFOLDKIT_ROOT=/path/to/scaffoldkit \
   AGENT_ENGINEERING_PLAYBOOK_ROOT=/path/to/agent-engineering-playbook \
   node scripts/bootstrap-plan.js --input examples/sample-input.json --outdir out/local --no-install
   ```

2. For a run that must ignore sibling checkouts, point both variables at a
   directory that does not exist. `scripts/refresh-example-outputs.js` does
   this for every target except `ci-platform`, which passes the caller's
   environment through
   (`scripts/refresh-example-outputs.js:22-25#"SCAFFOLDKIT_ROOT: path.join(repoRoot"`,
   `scripts/refresh-example-outputs.js:57-60#"env: process.env"`).

## Verification

- `jq '{blueprint, blueprintCandidates, blueprintValidatedLocally}' out/local/exports/scaffoldkit-input.json`
  shows `blueprintValidatedLocally: true` when the chosen blueprint has a
  directory in the scaffoldkit checkout, and `false` for the fallback run.
- `jq '.recommendedPlaybooks' out/local/planning/plan-output.json` lists the
  playbook URLs; the per-phase entries follow the adoption model that was
  loaded.
