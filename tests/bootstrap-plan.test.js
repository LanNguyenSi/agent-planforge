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

function runPlanner(args, options = {}) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input: options.input
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runCase("sample input generates enterprise artifacts, runner contract, and downstream exports", () => {
  const outdir = tempDir("planforge-sample-");
  const result = runPlanner(["--input", "examples/sample-input.json", "--outdir", outdir]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  const manifest = readJson(path.join(outdir, "handoff-manifest.json"));
  const runnerContract = readJson(path.join(outdir, "runner-contract.json"));
  const scaffoldkit = readJson(path.join(outdir, "scaffoldkit-input.json"));
  const devreview = readJson(path.join(outdir, ".devreview.json"));

  assert.equal(output.phase, "phase_3");
  assert.equal(output.path, "enterprise");
  assert.equal(output.inputFormat, "json");
  assert.ok(output.recommendedPlaybooks.some((entry) => entry.endsWith("playbooks/05-development-workflow.md")));
  assert.ok(output.recommendedPlaybooks.some((entry) => entry.endsWith("playbooks/10-security-and-governance.md")));
  assert.ok(output.tasks.every((task) => Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0));

  assert.equal(manifest.runnerContractPath, "runner-contract.json");
  assert.ok(manifest.steps.every((step) => step.statusFiles && step.approvalGate && step.blockerPolicy));
  assert.ok(manifest.sharedArtifacts.includes("scaffoldkit-input.json"));
  assert.ok(manifest.sharedArtifacts.includes(".devreview.json"));

  assert.ok(runnerContract.stepContracts.length >= 3);
  assert.equal(scaffoldkit.blueprint, "nextjs-fullstack");
  assert.equal(devreview.minimumScore, 8);

  [
    ".ai/AGENTS.md",
    ".ai/ARCHITECTURE.md",
    ".ai/TASKS.md",
    ".ai/DECISIONS.md",
    "governance/service-ownership.md",
    "prompts/governance-setup.md",
    "runner/step-4-wave-1-execution/status.json",
    "structured-input.json",
    "rerun-report.json"
  ].forEach((relativePath) => {
    assert.ok(fs.existsSync(path.join(outdir, relativePath)), `missing ${relativePath}`);
  });
});

runCase("config overrides merge onto the base config without replacing entire sections", () => {
  const outdir = tempDir("planforge-config-merge-");
  const result = runPlanner([
    "--input",
    "examples/sample-input.json",
    "--outdir",
    outdir,
    "--config",
    "examples/planner-config.override.json"
  ]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  assert.equal(output.plannerProfile, "startup");
  assert.ok(output.recommendedGuidanceAreas.includes("third-party risk review"));
  assert.ok(output.recommendedGuidanceAreas.includes("security and governance"));
  assert.ok(output.recommendedArtifacts.includes("third-party dependency register"));
});

runCase("markdown input is parsed heuristically and written as structured input", () => {
  const outdir = tempDir("planforge-markdown-");
  const result = runPlanner([
    "--input",
    "examples/sample-input.md",
    "--format",
    "markdown",
    "--outdir",
    outdir
  ]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  const structuredInput = readJson(path.join(outdir, "structured-input.json"));

  assert.equal(output.inputFormat, "markdown");
  assert.equal(structuredInput.projectName, "Vendor Access Hub");
  assert.ok(structuredInput.coreFeatures.includes("approval workflow for access requests"));
  assert.ok(Array.isArray(output.inputParsing.parserWarnings));
});

runCase("summary mode works with text input", () => {
  const outdir = tempDir("planforge-stdin-");
  const inputPath = path.join(tempDir("planforge-text-input-"), "input.txt");
  fs.writeFileSync(
    inputPath,
    "Internal Ops Console\nBuild an internal dashboard for ops engineers.\n- dashboard\n- alert triage\nMust be auditable.\n"
  );
  const result = runPlanner(["--input", inputPath, "--format", "text", "--outdir", outdir, "--summary"]);

  assert.equal(result.status, 0, result.stderr);
  const output = readJson(path.join(outdir, "plan-output.json"));
  assert.equal(output.inputFormat, "text");
  assert.ok(fs.existsSync(path.join(outdir, "structured-input.json")));
});

runCase("resume-from writes rerun metadata and preserves runner state", () => {
  const baseOutdir = tempDir("planforge-resume-base-");
  let result = runPlanner(["--input", "examples/sample-input.json", "--outdir", baseOutdir]);
  assert.equal(result.status, 0, result.stderr);

  const extraRunnerFile = path.join(baseOutdir, "runner", "custom-note.txt");
  fs.writeFileSync(extraRunnerFile, "keep me\n");

  const modifiedInputPath = path.join(tempDir("planforge-resume-input-"), "modified-input.json");
  const modifiedInput = readJson(path.join(repoRoot, "examples", "sample-input.json"));
  modifiedInput.summary = `${modifiedInput.summary} Updated after architecture review.`;
  writeJson(modifiedInputPath, modifiedInput);

  const resumedOutdir = tempDir("planforge-resume-out-");
  result = runPlanner([
    "--input",
    modifiedInputPath,
    "--outdir",
    resumedOutdir,
    "--resume-from",
    baseOutdir
  ]);

  assert.equal(result.status, 0, result.stderr);

  const rerunReport = readJson(path.join(resumedOutdir, "rerun-report.json"));
  assert.equal(rerunReport.mode, "resume");
  assert.ok(rerunReport.changedAssumptions.includes("summary"));
  assert.ok(rerunReport.preservedArtifacts.includes("runner"));
  assert.ok(fs.existsSync(path.join(resumedOutdir, "runner", "custom-note.txt")));
});

runCase("validate-only mode succeeds without writing artifacts", () => {
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

runCase("invalid input fails with schema validation exit code", () => {
  const fixtureDir = tempDir("planforge-invalid-input-");
  const invalidInputPath = path.join(fixtureDir, "invalid-input.json");
  writeJson(invalidInputPath, {
    projectName: "Broken",
    summary: "oops",
    targetUsers: [],
    coreFeatures: ["feature"],
    constraints: []
  });

  const result = runPlanner([
    "--input",
    invalidInputPath,
    "--outdir",
    path.join(fixtureDir, "out")
  ]);

  assert.equal(result.status, 2);
});

runCase("invalid config fails with schema validation exit code", () => {
  const fixtureDir = tempDir("planforge-invalid-config-");
  const invalidConfigPath = path.join(fixtureDir, "invalid-config.json");
  writeJson(invalidConfigPath, {
    defaultProfile: "nope"
  });

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

console.log("All tests passed.");
