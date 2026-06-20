const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "bootstrap-plan.js");
const analyzeScriptPath = path.join(repoRoot, "scripts", "analyze-artifacts.js");

function planningFile(root, name) {
  return path.join(root, "planning", name);
}

function handoffRunnerFile(root, ...segments) {
  return path.join(root, "handoff", "runner", ...segments);
}

function exportsFile(root, name) {
  return path.join(root, "exports", name);
}

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

runCase("sample input generates enterprise artifacts and downstream exports", () => {
  const outdir = tempDir("planforge-sample-");
  const result = runPlanner(["--input", "examples/sample-input.json", "--outdir", outdir]);

  assert.equal(result.status, 0, result.stderr);

  const output = readJson(planningFile(outdir, "plan-output.json"));
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const projectIndex = readText(path.join(outdir, "PROJECT.md"));
  const rootAgentsDoc = readText(path.join(outdir, "AGENTS.md"));
  const claudeDoc = readText(path.join(outdir, "CLAUDE.md"));
  const planforgeIndex = readJson(path.join(outdir, "planforge-index.json"));
  const agentsDoc = readText(path.join(outdir, ".ai", "AGENTS.md"));

  assert.equal(output.phase, "phase_3");
  assert.equal(output.path, "enterprise");
  assert.equal(output.inputFormat, "json");
  assert.ok(output.recommendedPlaybooks.some((entry) => entry.endsWith("playbooks/05-development-workflow.md")));
  assert.ok(output.recommendedPlaybooks.some((entry) => entry.endsWith("playbooks/10-security-and-governance.md")));

  // Playbook references must be deliverable-safe: stable external URLs, never a
  // local/absolute filesystem path (which dangles for the consumer or leaks the
  // planforge container's /app working dir). Regression guard for the prior
  // /app/playbooks and bare agent-engineering-playbook/ filesystem refs.
  assert.ok(
    output.recommendedPlaybooks.every((entry) => /^https:\/\//.test(entry)),
    `recommendedPlaybooks must be https URLs, got: ${output.recommendedPlaybooks.join(", ")}`
  );
  assert.ok(
    output.recommendedPlaybooks.every((entry) => !entry.startsWith("/") && !entry.includes("/app/")),
    `recommendedPlaybooks leaked an absolute/container path: ${output.recommendedPlaybooks.join(", ")}`
  );
  assert.ok(!agentsDoc.includes("/app/playbooks"), "agents doc leaked the container /app/playbooks path");
  assert.doesNotMatch(agentsDoc, /^- agent-engineering-playbook\/playbooks\//m);
  assert.ok(
    agentsDoc.includes("https://github.com/LanNguyenSi/agent-planforge/blob/main/playbooks/planning-and-scoping.md"),
    "agents doc should reference planning-and-scoping as a resolvable URL"
  );

  assert.ok(output.tasks.every((task) => Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0));

  assert.match(projectIndex, /# PROJECT: Vendor Access Hub/);
  assert.match(projectIndex, /\[Project Charter\]\(\.planforge\/docs\/project-charter\.md\)/);
  assert.match(projectIndex, /## Current Wave/);
  assert.match(projectIndex, /## Architecture Guardrails/);
  assert.match(rootAgentsDoc, /Primary agent instructions live in `\.ai\/AGENTS\.md`/);
  assert.match(rootAgentsDoc, /planforge-index\.json/);
  assert.match(claudeDoc, /Use `AGENTS\.md` in the project root as the primary entry point\./);
  assert.match(agentsDoc, /## Engineering Model/);
  assert.match(agentsDoc, /Spec-driven planning:/);

  assert.equal(scaffoldkit.version, "1.1");
  assert.equal(scaffoldkit.blueprint, "nextjs-fullstack");
  assert.ok(scaffoldkit.blueprintCandidates.includes("nextjs-fullstack"));
  assert.equal(scaffoldkit.blueprintConfidence, "strong");
  assert.equal(scaffoldkit.agentMustCreateStructure, false);
  assert.equal(scaffoldkit.suggestedVariables.project_name, "vendor-access-hub");
  assert.equal(scaffoldkit.suggestedVariables.ai_context, true);
  assert.equal(planforgeIndex.planning.planOutput, "planning/plan-output.json");
  assert.equal(planforgeIndex.exports.scaffoldkit, "exports/scaffoldkit-input.json");
  assert.equal(planforgeIndex.rootFiles.agents, "AGENTS.md");
  assert.equal(planforgeIndex.rootFiles.charter, ".planforge/docs/project-charter.md");
  assert.equal(planforgeIndex.rootFiles.architecture, ".planforge/docs/architecture-overview.md");
  assert.equal(planforgeIndex.rootFiles.deliveryPlan, ".planforge/docs/delivery-plan.md");
  assert.equal(planforgeIndex.rootFiles.intakeQuestionnaire, ".planforge/docs/intake-questionnaire.md");
  assert.equal(planforgeIndex.directories.docs, ".planforge/docs");
  assert.equal(planforgeIndex.directories.tooling, ".planforge/tooling");
  assert.equal(planforgeIndex.directories.ai, ".ai");
  // Enterprise phase_3 run: governance + runbooks are written, so they appear;
  // specs is not (no --clarify), so it must be absent from the index.
  assert.equal(planforgeIndex.directories.governance, "governance");
  assert.equal(planforgeIndex.directories.runbooks, "runbooks");
  assert.equal(planforgeIndex.directories.specs, undefined);
  assert.equal(planforgeIndex.ai.tasks, ".ai/TASKS.md");

  [
    "AGENTS.md",
    "CLAUDE.md",
    "planforge-index.json",
    ".ai/AGENTS.md",
    ".ai/ARCHITECTURE.md",
    ".ai/TASKS.md",
    ".ai/DECISIONS.md",
    "PROJECT.md",
    ".planforge/docs/project-charter.md",
    ".planforge/docs/architecture-overview.md",
    ".planforge/docs/delivery-plan.md",
    ".planforge/docs/intake-questionnaire.md",
    "governance/service-ownership.md",
    "runbooks/release-readiness.md",
    "planning/structured-input.json",
    "planning/rerun-report.json"
  ].forEach((relativePath) => {
    assert.ok(fs.existsSync(path.join(outdir, relativePath)), `missing ${relativePath}`);
  });

  // The runner/handoff fleet artifacts are no longer emitted (Phase 3).
  ["handoff", "prompts", "exports/devreview.json"].forEach((relativePath) => {
    assert.equal(
      fs.existsSync(path.join(outdir, relativePath)),
      false,
      `should not emit ${relativePath}`
    );
  });
  assert.equal(planforgeIndex.handoff, undefined);
  assert.equal(planforgeIndex.exports.devreview, undefined);
  assert.equal(planforgeIndex.directories.handoff, undefined);
  assert.equal(planforgeIndex.directories.prompts, undefined);

  assert.equal(fs.existsSync(path.join(outdir, ".planforge", "tooling", "Makefile")), true);
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

  const scaffoldkit = readJson(exportsFile(path.join(fixtureDir, "out"), "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "express-api");
  assert.equal(scaffoldkit.suggestedVariables.use_queue, true);
});

runCase("rest/json api intakes select rest-api at strong confidence (the 'cli' substring in Clients/click must not trip cli-tool)", () => {
  const fixtureDir = tempDir("planforge-rest-api-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "quicklinks-api",
    summary: "A REST/JSON HTTP API service for shortening URLs. Clients POST a long URL and get back a short code.",
    targetUsers: ["backend developers", "api consumers"],
    coreFeatures: [
      "POST /api/shorten accepting {url} and returning {code, shortUrl} as JSON",
      "GET /:code issuing a 302 redirect to the original URL",
      "per-link click analytics exposed via GET /api/links/:code/stats"
    ],
    constraints: [
      "REST/JSON over HTTP only, no server-rendered UI",
      "stateless service",
      "PostgreSQL as the system of record"
    ]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const scaffoldkit = readJson(exportsFile(path.join(fixtureDir, "out"), "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "rest-api");
  assert.equal(scaffoldkit.blueprintConfidence, "strong");
  assert.equal(scaffoldkit.agentMustCreateStructure, false);
});

runCase("rest-api feature task paths follow the python/fastapi stack and api-key auth does not leak a Next.js/Prisma template", () => {
  const fixtureDir = tempDir("planforge-rest-api-task-paths-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "quicklinks-api",
    summary: "A REST/JSON HTTP API service for shortening URLs. Clients POST a long URL and get back a short code.",
    targetUsers: ["backend developers", "api consumers"],
    coreFeatures: [
      "POST /api/shorten accepting {url} and returning {code, shortUrl} as JSON",
      "API-key authentication on write endpoints"
    ],
    constraints: [
      "REST/JSON over HTTP only, no server-rendered UI",
      "PostgreSQL as the system of record"
    ]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const output = readJson(planningFile(outdir, "plan-output.json"));

  assert.equal(scaffoldkit.blueprint, "rest-api");
  // The blueprint that drove task generation is recorded in the plan output so
  // downstream analysis keys off the same stack.
  assert.equal(output.scaffoldBlueprint, "rest-api");

  const featureTasks = output.tasks.filter((task) => task.category === "feature");
  const featureFilePaths = featureTasks.flatMap((task) => task.files);

  // Every generated feature file is Python; no .ts/.tsx/.test.js path leaks in.
  assert.ok(featureFilePaths.length > 0);
  assert.ok(
    featureFilePaths.every((file) => !/\.tsx?$|\.test\.js$/.test(file)),
    `expected only python feature paths, got: ${featureFilePaths.join(", ")}`
  );
  assert.ok(featureFilePaths.some((file) => file.endsWith(".py")));

  // Python module names are snake_case identifiers, not the kebab-case slug.
  const pythonPaths = featureFilePaths.filter((file) => file.endsWith(".py"));
  assert.ok(
    pythonPaths.every((file) => !/[a-z0-9]-[a-z0-9]/.test(file)),
    `python module paths must be snake_case, got: ${pythonPaths.join(", ")}`
  );

  // The api-key auth task must not splice the canned Next.js/JWT/Prisma user-login template.
  const authTask = featureTasks.find((task) => /authentication/i.test(task.title));
  assert.ok(authTask, "expected an authentication feature task");
  assert.equal(
    authTask.files.some((file) => /prisma|app\/api\/auth|lib\/auth\/jwt|route\.ts/.test(file)),
    false,
    `api-key auth task leaked a Next.js/Prisma template: ${authTask.files.join(", ")}`
  );

  // The hardening/coverage (quality) task must also follow the stack, not hardcode .test.js.
  const coverageTask = output.tasks.find((task) => task.category === "quality");
  assert.ok(coverageTask, "expected a quality coverage task");
  assert.ok(
    coverageTask.files.every((file) => !/\.test\.js$/.test(file)),
    `coverage task leaked JS test paths: ${coverageTask.files.join(", ")}`
  );
  assert.ok(
    coverageTask.files.every((file) => file.endsWith(".py")),
    `coverage task should emit Python test paths, got: ${coverageTask.files.join(", ")}`
  );
  assert.ok(
    coverageTask.files.some((file) => /tests\/integration\/test_/.test(file)),
    `coverage task should use pytest integration paths, got: ${coverageTask.files.join(", ")}`
  );

  // The foundation "set up repository" task's manifest must follow the stack, not
  // hardcode a Node package.json into a python project.
  const setupTask = output.tasks.find((task) => /set up repository/i.test(task.title));
  assert.ok(setupTask, "expected a 'set up repository' foundation task");
  assert.ok(
    setupTask.files.includes("pyproject.toml"),
    `setup task should list pyproject.toml, got: ${setupTask.files.join(", ")}`
  );
  assert.ok(
    !setupTask.files.includes("package.json"),
    `setup task leaked package.json into a python project: ${setupTask.files.join(", ")}`
  );
});

runCase("express-api api-key auth falls back to a generic layout instead of the JWT/user-login template (negativeKeywords guard)", () => {
  const fixtureDir = tempDir("planforge-express-apikey-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Ingest Service",
    summary: "TypeScript backend service for queued workflows and webhooks.",
    targetUsers: ["internal systems"],
    coreFeatures: ["webhook ingestion", "API-key authentication on write endpoints"],
    constraints: ["prefer TypeScript", "must run in Docker"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const output = readJson(planningFile(outdir, "plan-output.json"));
  assert.equal(scaffoldkit.blueprint, "express-api");

  // express-api DOES have an authentication-jwt file key, so without the
  // negativeKeywords guard an api-key task would splice the full JWT/user-login
  // template. It must instead get the generic (TypeScript) layout.
  const authTask = output.tasks
    .filter((task) => task.category === "feature")
    .find((task) => /authentication/i.test(task.title));
  assert.ok(authTask, "expected an authentication feature task");
  assert.equal(
    authTask.files.some((file) => /auth\/(jwt|password|service|middleware|validation)|routes\/auth|models\/user|register|login|prisma/.test(file)),
    false,
    `express-api api-key auth leaked a JWT/user-login template: ${authTask.files.join(", ")}`
  );
  assert.ok(authTask.files.some((file) => /\.ts$/.test(file)));

  // Negative control: the TS stack's coverage task keeps .test.ts, no regression to .test.js.
  const coverageTask = output.tasks.find((task) => task.category === "quality");
  assert.ok(coverageTask, "expected a quality coverage task");
  assert.ok(
    coverageTask.files.every((file) => !/\.test\.js$/.test(file)),
    `coverage task regressed to JS test paths: ${coverageTask.files.join(", ")}`
  );
  assert.ok(
    coverageTask.files.every((file) => /\.test\.ts$/.test(file)),
    `coverage task should emit .test.ts for a TS stack, got: ${coverageTask.files.join(", ")}`
  );

  // Negative control: the TS stack's setup task keeps package.json.
  const setupTask = output.tasks.find((task) => /set up repository/i.test(task.title));
  assert.ok(setupTask, "expected a 'set up repository' foundation task");
  assert.ok(
    setupTask.files.includes("package.json"),
    `TS setup task should list package.json, got: ${setupTask.files.join(", ")}`
  );
});

runCase("python cli-tool feature task paths use snake_case python module names", () => {
  const fixtureDir = tempDir("planforge-python-cli-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "log-tailer",
    summary: "A command-line developer tool that tails and filters log files.",
    targetUsers: ["developers"],
    coreFeatures: ["tail a log file with filtering", "export filtered results to a JSON file"],
    constraints: ["Python 3.12", "lightweight CLI, no heavy frameworks"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const output = readJson(planningFile(outdir, "plan-output.json"));

  assert.equal(scaffoldkit.blueprint, "cli-tool");
  assert.equal(scaffoldkit.suggestedVariables.language, "python");
  assert.equal(output.scaffoldBlueprint, "cli-tool");

  const featureFilePaths = output.tasks.filter((task) => task.category === "feature").flatMap((task) => task.files);
  assert.ok(featureFilePaths.length > 0);
  assert.ok(
    featureFilePaths.every((file) => file.endsWith(".py")),
    `expected only python cli paths, got: ${featureFilePaths.join(", ")}`
  );
  assert.ok(featureFilePaths.some((file) => /^src\/(commands|core)\//.test(file)));
  assert.ok(
    featureFilePaths.every((file) => !/[a-z0-9]-[a-z0-9]/.test(file)),
    `python module paths must be snake_case, got: ${featureFilePaths.join(", ")}`
  );
});

runCase("analyze-artifacts reports clean output for a python rest-api plan", () => {
  const fixtureDir = tempDir("planforge-analyze-rest-api-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "quicklinks-api",
    summary: "A REST/JSON HTTP API service for shortening URLs.",
    targetUsers: ["backend developers"],
    coreFeatures: [
      "POST /api/shorten accepting {url} and returning {code, shortUrl} as JSON",
      "API-key authentication on write endpoints"
    ],
    constraints: ["REST/JSON over HTTP only, no server-rendered UI", "PostgreSQL as the system of record"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  // The analyzer keys alignment scoring on scaffoldBlueprint; for a keyless
  // blueprint (rest-api) it must degrade cleanly, not raise spurious criticals.
  const analysis = runAnalyzer(["--outdir", "out"], { cwd: fixtureDir });
  assert.equal(analysis.status, 0, analysis.stderr);
  const report = readText(path.join(fixtureDir, "out", "outputs", "consistency-report.md"));
  assert.match(report, /Critical issues: 0/);
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
  const output = readJson(planningFile(outdir, "plan-output.json"));
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
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

  assert.equal(fs.existsSync(path.join(outdir, ".planforge", "tooling", "Makefile")), false);
  assert.equal(fs.existsSync(path.join(outdir, ".planforge", "tooling", "Dockerfile.dev")), false);
  assert.equal(fs.existsSync(path.join(outdir, ".planforge", "tooling", "docker-compose.dev.yml")), false);

  // Core (cli-tool) plan: governance is enterprise-only, so it must be absent
  // from the index; the tooling directory anchor is always present.
  const cliIndex = readJson(path.join(outdir, "planforge-index.json"));
  assert.equal(cliIndex.directories.governance, undefined);
  assert.equal(cliIndex.directories.runbooks, undefined);
  assert.equal(cliIndex.directories.tooling, ".planforge/tooling");
  // The runbooks/governance write gates and the index presence flags now share one
  // predicate (shouldWriteRunbooks/shouldWriteGovernance), so an absent index entry
  // must mean an absent directory on disk: no drift between writer and index.
  assert.equal(fs.existsSync(path.join(outdir, "governance")), false);
  assert.equal(fs.existsSync(path.join(outdir, "runbooks")), false);
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

  const scaffoldkit = readJson(exportsFile(path.join(fixtureDir, "out"), "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "symfony-backend");
  assert.equal(scaffoldkit.stack.hint, "PHP/Symfony application");
  assert.equal(scaffoldkit.suggestedVariables.php_version, "8.3");
  assert.equal(scaffoldkit.suggestedVariables.symfony_version, "7.2");
  assert.equal(scaffoldkit.suggestedVariables.database, "postgresql");
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "language"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "cli_framework"), false);

  // PHP blueprint -> PHP feature task paths (PascalCase classes), not TypeScript.
  const output = readJson(planningFile(path.join(fixtureDir, "out"), "plan-output.json"));
  assert.equal(output.scaffoldBlueprint, "symfony-backend");
  const phpFeatureFiles = output.tasks.filter((task) => task.category === "feature").flatMap((task) => task.files);
  assert.ok(phpFeatureFiles.length > 0);
  assert.ok(
    phpFeatureFiles.every((file) => file.endsWith(".php")),
    `expected php feature paths, got: ${phpFeatureFiles.join(", ")}`
  );
  assert.ok(phpFeatureFiles.some((file) => /^src\/(Controller|Service|Repository)\/.+\.php$/.test(file)));
});

runCase("generic php/symfony plans recommend symfony-backend, not the removed reference shell", () => {
  const fixtureDir = tempDir("planforge-php-generic-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Internal Records",
    summary: "A PHP application built with Symfony for an internal records workflow.",
    targetUsers: ["internal staff"],
    coreFeatures: [
      "Symfony application skeleton",
      "composer dependency management",
      "phpunit test coverage"
    ],
    constraints: ["PHP 8.3", "Symfony 7"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  // Generic PHP intake (no api/backend or frontend signal) hits the baseline branch,
  // which used to return the app-less reference-php-app shell. It must now pick the
  // runnable symfony-backend instead.
  const scaffoldkit = readJson(exportsFile(path.join(fixtureDir, "out"), "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "symfony-backend");
  assert.equal(scaffoldkit.blueprintConfidence, "medium");
  assert.match(scaffoldkit.blueprintReason, /symfony-backend as baseline/);
  assert.ok(
    !scaffoldkit.blueprintCandidates.includes("reference-php-app"),
    `reference-php-app should be gone, got: ${scaffoldkit.blueprintCandidates.join(", ")}`
  );
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

  const scaffoldkit = readJson(exportsFile(path.join(fixtureDir, "out"), "scaffoldkit-input.json"));
  assert.equal(scaffoldkit.blueprint, "symfony-nextjs");
  assert.equal(scaffoldkit.suggestedVariables.php_version, "8.3");
  assert.equal(scaffoldkit.suggestedVariables.database, "postgresql");
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "symfony_version"), false);
});

runCase("django plans emit a weak scaffold match and tell the agent to create or adapt structure manually", () => {
  const fixtureDir = tempDir("planforge-django-weak-match-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Case Workflow Django API",
    summary: "Django REST backend for secure case workflows and operator review queues.",
    targetUsers: ["operations team"],
    coreFeatures: [
      "Django REST API for case management",
      "review queue for operators",
      "workflow audit history"
    ],
    constraints: [
      "Python 3.12",
      "must run in Docker"
    ]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const architectureOverview = readText(path.join(outdir, ".planforge", "docs", "architecture-overview.md"));
  const agentsDoc = readText(path.join(outdir, ".ai", "AGENTS.md"));

  assert.equal(scaffoldkit.blueprint, "rest-api");
  assert.equal(scaffoldkit.blueprintConfidence, "weak");
  assert.equal(scaffoldkit.agentMustCreateStructure, true);
  assert.match(scaffoldkit.scaffoldExecutionSummary, /partial fit/i);
  assert.match(scaffoldkit.scaffoldExecutionReason, /django-specific project structure manually/i);
  assert.match(architectureOverview, /## Scaffold Guidance/);
  assert.match(architectureOverview, /Confidence: weak/);
  assert.match(agentsDoc, /Scaffold confidence: weak/);
  assert.match(agentsDoc, /create or adapt the Django-specific project structure manually/i);
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

  const output = readJson(planningFile(outdir, "plan-output.json"));
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

  const output = readJson(planningFile(outdir, "plan-output.json"));
  const structuredInput = readJson(planningFile(outdir, "structured-input.json"));

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
  const output = readJson(planningFile(outdir, "plan-output.json"));
  assert.equal(output.inputFormat, "text");
  assert.ok(fs.existsSync(planningFile(outdir, "structured-input.json")));
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

  const output = readJson(planningFile(outdir, "plan-output.json"));
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

  const output = readJson(planningFile(path.join(fixtureDir, "out"), "plan-output.json"));
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
  const output = readJson(planningFile(path.join(fixtureDir, "out"), "plan-output.json"));
  const planforgeIndex = readJson(path.join(fixtureDir, "out", "planforge-index.json"));

  // --clarify generated specs/clarifications.md, so the index must list specs.
  assert.equal(planforgeIndex.directories.specs, "specs");
  assert.match(clarifications, /Answer: approval-based email\/password authentication/);
  assert.ok(output.inputSnapshot.constraints.some((item) => item.startsWith("Authentication strategy:")));
  assert.ok(output.inputSnapshot.constraints.some((item) => item.startsWith("Deployment target:")));
});

runCase("resume-from writes rerun metadata and preserves runner state", () => {
  const baseOutdir = tempDir("planforge-resume-base-");
  let result = runPlanner(["--input", "examples/sample-input.json", "--outdir", baseOutdir]);
  assert.equal(result.status, 0, result.stderr);

  const extraRunnerFile = handoffRunnerFile(baseOutdir, "custom-note.txt");
  // planforge no longer emits handoff/runner itself; create it to verify resume
  // still preserves user-authored runner state placed under it.
  fs.mkdirSync(path.dirname(extraRunnerFile), { recursive: true });
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

  const rerunReport = readJson(planningFile(resumedOutdir, "rerun-report.json"));
  assert.equal(rerunReport.mode, "resume");
  assert.ok(rerunReport.changedAssumptions.includes("summary"));
  assert.ok(rerunReport.preservedArtifacts.includes("handoff/runner"));
  assert.ok(fs.existsSync(handoffRunnerFile(resumedOutdir, "custom-note.txt")));
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
  assert.ok(fs.existsSync(planningFile(outdir, "plan-output.json")));
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
  assert.equal(fs.existsSync(planningFile(outdir, "plan-output.json")), false);
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

  const outputPath = planningFile(path.join(fixtureDir, "out"), "plan-output.json");
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

// --- Unit tests for exported helpers and selector fixes ---

const {
  scaffoldkitBlueprintRecommendation,
  hasFrontendSignal,
  hasBackendSignal,
  blueprintLanguage,
  inferTechStack
} = require("../scripts/bootstrap-plan.js");

// hasFrontendSignal unit tests
runCase("hasFrontendSignal returns true for 'react frontend'", () => {
  assert.ok(hasFrontendSignal("react frontend"));
});
runCase("hasFrontendSignal returns true for 'next.js app'", () => {
  assert.ok(hasFrontendSignal("next.js app with typescript"));
});
runCase("hasFrontendSignal returns true for 'spa' keyword", () => {
  assert.ok(hasFrontendSignal("single page spa application"));
});
runCase("hasFrontendSignal returns false for 'no frontend'", () => {
  assert.ok(!hasFrontendSignal("symfony rest api, no frontend"));
});
runCase("hasFrontendSignal returns false for 'without a frontend'", () => {
  assert.ok(!hasFrontendSignal("express backend without a frontend"));
});
runCase("hasFrontendSignal returns false for 'headless api'", () => {
  assert.ok(!hasFrontendSignal("headless api service"));
});
runCase("hasFrontendSignal returns false for 'no react frontend' (negated framework)", () => {
  assert.ok(!hasFrontendSignal("symfony backend, no react frontend"));
});
runCase("hasFrontendSignal does not match substrings ('spa' in 'aerospace')", () => {
  assert.ok(!hasFrontendSignal("aerospace telemetry ingestion service"));
});

// hasBackendSignal unit tests
runCase("hasBackendSignal returns true for 'rest api'", () => {
  assert.ok(hasBackendSignal("rest api service"));
});
runCase("hasBackendSignal returns true for 'graphql backend'", () => {
  assert.ok(hasBackendSignal("graphql backend server"));
});
runCase("hasBackendSignal returns true for 'postgres database'", () => {
  assert.ok(hasBackendSignal("postgres database persistence layer"));
});
runCase("hasBackendSignal returns false for 'no backend'", () => {
  assert.ok(!hasBackendSignal("next.js app, no backend"));
});
runCase("hasBackendSignal returns false for 'frontend-only static site'", () => {
  assert.ok(!hasBackendSignal("frontend-only static site with tailwind"));
});

// Bug 1 fix: frontend-only Next.js intake -> nextjs-frontend (unit test via direct export)
runCase("selector Bug 1: frontend-only Next.js intake selects nextjs-frontend", () => {
  const input = {
    projectName: "admin-ui",
    summary: "Next.js dashboard frontend for internal operators, TypeScript, Tailwind, no backend.",
    coreFeatures: ["React component library", "Tailwind styling", "client-side data table"],
    constraints: ["TypeScript", "no backend", "Tailwind CSS"],
    integrations: []
  };
  // Provide stub output and scaffoldkitContext (no root -> candidates[0] is chosen)
  const output = {
    architectureRecommendation: { shape: "monolith" },
    plannerProfile: "product"
  };
  const scaffoldkitContext = { root: "", availableBlueprints: [] };
  const result = scaffoldkitBlueprintRecommendation(input, output, scaffoldkitContext);
  assert.equal(result.blueprint, "nextjs-frontend", `expected nextjs-frontend, got ${result.blueprint}`);
  assert.equal(result.confidence, "strong");
});

// Bug 2 fix: PHP/Symfony + "no frontend" -> symfony-backend (unit test)
runCase("selector Bug 2: PHP/Symfony + 'no frontend' negation selects symfony-backend", () => {
  const input = {
    projectName: "partner-api",
    summary: "Symfony REST API backend, no frontend.",
    coreFeatures: ["REST API for partner data", "PHPUnit test suite"],
    constraints: ["PHP 8.3", "Symfony 7"],
    integrations: []
  };
  const output = {
    architectureRecommendation: { shape: "monolith" },
    plannerProfile: "product"
  };
  const scaffoldkitContext = { root: "", availableBlueprints: [] };
  const result = scaffoldkitBlueprintRecommendation(input, output, scaffoldkitContext);
  assert.equal(result.blueprint, "symfony-backend", `expected symfony-backend, got ${result.blueprint}`);
  // The negated intake must reach the STRONG "backend without frontend" branch,
  // not the generic medium baseline (which carries an inaccurate manual-adaptation
  // caveat). This pins the Branch B inline-negation fix.
  assert.equal(result.confidence, "strong", `expected strong confidence, got ${result.confidence}`);
  assert.match(result.reason, /without frontend/);
  assert.equal(result.agentMustCreateStructure, false);
});

// Bug 2 positive control: PHP/Symfony + real React frontend -> symfony-nextjs still works
runCase("selector Bug 2 positive control: PHP/Symfony + react frontend selects symfony-nextjs", () => {
  const input = {
    projectName: "partner-dashboard",
    summary: "Symfony API with a React dashboard for partner support teams.",
    coreFeatures: ["Symfony backend for partner data", "React dashboard for operators"],
    constraints: ["PHP 8.3", "Symfony 7"],
    integrations: []
  };
  const output = {
    architectureRecommendation: { shape: "monolith" },
    plannerProfile: "product"
  };
  const scaffoldkitContext = { root: "", availableBlueprints: [] };
  const result = scaffoldkitBlueprintRecommendation(input, output, scaffoldkitContext);
  assert.equal(result.blueprint, "symfony-nextjs", `expected symfony-nextjs, got ${result.blueprint}`);
});

// Regression: a clear backend intake must NOT select nextjs-frontend
runCase("regression: rest json api service intake does not select nextjs-frontend", () => {
  const input = {
    projectName: "data-api",
    summary: "REST JSON API service for ingesting and querying event data.",
    coreFeatures: ["POST /events endpoint", "GET /events query", "PostgreSQL persistence"],
    constraints: ["TypeScript", "stateless service"],
    integrations: []
  };
  const output = {
    architectureRecommendation: { shape: "monolith" },
    plannerProfile: "product"
  };
  const scaffoldkitContext = { root: "", availableBlueprints: [] };
  const result = scaffoldkitBlueprintRecommendation(input, output, scaffoldkitContext);
  assert.notEqual(result.blueprint, "nextjs-frontend", `expected NOT nextjs-frontend, got ${result.blueprint}`);
});

// --- Stack routing fix: Java/Spring -> springboot-backend; unspecified -> express-api ---

runCase("java/spring intakes select the springboot-backend blueprint with java task paths", () => {
  const fixtureDir = tempDir("planforge-springboot-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Order Service",
    summary: "A backend service for managing orders.",
    targetUsers: ["internal systems"],
    coreFeatures: ["create and update orders", "query orders"],
    constraints: ["Java 21", "Spring Boot", "must run in Docker"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const output = readJson(planningFile(outdir, "plan-output.json"));

  assert.equal(scaffoldkit.blueprint, "springboot-backend");
  assert.equal(scaffoldkit.blueprintConfidence, "strong");
  assert.equal(scaffoldkit.stack.hint, "Java/Spring application");
  assert.equal(scaffoldkit.suggestedVariables.java_version, "21");
  assert.equal(scaffoldkit.suggestedVariables.database, "postgresql");
  // base_package and build_tool are intentionally NOT overridden: the Java task
  // paths and the pom.xml manifest are generated for the blueprint defaults
  // (com.example.app, maven), so overriding them would diverge from the scaffold.
  assert.equal(scaffoldkit.suggestedVariables.base_package, undefined);
  assert.equal(scaffoldkit.suggestedVariables.build_tool, undefined);
  assert.equal(output.scaffoldBlueprint, "springboot-backend");

  // springboot-backend has neither a language nor a framework variable; the
  // planner must not leak python/typescript stack vars onto it.
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "language"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scaffoldkit.suggestedVariables, "framework"), false);

  // Java feature task paths, not the Python/FastAPI or TypeScript layout.
  const featureFiles = output.tasks.filter((task) => task.category === "feature").flatMap((task) => task.files);
  assert.ok(featureFiles.length > 0);
  assert.ok(
    featureFiles.every((file) => file.endsWith(".java")),
    `expected java feature paths, got: ${featureFiles.join(", ")}`
  );
  // The feature path package must match the scaffold's base_package default exactly,
  // not a slug-derived package the scaffold never creates.
  assert.ok(featureFiles.some((file) => /^src\/main\/java\/com\/example\/app\/.+Controller\.java$/.test(file)));
  assert.ok(
    featureFiles.every((file) => /^src\/(main|test)\/java\/com\/example\/app\//.test(file)),
    `java feature paths diverge from base_package com.example.app: ${featureFiles.join(", ")}`
  );
  assert.ok(
    featureFiles.every((file) => !/\.(py|tsx?)$/.test(file)),
    `java intake leaked python/ts paths: ${featureFiles.join(", ")}`
  );

  // The foundation manifest must be pom.xml, not package.json or pyproject.toml.
  const setupTask = output.tasks.find((task) => /set up repository/i.test(task.title));
  assert.ok(setupTask, "expected a 'set up repository' foundation task");
  assert.ok(setupTask.files.includes("pom.xml"), `setup task should list pom.xml, got: ${setupTask.files.join(", ")}`);
  assert.ok(!setupTask.files.includes("package.json"));
  assert.ok(!setupTask.files.includes("pyproject.toml"));
});

runCase("unspecified-stack intakes default to express-api (TS/Node), not a python rest-api", () => {
  const fixtureDir = tempDir("planforge-neutral-default-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "Generic Thing",
    summary: "A small service that does some processing for an internal team.",
    targetUsers: ["internal team"],
    coreFeatures: ["process incoming items", "store results", "expose a way to read results"],
    constraints: []
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const output = readJson(planningFile(outdir, "plan-output.json"));

  // The no-signal fallback must be the neutral TS/Node express-api, never the
  // Python/FastAPI rest-api that previously surprised users who left constraints empty.
  assert.equal(scaffoldkit.blueprint, "express-api");
  assert.notEqual(scaffoldkit.suggestedVariables.framework, "fastapi");

  const featureFiles = output.tasks.filter((task) => task.category === "feature").flatMap((task) => task.files);
  assert.ok(featureFiles.length > 0);
  assert.ok(
    featureFiles.every((file) => !file.endsWith(".py")),
    `unspecified stack leaked python paths: ${featureFiles.join(", ")}`
  );
  assert.ok(featureFiles.some((file) => /\.ts$/.test(file)));
});

// inferTechStack / selector / blueprintLanguage unit tests for the fix
runCase("inferTechStack detects Java/Spring keywords", () => {
  assert.equal(inferTechStack({ constraints: ["Java", "Spring Boot"] }), "Java/Spring application");
  assert.equal(
    inferTechStack({ summary: "A service built with Gradle and Hibernate", constraints: [] }),
    "Java/Spring application"
  );
});

runCase("inferTechStack does not match 'java' inside 'javascript'", () => {
  assert.notEqual(inferTechStack({ constraints: ["javascript only"] }), "Java/Spring application");
});

runCase("selector: Java/Spring intake selects springboot-backend at strong confidence", () => {
  const input = {
    projectName: "order-svc",
    summary: "Spring Boot backend for orders.",
    coreFeatures: ["order CRUD"],
    constraints: ["Java 21", "Spring Boot"],
    integrations: []
  };
  const output = { architectureRecommendation: { shape: "modular monolith" }, plannerProfile: "product" };
  const result = scaffoldkitBlueprintRecommendation(input, output, { root: "", availableBlueprints: [] });
  assert.equal(result.blueprint, "springboot-backend", `expected springboot-backend, got ${result.blueprint}`);
  assert.equal(result.confidence, "strong");
});

runCase("selector: unspecified stack falls back to express-api, not rest-api", () => {
  const input = {
    projectName: "thing",
    summary: "A small internal processing service.",
    coreFeatures: ["process items", "store results"],
    constraints: [],
    integrations: []
  };
  const output = { architectureRecommendation: { shape: "modular monolith" }, plannerProfile: "product" };
  const result = scaffoldkitBlueprintRecommendation(input, output, { root: "", availableBlueprints: [] });
  assert.equal(result.blueprint, "express-api", `expected express-api, got ${result.blueprint}`);
});

runCase("blueprintLanguage maps springboot-backend to java and leaves rest-api defaults intact", () => {
  assert.equal(blueprintLanguage("springboot-backend", { constraints: ["Java"] }), "java");
  // Regression: rest-api keeps its python default for an unspecified/python stack,
  // and typescript for a TS service stack — unchanged by this fix.
  assert.equal(blueprintLanguage("rest-api", { constraints: ["python"] }), "python");
  assert.equal(blueprintLanguage("rest-api", { constraints: ["typescript"] }), "typescript");
});

runCase("negative control: a bare-'spring' marketing/blog site does not route to springboot-backend", () => {
  // 'spring' as a season/brand must NOT trip the JVM signal; only qualified forms
  // (spring boot, spring mvc, ...) or java/kotlin/etc. should route to springboot.
  const input = {
    projectName: "Spring Fashion",
    summary: "A marketing landing page for our spring fashion collection and a blog.",
    coreFeatures: ["hero landing page", "lookbook gallery", "blog"],
    constraints: [],
    integrations: []
  };
  assert.equal(inferTechStack(input), "application stack to be confirmed");
  const output = { architectureRecommendation: { shape: "modular monolith" }, plannerProfile: "product" };
  const result = scaffoldkitBlueprintRecommendation(input, output, { root: "", availableBlueprints: [] });
  assert.notEqual(result.blueprint, "springboot-backend", `bare 'spring' wrongly routed to springboot: ${result.blueprint}`);
});

runCase("digit-leading Java project name does not produce an invalid base_package or divergent paths", () => {
  const fixtureDir = tempDir("planforge-springboot-digit-");
  writeJson(path.join(fixtureDir, "input.json"), {
    projectName: "3D Print Manager",
    summary: "A Spring Boot backend for managing 3D print jobs.",
    targetUsers: ["makers"],
    coreFeatures: ["queue print jobs", "track printer status"],
    constraints: ["Java 21", "Spring Boot"]
  });

  const result = runPlanner(["--input", "input.json", "--outdir", "out"], { cwd: fixtureDir });
  assert.equal(result.status, 0, result.stderr);

  const outdir = path.join(fixtureDir, "out");
  const scaffoldkit = readJson(exportsFile(outdir, "scaffoldkit-input.json"));
  const output = readJson(planningFile(outdir, "plan-output.json"));

  assert.equal(scaffoldkit.blueprint, "springboot-backend");
  // No slug-derived base_package override (which would be the uncompilable
  // com.example.3dprintmanager); the scaffold uses the valid default com.example.app
  // and the planned Java paths match it.
  assert.equal(scaffoldkit.suggestedVariables.base_package, undefined);
  const featureFiles = output.tasks.filter((task) => task.category === "feature").flatMap((task) => task.files);
  assert.ok(featureFiles.length > 0);
  assert.ok(
    featureFiles.every((file) => /^src\/(main|test)\/java\/com\/example\/app\//.test(file)),
    `digit-leading java intake produced divergent paths: ${featureFiles.join(", ")}`
  );
});

console.log("All tests passed.");
