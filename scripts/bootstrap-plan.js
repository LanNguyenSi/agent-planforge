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

function makeTask(id, title, category, priority, summary, wave, dependsOn, deliveryPhase) {
  return {
    id,
    title,
    category,
    priority,
    summary,
    wave,
    dependsOn,
    blocks: [],
    deliveryPhase
  };
}

function connectBlocks(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  tasks.forEach((task) => {
    task.dependsOn.forEach((dependencyId) => {
      const dependency = byId.get(dependencyId);
      if (dependency) {
        dependency.blocks.push(task.id);
      }
    });
  });
  return tasks;
}

function buildTasks(input, phase) {
  const tasks = [
    makeTask(
      "001",
      "Write project charter and architecture baseline",
      "foundation",
      "P0",
      "Capture the product scope, users, constraints, architecture shape, and open questions.",
      "wave-1",
      [],
      "foundation"
    ),
    makeTask(
      "002",
      "Set up repository and delivery baseline",
      "foundation",
      "P0",
      "Create the repository structure, quality checks, and basic documentation needed for implementation.",
      "wave-1",
      ["001"],
      "foundation"
    )
  ];

  input.coreFeatures.forEach((feature, index) => {
    const taskId = String(index + 3).padStart(3, "0");
    const lower = feature.toLowerCase();
    const dependsOn = ["001", "002"];

    if (/audit/.test(lower)) {
      dependsOn.push("004");
    }
    if (/dashboard/.test(lower)) {
      dependsOn.push("004");
    }

    tasks.push(
      makeTask(
        taskId,
        `Implement ${feature}`,
        "feature",
        index < 2 ? "P0" : "P1",
        `Design and implement the capability for: ${feature}.`,
        index < 2 ? "wave-2" : "wave-3",
        Array.from(new Set(dependsOn)),
        "implementation"
      )
    );
  });

  const featureTaskIds = tasks.filter((task) => task.category === "feature").map((task) => task.id);

  tasks.push(
    makeTask(
      String(tasks.length + 1).padStart(3, "0"),
      "Add integration and error-handling coverage",
      "quality",
      "P1",
      "Verify the critical path, failure handling, and integration boundaries with tests.",
      "wave-4",
      featureTaskIds,
      "hardening"
    )
  );

  if (phase === "phase_2" || phase === "phase_3") {
    tasks.push(
      makeTask(
        String(tasks.length + 1).padStart(3, "0"),
        "Prepare production readiness baseline",
        "operations",
        "P0",
        "Add observability, rollback notes, deployment verification, and runbook basics.",
        "wave-4",
        ["002"],
        "launch"
      )
    );
  }

  if (phase === "phase_3") {
    tasks.push(
      makeTask(
        String(tasks.length + 1).padStart(3, "0"),
        "Establish enterprise governance artifacts",
        "governance",
        "P0",
        "Create service ownership, data classification, access review, and exception tracking artifacts.",
        "wave-2",
        ["001"],
        "foundation"
      )
    );
  }

  return connectBlocks(tasks);
}

function executionWaves(tasks) {
  const waves = [
    {
      id: "wave-1",
      goal: "Lock scope, assumptions, and engineering baseline.",
      taskIds: tasks.filter((task) => task.wave === "wave-1").map((task) => task.id)
    },
    {
      id: "wave-2",
      goal: "Deliver the first critical capabilities and required controls.",
      taskIds: tasks.filter((task) => task.wave === "wave-2").map((task) => task.id)
    },
    {
      id: "wave-3",
      goal: "Expand feature coverage once the core path is in place.",
      taskIds: tasks.filter((task) => task.wave === "wave-3").map((task) => task.id)
    },
    {
      id: "wave-4",
      goal: "Harden, verify, and prepare the system for release.",
      taskIds: tasks.filter((task) => task.wave === "wave-4").map((task) => task.id)
    }
  ];

  return waves.filter((wave) => wave.taskIds.length > 0);
}

function dependencyGraph(tasks) {
  const edges = [];
  tasks.forEach((task) => {
    task.dependsOn.forEach((dependencyId) => {
      edges.push({
        from: dependencyId,
        to: task.id,
        reason: `${task.id} depends on ${dependencyId} for prerequisite scope, code, or control readiness.`
      });
    });
  });

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map();

  function depth(taskId) {
    if (memo.has(taskId)) {
      return memo.get(taskId);
    }
    const task = byId.get(taskId);
    if (!task || task.dependsOn.length === 0) {
      memo.set(taskId, 1);
      return 1;
    }
    const value = 1 + Math.max(...task.dependsOn.map(depth));
    memo.set(taskId, value);
    return value;
  }

  let currentId = "";
  let currentDepth = 0;
  tasks.forEach((task) => {
    const taskDepth = depth(task.id);
    if (taskDepth > currentDepth) {
      currentDepth = taskDepth;
      currentId = task.id;
    }
  });

  const criticalPathTaskIds = [];
  while (currentId) {
    criticalPathTaskIds.unshift(currentId);
    const task = byId.get(currentId);
    if (!task || task.dependsOn.length === 0) {
      break;
    }
    currentId = task.dependsOn
      .slice()
      .sort((left, right) => depth(right) - depth(left))[0];
  }

  return {
    edges,
    criticalPathTaskIds
  };
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
  const tasks = buildTasks(input, phase);
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
    tasks,
    executionWaves: executionWaves(tasks),
    dependencyGraph: dependencyGraph(tasks),
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

function renderDeliveryPlan(output) {
  const waveSections = output.executionWaves.map((wave) => {
    const lines = wave.taskIds.map((taskId) => {
      const task = output.tasks.find((candidate) => candidate.id === taskId);
      return `- ${task.id} ${task.title}`;
    });
    return `## ${wave.id}\n\n${wave.goal}\n\n${lines.join("\n")}`;
  }).join("\n\n");

  const edges = output.dependencyGraph.edges.map((edge) => `- ${edge.from} -> ${edge.to}`).join("\n") || "- None";
  const criticalPath = output.dependencyGraph.criticalPathTaskIds.join(" -> ") || "None";

  return `# Delivery Plan

## Execution Waves

${waveSections}

## Dependency Edges

${edges}

## Critical Path

${criticalPath}
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

## Wave

${task.wave}

## Delivery Phase

${task.deliveryPhase}

## Depends On

${toMarkdownList(task.dependsOn)}

## Blocks

${toMarkdownList(task.blocks)}

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
  writeFile(path.join(outdir, "delivery-plan.md"), renderDeliveryPlan(output));

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
