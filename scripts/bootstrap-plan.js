#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");

const EXIT_CODES = {
  USAGE: 1,
  VALIDATION: 2,
  RUNTIME: 3
};

class CliError extends Error {
  constructor(message, exitCode, details = []) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

function parseArgs(argv) {
  const args = {
    input: "",
    outdir: "",
    config: "",
    format: "json",
    resumeFrom: "",
    rerunFrom: "",
    help: false,
    summary: false,
    validateOnly: false,
    install: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--input") {
      args.input = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--outdir") {
      args.outdir = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--config") {
      args.config = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--format") {
      args.format = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--resume-from") {
      args.resumeFrom = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--rerun-from") {
      args.rerunFrom = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--summary") {
      args.summary = true;
    } else if (arg === "--validate-only") {
      args.validateOnly = true;
    } else if (arg === "--install") {
      args.install = true;
    } else if (arg === "--no-install") {
      args.install = false;
    } else {
      throw new CliError(`Unknown argument: ${arg}`, EXIT_CODES.USAGE, [usageText()]);
    }
  }

  return args;
}

function usageText() {
  return [
    "Usage: node scripts/bootstrap-plan.js --input <file|-> --outdir <dir> [options]",
    "",
    "Options:",
    "  --config <file>      Override planner config JSON file with merge semantics",
    "  --format <type>      Input format: json, text, markdown",
    "  --resume-from <dir>  Resume from a previous generated output directory or plan-output.json",
    "  --rerun-from <dir>   Compare against a previous run and emit rerun metadata",
    "  --summary            Print a concise planning summary",
    "  --validate-only      Validate input, config, and generated output without writing files",
    "  --install            Run npm install after generation (default: true)",
    "  --no-install         Skip npm install after generation",
    "  --help, -h           Show this help"
  ].join("\n");
}

function readText(filePath, label = filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CliError(`Unable to read ${label}: ${error.message}`, EXIT_CODES.RUNTIME);
  }
}

function readInputSource(repoRoot, inputPath) {
  if (inputPath === "-") {
    return readText("/dev/stdin", "<stdin>");
  }
  return readText(path.resolve(repoRoot, inputPath), inputPath);
}

