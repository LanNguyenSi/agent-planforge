/**
 * Real-process tests for the process-group kill path in `terminateChild`.
 *
 * The CLI subprocess is spawned `detached` and signalled as a group
 * (`process.kill(-pid, sig)`), because a grandchild that inherited the
 * stdout/stderr pipe keeps the service's read end open after the direct child
 * is gone: the run's `close` event never arrives, and the wall-clock bound on
 * a generate run stops holding. Every fixture here spawns exactly such a
 * grandchild and records both pids in files, so the assertions can ask whether
 * the grandchild is really gone (`process.kill(pid, 0)` throwing ESRCH).
 *
 * Two shapes of fixture matter, and they cover different bugs:
 *   - `ignoreSigterm: true`: the whole tree ignores SIGTERM, so only the
 *     SIGKILL half of the escalation can end it;
 *   - `grandchildIgnoresSigterm: true`: the DIRECT child dies on SIGTERM while
 *     the grandchild ignores it. A post-grace SIGKILL gated on the direct
 *     child still running would then never be sent and the run would hang,
 *     which is what the close-gated escalation is for.
 *
 * Each test carries its own timeout, well below vitest's default: regressing
 * the kill does not fail an assertion, it hangs the run on the still-open pipe,
 * so the timeout is what makes that regression visible. `afterEach` reads the
 * fixture's pid files back (it does not rely on the test having recorded the
 * pids, which a timed-out test never does) and SIGKILLs each pid and its group,
 * so no test can leave a process behind.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runGenerate, runScaffoldkit, type GenerateEvent, type GenerateOptions } from "../src/generate.js";

const GRACE_MS = 300;
// Wall-clock bound for the timeout trigger: short enough to keep the suite
// quick, long enough for the stub node process to reach its grandchild spawn.
const CLI_BOUND_MS = 2_000;
// Generous margin over the grace for slow CI; still far below the 60s
// self-exit every stub arms itself with, so a regression cannot leak a process.
const MARGIN_MS = 5_000;
// Own timeout for the tests whose trigger is a timer or a disconnect and whose
// legit run needs ~2s: a regression hangs on the still-open pipe, so this fails
// one in ~12s instead of waiting out vitest's default per-file budget.
const TEST_TIMEOUT_MS = 12_000;
// Shorter timeout for the close-gated escalation tests: the legit runs end
// within the bound + grace + a few hundred ms, so a regression that leaves the
// group alive (and the run with it) is reported in ~8s.
const GATED_KILL_TIMEOUT_MS = 8_000;

let currentFixture: Fixture | undefined;
const trackedPids = new Set<number>();

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Poll until the pid is gone; false when it never dies within the deadline. */
async function waitGone(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (pidAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
}

async function readPidFile(path: string, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path) || readFileSync(path, "utf8").length === 0) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return Number(readFileSync(path, "utf8"));
}

/**
 * The pid must be unreapable: `process.kill(pid, 0)` reports ESRCH, so the
 * process is gone rather than merely stopped or about to be reaped.
 */
function expectEsrch(pid: number): void {
  let code: string | undefined;
  try {
    process.kill(pid, 0);
  } catch (err) {
    code = (err as NodeJS.ErrnoException).code;
  }
  expect(code).toBe("ESRCH");
}

