# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
