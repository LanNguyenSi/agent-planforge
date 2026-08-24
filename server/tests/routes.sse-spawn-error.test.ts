/**
 * Wire-level regression test for task bbc4dec3: a failed spawn of the main CLI must
 * reach an SSE client as exactly one `error` frame, not two.
 *
 * Before the fix in generate.ts, child.on("error") queued the real spawn
 * error, then the exit-code fallback (exitCode stays null because no
 * "close" event fires after a failed spawn) queued a second, misleading
 * "planforge CLI exited with code unknown" error frame. routes.ts forwards
 * every event from runGenerate onto the SSE stream without breaking on
 * error, so both frames used to reach the wire.
 *
 * spawn is mocked here (file-scoped vi.mock, per the pattern already used in
 * generate.subprocess.test.ts) so this file drives the full HTTP route via
 * app.fetch(request) and inspects the actual SSE bytes on the wire.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

// Imported after vi.mock so routes.ts (via generate.ts) receives the
// mocked spawn.
import { app } from "../src/routes.js";
import { env } from "../src/config.js";

const AUTH = `Bearer ${env.PLANFORGE_SERVICE_TOKEN}`;

function fakeChild() {
  const c = new EventEmitter() as any;
  c.killed = false;
  c.kill = vi.fn((_sig?: string) => {
    c.killed = true;
    return true;
  });
  c.stderr = new Readable({ read() {} });
  c.stderr.setEncoding = () => {};
  c.stdout = new Readable({ read() {} });
  c.stdout.setEncoding?.();
  return c;
}

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

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/generate — SSE wire contract for a spawn failure", () => {
  it("emits exactly one `error` frame when the main CLI subprocess fails to spawn", async () => {
    const child = fakeChild();
    const enoentErr = Object.assign(
      new Error("spawn /definitely/does/not/exist/node ENOENT"),
      { code: "ENOENT" },
    );
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", enoentErr));
      return child;
    });

    const res = await app.fetch(
      new Request("http://test/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ input: {}, scaffold: false }),
      }),
    );
    expect(res.status).toBe(200);

    const events = await collectSSE(res.body);
    const errorFrames = events.filter((e) => e.event === "error");
    expect(errorFrames).toHaveLength(1);
    expect((errorFrames[0]?.data as { message: string }).message).toMatch(
      /ENOENT/,
    );
  });
});
