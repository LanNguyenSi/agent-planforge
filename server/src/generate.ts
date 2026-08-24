/**
 * Wraps the planforge CLI (`scripts/bootstrap-plan.js`) in a subprocess-spawn
 * so the HTTP handler can stream progress over SSE without having to refactor
 * the ~4k-line CLI script. The CLI remains the canonical behaviour — the
 * HTTP service is a transport.
 *
 * Per-request flow:
 *   1. Create a fresh tempdir keyed by request-id (concurrent isolation)
 *   2. Write the incoming `input` JSON to `${tmp}/input.json`
 *   3. Spawn `node bootstrap-plan.js --input ${tmp}/input.json --outdir ${tmp}/out --no-install`
 *   4. Forward stdout/stderr lines to the caller as SSE `progress` events
 *   5. On clean exit: read `out/planning/plan-output.json` + `out/exports/scaffoldkit-input.json`
 *   6. If scaffolding is enabled (default) AND scaffoldkit-input.json exists,
 *      invoke `<SCAFFOLDKIT_PYTHON> -m scaffoldkit.cli from-planforge …`
 *      against the same outdir so the tarball carries scaffolded files
 *   7. Tar the outdir and emit a `done` event with plan output + scaffoldkit
 *      metadata (exit code, stderr, skipped-reason if not invoked)
 *   8. Always clean up the tempdir — success OR failure — so we never leak secrets in tmp
 *
 * Not handled in v1 (see ADR-0002 § "Risks"):
 *   - No resumption. A mid-run crash means the caller re-POSTs; no partial recovery.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GenerateOptions {
  planforgeRoot: string;
  nodeBin: string;
  /**
   * Python binary that runs `scaffoldkit.cli from-planforge` after the
   * planforge CLI writes `scaffoldkit-input.json`. The container sets
   * this to the pinned venv; tests override to a stub or skip.
   */
  scaffoldkitPython: string;
  /**
   * Default true. When false, scaffolding is skipped — the `done` event
   * still carries the planning tarball, just without scaffolded files.
   * Callers that only want planning artifacts (e.g. a preview UI that
   * scaffolds later, or tests) set this to false.
   */
  scaffold: boolean;
  /**
   * When aborted, the CLI subprocess is killed with SIGTERM and the
   * generator exits on its next `yield`. The `finally` block still runs,
   * so the tempdir is cleaned up.
   */
  abortSignal?: AbortSignal;
  /**
   * Override the gzipped-tarball byte cap on the `done` event. Defaults
   * to TARBALL_MAX_BYTES (50 MiB). The `tar` subprocess's `maxBuffer`
   * safety net stays at the module constant — an override larger than
   * TARBALL_MAX_BYTES is effectively no-op because the upstream tar call
   * rejects bytes past the hard limit with a different ("Failed to tar
   * output directory: …maxBuffer length exceeded") error. Intended for
   * the regression test that verifies the byte-length check fires with
   * the documented "Output tarball exceeds N bytes" message; production
   * callers should not pass this.
   */
  tarballMaxBytes?: number;
}

/**
 * Describes what happened with scaffoldkit for a given generate run.
 * Always present on the `done` event so callers can tell the cases
 * apart without second-guessing:
 *   - `invoked: true, exitCode: 0`       — scaffolding ran cleanly
 *   - `invoked: true, exitCode: nonzero` — ran but failed; planning OK
 *   - `invoked: false, skipped: "…"`     — not run; see `skipped` field
 */
export interface ScaffoldkitResult {
  invoked: boolean;
  exitCode?: number;
  stderr?: string;
  /**
   * Reason scaffoldkit was not invoked.
   * - `no_input`         — CLI didn't write scaffoldkit-input.json (ENOENT)
   * - `input_unreadable` — file exists but JSON.parse / IO failed (CLI bug)
   * - `opt_out`          — caller passed `scaffold: false`
   * - `not_installed`    — SCAFFOLDKIT_PYTHON binary is missing (dev / tests)
   */
  skipped?: "no_input" | "input_unreadable" | "opt_out" | "not_installed";
  /**
   * Populated only when `skipped === "input_unreadable"`. Carries the
   * underlying error message (e.g. `Unexpected token } in JSON at position 12`)
   * so the caller can distinguish a JSON-parse bug from a permission-denied
   * read. The full path is intentionally omitted — it lives in the server's
   * tempdir, not anything the caller can act on.
   */
  inputReadError?: string;
}

