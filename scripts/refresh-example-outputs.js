#!/usr/bin/env node

"use strict";

// Test-coverage decision (residual LOW gap review, 2026-08-17): this script
// is intentionally left without a dedicated drift/smoke test.
//
// `out/` is declared gitignored in .gitignore and README.md says so
// explicitly ("`out/` is intentionally gitignored. To refresh the local
// example outputs so they match the current generator behavior, run:
// npm run plan:refresh-examples") — `git ls-files -- out/` returns nothing.
// There are no committed example fixtures for this script to keep in sync,
// so a test asserting "committed fixtures don't drift" has no target to
// assert against; it would only be able to check that the CLI still exits
// 0 for these inputs.
//
// That narrower check already exists: this script's only real logic is
// `rm -rf out/<name> && spawnSync(bootstrap-plan.js, ...) && throw on
// nonzero exit` against the same example inputs (sample, minimal, platform)
// that tests/bootstrap-plan.test.js already runs end-to-end with deep
// structural/content assertions, in an isolated tempdir. Re-running all 5
// targets here would re-exercise already-covered CLI behaviour ~5x over
// (multiplying suite runtime) while writing into the real repo's `out/`
// directory as a side effect of `npm test` — the opposite of the
// tempdir-isolation pattern the rest of the test suite follows, for a
// dev-convenience wrapper with no independent business logic of its own.
//
// Deferred rather than tested. If this script grows real logic (e.g.
// target-specific env wiring that could silently regress), add a focused
// unit test around that logic instead of an end-to-end drift check.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const bootstrapScript = path.join(repoRoot, "scripts", "bootstrap-plan.js");

const standaloneEnv = {
  ...process.env,
  AGENT_ENGINEERING_PLAYBOOK_ROOT: path.join(repoRoot, ".missing", "agent-engineering-playbook"),
  SCAFFOLDKIT_ROOT: path.join(repoRoot, ".missing", "scaffoldkit")
};

const targets = [
  {
    name: "sample",
    args: ["--input", "examples/sample-input.json", "--outdir", "out/sample", "--no-install"],
    env: standaloneEnv
  },
  {
    name: "minimal",
    args: ["--input", "examples/minimal-input.json", "--outdir", "out/minimal", "--no-install"],
    env: standaloneEnv
  },
  {
    name: "minimal-override",
    args: [
      "--input",
      "examples/minimal-input.json",
      "--outdir",
      "out/minimal-override",
      "--config",
      "examples/planner-config.override.json",
      "--no-install"
    ],
    env: standaloneEnv
  },
  {
    name: "platform",
    args: ["--input", "examples/platform-input.json", "--outdir", "out/platform", "--no-install"],
    env: standaloneEnv
  },
  {
    name: "ci-platform",
    args: ["--input", "examples/platform-input.json", "--outdir", "out/ci-platform", "--no-install"],
    env: process.env
  }
];

function runTarget(target) {
  const outdir = path.join(repoRoot, "out", target.name);
  fs.rmSync(outdir, { recursive: true, force: true });

  const result = spawnSync(process.execPath, [bootstrapScript, ...target.args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: target.env
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Failed to refresh out/${target.name}${details ? `\n${details}` : ""}`);
  }

  process.stdout.write(`refreshed out/${target.name}\n`);
}

function main() {
  targets.forEach(runTarget);
}

main();
