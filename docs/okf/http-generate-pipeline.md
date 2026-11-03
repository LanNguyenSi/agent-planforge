---
type: module
title: HTTP generate pipeline
description: What the server/ package does around one CLI run per POST /api/generate request (bearer auth, body and attachment checks, temp dir, CLI subprocess, optional scaffoldkit subprocess, tarball, SSE events, cleanup), and how the boot-time scaffoldkit probe relates to the per-request skip reasons.
tags: [module, server, http, sse, scaffoldkit]
timestamp: 2026-10-15T04:28:45Z
sources:
  - server/src/index.ts
  - server/src/config.ts
  - server/src/boot-guard.ts
  - server/src/routes.ts
  - server/src/generate.ts
  - scripts/bootstrap-plan.js
---

# HTTP generate pipeline

## Responsibility

- The `server/` package is a transport around the planning CLI: it
  authenticates a caller, turns one request into one CLI run in a private temp
  directory, optionally runs scaffoldkit on the result, and streams the outcome
  back as server-sent events. It does no planning of its own; every planning
  decision is the CLI's (see [CLI run overview](cli-run-overview.md)).

## Entry points

- `server/src/index.ts` runs the boot-time scaffoldkit probe, then starts the
  Hono app with `serve()` on `env.PORT`
  (`server/src/index.ts:6-8#"const server = serve({ fetch: app.fetch, port: env.PORT }"`).
- `GET /healthz` needs no token and reports `status: "ok"` plus the cached
  scaffoldkit probe result
  (`server/src/routes.ts:186-196#"scaffoldkitPython: getScaffoldkitStatus()"`).
- Every route under `/api` requires `Authorization: Bearer <token>`: no Bearer
  header gives 401 `unauthorized`
  (`server/src/routes.ts:206-209#"unauthorized"`), a token that does not match
  `PLANFORGE_SERVICE_TOKEN` gives 403 `forbidden`
  (`server/src/routes.ts:211-217#"forbidden"`). The comparison is
  constant-time
  (`server/src/routes.ts:170-180#"return timingSafeEqual(a, b)"`).
- `POST /api/generate` is the only API route.

## Configuration

`server/src/config.ts` parses the environment once with zod: `PORT`
(default 8223), `PLANFORGE_SERVICE_TOKEN` (required), `PLANFORGE_ROOT`
(default: two directories up from the module's own directory, which is the
repository root),
`NODE_BIN` (default: the running Node binary) and `SCAFFOLDKIT_PYTHON`
(default `/opt/sk-venv/bin/python3`)
(`server/src/config.ts:11-22#"SCAFFOLDKIT_PYTHON: z.string().default"`). An
invalid environment prints the issues and exits with code 1
(`server/src/config.ts:25-32#"process.exit(1)"`).

## Request handling

1. The body must parse as JSON and contain `input`; otherwise the route
   answers 400 `bad_request`
   (`server/src/routes.ts:241-245#"Body must be JSON"`,
   `server/src/routes.ts:247-251#"Body must be { input: <planning-input>"`).
2. `scaffold` defaults to true; only an explicit `false` turns it off
   (`server/src/routes.ts:263#".scaffold !== false"`).
3. `attachments` is optional. Each entry needs `name`, `mimeType` and a `tier`
   of `text`, `diagram` or `structured`. For `text` entries with
   `inlineText`, the texts are joined into "Additional context" blocks under a
   combined cap of `ATTACHMENTS_MAX_TOTAL_CHARS`
   (`server/src/routes.ts:38#"ATTACHMENTS_MAX_TOTAL_CHARS = 50_000"`)
   (`server/src/routes.ts:113-126#"Additional context from attachment"`).
   Over the cap the route answers 400 `attachments_too_large`; under it the
   block is prepended to `input.summary`, and the `attachments` field itself
   never reaches the CLI
   (`server/src/routes.ts:272-280#"augmentInputWithContext(input"`). When
   `input` is not an object, the service replaces it with
   `{ summary: <block> }` and lets the CLI's schema check report the problem
   (`server/src/routes.ts:148-161#"summary: combined"`). `diagram` and
   `structured` entries are validated and otherwise ignored.
4. A client disconnect aborts a controller that `runGenerate` listens to
   (`server/src/routes.ts:288-289#"controller.abort()"`).
5. Every event from `runGenerate` is written as one SSE frame named after the
   event type
   (`server/src/routes.ts:302-304#"data: JSON.stringify(ev)"`). An exception
   thrown out of the generator becomes a final `error` frame that carries the
   last seen `requestId`
   (`server/src/routes.ts:307-315#"message: (err as Error).message"`).

