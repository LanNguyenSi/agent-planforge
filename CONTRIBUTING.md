# Contributing

## Scope

`agent-planforge` is an early-stage planning tool for agent-driven delivery. Contributions should improve planning quality, reviewability, or operational clarity without turning the project into a heavyweight framework.

## Before You Start

- Read [README.md](README.md) for project scope and current limitations.
- Open work is tracked as [GitHub Issues](https://github.com/LanNguyenSi/agent-planforge/issues); [tasks/](tasks/) holds the completed hardening backlog.
- Prefer small, reviewable pull requests over broad refactors.

## Development Workflow

Requirements:

- Node.js 18+

Useful command:

```bash
node scripts/bootstrap-plan.js --input examples/sample-input.json --outdir out/sample
```

Automated checks:

```bash
npm test
node scripts/bootstrap-plan.js --input examples/sample-input.json --outdir out/sample --validate-only
```

Before opening a pull request:

- run the planner against at least one example input
- run `npm test`
- check generated output for obvious regressions
- run `git diff --check`
- update documentation if behavior or outputs changed

## Change Expectations

- Preserve the current bias toward explicit, reviewable outputs.
- Do not hide uncertainty. Surface missing information and assumptions directly.
- Keep generated artifacts editable by humans.
- Prefer deterministic output over clever but opaque heuristics.

## Pull Requests

Include in your pull request:

- what changed
- why it changed
- how you verified it
- any compatibility or output-shape impact

If you change schemas, generated artifact structure, or planner heuristics, call that out explicitly.

## Large Changes

Open an issue or draft pull request first for:

- new planning modes
- major output schema changes
- orchestration model changes
- new governance or compliance surfaces

## Community Standards

By participating in this project, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
