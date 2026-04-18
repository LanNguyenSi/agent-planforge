// Seed required env vars before any test file imports `src/config.ts`.
// Tests that want to exercise config-validation failures override at the
// test level and re-import a fresh module.
process.env.PLANFORGE_SERVICE_TOKEN ??= "test-token-agent-planforge-integration";
