import { defineConfig, coverageConfigDefaults } from "vitest/config";

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
      // index.ts is the HTTP entrypoint (boot wiring only, exercised by the
      // Docker smoke job, never imported by unit tests). Excluding it keeps
      // the aggregate floor meaningful instead of being dragged toward 0 by
      // an untested boot file.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: {
        // Measured 2026-06-30 (index.ts excluded): 91.47 / 84.29 / 84.84 /
        // 92.18. Global floors are set a few points below measured for
        // headroom while still catching a real regression.
        statements: 87,
        branches: 80,
        functions: 80,
        lines: 88,
        // Per-file floor on generate.ts (the riskiest file: scaffoldkit
        // subprocess lifecycle + skip branches) so a regression there is
        // caught directly rather than masked by routes.ts in the aggregate.
        "src/generate.ts": {
          statements: 82,
          branches: 57,
          functions: 75,
          lines: 83,
        },
      },
    },
  },
});
