# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.1] - 2026-06-09

Security patch closing the 2026-05-30 audit findings and a CVE sweep.

### Security

- **Release workflow hardened against GitHub Actions script injection** (PR #92, finding #47). The tag-controlled version is now bound to an `env: VERSION` and passed into `awk` via `-v ver="$VERSION"` instead of being interpolated as `${{ ... }}` directly into the `run` step, closing the injection vector in the changelog-extraction step.
- **hono bumped to `^4.12.23`** (4 MEDIUM CVEs: CVE-2026-47673 / 47674 / 47675 / 47676, PR #91). Direct dependency of the server.

## [0.5.0] - 2026-06-02

### Changed

- Bumped the bundled scaffoldkit pin to v0.4.0, which ships runnable starter code for every remaining blueprint and removes the app-less `reference-php-app` blueprint.
- The PHP/Symfony selector no longer offers `reference-php-app`; generic PHP/Symfony intake now selects the runnable `symfony-backend` as its baseline instead of an empty ops-shell ([#89](https://github.com/LanNguyenSi/agent-planforge/pull/89)).

### Removed

- Dropped all `reference-php-app` references from the blueprint selector, the `blueprintLanguage` map, the suggested-variables logic, the runtime-template suppression list, and the `php-symfony` stack-pattern files map ([#89](https://github.com/LanNguyenSi/agent-planforge/pull/89)).

## [0.4.0] - 2026-06-01

### Changed

- The bundled scaffoldkit is pinned to v0.3.0: real runnable starters for the
  `rest-api`, `cli-tool`, and `fastapi-backend` blueprints (the last unified on
  the `src/` layout), so generated repositories open with runnable source
  instead of an empty `src/`.

### Fixed

- Generated task file paths and manifests now follow the selected blueprint's
  language. The feature tasks, the integration/error-handling coverage task, and
  the "set up repository" foundation task emit Python (pytest, `pyproject.toml`),
  PHP, or TypeScript/Node paths to match the scaffold, instead of hardcoding
  `.test.js` and `package.json` into every plan.
- Blueprint selection word-boundaries the CLI detector and adds a dedicated
  REST/HTTP-API branch, so a REST/JSON intake selects `rest-api` instead of
  being misrouted to `cli-tool` by a stray "cli" substring.
- Recommended-playbook references are emitted as stable GitHub URLs instead of
  filesystem paths, fixing a container-absolute `/app/playbooks/...` leak and
  dangling `agent-engineering-playbook/...` references in the generated `.ai/`
  and `.planforge/docs` artifacts.
- Generated `AGENTS.md` and `PROJECT.md` no longer reference the removed
  runner/handoff artifacts.

### Removed

- Stopped emitting the write-only runner/handoff orchestration artifacts from
  generated output: `handoff/manifest.json`, `handoff/runner-contract.json`,
  `handoff/runner/<step>/*.json`, the `prompts/*.md` role packs, and
  `exports/devreview.json`. These had no downstream consumer. The generated
  `planforge-index.json` no longer carries a top-level `handoff` block or the
  `directories.handoff` / `directories.prompts` / `exports.devreview` entries.
  `--resume-from` still preserves user-authored `handoff/runner/` and notes
  state.

## [0.3.0] - 2026-06-01

### Added

- HTTP server boot-guard: the service refuses to start unless
  `SCAFFOLDKIT_PYTHON` resolves to a runnable interpreter, failing fast
  at startup instead of surfacing a broken scaffolding path mid-request.
  `/healthz` gains a `status` field so callers can distinguish a healthy
  boot from a degraded one.
- HTTP server: `scaffoldkit.skipped` on the `done` event gains a fifth
  value `"input_unreadable"` plus an optional `inputReadError?: string`
  field. Previously every failure reading `exports/scaffoldkit-input.json`
  (ENOENT, EACCES, malformed JSON) collapsed into `skipped: "no_input"`,
  hiding a broken CLI behind a normal-path no-op. ENOENT still maps to
  `"no_input"`; any other read or `JSON.parse` failure now reports
  `"input_unreadable"` with the underlying error message in
  `inputReadError`. The field is optional and additive: existing
  consumers ignoring it are unaffected.

### Changed

- Output layout: the four planning prose docs (`project-charter.md`,
  `architecture-overview.md`, `delivery-plan.md`,
  `intake-questionnaire.md`) now generate under `.planforge/docs/` instead
  of the project root, reducing root clutter. `planforge-index.json`
  `rootFiles` entries point at the new locations and the index gains a
  `directories.docs` entry, so index-honoring consumers follow the move
  with no change. The index schema and `version` are unchanged. `AGENTS.md`,
  `CLAUDE.md`, `PROJECT.md`, and `planforge-index.json` stay at the root.
  `analyze-artifacts` resolves the docs from the new location and still
  reads legacy root-level outputs. First step of a phased output-layout
  redesign; see `docs/output-layout-migration.md`.
- Output layout: the generated tooling templates (`Makefile`,
  `Dockerfile.dev`, `docker-compose.dev.yml`, `.dockerignore`,
  `.husky-pre-commit`, `lint-staged.config.js`, `BRANCH_INFO.md`) now
  generate under `.planforge/tooling/` instead of the project root. This
  declutters the root and stops planforge's generic copies from overwriting
  scaffoldkit's blueprint-specific root files. `planforge-index.json` gains a
  `directories.tooling` entry; the individual tooling files stay out of the
  index as before, and the index `version` is unchanged.
- `planforge-index.json` `directories` is now presence-accurate: the
  conditional `governance`, `runbooks`, and `specs` entries appear only when
  those directories are actually generated (enterprise path,
  production-oriented phases, and `--clarify` respectively), instead of being
  listed unconditionally.
- Scaffolding now passes `--no-ai-context` to scaffoldkit so a generated
  `.ai/` directory survives scaffolding instead of being overwritten by
  scaffoldkit's own context output.

### Security

- Bumped `fast-uri` and `hono` to patched releases (CVE sweep,
  2026-05-10).

## [0.2.0] - 2026-04-24

**Headline: The HTTP server gained a full scaffolding path and an
attachments contract. Consumers (project-forge) no longer need Python
or the scaffoldkit venv on their own host — planforge runs it
in-container and bundles the result into the response tarball.
Attachments (uploaded arc42 / RFC / charter documents) become a
planning input via a top-level `attachments[]` field on
`POST /api/generate`, with text-tier content prepended onto
`input.summary` so it flows into every CLI prompt template slot.**

### Added

#### HTTP server

- `scaffoldkit` subprocess now runs inside the service container
  (Dockerfile pulls in `/opt/sk-venv`). `done` events carry a new
  `scaffoldkit: { invoked, exitCode?, stderr?, skipped? }` field so
  callers can tell four cases apart: ran cleanly, ran and failed,
  opted out, or not installed. Scaffolded files ride along in the
  response tarball — raised from 10 MiB → 50 MiB cap.
- `POST /api/generate` accepts optional top-level
  `attachments?: Attachment[]` where each entry is
  `{ name, mimeType, tier: "text" | "diagram" | "structured", inlineText?, contentRef? }`.
  Shape-validated at the edge; malformed returns **400 bad_request**.
- **Text-tier ingest**: attachments with `tier: "text"` and non-empty
  `inlineText` are concatenated into an "Additional context from
  attachment: &lt;name&gt;" markdown block and prepended onto
  `input.summary` before the CLI runs. The augmented summary flows
  through the existing `{{summary}}` template slots in every prompt
  the CLI emits, so no CLI schema change was needed.
- Total-char cap across all text-tier `inlineText`: **50,000 chars**.
  Exceeding returns **400 attachments_too_large**. Fail-fast chosen
  over silent truncation to avoid dropping architecturally important
  sections from an arc42 doc.
- Diagram + structured tiers are shape-validated but remain no-ops at
  the prompt level until later slices.

#### Exports

- `buildAdditionalContextBlock`, `augmentInputWithContext`, and the
  `ATTACHMENTS_MAX_TOTAL_CHARS` constant are exported from
  `server/src/routes.ts` for direct unit testing.

### Changed

- Panel-triggered `deploy agent-planforge` now routes through
  project-forge's compose stack. `.relay.yml` switched to
  `command:`-mode with `compose_file: ../project-forge/docker-compose.yml`,
  which the agent-relay v0.1.1 filesystem-aware containment accepts.

### Side effect worth knowing

`input.summary` is also regex-scanned by the CLI's architecture
heuristics (e.g. database-store inference in `scripts/bootstrap-plan.js`).
Attachment content containing phrases like `filesystem is the source
of truth` or `no external database` will influence those decisions.
By design — real architectural text should shape the plan — but UI
clients surfacing the upload should make users aware their attached
documents materially influence plan generation.

### Notes

- v0.1.0 clients that send no `attachments` field continue to work
  byte-identically; the only change on the wire is the optional field.

## [0.1.0] - 2026-04-18

**Headline: First tagged release of agent-planforge — a planning bootstrap
that turns rough requirements into architecture, ADR candidates, a task
backlog, a delivery plan, and downstream-agent handoff artifacts. Now
shipping with both a CLI and an HTTP service so project-forge and other
toolchains can consume planforge as a network service or invoke it
locally.**

This is the line in the sand: from v0.1.0 onward, output structure,
schema versions, and the public CLI / HTTP surface follow SemVer.
Pre-v0.1.0 callers should re-pin and re-run their integration smoke
tests against the published artifacts.

### Added

#### Planning CLI

- `scripts/bootstrap-plan.js` — turn JSON, text, or markdown input
  into a full planning package: intake, charter, architecture
  overview, scored options, ADR candidates, task backlog with
  dependency graph, delivery plan with execution waves, prompt pack,
  multi-agent handoff manifest, runner contract, rerun/resume
  metadata, and `.ai/` context export.
- `--clarify` / `--auto-clarify` for an upfront clarification pass
  before planning.
- `--rerun-from` and `--resume-from` for change-tracked re-planning
  and runner-state preservation.
- `--validate-only` and `--summary` modes.
- Profile-aware planning for **startup**, **product**, **enterprise**,
  and **platform** work, including governance + runbook starters
  when relevant.
- `scripts/analyze-artifacts.js` — post-generation consistency
  analysis with surfaced contradictions and weak matches.
- `scripts/refresh-example-outputs.js` to regenerate the in-repo
  example outputs.

#### HTTP service

- `server/` — Hono-based HTTP service that wraps the CLI for
  network-service use (project-forge calls this directly). Targets
  Node ≥20, ships its own `package.json` and TypeScript build.
- `POST` planning generation flow with token auth
  (`PLANFORGE_SERVICE_TOKEN`) and a streamed `done` event that
  includes the output tarball.
- Container image with the scaffoldkit Python venv baked in so a
  single `docker run` covers planning + scaffolding hand-off.
- `/healthz` and matching CI smoke that boots the image and verifies
  the endpoint comes up green.

#### Scaffoldkit + downstream integration

- `exports/scaffoldkit-input.json` produced from every planning run,
  wired directly to scaffoldkit blueprint selection.
- Stack patterns covering Express, Vite, Remix, NestJS, GitHub API,
  pipeline, alert, and realtime domains.
- PHP / Symfony blueprint mapping with sharper differentiation.
- Weak-match surfacing: when no strong scaffold candidate exists the
  planning artifacts call it out instead of silently picking the
  best of a weak set.
- `.relay.yml` so the ops dashboard can probe planforge.
- Generated root `AGENTS.md` and `CLAUDE.md` pointing downstream
  coding agents into `.ai/` and the grouped planning outputs.
- `PROJECT.md` planning index for human + agent navigation.

#### Schemas, validation, governance

- Schemas for planning input, planner config, and planning output
  under `models/`.
- Field-specific schema validation error messages.
- Partial config-override merge semantics (top-level scalars
  replace, arrays union, profile + governance maps merge by key).
- `tasks/` directory model for tracking follow-on work.
- `playbooks/planning-and-scoping.md` and adoption-model playbook 12
  with extended stack patterns.

#### Repo + release engineering

- `CHANGELOG.md`, this file.
- `.github/workflows/ci.yml`: CLI matrix on Node 18 + 20, server
  pipeline on Node 20, and an end-to-end Docker build + healthz
  smoke. Now reusable via `workflow_call` for the release workflow.
- `.github/workflows/release.yml`: tag-driven (`v*`) GitHub Release
  flow that calls CI as a reusable workflow and publishes the
  matching CHANGELOG section as the release body.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, MIT
  license.

### Changed

- Generated outputs reorganized into a grouped layout
  (`planning/`, `handoff/`, `exports/`, `prompts/`, `adrs/`,
  `tasks/`, `governance/`, `runbooks/`); a migration guide lives
  at `docs/output-layout-migration.md`.
- `bootstrap-plan` separates `planforgeRoot` from `workingDir`, so
  invoking the CLI from outside the repo no longer breaks relative
  template lookups.
- Stronger CLI sync planning semantics: negative keywords, minimum
  match counts, and constraint guards.
- Task filenames are no longer truncated at 40 characters.
- `slugify()` output limited to 40 characters where it feeds path
  segments.
- `teamSize` schema accepts either a string enum or an integer.
- `matchPattern` uses best-match instead of first-match.
- `writeBranchInfo` uses direct placeholders instead of template
  indirection.
- Pattern matching prioritizes the primary keyword when it appears
  at the start of a feature description.
- Alert-system keywords sharpened to avoid pipeline-domain overlap.
- If a generated `package.json` exists in the output directory,
  `bootstrap-plan` now exits non-zero on `npm install` failure
  instead of swallowing it; opt out with `--no-install`.

### Migration notes

- **Output layout**: scripts that read the old flat-root layout
  must move to the grouped paths under `planning/`, `handoff/`,
  `exports/`, etc. See `docs/output-layout-migration.md`.
- **Schema-version pinning**: pin to the v0.1.0 schemas under
  `models/` before upgrading; future minor releases will only add
  fields, never remove or rename in a breaking way.
- **HTTP service**: requires `PLANFORGE_SERVICE_TOKEN` to be set;
  there is no anonymous endpoint.
