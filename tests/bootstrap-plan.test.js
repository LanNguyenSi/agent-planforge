const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "bootstrap-plan.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runPlanner(args) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("sample input generates enterprise artifacts, .ai context, and playbook references", () => {
  const outdir = tempDir("planforge-sample-");
  const result = runPlanner(["--input", "examples/sample-input.json", "--outdir", outdir]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  const manifest = readJson(path.join(outdir, "handoff-manifest.json"));

  assert.equal(output.phase, "phase_3");
  assert.equal(output.path, "enterprise");
  assert.ok(output.recommendedPlaybooks.some((entry) => entry.endsWith("playbooks/05-development-workflow.md")));
  assert.ok(output.recommendedPlaybooks.some((entry) => entry.endsWith("playbooks/10-security-and-governance.md")));
  assert.ok(output.tasks.every((task) => Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0));
  assert.ok(manifest.sharedArtifacts.includes(".ai/AGENTS.md"));
  assert.ok(manifest.sharedArtifacts.some((entry) => entry.endsWith("playbooks/10-security-and-governance.md")));

  [
    ".ai/AGENTS.md",
    ".ai/ARCHITECTURE.md",
    ".ai/TASKS.md",
    ".ai/DECISIONS.md",
    "governance/service-ownership.md",
    "prompts/governance-setup.md"
  ].forEach((relativePath) => {
    assert.ok(fs.existsSync(path.join(outdir, relativePath)), `missing ${relativePath}`);
  });
});

test("minimal input keeps planning incomplete and exports intake follow-up prompt", () => {
  const outdir = tempDir("planforge-minimal-");
  const result = runPlanner(["--input", "examples/minimal-input.json", "--outdir", outdir]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  assert.equal(output.phase, "phase_1");
  assert.equal(output.path, "core");
  assert.equal(output.intakeCompleteness, "insufficient");
  assert.ok(output.promptExports.some((prompt) => prompt.id === "intake-followup"));
  assert.ok(fs.existsSync(path.join(outdir, "prompts", "intake-followup.md")));
});

test("platform input preserves platform profile and planning summary mode", () => {
  const outdir = tempDir("planforge-platform-");
  const result = runPlanner([
    "--input",
    "examples/platform-input.json",
    "--outdir",
    outdir,
    "--summary"
  ]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  assert.equal(output.plannerProfile, "platform");
  assert.equal(output.phase, "phase_1");
  assert.ok(output.recommendedGuidanceAreas.includes("service reliability"));
  assert.deepEqual(output.dependencyGraph.criticalPathTaskIds.slice(0, 2), ["001", "002"]);
});

test("validate-only mode succeeds without writing artifacts", () => {
  const outdir = path.join(tempDir("planforge-validate-"), "unused-output");
  const result = runPlanner([
    "--input",
    "examples/sample-input.json",
    "--outdir",
    outdir,
    "--validate-only"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(outdir, "plan-output.json")), false);
});

test("invalid input fails with schema validation exit code", () => {
  const fixtureDir = tempDir("planforge-invalid-input-");
  const invalidInputPath = path.join(fixtureDir, "invalid-input.json");
  fs.writeFileSync(
    invalidInputPath,
    JSON.stringify(
      {
        projectName: "Broken",
        summary: "oops",
        targetUsers: [],
        coreFeatures: ["feature"],
        constraints: []
      },
      null,
      2
    )
  );

  const result = runPlanner([
    "--input",
    invalidInputPath,
    "--outdir",
    path.join(fixtureDir, "out")
  ]);

  assert.equal(result.status, 2);
});

test("invalid config fails with schema validation exit code", () => {
  const fixtureDir = tempDir("planforge-invalid-config-");
  const invalidConfigPath = path.join(fixtureDir, "invalid-config.json");
  fs.writeFileSync(
    invalidConfigPath,
    JSON.stringify(
      {
        version: "1.0",
        defaultProfile: "product"
      },
      null,
      2
    )
  );

  const result = runPlanner([
    "--input",
    "examples/sample-input.json",
    "--outdir",
    path.join(fixtureDir, "out"),
    "--config",
    invalidConfigPath
  ]);

  assert.equal(result.status, 2);
});