## The per-request pipeline (`runGenerate`)

The diagram shows the main path of one request through `routes.ts` and
`generate.ts`; the error branches after a successful CLI exit are listed in
the steps below it.

```mermaid
flowchart TD
  A["POST /api/generate<br/>routes.ts"] --> B{"auth, body and<br/>attachments valid?"}
  B -->|no| R["401 / 403 / 400 JSON"]
  B -->|yes| C["runGenerate<br/>generate.ts"]
  C --> D["mkdtemp temp dir<br/>write input.json"]
  D --> E["node bootstrap-plan.js<br/>--no-install"]
  E -->|"stdout and stderr lines"| P["SSE progress"]
  E --> F{"exit code 0?"}
  F -->|no| X["SSE error"]
  F -->|yes| G["read plan-output.json<br/>and scaffoldkit-input.json"]
  G --> H{"scaffold on and<br/>export read?"}
  H -->|yes| S["python -m scaffoldkit.cli<br/>from-planforge"]
  H -->|no| T["tar -czf the outdir"]
  S --> T
  T --> DN["SSE done<br/>outputTarGz"]
  DN --> CL["rm temp dir (finally)"]
  X --> CL
```

1. **Temp dir.** A temp directory named after a fresh request id is created
   (`server/src/generate.ts:479-484#"mkdtemp(resolve(tmpdir()"`), and the
   request's `input` is written to `input.json` with `JSON.stringify` and file
   mode 0600 (`server/src/generate.ts:499#"mode: 0o600"`).
2. **CLI run.** The CLI is spawned with `--input`, `--outdir` and
   `--no-install` only, in the temp dir
   (`server/src/generate.ts:501-505#"cwd: tmp"`). No `--format` is passed,
   so the CLI's `json` default applies
   (`scripts/bootstrap-plan.js:31#"format:"`), and no previous-run
   flag is passed, so every service run is a fresh run. The abort signal kills
   the child's process group with SIGTERM and, unless the run closed within the
   grace, again with SIGKILL
   (`server/src/generate.ts:522-524#"addEventListener"`). The CLI also
   has a wall-clock bound of five minutes
   (`server/src/generate.ts:187#"CLI_TIMEOUT_MS = 5 * 60_000"`): on expiry it
   gets the same SIGTERM-then-SIGKILL escalation and the run ends with an
   `error` event "planforge CLI timed out after <ms>ms"
   (`server/src/generate.ts:608-612#"planforge CLI timed out after"`).
3. **Progress.** stdout and stderr are split into lines, and each line becomes
   a `progress` event tagged with its stream
   (`server/src/generate.ts:549-553#"requestId, stream: tag, line"`).
4. **Exit.** A spawn failure emits one `error` event and ends the run
   (`server/src/generate.ts:586-588#"message: err.message"`). A non-zero exit
   emits `error` with the exit code
   (`server/src/generate.ts:618-622#"planforge CLI exited with code"`).
5. **Read results.** After exit 0, an unreadable `planning/plan-output.json`
   ends the run with `error`
   (`server/src/generate.ts:630-638#"Failed to read plan-output.json"`). A
   missing `exports/scaffoldkit-input.json` sets the export to `null`; any
   other read or parse failure is kept as `inputReadError`
   (`server/src/generate.ts:650-655#"scaffoldkitInputReadError = (err as Error).message"`).
   The CLI writes that export on every run that reaches its write step
   (`scripts/bootstrap-plan.js:3347-3349#"renderScaffoldKitInput(input, output, scaffoldkitContext)"`),
   so with the current CLI a missing export after exit 0 is not expected.
6. **Scaffold decision.** `scaffold: false` gives `skipped: "opt_out"`, a
   read failure gives `input_unreadable`, a missing export gives `no_input`
   (`server/src/generate.ts:663-672#"no_input"`). Otherwise `runScaffoldkit`
   runs; an `ENOENT` spawn error gives `skipped: "not_installed"`, and any
   other spawn error ends the run with `error`
   (`server/src/generate.ts:682-693#"Failed to spawn scaffoldkit"`).
