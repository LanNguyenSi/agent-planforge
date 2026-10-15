/**
 * Real-process tests for the abort and CLI-timeout kill paths: a child that
 * ignores SIGTERM must still be gone shortly after the (injected, short)
 * grace. spawn is NOT mocked, so Node's real `killed` / `exitCode` /
 * `signalCode` semantics apply. Everything runs on the real clock with a
 * grace of a few hundred ms; each test is bounded by a vitest timeout and
 * the stub also exits on its own after 60s so a regression cannot leak it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGenerate, runScaffoldkit, type GenerateEvent } from "../src/generate.js";

const GRACE_MS = 300;
// Generous margin over the grace for slow CI; still far below the 60s
// self-exit of the stub.
const MARGIN_MS = 5_000;
// Long enough for the node stub to install its SIGTERM handler first.
const CLI_BOUND_MS = 2_000;

let workDir: string | undefined;
let pidFile: string | undefined;
let childPid: number | undefined;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

afterEach(() => {
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
  pidFile = undefined;
});

/** Executable stub: ignores SIGTERM, records its pid, idles (bounded). */
function makeStub(name: string): string {
  workDir = mkdtempSync(join(tmpdir(), "abort-sigkill-"));
  pidFile = join(workDir, "child.pid");
  const stub = join(workDir, name);
  writeFileSync(
    stub,
    [
      `#!${process.execPath}`,
      `process.on("SIGTERM", () => {});`,
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      `setTimeout(() => process.exit(0), 60000);`,
      "",
    ].join("\n"),
  );
  chmodSync(stub, 0o755);
  return stub;
}

async function readPid(): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(pidFile!) || readFileSync(pidFile!, "utf8").length === 0) {
    if (Date.now() > deadline) throw new Error("stub never recorded its pid");
    await new Promise((r) => setTimeout(r, 10));
  }
  childPid = Number(readFileSync(pidFile!, "utf8"));
  return childPid;
}

describe("abort escalates to SIGKILL for a child that ignores SIGTERM", () => {
  it("runScaffoldkit: killed within grace + margin, no leftover pid", async () => {
    const stub = makeStub("python3");
    const ac = new AbortController();
    const promise = runScaffoldkit({
      python: stub,
      inputPath: join(workDir!, "input.json"),
      outdir: workDir!,
      abortSignal: ac.signal,
      killGraceMs: GRACE_MS,
    });
    const pid = await readPid();
    expect(pidAlive(pid)).toBe(true);

    const t0 = Date.now();
    ac.abort();
    const result = await promise;
    const elapsed = Date.now() - t0;

    expect(result.exitCode).toBe(-1);
    expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
    expect(elapsed).toBeLessThan(GRACE_MS + MARGIN_MS);
    expect(pidAlive(pid)).toBe(false);
  }, 30_000);

  it("runGenerate: CLI child killed within grace + margin after abort, no leftover pid", async () => {
    const stub = makeStub("node-stub");
    const ac = new AbortController();
    const events: GenerateEvent[] = [];
    const t0Holder = { t0: 0 };
    const drain = (async () => {
      for await (const ev of runGenerate(
        { name: "x" },
        {
          planforgeRoot: workDir!,
          nodeBin: stub,
          scaffoldkitPython: "unused",
          scaffold: false,
          abortSignal: ac.signal,
          killGraceMs: GRACE_MS,
        },
      )) {
        events.push(ev);
      }
    })();
    const pid = await readPid();
    expect(pidAlive(pid)).toBe(true);

    t0Holder.t0 = Date.now();
    ac.abort();
    await drain;
    const elapsed = Date.now() - t0Holder.t0;

    expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
    expect(elapsed).toBeLessThan(GRACE_MS + MARGIN_MS);
    expect(pidAlive(pid)).toBe(false);
    expect(events.at(-1)?.type).toBe("error");
  }, 30_000);
});

describe("CLI subprocess wall-clock bound", () => {
  it("ends a hung CLI with a timeout error and kills it even when it ignores SIGTERM", async () => {
    const stub = makeStub("node-stub");
    const events: GenerateEvent[] = [];
    const t0 = Date.now();
    for await (const ev of runGenerate(
      { name: "x" },
      {
        planforgeRoot: workDir!,
        nodeBin: stub,
        scaffoldkitPython: "unused",
        scaffold: false,
        cliTimeoutMs: CLI_BOUND_MS,
        killGraceMs: GRACE_MS,
      },
    )) {
      events.push(ev);
    }
    const elapsed = Date.now() - t0;
    const pid = await readPid();

    const last = events.at(-1)!;
    expect(last.type).toBe("error");
    expect(last.message).toMatch(new RegExp(`planforge CLI timed out after ${CLI_BOUND_MS}ms`));
    expect(elapsed).toBeGreaterThanOrEqual(CLI_BOUND_MS + GRACE_MS - 50);
    expect(elapsed).toBeLessThan(CLI_BOUND_MS + GRACE_MS + MARGIN_MS);
    expect(pidAlive(pid)).toBe(false);
  }, 30_000);
});