function readJson(filePath, label = filePath) {
  try {
    return JSON.parse(readText(filePath, label));
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(`Invalid JSON in ${label}: ${error.message}`, EXIT_CODES.VALIDATION);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(targetPath, contents) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, contents, "utf8");
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderTemplate(repoRoot, relativeTemplatePath, values) {
  const template = readText(path.join(repoRoot, relativeTemplatePath), relativeTemplatePath);
  return Object.entries(values).reduce((content, [key, value]) => {
    return content.replaceAll(`{{${key}}}`, value);
  }, template);
}

function formatSchemaErrors(errors) {
  return (errors || []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message}`;
  });
}

function validateWithSchema(repoRoot, relativeSchemaPath, value, label) {
  const schema = readJson(path.join(repoRoot, relativeSchemaPath), relativeSchemaPath);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });
  const validate = ajv.compile(schema);

  if (!validate(value)) {
    throw new CliError(`Schema validation failed for ${label}.`, EXIT_CODES.VALIDATION, formatSchemaErrors(validate.errors));
  }
}

function configPath(repoRoot) {
  return path.join(repoRoot, "config/planner-config.json");
}

function validatePlannerConfigStructure(config) {
  const profileNames = ["startup", "product", "enterprise", "platform"];
  const phases = ["phase_0", "phase_1", "phase_2", "phase_3"];
  const priorities = ["high", "medium", "low"];

  function assert(condition, message) {
    if (!condition) {
      throw new CliError(`Invalid planner config: ${message}`, EXIT_CODES.VALIDATION);
    }
  }

  assert(config && typeof config === "object", "config root must be an object");
  assert(typeof config.version === "string" && config.version.length > 0, "`version` must be a non-empty string");
  assert(profileNames.includes(config.defaultProfile), "`defaultProfile` must be one of startup, product, enterprise, platform");
  assert(config.common && typeof config.common === "object", "`common` must be present");
  assert(Array.isArray(config.common.guidanceAreasBase), "`common.guidanceAreasBase` must be an array");
  assert(config.common.guidanceAreasByPhase && typeof config.common.guidanceAreasByPhase === "object", "`common.guidanceAreasByPhase` must be present");
  assert(Array.isArray(config.common.artifactsBase), "`common.artifactsBase` must be an array");
  assert(config.common.artifactsByPhase && typeof config.common.artifactsByPhase === "object", "`common.artifactsByPhase` must be present");
  assert(config.profiles && typeof config.profiles === "object", "`profiles` must be present");
  assert(config.governanceDefaults && typeof config.governanceDefaults === "object", "`governanceDefaults` must be present");

  phases.forEach((phase) => {
    const guidance = config.common.guidanceAreasByPhase[phase];
    if (guidance !== undefined) {
      assert(Array.isArray(guidance), `common.guidanceAreasByPhase.${phase} must be an array when present`);
    }
    const artifacts = config.common.artifactsByPhase[phase];
    if (artifacts !== undefined) {
      assert(Array.isArray(artifacts), `common.artifactsByPhase.${phase} must be an array when present`);
    }
  });

  profileNames.forEach((profileName) => {
    const profile = config.profiles[profileName];
    assert(profile && typeof profile === "object", `profiles.${profileName} must be present`);
    const intakePolicy = profile.intakePolicy;
    assert(intakePolicy && typeof intakePolicy === "object", `profiles.${profileName}.intakePolicy must be present`);
    assert(priorities.includes(intakePolicy.nfrPriority), `profiles.${profileName}.intakePolicy.nfrPriority must be high, medium, or low`);
    assert(typeof intakePolicy.nfrBlocking === "boolean", `profiles.${profileName}.intakePolicy.nfrBlocking must be boolean`);
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeUnique(baseItems = [], overrideItems = []) {
  return Array.from(new Set([].concat(baseItems || [], overrideItems || [])));
}

function mergePhaseLists(base = {}, override = {}) {
  const phases = new Set(Object.keys(base || {}).concat(Object.keys(override || {})));
  const merged = {};

  phases.forEach((phase) => {
    merged[phase] = mergeUnique(base[phase] || [], override[phase] || []);
  });

  return merged;
}

function mergeProfileConfig(baseProfile = {}, overrideProfile = {}) {
  return {
    guidanceAreaAdditionsByPhase: mergePhaseLists(
      baseProfile.guidanceAreaAdditionsByPhase || {},
      overrideProfile.guidanceAreaAdditionsByPhase || {}
    ),
    artifactAdditionsByPhase: mergePhaseLists(
      baseProfile.artifactAdditionsByPhase || {},
      overrideProfile.artifactAdditionsByPhase || {}
    ),
    intakePolicy: Object.assign({}, baseProfile.intakePolicy || {}, overrideProfile.intakePolicy || {})
  };
}

function mergePlannerConfig(baseConfig, overrideConfig = {}) {
  const mergedProfiles = {};
  const profileNames = new Set(Object.keys(baseConfig.profiles || {}).concat(Object.keys(overrideConfig.profiles || {})));

  profileNames.forEach((profileName) => {
    mergedProfiles[profileName] = mergeProfileConfig(
      (baseConfig.profiles || {})[profileName] || {},
      (overrideConfig.profiles || {})[profileName] || {}
    );
  });

  return {
    version: overrideConfig.version || baseConfig.version,
    defaultProfile: overrideConfig.defaultProfile || baseConfig.defaultProfile,
    common: {
      guidanceAreasBase: mergeUnique(baseConfig.common.guidanceAreasBase, overrideConfig.common && overrideConfig.common.guidanceAreasBase),
      guidanceAreasByPhase: mergePhaseLists(
        baseConfig.common.guidanceAreasByPhase || {},
        (overrideConfig.common && overrideConfig.common.guidanceAreasByPhase) || {}
      ),
      artifactsBase: mergeUnique(baseConfig.common.artifactsBase, overrideConfig.common && overrideConfig.common.artifactsBase),
      artifactsByPhase: mergePhaseLists(
        baseConfig.common.artifactsByPhase || {},
        (overrideConfig.common && overrideConfig.common.artifactsByPhase) || {}
      )
    },
    profiles: mergedProfiles,
    governanceDefaults: Object.assign({}, baseConfig.governanceDefaults || {}, overrideConfig.governanceDefaults || {})
  };
}

function loadPlannerConfig(repoRoot, overridePath) {
  const basePath = configPath(repoRoot);
  const baseConfig = readJson(basePath, basePath);
  let mergedConfig = baseConfig;

  if (overridePath) {
    const resolvedOverridePath = path.resolve(repoRoot, overridePath);
    const overrideConfig = readJson(resolvedOverridePath, resolvedOverridePath);
    mergedConfig = mergePlannerConfig(baseConfig, overrideConfig);
  }

  validateWithSchema(repoRoot, "models/planner-config.schema.json", mergedConfig, "planner config");
  validatePlannerConfigStructure(mergedConfig);
  return mergedConfig;
}

function cleanString(value) {
  return String(value || "").replace(/^[-*#\s]+/, "").trim();
}

function uniqueNonEmpty(items) {
  return Array.from(
    new Set(
      (items || [])
        .map((item) => cleanString(item))
        .filter(Boolean)
    )
  );
}

function parseBooleanFlag(text, pattern) {
  return pattern.test(text);
}

function parseTeamSize(text) {
  const match = text.match(/\bteam(?:\s+of)?\s+(\d+)\b|\b(\d+)\s+(?:people|engineers|developers)\b/i);
  if (!match) {
    return undefined;
  }
  return Number(match[1] || match[2]);
}

function findHeadingIndex(lines, pattern) {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function collectBulletSection(lines, headingPattern) {
  const startIndex = findHeadingIndex(lines, headingPattern);
  if (startIndex === -1) {
    return [];
  }

  const items = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (items.length) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      break;
    }
    if (/^[-*]\s+/.test(line)) {
      items.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (items.length) {
      break;
    }
  }

  return items;
}

function firstNonEmptyLine(lines) {
  return lines.find((line) => line.trim().length > 0) || "";
}

function summarizeText(lines) {
  const paragraphs = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => cleanString(block.replace(/\n+/g, " ")))
    .filter(Boolean);

  return paragraphs[1] || paragraphs[0] || "";
}

function sentenceMatches(lines, pattern) {
  return uniqueNonEmpty(
    lines
      .map((line) => line.trim())
      .filter((line) => pattern.test(line))
  );
}

function inferProjectName(lines, format) {
  const firstLine = firstNonEmptyLine(lines).trim();
  if (format === "markdown") {
    const headingMatch = firstLine.match(/^#\s+(.+)$/);
    if (headingMatch) {
      return cleanString(headingMatch[1]);
    }
  }
  return cleanString(firstLine.replace(/^Title:\s*/i, "")) || "Untitled Project (confirm name)";
}

function parseUnstructuredInput(content, format) {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const bulletLines = uniqueNonEmpty(
    lines.filter((line) => /^[-*]\s+/.test(line.trim())).map((line) => line.trim().replace(/^[-*]\s+/, ""))
  );
  const warnings = [];

  const projectName = inferProjectName(lines, format);
  const summary = summarizeText(lines) || "Project summary requires confirmation from the source text.";
  const sectionUsers = collectBulletSection(lines, /^#{0,6}\s*(target users|users|audience)\b/i);
  const sectionFeatures = collectBulletSection(lines, /^#{0,6}\s*(core features|features|scope)\b/i);
  const sectionIntegrations = collectBulletSection(lines, /^#{0,6}\s*integrations\b/i);
  const explicitConstraints = collectBulletSection(lines, /^#{0,6}\s*constraints\b/i);
  const inferredConstraints = sentenceMatches(lines, /\b(must|should|cannot|can't|required|needs to|need to|without)\b/i);
  const inferredNfrs = sentenceMatches(lines, /\b(performance|availability|security|audit|auditability|scalability|latency|reliability|uptime)\b/i);
  const openQuestions = sentenceMatches(lines, /\?$/);
  const targetUsers = uniqueNonEmpty(sectionUsers.length ? sectionUsers : sentenceMatches(lines, /\b(for|used by|users?|operators?)\b/i).slice(0, 3));
  const coreFeatures = uniqueNonEmpty(sectionFeatures.length ? sectionFeatures : bulletLines.slice(0, 6));
  const constraints = uniqueNonEmpty(explicitConstraints.concat(inferredConstraints));
  const integrations = uniqueNonEmpty(sectionIntegrations.concat(sentenceMatches(lines, /\b(integrates?|sso|email|slack|github|gitlab|stripe|postgres|postgresql|mysql|queue)\b/i)));
  const enterpriseRequirements = uniqueNonEmpty(sentenceMatches(lines, /\b(compliance|audit|enterprise|soc 2|iso 27001|security review|regulated)\b/i));

  const lower = normalized.toLowerCase();
  let plannerProfile;
  if (/\bplatform\b/.test(lower)) {
    plannerProfile = "platform";
  } else if (/\benterprise\b/.test(lower)) {
    plannerProfile = "enterprise";
  } else if (/\bstartup\b/.test(lower)) {
    plannerProfile = "startup";
  }

  let dataSensitivity = "low";
  if (/\bregulated\b/.test(lower)) {
    dataSensitivity = "regulated";
  } else if (/\b(high sensitivity|sensitive|pii|financial|personal data)\b/.test(lower)) {
    dataSensitivity = "high";
  } else if (/\bmoderate\b/.test(lower)) {
    dataSensitivity = "moderate";
  }

  if (!targetUsers.length) {
    warnings.push("Could not confidently extract target users.");
  }
  if (!coreFeatures.length) {
    warnings.push("Could not confidently extract core features.");
  }
  if (!constraints.length) {
    warnings.push("Could not confidently extract constraints.");
  }

  return {
    input: {
      projectName,
      summary,
      targetUsers: targetUsers.length ? targetUsers : ["unspecified target users (confirm)"],
      coreFeatures: coreFeatures.length ? coreFeatures : ["unspecified core feature (confirm)"],
      constraints: constraints.length ? constraints : ["constraints not yet confirmed"],
      nonFunctionalRequirements: inferredNfrs,
      integrations,
      plannerProfile,
      dataSensitivity,
      teamSize: parseTeamSize(normalized),
      productionExpectedSoon: parseBooleanFlag(normalized, /\b(production|launch|ship)\b/i),
      liveUsers: parseBooleanFlag(normalized, /\b(live users|customers already use|in production)\b/i),
      enterpriseRequirements,
      openQuestions
    },
    metadata: {
      format,
      parserWarnings: warnings,
      structuredInputSource: "heuristic-extraction"
    }
  };
}

function loadPlanningInput(repoRoot, inputPath, format) {
  if (!["json", "text", "markdown"].includes(format)) {
    throw new CliError(`Unsupported format: ${format}`, EXIT_CODES.USAGE, [usageText()]);
  }

  if (format === "json") {
    const resolvedPath = inputPath === "-" ? "<stdin>" : path.resolve(repoRoot, inputPath);
    try {
      const content = readInputSource(repoRoot, inputPath);
      const input = JSON.parse(content);
      validateWithSchema(repoRoot, "models/planning-input.schema.json", input, "planning input");
      return {
        input,
        metadata: {
          format,
          parserWarnings: [],
          structuredInputSource: resolvedPath
        }
      };
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError(`Invalid JSON in ${resolvedPath}: ${error.message}`, EXIT_CODES.VALIDATION);
    }
  }

  const content = readInputSource(repoRoot, inputPath);
  const parsed = parseUnstructuredInput(content, format);
  validateWithSchema(repoRoot, "models/planning-input.schema.json", parsed.input, "planning input");
  return parsed;
}

function loadPlaybookContext(repoRoot) {
  const configuredRoot = process.env.AGENT_ENGINEERING_PLAYBOOK_ROOT
    ? path.resolve(process.env.AGENT_ENGINEERING_PLAYBOOK_ROOT)
    : path.resolve(repoRoot, "../agent-engineering-playbook");
  const externalModelPath = path.join(configuredRoot, "models", "adoption-model.json");
  const bundledModelPath = path.join(repoRoot, "models", "playbook-adoption-model.json");

  if (fs.existsSync(externalModelPath)) {
    return {
      root: configuredRoot,
      model: readJson(externalModelPath, externalModelPath)
    };
  }

  return {
    root: "",
    model: readJson(bundledModelPath, bundledModelPath)
  };
}

function resolvePlaybookPath(playbookContext, relativePath) {
  if (playbookContext.root) {
    return path.join(playbookContext.root, relativePath);
  }
  return path.join("agent-engineering-playbook", relativePath);
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

function plannerProfile(input, config) {
  return input.plannerProfile || config.defaultProfile || "product";
}

function isPlaceholderItem(value) {
  return /\b(confirm|unspecified|not yet confirmed|requires confirmation)\b/i.test(String(value || ""));
}

function hasMeaningfulItems(items) {
  return Array.isArray(items) && items.some((item) => !isPlaceholderItem(item));
}

function intakeSignals(input, config) {
  const missingInformation = [];
  const intakeQuestions = [];
  const profile = plannerProfile(input, config);
  const intakePolicy = (config.profiles[profile] && config.profiles[profile].intakePolicy) || {
    nfrPriority: "medium",
    nfrBlocking: true
  };

  function addQuestion(id, priority, question, reason, affects, blocking, missingLabel) {
    if (missingLabel) {
      missingInformation.push(missingLabel);
    }
    intakeQuestions.push({
      id,
      priority,
      question,
      reason,
      affects,
      blocking
    });
  }

  if (!input.summary || input.summary.trim().length < 20) {
    addQuestion(
      "Q-001",
      "high",
      "What exact problem does the product solve, and what does success look like?",
      "The current problem statement is too thin to guide architecture or task slicing confidently.",
      ["architecture choice", "task prioritization", "acceptance criteria"],
      true,
      "Problem statement is too short to guide architecture confidently."
    );
  }

  if (!hasMeaningfulItems(input.targetUsers)) {
    addQuestion(
      "Q-002",
      "high",
      "Who are the primary users or operators of the system?",
      "User roles influence access model, UX shape, and operational assumptions.",
      ["authorization model", "interface scope", "service ownership"],
      true,
      "Target users are missing."
    );
  }

  if (!hasMeaningfulItems(input.coreFeatures)) {
    addQuestion(
      "Q-003",
      "high",
      "What are the first must-have capabilities for the product?",
      "Without clear core features, the planner cannot produce a trustworthy backlog.",
      ["task slicing", "delivery waves", "architecture option scoring"],
      true,
      "Core features are missing."
    );
  }

  if (!hasMeaningfulItems(input.constraints)) {
    addQuestion(
      "Q-004",
      "high",
      "What constraints matter most right now: time, budget, technology, compliance, or team capability?",
      "Constraints shape architecture tradeoffs and what can realistically ship first.",
      ["architecture recommendation", "scope control", "delivery plan"],
      true,
      "Constraints are missing."
    );
  }

  if (!hasMeaningfulItems(input.nonFunctionalRequirements)) {
    addQuestion(
      "Q-005",
      intakePolicy.nfrPriority,
      "What non-functional expectations matter most: performance, availability, security, auditability, or scalability?",
      "Non-functional requirements influence architecture scoring and production readiness.",
      ["architecture scoring", "production readiness", "quality tasks"],
      intakePolicy.nfrBlocking,
      "Non-functional requirements are not defined."
    );
  }

  if ((input.integrations || []).length === 0) {
    addQuestion(
      "Q-006",
      "medium",
      "Are there external integrations, identity providers, or messaging systems the product must rely on?",
      "Integrations change failure modes, security assumptions, and delivery scope.",
      ["integration strategy", "risk list", "delivery waves"],
      false
    );
  }

  if (input.dataSensitivity === "high" || input.dataSensitivity === "regulated") {
    addQuestion(
      "Q-007",
      "medium",
      "What specific sensitive or regulated data types will the system handle?",
      "The current data sensitivity is high, but the exact data classes are not yet explicit.",
      ["governance artifacts", "security controls", "compliance posture"],
      false
    );
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
    intakeQuestions,
    followUpQuestions: intakeQuestions.map((item) => item.question)
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

function recommendedPlaybooks(phase, pathName, playbookContext, repoRoot) {
  const mandatory = [];
  const adoptionModel = playbookContext.model || {};
  const corePhases = (((adoptionModel.paths || {}).core || {}).mandatory_playbooks_by_phase) || {};
  const enterprisePhases = (((adoptionModel.paths || {}).enterprise || {}).mandatory_playbooks_by_phase) || {};
  const baselinePhase = phase === "phase_3" ? "phase_2" : phase;

  mandatory.push(path.join(repoRoot, "playbooks", "planning-and-scoping.md"));

  (corePhases[baselinePhase] || []).forEach((relativePath) => {
    mandatory.push(resolvePlaybookPath(playbookContext, relativePath));
  });

  if (pathName === "enterprise") {
    (enterprisePhases.phase_3 || []).forEach((relativePath) => {
      mandatory.push(resolvePlaybookPath(playbookContext, relativePath));
    });
  }

  return Array.from(new Set(mandatory));
}

function recommendedGuidanceAreas(phase, profile, config) {
  const base = config.common.guidanceAreasBase || [];
  const byPhase = (config.common.guidanceAreasByPhase && config.common.guidanceAreasByPhase[phase]) || [];
  const profileAdditions =
    (config.profiles[profile] &&
      config.profiles[profile].guidanceAreaAdditionsByPhase &&
      config.profiles[profile].guidanceAreaAdditionsByPhase[phase]) ||
    [];

  return Array.from(new Set(base.concat(byPhase, profileAdditions)));
}

function recommendedArtifacts(phase, profile, config) {
  const base = config.common.artifactsBase || [];
  const byPhase = (config.common.artifactsByPhase && config.common.artifactsByPhase[phase]) || [];
  const profileAdditions =
    (config.profiles[profile] &&
      config.profiles[profile].artifactAdditionsByPhase &&
      config.profiles[profile].artifactAdditionsByPhase[phase]) ||
    [];

  return Array.from(new Set(base.concat(byPhase, profileAdditions)));
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

function inferTechStack(input) {
  const constraints = (input.constraints || []).join(" ").toLowerCase();
  const features = (input.coreFeatures || []).join(" ").toLowerCase();

  if (/typescript/.test(constraints)) {
    if (/dashboard|web|portal|admin/.test(features)) {
      return "TypeScript web application";
    }
    return "TypeScript service stack";
  }

  if (/python/.test(constraints)) {
    return "Python application";
  }

  return "application stack to be confirmed";
}

function featureFiles(feature, architectureShape) {
  const slug = slugify(feature);
  const files = [
    `src/modules/${slug}/index.ts`,
    `src/modules/${slug}/${slug}.service.ts`,
    `src/modules/${slug}/${slug}.repository.ts`,
    `tests/integration/${slug}.test.js`
  ];

  if (/dashboard|admin|form|portal/.test(feature.toLowerCase())) {
    files.unshift(`src/routes/${slug}.ts`);
  }

  if (/approval|workflow|notification|queue/.test(feature.toLowerCase()) || /background jobs/.test(architectureShape)) {
    files.push(`src/jobs/${slug}.job.ts`);
  }

  if (/audit|review|approval/.test(feature.toLowerCase())) {
    files.push("src/modules/audit/audit-log.ts");
  }

  return Array.from(new Set(files));
}

function acceptanceCriteriaForFeature(feature) {
  const lower = feature.toLowerCase();
  const checks = [
    `The ${feature} capability is available through the intended application surface.`,
    `Core validation, error handling, and persistence for ${feature} are covered by tests.`
  ];

  if (/approval|request/.test(lower)) {
    checks.push("Role-based approval transitions and audit visibility are explicit.");
  }
  if (/audit/.test(lower)) {
    checks.push("Audit records capture actor, action, and timestamp without silent mutation.");
  }
  if (/dashboard/.test(lower)) {
    checks.push("The dashboard surfaces the highest-value operational information without exposing unauthorized data.");
  }

  return checks;
}

function makeTask(task) {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    priority: task.priority,
    summary: task.summary,
    problem: task.problem,
    solution: task.solution,
    files: task.files,
    acceptanceCriteria: task.acceptanceCriteria,
    implementationNotes: task.implementationNotes,
    wave: task.wave,
    dependsOn: task.dependsOn,
    blocks: [],
    deliveryPhase: task.deliveryPhase
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

function buildTasks(input, phase, architecture) {
  const tasks = [
    makeTask({
      id: "001",
      title: "Write project charter and architecture baseline",
      category: "foundation",
      priority: "P0",
      summary: "Capture the product scope, users, constraints, architecture shape, and open questions.",
      problem: "The project starts from rough requirements and needs a shared baseline before implementation can be reviewed or sequenced safely.",
      solution: "Create the charter, architecture overview, and first ADRs so later execution work inherits explicit assumptions instead of guesswork.",
      files: [
        "project-charter.md",
        "architecture-overview.md",
        "adrs/001-initial-architecture-shape.md",
        "adrs/002-primary-data-store.md"
      ],
      acceptanceCriteria: [
        "The charter captures summary, users, features, constraints, and unresolved questions.",
        "The architecture overview names a recommended starting shape and its tradeoffs.",
        "Initial ADRs exist for the highest-leverage early decisions."
      ],
      implementationNotes: [
        "Use the recommended architecture as the default, not as a final truth claim.",
        "Keep open questions visible so downstream agents know what may still change.",
        "Reference the applicable playbooks directly in the generated charter."
      ],
      wave: "wave-1",
      dependsOn: [],
      deliveryPhase: "foundation"
    }),
    makeTask({
      id: "002",
      title: "Set up repository and delivery baseline",
      category: "foundation",
      priority: "P0",
      summary: "Create the repository structure, quality checks, and basic documentation needed for implementation.",
      problem: "Execution work will fragment quickly if the repository, quality gates, and documentation expectations are not defined up front.",
      solution: "Establish the test path, delivery workflow expectations, and starter documentation before feature branches accumulate drift.",
      files: [
        "package.json",
        "README.md",
        "tests/",
        ".github/workflows/"
      ],
      acceptanceCriteria: [
        "A repeatable local test command exists for the project baseline.",
        "Core delivery expectations are documented for humans and agents.",
        "The repository has enough structure that the first implementation wave can begin without setup churn."
      ],
      implementationNotes: [
        "Keep the baseline minimal but reviewable.",
        "Prefer a small number of reliable checks over aspirational tooling that nobody runs.",
        "Align branch and review behavior with the development workflow playbook."
      ],
      wave: "wave-1",
      dependsOn: ["001"],
      deliveryPhase: "foundation"
    })
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
      makeTask({
        id: taskId,
        title: `Implement ${feature}`,
        category: "feature",
        priority: index < 2 ? "P0" : "P1",
        summary: `Design and implement the capability for: ${feature}.`,
        problem: `The product cannot satisfy its initial scope until ${feature} exists as a reviewable, testable capability.`,
        solution: `Add a focused module for ${feature} that matches the recommended ${architecture.shape} and keeps integration boundaries explicit.`,
        files: featureFiles(feature, architecture.shape),
        acceptanceCriteria: acceptanceCriteriaForFeature(feature),
        implementationNotes: [
          "Start from domain rules and access constraints before UI or transport details.",
          "Keep module boundaries explicit so later extraction remains possible if the system grows.",
          "Update docs and tests in the same change instead of leaving them for cleanup."
        ],
        wave: index < 2 ? "wave-2" : "wave-3",
        dependsOn: Array.from(new Set(dependsOn)),
        deliveryPhase: "implementation"
      })
    );
  });

  const featureTaskIds = tasks.filter((task) => task.category === "feature").map((task) => task.id);

  tasks.push(
    makeTask({
      id: String(tasks.length + 1).padStart(3, "0"),
      title: "Add integration and error-handling coverage",
      category: "quality",
      priority: "P1",
      summary: "Verify the critical path, failure handling, and integration boundaries with tests.",
      problem: "The initial implementation backlog leaves room for silent regressions unless critical-path and error-path coverage are added deliberately.",
      solution: "Add end-to-end and integration-focused verification around the user path, external boundaries, and failure handling assumptions.",
      files: [
        "tests/integration/critical-path.test.js",
        "tests/integration/error-handling.test.js",
        "tests/contract/integrations.test.js"
      ],
      acceptanceCriteria: [
        "Critical path behavior is exercised through automated tests.",
        "Integration and error paths fail loudly instead of degrading silently.",
        "Known edge cases from the first release plan are captured in test coverage."
      ],
      implementationNotes: [
        "Bias toward tests that exercise contracts and failure semantics, not only happy-path rendering.",
        "Keep fixtures readable so future backlog work can extend them safely."
      ],
      wave: "wave-4",
      dependsOn: featureTaskIds,
      deliveryPhase: "hardening"
    })
  );

  if (phase === "phase_2" || phase === "phase_3") {
    tasks.push(
      makeTask({
        id: String(tasks.length + 1).padStart(3, "0"),
        title: "Prepare production readiness baseline",
        category: "operations",
        priority: "P0",
        summary: "Add observability, rollback notes, deployment verification, and runbook basics.",
        problem: "Production-oriented work is risky without explicit release, rollback, and observability expectations.",
        solution: "Create runbook, release checks, and baseline operational documentation before launch pressure forces shortcuts.",
        files: [
          "runbooks/release-readiness.md",
          "docs/observability.md",
          "deploy/"
        ],
        acceptanceCriteria: [
          "Release ownership and rollback expectations are documented.",
          "Critical health signals and verification steps are written down.",
          "Production readiness work is visible before the first live rollout."
        ],
        implementationNotes: [
          "Keep the first runbook concrete and biased toward the highest-value verification steps.",
          "Tie release checks back to the architecture and integration risks."
        ],
        wave: "wave-4",
        dependsOn: ["002"],
        deliveryPhase: "launch"
      })
    );
  }

  if (phase === "phase_3") {
    tasks.push(
      makeTask({
        id: String(tasks.length + 1).padStart(3, "0"),
        title: "Establish enterprise governance artifacts",
        category: "governance",
        priority: "P0",
        summary: "Create service ownership, data classification, access review, and exception tracking artifacts.",
        problem: "Enterprise-path delivery cannot rely on implied ownership or undocumented controls when audits and sensitive data are in scope.",
        solution: "Generate the minimum control artifacts early and assign real owners, cadences, and review points.",
        files: [
          "governance/service-ownership.md",
          "governance/data-classification-matrix.md",
          "governance/access-review-plan.md",
          "governance/exception-register.md"
        ],
        acceptanceCriteria: [
          "The governance artifact set exists and is aligned with the phase and data sensitivity.",
          "Ownership and review cadence are explicit enough for downstream teams to act on.",
          "Known control gaps are documented instead of being left implicit."
        ],
        implementationNotes: [
          "Keep the first version lean, but do not leave owner fields hidden behind process debt.",
          "Use the security and change-management playbooks as direct references."
        ],
        wave: "wave-2",
        dependsOn: ["001"],
        deliveryPhase: "foundation"
      })
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

function buildOutput(input, config, playbookContext, repoRoot, inputMetadata) {
  const phase = inferPhase(input);
  const pathName = inferPath(phase);
  const profile = plannerProfile(input, config);
  const intake = intakeSignals(input, config);
  const options = architectureOptions(input, phase);
  const architecture = architectureRecommendation(options, phase);
  const tasks = buildTasks(input, phase, architecture);

  return {
    projectName: input.projectName,
    inputFormat: inputMetadata.format,
    inputParsing: {
      structuredInputSource: inputMetadata.structuredInputSource,
      parserWarnings: inputMetadata.parserWarnings
    },
    inputSnapshot: input,
    plannerProfile: profile,
    intakeCompleteness: intake.intakeCompleteness,
    missingInformation: intake.missingInformation,
    intakeQuestions: intake.intakeQuestions,
    followUpQuestions: intake.followUpQuestions,
    phase,
    phaseRationale: phaseRationale(input, phase),
    path: pathName,
    recommendedPlaybooks: recommendedPlaybooks(phase, pathName, playbookContext, repoRoot),
    recommendedGuidanceAreas: recommendedGuidanceAreas(phase, profile, config),
    recommendedArtifacts: recommendedArtifacts(phase, profile, config),
    architectureOptions: options,
    architectureRecommendation: architecture,
    adrCandidates: adrCandidates(input, architecture),
    tasks,
    executionWaves: executionWaves(tasks),
    dependencyGraph: dependencyGraph(tasks),
    promptExports: [],
    handoffManifest: {},
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

function toChecklist(items) {
  if (!items.length) {
    return "- [ ] None";
  }
  return items.map((item) => `- [ ] ${item}`).join("\n");
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

- Planner profile: ${output.plannerProfile}
- Intake completeness: ${output.intakeCompleteness}
- Phase: ${output.phase}
- Path: ${output.path}
- Data sensitivity: ${input.dataSensitivity || "low"}

## Applicable Playbooks

${toMarkdownList(output.recommendedPlaybooks)}

## Missing Information

${toMarkdownList(output.missingInformation)}

## Follow-Up Questions

${toMarkdownList(output.followUpQuestions)}

## Open Questions

${toMarkdownList(output.openQuestions)}
`;
}

function renderIntakeQuestionnaire(repoRoot, input, output) {
  const questions = output.intakeQuestions.length
    ? output.intakeQuestions.map((item) => {
        return `### ${item.id} (${item.priority}${item.blocking ? ", blocker" : ""})

Question: ${item.question}

Why it matters:
- ${item.reason}

Affected decisions:
${toMarkdownList(item.affects)}`;
      }).join("\n\n")
    : "No additional questions are required for the current planning input.";

  const nextStep = output.intakeCompleteness === "complete"
    ? "The current input is sufficient for initial planning. Review the generated plan and refine any optional questions as needed."
    : "Answer the high-priority questions first, then rerun the planner before relying on the backlog and architecture recommendation.";

  return renderTemplate(repoRoot, "templates/intake-questionnaire-template.md", {
    projectName: input.projectName,
    intakeCompleteness: output.intakeCompleteness,
    summary: "This questionnaire captures the missing or still ambiguous inputs that most affect planning quality.",
    questions,
    nextStep
  });
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

## Applicable Playbooks

${toMarkdownList(output.recommendedPlaybooks)}

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
    problem: task.problem,
    solution: task.solution,
    files: toMarkdownList(task.files),
    acceptanceCriteria: toChecklist(task.acceptanceCriteria),
    implementationNotes: toMarkdownList(task.implementationNotes)
  });
}

