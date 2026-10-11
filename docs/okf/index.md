# Knowledge bundle index

Curated OKF knowledge bundle for the agent-planforge repo. These docs capture
cross-file semantics that no single source file or reader-facing doc states on
its own: which generated files depend on which conditions, how an earlier run
is carried forward, what the HTTP service does around a CLI run, and which
sibling checkouts the CLI reads. For usage and configuration, see `README.md`,
the docs in `docs/` one level up, and `server/README.md`; this bundle does not
duplicate them.

Every doc lists the source files it rests on in its `sources:` frontmatter and
cites code as `path:N-M#"anchor"`. When a change touches one of those sources,
re-verify the doc against the new code, move any citation whose content moved,
update the doc's `timestamp`, and add an entry to [log.md](log.md).
`okf-kit check --require-anchors docs/okf` reports stale docs and citations
that no longer resolve.

## Overview

- [CLI run overview](cli-run-overview.md), the step order of one
  `scripts/bootstrap-plan.js` run, the two root directories (checkout and
  cwd), and the exit codes.

## Modules

- [Rerun and resume](rerun-and-resume.md), how `--resume-from` and
  `--rerun-from` find an earlier run, what `planning/rerun-report.json`
  compares, and why both flags copy the same user-authored entries.
- [HTTP generate pipeline](http-generate-pipeline.md), the `server/` package:
  bearer auth, attachment folding, the CLI and scaffoldkit subprocesses, the
  SSE events, the tarball and the cleanup.

## Invariants

- [Output layout and conditional groups](output-layout.md), `LAYOUT_REGISTRY`
  as the single list of generated paths, the shared predicates that keep the
  `specs`, `runbooks` and `governance` index entries in step with the writers,
  and what sits outside that contract (`prompts/`, the runtime templates, a
  reused outdir).

## Runbooks

- [External lookups](external-lookups.md), pointing a CLI run at local
  scaffoldkit and agent-engineering-playbook checkouts, or forcing the bundled
  fallback, and checking the result.
