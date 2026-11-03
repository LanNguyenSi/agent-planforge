/**
 * Real-process tests for the process-group kill path in `terminateChild`.
 *
 * The CLI subprocess is spawned `detached` and signalled as a group
 * (`process.kill(-pid, sig)`), because a grandchild that inherited the
 * stdout/stderr pipe keeps the service's read end open after the direct child
 * is gone: the run's `close` event never arrives, and the wall-clock bound on
 * a generate run stops holding. Every fixture here spawns exactly such a
 * grandchild and records its pid, so the assertions can ask whether the
 * grandchild is really gone (`process.kill(pid, 0)` throwing ESRCH).
 *
 * Each test also carries its own timeout, well below vitest's default:
 * regressing to a direct-child-only kill does not fail an assertion, it hangs
 * the run on the still-open pipe, so the timeout is what makes that
 * regression visible.
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
// Own timeout for every test: a regression hangs on the still-open pipe, and
// the legit runs need ~2s, so this fails a regression in ~12s instead of
// waiting out vitest's default per-file budget.
const TEST_TIMEOUT_MS = 12_000;

let workDir: string | undefined;
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

interface Fixture {
  planforgeRoot: string;
  childPidFile: string;
  grandchildPidFile: string;
}

/**
 * Builds a planforge root whose `scripts/bootstrap-plan.js` is a stub CLI: it
 * spawns a grandchild with `stdio: "inherit"` (so the grandchild holds the very
 * stdout pipe the service reads), records both pids, and idles. The pid paths
 * are baked into the generated scripts: the CLI child env is allow-listed, so
 * an env var would not reach the stub.
 *
 * `ignoreSigterm` applies to both processes. With it set, only the SIGKILL half
 * of the escalation can end the tree, which is what proves the escalation
 * reaches the grandchild rather than only the direct child.
 */
function makeFixture(name: string, opts: { ignoreSigterm: boolean }): Fixture {
  workDir = mkdtempSync(join(tmpdir(), `process-group-${name}-`));
  const scripts = join(workDir, "scripts");
  mkdirSync(scripts, { recursive: true });
  const childPidFile = join(workDir, "child.pid");
  const grandchildPidFile = join(workDir, "grandchild.pid");
  const grandchildScript = join(workDir, "grandchild.js");
  const ignoreSigterm = opts.ignoreSigterm ? 'process.on("SIGTERM", () => {});\n' : "";
  // Bounded idle: a regression must not leave a process running behind.
  const idle = "setTimeout(() => process.exit(0), 60000);\n";

  writeFileSync(
    grandchildScript,
    ignoreSigterm +
      `require("node:fs").writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid));\n` +
      'console.log("grandchild: holding the inherited stdout pipe open");\n' +
      idle,
  );

  writeFileSync(
    join(scripts, "bootstrap-plan.js"),
    ignoreSigterm +
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: ["ignore", "inherit", "inherit"] });\n` +
      `require("node:fs").writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));\n` +
      'console.log("stub cli: grandchild spawned");\n' +
      idle,
  );
  chmodSync(join(scripts, "bootstrap-plan.js"), 0o755);

  return { planforgeRoot: workDir, childPidFile, grandchildPidFile };
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
 * the CLI child, on the scaffoldkit side of the module.
 */
function makeScaffoldkitFixture(opts: { ignoreSigterm: boolean }): Fixture {
  workDir = mkdtempSync(join(tmpdir(), "process-group-scaffoldkit-"));
  const childPidFile = join(workDir, "child.pid");
  const grandchildPidFile = join(workDir, "grandchild.pid");
  const grandchildScript = join(workDir, "grandchild.js");
  const ignoreSigterm = opts.ignoreSigterm ? 'process.on("SIGTERM", () => {});\n' : "";
  const idle = "setTimeout(() => process.exit(0), 60000);\n";

  writeFileSync(
    grandchildScript,
    ignoreSigterm +
      `require("node:fs").writeFileSync(${JSON.stringify(grandchildPidFile)}, String(process.pid));\n` +
      idle,
  );

  const stub = join(workDir, "python3");
  writeFileSync(
    stub,
    `#!${process.execPath}\n` +
      ignoreSigterm +
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: ["ignore", "ignore", "inherit"] });\n` +
      `require("node:fs").writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));\n` +
      idle,
  );
  chmodSync(stub, 0o755);

  return { planforgeRoot: workDir, childPidFile, grandchildPidFile };
}

afterEach(() => {
  for (const pid of trackedPids) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  trackedPids.clear();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  workDir = undefined;
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

describe("detached children do not outlive the service", () => {
  it(
    "a service process that exits normally takes the CLI child and its grandchild with it",
    async () => {
      const fixture = makeFixture("exit", { ignoreSigterm: false });
      const serverDir = resolve(import.meta.dirname, "..");
      // Stands in for the HTTP service: starts one generate run, then exits
      // normally on a timer (what index.ts's shutdown path ends up doing with
      // process.exit). It kills no children by hand.
      const serviceEntry = join(workDir!, "service.mjs");
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
