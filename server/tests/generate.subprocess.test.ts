/**
 * Unit tests for the runScaffoldkit subprocess lifecycle:
 *   - Gap 1: timeout watchdog fires SIGTERM and resolves { exitCode: -1 }
 *   - Gap 2: AbortSignal propagation kills the child with SIGTERM
 *
 * spawn is the ONLY thing mocked here; execFile (used by tarDir) stays real.
 * This mock is file-scoped in vitest and does NOT affect routes.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

// Imported after vi.mock so generate.ts receives the mocked spawn.
import { runScaffoldkit } from "../src/generate.js";

// Mirror the module constant (not exported from generate.ts; hardcoded here
// as a test-local copy so no production change is needed to expose it).
const SCAFFOLDKIT_TIMEOUT_MS = 5 * 60_000;

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
});
