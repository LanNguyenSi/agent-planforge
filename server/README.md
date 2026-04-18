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
{ "input": { /* planning input — same schema the CLI's --input accepts */ } }
```

Response: `Content-Type: text/event-stream`. Events:

- `progress` — `{ requestId, stream: "stdout" | "stderr", line }` — one per
  CLI log line
- `done` — `{ requestId, planOutput, scaffoldkitInput: <object> | null, outputTarGz: <base64 gzip tarball>, exitCode: 0 }`. The tarball packs the **contents** of the CLI's output dir (not a nested `out/` folder); untar with `tar -xzf - -C <targetDir>`. Hard cap: 10 MiB (gzipped). Large enough for typical runs (~100 KB) and keeps a pathological prompt from streaming an unbounded blob into the client's memory.
- `error` — `{ requestId, message, exitCode? }`

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `8223` | TCP port |
| `PLANFORGE_SERVICE_TOKEN` | *(required)* | Bearer token clients present |
| `PLANFORGE_ROOT` | parent of this package | Repo root that contains `scripts/bootstrap-plan.js` |
| `NODE_BIN` | `process.execPath` | Node binary used to spawn the CLI |

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

1. **Package the scaffoldkit Python venv into the image** (ticket
   `6f7d5e8b-1262-461b-aec8-98532d63c78a`) — needed before planforge can
   also run scaffold generation on behalf of its callers.
2. **project-forge client swap** (ticket `8080321b-0919-4289-8bf7-26afe765e871`)
   — replace the two shell-outs in project-forge with one `POST /generate`.
3. **deploy-panel compose slot + token distribution** (ticket
   `8d9fe14f-5631-4a13-b669-cc6d5f846bf0`).

Until #1 ships, `POST /generate` returns `plan-output` + `scaffoldkit-input.json`
only; callers still run scaffoldkit themselves.
