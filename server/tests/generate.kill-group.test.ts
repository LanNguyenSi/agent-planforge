/**
 * Unit tests for how `terminateChild` signals a subprocess (reached through
 * `runScaffoldkit`, the smallest caller that exposes it):
 *
 *   1. the process group led by the child's pid gets the signal, and the
 *      direct child is left alone when the group kill worked;
 *   2. a group kill that fails (ESRCH / EPERM) or a child with no usable pid
 *      falls back to signalling the direct child only;
 *   3. the SIGTERM-to-SIGKILL escalation also goes to the group, and repeated
 *      termination requests neither re-signal nor stack a second SIGKILL timer.
 *
 * `spawn` is mocked (file-scoped) so the child is a controllable fake;
 * `process.kill` is spied on, never really aimed at a pid.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import { runScaffoldkit } from "../src/generate.js";

const SCAFFOLDKIT_TIMEOUT_MS = 5 * 60_000;
const FAKE_PID = 4242;

/**
 * Minimal fake ChildProcess. `killedOnKill` mirrors the real object: Node sets
 * `killed` when a signal is delivered through `child.kill`. Pass false to
 * model the group path, which signals through `process.kill` and therefore
 * leaves `killed` false even after SIGTERM.
 */
function fakeChild(opts: { pid?: number | undefined; killedOnKill?: boolean } = {}) {
  const c = new EventEmitter() as any;
  c.pid = opts.pid;
  c.killed = false;
  c.exitCode = null;
  c.signalCode = null;
  const killedOnKill = opts.killedOnKill ?? true;
  c.kill = vi.fn(() => {
    if (killedOnKill) c.killed = true;
    return true;
  });
  c.stderr = new Readable({ read() {} });
  c.stderr.setEncoding = () => {};
  return c;
}

/** Group-target pids (negative) the spy saw, in call order. */
function groupTargets(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls.map(([target]) => target).filter((t) => typeof t === "number" && t < 0);
}

function throwingErrno(code: string): () => never {
  return () => {
    throw Object.assign(new Error(`kill ${code}`), { code });
  };
}

let killSpy: ReturnType<typeof vi.spyOn> | undefined;

function spyOnProcessKill(impl?: (target: number, signal?: string) => void) {
  killSpy = vi.spyOn(process, "kill").mockImplementation(
    (impl ?? (() => {})) as never,
  );
  return killSpy;
}

/**
 * A pid that must never become a negative target (undefined after a failed
 * spawn, 0 meaning "the caller's own process group"): the guard has to keep
 * `process.kill` out of the picture entirely and signal the direct child.
 */
async function expectNoGroupSignal(childOpts: { pid?: number | undefined }) {
  const child = fakeChild(childOpts);
  vi.mocked(spawn).mockReturnValue(child);
  const spy = spyOnProcessKill();

  const controller = new AbortController();
  const promise = runScaffoldkit({
    python: "python3",
    inputPath: "/tmp/input.json",
    outdir: "/tmp/out",
    abortSignal: controller.signal,
  });
  controller.abort();
  child.emit("close", null, "SIGTERM");
  await promise;

  expect(spy.mock.calls).toEqual([]);
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
}

afterEach(() => {
  killSpy?.mockRestore();
  killSpy = undefined;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("terminateChild signals the process group", () => {
  it("sends SIGTERM to -pid and does not also signal the direct child", async () => {
    const child = fakeChild({ pid: FAKE_PID });
    vi.mocked(spawn).mockReturnValue(child);
    const spy = spyOnProcessKill();

    const controller = new AbortController();
    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
      abortSignal: controller.signal,
    });
    controller.abort();
    child.emit("close", null, "SIGTERM");
    await promise;

    expect(groupTargets(spy)).toEqual([-FAKE_PID]);
    expect(spy).toHaveBeenCalledWith(-FAKE_PID, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("escalates the group to SIGKILL after the grace period", async () => {
    const child = fakeChild({ pid: FAKE_PID });
    vi.mocked(spawn).mockReturnValue(child);
    const spy = spyOnProcessKill();

    vi.useFakeTimers();
    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
      killGraceMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(SCAFFOLDKIT_TIMEOUT_MS + 1);
    expect(spy).toHaveBeenCalledWith(-FAKE_PID, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(spy).toHaveBeenCalledWith(-FAKE_PID, "SIGKILL");
    expect(groupTargets(spy)).toEqual([-FAKE_PID, -FAKE_PID]);

    child.emit("close", null, "SIGKILL");
    await promise;
  });

  it.each(["ESRCH", "EPERM"] as const)(
    "falls back to child.kill when the group kill throws %s",
    async (code) => {
      const child = fakeChild({ pid: FAKE_PID });
      vi.mocked(spawn).mockReturnValue(child);
      const spy = spyOnProcessKill(throwingErrno(code));

      const controller = new AbortController();
      const promise = runScaffoldkit({
        python: "python3",
        inputPath: "/tmp/input.json",
        outdir: "/tmp/out",
        abortSignal: controller.signal,
      });
      controller.abort();
      child.emit("close", null, "SIGTERM");
      await promise;

      expect(groupTargets(spy)).toEqual([-FAKE_PID]);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    },
  );

  it("signals only the direct child when the spawn produced no pid", async () => {
    await expectNoGroupSignal({ pid: undefined });
  });

  it("signals only the direct child for a non-positive pid", async () => {
    // process.kill(-0) means "the caller's own process group", so a pid of 0
    // must never reach it either.
    await expectNoGroupSignal({ pid: 0 });
  });

  it("a second termination request neither re-signals nor stacks a second SIGKILL", async () => {
    // killedOnKill false: the group path never calls child.kill, so `killed`
    // cannot be what stops the second request.
    const child = fakeChild({ pid: FAKE_PID, killedOnKill: false });
    vi.mocked(spawn).mockReturnValue(child);
    const spy = spyOnProcessKill();

    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = runScaffoldkit({
      python: "python3",
      inputPath: "/tmp/input.json",
      outdir: "/tmp/out",
      killGraceMs: 5_000,
      abortSignal: controller.signal,
    });

    // Watchdog terminates the child, then the client disconnects and asks
    // again while the child is still running.
    await vi.advanceTimersByTimeAsync(SCAFFOLDKIT_TIMEOUT_MS + 1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(groupTargets(spy)).toEqual([-FAKE_PID, -FAKE_PID]);
    expect(child.kill).not.toHaveBeenCalled();

    child.emit("close", null, "SIGKILL");
    await promise;
  });
});
