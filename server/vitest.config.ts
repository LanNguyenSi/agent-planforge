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
  },
});
