# agent-planforge

Planning bootstrap for AI agents that need to turn rough requirements into a first architecture, initial ADR candidates, and an implementation backlog.

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
- `out/sample/prompts/`
- `out/sample/adrs/ADR-001-initial-architecture.md`
- `out/sample/tasks/`
- `out/sample/governance/` for enterprise-path starter docs when relevant
- `out/sample/runbooks/` for production-oriented starter runbooks when relevant

## Repository Structure

- `playbooks/planning-and-scoping.md`
- `models/planning-input.schema.json`
- `models/planning-output.schema.json`
- `models/planner-config.schema.json`
- `config/planner-config.json`
- `scripts/bootstrap-plan.js`
- `examples/sample-input.json`
- `templates/`

## Design Principles

- small, reviewable outputs beat ambitious but opaque planning
- default to the smallest architecture that satisfies current risk
- expose open questions and risks instead of pretending certainty
- keep generated artifacts editable by humans and agents
- ask for missing information explicitly when confidence would otherwise be fake

## Next Steps

Likely next additions:

- richer validation against the JSON schemas
- prompt packs for agent-specific planning modes
- optional enterprise artifact generation
