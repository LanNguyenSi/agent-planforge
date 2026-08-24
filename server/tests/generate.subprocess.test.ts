/**
 * Unit tests for the runScaffoldkit subprocess lifecycle:
 *   - Gap 1: timeout watchdog fires SIGTERM and resolves { exitCode: -1 }
 *   - Gap 2: AbortSignal propagation kills the child with SIGTERM
 *   - Gap 3: captured stderr is capped at SCAFFOLDKIT_STDERR_MAX_BYTES, a
 *     genuine byte budget (Buffer.byteLength), not a UTF-16 code-unit count
 *   - Gap 4: child.on("error") (spawn ENOENT) rejects the promise with the
 *     raw error, and runGenerate's own child.on("error") for the main CLI
 *     subprocess surfaces a generic SSE `error` event
 *
 * spawn is the ONLY thing mocked here; execFile (used by tarDir) stays real.
 * This mock is file-scoped in vitest and does NOT affect routes.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter, getEventListeners } from "node:events";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

// Imported after vi.mock so generate.ts receives the mocked spawn.
import { runScaffoldkit, runGenerate, type GenerateEvent } from "../src/generate.js";

// Mirror the module constants (not exported from generate.ts; hardcoded here
// as test-local copies so no production change is needed to expose them).
const SCAFFOLDKIT_TIMEOUT_MS = 5 * 60_000;
const SCAFFOLDKIT_STDERR_MAX_BYTES = 4096;

/**
 * Minimal fake ChildProcess: EventEmitter + kill spy + inert Readable streams.
 * The `kill` spy sets `killed = true` so the timeout SIGKILL branch
 * (`if (!child.killed)`) correctly skips the second kill.
 */
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

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("runScaffoldkit subprocess lifecycle", () => {
  it("timeout watchdog SIGTERMs the child and resolves exitCode -1 with a timed-out stderr", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);

    vi.useFakeTimers();

    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
    });

    // Advance the fake clock past the watchdog threshold so the outer
    // setTimeout fires: timedOut = true, child.kill("SIGTERM") called.
    // The inner SIGKILL timer fires at SCAFFOLDKIT_TIMEOUT_MS + 5_000ms,
    // which is still in the future — it will not fire here.
    await vi.advanceTimersByTimeAsync(SCAFFOLDKIT_TIMEOUT_MS + 1);

    // Simulate the process exiting after receiving SIGTERM.
    child.emit("close", null, "SIGTERM");

    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/scaffoldkit timed out/);
  });

  it("AbortSignal propagation SIGTERMs the child when the caller disconnects", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const controller = new AbortController();

    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
      abortSignal: controller.signal,
    });

    // Abort fires the addEventListener("abort") handler synchronously:
    // onAbort() → child.kill("SIGTERM").
    controller.abort();

    // Simulate the process exiting after the kill.
    child.emit("close", 0, null);

    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    // timedOut is false; resolves with the exit code from the close event.
    expect(result.exitCode).toBe(0);
  });

  it("caps captured stderr at SCAFFOLDKIT_STDERR_MAX_BYTES", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
    });

    // Two chunks so the second one is what pushes the cumulative buffer
    // past the cap — exercises the incremental capping branch
    // (`stderr.length > SCAFFOLDKIT_STDERR_MAX_BYTES`) rather than a
    // single oversized write. Emitted directly on the fake Readable
    // (bypassing real stream buffering/encoding) so delivery is
    // synchronous and deterministic.
    child.stderr.emit("data", "a".repeat(SCAFFOLDKIT_STDERR_MAX_BYTES));
    child.stderr.emit("data", "b".repeat(2000));

    child.emit("close", 0, null);

    const result = await promise;

    expect(result.stderr).toHaveLength(SCAFFOLDKIT_STDERR_MAX_BYTES);
    expect(result.stderr).toBe("a".repeat(SCAFFOLDKIT_STDERR_MAX_BYTES));
  });

  it("caps captured multibyte stderr at SCAFFOLDKIT_STDERR_MAX_BYTES bytes, not code units", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
    });

    // "€" (EUR sign) is 1 UTF-16 code unit but 3 UTF-8 bytes. Emitting
    // enough of them to exceed the byte budget several times over would,
    // under a naive `stderr.length` cap, leave the captured stderr up to
    // ~3x SCAFFOLDKIT_STDERR_MAX_BYTES bytes long. A genuine byte cap must
    // truncate to at most SCAFFOLDKIT_STDERR_MAX_BYTES bytes.
    child.stderr.emit("data", "€".repeat(SCAFFOLDKIT_STDERR_MAX_BYTES));

    child.emit("close", 0, null);

    const result = await promise;

    const byteLength = Buffer.byteLength(result.stderr, "utf8");
    expect(byteLength).toBeLessThanOrEqual(SCAFFOLDKIT_STDERR_MAX_BYTES);
    // The naive (pre-fix) behavior would have kept the full
    // SCAFFOLDKIT_STDERR_MAX_BYTES code units, i.e. 3x as many bytes.
    expect(byteLength).toBeLessThan(SCAFFOLDKIT_STDERR_MAX_BYTES * 3);
  });

  it("child.on(\"error\") (spawn ENOENT) rejects the promise with the raw error", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const promise = runScaffoldkit({
      python: "/definitely/does/not/exist/python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
    });
    // Vitest would otherwise report an unhandled rejection between the
    // synchronous emit below and the `await expect(...).rejects` assertion.
    promise.catch(() => {});

    const enoentErr = Object.assign(
      new Error("spawn /definitely/does/not/exist/python3 ENOENT"),
      { code: "ENOENT" },
    );
    child.emit("error", enoentErr);

    await expect(promise).rejects.toMatchObject({
      code: "ENOENT",
      message: expect.stringContaining("ENOENT"),
    });
  });
});