function taskDocumentPath(task) {
  return `tasks/${task.id}-${slugify(task.title)}.md`;
}

function adrDocumentPath(index, adr) {
  return `adrs/${String(index + 1).padStart(3, "0")}-${slugify(adr.title)}.md`;
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

function renderServiceOwnership(repoRoot, input, config) {
  const governanceDefaults = config.governanceDefaults || {};
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
    accessReviewCadence: governanceDefaults.accessReviewCadence || "Quarterly or before major release milestones.",
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

function renderAccessReview(repoRoot, input, config) {
  const governanceDefaults = config.governanceDefaults || {};
  return renderTemplate(repoRoot, "templates/access-review-template.md", {
    projectName: input.projectName,
    systemsInScope: input.projectName,
    environmentsInScope: "staging, production",
    humanRoles: "engineering, operations, security, support",
    machineIdentities: "application runtime, CI/CD, background workers",
    productionAccessCadence: governanceDefaults.productionAccessCadence || "Quarterly",
    administrativeAccessCadence: governanceDefaults.administrativeAccessCadence || "Monthly",
    thirdPartyAccessCadence: governanceDefaults.thirdPartyAccessCadence || "Quarterly",
    breakGlassCadence: governanceDefaults.breakGlassCadence || "After every use and quarterly at minimum",
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

function renderArchitecturePrompt(repoRoot, input, output) {
  const options = output.architectureOptions.map((option) => {
    return `- ${option.id}: ${option.name} (${option.shape})
  Summary: ${option.summary}
  Scores: delivery=${option.scores.deliverySpeed}, ops=${option.scores.operationalSimplicity}, scale=${option.scores.scalabilityHeadroom}, governance=${option.scores.governanceFit}`;
  }).join("\n");

  return renderTemplate(repoRoot, "templates/architecture-prompt-template.md", {
    projectName: input.projectName,
    summary: input.summary,
    plannerProfile: output.plannerProfile,
    phase: output.phase,
    path: output.path,
    recommendedArchitecture: output.architectureRecommendation.summary,
    architectureOptions: options,
    risks: toMarkdownList(output.risks),
    openQuestions: toMarkdownList(output.openQuestions),
    applicablePlaybooks: toMarkdownList(output.recommendedPlaybooks)
  });
}

function renderExecutionPrompt(repoRoot, input, output) {
  const wave = output.executionWaves[0];
  const tasks = wave
    ? wave.taskIds.map((taskId) => {
        const task = output.tasks.find((candidate) => candidate.id === taskId);
        return `- ${task.id} ${task.title} (${task.priority})
  Depends on: ${task.dependsOn.length ? task.dependsOn.join(", ") : "none"}`;
      }).join("\n")
    : "- No tasks available";

  return renderTemplate(repoRoot, "templates/execution-prompt-template.md", {
    projectName: input.projectName,
    plannerProfile: output.plannerProfile,
    phase: output.phase,
    waveId: wave ? wave.id : "none",
    waveGoal: wave ? wave.goal : "No wave selected",
    criticalPath: output.dependencyGraph.criticalPathTaskIds.join(" -> ") || "None",
    tasks,
    constraints: toMarkdownList(input.constraints),
    openQuestions: toMarkdownList(output.openQuestions),
    applicablePlaybooks: toMarkdownList(output.recommendedPlaybooks)
  });
}

function renderGovernancePrompt(repoRoot, input, output) {
  return renderTemplate(repoRoot, "templates/governance-prompt-template.md", {
    projectName: input.projectName,
    plannerProfile: output.plannerProfile,
    phase: output.phase,
    dataSensitivity: input.dataSensitivity || "low",
    enterpriseRequirements: toMarkdownList(input.enterpriseRequirements || []),
    artifacts: toMarkdownList([
      "service ownership",
      "data classification matrix",
      "access review plan",
      "exception register"
    ]),
    risks: toMarkdownList(output.risks),
    openQuestions: toMarkdownList(output.openQuestions),
    applicablePlaybooks: toMarkdownList(output.recommendedPlaybooks)
  });
}

function renderIntakeFollowupPrompt(repoRoot, input, output) {
  const questions = output.intakeQuestions.map((item) => {
    return `- ${item.id} (${item.priority}${item.blocking ? ", blocker" : ""}): ${item.question}
  Why: ${item.reason}`;
  }).join("\n");

  return renderTemplate(repoRoot, "templates/intake-followup-prompt-template.md", {
    projectName: input.projectName,
    intakeCompleteness: output.intakeCompleteness,
    questions,
    applicablePlaybooks: toMarkdownList(output.recommendedPlaybooks)
  });
}

function buildPromptArtifacts(repoRoot, input, output) {
  const promptArtifacts = [
    {
      id: "architecture-analysis",
      title: "Architecture Analysis",
      purpose: "Refine or challenge the recommended architecture using the generated options and risks.",
      path: "prompts/architecture-analysis.md",
      contents: renderArchitecturePrompt(repoRoot, input, output)
    },
    {
      id: "execution-next-wave",
      title: "Execution Next Wave",
      purpose: "Guide an implementation agent through the next delivery wave and its dependencies.",
      path: "prompts/execution-next-wave.md",
      contents: renderExecutionPrompt(repoRoot, input, output)
    }
  ];

  if (output.intakeCompleteness !== "complete") {
    promptArtifacts.push({
      id: "intake-followup",
      title: "Intake Follow-Up",
      purpose: "Clarify blocking or high-value missing planning inputs before deeper execution.",
      path: "prompts/intake-followup.md",
      contents: renderIntakeFollowupPrompt(repoRoot, input, output)
    });
  }

  if (output.path === "enterprise") {
    promptArtifacts.push({
      id: "governance-setup",
      title: "Governance Setup",
      purpose: "Guide a governance or security-focused agent through the required control artifacts.",
      path: "prompts/governance-setup.md",
      contents: renderGovernancePrompt(repoRoot, input, output)
    });
  }

  return promptArtifacts;
}

function profileExecutionPolicy(profile) {
  const defaults = {
    startup: {
      maxParallelAgents: 1,
      autoStartReviews: true,
      approvalRequiredForExecution: false,
      blockerMode: "notify-and-wait"
    },
    product: {
      maxParallelAgents: 2,
      autoStartReviews: true,
      approvalRequiredForExecution: false,
      blockerMode: "notify-and-wait"
    },
    enterprise: {
      maxParallelAgents: 2,
      autoStartReviews: false,
      approvalRequiredForExecution: true,
      blockerMode: "halt-and-escalate"
    },
    platform: {
      maxParallelAgents: 3,
      autoStartReviews: true,
      approvalRequiredForExecution: true,
      blockerMode: "review-before-continue"
    }
  };

  return defaults[profile] || defaults.product;
}

function stepStatusFiles(stepId) {
  return {
    input: `runner/${stepId}/input.json`,
    status: `runner/${stepId}/status.json`,
    result: `runner/${stepId}/result.json`,
    blockers: `runner/${stepId}/blockers.json`
  };
}

function makeStepPolicy(step, output) {
  const profilePolicy = profileExecutionPolicy(output.plannerProfile);
  const isExecutionStep = /execution/i.test(step.name);
  const isGovernanceStep = /governance/i.test(step.name);

  return {
    dependencyPolicy: {
      hard: step.dependsOn.slice(),
      soft: isExecutionStep && output.path === "enterprise" ? ["step-3-governance-setup"] : []
    },
    blockerPolicy: {
      onBlocked: isGovernanceStep ? "halt-and-escalate" : profilePolicy.blockerMode,
      escalationTarget: output.path === "enterprise" ? "human owner and governance lead" : "human owner",
      maxAutoRetries: 0
    },
    approvalGate: {
      required: isExecutionStep ? profilePolicy.approvalRequiredForExecution : !profilePolicy.autoStartReviews,
      approvers: isGovernanceStep ? ["human owner", "security owner"] : ["human owner"],
      reason: isGovernanceStep
        ? "Governance-path work must be explicitly reviewed before downstream execution continues."
        : isExecutionStep && profilePolicy.approvalRequiredForExecution
          ? "Execution on this profile requires explicit human review before implementation proceeds."
          : "No explicit approval gate required beyond normal review."
    },
    profilePolicy: {
      plannerProfile: output.plannerProfile,
      maxParallelAgents: profilePolicy.maxParallelAgents,
      autoContinue: profilePolicy.autoStartReviews && !isExecutionStep,
      reviewRequired: isExecutionStep ? profilePolicy.approvalRequiredForExecution : !profilePolicy.autoStartReviews
    },
    statusFiles: stepStatusFiles(step.id)
  };
}

function buildHandoffManifest(input, output) {
  const promptById = new Map(output.promptExports.map((item) => [item.id, item]));
  const steps = [];
  const intakePrompt = promptById.get("intake-followup");
  const architecturePrompt = promptById.get("architecture-analysis");
  const executionPrompt = promptById.get("execution-next-wave");
  const governancePrompt = promptById.get("governance-setup");
  const architectureOption = output.architectureOptions.find(
    (option) => option.id === output.architectureRecommendation.optionId
  );
  const firstWave = output.executionWaves[0];

  if (intakePrompt) {
    steps.push({
      id: "step-1-intake-clarification",
      name: "Resolve Missing Planning Inputs",
      objective: "Close the blocking or high-value planning gaps before deeper architecture or delivery work continues.",
      executionMode: "sequential",
      dependsOn: [],
      parallelGroup: "preflight",
      agentAssignments: [
        {
          id: "agent-intake-clarifier",
          role: "requirements-analyst",
          promptExportId: intakePrompt.id,
          promptPath: intakePrompt.path,
          reads: [
            "plan-output.json",
            "intake-questionnaire.md",
            "project-charter.md",
            ".ai/TASKS.md",
            intakePrompt.path
          ],
          writes: [
            "updated planning input",
            "clarified assumptions",
            "resolved blocker answers"
          ],
          successCriteria: [
            "Every blocking intake question has an explicit answer or a named decision owner.",
            "The clarified requirements are concrete enough to rerun the planner without guesswork."
          ]
        }
      ]
    });
  }

  const planningDependencies = intakePrompt ? ["step-1-intake-clarification"] : [];

  if (architecturePrompt) {
    steps.push({
      id: "step-2-architecture-review",
      name: "Review Architecture Direction",
      objective: "Challenge the default architecture and confirm whether the recommended option still fits the clarified scope.",
      executionMode: "parallel",
      dependsOn: planningDependencies,
      parallelGroup: "planning-review",
      agentAssignments: [
        {
          id: "agent-architecture-reviewer",
          role: "architecture-reviewer",
          promptExportId: architecturePrompt.id,
          promptPath: architecturePrompt.path,
          reads: [
            "plan-output.json",
            "architecture-overview.md",
            ".ai/ARCHITECTURE.md",
            "delivery-plan.md",
            architecturePrompt.path
          ],
          writes: [
            "architecture review notes",
            "ADR update proposals",
            "recommended architecture adjustments"
          ],
          successCriteria: [
            "The recommended option is either confirmed or replaced with an explicit rationale.",
            "Key tradeoffs and module boundaries are clear enough to guide the first implementation wave."
          ]
        }
      ]
    });
  }

  if (governancePrompt) {
    steps.push({
      id: "step-3-governance-setup",
      name: "Establish Governance Baseline",
      objective: "Create the minimum enterprise control artifacts needed before implementation moves too far ahead.",
      executionMode: "parallel",
      dependsOn: planningDependencies,
      parallelGroup: "planning-review",
      agentAssignments: [
        {
          id: "agent-governance-lead",
          role: "governance-analyst",
          promptExportId: governancePrompt.id,
          promptPath: governancePrompt.path,
          reads: [
            "plan-output.json",
            ".ai/AGENTS.md",
            governancePrompt.path,
            "governance/service-ownership.md",
            "governance/data-classification-matrix.md",
            "governance/access-review-plan.md",
            "governance/exception-register.md"
          ],
          writes: [
            "completed governance artifact set",
            "control gaps",
            "named ownership and review cadences"
          ],
          successCriteria: [
            "Service ownership, data classification, access review, and exception tracking are populated with real owners and cadences.",
            "Known control gaps are explicit instead of being left implicit."
          ]
        }
      ]
    });
  }

  if (executionPrompt && firstWave) {
    const executionDependencies = [];
    if (architecturePrompt) {
      executionDependencies.push("step-2-architecture-review");
    }
    if (governancePrompt) {
      executionDependencies.push("step-3-governance-setup");
    }
    if (!executionDependencies.length && intakePrompt) {
      executionDependencies.push("step-1-intake-clarification");
    }

    const waveTaskPaths = firstWave.taskIds
      .map((taskId) => output.tasks.find((task) => task.id === taskId))
      .filter(Boolean)
      .map(taskDocumentPath);

    steps.push({
      id: "step-4-wave-1-execution",
      name: "Execute First Delivery Wave",
      objective: "Implement the initial foundation tasks with the current architecture and control assumptions.",
      executionMode: "sequential",
      dependsOn: executionDependencies,
      parallelGroup: "delivery",
      agentAssignments: [
        {
          id: "agent-delivery-lead",
          role: "implementation-lead",
          promptExportId: executionPrompt.id,
          promptPath: executionPrompt.path,
          reads: [
            "plan-output.json",
            "delivery-plan.md",
            ".ai/TASKS.md",
            executionPrompt.path
          ].concat(waveTaskPaths),
          writes: [
            "implemented wave-1 scope",
            "updated tests and docs",
            "next-wave handoff notes"
          ],
          successCriteria: [
            `All tasks in ${firstWave.id} are either completed or explicitly re-scoped with reasons.`,
            "Dependency-sensitive work lands in a reviewable sequence without skipping tests or documentation."
          ]
        }
      ]
    });
  }

  const policyAwareSteps = steps.map((step) => Object.assign({}, step, makeStepPolicy(step, output)));

  const manifestArtifacts = [
    "plan-output.json",
    "structured-input.json",
    "project-charter.md",
    "architecture-overview.md",
    "delivery-plan.md",
    "runner-contract.json",
    ".devreview.json",
    "scaffoldkit-input.json",
    ".ai/AGENTS.md",
    ".ai/ARCHITECTURE.md",
    ".ai/TASKS.md",
    ".ai/DECISIONS.md"
  ].concat(output.recommendedPlaybooks);

  if (output.intakeCompleteness !== "complete") {
    manifestArtifacts.push("intake-questionnaire.md");
  }

    output.adrCandidates.forEach((adr, index) => {
    manifestArtifacts.push(adrDocumentPath(index, adr));
  });

  return {
    version: "1.0",
    summary: "Coordinate downstream planning, governance, and execution agents from a single generated manifest.",
    policySummary: `Use ${output.plannerProfile} profile policies for concurrency, blocker escalation, and approval gating.`,
    runnerContractPath: "runner-contract.json",
    coordinationStrategy: intakePrompt
      ? "Resolve intake blockers first, then run planning review steps in parallel where possible, then begin execution."
      : "Use planning review steps in parallel where possible, then move into execution on the first delivery wave.",
    recommendedArchitectureOptionId: output.architectureRecommendation.optionId,
    recommendedArchitectureShape: architectureOption ? architectureOption.shape : output.architectureRecommendation.shape,
    sharedContext: {
      phase: output.phase,
      path: output.path,
      plannerProfile: output.plannerProfile,
      intakeCompleteness: output.intakeCompleteness
    },
    sharedArtifacts: manifestArtifacts,
    steps: policyAwareSteps
  };
}

function buildRunnerContract(output) {
  return {
    version: "1.0",
    summary: "Machine-readable contract for downstream agents consuming the planforge handoff manifest.",
    statusLifecycle: [
      { id: "queued", meaning: "Step exists but should not start yet." },
      { id: "ready", meaning: "Dependencies are satisfied and the step may begin." },
      { id: "in_progress", meaning: "The agent is actively working on the step." },
      { id: "blocked", meaning: "A blocker prevents progress and escalation is required." },
      { id: "partial", meaning: "Partial outputs exist but acceptance criteria are not yet satisfied." },
      { id: "completed", meaning: "The step finished with required outputs and status evidence." }
    ],
    requiredStatusFields: [
      "stepId",
      "agentId",
      "status",
      "updatedAt",
      "summary",
      "blockers",
      "outputArtifacts"
    ],
    requiredResultFields: [
      "stepId",
      "agentId",
      "completedAt",
      "outcomeSummary",
      "artifacts",
      "openIssues",
      "nextStepRecommendations"
    ],
    stepContracts: output.handoffManifest.steps.map((step) => ({
      stepId: step.id,
      name: step.name,
      requiredInputFiles: step.agentAssignments.flatMap((assignment) => assignment.reads),
      expectedOutputFiles: step.agentAssignments.flatMap((assignment) => assignment.writes),
      statusFiles: step.statusFiles,
      allowedStatuses: ["queued", "ready", "in_progress", "blocked", "partial", "completed"],
      dependencyPolicy: step.dependencyPolicy,
      approvalGate: step.approvalGate
    }))
  };
}

function resolveRunDirectory(repoRoot, runPath) {
  const resolvedPath = path.resolve(repoRoot, runPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CliError(`Previous run path does not exist: ${resolvedPath}`, EXIT_CODES.RUNTIME);
  }
  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory()) {
    return resolvedPath;
  }
  if (path.basename(resolvedPath) === "plan-output.json") {
    return path.dirname(resolvedPath);
  }
  throw new CliError("Previous run path must be a directory or plan-output.json.", EXIT_CODES.USAGE);
}

function loadPreviousRun(repoRoot, runPath) {
  if (!runPath) {
    return null;
  }

  const dir = resolveRunDirectory(repoRoot, runPath);
  const planOutputPath = path.join(dir, "plan-output.json");
  if (!fs.existsSync(planOutputPath)) {
    throw new CliError(`Previous run is missing plan-output.json: ${dir}`, EXIT_CODES.RUNTIME);
  }

  return {
    dir,
    output: readJson(planOutputPath, planOutputPath)
  };
}

function valuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function buildRerunReport(mode, previousRun, input, output) {
  const regeneratedArtifacts = [
    "plan-output.json",
    "handoff-manifest.json",
    "project-charter.md",
    "architecture-overview.md",
    "delivery-plan.md",
    "runner-contract.json",
    "scaffoldkit-input.json",
    ".devreview.json"
  ];

  if (!previousRun) {
    return {
      mode,
      sourceRun: null,
      changedAssumptions: [],
      changedRecommendations: [],
      regeneratedArtifacts,
      preservedArtifacts: []
    };
  }

  const previousOutput = previousRun.output || {};
  const previousInput = previousOutput.inputSnapshot || {};
  const changedAssumptions = [
    "projectName",
    "summary",
    "targetUsers",
    "coreFeatures",
    "constraints",
    "nonFunctionalRequirements",
    "integrations",
    "plannerProfile",
    "dataSensitivity",
    "teamSize",
    "productionExpectedSoon",
    "liveUsers",
    "enterpriseRequirements",
    "openQuestions"
  ].filter((field) => !valuesEqual(previousInput[field], input[field]));

  const previousWave = ((previousOutput.executionWaves || [])[0] || {}).taskIds || [];
  const currentWave = ((output.executionWaves || [])[0] || {}).taskIds || [];
  const changedRecommendations = [];

  if (previousOutput.phase !== output.phase) {
    changedRecommendations.push("phase");
  }
  if (previousOutput.path !== output.path) {
    changedRecommendations.push("path");
  }
  if ((previousOutput.architectureRecommendation || {}).optionId !== output.architectureRecommendation.optionId) {
    changedRecommendations.push("architectureRecommendation");
  }
  if (!valuesEqual(previousOutput.recommendedPlaybooks, output.recommendedPlaybooks)) {
    changedRecommendations.push("recommendedPlaybooks");
  }
  if (!valuesEqual(previousWave, currentWave)) {
    changedRecommendations.push("executionWaveSelection");
  }

  const preservedCandidates = [
    "runner",
    "handoff-status.json",
    "resume-notes.md",
    "reviews",
    "notes"
  ];
  const preservedArtifacts = preservedCandidates.filter((entry) => fs.existsSync(path.join(previousRun.dir, entry)));

  return {
    mode,
    sourceRun: previousRun.dir,
    changedAssumptions,
    changedRecommendations,
    regeneratedArtifacts,
    preservedArtifacts
  };
}

function renderAiAgents(input, output) {
  return `# AGENTS

## Roles

- Planning lead: maintains the plan, validates architecture assumptions, and reruns planning when inputs materially change.
- Architecture reviewer: challenges module boundaries, scaling assumptions, and integration risks before implementation expands.
- Implementation lead: executes one reviewable task at a time and updates tests and docs with each change.
- Human owner: remains accountable for review, release, and acceptance of agent-generated work.
${output.path === "enterprise" ? "- Governance lead: owns control artifacts, access review cadence, and exception tracking for enterprise-path work." : ""}

## Workflow

1. Read \`.ai/ARCHITECTURE.md\`, \`.ai/TASKS.md\`, and the current prompt export before changing code.
2. Follow the applicable playbooks listed below for workflow, testing, documentation, and governance expectations.
3. Keep diffs small, update tests with the change, and avoid bundling unrelated work.
4. Escalate blockers or scope changes instead of silently improvising around them.

## Applicable Playbooks

${toMarkdownList(output.recommendedPlaybooks)}

## Change Rules

- Preserve backward compatibility unless a breaking change is explicitly accepted.
- Update docs and ADRs when architectural assumptions shift.
- Treat prompts and generated artifacts as review inputs, not as permission to skip engineering judgment.

## Project Context

- Project: ${input.projectName}
- Planner profile: ${output.plannerProfile}
- Phase: ${output.phase}
- Path: ${output.path}
`;
}

function renderAiArchitecture(input, output) {
  const modules = [
    "user-facing application surface",
    "domain and business logic modules",
    "persistence and integration boundary"
  ];

  if (/background jobs/.test(output.architectureRecommendation.shape)) {
    modules.push("background job processing path");
  }

  return `# ARCHITECTURE

## Summary

${input.summary}

## Recommended Shape

- ${output.architectureRecommendation.summary}
- Tech stack hint: ${inferTechStack(input)}
- Phase: ${output.phase}
- Path: ${output.path}

## Key Modules

${toMarkdownList(modules)}

## Integrations

${toMarkdownList(input.integrations || [])}

## Risks

${toMarkdownList(output.risks)}

## Playbook References

${toMarkdownList(output.recommendedPlaybooks)}
`;
}

function renderAiTasks(output) {
  const waveSections = output.executionWaves.map((wave) => {
    const tasks = wave.taskIds.map((taskId) => {
      const task = output.tasks.find((candidate) => candidate.id === taskId);
      return `### ${task.id} ${task.title}

- Priority: ${task.priority}
- Category: ${task.category}
- Depends on: ${task.dependsOn.length ? task.dependsOn.join(", ") : "none"}
- Summary: ${task.summary}`;
    }).join("\n\n");

    return `## ${wave.id}\n\n${wave.goal}\n\n${tasks}`;
  }).join("\n\n");

  return `# TASKS

## Critical Path

${output.dependencyGraph.criticalPathTaskIds.join(" -> ") || "None"}

${waveSections}
`;
}

function renderAiDecisions(output) {
  const decisions = output.adrCandidates.map((adr, index) => {
    return `## ${adr.id}: ${adr.title}

- Decision: ${adr.decision}
- Full ADR: ../${adrDocumentPath(index, adr)}`;
  }).join("\n\n");

  return `# DECISIONS

${decisions}
`;
}

function writePromptArtifacts(promptArtifacts, outdir) {
  promptArtifacts.forEach((artifact) => {
    writeFile(path.join(outdir, artifact.path), artifact.contents);
  });
}

function writeAiArtifacts(input, output, outdir) {
  writeFile(path.join(outdir, ".ai", "AGENTS.md"), renderAiAgents(input, output));
  writeFile(path.join(outdir, ".ai", "ARCHITECTURE.md"), renderAiArchitecture(input, output));
  writeFile(path.join(outdir, ".ai", "TASKS.md"), renderAiTasks(output));
  writeFile(path.join(outdir, ".ai", "DECISIONS.md"), renderAiDecisions(output));
}

function scaffoldkitBlueprint(output, input) {
  const techStack = inferTechStack(input).toLowerCase();

  if (output.plannerProfile === "platform") {
    return "internal-platform";
  }
  if (/typescript web/.test(techStack) && output.architectureRecommendation.shape === "modular monolith") {
    return "nextjs-fullstack";
  }
  if (/typescript service/.test(techStack) && /background jobs/.test(output.architectureRecommendation.shape)) {
    return "node-worker-app";
  }
  if (/small service-oriented split/.test(output.architectureRecommendation.shape)) {
    return "service-platform";
  }
  return "app-starter";
}

function renderScaffoldKitInput(input, output) {
  return {
    version: "1.0",
    projectName: input.projectName,
    blueprint: scaffoldkitBlueprint(output, input),
    architecture: {
      shape: output.architectureRecommendation.shape,
      optionId: output.architectureRecommendation.optionId,
      phase: output.phase,
      path: output.path
    },
    stack: {
      hint: inferTechStack(input),
      dataStore: "relational",
      integrations: input.integrations || []
    },
    features: input.coreFeatures,
    constraints: input.constraints,
    playbooks: output.recommendedPlaybooks,
    aiContextFiles: [
      ".ai/AGENTS.md",
      ".ai/ARCHITECTURE.md",
      ".ai/TASKS.md",
      ".ai/DECISIONS.md"
    ]
  };
}

function devReviewWeights(profile) {
  if (profile === "startup") {
    return {
      correctness: 30,
      testing: 15,
      maintainability: 20,
      architecture: 15,
      security: 10,
      documentation: 10
    };
  }
  if (profile === "enterprise") {
    return {
      correctness: 20,
      testing: 20,
      maintainability: 15,
      architecture: 15,
      security: 20,
      documentation: 10
    };
  }
  if (profile === "platform") {
    return {
      correctness: 20,
      testing: 25,
      maintainability: 20,
      architecture: 20,
      security: 10,
      documentation: 5
    };
  }
  return {
    correctness: 25,
    testing: 20,
    maintainability: 20,
    architecture: 15,
    security: 10,
    documentation: 10
  };
}

function minReviewScore(phase, profile) {
  if (profile === "startup") {
    return 6;
  }
  if (phase === "phase_3" || profile === "enterprise") {
    return 8;
  }
  if (phase === "phase_2" || profile === "platform") {
    return 8;
  }
  if (phase === "phase_0") {
    return 6;
  }
  return 7;
}

function renderDevReviewConfig(input, output) {
  const techStack = inferTechStack(input).toLowerCase();
  const ignorePatterns = ["out/**", "coverage/**", "node_modules/**"];
  if (/typescript web/.test(techStack)) {
    ignorePatterns.push(".next/**");
  }

  const customRules = [
    "require tests when API or workflow behavior changes",
    "require ADR updates when architecture assumptions shift"
  ];

  if (/dashboard|portal|admin/.test((input.coreFeatures || []).join(" ").toLowerCase())) {
    customRules.push("require access-control review for admin-facing routes");
  }
  if (output.plannerProfile === "platform") {
    customRules.push("require API stability review for shared platform interfaces");
  }

  return {
    version: "1.0",
    profile: output.plannerProfile,
    phase: output.phase,
    minimumScore: minReviewScore(output.phase, output.plannerProfile),
    weights: devReviewWeights(output.plannerProfile),
    ignorePatterns,
    customRules
  };
}

function writeRunnerArtifacts(output, outdir) {
  const contract = buildRunnerContract(output);
  writeFile(path.join(outdir, "runner-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);

  contract.stepContracts.forEach((stepContract) => {
    writeFile(
      path.join(outdir, stepContract.statusFiles.input),
      `${JSON.stringify({ stepId: stepContract.stepId, requiredInputFiles: stepContract.requiredInputFiles }, null, 2)}\n`
    );
    writeFile(
      path.join(outdir, stepContract.statusFiles.status),
      `${JSON.stringify({
        stepId: stepContract.stepId,
        agentId: "TBD",
        status: "queued",
        updatedAt: "",
        summary: "",
        blockers: [],
        outputArtifacts: []
      }, null, 2)}\n`
    );
    writeFile(
      path.join(outdir, stepContract.statusFiles.result),
      `${JSON.stringify({
        stepId: stepContract.stepId,
        agentId: "TBD",
        completedAt: "",
        outcomeSummary: "",
        artifacts: [],
        openIssues: [],
        nextStepRecommendations: []
      }, null, 2)}\n`
    );
    writeFile(
      path.join(outdir, stepContract.statusFiles.blockers),
      `${JSON.stringify({ stepId: stepContract.stepId, blockers: [] }, null, 2)}\n`
    );
  });
}

function copyDirectoryContents(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    ensureDir(targetPath);
    fs.readdirSync(sourcePath).forEach((entry) => {
      copyDirectoryContents(path.join(sourcePath, entry), path.join(targetPath, entry));
    });
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function preservePreviousRunArtifacts(previousRun, rerunReport, outdir) {
  if (!previousRun || !rerunReport.preservedArtifacts.length) {
    return;
  }

  rerunReport.preservedArtifacts.forEach((relativePath) => {
    const sourcePath = path.join(previousRun.dir, relativePath);
    const targetPath = path.join(outdir, relativePath);
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return;
    }
    copyDirectoryContents(sourcePath, targetPath);
  });
}

function renderRerunSummary(rerunReport) {
  return `# Rerun Summary

## Mode

- ${rerunReport.mode}

## Source Run

- ${rerunReport.sourceRun || "None"}

## Changed Assumptions

${toMarkdownList(rerunReport.changedAssumptions)}

## Changed Recommendations

${toMarkdownList(rerunReport.changedRecommendations)}

## Regenerated Artifacts

${toMarkdownList(rerunReport.regeneratedArtifacts)}

## Preserved Artifacts

${toMarkdownList(rerunReport.preservedArtifacts)}
`;
}

function writeOperationalArtifacts(input, output, outdir, rerunReport) {
  writeFile(path.join(outdir, "structured-input.json"), `${JSON.stringify(output.inputSnapshot, null, 2)}\n`);
  writeFile(path.join(outdir, "scaffoldkit-input.json"), `${JSON.stringify(renderScaffoldKitInput(input, output), null, 2)}\n`);
  writeFile(path.join(outdir, ".devreview.json"), `${JSON.stringify(renderDevReviewConfig(input, output), null, 2)}\n`);
  writeFile(path.join(outdir, "rerun-report.json"), `${JSON.stringify(rerunReport, null, 2)}\n`);
  writeFile(path.join(outdir, "rerun-summary.md"), renderRerunSummary(rerunReport));
  writeRunnerArtifacts(output, outdir);
}

function writeTemplateArtifacts(repoRoot, input, output, outdir, config) {
  output.adrCandidates.forEach((adr, index) => {
    const filename = `${String(index + 1).padStart(3, "0")}-${slugify(adr.title)}.md`;
    writeFile(path.join(outdir, "adrs", filename), renderAdrDocument(repoRoot, input, adr));
  });

  output.tasks.forEach((task) => {
    writeFile(
      path.join(outdir, taskDocumentPath(task)),
      renderTaskDocument(repoRoot, task)
    );
  });

  if (output.phase === "phase_2" || output.phase === "phase_3") {
    writeFile(path.join(outdir, "runbooks", "release-readiness.md"), renderRunbookBaseline(repoRoot, input, output));
  }

  if (output.path === "enterprise") {
    writeFile(path.join(outdir, "governance", "service-ownership.md"), renderServiceOwnership(repoRoot, input, config));
    writeFile(path.join(outdir, "governance", "data-classification-matrix.md"), renderDataClassification(repoRoot, input));
    writeFile(path.join(outdir, "governance", "access-review-plan.md"), renderAccessReview(repoRoot, input, config));
    writeFile(path.join(outdir, "governance", "exception-register.md"), renderExceptionRegister(repoRoot, input));
  }
}

function writeMakefile(repoRoot, outdir) {
  const templatePath = path.join(repoRoot, "templates", "Makefile.template");
  const makefileContent = readText(templatePath, "Makefile.template");
  writeFile(path.join(outdir, "Makefile"), makefileContent);
}

function runNpmInstall(outdir) {
  const packageJsonPath = path.join(outdir, "package.json");
  
  // Only run npm install if package.json exists
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }
  
  const { execSync } = require("child_process");
  
  console.log("Running npm install to generate package-lock.json...");
  
  try {
    execSync("npm install", {
      cwd: outdir,
      stdio: "inherit"
    });
    console.log("✓ package-lock.json generated successfully");
  } catch (error) {
    console.error("Warning: npm install failed. Run manually in output directory.");
  }
}

function printSummary(output, outdir, validateOnly) {
  const firstWave = output.executionWaves[0];
  const firstWaveTasks = firstWave
    ? firstWave.taskIds
        .map((taskId) => output.tasks.find((task) => task.id === taskId))
        .filter(Boolean)
        .map((task) => `${task.id} ${task.title}`)
        .join("; ")
    : "none";

  console.log([
    `Project: ${output.projectName}`,
    `Input format: ${output.inputFormat}`,
    `Phase: ${output.phase}`,
    `Path: ${output.path}`,
    `Profile: ${output.plannerProfile}`,
    `Architecture: ${output.architectureRecommendation.shape}`,
    `Wave 1: ${firstWaveTasks}`,
    `Playbooks: ${output.recommendedPlaybooks.length}`,
    validateOnly ? "Validation: success" : `Output: ${outdir}`
  ].join("\n"));
}

function main() {
  try {
    const args = parseArgs(process.argv);

    if (args.help) {
      console.log(usageText());
      return;
    }

    if (!args.input) {
      throw new CliError("Missing required argument: --input <file>", EXIT_CODES.USAGE, [usageText()]);
    }

    if (args.resumeFrom && args.rerunFrom) {
      throw new CliError("Use either --resume-from or --rerun-from, not both.", EXIT_CODES.USAGE, [usageText()]);
    }

    if (!args.outdir && !args.validateOnly) {
      throw new CliError("Missing required argument: --outdir <dir>", EXIT_CODES.USAGE, [usageText()]);
    }

    const repoRoot = process.cwd();
    const playbookContext = loadPlaybookContext(repoRoot);
    const config = loadPlannerConfig(repoRoot, args.config);
    const { input, metadata: inputMetadata } = loadPlanningInput(repoRoot, args.input, args.format);
    const previousRun = loadPreviousRun(repoRoot, args.resumeFrom || args.rerunFrom);
    const rerunMode = args.resumeFrom ? "resume" : args.rerunFrom ? "rerun" : "fresh";
    const output = buildOutput(input, config, playbookContext, repoRoot, inputMetadata);
    const promptArtifacts = buildPromptArtifacts(repoRoot, input, output);

    output.promptExports = promptArtifacts.map(({ contents, ...metadata }) => metadata);
    output.handoffManifest = buildHandoffManifest(input, output);
    const rerunReport = buildRerunReport(rerunMode, previousRun, input, output);

    validateWithSchema(repoRoot, "models/planning-output.schema.json", output, "generated planning output");

    if (args.validateOnly) {
      if (args.summary) {
        printSummary(output, "", true);
      } else {
        console.log("Validation succeeded for input, config, and generated planning output.");
      }
      return;
    }

    const outdir = path.resolve(repoRoot, args.outdir);
    ensureDir(outdir);
    writePromptArtifacts(promptArtifacts, outdir);
    writeFile(path.join(outdir, "plan-output.json"), `${JSON.stringify(output, null, 2)}\n`);
    writeFile(path.join(outdir, "handoff-manifest.json"), `${JSON.stringify(output.handoffManifest, null, 2)}\n`);
    writeFile(path.join(outdir, "intake-questionnaire.md"), renderIntakeQuestionnaire(repoRoot, input, output));
    writeFile(path.join(outdir, "project-charter.md"), renderProjectCharter(input, output));
    writeFile(path.join(outdir, "architecture-overview.md"), renderArchitectureOverview(input, output));
    writeFile(path.join(outdir, "delivery-plan.md"), renderDeliveryPlan(output));
    writeAiArtifacts(input, output, outdir);
    writeOperationalArtifacts(input, output, outdir, rerunReport);
    writeTemplateArtifacts(repoRoot, input, output, outdir, config);
    writeMakefile(repoRoot, outdir);
    preservePreviousRunArtifacts(previousRun, rerunReport, outdir);

    if (args.install) {
      runNpmInstall(outdir);
    }

    if (args.summary) {
      printSummary(output, outdir, false);
    } else {
      console.log(`Generated planning artifacts in ${outdir}`);
    }
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      error.details.forEach((detail) => console.error(`- ${detail}`));
      process.exit(error.exitCode);
    }

    console.error(`Planner failed: ${error.message}`);
    process.exit(EXIT_CODES.RUNTIME);
  }
}

main();
