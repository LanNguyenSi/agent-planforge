/**
 * Unit tests for the SCAFFOLDKIT_PYTHON boot guard. Each test resets the
 * module graph so the boot-guard re-imports `env` against a freshly-set
 * SCAFFOLDKIT_PYTHON. `process.execPath` is used as a known-executable
 * stand-in for the venv on the local machine; a non-existent path under
 * /tmp covers the "missing" case without depending on filesystem state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_SCAFFOLDKIT_PYTHON = process.env.SCAFFOLDKIT_PYTHON;
const ORIGINAL_ALLOW = process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT;
const NON_EXISTENT_PATH = "/tmp/agent-planforge-boot-guard-nonexistent-binary";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  // Restore env so cross-suite leakage doesn't confuse other tests that
  // import config.ts at top level.
  if (ORIGINAL_SCAFFOLDKIT_PYTHON === undefined) {
    delete process.env.SCAFFOLDKIT_PYTHON;
  } else {
    process.env.SCAFFOLDKIT_PYTHON = ORIGINAL_SCAFFOLDKIT_PYTHON;
  }
  if (ORIGINAL_ALLOW === undefined) {
    delete process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT;
  } else {
    process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT = ORIGINAL_ALLOW;
  }
  vi.restoreAllMocks();
});

describe("boot-guard probe", () => {
  it("returns 'ok' when SCAFFOLDKIT_PYTHON points at an executable", async () => {
    process.env.SCAFFOLDKIT_PYTHON = process.execPath;
    const { getScaffoldkitStatus } = await import("../src/boot-guard.js");
    expect(getScaffoldkitStatus()).toBe("ok");
  });

  it("returns 'missing' when SCAFFOLDKIT_PYTHON path does not exist", async () => {
    process.env.SCAFFOLDKIT_PYTHON = NON_EXISTENT_PATH;
    const { getScaffoldkitStatus } = await import("../src/boot-guard.js");
    expect(getScaffoldkitStatus()).toBe("missing");
  });

  it("memoizes the probe result across calls", async () => {
    process.env.SCAFFOLDKIT_PYTHON = process.execPath;
    const mod = await import("../src/boot-guard.js");
    const first = mod.getScaffoldkitStatus();
    const second = mod.getScaffoldkitStatus();
    expect(first).toBe("ok");
    expect(second).toBe("ok");
    // No public probe-count to assert on; the cache invariant matters
    // because /healthz hits this on every request.
  });
});

describe("boot-guard reportScaffoldkitStatusOnBoot", () => {
  it("does not log when SCAFFOLDKIT_PYTHON is healthy", async () => {
    process.env.SCAFFOLDKIT_PYTHON = process.execPath;
    delete process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reportScaffoldkitStatusOnBoot } = await import("../src/boot-guard.js");
    expect(reportScaffoldkitStatusOnBoot()).toBe("ok");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits a loud multi-line warning when missing without opt-in", async () => {
    process.env.SCAFFOLDKIT_PYTHON = NON_EXISTENT_PATH;
    delete process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reportScaffoldkitStatusOnBoot } = await import("../src/boot-guard.js");
    expect(reportScaffoldkitStatusOnBoot()).toBe("missing");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain("SCAFFOLDKIT_PYTHON");
    expect(message).toContain(NON_EXISTENT_PATH);
    // The loud variant explicitly names the silent-skip failure mode and
    // the opt-in escape hatch — both required so an operator reading the
    // log can act without grep-ing the codebase.
    expect(message).toContain("not_installed");
    expect(message).toContain("PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT=1");
  });

  it("emits a single mild line when missing with opt-in env", async () => {
    process.env.SCAFFOLDKIT_PYTHON = NON_EXISTENT_PATH;
    process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reportScaffoldkitStatusOnBoot } = await import("../src/boot-guard.js");
    expect(reportScaffoldkitStatusOnBoot()).toBe("missing");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0] as string;
    // Mild variant must NOT include the !!! banner — that's the visible
    // distinction between "you forgot to set the env" and "I know, dev box".
    expect(message).not.toContain("!!!");
    expect(message).toContain("PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT=1");
  });

  it("only logs once even if called multiple times", async () => {
    process.env.SCAFFOLDKIT_PYTHON = NON_EXISTENT_PATH;
    delete process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reportScaffoldkitStatusOnBoot } = await import("../src/boot-guard.js");
    reportScaffoldkitStatusOnBoot();
    reportScaffoldkitStatusOnBoot();
    reportScaffoldkitStatusOnBoot();
    // Idempotency matters because a future ops harness might want to
    // re-check on SIGHUP without spamming the log on every signal.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
