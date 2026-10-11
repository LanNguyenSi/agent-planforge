# Log

<!-- Add new entries at the top, newest first. -->

- 2026-10-11T12:43:21Z, bundle introduced with `okf-kit init docs/okf` and five docs
  written from the overview, module, invariant and runbook templates:
  cli-run-overview, output-layout, rerun-and-resume, http-generate-pipeline
  and external-lookups; the unused templates were removed. Every claim was
  verified against `scripts/bootstrap-plan.js`, `scripts/refresh-example-outputs.js`,
  `models/planforge-index.schema.json`, `models/playbook-adoption-model.json`,
  `tests/bootstrap-plan.test.js` and `server/src/*.ts` at the time of writing,
  and every code citation carries an anchor. Added
  `.github/workflows/okf-staleness.yml` from the okf-kit workflow template,
  pinned to okf-kit@0.16.0 and warn-only. `okf-kit check --json --require-anchors docs/okf`
  at okf-kit@0.16.0: 0 errors, 0 warnings, 0 notices.
