import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // PLANFORGE_ROOT + the CLI bootstrap path need to be resolvable before
    // config.ts loads. Seed harmless defaults here so individual tests
    // don't each have to set them; tests that exercise real filesystem
    // behaviour override on the fly.
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        // Measured 2026-06-30: statements 86.76, branches 82.92,
        // functions 73.68, lines 87.84.  Thresholds are set ~5 points
        // below to give headroom for small fluctuations while still
        // gating CI against regressions.
        statements: 81,
        branches: 77,
        functions: 68,
        lines: 82,
      },
    },
  },
});