/**
 * Curated env for the CLI subprocess. Starting from `process.env` and
 * deny-listing the obvious secrets leaks anything we haven't thought of
 * yet; an allow-list is safer by construction. These are the only vars
 * the CLI actually reads (checked against `scripts/bootstrap-plan.js`):
 * PATH for resolving tools, HOME for npm defaults, NODE_ENV for library
 * defaults. Anything else is explicit opt-in.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "HOME", "NODE_ENV", "TMPDIR", "LANG", "LC_ALL"];
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    const v = process.env[key];
    if (v !== undefined) childEnv[key] = v;
  }
  return childEnv;
}

export interface GenerateEvent {
  type: "progress" | "done" | "error";
  /** opaque per-request id — callers can correlate multi-stage flows later */
  requestId: string;
  /** present on `progress` events — a single stdout/stderr line */
  line?: string;
  stream?: "stdout" | "stderr";
  /** present on `done` — final artifacts read from the tempdir */
  planOutput?: unknown;
  scaffoldkitInput?: unknown;
  /**
   * Base64-encoded gzipped tarball of the CLI's output tempdir. Present on
   * `done` so callers like project-forge can reconstruct the full file
   * tree (planforge-index.json, planning/, handoff/, exports/, tasks/,
   * architecture-overview.md, …) that the CLI wrote on disk. Encoding
   * choice: base64 inside the SSE `data:` frame keeps the payload as a
   * single atomic blob — no partial-tar delivery to handle on the client.
   * Typical size for the sample input is ~60-120 KB; the cap at 10 MiB
   * below keeps a pathological prompt from OOMing the service.
   */
  outputTarGz?: string;
  /** present on `done` — always populated so callers can branch on it */
  scaffoldkit?: ScaffoldkitResult;
  /** present on `error` */
  message?: string;
  /** subprocess exit code, present on `done` and `error` */
  exitCode?: number;
}

// Hard cap on the gzipped tarball that the `done` event carries. Raised
// from 10 MiB → 50 MiB when scaffolding landed: scaffoldkit emits a
// full project tree (source files, configs, lockfiles) that can easily
// be several MB gzipped for a mid-size blueprint. 50 MiB still refuses
// a pathological run that would OOM the client, while leaving ~10×
// headroom over typical scaffolded output (~2–5 MB).
//
// Alternative considered: keep the 10 MiB cap and error loudly when
// scaffolding blows through it. Rejected because a realistic blueprint
// exceeding 10 MiB is a normal operating mode, not an anomaly — we'd
// be shipping a broken-by-default endpoint. The ~5× size bump is
// acceptable because the only server-side caller today is project-forge's
// Next.js route handler (not a browser), which has generous heap headroom.
// Browser callers should opt out via `scaffold: false` and fetch the
// scaffolded tree out-of-band.
const TARBALL_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Wall-clock cap on a single scaffoldkit invocation. 5 minutes is far
 * longer than any real blueprint needs; anything hitting this is
 * either hung or a bug, and we'd rather surface a deterministic
 * `exitCode: -1 + stderr: "timeout …"` on the `done` event than let
 * the HTTP request block indefinitely. Unitless here because vitest
 * mocks the clock; plain integer ms.
 */
const SCAFFOLDKIT_TIMEOUT_MS = 5 * 60_000;

/**
 * Max captured scaffoldkit stderr that rides out on the `done` event.
 * Kept deliberately small: scaffoldkit may echo user-supplied input
 * values in its error messages, and the `done` frame is delivered to
 * the HTTP caller where it may land in logs. A 4 KiB tail is enough
 * for a debug signal without amplifying an accidental input leak.
 * Callers that need the full stderr should run scaffoldkit locally.
 *
 * This is a genuine byte budget (measured via `Buffer.byteLength`, not
 * `stderr.length`): scaffoldkit stderr can carry non-ASCII text (paths,
 * user-supplied blueprint values), and capping on `.length` alone would
 * count UTF-16 code units instead of bytes, letting the actual byte size
 * run up to ~4x the nominal budget for heavily multibyte output.
 */
