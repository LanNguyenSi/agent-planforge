#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const {
  alignmentScore,
  extractFilePath,
  matchPattern,
  resolvePatternFiles
} = require("./lib/pattern-matching");

const EXIT_CODES = {
  USAGE: 1,
  CRITICAL_ISSUES: 1,
  RUNTIME: 2
};

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const args = {
    outdir: "",
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--outdir") {
      args.outdir = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new CliError(`Unknown argument: ${arg}`, EXIT_CODES.USAGE);
    }
  }

  return args;
}

function usageText() {
  return [
    "Usage: node scripts/analyze-artifacts.js --outdir <generated-project-dir>",
    "",
    "Outputs:",
    "  outputs/consistency-report.md",
    "  prompts/analyze-prompt.md"
  ].join("\n");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(targetPath, contents) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, contents, "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function toMarkdownList(items) {
  if (!items.length) {
    return "- None";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function collectSectionLines(lines, heading) {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) {
    return [];
  }

  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("## ")) {
      break;
    }
    if (trimmed) {
      values.push(trimmed);
    }
  }
  return values;
}

function parseMarkdownListItems(lines, heading) {
  return collectSectionLines(lines, heading)
    .filter((line) => /^- /.test(line))
    .map((line) => line.replace(/^- /, "").replace(/^\[.\]\s+/, "").trim())
    .filter(Boolean);
}

