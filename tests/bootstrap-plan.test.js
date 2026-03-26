const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "bootstrap-plan.js");
const analyzeScriptPath = path.join(repoRoot, "scripts", "analyze-artifacts.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runPlanner(args, options = {}) {
  // Default to --no-install for fast tests unless the test explicitly wants install behavior.
  const argsWithNoInstall =
    args.includes("--no-install") || args.includes("--install")
      ? args
      : [...args, "--no-install"];
  return spawnSync("node", [scriptPath, ...argsWithNoInstall], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    input: options.input
  });
}

function runAnalyzer(args, options = {}) {
  return spawnSync("node", [analyzeScriptPath, ...args], {
    cwd: options.cwd || repoRoot,
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

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function setClarificationAnswer(markdown, id, value) {
  const lines = markdown.split(/\r?\n/);
  let currentId = "";

  return lines.map((line) => {
    const headingMatch = line.match(/^###\s+(CLARIFY-[A-Z0-9-]+):/);
    if (headingMatch) {
      currentId = headingMatch[1];
      return line;
    }
    if (currentId === id && line.startsWith("Answer:")) {
      return `Answer: ${value}`;
    }
    return line;
  }).join("\n");
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
  const agentsDoc = readText(path.join(outdir, ".ai", "AGENTS.md"));
  const architecturePrompt = readText(path.join(outdir, "prompts", "architecture-analysis.md"));
  const executionPrompt = readText(path.join(outdir, "prompts", "execution-next-wave.md"));
  const governancePrompt = readText(path.join(outdir, "prompts", "governance-setup.md"));

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
  assert.match(agentsDoc, /## Engineering Model/);
  assert.match(agentsDoc, /Spec-driven planning:/);
  assert.match(architecturePrompt, /Use a spec\/context\/eval lens:/);
  assert.match(executionPrompt, /Use a spec\/context\/eval lens:/);
  assert.match(governancePrompt, /Use a spec\/context\/eval lens:/);

  assert.ok(runnerContract.stepContracts.length >= 3);
  assert.equal(scaffoldkit.version, "1.1");
  assert.equal(scaffoldkit.blueprint, "nextjs-fullstack");
  assert.ok(scaffoldkit.blueprintCandidates.includes("nextjs-fullstack"));
  assert.equal(scaffoldkit.suggestedVariables.project_name, "vendor-access-hub");
  assert.equal(scaffoldkit.suggestedVariables.ai_context, true);
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

  assert.equal(fs.existsSync(path.join(outdir, "Makefile")), true);
});

runCase("service-oriented plans export a real scaffoldkit backend blueprint", () => {
  const fixtureDir = tempDir("planforge-scaffoldkit-backend-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Queue Worker API",
    summary: "TypeScript backend service for queued workflows and webhooks.",
    targetUsers: ["internal systems"],
    coreFeatures: ["workflow queue processing", "webhook ingestion"],
    constraints: ["prefer TypeScript", "must run in Docker"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const scaffoldkit = readJson(path.join(fixtureDir, "out", "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "express-api");
  assert.equal(scaffoldkit.suggestedVariables.use_queue, true);
});

runCase("git-backed cli sync plans stay on cli-tool semantics and avoid database defaults", () => {
  const fixtureDir = tempDir("planforge-cli-sync-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "agent-memory-sync",
    summary: "A CLI tool that syncs agent memory files across multiple OpenClaw instances via a central Git repository.",
    targetUsers: ["AI agents", "developers"],
    coreFeatures: [
      "push local memory files to remote git repo",
      "pull and merge memory from remote",
      "conflict resolution for concurrent agent writes",
      "configurable sync interval (cron-compatible)",
      "dry-run mode to preview changes before sync"
    ],
    constraints: [
      "TypeScript only",
      "no external databases, git is the source of truth",
      "must work offline (queue syncs until connection restored)",
      "lightweight CLI, no heavy frameworks"
    ]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const output = readJson(path.join(outdir, "plan-output.json"));
  const scaffoldkit = readJson(path.join(outdir, "scaffoldkit-input.json"));
  const adr002 = readText(path.join(outdir, "adrs", "002-primary-data-store.md"));

  assert.equal(scaffoldkit.blueprint, "cli-tool");
  assert.equal(scaffoldkit.stack.dataStore, "git");
  assert.equal(scaffoldkit.suggestedVariables.language, "typescript");
  assert.equal(scaffoldkit.suggestedVariables.cli_framework, "commander");
  assert.equal(scaffoldkit.suggestedVariables.test_strategy, "integration-tests");
  assert.match(adr002, /Git-backed file store/);
  assert.doesNotMatch(adr002, /relational primary data store/i);

  const featureTasks = output.tasks.filter((task) => task.category === "feature");
  assert.ok(featureTasks.some((task) => task.files.some((file) => file.includes("memory-sync"))));
  assert.equal(featureTasks.some((task) => task.files.some((file) => /notifications|widgets|github/i.test(file))), false);

  assert.equal(fs.existsSync(path.join(outdir, "Makefile")), false);
  assert.equal(fs.existsSync(path.join(outdir, "Dockerfile.dev")), false);
  assert.equal(fs.existsSync(path.join(outdir, "docker-compose.dev.yml")), false);
});

runCase("php symfony backend plans recommend the symfony backend blueprint", () => {
  const fixtureDir = tempDir("planforge-php-symfony-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Partner Case API",
    summary: "Symfony-based PHP backend service for partner onboarding and secure case workflows.",
    targetUsers: ["partner managers", "operations team"],
    coreFeatures: [
      "Symfony case management backend",
      "composer-based dependency workflow",
      "phpunit and phpstan quality gates"
    ],
    constraints: [
      "PHP 8.3",
      "Symfony 7",
      "must run in Docker"
    ]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const scaffoldkit = readJson(path.join(fixtureDir, "out", "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "symfony-backend");
  assert.equal(scaffoldkit.stack.hint, "PHP/Symfony application");
  assert.equal(scaffoldkit.suggestedVariables.php_version, "8.3");
  assert.equal(scaffoldkit.suggestedVariables.symfony_version, "7");
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "language"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "cli_framework"), false);
});

runCase("php symfony plus react dashboard plans recommend the symfony nextjs blueprint", () => {
  const fixtureDir = tempDir("planforge-php-symfony-nextjs-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Partner Dashboard",
    summary: "Symfony API with a React dashboard for partner support teams.",
    targetUsers: ["partner managers", "operations team"],
    coreFeatures: [
      "Symfony backend for partner data",
      "React dashboard for internal operators",
      "REST API for case management"
    ],
    constraints: [
      "PHP 8.3",
      "Symfony 7",
      "must run in Docker"
    ]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const scaffoldkit = readJson(path.join(fixtureDir, "out", "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "symfony-nextjs");
  assert.equal(scaffoldkit.suggestedVariables.php_version, "8.3");
  assert.equal(scaffoldkit.suggestedVariables.symfony_version, "7");
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

runCase("alert-focused features no longer fall into pipeline-monitoring matches", () => {
  const fixtureDir = tempDir("planforge-pattern-");
  const inputPath = path.join(fixtureDir, "input.json");
  writeJson(inputPath, {
    projectName: "Ops Alerting",
    summary: "Track deployment failures and notify operators quickly.",
    targetUsers: ["operations engineers"],
    coreFeatures: ["alert system for deployment failures"],
    constraints: ["prefer TypeScript"]
  });

  const outdir = path.join(fixtureDir, "out");
  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(outdir, "plan-output.json"));
  const featureTask = output.tasks.find((task) => task.category === "feature");

  assert.ok(featureTask.files.some((file) => file.includes("alerts")));
  assert.equal(featureTask.files.some((file) => file.includes("pipeline")), false);
});

runCase("clarify mode writes questions and pauses until answers exist", () => {
  const fixtureDir = tempDir("planforge-clarify-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Ops Console",
    summary: "Internal ops tool.",
    targetUsers: ["operations team"],
    coreFeatures: ["dashboard"],
    constraints: []
  });

  const result = runPlanner(["--input", "input.json", "--clarify"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(fixtureDir, "plan-output.json")), false);
  assert.ok(fs.existsSync(path.join(fixtureDir, "specs", "clarifications.md")));
  assert.ok(fs.existsSync(path.join(fixtureDir, "prompts", "clarify-prompt.md")));

  const clarifications = fs.readFileSync(path.join(fixtureDir, "specs", "clarifications.md"), "utf8");
  const questionCount = (clarifications.match(/^### CLARIFY-/gm) || []).length;
  assert.ok(questionCount >= 5 && questionCount <= 10);
  assert.match(clarifications, /## Auth Strategy/);
  assert.match(clarifications, /## Data Model/);
  assert.match(clarifications, /## Deployment/);
  assert.match(clarifications, /## Integrations/);
});

runCase("clarify mode applies provided answers before generating the plan", () => {
  const fixtureDir = tempDir("planforge-clarify-answers-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Ops Console",
    summary: "Internal ops tool.",
    targetUsers: ["operations team"],
    coreFeatures: ["dashboard"],
    constraints: []
  });

  let result = runPlanner(["--input", "input.json", "--clarify"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const clarificationsPath = path.join(fixtureDir, "specs", "clarifications.md");
  let clarifications = fs.readFileSync(clarificationsPath, "utf8");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-AUTH-01", "internal SSO only");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-DATA-01", "operators, incidents, and audit events in Postgres");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-DEPLOY-01", "kubernetes");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-INTEGRATIONS-01", "Slack, PagerDuty");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-ACCESS-01", "admin, operator");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-WORKFLOW-01", "new -> triaged -> resolved");
  clarifications = setClarificationAnswer(clarifications, "CLARIFY-OBS-01", "error rate, latency, and audit logs");
  writeText(clarificationsPath, clarifications);

  result = runPlanner(["--input", "input.json", "--outdir", "out", "--clarify"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const output = readJson(path.join(fixtureDir, "out", "plan-output.json"));
  assert.ok(output.inputSnapshot.constraints.includes("Authentication strategy: internal SSO only"));
  assert.ok(output.inputSnapshot.constraints.includes("Primary data model: operators, incidents, and audit events in Postgres"));
  assert.ok(output.inputSnapshot.constraints.includes("Deployment target: kubernetes"));
  assert.deepEqual(output.inputSnapshot.integrations, ["Slack", "PagerDuty"]);
  assert.ok(output.inputSnapshot.nonFunctionalRequirements.includes("Operational signals: error rate, latency, and audit logs"));
});

runCase("auto-clarify accepts defaults and proceeds without waiting", () => {
  const fixtureDir = tempDir("planforge-auto-clarify-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Ops Console",
    summary: "Internal ops tool.",
    targetUsers: ["operations team"],
    coreFeatures: ["dashboard"],
    constraints: []
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out", "--auto-clarify"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const clarifications = fs.readFileSync(path.join(fixtureDir, "out", "specs", "clarifications.md"), "utf8");
  const output = readJson(path.join(fixtureDir, "out", "plan-output.json"));

  assert.match(clarifications, /Answer: approval-based email\/password authentication/);
  assert.ok(output.inputSnapshot.constraints.some((item) => item.startsWith("Authentication strategy:")));
  assert.ok(output.inputSnapshot.constraints.some((item) => item.startsWith("Deployment target:")));
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

runCase("planner fails when npm install is requested and package.json is invalid", () => {
  const fixtureDir = tempDir("planforge-install-fail-");
  const outdir = path.join(fixtureDir, "out");
  fs.mkdirSync(outdir, { recursive: true });
  writeText(path.join(outdir, "package.json"), "{ invalid json }\n");

  const result = runPlanner([
    "--input",
    path.join(repoRoot, "examples", "sample-input.json"),
    "--outdir",
    outdir,
    "--install"
  ]);

  assert.equal(result.status, 3);
  assert.match(result.stderr, /npm install failed in the output directory/);
});

runCase("planner succeeds with --no-install even if output package.json is invalid", () => {
  const fixtureDir = tempDir("planforge-no-install-");
  const outdir = path.join(fixtureDir, "out");
  fs.mkdirSync(outdir, { recursive: true });
  writeText(path.join(outdir, "package.json"), "{ invalid json }\n");

  const result = runPlanner([
    "--input",
    path.join(repoRoot, "examples", "sample-input.json"),
    "--outdir",
    outdir,
    "--no-install"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(outdir, "plan-output.json")));
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

runCase("analyze-artifacts reports clean generated output", () => {
  const fixtureDir = tempDir("planforge-analyze-clean-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "GitHub Health",
    summary: "Dashboard for repository health and CI visibility.",
    targetUsers: ["engineering managers"],
    coreFeatures: [
      "github repository health dashboard",
      "pull request overview"
    ],
    constraints: ["prefer TypeScript"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const analysis = runAnalyzer(["--outdir", "out"], { cwd: fixtureDir });
  assert.equal(analysis.status, 0, analysis.stderr);
  assert.ok(fs.existsSync(path.join(fixtureDir, "out", "outputs", "consistency-report.md")));
  assert.ok(fs.existsSync(path.join(fixtureDir, "out", "prompts", "analyze-prompt.md")));
});

runCase("analyze-artifacts exits non-zero on wave ordering and pattern mismatches", () => {
  const fixtureDir = tempDir("planforge-analyze-bad-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "GitHub Health",
    summary: "Dashboard for repository health and CI visibility.",
    targetUsers: ["engineering managers"],
    coreFeatures: [
      "github repository health dashboard",
      "pull request overview",
      "widget customization"
    ],
    constraints: ["prefer TypeScript"]
  });

  let result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outputPath = path.join(fixtureDir, "out", "plan-output.json");
  const output = readJson(outputPath);
  const githubTask = output.tasks.find((task) => task.title === "Implement github repository health dashboard");
  const waveThreeTask = output.tasks.find((task) => task.wave === "wave-3");
  githubTask.dependsOn.push(waveThreeTask.id);
  writeJson(outputPath, output);

  const githubTaskDocPath = path.join(fixtureDir, "out", "tasks", `${githubTask.id}-implement-github-repository-health-dashboard.md`);
  writeText(githubTaskDocPath, readText(githubTaskDocPath).replace(
    "lib/github/client.ts — GitHub API client with octokit",
    "lib/ai/types.ts — ChatMessage, DashboardContext interfaces + Zod schemas"
  ));

  result = runAnalyzer(["--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 1);

  const report = readText(path.join(fixtureDir, "out", "outputs", "consistency-report.md"));
  assert.match(report, /depends on a later execution wave/);
  assert.match(report, /files do not match the task's semantic pattern/);
  assert.match(report, /Confidence:/);
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

runCase("invalid config override rejects unsupported keys instead of silently ignoring them", () => {
  const fixtureDir = tempDir("planforge-invalid-override-");
  const invalidConfigPath = path.join(fixtureDir, "invalid-override.json");
  writeJson(invalidConfigPath, {
    waves: {
      wave_0: {
        label: "Custom Foundation"
      }
    }
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
  assert.match(result.stderr, /Invalid planner config override/);
  assert.match(result.stderr, /unsupported key `waves`/);
});

console.log("All tests passed.");
