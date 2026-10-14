# Log

<!-- Add new entries at the top, newest first. -->

- 2026-10-14T04:53:58Z, re-verified all five docs after review fixes: `--validate-only` with
  `--clarify` and unanswered questions now prints a one-line note before
  validating (cli-run-overview), and line citations moved with the added
  lines. No other claim changed. `okf-kit check --require-anchors docs/okf`
  at okf-kit@0.18.0: 0 errors, 0 warnings, 0 notices.

- 2026-10-14T04:39:46Z, re-verified all five docs after the code changes for task 2b40db1d.
  external-lookups: the default playbook root is now
  `../agent-dx/packages/agent-engineering-playbook` and the playbook base URL
  is the agent-dx tree (every path in the bundled adoption model was checked
  against that tree). cli-run-overview and output-layout: `--validate-only`
  skips the clarification writes and does not stop for unanswered questions.
  rerun-and-resume: a `--rerun-from` test now exists. http-generate-pipeline:
  the SIGKILL escalation is guarded by `exitCode`/`signalCode` and fires for a
  child that ignores SIGTERM; the boot warning names both the missing-path and
  non-executable outcomes. Line citations were re-pointed to the shifted code.
  `okf-kit check --require-anchors docs/okf` at okf-kit@0.18.0: 0 errors,
  0 warnings, 0 notices.

- 2026-10-11T17:08:34Z, re-verified http-generate-pipeline after code-comment edits in
  `server/src/routes.ts` and `server/src/generate.ts` (attachment tier
  handling, request body shape, tarball cap, missing scaffoldkit export).
  No line moved and every claim and citation still holds, so only the
  timestamp changed. `okf-kit check --json --require-anchors docs/okf` at
  okf-kit@0.16.0: 0 errors, 0 warnings, 0 notices.

- 2026-10-11T16:10:35Z, tightened claims and citations against the code.
  cli-run-overview: the exit-code lists now include the previous-run path
  errors (1 and 3) and the planner config structure checks (2).
  output-layout: the index schema rejects unknown top-level and `context`
  keys only; its path maps accept any alphanumeric key. rerun-and-resume:
  the preserved entries are not created by any output writer.
  http-generate-pipeline: cites the `input` presence check and the
  scaffoldkit timeout constant. `okf-kit check --json --require-anchors docs/okf`
  at okf-kit@0.16.0: 0 errors, 0 warnings, 0 notices.

- 2026-10-11T15:44:44Z, corrected three claims against the code.
  http-generate-pipeline: the scaffoldkit timeout sends SIGTERM only, because
  the scheduled SIGKILL is guarded by `!child.killed`, which Node sets once
  the SIGTERM is delivered; a child that ignores SIGTERM keeps the request
  open. output-layout and cli-run-overview: index validation and the
  `--validate-only` exit come after the clarify step, so a `--clarify` or
  `--auto-clarify` run has already written its two clarification files.
  `okf-kit check --json --require-anchors docs/okf` at okf-kit@0.16.0:
  0 errors, 0 warnings, 0 notices.

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
