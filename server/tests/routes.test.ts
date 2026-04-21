/**
 * Integration tests for the planforge HTTP service.
 *
 * These drive the full Hono app via `app.fetch(request)` — the same pattern
 * agent-relay and agent-tasks use. For tests that exercise the real CLI
 * (POST /generate happy path), we use the repo's own `examples/sample-input.json`
 * as the input and assert on the SSE event stream.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app } from "../src/routes.js";
import { env } from "../src/config.js";

const AUTH = `Bearer ${env.PLANFORGE_SERVICE_TOKEN}`;
const SAMPLE_INPUT_PATH = resolve(env.PLANFORGE_ROOT, "examples", "sample-input.json");

// Existing happy-path tests don't care about scaffolding — setting
// `scaffold: false` keeps the server off the (test-env-dependent)
// scaffoldkit binary. A dedicated describe block below covers the
// scaffold:true paths explicitly.
const GENERATE_BODY = (input: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ input, scaffold: false, ...extra });

describe("GET /healthz", () => {
  it("is unauth and returns status ok", async () => {
    const res = await app.fetch(new Request("http://test/healthz"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("agent-planforge");
  });

  it("is reachable even without the bearer token", async () => {
    // Explicitly: no Authorization header. Must not 401.
    const res = await app.fetch(new Request("http://test/healthz"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/generate — auth", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when a bearer is presented but wrong", async () => {
    // Distinct from the unauth 401: a present-but-invalid token is a
    // credential failure, not a missing one. Security monitoring should
    // be able to treat the two separately.
    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("returns 403 on a wrong-bearer of a different length (timing-safe compare)", async () => {
    // Same outcome as the equal-length case; asserts the length-mismatch
    // branch of the timing-safe compare doesn't throw or 500.
    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a body without `input` with 400", async () => {
    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ somethingElse: true }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/generate — happy path", () => {
  let sampleInput: unknown;

  beforeAll(async () => {
    sampleInput = JSON.parse(await readFile(SAMPLE_INPUT_PATH, "utf8"));
  });

  async function collectSSE(body: ReadableStream<Uint8Array> | null) {
    const events: Array<{ event: string; data: unknown }> = [];
    if (!body) return events;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by blank lines.
      let frameEnd: number;
      while ((frameEnd = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        const lines = frame.split("\n");
        let event = "message";
        let data = "";
        for (const ln of lines) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        if (data.length > 0) {
          events.push({ event, data: JSON.parse(data) });
        }
      }
    }
    return events;
  }

  it(
    "streams progress and ends with a `done` event carrying plan-output",
    async () => {
      const res = await app.fetch(
        new Request("http://test/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH },
          body: GENERATE_BODY(sampleInput),
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const events = await collectSSE(res.body);
      const types = events.map((e) => e.event);
      expect(types).toContain("done");
      expect(types).not.toContain("error");

      const done = events.find((e) => e.event === "done")!
        .data as {
          planOutput: { summary?: unknown };
          scaffoldkitInput: unknown;
          scaffoldkit: { invoked: boolean; skipped?: string };
          exitCode: number;
        };
      expect(done.exitCode).toBe(0);
      expect(done.planOutput).toBeTruthy();
      // The CLI always produces scaffoldkit-input.json on success for this sample
      // — assert it's non-null so a regression that stops writing it is caught.
      expect(done.scaffoldkitInput).toBeTruthy();
      // scaffold: false was passed — scaffoldkit must have been skipped
      // with that reason, not silently invoked.
      expect(done.scaffoldkit.invoked).toBe(false);
      expect(done.scaffoldkit.skipped).toBe("opt_out");
    },
    // CLI can take a few seconds on the sample input; give generous headroom.
    60_000,
  );

  it(
    "isolates concurrent runs (each gets a fresh tempdir, no cross-talk)",
    async () => {
      const [r1, r2] = await Promise.all([
        app.fetch(
          new Request("http://test/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: AUTH },
            body: GENERATE_BODY(sampleInput),
          }),
        ),
        app.fetch(
          new Request("http://test/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: AUTH },
            body: GENERATE_BODY(sampleInput),
          }),
        ),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const [e1, e2] = await Promise.all([collectSSE(r1.body), collectSSE(r2.body)]);
      const done1 = e1.find((e) => e.event === "done")!.data as { requestId: string };
      const done2 = e2.find((e) => e.event === "done")!.data as { requestId: string };
      // Two separate requests → two distinct request IDs AND the
      // plan-output's `structuredInputSource` path carries the request id
      // (via the tempdir name), so the two runs observably used different
      // tempdirs.
      expect(done1.requestId).not.toBe(done2.requestId);
      const pathOf = (e: typeof e1) => {
        const d = e.find((x) => x.event === "done")!.data as {
          planOutput: { inputParsing?: { structuredInputSource?: string } };
        };
        return d.planOutput.inputParsing?.structuredInputSource ?? "";
      };
      const p1 = pathOf(e1);
      const p2 = pathOf(e2);
      expect(p1).toContain(done1.requestId);
      expect(p2).toContain(done2.requestId);
      expect(p1).not.toBe(p2);
    },
    120_000,
  );

  it(
    "done event carries an outputTarGz that unpacks to the CLI's expected file layout",
    async () => {
      // The tarball is the contract project-forge relies on — it has to
      // contain the file tree the CLI wrote (planning/, exports/, etc.)
      // so the client can reconstruct the layout project-forge's
      // downstream code (resolvePlanforgeOutputPaths, scaffoldkit
      // invocation) reads from disk.
      const res = await app.fetch(
        new Request("http://test/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH },
          body: GENERATE_BODY(sampleInput),
        }),
      );
      expect(res.status).toBe(200);

      const events = await collectSSE(res.body);
      const done = events.find((e) => e.event === "done")!.data as {
        outputTarGz?: string;
      };
      expect(typeof done.outputTarGz).toBe("string");
      expect(done.outputTarGz!.length).toBeGreaterThan(0);

      // Unpack + inspect. Uses the same tools project-forge will use —
      // system tar via a pipe, no extra deps.
      const { spawn } = await import("node:child_process");
      const { mkdtemp, rm, readdir } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { resolve } = await import("node:path");

      const dir = await mkdtemp(resolve(tmpdir(), "planforge-untar-"));
      try {
        await new Promise<void>((resolveP, rejectP) => {
          const child = spawn("tar", ["-xzf", "-", "-C", dir], {
            stdio: ["pipe", "ignore", "pipe"],
          });
          child.on("error", rejectP);
          child.on("close", (code) => {
            if (code === 0) resolveP();
            else rejectP(new Error(`tar exited ${code}`));
          });
          child.stdin.end(Buffer.from(done.outputTarGz!, "base64"));
        });

        const top = await readdir(dir);
        // planforge-index.json is the sentinel the existing
        // resolvePlanforgeOutputPaths() keys off of.
        expect(top).toContain("planforge-index.json");
        // exports/scaffoldkit-input.json is the handoff file
        // project-forge feeds to the scaffoldkit CLI.
        const exportsDir = await readdir(resolve(dir, "exports"));
        expect(exportsDir).toContain("scaffoldkit-input.json");
        // planning/plan-output.json — the canonical plan artifact.
        const planningDir = await readdir(resolve(dir, "planning"));
        expect(planningDir).toContain("plan-output.json");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    "does not log the request body (secret-safety)",
    async () => {
      // The ticket + ADR-0002 require that we never log request bodies;
      // secrets may ride along with user-supplied values. We drop a
      // distinctive sentinel into the `input` and capture both stdout
      // and stderr across the request lifetime, then assert the
      // sentinel is nowhere.
      const sentinel = "SECRET-SENTINEL-" + Math.random().toString(36).slice(2, 10);
      const input = { ...(sampleInput as object), summary: sentinel };

      const captured: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };
      console.error = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };
      try {
        const res = await app.fetch(
          new Request("http://test/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: AUTH },
            body: GENERATE_BODY(input),
          }),
        );
        // Drain the SSE body so any subprocess-triggered logging has a
        // chance to land before the assertion runs.
        await collectSSE(res.body);
      } finally {
        console.log = origLog;
        console.error = origErr;
      }
      const joined = captured.join("\n");
      expect(joined).not.toContain(sentinel);
    },
    60_000,
  );
});

describe("POST /api/generate — scaffoldkit", () => {
  let sampleInput: unknown;

  beforeAll(async () => {
    sampleInput = JSON.parse(await readFile(SAMPLE_INPUT_PATH, "utf8"));
  });

  async function collectSSE(body: ReadableStream<Uint8Array> | null) {
    const events: Array<{ event: string; data: unknown }> = [];
    if (!body) return events;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        const lines = frame.split("\n");
        let event = "message";
        let data = "";
        for (const ln of lines) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) data += ln.slice(5).trim();
        }
        if (data.length > 0) events.push({ event, data: JSON.parse(data) });
      }
    }
    return events;
  }

  /**
   * Drive the service through the scaffold-invoke path without needing
   * the real scaffoldkit venv installed. We override SCAFFOLDKIT_PYTHON
   * on the env before import-time caching by mutating `env.SCAFFOLDKIT_PYTHON`
   * directly — the server reads it each generate via the `runGenerate`
   * options, not a closure.
   */
  it(
    "reports `not_installed` when SCAFFOLDKIT_PYTHON does not exist and scaffold defaults on",
    async () => {
      const orig = env.SCAFFOLDKIT_PYTHON;
      env.SCAFFOLDKIT_PYTHON = "/definitely/does/not/exist/python3";
      try {
        const res = await app.fetch(
          new Request("http://test/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: AUTH },
            body: JSON.stringify({ input: sampleInput }),
          }),
        );
        expect(res.status).toBe(200);
        const events = await collectSSE(res.body);
        expect(events.map((e) => e.event)).not.toContain("error");
        const done = events.find((e) => e.event === "done")!.data as {
          scaffoldkit: { invoked: boolean; skipped?: string };
        };
        expect(done.scaffoldkit.invoked).toBe(false);
        expect(done.scaffoldkit.skipped).toBe("not_installed");
      } finally {
        env.SCAFFOLDKIT_PYTHON = orig;
      }
    },
    60_000,
  );

  it(
    "surfaces scaffoldkit's exit code + stderr in the `done` event when invoked",
    async () => {
      // Stub "python" = /bin/sh invoking a script that echoes to stderr
      // and exits nonzero. Exercises the invoke→capture→surface path
      // without requiring the real venv.
      const orig = env.SCAFFOLDKIT_PYTHON;
      // /bin/sh exits 2 and prints to stderr when given `-c 'echo x >&2; exit 2' ...`,
      // but we can't pass args through our code path — we spawn with a
      // fixed argv shape. Instead, use a stub shell script on disk:
      const { mkdtemp, writeFile, chmod } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { resolve } = await import("node:path");
      const stubDir = await mkdtemp(resolve(tmpdir(), "scaffoldkit-stub-"));
      const stub = resolve(stubDir, "python3");
      await writeFile(
        stub,
        "#!/bin/sh\necho 'stub-scaffoldkit: simulated failure' >&2\nexit 7\n",
        { mode: 0o755 },
      );
      await chmod(stub, 0o755);
      env.SCAFFOLDKIT_PYTHON = stub;
      try {
        const res = await app.fetch(
          new Request("http://test/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: AUTH },
            body: JSON.stringify({ input: sampleInput }),
          }),
        );
        expect(res.status).toBe(200);
        const events = await collectSSE(res.body);
        expect(events.map((e) => e.event)).not.toContain("error");
        const done = events.find((e) => e.event === "done")!.data as {
          scaffoldkit: { invoked: boolean; exitCode?: number; stderr?: string };
        };
        // Nonzero scaffoldkit exit must NOT fail the whole request —
        // planning succeeded, that's what the `done` event signals.
        expect(done.scaffoldkit.invoked).toBe(true);
        expect(done.scaffoldkit.exitCode).toBe(7);
        expect(done.scaffoldkit.stderr).toContain("stub-scaffoldkit: simulated failure");
      } finally {
        env.SCAFFOLDKIT_PYTHON = orig;
        const { rm } = await import("node:fs/promises");
        await rm(stubDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it(
    "reports `opt_out` when the caller passes scaffold:false",
    async () => {
      const res = await app.fetch(
        new Request("http://test/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH },
          body: JSON.stringify({ input: sampleInput, scaffold: false }),
        }),
      );
      expect(res.status).toBe(200);
      const events = await collectSSE(res.body);
      const done = events.find((e) => e.event === "done")!.data as {
        scaffoldkit: { invoked: boolean; skipped?: string };
      };
      expect(done.scaffoldkit.invoked).toBe(false);
      expect(done.scaffoldkit.skipped).toBe("opt_out");
    },
    60_000,
  );
});