const SCAFFOLDKIT_STDERR_MAX_BYTES = 4096;

/**
 * Invoke scaffoldkit against a planforge-produced `scaffoldkit-input.json`.
 * Returns the child's exit code + a capped captured stderr; never throws
 * on a nonzero exit — that's surfaced to the caller as metadata so a
 * failed scaffold doesn't mask a successful plan.
 *
 * Timeout → SIGTERM → SIGKILL, with `exitCode: -1` + a clear stderr
 * marker so callers can detect the timeout case in `done.scaffoldkit`.
 *
 * AbortSignal propagation: when the HTTP client disconnects mid-scaffold,
 * the subprocess is killed so the server doesn't run orphaned work to
 * completion.
 *
 * ENOENT on the Python binary is re-thrown so the caller can surface
 * `skipped: "not_installed"` cleanly.
 */
export async function runScaffoldkit(args: {
  python: string;
  inputPath: string;
  outdir: string;
  abortSignal?: AbortSignal;
}): Promise<{ exitCode: number; stderr: string }> {
  return await new Promise((resolvePromise, rejectPromise) => {
    // Arg shape: `from-planforge <input> --target <outdir> --overwrite
    // --no-install --no-ai-context`. `--no-install` keeps the service off the
    // network and prevents scaffoldkit from running `npm install` inside the
    // HTTP service's tempdir. `--no-ai-context` stops scaffoldkit re-emitting
    // its blueprint .ai/ tree (and AI_CONTEXT.md): the planforge CLI already
    // wrote the canonical, plan-derived .ai/ into outdir above, and --overwrite
    // would otherwise silently clobber it. The flag requires the scaffoldkit
    // pinned by SCAFFOLDKIT_REF in server/Dockerfile (>= 59ccd5b).
    const child = spawn(
      args.python,
      [
        "-m",
        "scaffoldkit.cli",
        "from-planforge",
        args.inputPath,
        "--target",
        args.outdir,
        "--overwrite",
        "--no-install",
        "--no-ai-context",
      ],
      {
        cwd: args.outdir,
        env: buildChildEnv(),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    let timedOut = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      // Byte-aware cap. Walks whole Unicode code points (not UTF-16 code
      // units) so a multibyte character straddling the byte budget is
      // dropped whole rather than split, which would otherwise leave a
      // stray/replacement byte sequence at the cut and let the result
      // creep past SCAFFOLDKIT_STDERR_MAX_BYTES.
      if (Buffer.byteLength(stderr, "utf8") > SCAFFOLDKIT_STDERR_MAX_BYTES) {
        let capped = "";
        let bytes = 0;
        for (const ch of stderr) {
          const chBytes = Buffer.byteLength(ch, "utf8");
          if (bytes + chBytes > SCAFFOLDKIT_STDERR_MAX_BYTES) break;
          capped += ch;
          bytes += chBytes;
        }
        stderr = capped;
      }
    });

    // Timeout watchdog: SIGTERM the child after SCAFFOLDKIT_TIMEOUT_MS.
    // SIGKILL 5s later if it hasn't exited.
    const timeout = setTimeout(() => {
      timedOut = true;
      if (!child.killed) child.kill("SIGTERM");
      const kill = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
      kill.unref?.();
    }, SCAFFOLDKIT_TIMEOUT_MS);
    timeout.unref?.();

    // Abort propagation: when the HTTP client disconnects, kill the
    // scaffold subprocess too. Without this, a hung scaffold keeps
    // running on the server after the caller gave up.
    const onAbort = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    args.abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      clearTimeout(timeout);
      args.abortSignal?.removeEventListener("abort", onAbort);
      rejectPromise(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      args.abortSignal?.removeEventListener("abort", onAbort);
      if (timedOut) {
        resolvePromise({
          exitCode: -1,
          stderr: `scaffoldkit timed out after ${SCAFFOLDKIT_TIMEOUT_MS}ms (${signal ?? "terminated"})`,
        });
        return;
      }
      resolvePromise({ exitCode: code ?? -1, stderr });
    });
  });
}