function parseTaskDocument(filePath) {
  const lines = readText(filePath).split(/\r?\n/);
  const titleLine = lines.find((line) => /^# Task /.test(line)) || "";
  const titleMatch = titleLine.match(/^# Task ([0-9]+):\s+(.+)$/);

  return {
    id: titleMatch ? titleMatch[1] : path.basename(filePath).split("-")[0],
    title: titleMatch ? titleMatch[2] : "",
    wave: collectSectionLines(lines, "## Wave")[0] || "",
    dependsOn: parseMarkdownListItems(lines, "## Depends On").filter((item) => item !== "None"),
    files: parseMarkdownListItems(lines, "## Files To Create Or Modify")
  };
}

function parseDeliveryPlan(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const lines = readText(filePath).split(/\r?\n/);
  const waveMap = new Map();
  let currentWave = "";

  lines.forEach((line) => {
    const waveMatch = line.match(/^## (wave-[0-9]+)/i);
    if (waveMatch) {
      currentWave = waveMatch[1].toLowerCase();
      if (!waveMap.has(currentWave)) {
        waveMap.set(currentWave, []);
      }
      return;
    }

    const taskMatch = line.match(/^- ([0-9]{3}) /);
    if (currentWave && taskMatch) {
      waveMap.get(currentWave).push(taskMatch[1]);
    }
  });

  return waveMap;
}

function parseProjectCharter(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = readText(filePath).split(/\r?\n/);
  return parseMarkdownListItems(lines, "## Core Features");
}

function loadTaskDocuments(tasksDir) {
  const docs = new Map();
  if (!fs.existsSync(tasksDir)) {
    return docs;
  }

  fs.readdirSync(tasksDir)
    .filter((entry) => entry.endsWith(".md"))
    .forEach((entry) => {
      const task = parseTaskDocument(path.join(tasksDir, entry));
      docs.set(task.id, task);
    });

  return docs;
}

function makeIssue(severity, code, title, details, confidence = 1) {
  return {
    severity,
    code,
    title,
    details,
    confidence: Number(confidence.toFixed(2))
  };
}

function waveIndex(waveId) {
  const match = String(waveId || "").match(/wave-(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function bestAlignedPattern(files, patterns, architectureShape) {
  const candidates = Object.entries(patterns || {}).map(([patternName, pattern]) => {
    const expectedFiles = resolvePatternFiles(pattern, architectureShape);
    return {
      patternName,
      expectedFiles,
      score: alignmentScore(files, expectedFiles)
    };
  });

  candidates.sort((left, right) => right.score - left.score || left.patternName.localeCompare(right.patternName));
  return candidates[0] || null;
}

function analyzeArtifacts(projectDir, repoRoot) {
  const planOutputPath = path.join(projectDir, "plan-output.json");
  if (!fs.existsSync(planOutputPath)) {
    throw new CliError(`Missing plan-output.json in ${projectDir}`, EXIT_CODES.RUNTIME);
  }

  const planOutput = readJson(planOutputPath);
  const patterns = readJson(path.join(repoRoot, "config", "stack-patterns.json")).patterns || {};
  const taskDocs = loadTaskDocuments(path.join(projectDir, "tasks"));
  const deliveryPlan = parseDeliveryPlan(path.join(projectDir, "delivery-plan.md"));
  const charterFeatures = parseProjectCharter(path.join(projectDir, "project-charter.md"));

  const issues = [];
  const passed = [];
  const tasksById = new Map((planOutput.tasks || []).map((task) => [task.id, task]));

  if (taskDocs.size === tasksById.size) {
    passed.push("Task markdown documents exist for every planned task.");
  } else {
    issues.push(
      makeIssue(
        "warning",
        "task-doc-count",
        "Task document count differs from the plan output",
        [
          `Plan tasks: ${tasksById.size}`,
          `Task documents: ${taskDocs.size}`
        ],
        0.9
      )
    );
  }

  if (charterFeatures.length) {
    const featureTitles = new Set(
      (planOutput.tasks || [])
        .filter((task) => task.category === "feature")
        .map((task) => task.title.replace(/^Implement\s+/i, "").toLowerCase())
    );
    const missingFromPlan = charterFeatures.filter((feature) => !featureTitles.has(feature.toLowerCase()));
    if (missingFromPlan.length) {
      issues.push(
        makeIssue(
          "warning",
          "charter-feature-drift",
          "Project charter features are missing from the generated feature backlog",
          missingFromPlan.map((feature) => `Missing feature task for: ${feature}`),
          0.8
        )
      );
    } else {
      passed.push("Project charter features are reflected in the generated feature tasks.");
    }
  }

  (planOutput.tasks || []).forEach((task) => {
    const taskDoc = taskDocs.get(task.id);
    const actualFiles = taskDoc ? taskDoc.files : task.files;
    const planFiles = new Set((task.files || []).map(extractFilePath));
    const unexpectedFiles = actualFiles.map(extractFilePath).filter((filePath) => !planFiles.has(filePath));

    if (unexpectedFiles.length) {
      issues.push(
        makeIssue(
          "critical",
          "task-file-drift",
          `Task ${task.id} references files that are not in the plan`,
          unexpectedFiles.map((filePath) => `${task.id}: ${filePath}`),
          0.98
        )
      );
    }

    const dependencyWaveViolations = (task.dependsOn || []).flatMap((dependencyId) => {
      const dependency = tasksById.get(dependencyId);
      if (!dependency) {
        return [];
      }
      if (waveIndex(task.wave) < waveIndex(dependency.wave)) {
        return [`${task.id} (${task.wave}) depends on ${dependency.id} (${dependency.wave})`];
      }
      return [];
    });

    if (dependencyWaveViolations.length) {
      issues.push(
        makeIssue(
          "critical",
          "wave-ordering",
          `Task ${task.id} depends on a later execution wave`,
          dependencyWaveViolations,
          1
        )
      );
    }

    const deliveryPlanWave = Array.from(deliveryPlan.entries()).find(([, taskIds]) => taskIds.includes(task.id));
    if (deliveryPlanWave && deliveryPlanWave[0] !== String(task.wave || "").toLowerCase()) {
      issues.push(
        makeIssue(
          "warning",
          "delivery-plan-drift",
          `Task ${task.id} is assigned to a different wave in delivery-plan.md`,
          [
            `plan-output.json: ${task.wave}`,
            `delivery-plan.md: ${deliveryPlanWave[0]}`
          ],
          0.92
        )
      );
    }

    if (task.category !== "feature") {
      return;
    }

    const semanticText = [task.title, task.summary, task.problem, task.solution].join(" ");
    const semanticPattern = matchPattern(semanticText, patterns);
    if (!semanticPattern) {
      return;
    }

    if (unexpectedFiles.length) {
      const conflictingUnexpectedPatterns = unexpectedFiles
        .map((filePath) => ({
          filePath,
          match: matchPattern(filePath, patterns)
        }))
        .filter(({ match }) => match && match.patternName !== semanticPattern.patternName);

      if (conflictingUnexpectedPatterns.length) {
        issues.push(
          makeIssue(
            "critical",
            "pattern-mismatch",
            `Task ${task.id} files do not match the task's semantic pattern`,
            conflictingUnexpectedPatterns.map(
              ({ filePath, match }) =>
                `${filePath} aligns with ${match.patternName}, not ${semanticPattern.patternName}`
            ),
            0.97
          )
        );
        return;
      }
    }

    const expectedFiles = resolvePatternFiles(semanticPattern.pattern, planOutput.architectureRecommendation.shape);
    const semanticScore = alignmentScore(actualFiles, expectedFiles);
    const alignedPattern = bestAlignedPattern(actualFiles, patterns, planOutput.architectureRecommendation.shape);

    if (
      alignedPattern &&
      alignedPattern.patternName !== semanticPattern.patternName &&
      alignedPattern.score >= semanticScore + 0.2
    ) {
      const confidence = Math.max(alignedPattern.score, 1 - semanticScore);
      issues.push(
        makeIssue(
          semanticScore < 0.2 ? "critical" : "warning",
          "pattern-mismatch",
          `Task ${task.id} files do not match the task's semantic pattern`,
          [
            `Expected from task text: ${semanticPattern.patternName}`,
            `Best file-aligned pattern: ${alignedPattern.patternName}`,
            `Semantic alignment score: ${semanticScore.toFixed(2)}`,
            `Alternative alignment score: ${alignedPattern.score.toFixed(2)}`
          ],
          confidence
        )
      );
      return;
    }

    if (semanticScore >= 0.3) {
      passed.push(`Task ${task.id} files are consistent with the inferred ${semanticPattern.patternName} pattern.`);
    }
  });

  if (!issues.some((issue) => issue.code === "wave-ordering")) {
    passed.push("Wave ordering is valid for all declared task dependencies.");
  }
  if (!issues.some((issue) => issue.code === "task-file-drift")) {
    passed.push("Task documents do not introduce file references outside the plan output.");
  }
  if (!issues.some((issue) => issue.code === "pattern-mismatch")) {
    passed.push("No stack pattern mismatches were detected between task semantics and file recommendations.");
  }

  return {
    issues,
    passed
  };
}

function renderReport(projectDir, analysis) {
  const issuesSection = analysis.issues.length
    ? analysis.issues.map((issue) => {
        const details = issue.details.map((detail) => `- ${detail}`).join("\n");
        return `### ${issue.severity.toUpperCase()}: ${issue.title}

${details}
- Confidence: ${issue.confidence.toFixed(2)}`;
      }).join("\n\n")
    : "No inconsistencies detected.";

  return `# Consistency Analysis

## Summary

- Project directory: ${projectDir}
- Issues found: ${analysis.issues.length}
- Critical issues: ${analysis.issues.filter((issue) => issue.severity === "critical").length}

## Issues Found

${issuesSection}

## Passed

${toMarkdownList(analysis.passed)}
`;
}

function renderAnalyzePrompt(analysis) {
  const issues = analysis.issues.length
    ? analysis.issues.map((issue) => {
        return `- [${issue.severity}] ${issue.title} (confidence ${issue.confidence.toFixed(2)})`;
      }).join("\n")
    : "- No issues detected.";

  return `# Analyze Prompt

Review the generated planning artifacts for contradictions before implementation begins.

## Reported Issues

${issues}

## Review Goals

- Confirm task files still match the intended domain pattern.
- Confirm dependencies only point to the same or earlier execution waves.
- Confirm task markdown did not drift away from the machine-readable plan.
`;
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usageText());
      return;
    }
    if (!args.outdir) {
      throw new CliError("Missing required argument: --outdir <dir>", EXIT_CODES.USAGE);
    }

    const repoRoot = path.resolve(__dirname, "..");
    const projectDir = path.resolve(process.cwd(), args.outdir);
    const analysis = analyzeArtifacts(projectDir, repoRoot);
    const reportPath = path.join(projectDir, "outputs", "consistency-report.md");
    const promptPath = path.join(projectDir, "prompts", "analyze-prompt.md");

    writeFile(reportPath, renderReport(projectDir, analysis));
    writeFile(promptPath, renderAnalyzePrompt(analysis));

    if (analysis.issues.some((issue) => issue.severity === "critical")) {
      console.error(`Consistency analysis found critical issues. See ${reportPath}`);
      process.exit(EXIT_CODES.CRITICAL_ISSUES);
    }

    console.log(`Consistency analysis completed. Report written to ${reportPath}`);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      if (error.exitCode === EXIT_CODES.USAGE) {
        console.error(usageText());
      }
      process.exit(error.exitCode);
    }

    console.error(`Consistency analysis failed: ${error.message}`);
    process.exit(EXIT_CODES.RUNTIME);
  }
}

main();
