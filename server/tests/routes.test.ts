/**
 * Integration tests for the planforge HTTP service.
 *
 * These drive the full Hono app via `app.fetch(request)` — the same pattern
 * agent-relay and agent-tasks use. For tests that exercise the real CLI
 * (POST /generate happy path), we use the repo's own `examples/sample-input.json`
 * as the input and assert on the SSE event stream.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { app } from "../src/routes.js";
import { env } from "../src/config.js";
import { runGenerate, type GenerateEvent } from "../src/generate.js";

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
    const body = (await res.json()) as {
      status: string;
      service: string;
      scaffoldkitPython: string;
    };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("agent-planforge");
    // The scaffoldkitPython probe is exposed so the ops dashboard can flag
    // a misconfigured deployment. In the test env the default
    // /opt/sk-venv/bin/python3 doesn't exist, so the field reports
    // "missing"; production where the Dockerfile lays down the venv
    // reports "ok".
    expect(body.scaffoldkitPython).toBe("missing");
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

describe("attachments helpers (unit — v0.1b text-tier ingest)", () => {
  // Import via dynamic-inside-block so the test file still runs if these
  // helpers get renamed in a future refactor — TS compile-time would catch
  // it anyway, but static `import` here would break test discovery.
  it("buildAdditionalContextBlock returns empty string for no attachments", async () => {
    const { buildAdditionalContextBlock } = await import("../src/routes.js");
    expect(buildAdditionalContextBlock(undefined)).toEqual({ ok: true, block: "" });
    expect(buildAdditionalContextBlock([])).toEqual({ ok: true, block: "" });
  });

  it("buildAdditionalContextBlock skips diagram/structured tiers and attachments without inlineText", async () => {
    const { buildAdditionalContextBlock } = await import("../src/routes.js");
    const result = buildAdditionalContextBlock([
      { name: "architecture.png", mimeType: "image/png", tier: "diagram" },
      { name: "model.drawio", mimeType: "application/vnd.jgraph.mxfile", tier: "structured" },
      { name: "empty.md", mimeType: "text/markdown", tier: "text", inlineText: "" },
      { name: "notext.md", mimeType: "text/markdown", tier: "text" },
    ]);
    expect(result).toEqual({ ok: true, block: "" });
  });

  it("buildAdditionalContextBlock formats a single text-tier attachment", async () => {
    const { buildAdditionalContextBlock } = await import("../src/routes.js");
    const result = buildAdditionalContextBlock([
      { name: "arc42.md", mimeType: "text/markdown", tier: "text", inlineText: "We use Postgres." },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.block).toBe(
        "## Additional context from attachment: arc42.md\n\nWe use Postgres.\n\n---",
      );
    }
  });

  it("buildAdditionalContextBlock concatenates multiple text-tier attachments with double-newlines", async () => {
    const { buildAdditionalContextBlock } = await import("../src/routes.js");
    const result = buildAdditionalContextBlock([
      { name: "a.md", mimeType: "text/markdown", tier: "text", inlineText: "alpha" },
      { name: "b.md", mimeType: "text/markdown", tier: "text", inlineText: "beta" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The "\n\n" separator between blocks means the `---` break from
      // block A is followed by a blank line then block B's heading — a
      // reader or LLM sees a clean section break, not two adjacent
      // headings mashed together.
      expect(result.block).toBe(
        "## Additional context from attachment: a.md\n\nalpha\n\n---\n\n## Additional context from attachment: b.md\n\nbeta\n\n---",
      );
    }
  });

  it("buildAdditionalContextBlock rejects when total chars exceed the cap", async () => {
    const { buildAdditionalContextBlock, ATTACHMENTS_MAX_TOTAL_CHARS } = await import(
      "../src/routes.js"
    );
    const big = "x".repeat(ATTACHMENTS_MAX_TOTAL_CHARS + 1);
    const result = buildAdditionalContextBlock([
      { name: "huge.md", mimeType: "text/markdown", tier: "text", inlineText: big },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(ATTACHMENTS_MAX_TOTAL_CHARS));
      expect(result.message).toContain("split or resample");
    }
  });

  it("buildAdditionalContextBlock rejects when summed chars across attachments exceed the cap", async () => {
    const { buildAdditionalContextBlock, ATTACHMENTS_MAX_TOTAL_CHARS } = await import(
      "../src/routes.js"
    );
    // Split one oversized payload across two attachments to prove the
    // cap is applied to the SUM, not per-entry — otherwise a caller
    // could bypass the limit by chunking client-side.
    const half = "y".repeat(Math.ceil(ATTACHMENTS_MAX_TOTAL_CHARS / 2) + 1);
    const result = buildAdditionalContextBlock([
      { name: "a.md", mimeType: "text/markdown", tier: "text", inlineText: half },
      { name: "b.md", mimeType: "text/markdown", tier: "text", inlineText: half },
    ]);
    expect(result.ok).toBe(false);
  });

  it("augmentInputWithContext returns input unchanged when block is empty", async () => {
    const { augmentInputWithContext } = await import("../src/routes.js");
    const input = { summary: "original", projectName: "Test" };
    const result = augmentInputWithContext(input, "");
    // Same reference — hot path for no-attachments case stays allocation-free.
    expect(result).toBe(input);
  });

  it("augmentInputWithContext prepends block onto existing summary, preserves other fields", async () => {
    const { augmentInputWithContext } = await import("../src/routes.js");
    const input = { summary: "original summary", projectName: "Test", extra: [1, 2] };
    const result = augmentInputWithContext(input, "CONTEXT BLOCK") as Record<string, unknown>;
    expect(result).not.toBe(input); // copy-on-write, not mutation
    expect((input as Record<string, unknown>).summary).toBe("original summary"); // caller's object untouched
    expect(result.summary).toBe("CONTEXT BLOCK\n\noriginal summary");
    expect(result.projectName).toBe("Test");
    expect(result.extra).toEqual([1, 2]);
  });

  it("augmentInputWithContext seeds summary when input had no summary string", async () => {
    const { augmentInputWithContext } = await import("../src/routes.js");
    const input = { projectName: "Test" };
    const result = augmentInputWithContext(input, "CONTEXT BLOCK") as Record<string, unknown>;
    expect(result.summary).toBe("CONTEXT BLOCK");
    expect(result.projectName).toBe("Test");
  });

  it("augmentInputWithContext seeds summary when summary is a non-string (defensive)", async () => {
    const { augmentInputWithContext } = await import("../src/routes.js");
    const input = { summary: null };
    const result = augmentInputWithContext(input, "CONTEXT") as Record<string, unknown>;
    expect(result.summary).toBe("CONTEXT");
  });

  it("augmentInputWithContext wraps non-object input in a synthetic { summary } object", async () => {
    const { augmentInputWithContext } = await import("../src/routes.js");
    const result = augmentInputWithContext("I am a bare string", "CONTEXT") as Record<
      string,
      unknown
    >;
    expect(result).toEqual({ summary: "CONTEXT" });
  });
});

describe("POST /api/generate — attachments validation (v0.1a contract stub)", () => {
  const MALFORMED_CASES: Array<{ label: string; attachments: unknown; expect: string }> = [
    { label: "non-array", attachments: "oops", expect: "must be an array" },
    { label: "entry not an object", attachments: ["raw string"], expect: "must be an object" },
    {
      label: "missing name",
      attachments: [{ mimeType: "text/markdown", tier: "text" }],
      expect: "name must be a non-empty string",
    },
    {
      label: "empty name",
      attachments: [{ name: "", mimeType: "text/markdown", tier: "text" }],
      expect: "name must be a non-empty string",
    },
    {
      label: "missing mimeType",
      attachments: [{ name: "a.md", tier: "text" }],
      expect: "mimeType must be a non-empty string",
    },
    {
      label: "unknown tier",
      attachments: [{ name: "a.md", mimeType: "text/markdown", tier: "magic" }],
      expect: "tier must be one of",
    },
    {
      label: "non-string inlineText",
      attachments: [
        { name: "a.md", mimeType: "text/markdown", tier: "text", inlineText: 42 },
      ],
      expect: "inlineText must be a string",
    },
  ];

  for (const tc of MALFORMED_CASES) {
    it(`rejects attachments with ${tc.label} (400)`, async () => {
      const res = await app.fetch(
        new Request("http://test/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH },
          body: JSON.stringify({ input: {}, attachments: tc.attachments }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("bad_request");
      expect(body.message).toContain(tc.expect);
    });
  }

  it("accepts an empty attachments array (200, field ignored in v0.1a)", async () => {
    // Well-formed empty array is a valid degenerate case — no CLI needs to
    // spin up because the input is empty. We use a sample input and assert
    // only that the request reaches the CLI layer (i.e. gets past edge
    // validation). Drive through the full stream by using scaffold:false
    // so it's cheap.
    const sampleInput = JSON.parse(
      await readFile(SAMPLE_INPUT_PATH, "utf8"),
    );
    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ input: sampleInput, scaffold: false, attachments: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Drain but do not assert on plan shape — the existing happy-path
    // covers that. The point here is: empty attachments[] does not change
    // the response status or stream contract.
    const reader = res.body!.getReader();
    while (!(await reader.read()).done) {
      /* drain */
    }
  }, 60_000);

  it(
    "accepts a well-formed text-tier attachment and streams to done (v0.1b: attachment augments prompt, still succeeds)",
    async () => {
      const sampleInput = JSON.parse(
        await readFile(SAMPLE_INPUT_PATH, "utf8"),
      );
      const res = await app.fetch(
        new Request("http://test/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH },
          body: JSON.stringify({
            input: sampleInput,
            scaffold: false,
            attachments: [
              {
                name: "arc42-snippet.md",
                mimeType: "text/markdown",
                tier: "text",
                inlineText: "# Architecture\n\nWe use Postgres for primary storage.",
              },
            ],
          }),
        }),
      );
      expect(res.status).toBe(200);

      // Reuse the ad-hoc SSE collector the happy-path tests use. Consume
      // the full stream and assert it completes with `done`, not `error`,
      // proving that the attachments field didn't perturb the CLI call.
      const events: Array<{ event: string; data: unknown }> = [];
      const reader = res.body!.getReader();
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
      expect(events.map((e) => e.event)).toContain("done");
      expect(events.map((e) => e.event)).not.toContain("error");

      // v0.1b invariant: the prompt is augmented with the attachment text
      // (unit tests above cover the string transformation deterministically).
      // Here we only assert the CLI runs to completion through the augmented
      // input; whether the LLM-free CLI surfaces the attachment content in
      // plan-output is an LLM-layer smoke test, out of scope for unit runs.
      const done = events.find((e) => e.event === "done")!.data as {
        planOutput: Record<string, unknown>;
        exitCode: number;
      };
      expect(done.exitCode).toBe(0);
      expect(done.planOutput).toBeTruthy();
    },
    60_000,
  );

  it(
    "rejects attachments whose total inlineText exceeds the char cap (400 attachments_too_large)",
    async () => {
      const { ATTACHMENTS_MAX_TOTAL_CHARS } = await import("../src/routes.js");
      const overflow = "x".repeat(ATTACHMENTS_MAX_TOTAL_CHARS + 1);
      const res = await app.fetch(
        new Request("http://test/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH },
          body: JSON.stringify({
            input: {},
            attachments: [
              {
                name: "huge.md",
                mimeType: "text/markdown",
                tier: "text",
                inlineText: overflow,
              },
            ],
          }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("attachments_too_large");
      expect(body.message).toContain(String(ATTACHMENTS_MAX_TOTAL_CHARS));
    },
  );
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
    "bundles files written by scaffoldkit into the response tarball",
    async () => {
      // Stub "python" = shell script that pretends to be scaffoldkit:
      // walks argv for `--target`, writes a sentinel file there, exits 0.
      // Proves the invoked→files-land-in-tarball pipeline end-to-end
      // without needing the real Python venv.
      const orig = env.SCAFFOLDKIT_PYTHON;
      const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { resolve } = await import("node:path");
      const stubDir = await mkdtemp(resolve(tmpdir(), "scaffoldkit-stub-ok-"));
      const stub = resolve(stubDir, "python3");
      await writeFile(
        stub,
        `#!/bin/sh
# Walk argv for --target <dir>
while [ $# -gt 0 ]; do
  if [ "$1" = "--target" ]; then TARGET="$2"; break; fi
  shift
done
if [ -z "$TARGET" ]; then echo "stub: --target not found" >&2; exit 2; fi
mkdir -p "$TARGET"
echo "hello from scaffoldkit stub" > "$TARGET/stub-scaffolded.txt"
exit 0
`,
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
        const done = events.find((e) => e.event === "done")!.data as {
          scaffoldkit: { invoked: boolean; exitCode?: number };
          outputTarGz?: string;
        };
        expect(done.scaffoldkit.invoked).toBe(true);
        expect(done.scaffoldkit.exitCode).toBe(0);
        expect(typeof done.outputTarGz).toBe("string");

        // Unpack the tarball and assert the stub's file is in it — proof
        // the scaffold step ran AND its output was bundled.
        const { spawn } = await import("node:child_process");
        const { readdir } = await import("node:fs/promises");
        const untarDir = await mkdtemp(resolve(tmpdir(), "planforge-untar-"));
        try {
          await new Promise<void>((resP, rejP) => {
            const child = spawn("tar", ["-xzf", "-", "-C", untarDir], {
              stdio: ["pipe", "ignore", "pipe"],
            });
            child.on("error", rejP);
            child.on("close", (code) =>
              code === 0 ? resP() : rejP(new Error(`tar ${code}`)),
            );
            child.stdin.end(Buffer.from(done.outputTarGz!, "base64"));
          });
          const top = await readdir(untarDir);
          expect(top).toContain("stub-scaffolded.txt");
          // Planning sentinel still present — scaffoldkit did not wipe.
          expect(top).toContain("planforge-index.json");
        } finally {
          await rm(untarDir, { recursive: true, force: true });
        }
      } finally {
        env.SCAFFOLDKIT_PYTHON = orig;
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

/**
 * Direct-runGenerate tests that exercise two branches the route-driven
 * tests above cannot reach without a real planforge CLI:
 *
 *   - `scaffoldkit.skipped: "no_input"` when the CLI runs successfully but
 *     does not write `exports/scaffoldkit-input.json`. Reproduced with a
 *     stub bootstrap-plan.js that writes the planning sentinel only.
 *
 *   - The byte-length cap on the gzipped tarball. The module constant
 *     TARBALL_MAX_BYTES is 50 MiB; writing 50 MiB of incompressible data
 *     would also trip the `tar` subprocess's maxBuffer safety net first.
 *     Instead we lower the cap via the `tarballMaxBytes` opt and assert the
 *     "Output tarball exceeds N bytes" message fires from the post-tar
 *     byte-length check at generate.ts.
 *
 * These deliberately bypass the HTTP route — `runGenerate` is the function
 * under test and the SSE/streamSSE plumbing already has coverage above.
 */
describe("runGenerate — guard rails (PR #62 follow-up)", () => {
  /**
   * Lay down a temp `planforgeRoot` containing a stub `scripts/bootstrap-plan.js`
   * that mimics the real CLI's on-disk output shape. The caller chooses
   * which artifacts the stub writes so we can reach each branch of the
   * post-CLI handling in generate.ts deterministically.
   */
  async function setupStubCli(opts: {
    writeScaffoldInput: boolean;
    extraBytes?: number;
  }): Promise<{ planforgeRoot: string; cleanup: () => Promise<void> }> {
    const root = await mkdtemp(resolve(tmpdir(), "planforge-stub-cli-"));
    const scriptDir = resolve(root, "scripts");
    await mkdir(scriptDir, { recursive: true });
    const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--outdir");
if (outIdx < 0 || !args[outIdx + 1]) {
  console.error("stub bootstrap-plan: --outdir is required");
  process.exit(2);
}
const outdir = args[outIdx + 1];
fs.mkdirSync(path.join(outdir, "planning"), { recursive: true });
fs.writeFileSync(
  path.join(outdir, "planning", "plan-output.json"),
  JSON.stringify({ stub: true }),
);
${
  opts.writeScaffoldInput
    ? `fs.mkdirSync(path.join(outdir, "exports"), { recursive: true });
fs.writeFileSync(
  path.join(outdir, "exports", "scaffoldkit-input.json"),
  JSON.stringify({ stub: true }),
);
`
    : ""
}
${
  opts.extraBytes
    ? `fs.writeFileSync(
  path.join(outdir, "ballast.bin"),
  crypto.randomBytes(${opts.extraBytes}),
);
`
    : ""
}
process.exit(0);
`;
    await writeFile(resolve(scriptDir, "bootstrap-plan.js"), script);
    return {
      planforgeRoot: root,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  }

  async function drain(
    iter: AsyncGenerator<GenerateEvent>,
  ): Promise<GenerateEvent[]> {
    const events: GenerateEvent[] = [];
    for await (const ev of iter) {
      events.push(ev);
    }
    return events;
  }

  it(
    "reports `skipped: no_input` when the CLI does not write scaffoldkit-input.json",
    async () => {
      const stub = await setupStubCli({ writeScaffoldInput: false });
      try {
        const events = await drain(
          runGenerate(
            {},
            {
              planforgeRoot: stub.planforgeRoot,
              nodeBin: process.execPath,
              // Path exists (the stub script) but is never invoked — the
              // no_input branch short-circuits before runScaffoldkit. We
              // still pass a real path so the assertion isn't accidentally
              // satisfied by an unrelated "not_installed" branch.
              scaffoldkitPython: process.execPath,
              scaffold: true,
            },
          ),
        );
        expect(events.map((e) => e.type)).not.toContain("error");
        const done = events.find((e) => e.type === "done")!;
        expect(done.scaffoldkit?.invoked).toBe(false);
        expect(done.scaffoldkit?.skipped).toBe("no_input");
        // scaffoldkitInput is the field that drove the branch; surface it
        // so a regression in the JSON.parse / ENOENT split is visible.
        expect(done.scaffoldkitInput).toBeNull();
      } finally {
        await stub.cleanup();
      }
    },
    30_000,
  );

  it(
    "emits an `error` event with the overflow message when the tarball exceeds the byte cap",
    async () => {
      // Add 8 KiB of incompressible (random) ballast so the gzipped tarball
      // is comfortably above the 256-byte cap below. The 256-byte cap is
      // still well under TARBALL_MAX_BYTES, so the `tar` maxBuffer safety
      // net never trips — the byte-length check at generate.ts is the only
      // code path that can fire.
      const stub = await setupStubCli({
        writeScaffoldInput: false,
        extraBytes: 8192,
      });
      try {
        const events = await drain(
          runGenerate(
            {},
            {
              planforgeRoot: stub.planforgeRoot,
              nodeBin: process.execPath,
              scaffoldkitPython: process.execPath,
              scaffold: false,
              tarballMaxBytes: 256,
            },
          ),
        );
        const err = events.find((e) => e.type === "error");
        expect(err).toBeDefined();
        expect(err?.message).toMatch(/Output tarball exceeds 256 bytes/);
        // No `done` should follow once the byte-length check returns.
        expect(events.find((e) => e.type === "done")).toBeUndefined();
      } finally {
        await stub.cleanup();
      }
    },
    30_000,
  );

  it(
    "succeeds when the tarball stays within the byte cap",
    async () => {
      // Mirror-image of the previous test: prove the assertion is meaningful
      // by confirming the same setup with a generous cap still produces a
      // `done` event. Without this, the negative case above could pass
      // because of an unrelated short-circuit.
      const stub = await setupStubCli({ writeScaffoldInput: false });
      try {
        const events = await drain(
          runGenerate(
            {},
            {
              planforgeRoot: stub.planforgeRoot,
              nodeBin: process.execPath,
              scaffoldkitPython: process.execPath,
              scaffold: false,
              tarballMaxBytes: 50 * 1024 * 1024,
            },
          ),
        );
        expect(events.map((e) => e.type)).not.toContain("error");
        const done = events.find((e) => e.type === "done")!;
        expect(typeof done.outputTarGz).toBe("string");
      } finally {
        await stub.cleanup();
      }
    },
    30_000,
  );
});