async function tarDir(dir: string): Promise<Buffer> {
  // `-C dir .` tars the directory's CONTENTS rather than the dir itself —
  // callers extract straight into their own tempdir without a nested
  // `out/` layer.
  //
  // Note: this shells out to the system `tar`. That's present on every
  // base image we care about (Debian bookworm-slim ships GNU tar). Going
  // via shell instead of a Node tar library keeps the dep tree minimal.
  const { stdout } = await execFileAsync(
    "tar",
    ["-czf", "-", "-C", dir, "."],
    {
      encoding: "buffer",
      maxBuffer: TARBALL_MAX_BYTES,
    },
  );
  return stdout;
}

export async function* runGenerate(
  input: unknown,
  opts: GenerateOptions,
): AsyncGenerator<GenerateEvent> {
  const requestId = randomUUID();
  // Key the tempdir on the request id so logs, open-file debugging, and
  // crash forensics all correlate cleanly. `mkdtemp` still appends a
  // random suffix so two requests with an identical (hypothetical)
  // request id would never collide.
  const tmp = await mkdtemp(resolve(tmpdir(), `planforge-${requestId}-`));
  const inputPath = resolve(tmp, "input.json");
  const outdir = resolve(tmp, "out");
  const scriptPath = resolve(opts.planforgeRoot, "scripts", "bootstrap-plan.js");

  // Hoisted so the outer `finally` below can remove the exact listener
  // reference that was added in the try block. `{ once: true }` already
  // detaches the listener once it fires on a real abort, but a request
  // that finishes WITHOUT the client ever disconnecting would otherwise
  // leave a live listener on opts.abortSignal (a caller-supplied,
  // potentially longer-lived AbortSignal) until that signal itself is
  // garbage-collected or fires for an unrelated reason.
  let onAbort: (() => void) | undefined;

  try {
    await writeFile(inputPath, JSON.stringify(input), { encoding: "utf8", mode: 0o600 });

    const child = spawn(
      opts.nodeBin,
      [scriptPath, "--input", inputPath, "--outdir", outdir, "--no-install"],
      {
        cwd: tmp,
        // Start from an empty env, add back only the vars the CLI needs.
        // Any secret that isn't explicitly allow-listed never reaches the
        // 4k-line CLI script.
        env: buildChildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Propagate client disconnect → kill the subprocess. Without this, a
    // dropped SSE consumer leaves the CLI running to completion on the
    // server. The tempdir cleanup in the outer `finally` still runs.
    onAbort = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

    // Buffer lines rather than raw chunks so the caller always sees
    // complete log lines as SSE frames.
    const queue: GenerateEvent[] = [];
    let done = false;
    let resolveWake: (() => void) | null = null;
    const wake = () => {
      const r = resolveWake;
      resolveWake = null;
      r?.();
    };

    const attachLineReader = (stream: NodeJS.ReadableStream, tag: "stdout" | "stderr") => {
      let buf = "";
      const flush = () => {
        if (buf.length > 0) {
          queue.push({ type: "progress", requestId, stream: tag, line: buf });
          buf = "";
          wake();
        }
      };
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          queue.push({ type: "progress", requestId, stream: tag, line });
          wake();
        }
      });
      // Flush the last partial line on both normal `end` and stream `error`
      // so an abrupt process death still surfaces the last log fragment.
      stream.on("end", flush);
      stream.on("error", flush);
    };
    attachLineReader(child.stdout!, "stdout");
    attachLineReader(child.stderr!, "stderr");

    let exitCode: number | null = null;
    // Set when the child's own "error" event (e.g. spawn ENOENT) already
    // queued a real error frame. In that case there is no "close" event, so
    // exitCode stays null and the exit-code fallback below would otherwise
    // queue a second, misleading error frame for the same failure.
    let spawnErrorEmitted = false;
    child.on("close", (code) => {
      exitCode = code;
      done = true;
      wake();
    });
    child.on("error", (err) => {
      spawnErrorEmitted = true;
      queue.push({ type: "error", requestId, message: err.message });
      done = true;
      wake();
    });

    while (!done || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((r) => {
          resolveWake = r;
        });
      }
      while (queue.length > 0) {
        yield queue.shift()!;
      }
    }

    if (spawnErrorEmitted) {
      return;
    }

    if (exitCode !== 0) {
      yield {
        type: "error",
        requestId,
        message: `planforge CLI exited with code ${exitCode ?? "unknown"}`,
        exitCode: exitCode ?? undefined,
      };
      return;
    }

    let planOutput: unknown;
    let scaffoldkitInput: unknown;
    try {
      planOutput = JSON.parse(
        await readFile(resolve(outdir, "planning", "plan-output.json"), "utf8"),
      );
    } catch (err) {
      yield {
        type: "error",
        requestId,
        message: `Failed to read plan-output.json: ${(err as Error).message}`,
        exitCode: 0,
      };
      return;
    }
    const scaffoldkitInputPath = resolve(outdir, "exports", "scaffoldkit-input.json");
    // Distinguish "file does not exist" (common — not every planning input
    // produces a scaffoldkit input) from "file exists but is unreadable /
    // malformed" (rare — almost certainly a CLI bug). The first case is
    // a normal skip; the second is diagnostic information the caller wants
    // surfaced so a silently broken CLI doesn't masquerade as no-op.
    let scaffoldkitInputReadError: string | null = null;
    try {
      scaffoldkitInput = JSON.parse(await readFile(scaffoldkitInputPath, "utf8"));
    } catch (err) {
      scaffoldkitInput = null;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        scaffoldkitInputReadError = (err as Error).message;
      }
    }

    // Run scaffoldkit if the CLI produced an input and the caller didn't
    // opt out. Populate `scaffoldkit` metadata unconditionally so the
    // caller can always branch on why files did/didn't end up in the tar.
    let scaffoldkit: ScaffoldkitResult;
    if (!opts.scaffold) {
      scaffoldkit = { invoked: false, skipped: "opt_out" };
    } else if (scaffoldkitInputReadError !== null) {
      scaffoldkit = {
        invoked: false,
        skipped: "input_unreadable",
        inputReadError: scaffoldkitInputReadError,
      };
    } else if (scaffoldkitInput === null) {
      scaffoldkit = { invoked: false, skipped: "no_input" };
    } else {
      try {
        const { exitCode, stderr } = await runScaffoldkit({
          python: opts.scaffoldkitPython,
          inputPath: scaffoldkitInputPath,
          outdir,
          abortSignal: opts.abortSignal,
        });
        scaffoldkit = { invoked: true, exitCode, stderr };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          // Scaffoldkit python is not installed in this environment.
          // Still emit `done` so planning artifacts aren't discarded;
          // callers inspect `scaffoldkit.skipped` to decide.
          scaffoldkit = { invoked: false, skipped: "not_installed" };
        } else {
          yield {
            type: "error",
            requestId,
            message: `Failed to spawn scaffoldkit: ${(err as Error).message}`,
            exitCode: 0,
          };
          return;
        }
      }
    }

    // Tar the full output tree so the caller can reconstruct the file
    // layout the CLI wrote on disk. project-forge reads ~30 files from
    // nested subdirectories (planning/, handoff/, exports/, tasks/) and
    // needs all of them, not just the two JSON blobs above.
    let outputTarGz: string | undefined;
    try {
      const tarballCap = opts.tarballMaxBytes ?? TARBALL_MAX_BYTES;
      const buf = await tarDir(outdir);
      if (buf.byteLength > tarballCap) {
        yield {
          type: "error",
          requestId,
          message: `Output tarball exceeds ${tarballCap} bytes`,
          exitCode: 0,
        };
        return;
      }
      outputTarGz = buf.toString("base64");
    } catch (err) {
      yield {
        type: "error",
        requestId,
        message: `Failed to tar output directory: ${(err as Error).message}`,
        exitCode: 0,
      };
      return;
    }

    yield {
      type: "done",
      requestId,
      planOutput,
      scaffoldkitInput,
      scaffoldkit,
      outputTarGz,
      exitCode: 0,
    };
  } finally {
    if (onAbort) opts.abortSignal?.removeEventListener("abort", onAbort);
    await rm(tmp, { recursive: true, force: true });
  }
}