7. **Scaffoldkit subprocess.** The arguments are
    `-m scaffoldkit.cli from-planforge <export> --target <outdir> --overwrite --no-install --no-ai-context`
    (`server/src/generate.ts:374-385#"--no-ai-context"`). A non-zero exit is
    returned as data, not thrown
    (`server/src/generate.ts:451#"exitCode: code ?? -1"`), so a failed scaffold
    still produces a `done` event. Captured stderr is capped at 4096 bytes
    (`server/src/generate.ts:335#"SCAFFOLDKIT_STDERR_MAX_BYTES = 4096"`).
    After five minutes
    (`server/src/generate.ts:177#"SCAFFOLDKIT_TIMEOUT_MS = 5 * 60_000"`) the
    watchdog calls the shared escalation helper
    (`server/src/generate.ts:423-425#"terminateChild(child, graceMs);"`). The
    helper sends SIGTERM and schedules a SIGKILL after the grace of five
    seconds (`server/src/generate.ts:196#"KILL_GRACE_MS = 5_000"`), guarded by
    the child's `close` event not having fired yet
    (`server/src/generate.ts:268-270#"if (!closedChildren.has(child)) signalChildTree"`),
    not by `child.killed` and not by `exitCode`/`signalCode`: Node sets
    `killed` as soon as a signal is delivered, and `exitCode`/`signalCode` only
    describe the DIRECT child, so either guard lets the run hang when the direct
    child dies on SIGTERM while a grandchild in the same process group traps it
    and still holds the output pipes. `close` says the direct child exited and every
    holder of those pipes let go (`server/src/generate.ts:234-244#"const closedChildren"`;
    a group member holding no pipe is not chased after `close`, on purpose, so no
    signal goes to a pgid that may have been reused), and a SIGKILL
    into a group that emptied in the meantime is harmless anyway: the group kill
    throws `ESRCH` and the fallback signals the already-dead direct child. Either
    signal goes to the child's
    process group (`server/src/generate.ts:214-217#"function killProcessGroup"`),
    and only to the direct child if that throws
    (`server/src/generate.ts:229-231#"child.kill(signal)"`); both subprocesses are
    spawned `detached` so they lead the group that gets the signal, which is what
    takes down a grandchild that inherited the output pipes and would otherwise
    hold the run past its bound. Either way the request ends with
    `exitCode: -1` and a timeout message
    (`server/src/generate.ts:443-447#"scaffoldkit timed out after"`). A client
    disconnect uses the same helper
    (`server/src/generate.ts:431-434#"args.abortSignal?.addEventListener"`), so a
    run whose group still holds the pipes is force-killed after the grace even
    when the direct child already exited by then.
8. **Tarball.** The outdir contents are packed with the system `tar`
    (`server/src/generate.ts:464-469#"maxBuffer: TARBALL_MAX_BYTES"`), with a
    cap of 50 MiB (`server/src/generate.ts:167#"TARBALL_MAX_BYTES = 50 * 1024 * 1024"`).
    An oversized or failed tar ends the run with `error`; otherwise the tarball
    is base64-encoded
    (`server/src/generate.ts:707-718#"buf.toString"`).
9. **Done.** The `done` event carries `planOutput`, `scaffoldkitInput`, the
    `scaffoldkit` result object, `outputTarGz` and `exitCode: 0`
    (`server/src/generate.ts:729-736#"exitCode: 0"`).
10. **Cleanup.** A `finally` block removes the abort listener and deletes the
     temp dir on every path, success or failure
     (`server/src/generate.ts:738-740#"rm(tmp, { recursive: true, force: true })"`).
     Every spawned child is tracked from spawn until it is gone
     (`server/src/generate.ts:305-319#"function trackChild(child: ChildProcess)"`),
     and the groups still live when the service process exits are SIGKILLed from
     an `exit` hook, so a `detached` child cannot outlive the service. That hook
     covers a NORMAL exit of the service process only: a SIGKILL, an OOM kill or
     a death from an unhandled signal runs no `exit` listener, and a `detached`
     child does outlive those.

## Boot probe versus per-request skip reasons

- `boot-guard.ts` checks once whether `SCAFFOLDKIT_PYTHON` is executable
  (`fs.constants.X_OK`) and caches the answer for the process lifetime
  (`server/src/boot-guard.ts:9-14#"missing"`,
  `server/src/boot-guard.ts:23-25#"return cachedStatus"`). At boot a
  `missing` result prints a warning, shortened to one line when
  `PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT=1`
  (`server/src/boot-guard.ts:47#"const allowMissing"`). The probe never
  changes `/healthz`'s `status` and never gates a request. The loud warning
  names both per-request outcomes described next, since the probe cannot tell
  a missing path from a non-executable one.
- Per request, only `ENOENT` from spawning the Python binary maps to
  `skipped: "not_installed"`. A path that exists but is not executable fails
  the spawn with `EACCES`, which ends the request with an `error` event
  ("Failed to spawn scaffoldkit") instead.
