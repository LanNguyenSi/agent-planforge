#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const {
  matchPattern,
  resolvePatternFiles
} = require("./lib/pattern-matching");

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
    install: true,
    clarify: false,
    autoClarify: false
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
    } else if (arg === "--clarify") {
      args.clarify = true;
    } else if (arg === "--auto-clarify") {
      args.clarify = true;
      args.autoClarify = true;
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
    "  --clarify            Generate specs/clarifications.md before planning continues",
    "  --auto-clarify       Accept default clarification answers and continue automatically",
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

function planningPath(...segments) {
  return path.join("planning", ...segments);
}

function handoffPath(...segments) {
  return path.join("handoff", ...segments);
}

function exportsPath(...segments) {
  return path.join("exports", ...segments);
}

function docsPath(...segments) {
  return path.join(".planforge", "docs", ...segments);
}

function toolingPath(...segments) {
  return path.join(".planforge", "tooling", ...segments);
}

// Single source of truth for the generated artifact layout. renderPlanforgeIndex,
// the handoff manifest (sharedArtifacts), and the rerun report (regeneratedArtifacts)
// all derive their paths from here so the three maps cannot drift apart. Keep paths
// byte-identical to what the writers emit; the index `version` is independent of this.
const LAYOUT_REGISTRY = {
  indexFile: "planforge-index.json",
  rootFiles: {
    agents: "AGENTS.md",
    claude: "CLAUDE.md",
    project: "PROJECT.md",
    charter: docsPath("project-charter.md"),
    architecture: docsPath("architecture-overview.md"),
    deliveryPlan: docsPath("delivery-plan.md"),
    intakeQuestionnaire: docsPath("intake-questionnaire.md")
  },
  directories: {
    ai: ".ai",
    docs: docsPath(),
    tooling: toolingPath(),
    planning: "planning",
    exports: "exports",
    adrs: "adrs",
    tasks: "tasks"
  },
  // Conditional directories are emitted in the index only when their group's
  // predicate is true. Declaration order (specs, runbooks, governance) fixes the
  // append order of the index `directories` block, so do not reorder it.
  conditionalDirectories: {
    specs: "specs",
    runbooks: "runbooks",
    governance: "governance"
  },
  planning: {
    planOutput: planningPath("plan-output.json"),
    structuredInput: planningPath("structured-input.json"),
    rerunReport: planningPath("rerun-report.json"),
    rerunSummary: planningPath("rerun-summary.md")
  },
  exports: {
    scaffoldkit: exportsPath("scaffoldkit-input.json")
  },
  ai: {
    agents: ".ai/AGENTS.md",
    architecture: ".ai/ARCHITECTURE.md",
    tasks: ".ai/TASKS.md",
    decisions: ".ai/DECISIONS.md"
  }
};

// Conditional artifact-group predicates. Each gates BOTH the writes
// (writeTemplateArtifacts) AND the group's presence in planforge-index.json, so the
// writer gate and the index presence flag can no longer be hand-synced copies that
// silently drift apart.
function shouldWriteRunbooks(output) {
  return output.phase === "phase_2" || output.phase === "phase_3";
}

function shouldWriteGovernance(output) {
  return output.path === "enterprise";
}

function writeStderrLine(message) {
  fs.writeSync(2, `${message}\n`);
}

function slugify(value, maxLength = null) {
  let slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  
  if (maxLength) {
    slug = slug.substring(0, maxLength).replace(/-$/, "");
  }
  
  return slug;
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
    let message = error.message;
    
    // Add helpful hints for common validation errors
    if (error.keyword === "type" && error.params?.type) {
      const field = location.split("/").pop() || "field";
      const expectedType = error.params.type;
      
      // Special hints for common fields
      if (field === "teamSize") {
        message += ` (expected: integer like 3, or string like "small"/"medium"/"large")`;
      } else if (expectedType === "integer") {
        message += ` (expected: a number like 3, not "${error.data}")`;
      } else if (expectedType === "boolean") {
        message += ` (expected: true or false, not "${error.data}")`;
      } else if (expectedType === "array") {
        message += ` (expected: an array like ["item1", "item2"])`;
      }
    }
    
    if (error.keyword === "enum" && error.params?.allowedValues) {
      const allowed = error.params.allowedValues.map(v => `"${v}"`).join(", ");
      message += ` (allowed values: ${allowed})`;
    }
    
    if (error.keyword === "minLength" && error.params?.limit) {
      message += ` (minimum length: ${error.params.limit} characters)`;
    }
    
    if (error.keyword === "minItems" && error.params?.limit) {
      message += ` (minimum items: ${error.params.limit})`;
    }
    
    return `${location} ${message}`;
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

function validatePlannerConfigOverrideStructure(overrideConfig) {
  const topLevelKeys = new Set(["version", "defaultProfile", "common", "profiles", "governanceDefaults"]);
  const commonKeys = new Set(["guidanceAreasBase", "guidanceAreasByPhase", "artifactsBase", "artifactsByPhase"]);
  const profileNames = new Set(["startup", "product", "enterprise", "platform"]);
  const profileKeys = new Set(["guidanceAreaAdditionsByPhase", "artifactAdditionsByPhase", "intakePolicy"]);
  const intakePolicyKeys = new Set(["nfrPriority", "nfrBlocking"]);
  const governanceKeys = new Set([
    "accessReviewCadence",
    "productionAccessCadence",
    "administrativeAccessCadence",
    "thirdPartyAccessCadence",
    "breakGlassCadence"
  ]);
  const phaseKeys = new Set(["phase_0", "phase_1", "phase_2", "phase_3"]);
  const priorities = new Set(["high", "medium", "low"]);

  function assert(condition, message) {
    if (!condition) {
      throw new CliError(`Invalid planner config override: ${message}`, EXIT_CODES.VALIDATION);
    }
  }

  function assertAllowedKeys(value, allowedKeys, label) {
    Object.keys(value || {}).forEach((key) => {
      assert(allowedKeys.has(key), `${label} contains unsupported key \`${key}\``);
    });
  }

  function assertStringArray(value, label) {
    assert(Array.isArray(value), `${label} must be an array`);
    value.forEach((entry, index) => {
      assert(typeof entry === "string" && entry.length > 0, `${label}[${index}] must be a non-empty string`);
    });
  }

  function assertPhaseMap(value, label) {
    assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    assertAllowedKeys(value, phaseKeys, label);
    Object.entries(value).forEach(([phase, items]) => {
      assertStringArray(items, `${label}.${phase}`);
    });
  }

  function assertIntakePolicy(value, label) {
    assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    assertAllowedKeys(value, intakePolicyKeys, label);
    if (Object.prototype.hasOwnProperty.call(value, "nfrPriority")) {
      assert(priorities.has(value.nfrPriority), `${label}.nfrPriority must be high, medium, or low`);
    }
    if (Object.prototype.hasOwnProperty.call(value, "nfrBlocking")) {
      assert(typeof value.nfrBlocking === "boolean", `${label}.nfrBlocking must be boolean`);
    }
  }

  if (!isPlainObject(overrideConfig)) {
    throw new CliError("Invalid planner config override: root must be an object", EXIT_CODES.VALIDATION);
  }

  assertAllowedKeys(overrideConfig, topLevelKeys, "override");

  if (Object.prototype.hasOwnProperty.call(overrideConfig, "version")) {
    assert(typeof overrideConfig.version === "string" && overrideConfig.version.length > 0, "override.version must be a non-empty string");
  }

  if (Object.prototype.hasOwnProperty.call(overrideConfig, "defaultProfile")) {
    assert(profileNames.has(overrideConfig.defaultProfile), "override.defaultProfile must be one of startup, product, enterprise, platform");
  }

  if (Object.prototype.hasOwnProperty.call(overrideConfig, "common")) {
    assert(isPlainObject(overrideConfig.common), "override.common must be an object");
    assertAllowedKeys(overrideConfig.common, commonKeys, "override.common");

    if (Object.prototype.hasOwnProperty.call(overrideConfig.common, "guidanceAreasBase")) {
      assertStringArray(overrideConfig.common.guidanceAreasBase, "override.common.guidanceAreasBase");
    }
    if (Object.prototype.hasOwnProperty.call(overrideConfig.common, "guidanceAreasByPhase")) {
      assertPhaseMap(overrideConfig.common.guidanceAreasByPhase, "override.common.guidanceAreasByPhase");
    }
    if (Object.prototype.hasOwnProperty.call(overrideConfig.common, "artifactsBase")) {
      assertStringArray(overrideConfig.common.artifactsBase, "override.common.artifactsBase");
    }
    if (Object.prototype.hasOwnProperty.call(overrideConfig.common, "artifactsByPhase")) {
      assertPhaseMap(overrideConfig.common.artifactsByPhase, "override.common.artifactsByPhase");
    }
  }

  if (Object.prototype.hasOwnProperty.call(overrideConfig, "profiles")) {
    assert(isPlainObject(overrideConfig.profiles), "override.profiles must be an object");
    assertAllowedKeys(overrideConfig.profiles, profileNames, "override.profiles");

    Object.entries(overrideConfig.profiles).forEach(([profileName, profile]) => {
      assert(isPlainObject(profile), `override.profiles.${profileName} must be an object`);
      assertAllowedKeys(profile, profileKeys, `override.profiles.${profileName}`);

      if (Object.prototype.hasOwnProperty.call(profile, "guidanceAreaAdditionsByPhase")) {
        assertPhaseMap(profile.guidanceAreaAdditionsByPhase, `override.profiles.${profileName}.guidanceAreaAdditionsByPhase`);
      }
      if (Object.prototype.hasOwnProperty.call(profile, "artifactAdditionsByPhase")) {
        assertPhaseMap(profile.artifactAdditionsByPhase, `override.profiles.${profileName}.artifactAdditionsByPhase`);
      }
      if (Object.prototype.hasOwnProperty.call(profile, "intakePolicy")) {
        assertIntakePolicy(profile.intakePolicy, `override.profiles.${profileName}.intakePolicy`);
      }
    });
  }

  if (Object.prototype.hasOwnProperty.call(overrideConfig, "governanceDefaults")) {
    assert(isPlainObject(overrideConfig.governanceDefaults), "override.governanceDefaults must be an object");
    assertAllowedKeys(overrideConfig.governanceDefaults, governanceKeys, "override.governanceDefaults");
    Object.entries(overrideConfig.governanceDefaults).forEach(([key, value]) => {
      assert(typeof value === "string" && value.length > 0, `override.governanceDefaults.${key} must be a non-empty string`);
    });
  }
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
    validatePlannerConfigOverrideStructure(overrideConfig);
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

function loadPlanningInput(inputRoot, schemaRoot, inputPath, format) {
  if (!["json", "text", "markdown"].includes(format)) {
    throw new CliError(`Unsupported format: ${format}`, EXIT_CODES.USAGE, [usageText()]);
  }

  if (format === "json") {
    const resolvedPath = inputPath === "-" ? "<stdin>" : path.resolve(inputRoot, inputPath);
    try {
      const content = readInputSource(inputRoot, inputPath);
      const input = JSON.parse(content);
      validateWithSchema(schemaRoot, "models/planning-input.schema.json", input, "planning input");
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

  const content = readInputSource(inputRoot, inputPath);
  const parsed = parseUnstructuredInput(content, format);
  validateWithSchema(schemaRoot, "models/planning-input.schema.json", parsed.input, "planning input");
  return parsed;
}

function clarificationWorkspaceRoot(workingDir, outdir) {
  return outdir ? path.resolve(workingDir, outdir) : workingDir;
}

function clarificationPaths(workingDir, outdir) {
  const root = clarificationWorkspaceRoot(workingDir, outdir);
  return {
    root,
    spec: path.join(root, "specs", "clarifications.md"),
    prompt: path.join(root, "prompts", "clarify-prompt.md")
  };
}

function parseClarificationAnswers(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const lines = readText(filePath, filePath).split(/\r?\n/);
  const answers = new Map();
  let currentId = "";

  lines.forEach((line) => {
    const headingMatch = line.match(/^###\s+(CLARIFY-[A-Z0-9-]+):/);
    if (headingMatch) {
      currentId = headingMatch[1];
      return;
    }

    const answerMatch = line.match(/^Answer:\s*(.*)$/);
    if (currentId && answerMatch) {
      answers.set(currentId, answerMatch[1].trim());
    }
  });

  return answers;
}

function compactText(items) {
  return uniqueNonEmpty(items).join(" ").toLowerCase();
}

function clarificationQuestionCatalog(input) {
  const allText = compactText([
    input.projectName,
    input.summary,
    ...(input.targetUsers || []),
    ...(input.coreFeatures || []),
    ...(input.constraints || []),
    ...(input.nonFunctionalRequirements || []),
    ...(input.integrations || []),
    ...(input.enterpriseRequirements || []),
    ...(input.openQuestions || [])
  ]);

  const listedIntegrations = uniqueNonEmpty(input.integrations || []);
  const needsWorkflowPrecision = /(approval|request|alert|incident|workflow|dashboard)/.test(allText);
  const sensitiveData = ["high", "regulated"].includes(input.dataSensitivity);
  const productionContext = Boolean(input.productionExpectedSoon || input.liveUsers);

  return [
    {
      id: "CLARIFY-AUTH-01",
      category: "Auth Strategy",
      title: "Access and sign-in flow",
      question: "Which sign-in and registration model should the first release support?",
      guidance: "Choose one concise answer such as `approval-based email/password`, `invite-only SSO`, or `internal SSO only`.",
      reason: "Authentication changes routing, data model assumptions, and approval logic early.",
      affects: ["authentication design", "access-control boundaries", "onboarding workflow"],
      defaultAnswer: "approval-based email/password authentication",
      priority: "high",
      applies: true
    },
    {
      id: "CLARIFY-DATA-01",
      category: "Data Model",
      title: "Primary domain records",
      question: "What are the primary records and relationships the planner should assume for v1?",
      guidance: "Name the main entities in one line, for example `users, requests, approvals, audit events in a relational store`.",
      reason: "The first data model heavily influences module boundaries, file suggestions, and ADR candidates.",
      affects: ["data model", "persistence layer", "task decomposition"],
      defaultAnswer: "users, workflow records, and audit events in a relational data model",
      priority: "high",
      applies: true
    },
    {
      id: "CLARIFY-DEPLOY-01",
      category: "Deployment",
      title: "Target runtime",
      question: "Where should the first production-capable version run?",
      guidance: "Name the target platform or hosting model in one line.",
      reason: "Deployment target affects architecture shape, operational tasks, and delivery sequencing.",
      affects: ["deployment shape", "operational readiness", "environment setup"],
      defaultAnswer: "VPS + Docker deployment",
      priority: productionContext ? "high" : "medium",
      applies: true
    },
    {
      id: "CLARIFY-INTEGRATIONS-01",
      category: "Integrations",
      title: "External system scope",
      question: "Which external systems are required in v1, and which ones are explicitly out of scope?",
      guidance: "Use a short comma-separated list for required systems, or `none` if there are no required integrations yet.",
      reason: "Integration scope drives failure handling, testing boundaries, and operational risk.",
      affects: ["integration contracts", "test scope", "delivery risk"],
      defaultAnswer: listedIntegrations.length ? listedIntegrations.join(", ") : "none",
      priority: listedIntegrations.length ? "high" : "medium",
      applies: true
    },
    {
      id: "CLARIFY-ACCESS-01",
      category: "Access Control",
      title: "Launch roles",
      question: "Which user roles or permission levels must exist at launch?",
      guidance: "Use a short list such as `admin, operator, viewer`.",
      reason: "Explicit roles keep dashboard, approval, and audit work from drifting into incompatible assumptions.",
      affects: ["RBAC design", "UI/API authorization", "acceptance criteria"],
      defaultAnswer: "admin, operator, and end-user roles with least-privilege access",
      priority: "medium",
      applies: needsWorkflowPrecision || /auth|role|admin|dashboard/.test(allText)
    },
    {
      id: "CLARIFY-WORKFLOW-01",
      category: "Workflow",
      title: "Required workflow states",
      question: "What are the key end-to-end states or transitions the product must support?",
      guidance: "Provide one compact sequence, for example `draft -> submitted -> approved/rejected -> completed`.",
      reason: "Core workflow states determine service boundaries, validation rules, and task ordering.",
      affects: ["business rules", "state transitions", "test scenarios"],
      defaultAnswer: "draft -> submitted -> approved/rejected -> completed",
      priority: "medium",
      applies: needsWorkflowPrecision
    },
    {
      id: "CLARIFY-OBS-01",
      category: "Operations",
      title: "Operational signals",
      question: "Which operational signals or non-functional checks matter most for the first release?",
      guidance: "Keep the answer short, for example `audit logs, health checks, error rate, and latency`.",
      reason: "This clarifies what the planner should emphasize in hardening and release-readiness work.",
      affects: ["NFRs", "hardening tasks", "release verification"],
      defaultAnswer: "audit logs, health checks, error rate, and latency",
      priority: productionContext ? "high" : "medium",
      applies: true
    },
    {
      id: "CLARIFY-COMPLIANCE-01",
      category: "Compliance",
      title: "Data handling constraints",
      question: "Are there retention, residency, or compliance constraints that the initial plan must honor?",
      guidance: "Use `none beyond current sensitivity` when there are no extra constraints yet.",
      reason: "Sensitive-data projects often need governance and storage decisions captured before implementation starts.",
      affects: ["governance artifacts", "storage choices", "audit scope"],
      defaultAnswer: sensitiveData ? "retain audit history and treat stored business data as sensitive" : "none beyond current sensitivity classification",
      priority: sensitiveData ? "high" : "medium",
      applies: sensitiveData || /compliance|audit|regulated|security/.test(allText)
    }
  ];
}

function buildClarificationQuestions(input) {
  const alwaysInclude = new Set([
    "CLARIFY-AUTH-01",
    "CLARIFY-DATA-01",
    "CLARIFY-DEPLOY-01",
    "CLARIFY-INTEGRATIONS-01"
  ]);

  const questions = clarificationQuestionCatalog(input)
    .filter((question) => question.applies || alwaysInclude.has(question.id))
    .slice(0, 8);

  if (questions.length < 5) {
    clarificationQuestionCatalog(input).forEach((question) => {
      if (questions.length >= 5) {
        return;
      }
      if (!questions.some((entry) => entry.id === question.id)) {
        questions.push(question);
      }
    });
  }

  return questions.slice(0, 10);
}

function isMeaningfulClarificationAnswer(value) {
  const normalized = String(value || "").trim();
  return Boolean(normalized) && !/^(tbd|todo|pending|n\/a|unknown|<fill in>)$/i.test(normalized);
}

function renderClarifications(questions, answerMap, autoClarify) {
  const answeredCount = questions.filter((question) => isMeaningfulClarificationAnswer(answerMap.get(question.id))).length;
  const modeLine = autoClarify
    ? "Defaults were accepted automatically for any unanswered items in this run."
    : "Fill in the `Answer:` line for each item, then rerun with `--clarify` or use `--auto-clarify`.";

  const sections = questions.map((question) => {
    const answer = answerMap.get(question.id) || "";
    return `## ${question.category}

### ${question.id}: ${question.title}
Question: ${question.question}
Guidance: ${question.guidance}
Why it matters: ${question.reason}
Default: ${question.defaultAnswer}
Affects:
${toMarkdownList(question.affects)}
Answer: ${answer}`;
  }).join("\n\n");

  return `# Clarifications Needed Before Planning

${modeLine}

## Status

- Total questions: ${questions.length}
- Answered: ${answeredCount}
- Remaining: ${questions.length - answeredCount}

${sections}
`;
}

function renderClarifyPrompt(repoRoot, input, questions) {
  const items = questions.map((question) => {
    return `- ${question.id} (${question.category}): ${question.question}
  Default: ${question.defaultAnswer}
  Why: ${question.reason}`;
  }).join("\n");

  return renderTemplate(repoRoot, "templates/clarify-prompt-template.md", {
    projectName: input.projectName,
    summary: input.summary,
    questions: items,
    openQuestions: toMarkdownList(input.openQuestions || [])
  });
}

function splitListAnswer(answer) {
  const normalized = String(answer || "").trim();
  if (!normalized || /^none$/i.test(normalized)) {
    return [];
  }

  return uniqueNonEmpty(
    normalized
      .split(/[,/]/)
      .map((item) => item.trim())
  );
}

function applyClarificationAnswers(input, questions, answerMap) {
  const nextInput = JSON.parse(JSON.stringify(input));

  function addConstraint(prefix, value) {
    nextInput.constraints = uniqueNonEmpty([].concat(nextInput.constraints || [], `${prefix}: ${value}`));
  }

  function addNfr(prefix, value) {
    nextInput.nonFunctionalRequirements = uniqueNonEmpty([].concat(nextInput.nonFunctionalRequirements || [], `${prefix}: ${value}`));
  }

  questions.forEach((question) => {
    const answer = answerMap.get(question.id);
    if (!isMeaningfulClarificationAnswer(answer)) {
      return;
    }

    switch (question.id) {
      case "CLARIFY-AUTH-01":
        addConstraint("Authentication strategy", answer);
        break;
      case "CLARIFY-DATA-01":
        addConstraint("Primary data model", answer);
        break;
      case "CLARIFY-DEPLOY-01":
        addConstraint("Deployment target", answer);
        break;
      case "CLARIFY-INTEGRATIONS-01": {
        addConstraint("Integration scope", answer);
        const integrations = splitListAnswer(answer);
        nextInput.integrations = uniqueNonEmpty(integrations);
        break;
      }
      case "CLARIFY-ACCESS-01":
        addConstraint("Launch roles", answer);
        break;
      case "CLARIFY-WORKFLOW-01":
        addConstraint("Workflow states", answer);
        break;
      case "CLARIFY-OBS-01":
        addNfr("Operational signals", answer);
        break;
      case "CLARIFY-COMPLIANCE-01":
        addConstraint("Compliance constraints", answer);
        break;
      default:
        break;
    }
  });

  return nextInput;
}

function prepareClarifications(repoRoot, workingDir, outdir, input, autoClarify) {
  const questions = buildClarificationQuestions(input);
  const paths = clarificationPaths(workingDir, outdir);
  const existingAnswers = parseClarificationAnswers(paths.spec);
  const workspaceAnswers = outdir
    ? parseClarificationAnswers(clarificationPaths(workingDir, "").spec)
    : new Map();
  const answerMap = new Map();

  questions.forEach((question) => {
    const existingAnswer = existingAnswers.get(question.id) || workspaceAnswers.get(question.id);
    if (isMeaningfulClarificationAnswer(existingAnswer)) {
      answerMap.set(question.id, existingAnswer);
      return;
    }
    if (autoClarify) {
      answerMap.set(question.id, question.defaultAnswer);
    } else {
      answerMap.set(question.id, "");
    }
  });

  writeFile(paths.spec, renderClarifications(questions, answerMap, autoClarify));
  writeFile(paths.prompt, renderClarifyPrompt(repoRoot, input, questions));

  const unanswered = questions.filter((question) => !isMeaningfulClarificationAnswer(answerMap.get(question.id)));

  return {
    paths,
    questions,
    answerMap,
    unanswered,
    enrichedInput: applyClarificationAnswers(input, questions, answerMap)
  };
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

function loadScaffoldkitContext(repoRoot) {
  const configuredRoot = process.env.SCAFFOLDKIT_ROOT
    ? path.resolve(process.env.SCAFFOLDKIT_ROOT)
    : path.resolve(repoRoot, "../scaffoldkit");
  const blueprintsDir = path.join(configuredRoot, "src", "scaffoldkit", "blueprints");

  if (!fs.existsSync(blueprintsDir)) {
    return {
      root: "",
      availableBlueprints: []
    };
  }

  const availableBlueprints = fs.readdirSync(blueprintsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return {
    root: configuredRoot,
    availableBlueprints
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
  const primaryDataStoreDecision = inferPrimaryDataStoreDecision(input);
  const adrs = [
    {
      id: "ADR-001",
      title: "Initial Architecture Shape",
      decision: architecture.summary
    },
    {
      id: "ADR-002",
      title: "Primary Data Store",
      decision: primaryDataStoreDecision
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
  const combinedText = [
    input.summary,
    ...(input.coreFeatures || []),
    ...(input.constraints || [])
  ].join(" ").toLowerCase();
  const features = (input.coreFeatures || []).join(" ").toLowerCase();

  if (/\b(php|symfony|laravel|composer|artisan|phpunit|phpstan)\b/.test(combinedText)) {
    return "PHP/Symfony application";
  }

  if (/typescript/.test(constraints)) {
    if (/(cli|command line|terminal tool|developer tool|openclaw|memory sync)/.test(combinedText)) {
      return "TypeScript CLI tool";
    }
    if (/\b(dashboard|web app|web application|portal|admin)\b/.test(features)) {
      return "TypeScript web application";
    }
    return "TypeScript service stack";
  }

  if (/python/.test(constraints)) {
    return "Python application";
  }

  return "application stack to be confirmed";
}

function hasNoExternalDatabaseConstraint(input) {
  const text = [
    ...(input.constraints || []),
    ...(input.summary ? [input.summary] : [])
  ].join(" ").toLowerCase();
  return /no external databases?|without (a )?database|git is the source of truth|filesystem is the source of truth/.test(text);
}

function usesGitAsPrimaryStore(input) {
  const text = [
    input.summary,
    ...(input.constraints || []),
    ...(input.coreFeatures || [])
  ].join(" ").toLowerCase();
  return /git is the source of truth|git repo|git repository|memory files|memory\.md|daily logs/.test(text);
}

function inferPrimaryDataStore(input) {
  if (usesGitAsPrimaryStore(input)) {
    return "git";
  }
  if (hasNoExternalDatabaseConstraint(input)) {
    return "filesystem";
  }
  return "relational";
}

function inferPrimaryDataStoreDecision(input) {
  if (usesGitAsPrimaryStore(input)) {
    return "Use a Git-backed file store as the primary source of truth and keep sync metadata in files unless later requirements justify a separate database.";
  }
  if (hasNoExternalDatabaseConstraint(input)) {
    return "Use file-backed state as the primary data store unless later requirements explicitly justify introducing a database.";
  }
  return "Use a relational primary data store unless the domain clearly requires a different model.";
}

function inferDatabaseChoice(input, variableName) {
  const text = [
    ...(input.constraints || []),
    ...(input.nonFunctionalRequirements || []),
    ...(input.integrations || [])
  ].join(" ").toLowerCase();

  if (/sqlite/.test(text)) {
    return "sqlite";
  }
  if (/mysql/.test(text)) {
    return "mysql";
  }
  if (/mongo/.test(text) && variableName === "database") {
    return "mongodb";
  }
  return "postgresql";
}

function inferAuthStrategy(input, blueprint) {
  const text = [
    input.summary,
    ...(input.coreFeatures || []),
    ...(input.constraints || []),
    ...(input.openQuestions || [])
  ].join(" ").toLowerCase();

  if (/none|anonymous|public-only/.test(text)) {
    return "none";
  }
  if (/oauth|oauth2/.test(text) && blueprint === "rest-api") {
    return "oauth2";
  }
  if (/api key|api-key/.test(text)) {
    return "api-key";
  }
  if (/sso|next-auth/.test(text) && blueprint === "nextjs-fullstack") {
    return "next-auth";
  }
  return "jwt";
}

function inferSymfonyVersion(input) {
  const text = [
    input.summary,
    ...(input.coreFeatures || []),
    ...(input.constraints || []),
    ...(input.openQuestions || [])
  ].join(" ").toLowerCase();

  if (/symfony(?:\s+|)6(?:\.4)?\b/.test(text)) {
    return "6.4";
  }
  if (/symfony(?:\s+|)7\.1\b/.test(text)) {
    return "7.1";
  }
  return "7.2";
}

function inferSymfonyDatabase(input, blueprint) {
  const text = [
    ...(input.constraints || []),
    ...(input.nonFunctionalRequirements || []),
    ...(input.integrations || []),
    ...(input.coreFeatures || [])
  ].join(" ").toLowerCase();

  if (/mariadb/.test(text)) {
    return blueprint === "symfony-backend" ? "mariadb" : "mysql";
  }
  if (/mysql/.test(text)) {
    return "mysql";
  }
  return "postgresql";
}

function scaffoldkitBlueprintRecommendation(input, output, scaffoldkitContext) {
  const combinedText = [
    input.projectName,
    input.summary,
    ...(input.coreFeatures || []),
    ...(input.constraints || []),
    ...(input.integrations || [])
  ].join(" ").toLowerCase();
  const techStack = inferTechStack(input).toLowerCase();
  const available = new Set(scaffoldkitContext.availableBlueprints || []);

  let candidates;
  let reason;
  let confidence = "fallback";
  let manualStructureReason = "";

  if (/\b(php|symfony|laravel|composer|artisan|phpunit|phpstan)\b/.test(combinedText)) {
    if (/(next\.?js|react|vue|angular|frontend|spa|client-side)/.test(combinedText)) {
      candidates = ["symfony-nextjs", "reference-php-app"];
      reason = "PHP/Symfony + JS frontend signals -> symfony-nextjs";
      confidence = "strong";
    } else if (
      /(api|rest|json endpoint|backend|service|graphql)/.test(combinedText) &&
      !/(frontend|portal|admin ui|dashboard)/.test(combinedText)
    ) {
      candidates = ["symfony-backend", "reference-php-app"];
      reason = "PHP/Symfony backend/API without frontend -> symfony-backend";
      confidence = "strong";
    } else {
      candidates = ["reference-php-app", "symfony-backend"];
      reason = "Generic PHP/Symfony -> reference-php-app as baseline";
      confidence = "medium";
      manualStructureReason = "The framework family is clear, but the generated scaffold may still need manual adaptation for the final repository layout.";
    }
  } else if (/(landing page|marketing site|content site|blog|documentation site|static site)/.test(combinedText)) {
    candidates = ["static-site", "nextjs-frontend", "nextjs-fullstack"];
    reason = "The request reads like a content-oriented or marketing-style site rather than an application backend.";
    confidence = "strong";
  } else if (/\b(cli|command line|terminal tool|developer tool|code generator|scaffold)\b/.test(combinedText)) {
    candidates = ["cli-tool", "express-api", "rest-api"];
    reason = "The request reads like an internal or developer-facing tool with command-style workflows.";
    confidence = "strong";
  } else if (/typescript web application/.test(techStack)) {
    candidates = ["nextjs-fullstack", "saas-dashboard", "nextjs-frontend"];
    reason = "The plan points to a TypeScript web application with product-style UI surfaces.";
    confidence = "strong";
  } else if (/typescript service stack/.test(techStack)) {
    candidates = ["express-api", "rest-api"];
    reason = "The plan points to a TypeScript service-oriented implementation.";
    confidence = "strong";
  } else if (/\b(django|django rest|drf)\b/.test(combinedText)) {
    candidates = ["rest-api", "express-api"];
    reason = "The request points to a Django-style backend, but only the generic REST API scaffold is currently available.";
    confidence = "weak";
    manualStructureReason = "Use the generated scaffold only as a starting point. The agent should expect to create or adapt the Django-specific project structure manually.";
  } else if (
    /\b(rest api|rest\/json|json api|json over http|http api|web api|api service|api endpoints?)\b/.test(combinedText) &&
    !/\b(cli|command line|terminal)\b/.test(combinedText)
  ) {
    candidates = ["rest-api", "express-api"];
    reason = "The request reads like a REST/JSON HTTP API service, so an API-first scaffold is the closest fit.";
    confidence = "strong";
  } else if (/python application/.test(techStack)) {
    candidates = ["rest-api", "cli-tool"];
    reason = "The request points to a Python application, but there is no Python app scaffold that cleanly matches the requested shape.";
    confidence = "weak";
    manualStructureReason = "The recommendation is only a partial fit. The agent should expect to create or adapt the repository structure manually.";
  } else if (/small service-oriented split/.test(output.architectureRecommendation.shape)) {
    candidates = ["rest-api", "express-api"];
    reason = "The architecture recommendation is service-oriented, so an API-first scaffold is the closest fit.";
    confidence = "medium";
    manualStructureReason = "Treat the scaffold as a baseline, not as the complete repository layout.";
  } else if (output.plannerProfile === "platform") {
    candidates = ["rest-api", "cli-tool", "express-api"];
    reason = "Platform work maps better to API or tool-oriented scaffolds than to product UI blueprints.";
    confidence = "medium";
    manualStructureReason = "Treat the scaffold as a baseline, not as the complete repository layout.";
  } else {
    candidates = ["rest-api", "express-api", "nextjs-fullstack"];
    reason = "No stronger scaffold signal was found, so the fallback stays close to the recommended architecture and stack.";
    confidence = "weak";
    manualStructureReason = "No blueprint closely matches the request. The agent should expect to create or adapt the project structure manually.";
  }

  const blueprint = scaffoldkitContext.root
    ? candidates.find((candidate) => available.has(candidate)) || candidates[0]
    : candidates[0];

  return {
    blueprint,
    candidates,
    reason,
    confidence,
    agentMustCreateStructure: confidence === "weak",
    manualStructureReason,
    validatedLocally: scaffoldkitContext.root ? available.has(blueprint) : false,
    scaffoldkitRoot: scaffoldkitContext.root || ""
  };
}

function scaffoldkitExecutionGuidance(input, output, scaffoldkitContext) {
  const recommendation = scaffoldkitBlueprintRecommendation(input, output, scaffoldkitContext);
  const summary = recommendation.agentMustCreateStructure
    ? "Treat the scaffold recommendation as a partial fit. Create or adapt the repository structure deliberately before feature work begins."
    : recommendation.confidence === "medium"
      ? "Use the scaffold as the starting point, but verify the generated layout against the plan before implementation expands."
      : "Use the recommended scaffold as the baseline repository structure, then refine it against the plan.";

  return {
    ...recommendation,
    summary
  };
}

// Map the selected scaffold blueprint to the language its generated task file
// paths should use. This mirrors the framework/language choices in
// scaffoldkitSuggestedVariables so the task layer stays coherent with the
// scaffold's actual stack.
function blueprintLanguage(blueprint, input) {
  const techStack = inferTechStack(input).toLowerCase();
  const constraintsText = (input.constraints || []).join(" ").toLowerCase();
  switch (blueprint) {
    case "rest-api":
      // framework = express (TS) for a TypeScript service stack, else fastapi (Python).
      return /typescript service stack/.test(techStack) ? "typescript" : "python";
    case "cli-tool":
      // language = typescript when the constraints ask for it, otherwise python (typer).
      return /typescript/.test(constraintsText) ? "typescript" : "python";
    case "reference-php-app":
    case "symfony-backend":
    case "symfony-nextjs":
      // symfony-nextjs is a PHP backend with a Next.js frontend; feature task
      // files default to the dominant PHP backend layout.
      return "php";
    default:
      // nextjs-fullstack, nextjs-frontend, express-api, saas-dashboard, static-site, ...
      return "typescript";
  }
}

function scaffoldkitSuggestedVariables(input, output, blueprint) {
  const featuresText = (input.coreFeatures || []).join(" ").toLowerCase();
  const constraintsText = (input.constraints || []).join(" ").toLowerCase();
  const summaryText = String(input.summary || "").toLowerCase();
  const combinedText = `${featuresText} ${constraintsText} ${summaryText}`;
  const suggested = {
    project_name: slugify(input.projectName, 40) || "generated-app",
    display_name: input.projectName,
    description: input.summary,
    ai_context: true
  };

  if (blueprint === "nextjs-fullstack") {
    suggested.db_provider = inferDatabaseChoice(input, "db_provider");
    suggested.auth_strategy = inferAuthStrategy(input, blueprint);
    suggested.use_docker = /docker|container|kubernetes|compose/.test(combinedText);
    suggested.use_analytics = /analytics|dashboard|report/.test(featuresText);
    suggested.use_email = /email|notification|invite/.test(combinedText);
  } else if (blueprint === "express-api") {
    suggested.db_provider = inferDatabaseChoice(input, "db_provider");
    suggested.auth_strategy = inferAuthStrategy(input, blueprint);
    suggested.use_docker = /docker|container|kubernetes|compose/.test(combinedText);
    suggested.use_queue = /background jobs|queue|workflow|notification/.test(`${featuresText} ${output.architectureRecommendation.shape}`);
    suggested.use_websockets = /realtime|real-time|websocket/.test(combinedText);
  } else if (blueprint === "rest-api") {
    suggested.database = inferDatabaseChoice(input, "database");
    suggested.framework = /typescript service stack/.test(inferTechStack(input).toLowerCase()) ? "express" : "fastapi";
    suggested.use_auth = !/public-only|anonymous|no auth/.test(combinedText);
    suggested.auth_strategy = inferAuthStrategy(input, blueprint);
    suggested.use_docker = /docker|container|kubernetes|compose/.test(combinedText);
    suggested.use_openapi = true;
  } else if (blueprint === "cli-tool") {
    suggested.language = /typescript/.test(constraintsText) ? "typescript" : "python";
    suggested.cli_framework = suggested.language === "typescript" ? "commander" : "typer";
    suggested.test_strategy = /integration|git|sync|filesystem|queue/.test(combinedText)
      ? "integration-tests"
      : "unit-tests";
    suggested.use_config_file = true;
    suggested.config_format = "json";
    suggested.distribution = suggested.language === "typescript" ? "binary" : "pip-package";
    suggested.description = input.summary || "A developer-facing automation tool";
  } else if (blueprint === "reference-php-app") {
    suggested.use_docker = /docker|container|compose/.test(combinedText);
  } else if (blueprint === "symfony-backend") {
    suggested.php_version = /php 8\.2/.test(constraintsText) ? "8.2" : "8.3";
    suggested.symfony_version = inferSymfonyVersion(input);
    suggested.database = inferSymfonyDatabase(input, blueprint);
    suggested.use_docker = /docker|container|compose/.test(combinedText);
  } else if (blueprint === "symfony-nextjs") {
    suggested.php_version = /php 8\.2/.test(constraintsText) ? "8.2" : "8.3";
    suggested.database = inferSymfonyDatabase(input, blueprint);
    suggested.use_docker = /docker|container|compose/.test(combinedText);
  } else if (blueprint === "static-site") {
    suggested.description = input.summary || "A static website";
  }

  return suggested;
}

function loadStackPatterns(repoRoot) {
  try {
    return readJson(path.join(repoRoot, "config", "stack-patterns.json"));
  } catch (error) {
    return { patterns: {} };
  }
}

function isGitMemorySyncFeature(feature) {
  const lower = String(feature || "").toLowerCase();
  return (
    /\b(memory|memory\.md|daily logs?)\b/.test(lower) ||
    /\bgit repo|git repository|remote git\b/.test(lower) ||
    (/\bsync\b/.test(lower) &&
      /\b(cron|interval|dry-run|dry run|conflict|merge|remote|push|pull)\b/.test(lower))
  );
}

function gitMemorySyncFeatureFiles(feature) {
  const lower = String(feature || "").toLowerCase();
  const files = [
    "src/memory-sync/git-client.ts",
    "src/memory-sync/config.ts",
    "src/memory-sync/state-store.ts",
    "tests/integration/memory-sync.test.ts"
  ];

  if (/\bpush\b/.test(lower)) {
    files.unshift("src/memory-sync/push.ts");
  } else if (/\bpull\b/.test(lower) || /\bmerge\b/.test(lower)) {
    files.unshift("src/memory-sync/pull.ts");
    files.push("src/memory-sync/merge.ts");
  } else if (/\bconflict\b/.test(lower)) {
    files.unshift("src/memory-sync/conflicts.ts");
    files.push("src/memory-sync/merge.ts");
  } else if (/\bcron|interval|schedule\b/.test(lower)) {
    files.unshift("src/memory-sync/scheduler.ts");
  } else if (/\bdry-run|dry run|preview\b/.test(lower)) {
    files.unshift("src/memory-sync/preview.ts");
  } else {
    files.unshift("src/memory-sync/sync.ts");
  }

  return Array.from(new Set(files));
}

function pascalCaseFromSlug(slug) {
  return (
    String(slug || "")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "Feature"
  );
}

// Generic per-feature file suggestions used when no stack pattern matches. The
// layout is chosen for the selected blueprint's language so task paths stay
// coherent with the scaffold (e.g. a FastAPI rest-api gets Python paths instead
// of hardcoded TypeScript).
function genericFeatureFiles(feature, architectureShape, stack) {
  const slug = slugify(feature, 40) || "feature"; // Limit module names to 40 chars
  const lower = feature.toLowerCase();
  const language = (stack && stack.language) || "typescript";
  const blueprint = (stack && stack.blueprint) || "";
  const isBackgroundWork =
    /approval|workflow|notification|queue/.test(lower) || /background jobs/.test(architectureShape);
  const isAudit = /audit|review|approval/.test(lower);

  if (language === "python") {
    // Python module names are identifiers, so use snake_case (the kebab slug
    // would produce non-importable module names like `foo-bar_service.py`).
    const moduleName = slug.replace(/-/g, "_");
    const files =
      blueprint === "cli-tool"
        ? [`src/commands/${moduleName}.py`, `src/core/${moduleName}.py`, `tests/test_${moduleName}.py`]
        : [
            `src/routes/${moduleName}.py`,
            `src/services/${moduleName}_service.py`,
            `src/repositories/${moduleName}_repository.py`,
            `tests/integration/test_${moduleName}.py`
          ];
    if (isBackgroundWork) {
      files.push(`src/jobs/${moduleName}_job.py`);
    }
    if (isAudit) {
      files.push("src/services/audit_log.py");
    }
    return Array.from(new Set(files));
  }

  if (language === "php") {
    const name = pascalCaseFromSlug(slug);
    const files = [
      `src/Controller/${name}Controller.php`,
      `src/Service/${name}Service.php`,
      `src/Repository/${name}Repository.php`,
      `tests/${name}Test.php`
    ];
    if (isBackgroundWork) {
      files.push(`src/MessageHandler/${name}Handler.php`);
    }
    if (isAudit) {
      files.push("src/Service/AuditLogService.php");
    }
    return Array.from(new Set(files));
  }

  // TypeScript (default): modular layout.
  const files = [
    `src/modules/${slug}/index.ts`,
    `src/modules/${slug}/${slug}.service.ts`,
    `src/modules/${slug}/${slug}.repository.ts`,
    `tests/integration/${slug}.test.ts`
  ];
  if (/dashboard|admin|form|portal/.test(lower)) {
    files.unshift(`src/routes/${slug}.ts`);
  }
  if (isBackgroundWork) {
    files.push(`src/jobs/${slug}.job.ts`);
  }
  if (isAudit) {
    files.push("src/modules/audit/audit-log.ts");
  }
  return Array.from(new Set(files));
}

function featureFiles(feature, architectureShape, stackPatterns, stack) {
  // The git-memory-sync layout is TypeScript-specific, so only short-circuit for
  // a TypeScript (or unspecified) stack; other languages fall through to the
  // language-aware layout below.
  const language = (stack && stack.language) || "typescript";
  if (language === "typescript" && isGitMemorySyncFeature(feature)) {
    return gitMemorySyncFeatureFiles(feature);
  }

  // Prefer a known stack pattern's files for the selected blueprint.
  if (stackPatterns && stackPatterns.patterns) {
    const match = matchPattern(feature, stackPatterns.patterns);

    if (match && match.pattern.files) {
      const patternFiles = resolvePatternFiles(match.pattern, stack && stack.blueprint);
      if (patternFiles.length) {
        return patternFiles;
      }
    }
  }

  // No pattern matched the selected blueprint: emit a language-aware generic layout.
  return genericFeatureFiles(feature, architectureShape, stack);
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

function buildTasks(input, phase, architecture, stackPatterns, stack) {
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
        "PROJECT.md",
        docsPath("project-charter.md"),
        docsPath("architecture-overview.md"),
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
        files: featureFiles(feature, architecture.shape, stackPatterns, stack),
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

function buildOutput(input, config, playbookContext, repoRoot, inputMetadata, scaffoldkitContext) {
  const phase = inferPhase(input);
  const pathName = inferPath(phase);
  const profile = plannerProfile(input, config);
  const intake = intakeSignals(input, config);
  const options = architectureOptions(input, phase);
  const architecture = architectureRecommendation(options, phase);
  const stackPatterns = loadStackPatterns(repoRoot);
  // Resolve the scaffold blueprint before building tasks so generated task file
  // paths match the scaffold's actual stack. scaffoldkitBlueprintRecommendation
  // only reads architectureRecommendation.shape and plannerProfile from the
  // output, both known here, so this is the same blueprint the downstream
  // artifact writers compute for the same inputs (deterministic, no drift).
  const scaffoldContext = scaffoldkitContext || { root: "", availableBlueprints: [] };
  const blueprint = scaffoldkitBlueprintRecommendation(
    input,
    { architectureRecommendation: architecture, plannerProfile: profile },
    scaffoldContext
  ).blueprint;
  const taskStack = { blueprint, language: blueprintLanguage(blueprint, input) };
  const tasks = buildTasks(input, phase, architecture, stackPatterns, taskStack);

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
    scaffoldBlueprint: blueprint,
    recommendedPlaybooks: recommendedPlaybooks(phase, pathName, playbookContext, repoRoot),
    recommendedGuidanceAreas: recommendedGuidanceAreas(phase, profile, config),
    recommendedArtifacts: recommendedArtifacts(phase, profile, config),
    architectureOptions: options,
    architectureRecommendation: architecture,
    adrCandidates: adrCandidates(input, architecture),
    tasks,
    executionWaves: executionWaves(tasks),
    dependencyGraph: dependencyGraph(tasks),
    risks: buildRisks(input, phase),
    openQuestions: input.openQuestions || [],
    defaultBranch: input.defaultBranch || "main"
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

function renderProjectIndex(repoRoot, input, output) {
  const currentWave = output.executionWaves[0];
  const currentWaveTasks = currentWave
    ? currentWave.taskIds.map((taskId) => {
        const task = output.tasks.find((candidate) => candidate.id === taskId);
        return task ? `- ${task.id} ${task.title}` : `- ${taskId}`;
      }).join("\n")
    : "- No execution wave has been generated yet.";
  const waveSummary = output.executionWaves.map((wave) => {
    return `- ${wave.id}: ${wave.goal} (${wave.taskIds.length} tasks)`;
  }).join("\n") || "- None";

  return renderTemplate(repoRoot, "templates/project-template.md", {
    projectName: input.projectName,
    summary: input.summary,
    plannerProfile: output.plannerProfile,
    phase: output.phase,
    path: output.path,
    intakeCompleteness: output.intakeCompleteness,
    dataSensitivity: input.dataSensitivity || "low",
    recommendedArchitecture: output.architectureRecommendation.summary,
    currentWaveId: currentWave ? currentWave.id : "none",
    currentWaveGoal: currentWave ? currentWave.goal : "No execution wave has been generated yet.",
    currentWaveTasks,
    waveSummary,
    architectureReasons: toMarkdownList(output.architectureRecommendation.reasons || []),
    risks: toMarkdownList(output.risks),
    openQuestions: toMarkdownList(output.openQuestions),
    guidanceAreas: toMarkdownList(output.recommendedGuidanceAreas || []),
    recommendedArtifacts: toMarkdownList(output.recommendedArtifacts || [])
  });
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
  const scaffoldGuidance = scaffoldkitExecutionGuidance(input, output, { root: "", availableBlueprints: [] });
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

## Scaffold Guidance

- Recommended blueprint: ${scaffoldGuidance.blueprint}
- Confidence: ${scaffoldGuidance.confidence}
- ${scaffoldGuidance.summary}
${scaffoldGuidance.manualStructureReason ? `- ${scaffoldGuidance.manualStructureReason}` : ""}

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
    const parentDir = path.dirname(resolvedPath);
    return path.basename(parentDir) === "planning" ? path.dirname(parentDir) : parentDir;
  }
  throw new CliError("Previous run path must be a directory or plan-output.json.", EXIT_CODES.USAGE);
}

function resolvePlanOutputPath(runDir) {
  const candidates = [
    path.join(runDir, planningPath("plan-output.json")),
    path.join(runDir, "plan-output.json")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function loadPreviousRun(repoRoot, runPath) {
  if (!runPath) {
    return null;
  }

  const dir = resolveRunDirectory(repoRoot, runPath);
  const planOutputPath = resolvePlanOutputPath(dir);
  if (!fs.existsSync(planOutputPath)) {
    throw new CliError(`Previous run is missing ${planningPath("plan-output.json")}: ${dir}`, EXIT_CODES.RUNTIME);
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
    LAYOUT_REGISTRY.planning.planOutput,
    LAYOUT_REGISTRY.rootFiles.project,
    LAYOUT_REGISTRY.rootFiles.charter,
    LAYOUT_REGISTRY.rootFiles.architecture,
    LAYOUT_REGISTRY.rootFiles.deliveryPlan,
    LAYOUT_REGISTRY.exports.scaffoldkit
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
    handoffPath("runner"),
    "handoff-status.json",
    "resume-notes.md",
    "reviews",
    "notes",
    "runner"
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

function renderAiAgents(input, output, scaffoldkitContext) {
  const scaffoldGuidance = scaffoldkitExecutionGuidance(input, output, scaffoldkitContext);
  return `# AGENTS

## Engineering Model

- Spec-driven planning: make the intended outcome, scope, constraints, acceptance criteria, and major risks explicit before coding.
- Context-driven execution: use the project architecture, domain constraints, security posture, and operating assumptions when making changes.
- Eval-driven delivery: rely on tests, review findings, rollout readiness, and operational checks before calling work done.

## Roles

- Planning lead: maintains the plan, validates architecture assumptions, and reruns planning when inputs materially change.
- Architecture reviewer: challenges module boundaries, scaling assumptions, and integration risks before implementation expands.
- Implementation lead: executes one reviewable task at a time and updates tests and docs with each change.
- Human owner: remains accountable for review, release, and acceptance of agent-generated work.
${output.path === "enterprise" ? "- Governance lead: owns control artifacts, access review cadence, and exception tracking for enterprise-path work." : ""}

## Workflow

1. Read \`.ai/ARCHITECTURE.md\`, \`.ai/TASKS.md\`, and the task docs in \`tasks/\` before changing code.
2. Follow the applicable playbooks listed below for workflow, testing, documentation, and governance expectations.
3. ${scaffoldGuidance.summary}
4. Keep diffs small, update tests with the change, and avoid bundling unrelated work.
5. Escalate blockers or scope changes instead of silently improvising around them.

## Applicable Playbooks

${toMarkdownList(output.recommendedPlaybooks)}

## Change Rules

- Preserve backward compatibility unless a breaking change is explicitly accepted.
- Update docs and ADRs when architectural assumptions shift.
- Treat generated artifacts as review inputs, not as permission to skip engineering judgment.

## Project Context

- Project: ${input.projectName}
- Planner profile: ${output.plannerProfile}
- Phase: ${output.phase}
- Path: ${output.path}
- Scaffold blueprint: ${scaffoldGuidance.blueprint}
- Scaffold confidence: ${scaffoldGuidance.confidence}
${scaffoldGuidance.manualStructureReason ? `- Scaffold note: ${scaffoldGuidance.manualStructureReason}` : ""}
`;
}

function renderRootAgents(output) {
  return `# AGENTS

Primary agent instructions live in \`.ai/AGENTS.md\`.

For machine-readable path discovery, read \`planforge-index.json\`.

## Read Order

1. \`PROJECT.md\`
2. \`.ai/AGENTS.md\`
3. \`.ai/ARCHITECTURE.md\`
4. \`.ai/TASKS.md\`
5. \`.ai/DECISIONS.md\`

## Generated Directories

- ADRs: \`adrs/\`
- Tasks: \`tasks/\`

## Build This Next

1. Read \`${docsPath("architecture-overview.md")}\` for the intended architecture.
2. Work the generated tasks in \`tasks/\` in dependency order (see \`.ai/TASKS.md\` for the wave order and critical path).
3. Keep \`PROJECT.md\` and \`.ai/\` as the standing context.

## Important Files

- Machine-readable index: \`planforge-index.json\`
- Architecture: \`${docsPath("architecture-overview.md")}\`
- Delivery plan: \`${docsPath("delivery-plan.md")}\`

## Working Notes

- Start with the overview docs and \`.ai/\`, then move into \`tasks/\` and \`adrs/\` as needed.
- Treat generated artifacts as guidance, not as permission to skip engineering judgment.

## Current Plan Context

- Planner profile: ${output.plannerProfile}
- Phase: ${output.phase}
- Path: ${output.path}
`;
}

function renderClaudeShim() {
  return `# CLAUDE

Use \`AGENTS.md\` in the project root as the primary entry point.
For machine-readable path discovery, use \`planforge-index.json\`.

Primary references:

1. \`AGENTS.md\`
2. \`.ai/AGENTS.md\`
3. \`.ai/ARCHITECTURE.md\`
4. \`.ai/TASKS.md\`
5. \`.ai/DECISIONS.md\`
`;
}

function renderPlanforgeIndex(output, presence = {}) {
  const directories = { ...LAYOUT_REGISTRY.directories };
  // Conditional directories are appended only when actually generated, so the index
  // never advertises a directory that is absent on disk. Iteration follows the
  // registry declaration order (specs, runbooks, governance).
  for (const [key, dir] of Object.entries(LAYOUT_REGISTRY.conditionalDirectories)) {
    if (presence[key]) {
      directories[key] = dir;
    }
  }

  return {
    version: "1.0",
    generatedBy: "agent-planforge",
    summary: "Machine-readable index of the generated planforge artifact layout.",
    context: {
      plannerProfile: output.plannerProfile,
      phase: output.phase,
      path: output.path
    },
    rootFiles: { ...LAYOUT_REGISTRY.rootFiles },
    directories,
    planning: { ...LAYOUT_REGISTRY.planning },
    exports: { ...LAYOUT_REGISTRY.exports },
    ai: { ...LAYOUT_REGISTRY.ai }
  };
}

function renderAiArchitecture(input, output, scaffoldkitContext) {
  const scaffoldGuidance = scaffoldkitExecutionGuidance(input, output, scaffoldkitContext);
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

## Scaffold Guidance

- Recommended blueprint: ${scaffoldGuidance.blueprint}
- Confidence: ${scaffoldGuidance.confidence}
- ${scaffoldGuidance.summary}
${scaffoldGuidance.manualStructureReason ? `- ${scaffoldGuidance.manualStructureReason}` : ""}

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

function writeAiArtifacts(input, output, outdir, scaffoldkitContext, planforgeIndex) {
  writeFile(path.join(outdir, "AGENTS.md"), renderRootAgents(output));
  writeFile(path.join(outdir, "CLAUDE.md"), renderClaudeShim());
  writeFile(path.join(outdir, "planforge-index.json"), `${JSON.stringify(planforgeIndex, null, 2)}\n`);
  writeFile(path.join(outdir, ".ai", "AGENTS.md"), renderAiAgents(input, output, scaffoldkitContext));
  writeFile(path.join(outdir, ".ai", "ARCHITECTURE.md"), renderAiArchitecture(input, output, scaffoldkitContext));
  writeFile(path.join(outdir, ".ai", "TASKS.md"), renderAiTasks(output));
  writeFile(path.join(outdir, ".ai", "DECISIONS.md"), renderAiDecisions(output));
}

function renderScaffoldKitInput(input, output, scaffoldkitContext) {
  const recommendation = scaffoldkitExecutionGuidance(input, output, scaffoldkitContext);
  return {
    version: "1.1",
    exportedBy: "agent-planforge",
    projectName: input.projectName,
    summary: input.summary,
    blueprint: recommendation.blueprint,
    blueprintCandidates: recommendation.candidates,
    blueprintReason: recommendation.reason,
    blueprintConfidence: recommendation.confidence,
    blueprintValidatedLocally: recommendation.validatedLocally,
    agentMustCreateStructure: recommendation.agentMustCreateStructure,
    scaffoldExecutionSummary: recommendation.summary,
    scaffoldExecutionReason: recommendation.manualStructureReason,
    plannerProfile: output.plannerProfile,
    architecture: {
      shape: output.architectureRecommendation.shape,
      optionId: output.architectureRecommendation.optionId,
      phase: output.phase,
      path: output.path
    },
    stack: {
      hint: inferTechStack(input),
      dataStore: inferPrimaryDataStore(input),
      integrations: input.integrations || []
    },
    features: input.coreFeatures,
    constraints: input.constraints,
    suggestedVariables: scaffoldkitSuggestedVariables(input, output, recommendation.blueprint),
    playbooks: output.recommendedPlaybooks,
    aiContextFiles: [
      ".ai/AGENTS.md",
      ".ai/ARCHITECTURE.md",
      ".ai/TASKS.md",
      ".ai/DECISIONS.md"
    ]
  };
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

function writeOperationalArtifacts(input, output, outdir, rerunReport, scaffoldkitContext) {
  writeFile(path.join(outdir, planningPath("structured-input.json")), `${JSON.stringify(output.inputSnapshot, null, 2)}\n`);
  writeFile(
    path.join(outdir, exportsPath("scaffoldkit-input.json")),
    `${JSON.stringify(renderScaffoldKitInput(input, output, scaffoldkitContext), null, 2)}\n`
  );
  writeFile(path.join(outdir, planningPath("rerun-report.json")), `${JSON.stringify(rerunReport, null, 2)}\n`);
  writeFile(path.join(outdir, planningPath("rerun-summary.md")), renderRerunSummary(rerunReport));
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

  if (shouldWriteRunbooks(output)) {
    writeFile(path.join(outdir, "runbooks", "release-readiness.md"), renderRunbookBaseline(repoRoot, input, output));
  }

  if (shouldWriteGovernance(output)) {
    writeFile(path.join(outdir, "governance", "service-ownership.md"), renderServiceOwnership(repoRoot, input, config));
    writeFile(path.join(outdir, "governance", "data-classification-matrix.md"), renderDataClassification(repoRoot, input));
    writeFile(path.join(outdir, "governance", "access-review-plan.md"), renderAccessReview(repoRoot, input, config));
    writeFile(path.join(outdir, "governance", "exception-register.md"), renderExceptionRegister(repoRoot, input));
  }
}

function writeMakefile(repoRoot, outdir) {
  const templatePath = path.join(repoRoot, "templates", "Makefile.template");
  const makefileContent = readText(templatePath, "Makefile.template");
  writeFile(path.join(outdir, toolingPath("Makefile")), makefileContent);
}

function readScaffoldkitBlueprint(outdir) {
  const scaffoldkitInputPath = fs.existsSync(path.join(outdir, exportsPath("scaffoldkit-input.json")))
    ? path.join(outdir, exportsPath("scaffoldkit-input.json"))
    : path.join(outdir, "scaffoldkit-input.json");

  if (!fs.existsSync(scaffoldkitInputPath)) {
    return "";
  }

  try {
    const scaffoldkitInput = JSON.parse(readText(scaffoldkitInputPath, "scaffoldkit-input.json"));
    return scaffoldkitInput && scaffoldkitInput.blueprint ? scaffoldkitInput.blueprint : "";
  } catch (error) {
    return "";
  }
}

function shouldWriteRuntimeTemplates(input, output, outdir) {
  if (fs.existsSync(path.join(outdir, "package.json"))) {
    return true;
  }

  const blueprint = readScaffoldkitBlueprint(outdir);

  if (blueprint === "cli-tool") {
    return false;
  }

  if (["reference-php-app", "symfony-backend", "symfony-nextjs"].includes(blueprint)) {
    return false;
  }

  if (hasNoExternalDatabaseConstraint(input) || usesGitAsPrimaryStore(input)) {
    return false;
  }

  return new Set([
    "nextjs-fullstack",
    "nextjs-frontend",
    "express-api",
    "rest-api",
    "saas-dashboard"
  ]).has(blueprint);
}

function writeDockerFiles(repoRoot, outdir) {
  const dockerComposePath = path.join(repoRoot, "templates", "docker-compose.dev.yml.template");
  const dockerfilePath = path.join(repoRoot, "templates", "Dockerfile.dev.template");
  const dockerignorePath = path.join(repoRoot, "templates", ".dockerignore.template");
  
  const dockerComposeContent = readText(dockerComposePath, "docker-compose.dev.yml.template");
  const dockerfileContent = readText(dockerfilePath, "Dockerfile.dev.template");
  const dockerignoreContent = readText(dockerignorePath, ".dockerignore.template");
  
  writeFile(path.join(outdir, toolingPath("docker-compose.dev.yml")), dockerComposeContent);
  writeFile(path.join(outdir, toolingPath("Dockerfile.dev")), dockerfileContent);
  writeFile(path.join(outdir, toolingPath(".dockerignore")), dockerignoreContent);
}

function writePreCommitHooks(repoRoot, outdir) {
  const huskyPreCommitPath = path.join(repoRoot, "templates", ".husky-pre-commit.template");
  const lintStagedConfigPath = path.join(repoRoot, "templates", "lint-staged.config.js.template");
  
  const huskyPreCommitContent = readText(huskyPreCommitPath, ".husky-pre-commit.template");
  const lintStagedConfigContent = readText(lintStagedConfigPath, "lint-staged.config.js.template");
  
  writeFile(path.join(outdir, toolingPath(".husky-pre-commit")), huskyPreCommitContent);
  writeFile(path.join(outdir, toolingPath("lint-staged.config.js")), lintStagedConfigContent);
}

function writeBranchInfo(repoRoot, outdir, defaultBranch, autoDetected) {
  const templatePath = path.join(repoRoot, "templates", "BRANCH_INFO.md.template");
  let content = readText(templatePath, "BRANCH_INFO.md.template");
  
  // Simple template replacement with direct placeholders
  const detectionMethod = autoDetected 
    ? "auto-detected from the repository" 
    : "configured in the planning input";
  
  content = content.replace(/{{defaultBranch}}/g, defaultBranch);
  content = content.replace(/{{detectionMethod}}/g, detectionMethod);
  
  writeFile(path.join(outdir, toolingPath("BRANCH_INFO.md")), content);
}

function detectDefaultBranch(outdir) {
  const { execSync } = require("child_process");
  
  try {
    // Try to detect from existing .git
    const branch = execSync("git symbolic-ref --short HEAD", {
      cwd: outdir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return branch || "main";
  } catch (error) {
    // Not a git repo or no HEAD, default to main
    return "main";
  }
}

function runNpmInstall(outdir) {
  const packageJsonPath = path.join(outdir, "package.json");
  
  // Only run npm install if package.json exists
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }
  
  const { spawnSync } = require("child_process");
  
  console.log("Running npm install to generate package-lock.json...");
  
  const result = spawnSync("npm", ["install"], {
    cwd: outdir,
    encoding: "utf8"
  });

  if (result.status === 0) {
    console.log("✓ package-lock.json generated successfully");
    return;
  }

  const installOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const details = [
    `Output directory: ${outdir}`,
    "Fix package.json or rerun with --no-install if you only need planning artifacts."
  ];

  if (result.error) {
    details.push(`Install error: ${result.error.message}`);
  } else if (installOutput) {
    details.push(`npm output: ${installOutput.split("\n")[0]}`);
  }

  throw new CliError(
    "npm install failed in the output directory.",
    EXIT_CODES.RUNTIME,
    details
  );
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

    if (!args.outdir && !args.validateOnly && !args.clarify) {
      throw new CliError("Missing required argument: --outdir <dir>", EXIT_CODES.USAGE, [usageText()]);
    }

    // Separate internal planforge paths from user working directory
    const planforgeRoot = path.resolve(__dirname, ".."); // For config/, models/
    const workingDir = process.cwd(); // For user-provided --input, --outdir
    
    const playbookContext = loadPlaybookContext(planforgeRoot);
    const scaffoldkitContext = loadScaffoldkitContext(planforgeRoot);
    const config = loadPlannerConfig(planforgeRoot, args.config);
    const loadedInput = loadPlanningInput(workingDir, planforgeRoot, args.input, args.format);
    const inputMetadata = loadedInput.metadata;
    let input = loadedInput.input;

    if (args.clarify) {
      const clarification = prepareClarifications(planforgeRoot, workingDir, args.outdir, input, args.autoClarify);
      if (clarification.unanswered.length && !args.autoClarify) {
        console.log(`Clarifications written to ${clarification.paths.spec}`);
        console.log("Answer the questions, then rerun with --clarify or use --auto-clarify.");
        return;
      }
      input = clarification.enrichedInput;
    }

    const previousRun = loadPreviousRun(workingDir, args.resumeFrom || args.rerunFrom);
    const rerunMode = args.resumeFrom ? "resume" : args.rerunFrom ? "rerun" : "fresh";
    const output = buildOutput(input, config, playbookContext, planforgeRoot, inputMetadata, scaffoldkitContext);
    const planforgeIndex = renderPlanforgeIndex(output, {
      specs: args.clarify === true,
      runbooks: shouldWriteRunbooks(output),
      governance: shouldWriteGovernance(output)
    });

    const rerunReport = buildRerunReport(rerunMode, previousRun, input, output);

    validateWithSchema(planforgeRoot, "models/planning-output.schema.json", output, "generated planning output");
    validateWithSchema(planforgeRoot, "models/planforge-index.schema.json", planforgeIndex, "generated planforge index");

    if (args.validateOnly) {
      if (args.summary) {
        printSummary(output, "", true);
      } else {
        console.log("Validation succeeded for input, config, and generated planning output.");
      }
      return;
    }

    const outdir = args.outdir
      ? path.resolve(workingDir, args.outdir)
      : clarificationWorkspaceRoot(workingDir, args.outdir);
    ensureDir(outdir);
    
    // Detect default branch if not specified in input
    const autoDetected = !input.defaultBranch;
    if (autoDetected) {
      const detectedBranch = detectDefaultBranch(outdir);
      output.defaultBranch = detectedBranch;
    }
    
    writeFile(path.join(outdir, planningPath("plan-output.json")), `${JSON.stringify(output, null, 2)}\n`);
    writeFile(path.join(outdir, "PROJECT.md"), renderProjectIndex(planforgeRoot, input, output));
    writeFile(path.join(outdir, docsPath("intake-questionnaire.md")), renderIntakeQuestionnaire(planforgeRoot, input, output));
    writeFile(path.join(outdir, docsPath("project-charter.md")), renderProjectCharter(input, output));
    writeFile(path.join(outdir, docsPath("architecture-overview.md")), renderArchitectureOverview(input, output));
    writeFile(path.join(outdir, docsPath("delivery-plan.md")), renderDeliveryPlan(output));
    writeAiArtifacts(input, output, outdir, scaffoldkitContext, planforgeIndex);
    writeOperationalArtifacts(input, output, outdir, rerunReport, scaffoldkitContext);
    writeTemplateArtifacts(planforgeRoot, input, output, outdir, config);
    if (shouldWriteRuntimeTemplates(input, output, outdir)) {
      writeMakefile(planforgeRoot, outdir);
      writeDockerFiles(planforgeRoot, outdir);
      writePreCommitHooks(planforgeRoot, outdir);
    }
    writeBranchInfo(planforgeRoot, outdir, output.defaultBranch, autoDetected);
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
      writeStderrLine(error.message);
      error.details.forEach((detail) => writeStderrLine(`- ${detail}`));
      process.exit(error.exitCode);
    }

    writeStderrLine(`Planner failed: ${error.message}`);
    process.exit(EXIT_CODES.RUNTIME);
  }
}

main();
