# agent-planforge

Planning bootstrap for AI agents that need to turn rough requirements into a first architecture, initial ADR candidates, and an implementation backlog.

`agent-planforge` is open source under the MIT license. Contribution, security reporting, and community expectations are documented in this repository.

## What This Project Does

`agent-planforge` is a lightweight planning layer for the earliest engineering phase of a project.

Given rough input such as:

- product goal
- target users
- core features
- constraints
- data sensitivity
- integrations
- timeline
- planning profile

it produces a first planning package:

- intake completeness and targeted follow-up questions
- project charter
- architecture overview with scored options
- initial ADR candidate
- task backlog with dependencies
- delivery plan with execution waves
- prompt pack for downstream agents
- multi-agent handoff manifest for orchestrated follow-on work
- machine-readable planning output
- phase rationale and recommended artifacts
- explicit guidance areas beyond the local planning playbook

The point is not perfect planning. The point is a repeatable and reviewable starting point.

## Current Scope

This first version includes:

- a planning playbook
- an external planner ruleset in `config/planner-config.json`
- a config schema in `models/planner-config.schema.json`
- JSON schemas for planning input and output
- a Node CLI that bootstraps planning artifacts from a JSON input file
- gap detection for missing planning context
- reusable markdown templates for generated planning artifacts
- profile-aware planning modes for startup, product, enterprise, and platform work
- prompt exports for downstream agent execution
- handoff manifest generation for staged or parallel downstream agents
- schema validation for input, config, and generated output
- `.ai/` context export for downstream coding agents
- playbook-aware charter and prompt references

## Project Status

- Core planning flow: stable
- Schema validation: implemented (ajv)
- Test coverage: automated (CI with Node 18 + 20)
- .ai/ context generation: implemented
- Playbook integration: implemented
- Remaining enhancements tracked in `tasks/`

## Quick Start

Requirements:

- Node.js 18+

Run:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample
```

Optional override:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample-custom \
  --config examples/planner-config.override.json
```

This creates:

- `out/sample/plan-output.json`
- `out/sample/intake-questionnaire.md`
- `out/sample/project-charter.md`
- `out/sample/architecture-overview.md`
- `out/sample/delivery-plan.md`
- `out/sample/.ai/`
- `out/sample/prompts/`
- `out/sample/handoff-manifest.json`
- `out/sample/adrs/ADR-001-initial-architecture.md`
- `out/sample/tasks/`
- `out/sample/governance/` for enterprise-path starter docs when relevant
- `out/sample/runbooks/` for production-oriented starter runbooks when relevant

Validation-only mode:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --validate-only
```

Concise summary mode:

```bash
node scripts/bootstrap-plan.js \
  --input examples/sample-input.json \
  --outdir out/sample \
  --summary
```

## Repository Structure

- `.github/`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `SECURITY.md`
- `playbooks/planning-and-scoping.md`
- `models/planning-input.schema.json`
- `models/planning-output.schema.json`
- `models/planner-config.schema.json`
- `config/planner-config.json`
- `scripts/bootstrap-plan.js`
- `examples/sample-input.json`
- `templates/`
- `tasks/`

## Design Principles

- small, reviewable outputs beat ambitious but opaque planning
- default to the smallest architecture that satisfies current risk
- expose open questions and risks instead of pretending certainty
- keep generated artifacts editable by humans and agents
- ask for missing information explicitly when confidence would otherwise be fake

## Contributing

Contribution guidelines live in [CONTRIBUTING.md](CONTRIBUTING.md).

For now, the most useful contributions are:

- runner contract design
- rerun and resume semantics
- handoff policy refinement

## Security

Security reporting guidance lives in [SECURITY.md](SECURITY.md). Do not open a public issue for a suspected vulnerability affecting confidentiality, integrity, or access control.

## Code Of Conduct

Community expectations live in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT license. See [LICENSE](LICENSE).

## Next Steps

The remaining hardening work is tracked as task files in `tasks/`.

## Testing

Run the automated suite with:

```bash
npm test
```

The tests cover:

- golden-path planning for `sample`, `minimal`, and `platform` inputs
- schema validation failures for bad input and bad config
- phase and path inference
- dependency graph and handoff manifest structure
- playbook references and `.ai/` artifact generation
