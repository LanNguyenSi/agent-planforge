#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = { input: "", outdir: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--outdir") {
      args.outdir = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function inferPhase(input) {
  const hasEnterpriseSignals =
    input.dataSensitivity === "regulated" ||
    input.dataSensitivity === "high" ||
    (input.enterpriseRequirements || []).length > 0;

  if (hasEnterpriseSignals) {
    return "phase_3";
  }
  if (input.liveUsers) {
    return "phase_2";
  }
  if (input.productionExpectedSoon || input.coreFeatures.length > 0) {
    return "phase_1";
  }
  return "phase_0";
}

function inferPath(phase) {
  return phase === "phase_3" ? "enterprise" : "core";
}

function phaseRationale(input, phase) {
  const reasons = [];

  if (input.liveUsers) {
    reasons.push("Live users already depend on the system.");
  }
  if (input.productionExpectedSoon) {
    reasons.push("Production delivery is expected soon.");
  }
  if (input.dataSensitivity === "high" || input.dataSensitivity === "regulated") {
    reasons.push("The project handles high-sensitivity or regulated data.");
  }
  if ((input.enterpriseRequirements || []).length > 0) {
    reasons.push("Enterprise or governance expectations are already present.");
  }
  if (!reasons.length) {
    reasons.push("The current input looks exploratory and low-risk.");
  }

  reasons.push(`Selected planning phase: ${phase}.`);
  return reasons;
}

function recommendedPlaybooks(phase) {
  return [
    "playbooks/planning-and-scoping.md"
  ];
}

function recommendedGuidanceAreas(phase) {
  const areas = [
    "project setup",
    "architecture"
  ];

  if (phase === "phase_0") {
    return areas.concat([
      "documentation"
    ]);
  }
  if (phase === "phase_1") {
    return areas.concat([
      "development workflow",
      "testing strategy",
      "quality assurance",
      "documentation"
    ]);
  }
  if (phase === "phase_2") {
    return areas.concat([
      "development workflow",
      "testing strategy",
      "quality assurance",
      "documentation",
      "production readiness",
      "incident readiness"
    ]);
  }
  return areas.concat([
    "development workflow",
    "testing strategy",
    "quality assurance",
    "documentation",
    "production readiness",
    "security and governance",
    "change management and incidents"
  ]);
}

function recommendedArtifacts(phase) {
  const artifacts = [
    "project-charter.md",
    "architecture-overview.md",
    "adrs/",
    "tasks/"
  ];

  if (phase === "phase_2" || phase === "phase_3") {
    artifacts.push("runbook baseline");
  }

  if (phase === "phase_3") {
    artifacts.push("service ownership record");
    artifacts.push("data classification matrix");
    artifacts.push("access review plan");
    artifacts.push("exception register");
  }

  return artifacts;
}

function architectureRecommendation(input, phase) {
  const integrations = (input.integrations || []).length;
  const needsAsync =
    input.coreFeatures.some((feature) => /workflow|approval|notification|queue/i.test(feature)) ||
    integrations >= 3;

  const shape = needsAsync
    ? "modular monolith with background jobs"
    : "modular monolith";

  const reasons = [
    "Keeps initial delivery and deployment simple.",
    "Supports clear module boundaries without early distributed complexity.",
    "Leaves room for later service extraction if scale or governance require it."
  ];

  if (phase === "phase_3") {
    reasons.push("Sensitive or enterprise-facing requirements justify stronger boundaries and auditability from the start.");
  }

  if (needsAsync) {
    reasons.push("Async workflows are explicit enough to justify background processing early.");
  }

  return {
    shape,
    summary: `Start with a ${shape} and explicit domain boundaries.`,
    reasons
  };
}

function adrCandidates(input, architecture) {
  const adrs = [
    {
      id: "ADR-001",
      title: "Initial Architecture Shape",
      decision: architecture.summary
    },
    {
      id: "ADR-002",
      title: "Primary Data Store",
      decision: "Use a relational primary data store unless the domain clearly requires a different model."
    }
  ];

  if ((input.integrations || []).length > 0) {
    adrs.push({
      id: "ADR-003",
      title: "Integration Strategy",
      decision: "Encapsulate third-party integrations behind internal modules and keep failure handling explicit."
    });
  }

  if (input.dataSensitivity === "high" || input.dataSensitivity === "regulated") {
    adrs.push({
      id: "ADR-004",
      title: "Security and Audit Baseline",
      decision: "Adopt stronger access control, audit logging, and reviewability from the first production version."
    });
  }

  return adrs;
}

