/**
 * Unit tests for the loadEnv() failure path in src/config.ts.
 * Gap 4: process.exit(1) is called when PLANFORGE_SERVICE_TOKEN is missing.
 *
 * setup.ts seeds PLANFORGE_SERVICE_TOKEN before this file loads so other
 * tests are unaffected. This test deletes the token, resets the module
 * registry so config.ts re-evaluates (calling loadEnv() again), and
 * asserts the mocked exit throws before the import resolves.
 */
import { describe, it, expect, vi } from "vitest";

describe("loadEnv", () => {
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
});
