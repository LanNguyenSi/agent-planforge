/**
 * Real-process regression test for the scaffoldkit timeout escalation: a
 * child that ignores SIGTERM must still be killed (SIGKILL) after the grace
 * period. spawn is NOT mocked here (unlike generate.subprocess.test.ts), so
 * the test sees Node's real `child.killed` / `exitCode` / `signalCode`
 * semantics: `killed` flips as soon as SIGTERM is delivered, which is what
 * made a `!child.killed` guard on the SIGKILL step dead code.
 *
 * Only setTimeout/clearTimeout are faked, so the watchdog can be advanced
 * without waiting five minutes; everything else runs on the real clock.
 * The stub child is a plain node script, so there is no grandchild process.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScaffoldkit } from "../src/generate.js";

const SCAFFOLDKIT_TIMEOUT_MS = 5 * 60_000;
const SIGKILL_GRACE_MS = 5_000;

let workDir: string | undefined;
let childPid: number | undefined;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.useRealTimers();
  // Safety net: never leave the SIGTERM-ignoring child behind, even when
  // an assertion above failed.
  if (childPid !== undefined && pidAlive(childPid)) {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  childPid = undefined;
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
});

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path) || readFileSync(path, "utf8").length === 0) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("runScaffoldkit timeout against a real child that ignores SIGTERM", () => {
  it("escalates to SIGKILL and resolves exitCode -1", async () => {
    workDir = mkdtempSync(join(tmpdir(), "scaffoldkit-sigkill-"));
    const stub = join(workDir, "python3");
    // The stub is spawned as `python3 -m scaffoldkit.cli ...` with cwd = outdir:
    // it ignores SIGTERM, records its pid once the handler is installed, and
    // idles. A bounded self-exit keeps it from outliving a failed run.
    writeFileSync(
      stub,
      [
        `#!${process.execPath}`,
        `process.on("SIGTERM", () => {});`,
        `require("node:fs").writeFileSync("child.pid", String(process.pid));`,
        `setTimeout(() => process.exit(0), 60000);`,
        "",
      ].join("\n"),
    );
    chmodSync(stub, 0o755);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const promise = runScaffoldkit({
      python: stub,
      inputPath: join(workDir, "input.json"),
      outdir: workDir,
    });
    // A regression leaves the child alive and the promise pending: bound the
    // wait with a real-clock deadline (setImmediate is not faked) so the test
    // fails instead of hanging.
    const guarded = Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        const start = Date.now();
        const tick = () =>
          Date.now() - start > 20_000
            ? reject(new Error("scaffoldkit child was never killed"))
            : setImmediate(tick);
        setImmediate(tick);
      }),
    ]);
    guarded.catch(() => {});

    const pidFile = join(workDir, "child.pid");
    await waitForFile(pidFile);
    childPid = Number(readFileSync(pidFile, "utf8"));
    expect(pidAlive(childPid)).toBe(true);

    // Watchdog fires: SIGTERM is ignored, so the child must still be alive.
    await vi.advanceTimersByTimeAsync(SCAFFOLDKIT_TIMEOUT_MS + 1);
    expect(pidAlive(childPid)).toBe(true);

    // Grace period elapses: SIGKILL must end it.
    await vi.advanceTimersByTimeAsync(SIGKILL_GRACE_MS);
    const result = await guarded;

    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toMatch(/scaffoldkit timed out/);
    expect(result.stderr).toMatch(/SIGKILL/);
    expect(pidAlive(childPid)).toBe(false);
  }, 30_000);
});