function buildTasks(input, phase) {
  const tasks = [
    {
      id: "001",
      title: "Write project charter and architecture baseline",
      category: "foundation",
      priority: "P0",
      summary: "Capture the product scope, users, constraints, architecture shape, and open questions."
    },
    {
      id: "002",
      title: "Set up repository and delivery baseline",
      category: "foundation",
      priority: "P0",
      summary: "Create the repository structure, quality checks, and basic documentation needed for implementation."
    }
  ];

  input.coreFeatures.forEach((feature, index) => {
    tasks.push({
      id: String(index + 3).padStart(3, "0"),
      title: `Implement ${feature}`,
      category: "feature",
      priority: index < 2 ? "P0" : "P1",
      summary: `Design and implement the capability for: ${feature}.`
    });
  });

  tasks.push({
    id: String(tasks.length + 1).padStart(3, "0"),
    title: "Add integration and error-handling coverage",
    category: "quality",
    priority: "P1",
    summary: "Verify the critical path, failure handling, and integration boundaries with tests."
  });

  if (phase === "phase_2" || phase === "phase_3") {
    tasks.push({
      id: String(tasks.length + 1).padStart(3, "0"),
      title: "Prepare production readiness baseline",
      category: "operations",
      priority: "P0",
      summary: "Add observability, rollback notes, deployment verification, and runbook basics."
    });
  }

  if (phase === "phase_3") {
    tasks.push({
      id: String(tasks.length + 1).padStart(3, "0"),
      title: "Establish enterprise governance artifacts",
      category: "governance",
      priority: "P0",
      summary: "Create service ownership, data classification, access review, and exception tracking artifacts."
    });
  }

  return tasks;
}

function buildRisks(input, phase) {
  const risks = [];
  if ((input.openQuestions || []).length > 0) {
    risks.push("Important open questions remain unresolved and may shift architecture or task scope.");
  }
  if ((input.integrations || []).length > 0) {
    risks.push("Third-party integrations may slow delivery or require more explicit failure handling than expected.");
  }
  if (phase === "phase_3") {
    risks.push("Enterprise or sensitive-data expectations may introduce governance work beyond the initial feature scope.");
  }
  return risks;
}

function buildOutput(input) {
  const phase = inferPhase(input);
  const pathName = inferPath(phase);
  const architecture = architectureRecommendation(input, phase);
  return {
    projectName: input.projectName,
    phase,
    phaseRationale: phaseRationale(input, phase),
    path: pathName,
    recommendedPlaybooks: recommendedPlaybooks(phase),
    recommendedGuidanceAreas: recommendedGuidanceAreas(phase),
    recommendedArtifacts: recommendedArtifacts(phase),
    architectureRecommendation: architecture,
    adrCandidates: adrCandidates(input, architecture),
    tasks: buildTasks(input, phase),
    risks: buildRisks(input, phase),
    openQuestions: input.openQuestions || []
  };
}

function toMarkdownList(items) {
  if (!items.length) {
    return "- None";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function writeFile(targetPath, contents) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, contents, "utf8");
}

function renderProjectCharter(input, output) {
  return `# Project Charter: ${input.projectName}

## Summary

${input.summary}

## Target Users

${toMarkdownList(input.targetUsers)}

## Core Features

${toMarkdownList(input.coreFeatures)}

## Constraints

${toMarkdownList(input.constraints)}

## Non-Functional Requirements

${toMarkdownList(input.nonFunctionalRequirements || [])}

## Delivery Context

- Phase: ${output.phase}
- Path: ${output.path}
- Data sensitivity: ${input.dataSensitivity || "low"}

## Open Questions

${toMarkdownList(output.openQuestions)}
`;
}

function renderArchitectureOverview(input, output) {
  return `# Architecture Overview: ${input.projectName}

## Recommended Starting Point

${output.architectureRecommendation.summary}

## Reasons

${toMarkdownList(output.architectureRecommendation.reasons)}

## Likely Modules

- user-facing application surface
- domain and business logic modules
- persistence and integration modules
- background processing where workflows or notifications require it

## Integrations

${toMarkdownList(input.integrations || [])}

## Risks

${toMarkdownList(output.risks)}
`;
}

function renderAdr(adr) {
  return `# ${adr.id}: ${adr.title}

## Decision

${adr.decision}
`;
}

function renderTask(task) {
  return `# Task ${task.id}: ${task.title}

## Category

${task.category}

## Priority

${task.priority}

## Summary

${task.summary}
`;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.outdir) {
    console.error("Usage: node scripts/bootstrap-plan.js --input <file> --outdir <dir>");
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const input = readJson(path.resolve(repoRoot, args.input));
  const output = buildOutput(input);
  const outdir = path.resolve(repoRoot, args.outdir);

  ensureDir(outdir);
  writeFile(path.join(outdir, "plan-output.json"), `${JSON.stringify(output, null, 2)}\n`);
  writeFile(path.join(outdir, "project-charter.md"), renderProjectCharter(input, output));
  writeFile(path.join(outdir, "architecture-overview.md"), renderArchitectureOverview(input, output));

  output.adrCandidates.forEach((adr, index) => {
    const filename = `${String(index + 1).padStart(3, "0")}-${adr.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`;
    writeFile(path.join(outdir, "adrs", filename), renderAdr(adr));
  });

  output.tasks.forEach((task) => {
    writeFile(path.join(outdir, "tasks", `${task.id}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`), renderTask(task));
  });

  console.log(`Generated planning artifacts in ${outdir}`);
}

main();