/** SIGKILL a pid and the group it leads; both are already-gone-safe. */
function killTree(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

interface Fixture {
  planforgeRoot: string;
  childPidFile: string;
  grandchildPidFile: string;
}

interface FixtureOptions {
  /** Install the SIGTERM-ignoring handler on BOTH processes. */
  ignoreSigterm: boolean;
  /** Install it on the grandchild only: the direct child then dies on SIGTERM. */
  grandchildIgnoresSigterm?: boolean;
  /**
   * Let the direct child exit as soon as it has spawned the grandchild, so the
   * run is already waiting on the grandchild's pipe before anything signals it.
   */
  childExitsImmediately?: boolean;
}

const IGNORE_SIGTERM = 'process.on("SIGTERM", () => {});\n';
// Bounded idle: a regression must not leave a process running behind.
const IDLE = "setTimeout(() => process.exit(0), 60000);\n";

function sigtermHandler(applies: boolean): string {
  return applies ? IGNORE_SIGTERM : "";
}

/**
 * Builds a planforge root whose `scripts/bootstrap-plan.js` is a stub CLI: it
 * spawns a grandchild with `stdio: "inherit"` (so the grandchild holds the very
 * stdout pipe the service reads), records both pids, and idles. The pid paths
 * are baked into the generated scripts: the CLI child env is allow-listed, so
 * an env var would not reach the stub.
 *
 * Which process ignores SIGTERM is what each shape tests: `ignoreSigterm` covers
 * the whole tree, so only the SIGKILL half of the escalation can end it;
 * `grandchildIgnoresSigterm` leaves the direct child to die on SIGTERM, so a
 * SIGKILL that were still gated on the direct child having exited would never
 * reach the grandchild.
 */
function makeFixture(name: string, opts: FixtureOptions): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `process-group-${name}-`));
  const scripts = join(dir, "scripts");
  mkdirSync(scripts, { recursive: true });
  const childPidFile = join(dir, "child.pid");
  const grandchildPidFile = join(dir, "grandchild.pid");
  const grandchildScript = join(dir, "grandchild.js");

  writeFileSync(
    grandchildScript,
    sigtermHandler(opts.ignoreSigterm || !!opts.grandchildIgnoresSigterm) +
      `require("node:fs").writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid));\n` +
      'console.log("grandchild: holding the inherited stdout pipe open");\n' +
      IDLE,
  );

  writeFileSync(
    join(scripts, "bootstrap-plan.js"),
    sigtermHandler(opts.ignoreSigterm) +
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: ["ignore", "inherit", "inherit"] });\n` +
      `require("node:fs").writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));\n` +
      'console.log("stub cli: grandchild spawned");\n' +
      (opts.childExitsImmediately ? "process.exit(0);\n" : IDLE),
  );
  chmodSync(join(scripts, "bootstrap-plan.js"), 0o755);

  currentFixture = { planforgeRoot: dir, childPidFile, grandchildPidFile };
  return currentFixture;
}

function generateOptions(
  fixture: Fixture,
  extra: Partial<GenerateOptions> = {},
): GenerateOptions {
  return {
    planforgeRoot: fixture.planforgeRoot,
    nodeBin: process.execPath,
    scaffoldkitPython: "unused",
    scaffold: false,
    killGraceMs: GRACE_MS,
    ...extra,
  };
}

/**
 * A `python3` stub for `runScaffoldkit`: spawns a grandchild that inherits the
 * captured stderr pipe, records both pids, idles. Same pipe-holding problem as
 * the CLI child, on the scaffoldkit side of the module, with the same
 * who-ignores-SIGTERM options (see makeFixture).
 */
function makeScaffoldkitFixture(opts: FixtureOptions): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "process-group-scaffoldkit-"));
  const childPidFile = join(dir, "child.pid");
  const grandchildPidFile = join(dir, "grandchild.pid");
  const grandchildScript = join(dir, "grandchild.js");

  writeFileSync(
    grandchildScript,
    sigtermHandler(opts.ignoreSigterm || !!opts.grandchildIgnoresSigterm) +
      `require("node:fs").writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid));\n` +
      IDLE,
  );

  const stub = join(dir, "python3");
  writeFileSync(
    stub,
    `#!${process.execPath}\n` +
      sigtermHandler(opts.ignoreSigterm) +
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: ["ignore", "ignore", "inherit"] });\n` +
      `require("node:fs").writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));\n` +
      IDLE,
  );
  chmodSync(stub, 0o755);

  currentFixture = { planforgeRoot: dir, childPidFile, grandchildPidFile };
  return currentFixture;
}

afterEach(() => {
  // The fixture's pid files, not the test body, are the authority on which
  // processes exist: a test that times out never reaches the point where it
  // records the pids it wanted cleaned up, and a hanging regression is exactly
  // the case that must not leave a tree running.
  if (currentFixture) {
    for (const pidFile of [currentFixture.childPidFile, currentFixture.grandchildPidFile]) {
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8").trim());
        if (Number.isInteger(pid) && pid > 0) killTree(pid);
      }
    }
  }
  for (const pid of trackedPids) killTree(pid);
  trackedPids.clear();
  if (currentFixture) rmSync(currentFixture.planforgeRoot, { recursive: true, force: true });
  currentFixture = undefined;
});

describe("CLI timeout reaches the whole process group", () => {
  it(
    "ends the run within the bound and leaves no grandchild holding the stdout pipe",
    async () => {
      const fixture = makeFixture("timeout", { ignoreSigterm: false });
      const events: GenerateEvent[] = [];
      const t0 = Date.now();
      for await (const ev of runGenerate(
        { name: "x" },
        generateOptions(fixture, { cliTimeoutMs: CLI_BOUND_MS }),
      )) {
        events.push(ev);
      }
      const elapsed = Date.now() - t0;

      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(grandchildPid);

      const last = events.at(-1)!;
      expect(last.type).toBe("error");
      expect(last.message).toMatch(new RegExp(`planforge CLI timed out after ${CLI_BOUND_MS}ms`));
      // The bound holds: SIGTERM at the bound, no need to wait for the grace.
      expect(elapsed).toBeGreaterThanOrEqual(CLI_BOUND_MS - 50);
      expect(elapsed).toBeLessThan(CLI_BOUND_MS + MARGIN_MS);
      expect(await waitGone(grandchildPid)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("abort escalates the whole process group to SIGKILL", () => {
  it(
    "kills a child and a grandchild that both ignore SIGTERM, after the grace",
    async () => {
      const fixture = makeFixture("abort", { ignoreSigterm: true });
      const ac = new AbortController();
      const events: GenerateEvent[] = [];
      const drain = (async () => {
        for await (const ev of runGenerate(
          { name: "x" },
          generateOptions(fixture, { abortSignal: ac.signal }),
        )) {
          events.push(ev);
        }
      })();

      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      const childPid = await readPidFile(fixture.childPidFile);
      trackedPids.add(grandchildPid);
      trackedPids.add(childPid);
      expect(pidAlive(grandchildPid)).toBe(true);

      const t0 = Date.now();
      ac.abort();
      await drain;
      const elapsed = Date.now() - t0;

      // Both processes ignored SIGTERM, so only the post-grace SIGKILL to the
      // group can have ended them.
      expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
      expect(elapsed).toBeLessThan(GRACE_MS + MARGIN_MS);
      expect(await waitGone(childPid)).toBe(true);
      expect(await waitGone(grandchildPid)).toBe(true);
      expect(events.at(-1)?.type).toBe("error");
    },
    TEST_TIMEOUT_MS,
  );
});

describe("scaffoldkit abort reaches the whole process group", () => {
  it(
    "ends the scaffold run and leaves no grandchild holding the captured stderr pipe",
    async () => {
      const fixture = makeScaffoldkitFixture({ ignoreSigterm: false });
      const ac = new AbortController();
      const promise = runScaffoldkit({
        python: join(fixture.planforgeRoot, "python3"),
        inputPath: join(fixture.planforgeRoot, "input.json"),
        outdir: fixture.planforgeRoot,
        abortSignal: ac.signal,
        killGraceMs: GRACE_MS,
      });

      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(grandchildPid);
      expect(pidAlive(grandchildPid)).toBe(true);

      const t0 = Date.now();
      ac.abort();
      await promise;

      // 'close' (so this promise) only settles once the grandchild stopped
      // holding the pipe, which is the whole point of the group kill.
      expect(Date.now() - t0).toBeLessThan(GRACE_MS + MARGIN_MS);
      expect(await waitGone(grandchildPid)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("abort reaches a grandchild that ignores SIGTERM after the direct child died on it", () => {
  it(
    "ends the run after the grace and leaves no grandchild holding the stdout pipe",
    async () => {
      const fixture = makeFixture("abort-grandchild-only", {
        ignoreSigterm: false,
        grandchildIgnoresSigterm: true,
      });
      const ac = new AbortController();
      const events: GenerateEvent[] = [];
      const drain = (async () => {
        for await (const ev of runGenerate(
          { name: "x" },
          generateOptions(fixture, { abortSignal: ac.signal }),
        )) {
          events.push(ev);
        }
      })();

      const childPid = await readPidFile(fixture.childPidFile);
      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(childPid);
      trackedPids.add(grandchildPid);
      expect(pidAlive(grandchildPid)).toBe(true);

      const t0 = Date.now();
      ac.abort();
      await drain;
      const elapsed = Date.now() - t0;

      // The direct child died on SIGTERM (node's default), so the run could only
      // end once the post-grace SIGKILL reached the grandchild that ignored it:
      // a gate on the direct child having exited would never send it.
      expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
      expect(elapsed).toBeLessThan(GRACE_MS + MARGIN_MS);
      expect(await waitGone(childPid)).toBe(true);
      expect(await waitGone(grandchildPid)).toBe(true);
      expectEsrch(grandchildPid);
      expect(events.at(-1)?.type).toBe("error");
    },
    GATED_KILL_TIMEOUT_MS,
  );
});

describe("CLI timeout reaches a grandchild that ignores SIGTERM after the direct child died on it", () => {
  it(
    "ends the run at the bound plus the grace and leaves no grandchild holding the stdout pipe",
    async () => {
      const fixture = makeFixture("timeout-grandchild-only", {
        ignoreSigterm: false,
        grandchildIgnoresSigterm: true,
      });
      const events: GenerateEvent[] = [];
      const t0 = Date.now();
      for await (const ev of runGenerate(
        { name: "x" },
        generateOptions(fixture, { cliTimeoutMs: CLI_BOUND_MS }),
      )) {
        events.push(ev);
      }
      const elapsed = Date.now() - t0;

      const childPid = await readPidFile(fixture.childPidFile);
      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(childPid);
      trackedPids.add(grandchildPid);

      const last = events.at(-1)!;
      expect(last.type).toBe("error");
      expect(last.message).toMatch(new RegExp(`planforge CLI timed out after ${CLI_BOUND_MS}ms`));
      // SIGTERM at the bound ended the direct child; the grandchild only went
      // with the close-gated SIGKILL, one grace later.
      expect(elapsed).toBeGreaterThanOrEqual(CLI_BOUND_MS + GRACE_MS - 50);
      expect(elapsed).toBeLessThan(CLI_BOUND_MS + GRACE_MS + MARGIN_MS);
      expect(await waitGone(grandchildPid)).toBe(true);
      expectEsrch(grandchildPid);
    },
    GATED_KILL_TIMEOUT_MS,
  );
});

describe("scaffoldkit abort reaches a grandchild that ignores SIGTERM after the direct child died on it", () => {
  it(
    "ends the scaffold run after the grace and leaves no grandchild holding the stderr pipe",
    async () => {
      const fixture = makeScaffoldkitFixture({
        ignoreSigterm: false,
        grandchildIgnoresSigterm: true,
      });
      const ac = new AbortController();
      const promise = runScaffoldkit({
        python: join(fixture.planforgeRoot, "python3"),
        inputPath: join(fixture.planforgeRoot, "input.json"),
        outdir: fixture.planforgeRoot,
        abortSignal: ac.signal,
        killGraceMs: GRACE_MS,
      });

      const childPid = await readPidFile(fixture.childPidFile);
      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(childPid);
      trackedPids.add(grandchildPid);
      expect(pidAlive(grandchildPid)).toBe(true);

      const t0 = Date.now();
      ac.abort();
      const result = await promise;
      const elapsed = Date.now() - t0;

      // Same on the scaffoldkit side: the promise resolves on `close`, which
      // only arrives once the group is gone.
      expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
      expect(elapsed).toBeLessThan(GRACE_MS + MARGIN_MS);
      expect(result.exitCode).toBe(-1);
      expect(await waitGone(childPid)).toBe(true);
      expect(await waitGone(grandchildPid)).toBe(true);
      expectEsrch(grandchildPid);
    },
    GATED_KILL_TIMEOUT_MS,
  );
});

describe("termination requested after the direct child is already gone", () => {
  it(
    "still takes down the grandchild that holds the pipe open and ignores SIGTERM",
    async () => {
      const fixture = makeFixture("child-already-gone", {
        ignoreSigterm: false,
        grandchildIgnoresSigterm: true,
        childExitsImmediately: true,
      });
      const ac = new AbortController();
      const events: GenerateEvent[] = [];
      const drain = (async () => {
        for await (const ev of runGenerate(
          { name: "x" },
          generateOptions(fixture, { abortSignal: ac.signal }),
        )) {
          events.push(ev);
        }
      })();

      const childPid = await readPidFile(fixture.childPidFile);
      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(childPid);
      trackedPids.add(grandchildPid);
      // The run is already stuck on the grandchild's pipe with the direct child
      // dead: an escalation gated on the direct child would find nothing to do.
      expect(await waitGone(childPid)).toBe(true);
      expect(pidAlive(grandchildPid)).toBe(true);

      const t0 = Date.now();
      ac.abort();
      await drain;
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
      expect(elapsed).toBeLessThan(GRACE_MS + MARGIN_MS);
      expect(await waitGone(grandchildPid)).toBe(true);
      expectEsrch(grandchildPid);
      expect(events.at(-1)?.type).toBe("error");
    },
    GATED_KILL_TIMEOUT_MS,
  );
});

describe("detached children do not outlive the service", () => {
  it(
    "a service process that exits normally takes the CLI child and its grandchild with it",
    async () => {
      const fixture = makeFixture("exit", { ignoreSigterm: false });
      const serverDir = resolve(import.meta.dirname, "..");
      // Stands in for the HTTP service: starts one generate run, then exits
      // normally on a timer (what index.ts's shutdown path ends up doing with
      // process.exit). It kills no children by hand.
      const serviceEntry = join(fixture.planforgeRoot, "service.mjs");
      writeFileSync(
        serviceEntry,
        [
          `import { runGenerate } from ${JSON.stringify(join(serverDir, "src", "generate.ts"))};`,
          "const opts = {",
          `  planforgeRoot: ${JSON.stringify(fixture.planforgeRoot)},`,
          `  nodeBin: ${JSON.stringify(process.execPath)},`,
          '  scaffoldkitPython: "unused",',
          "  scaffold: false,",
          "};",
          "setTimeout(() => process.exit(0), 3000);",
          "for await (const ev of runGenerate({ name: 'x' }, opts)) { void ev; }",
          "",
        ].join("\n"),
      );

      const service = spawn(process.execPath, ["--import", "tsx", serviceEntry], {
        cwd: serverDir,
        stdio: ["ignore", "ignore", "ignore"],
      });
      const exited = await new Promise<boolean>((r) => {
        service.on("exit", () => r(true));
        setTimeout(() => r(false), 9_000);
      });
      expect(exited).toBe(true);

      const childPid = await readPidFile(fixture.childPidFile);
      const grandchildPid = await readPidFile(fixture.grandchildPidFile);
      trackedPids.add(childPid);
      trackedPids.add(grandchildPid);
      expect(await waitGone(childPid)).toBe(true);
      expect(await waitGone(grandchildPid)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
