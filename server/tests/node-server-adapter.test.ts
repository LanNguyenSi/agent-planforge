/**
 * Adapter-level tests (task 87f1ec02): the real `app` from routes.ts is served
 * through serve() from @hono/node-server on an ephemeral loopback port, so the
 * adapter's socket path and its SSE streaming are covered. Every other suite
 * calls app.fetch() directly and would not notice an adapter regression.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/generate.js", () => ({ runGenerate: vi.fn() }));

// Imported after vi.mock so routes.ts receives the mocked runGenerate.
import { runGenerate } from "../src/generate.js";
import { app } from "../src/routes.js";
import { env } from "../src/config.js";
import { startNodeServer, type RunningServer } from "./helpers/node-server.js";

const AUTH = `Bearer ${env.PLANFORGE_SERVICE_TOKEN}`;

let running: RunningServer | undefined;
const cleanups: Array<() => void> = [];

afterEach(async () => {
  while (cleanups.length > 0) cleanups.pop()?.();
  await running?.close();
  running = undefined;
  vi.mocked(runGenerate).mockReset();
});

function withDeadline<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${what}: response is not streamed incrementally`)),
      3_000,
    );
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** Reads from the stream until one complete SSE frame (terminated by a blank line) is buffered. */
async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: { buf: string },
): Promise<{ event: string; data: unknown } | null> {
  const decoder = new TextDecoder();
  while (state.buf.indexOf("\n\n") < 0) {
    const { value, done } = await reader.read();
    if (done) return null;
    state.buf += decoder.decode(value, { stream: true });
  }
  const end = state.buf.indexOf("\n\n");
  const frame = state.buf.slice(0, end);
  state.buf = state.buf.slice(end + 2);
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return { event, data: JSON.parse(data) };
}

describe("node-server adapter: JSON round trip", () => {
  it("GET /healthz answers JSON over a real socket", async () => {
    running = await startNodeServer(app);
    const res = await fetch(`${running.url}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("agent-planforge");
  });

  it("the /api auth guard answers 401 JSON over a real socket", async () => {
    running = await startNodeServer(app);
    const res = await fetch(`${running.url}/api/generate`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("node-server adapter: SSE streaming", () => {
  it("delivers each SSE frame to the client before the generator finishes", async () => {
    // Deterministic handshake, no millisecond thresholds: the mocked generator
    // yields one event, then withholds the next (and the end) until the client
    // confirms it read the previous frame. A buffered response can never get
    // past the first gate, so the client hits the deadline.
    let generatorEnded = false;
    let ackFirst!: () => void;
    let ackSecond!: () => void;
    const firstRead = new Promise<void>((r) => (ackFirst = r));
    const secondRead = new Promise<void>((r) => (ackSecond = r));
    cleanups.push(ackFirst, ackSecond);

    vi.mocked(runGenerate).mockImplementation(async function* () {
      yield { type: "progress", requestId: "r1", stream: "stdout", line: "one" } as never;
      await firstRead;
      yield { type: "progress", requestId: "r1", stream: "stdout", line: "two" } as never;
      await secondRead;
      generatorEnded = true;
      yield { type: "error", requestId: "r1", message: "end of fake run" } as never;
    });

    running = await startNodeServer(app);
    const res = await withDeadline(
      fetch(`${running.url}/api/generate`, {
        method: "POST",
        headers: { Authorization: AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ input: {}, scaffold: false }),
      }),
      "response headers",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const state = { buf: "" };

    const first = await withDeadline(readFrame(reader, state), "first frame");
    expect(first).toEqual({
      event: "progress",
      data: { type: "progress", requestId: "r1", stream: "stdout", line: "one" },
    });
    expect(generatorEnded).toBe(false);
    ackFirst();

    const second = await withDeadline(readFrame(reader, state), "second frame");
    expect(second?.event).toBe("progress");
    expect((second?.data as { line: string }).line).toBe("two");
    expect(generatorEnded).toBe(false);
    ackSecond();

    const last = await withDeadline(readFrame(reader, state), "last frame");
    expect(last?.event).toBe("error");
    expect(generatorEnded).toBe(true);
    const end = await withDeadline(readFrame(reader, state), "stream end");
    expect(end).toBeNull();
  });
});
