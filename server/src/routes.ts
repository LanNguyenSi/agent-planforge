import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { timingSafeEqual } from "node:crypto";
import { env } from "./config.js";
import { runGenerate } from "./generate.js";

export const app = new Hono();

/**
 * Constant-time bearer compare. Short-circuit `!==` on a shared service
 * token is a well-known timing oracle; `timingSafeEqual` requires same-
 * length buffers, so pre-check length and substitute a same-length dummy
 * on mismatch to keep the compare itself constant-time.
 */
function bearerMatches(presented: string): boolean {
  const expected = env.PLANFORGE_SERVICE_TOKEN;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Throw-away same-length compare so mismatched-length inputs still
    // spend the same amount of time in this function.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

// Unauth healthcheck — used by Traefik + the ops dashboard. Intentionally
// mounted at the root so Traefik's internal router can hit it without
// threading a token. Returns flat JSON to match agent-relay's shape.
app.get("/healthz", (c) =>
  c.json({
    status: "ok",
    service: "agent-planforge",
    uptime: process.uptime(),
  }),
);

// Everything under /api requires a Bearer token matching PLANFORGE_SERVICE_TOKEN.
// No scope system here — this is an internal service token with a single role:
// "authorised client of planforge". Access-control lives one level up
// (project-forge's session auth, or whatever calls the service).
const api = new Hono();
api.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    // No token presented at all — authentication stage failure.
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!bearerMatches(auth.slice(7))) {
    // Token presented but doesn't match — authorization failure. The
    // 401/403 split mirrors the ticket's acceptance criteria ("401
    // without Bearer, 403 with wrong Bearer") and lets a caller log or
    // alert on the "credentials attempted and rejected" case distinctly
    // from "no credentials sent".
    return c.json({ error: "forbidden" }, 403);
  }
  return next();
});

// POST /api/generate — runs the planforge CLI in an isolated tempdir and
// streams progress via SSE. Response content-type is text/event-stream.
//
// Request body: { input: <planning-input>, scaffold?: boolean }
//   - `scaffold` (default true): after the CLI writes scaffoldkit-input.json,
//     invoke scaffoldkit against the outdir so the `done` tarball contains
//     scaffolded project files. Set `false` for planning-only runs.
//
// Events emitted:
//   - `progress` — { requestId, stream: "stdout"|"stderr", line }
//   - `done`     — { requestId, planOutput, scaffoldkitInput | null,
//                     scaffoldkit: { invoked, exitCode?, stderr?, skipped? },
//                     outputTarGz, exitCode: 0 }
//   - `error`    — { requestId, message, exitCode? }
//
// The CLI's stdout lines are the authoritative progress feed today; when the
// CLI learns structured events later, the `line` payload can evolve to
// structured objects without breaking this contract.
api.post("/generate", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Body must be JSON" }, 400);
  }
  if (!body || typeof body !== "object" || !("input" in body)) {
    return c.json(
      { error: "bad_request", message: "Body must be { input: <planning-input>, scaffold?: boolean }" },
      400,
    );
  }

  // Intentionally do NOT log `body` — it may carry user-supplied values that
  // become secrets downstream. Only the request id + timing + outcome are
  // log-worthy. See ADR-0002 § "Secret handling".
  const input = (body as { input: unknown }).input;
  // Default scaffold=true. An explicit `false` opts out; any other value
  // (including omission) preserves back-compat by scaffolding on.
  const scaffold = (body as { scaffold?: unknown }).scaffold !== false;

  // Wire the HTTP client's AbortSignal through to the CLI subprocess so a
  // mid-stream disconnect doesn't leave an orphan node process + tempdir
  // on the server. Without this, a dropped client keeps the generator
  // alive until the child exits on its own — fine for 4k-line CLI runs
  // that take a few seconds, but a real resource leak once the CLI learns
  // to take minutes (planned).
  const controller = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => controller.abort(), { once: true });

  return streamSSE(c, async (stream) => {
    let requestId: string | undefined;
    try {
      for await (const ev of runGenerate(input, {
        planforgeRoot: env.PLANFORGE_ROOT,
        nodeBin: env.NODE_BIN,
        scaffoldkitPython: env.SCAFFOLDKIT_PYTHON,
        scaffold,
        abortSignal: controller.signal,
      })) {
        requestId = ev.requestId;
        await stream.writeSSE({
          event: ev.type,
          data: JSON.stringify(ev),
        });
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        // Echo the requestId when we have one so callers can correlate
        // transport-level failures with the earlier `progress` frames.
        data: JSON.stringify({
          type: "error",
          requestId,
          message: (err as Error).message,
        }),
      });
    }
  });
});

app.route("/api", api);
