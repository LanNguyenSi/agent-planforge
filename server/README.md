# agent-planforge HTTP service

Thin Hono + TypeScript HTTP surface around `scripts/bootstrap-plan.js`. Lets
project-forge (and agents) drive the planner over the network instead of
shelling out to the CLI on the same machine.

Designed in [project-forge ADR-0002](https://github.com/LanNguyenSi/project-forge/blob/main/docs/adrs/0002-tool-decoupling-service-boundary.md);
this package is follow-up ticket #1 from that ADR.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET  /healthz` | none | Liveness + version info. Traefik / ops dashboard target. |
| `POST /api/generate` | `Bearer ${PLANFORGE_SERVICE_TOKEN}` | Run the planner. Streams progress as SSE. |

### `POST /api/generate`

Request:

```json
{
  "input": { /* planning input — same schema the CLI's --input accepts */ },
  "scaffold": true
}
```

- `scaffold` — optional, default `true`. When `true`, the service invokes
  scaffoldkit against the planforge-produced `scaffoldkit-input.json` and
  the resulting project tree lands in the response tarball alongside the
  planning artifacts. Set to `false` for planning-only runs (preview UIs,
  callers that scaffold separately, tests).

Response: `Content-Type: text/event-stream`. Events:

- `progress` — `{ requestId, stream: "stdout" | "stderr", line }` — one per
  CLI log line
- `done` — `{ requestId, planOutput, scaffoldkitInput: <object> | null, scaffoldkit: { invoked, exitCode?, stderr?, skipped? }, outputTarGz: <base64 gzip tarball>, exitCode: 0 }`. The tarball packs the **contents** of the CLI's output dir (not a nested `out/` folder); untar with `tar -xzf - -C <targetDir>`. Hard cap: 50 MiB (gzipped) — raised from 10 MiB when scaffolding landed because a scaffolded project tree can be several MB. Large enough for typical runs and keeps a pathological prompt from streaming an unbounded blob into the client's memory.
- `error` — `{ requestId, message, exitCode? }`

The `scaffoldkit` field on `done` always exists. Its `skipped` value
tells callers why scaffolding was not performed:

| `skipped` | Meaning |
| --- | --- |
| `opt_out` | Caller passed `scaffold: false` |
| `no_input` | CLI did not write `scaffoldkit-input.json` (not every input produces one) |
| `not_installed` | `SCAFFOLDKIT_PYTHON` is missing — dev env without the venv; production containers always have it |

A nonzero `scaffoldkit.exitCode` does **not** fail the request — planning
artifacts are still returned, and the caller decides whether the failed
scaffold is fatal to its flow.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `8223` | TCP port |
| `PLANFORGE_SERVICE_TOKEN` | *(required)* | Bearer token clients present |
| `PLANFORGE_ROOT` | parent of this package | Repo root that contains `scripts/bootstrap-plan.js` |
| `NODE_BIN` | `process.execPath` | Node binary used to spawn the CLI |
| `SCAFFOLDKIT_PYTHON` | `/opt/sk-venv/bin/python3` | Python binary that runs `scaffoldkit.cli from-planforge`. The Dockerfile lays down the pinned venv; local dev points this at any Python that has scaffoldkit installed, or skips scaffolding via `scaffold: false` in the request body. |

## Running

Dev (reloads on edit):

```bash
PLANFORGE_SERVICE_TOKEN=dev-token npm run dev
```

Production build:

```bash
npm run build
PLANFORGE_SERVICE_TOKEN=<token> npm start
```

Container (see `Dockerfile`):

```bash
docker build -f server/Dockerfile -t agent-planforge .
docker run -p 8223:8223 -e PLANFORGE_SERVICE_TOKEN=<token> agent-planforge
```

## Tests

```bash
npm test
```

Integration tests spin the Hono app via `app.fetch()` (no port binding) and
exercise the real CLI against `examples/sample-input.json`. Typical runtime
is a few hundred milliseconds per test on a warm cache.

## What's next

This ticket ships the HTTP service layer only. The companion follow-ups:

1. **project-forge client swap** (ticket `8080321b-0919-4289-8bf7-26afe765e871`)
   — replace the two shell-outs in project-forge with one `POST /generate`.
2. **deploy-panel compose slot + token distribution** (ticket
   `8d9fe14f-5631-4a13-b669-cc6d5f846bf0`).
3. **Drop Python from project-forge** (agent-tasks `31e6f7db`) — blocked on
   this package running scaffoldkit in-container, which landed with the
   `scaffoldkit` field on `done` and the 50 MiB tarball cap. Unblocked.