describe("runGenerate — main CLI subprocess error handling", () => {
  it("surfaces a spawn ENOENT from the main CLI subprocess as an SSE `error` event", async () => {
    const child = fakeChild();
    const enoentErr = Object.assign(
      new Error("spawn /definitely/does/not/exist/node ENOENT"),
      { code: "ENOENT" },
    );
    // mkdtemp/writeFile (real fs) run before generate.ts calls spawn(), so
    // emit the error reactively once spawn is actually invoked rather than
    // racing a synchronous emit against those async fs ops. queueMicrotask
    // lands after the synchronous handler-registration code that follows
    // the spawn() call (attachLineReader, child.on("close"/"error")) but
    // before the generator suspends on its next `await`.
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", enoentErr));
      return child;
    });

    const events: GenerateEvent[] = [];
    for await (const ev of runGenerate(
      {},
      {
        planforgeRoot: "/tmp/does-not-matter",
        nodeBin: "/definitely/does/not/exist/node",
        scaffoldkitPython: "python3",
        scaffold: false,
      },
    )) {
      events.push(ev);
    }

    const errorEvents = events.filter((e) => e.type === "error");
    // Exactly 1: the spawn-error guard in generate.ts skips the exit-code
    // fallback once the child's own "error" event has already queued a real
    // error frame, so a failed spawn surfaces one error event, not two.
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.message).toMatch(/ENOENT/);
  });

  it("removes its own abort listener from opts.abortSignal once the generator completes normally", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockImplementation(() => {
      // Non-zero exit takes the early `exitCode !== 0` error-and-return
      // branch, which still runs the outer `finally`.
      queueMicrotask(() => child.emit("close", 1));
      return child;
    });

    const controller = new AbortController();

    const events: GenerateEvent[] = [];
    for await (const ev of runGenerate(
      {},
      {
        planforgeRoot: "/tmp/does-not-matter",
        nodeBin: "/definitely/does/not/exist/node",
        scaffoldkitPython: "python3",
        scaffold: false,
        abortSignal: controller.signal,
      },
    )) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === "error")).toBe(true);
    // The generator never aborted (once:true never fired), so only the
    // `finally` block's explicit removeEventListener call could have
    // cleared it. Before the fix, the finally block passed a fresh
    // anonymous function to removeEventListener, which is a no-op, and
    // this listener would still be registered here.
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    // Aborting afterwards must have no observable effect on the (already
    // exited) child: confirms the listener is really gone, not just
    // untracked by getEventListeners in this Node version.
    expect(() => controller.abort()).not.toThrow();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
