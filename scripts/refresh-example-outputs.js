#!/usr/bin/env node

"use strict";

// Deliberately untested (agent-tasks task 2e128deb, 2026-08-17): out/ is
// gitignored and git-empty, so a drift test has no committed fixtures to
// assert against, and the script writes into the real repo's out/ (repoRoot
// is hardcoded below), not a tempdir. Current coverage of the underlying
// CLI: sample-input via tests/bootstrap-plan.test.js, platform-input only
// via the ci.yml --summary smoke; minimal-input, the minimal-override
// target, and the env wiring below (standaloneEnv pinning *_ROOT at
// .missing vs ci-platform using raw process.env) have no automated
// coverage. Accepted for a dev-convenience wrapper; revisit if this script
// grows logic beyond rm+spawnSync.
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
