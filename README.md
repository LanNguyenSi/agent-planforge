# agent-planforge

Planning bootstrap for AI agents: turns rough project requirements into a first architecture, initial ADR candidates, and an implementation backlog.

[![CI](https://github.com/LanNguyenSi/agent-planforge/actions/workflows/ci.yml/badge.svg)](https://github.com/LanNguyenSi/agent-planforge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Rough planning input (JSON, markdown, or plain text) enters through a CLI or an HTTP service, both driving the same planning core: an external planner ruleset, JSON schema validation, and profile-aware planning modes for startup, product, enterprise, and platform work. The output is a structured planning package (project charter, architecture overview with scored options, an initial ADR candidate, a task backlog, and a delivery plan) plus a `.ai/` context export for downstream coding agents and a `scaffoldkit`-compatible export. [project-forge](https://github.com/LanNguyenSi/project-forge) uses `agent-planforge` as its planning backbone, calling the HTTP API and surfacing the results in an interactive preview before any code is generated. The goal is not perfect planning, but a repeatable and reviewable starting point.

## Key Features

- external planner ruleset (`config/planner-config.json`) with override merge semantics
- JSON schema validation for planning input, config, and generated output
- profile-aware planning modes: startup, product, enterprise, platform
- gap detection and an interactive clarification pass for underspecified input
- rerun and resume support with diff reporting
- `.ai/` context export plus a `scaffoldkit`-compatible export
- a thin HTTP service alongside the CLI (see [Usage](#usage))
- consistency analysis across generated artifacts (`scripts/analyze-artifacts.js`)

## Quick Start

Requirements: Node.js 18+

```bash
npm install
node scripts/bootstrap-plan.js --input examples/sample-input.json --outdir out/sample
```

This writes a planning package under `out/sample/` (`AGENTS.md`, `.planforge/docs/`, `planning/plan-output.json`, `adrs/`, `tasks/`, `exports/scaffoldkit-input.json`, and more). See [docs/operational-workflow.md](docs/operational-workflow.md) for the full output list and the rest of the CLI workflow.

## Usage

The HTTP service wraps the same planner core over the network, so project-forge or other agents can drive it without shelling out to the CLI:

```bash
curl -X POST http://localhost:8223/api/generate \
  -H "Authorization: Bearer $PLANFORGE_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "projectName": "Ops Console",
      "summary": "Internal ops tool.",
      "targetUsers": ["operations team"],
      "coreFeatures": ["dashboard"],
      "constraints": []
    }
  }'
```

Run the service locally with `cd server && npm install && PLANFORGE_SERVICE_TOKEN=dev-token npm run dev` (requires Node.js 20+), or as a container (`docker build -f server/Dockerfile -t agent-planforge .`). Full endpoint, environment, and deployment reference: [server/README.md](server/README.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): how planning works end to end, design principles, current scope, and repository layout
- [docs/operational-workflow.md](docs/operational-workflow.md): the full CLI workflow: input formats, clarification, rerun/resume, consistency analysis, remaining flags
- [docs/configuration.md](docs/configuration.md): planner config override merge semantics
- [docs/output-layout-migration.md](docs/output-layout-migration.md): migrating from the older flat output layout
- [docs/scaffoldkit-planforge-workflow.md](docs/scaffoldkit-planforge-workflow.md): division of responsibility with scaffoldkit
- [server/README.md](server/README.md): HTTP service endpoint, environment, and deployment reference

## Development And Contributing

Install root dependencies with `npm install`, then install the server's own dependencies with `npm install --prefix server` (the server is a separate package, Node.js 20+). Run the full test suite with `npm test` (CLI tests plus `server/` tests). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow and pull request expectations, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## License

This project is licensed under the MIT license. See [LICENSE](LICENSE).

Status: pre-1.0, maintained on a best-effort basis. Work is tracked as [GitHub Issues](https://github.com/LanNguyenSi/agent-planforge/issues). CLI, HTTP API, and output schema compatibility is not yet guaranteed across minor versions.
