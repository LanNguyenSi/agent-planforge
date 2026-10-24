/**
 * Unit tests for loadEnv() in src/config.ts.
 *
 * setup.ts seeds PLANFORGE_SERVICE_TOKEN before any test file loads so other
 * tests are unaffected. These tests drive the zod v4 environment schema
 * directly: for each input they clear the relevant process.env keys, reset
 * the module registry so config.ts re-evaluates loadEnv(), then assert either
 * the produced value (accept) or the exit(1) rejection (reject).
 *
 * The accept-set and produced values are pinned to the pre-migration (zod 3)
 * behaviour; zod 4 changed only the default error text for a few rejects
 * (e.g. an absent token), which nothing here depends on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isAbsolute } from "node:path";

// Every key config.ts reads; cleared before each case so a value left over
// from setup.ts or a previous case cannot leak in.
const CONFIG_KEYS = [
  "PORT",
  "PLANFORGE_SERVICE_TOKEN",
  "PLANFORGE_ROOT",
  "NODE_BIN",
  "SCAFFOLDKIT_PYTHON",
  "PLANFORGE_UNKNOWN_KEY",
];

let saved: Record<string, string | undefined> = {};

type Load =
  | { ok: true; env: Record<string, string | number> }
  | { ok: false };

// A valid token is required for every non-token case; override to "" to
// exercise the empty-string path or null to leave the key absent.
function envWith(
  overrides: Record<string, string | null>,
): Record<string, string> {
  const base: Record<string, string> = {
    PLANFORGE_SERVICE_TOKEN: "test-token-agent-planforge-integration",
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

async function loadWith(overrides: Record<string, string | null>): Promise<Load> {
  for (const k of CONFIG_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envWith(overrides))) {
    process.env[k] = v;
  }
  vi.resetModules();
  try {
    const mod = (await import("../src/config.js")) as {
      env: Record<string, string | number>;
    };
    return { ok: true, env: mod.env };
  } catch (err) {
    if (err instanceof Error && err.message === "exited") return { ok: false };
    throw err;
  }
}

beforeEach(() => {
  saved = {};
  for (const k of CONFIG_KEYS) saved[k] = process.env[k];
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("exited");
  }) as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of CONFIG_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

function stderr(): string {
  const mock = (console.error as unknown as { mock: { calls: unknown[][] } }).mock;
  return mock.calls.map((args) => args.join(" ")).join("\n");
}

describe("loadEnv: PORT coercion chain", () => {
  it("PORT absent -> default 8223 (number)", async () => {
    const r = await loadWith({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.env.PORT).toBe(8223);
  });

  it('PORT "9000" -> 9000 (coerced to number)', async () => {
    const r = await loadWith({ PORT: "9000" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.env.PORT).toBe(9000);
      expect(typeof r.env.PORT).toBe("number");
    }
  });

  it('PORT "" -> rejected (coerces to 0, fails positive)', async () => {
    const r = await loadWith({ PORT: "" });
    expect(r.ok).toBe(false);
    expect(stderr()).toContain("PORT:");
  });

  it('PORT "0" -> rejected (not positive)', async () => {
    expect((await loadWith({ PORT: "0" })).ok).toBe(false);
  });

  it('PORT "-1" -> rejected (not positive)', async () => {
    expect((await loadWith({ PORT: "-1" })).ok).toBe(false);
  });

  it('PORT "1.5" -> rejected (not an integer)', async () => {
    expect((await loadWith({ PORT: "1.5" })).ok).toBe(false);
  });

  it('PORT "abc" -> rejected (NaN is not a number)', async () => {
    expect((await loadWith({ PORT: "abc" })).ok).toBe(false);
  });
});

describe("loadEnv: string defaults (absent -> default, empty -> empty)", () => {
  it("PLANFORGE_ROOT absent -> default absolute path", async () => {
    const r = await loadWith({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.env.PLANFORGE_ROOT).toBe("string");
      expect(r.env.PLANFORGE_ROOT).not.toBe("");
      expect(isAbsolute(r.env.PLANFORGE_ROOT as string)).toBe(true);
    }
  });

  it('PLANFORGE_ROOT "" -> accepted as empty string (default not applied)', async () => {
    const r = await loadWith({ PLANFORGE_ROOT: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.env.PLANFORGE_ROOT).toBe("");
  });

  it("NODE_BIN absent -> default process.execPath", async () => {
    const r = await loadWith({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.env.NODE_BIN).toBe(process.execPath);
  });

  it('NODE_BIN "" -> accepted as empty string', async () => {
    const r = await loadWith({ NODE_BIN: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.env.NODE_BIN).toBe("");
  });

  it('SCAFFOLDKIT_PYTHON absent -> default "/opt/sk-venv/bin/python3"', async () => {
    const r = await loadWith({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.env.SCAFFOLDKIT_PYTHON).toBe("/opt/sk-venv/bin/python3");
  });

  it('SCAFFOLDKIT_PYTHON "" -> accepted as empty string', async () => {
    const r = await loadWith({ SCAFFOLDKIT_PYTHON: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.env.SCAFFOLDKIT_PYTHON).toBe("");
  });
});

describe("loadEnv: PLANFORGE_SERVICE_TOKEN", () => {
  it("exits 1 when PLANFORGE_SERVICE_TOKEN is missing", async () => {
    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("exited");
      }) as never);

    const orig = process.env.PLANFORGE_SERVICE_TOKEN;
    delete process.env.PLANFORGE_SERVICE_TOKEN;
    vi.resetModules();

    try {
      await expect(import("../src/config.js")).rejects.toThrow("exited");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      if (orig !== undefined) {
        process.env.PLANFORGE_SERVICE_TOKEN = orig;
      } else {
        delete process.env.PLANFORGE_SERVICE_TOKEN;
      }
      mockExit.mockRestore();
      vi.resetModules();
    }
  });

  it('PLANFORGE_SERVICE_TOKEN "" -> rejected with the custom min message', async () => {
    const r = await loadWith({ PLANFORGE_SERVICE_TOKEN: "" });
    expect(r.ok).toBe(false);
    expect(stderr()).toContain("PLANFORGE_SERVICE_TOKEN is required");
  });
});

describe("loadEnv: unknown keys", () => {
  it("ignores an unknown env key (no strict mode)", async () => {
    const r = await loadWith({ PLANFORGE_UNKNOWN_KEY: "whatever" });
    expect(r.ok).toBe(true);
    if (r.ok) expect("PLANFORGE_UNKNOWN_KEY" in r.env).toBe(false);
  });
});
