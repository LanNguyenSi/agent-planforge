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

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function renderTemplate(repoRoot, relativeTemplatePath, values) {
  const template = readText(path.join(repoRoot, relativeTemplatePath));
  return Object.entries(values).reduce((content, [key, value]) => {
    return content.replaceAll(`{{${key}}}`, value);
  }, template);
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

function intakeSignals(input) {
  const missingInformation = [];
  const followUpQuestions = [];

  if (!input.summary || input.summary.trim().length < 20) {
    missingInformation.push("Problem statement is too short to guide architecture confidently.");
    followUpQuestions.push("What exact problem does the product solve, and what does success look like?");
  }

  if (!input.targetUsers || input.targetUsers.length === 0) {
    missingInformation.push("Target users are missing.");
    followUpQuestions.push("Who are the primary users or operators of the system?");
  }

  if (!input.coreFeatures || input.coreFeatures.length === 0) {
    missingInformation.push("Core features are missing.");
    followUpQuestions.push("What are the first must-have capabilities for the product?");
  }

  if (!input.constraints || input.constraints.length === 0) {
    missingInformation.push("Constraints are missing.");
    followUpQuestions.push("What constraints matter most right now: time, budget, technology, compliance, or team capability?");
  }

  if (!input.nonFunctionalRequirements || input.nonFunctionalRequirements.length === 0) {
    missingInformation.push("Non-functional requirements are not defined.");
    followUpQuestions.push("What non-functional expectations matter most: performance, availability, security, auditability, or scalability?");
  }

  if ((input.integrations || []).length === 0) {
    followUpQuestions.push("Are there external integrations, identity providers, or messaging systems the product must rely on?");
  }

  if (input.dataSensitivity === "high" || input.dataSensitivity === "regulated") {
    followUpQuestions.push("What specific sensitive or regulated data types will the system handle?");
  }

  let intakeCompleteness = "complete";
  if (missingInformation.length > 0 && missingInformation.length < 3) {
    intakeCompleteness = "partial";
  } else if (missingInformation.length >= 3) {
    intakeCompleteness = "insufficient";
  }

  return {
    intakeCompleteness,
    missingInformation,
    followUpQuestions
  };
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

function architectureOptions(input, phase) {
  const integrations = (input.integrations || []).length;
  const needsAsync =
    input.coreFeatures.some((feature) => /workflow|approval|notification|queue/i.test(feature)) ||
    integrations >= 3;
  const enterpriseLike = phase === "phase_3";

  const options = [
    {
      id: "option-a",
      name: "Lean Modular Monolith",
      shape: "modular monolith",
      summary: "One deployable application with explicit domain modules and a single primary data store.",
      scores: {
        deliverySpeed: 5,
        operationalSimplicity: 5,
        scalabilityHeadroom: enterpriseLike ? 3 : 4,
        governanceFit: enterpriseLike ? 3 : 4
      },
      strengths: [
        "Fastest path to a coherent first release.",
        "Lowest coordination and deployment overhead.",
        "Strong fit for small teams."
      ],
      tradeoffs: [
        "Harder to isolate workloads if scale diverges later.",
        "Governance boundaries rely more on discipline than on topology."
      ]
    },
    {
      id: "option-b",
      name: "Modular Monolith With Background Jobs",
      shape: "modular monolith with background jobs",
      summary: "Single primary deployable unit with explicit modules plus a worker path for async workflows and integrations.",
      scores: {
        deliverySpeed: 4,
        operationalSimplicity: 4,
        scalabilityHeadroom: 4,
        governanceFit: enterpriseLike ? 4 : 4
      },
      strengths: [
        "Balances fast delivery with explicit async workflow support.",
        "Keeps the system operable without early service sprawl.",
        "Supports clearer control points for integrations and audit workflows."
      ],
      tradeoffs: [
        "Slightly more moving parts than a pure monolith.",
        "Still requires later extraction if independent scaling becomes dominant."
      ]
    },
    {
      id: "option-c",
      name: "Early Service Separation",
      shape: "small service-oriented split",
      summary: "Separate user-facing application, workflow engine, and integration boundary early for stronger isolation.",
      scores: {
        deliverySpeed: 2,
        operationalSimplicity: 2,
        scalabilityHeadroom: 5,
        governanceFit: enterpriseLike ? 5 : 3
      },
      strengths: [
        "Stronger hard boundaries for scaling and ownership.",
        "Can align better with strict isolation or governance requirements."
      ],
      tradeoffs: [
        "Higher delivery and operational cost from the start.",
        "Adds distributed failure modes before the product is proven."
      ]
    }
  ];

  if (!needsAsync) {
    options[1].scores.deliverySpeed = 3;
    options[1].scores.operationalSimplicity = 3;
    options[1].tradeoffs.push("Async worker infrastructure may be premature if workflows stay simple.");
  }

  return options;
}

function architectureRecommendation(options, phase) {
  const sorted = options
    .map((option) => ({
      option,
      total:
        option.scores.deliverySpeed +
        option.scores.operationalSimplicity +
        option.scores.scalabilityHeadroom +
        option.scores.governanceFit
    }))
    .sort((left, right) => right.total - left.total);

  const recommendation = sorted[0].option;
  const reasons = [
    "This option offers the best balance between delivery speed and long-term maintainability.",
    "It avoids premature distributed complexity while keeping room for future extraction."
  ];

  if (phase === "phase_3") {
    reasons.push("It gives stronger support for governance and audit needs without forcing an early microservice split.");
  }

  return {
    optionId: recommendation.id,
    shape: recommendation.shape,
    summary: `Start with ${recommendation.shape} as the default architecture.`,
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

  const featureTaskIndex = new Map();

  input.coreFeatures.forEach((feature, index) => {
    const taskId = String(index + 3).padStart(3, "0");
    featureTaskIndex.set(feature.toLowerCase(), taskId);
  });

  const approvalTaskId = Array.from(featureTaskIndex.entries()).find(([featureName]) =>
    /approval|request/.test(featureName)
  )?.[1];

  input.coreFeatures.forEach((feature, index) => {
    const taskId = String(index + 3).padStart(3, "0");
    const lower = feature.toLowerCase();
    const dependsOn = ["001", "002"];

    if (/audit/.test(lower) && approvalTaskId && approvalTaskId !== taskId) {
      dependsOn.push(approvalTaskId);
    }
    if (/dashboard/.test(lower) && approvalTaskId && approvalTaskId !== taskId) {
      dependsOn.push(approvalTaskId);
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
  const intake = intakeSignals(input);
  const options = architectureOptions(input, phase);
  const architecture = architectureRecommendation(options, phase);
  const tasks = buildTasks(input, phase);
  return {
    projectName: input.projectName,
    intakeCompleteness: intake.intakeCompleteness,
    missingInformation: intake.missingInformation,
    followUpQuestions: intake.followUpQuestions,
    phase,
    phaseRationale: phaseRationale(input, phase),
    path: pathName,
    recommendedPlaybooks: recommendedPlaybooks(phase),
    recommendedGuidanceAreas: recommendedGuidanceAreas(phase),
    recommendedArtifacts: recommendedArtifacts(phase),
    architectureOptions: options,
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

- Intake completeness: ${output.intakeCompleteness}
- Phase: ${output.phase}
- Path: ${output.path}
- Data sensitivity: ${input.dataSensitivity || "low"}

## Missing Information

${toMarkdownList(output.missingInformation)}

## Follow-Up Questions

${toMarkdownList(output.followUpQuestions)}

## Open Questions

${toMarkdownList(output.openQuestions)}
`;
}

function renderArchitectureOverview(input, output) {
  const options = output.architectureOptions.map((option) => {
    const scores = [
      `- Delivery speed: ${option.scores.deliverySpeed}/5`,
      `- Operational simplicity: ${option.scores.operationalSimplicity}/5`,
      `- Scalability headroom: ${option.scores.scalabilityHeadroom}/5`,
      `- Governance fit: ${option.scores.governanceFit}/5`
    ].join("\n");

    return `## ${option.name}

Shape: ${option.shape}

${option.summary}

### Scores

${scores}

### Strengths

${toMarkdownList(option.strengths)}

### Tradeoffs

${toMarkdownList(option.tradeoffs)}`;
  }).join("\n\n");

  return `# Architecture Overview: ${input.projectName}

## Recommended Starting Point

${output.architectureRecommendation.summary}

Recommended option: ${output.architectureRecommendation.optionId}

## Reasons

${toMarkdownList(output.architectureRecommendation.reasons)}

## Architecture Options

${options}

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
  return adr;
}

function renderTask(task) {
  return task;
}

function renderAdrDocument(repoRoot, input, adr) {
  return renderTemplate(repoRoot, "templates/adr-template.md", {
    id: adr.id,
    title: adr.title,
    context: `Project: ${input.projectName}\n\nSummary: ${input.summary}`,
    decision: adr.decision,
    positiveConsequences: "- Faster alignment on a high-leverage decision.\n- Better reviewability for future changes.",
    negativeConsequences: "- This decision may need revision as requirements sharpen.",
    followUp: "- Validate this ADR during the first implementation wave.\n- Update if significant scope or risk assumptions change."
  });
}

function renderTaskDocument(repoRoot, task) {
  return renderTemplate(repoRoot, "templates/task-template.md", {
    id: task.id,
    title: task.title,
    category: task.category,
    priority: task.priority,
    wave: task.wave,
    deliveryPhase: task.deliveryPhase,
    dependsOn: toMarkdownList(task.dependsOn),
    blocks: toMarkdownList(task.blocks),
    summary: task.summary,
    implementationNotes: "- Start from the dependency chain above.\n- Keep scope small and independently reviewable.\n- Update tests and docs with the change."
  });
}

function renderRunbookBaseline(repoRoot, input, output) {
  return renderTemplate(repoRoot, "templates/runbook-template.md", {
    title: `${input.projectName} Release Readiness`,
    purpose: "Guide a basic release verification and rollback-oriented watch period for the first production-capable versions.",
    signals: "- Deployment pipeline result\n- Error rate and latency dashboards\n- Health checks for critical paths",
    preconditions: `- Latest plan phase: ${output.phase}\n- Release owner assigned\n- Rollback path understood`,
    procedure: "1. Confirm deployment completed successfully.\n2. Verify critical health and smoke checks.\n3. Watch error and latency signals.\n4. Confirm the highest-value user path still works.\n5. Escalate immediately if the agreed rollback trigger is hit.",
    rollbackOrEscalation: "- Roll back to the last known-good release if critical signals regress.\n- Notify the release owner and affected stakeholders.\n- Capture key evidence before restarting or re-deploying.",
    evidence: "- Deployment identifier\n- Dashboard screenshots or links\n- Notes about anomalies and actions taken"
  });
}

function renderServiceOwnership(repoRoot, input) {
  return renderTemplate(repoRoot, "templates/service-ownership-template.md", {
    projectName: input.projectName,
    purpose: input.summary,
    businessCriticality: input.dataSensitivity === "regulated" ? "Critical" : "High",
    serviceOwner: "TBD",
    backupOwner: "TBD",
    productOwner: "TBD",
    platformOwner: "TBD",
    securityOwner: "TBD",
    dependencies: toMarkdownList(input.integrations || []),
    serviceExpectation: "TBD",
    supportPath: "TBD",
    deploymentOwner: "TBD",
    rollbackOwner: "TBD",
    dataClasses: input.dataSensitivity || "low",
    privilegedOperations: "Define admin, approval, and data export actions.",
    accessReviewCadence: "Quarterly or before major release milestones.",
    runbooks: "runbooks/release-readiness.md",
    dashboards: "TBD",
    alerts: "TBD"
  });
}

function renderDataClassification(repoRoot, input) {
  const sensitivity = input.dataSensitivity || "low";
  return renderTemplate(repoRoot, "templates/data-classification-matrix.md", {
    publicExamples: "Marketing copy, public documentation",
    internalExamples: "Internal configuration, planning notes",
    confidentialExamples: sensitivity === "high" || sensitivity === "regulated" ? "Customer records, approval metadata" : "Business workflow data",
    restrictedExamples: sensitivity === "regulated" ? "Regulated personal data, credentials, financial records" : "Secrets, privileged tokens",
    notes: `Data sensitivity from planning input: ${sensitivity}. Refine this matrix before implementation if new regulated or customer data classes appear.`
  });
}

function renderAccessReview(repoRoot, input) {
  return renderTemplate(repoRoot, "templates/access-review-template.md", {
    projectName: input.projectName,
    systemsInScope: input.projectName,
    environmentsInScope: "staging, production",
    humanRoles: "engineering, operations, security, support",
    machineIdentities: "application runtime, CI/CD, background workers",
    productionAccessCadence: "Quarterly",
    administrativeAccessCadence: "Monthly",
    thirdPartyAccessCadence: "Quarterly",
    breakGlassCadence: "After every use and quarterly at minimum",
    primaryOwner: "TBD",
    backupOwner: "TBD",
    reviewCriteria: "- Least privilege still valid\n- Departed users removed\n- Temporary access expired\n- Privileged access justified"
  });
}

function renderExceptionRegister(repoRoot, input) {
  return renderTemplate(repoRoot, "templates/exception-register-template.md", {
    projectName: input.projectName,
    exampleControl: "Formal access review process",
    exampleException: "Temporary manual review until the first production release",
    exampleBusinessReason: "The team is still in early delivery and has not automated identity workflows yet.",
    exampleRiskLevel: "Medium",
    exampleCompensatingControls: "Manual reviewer sign-off and documented changes",
    exampleOwner: "TBD",
    exampleApprover: "TBD",
    notes: "Replace the seed example with real exceptions only when a control gap is consciously accepted."
  });
}

function writeTemplateArtifacts(repoRoot, input, output, outdir) {
  output.adrCandidates.forEach((adr, index) => {
    const filename = `${String(index + 1).padStart(3, "0")}-${adr.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`;
    writeFile(path.join(outdir, "adrs", filename), renderAdrDocument(repoRoot, input, adr));
  });

  output.tasks.forEach((task) => {
    writeFile(
      path.join(outdir, "tasks", `${task.id}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`),
      renderTaskDocument(repoRoot, task)
    );
  });

  if (output.phase === "phase_2" || output.phase === "phase_3") {
    writeFile(path.join(outdir, "runbooks", "release-readiness.md"), renderRunbookBaseline(repoRoot, input, output));
  }

  if (output.path === "enterprise") {
    writeFile(path.join(outdir, "governance", "service-ownership.md"), renderServiceOwnership(repoRoot, input));
    writeFile(path.join(outdir, "governance", "data-classification-matrix.md"), renderDataClassification(repoRoot, input));
    writeFile(path.join(outdir, "governance", "access-review-plan.md"), renderAccessReview(repoRoot, input));
    writeFile(path.join(outdir, "governance", "exception-register.md"), renderExceptionRegister(repoRoot, input));
  }
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
  writeTemplateArtifacts(repoRoot, input, output, outdir);

  console.log(`Generated planning artifacts in ${outdir}`);
}

main();
