"use strict";

/**
 * Unit tests for scripts/lib/pattern-matching.js — Gap 6.
 * Same harness as bootstrap-plan.test.js: runCase + node:assert/strict,
 * flat calls, no describe/it.
 */

const assert = require("node:assert/strict");
const {
  alignmentScore,
  extractFilePath,
  matchPattern,
  matchedKeywordsForText,
  normalizeMatchText,
  resolvePatternFiles,
} = require("../scripts/lib/pattern-matching");

function runCase(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// normalizeMatchText
// ---------------------------------------------------------------------------

runCase("normalizeMatchText lowercases and collapses non-alphanumeric to spaces", () => {
  assert.equal(normalizeMatchText("Hello World!"), "hello world");
});

runCase("normalizeMatchText trims leading/trailing whitespace", () => {
  assert.equal(normalizeMatchText("  foo  "), "foo");
});

runCase("normalizeMatchText returns empty string for empty input", () => {
  assert.equal(normalizeMatchText(""), "");
});

runCase("normalizeMatchText returns empty string for null/undefined", () => {
  assert.equal(normalizeMatchText(null), "");
  assert.equal(normalizeMatchText(undefined), "");
});

// ---------------------------------------------------------------------------
// extractFilePath
// ---------------------------------------------------------------------------

runCase("extractFilePath extracts path before the em-dash separator", () => {
  assert.equal(extractFilePath("src/index.ts — Main entry point"), "src/index.ts");
});

runCase("extractFilePath returns the full string when no separator is present", () => {
  assert.equal(extractFilePath("src/index.ts"), "src/index.ts");
});

runCase("extractFilePath trims whitespace from the extracted path", () => {
  assert.equal(extractFilePath("  src/lib.ts  — description"), "src/lib.ts");
});

// ---------------------------------------------------------------------------
// matchedKeywordsForText
// ---------------------------------------------------------------------------

runCase("matchedKeywordsForText returns keywords that appear in the text", () => {
  const matches = matchedKeywordsForText(
    "user authentication with jwt tokens",
    ["authentication", "jwt", "oauth"]
  );
  assert.deepEqual(matches, ["authentication", "jwt"]);
});

runCase("matchedKeywordsForText returns empty array when text is empty", () => {
  const matches = matchedKeywordsForText("", ["auth", "jwt"]);
  assert.deepEqual(matches, []);
});

runCase("matchedKeywordsForText is case-insensitive via normalisation", () => {
  const matches = matchedKeywordsForText("REST API Service", ["rest", "api"]);
  assert.deepEqual(matches, ["rest", "api"]);
});

// ---------------------------------------------------------------------------
// matchPattern
// ---------------------------------------------------------------------------

runCase("matchPattern returns null when no patterns match the text", () => {
  const result = matchPattern("completely unrelated content", {
    myPattern: { keywords: ["specific", "terms"], minKeywordMatches: 2 },
  });
  assert.equal(result, null);
});

runCase("matchPattern returns null for empty patterns object", () => {
  assert.equal(matchPattern("anything", {}), null);
});

runCase("matchPattern returns null for empty/null text with no matches", () => {
  assert.equal(
    matchPattern("", { p: { keywords: ["foo"], minKeywordMatches: 1 } }),
    null
  );
});

runCase("matchPattern returns the matching pattern name on a happy-path match", () => {
  const result = matchPattern("authentication service", {
    authPattern: { keywords: ["authentication"], minKeywordMatches: 1 },
  });
  assert.ok(result !== null);
  assert.equal(result.patternName, "authPattern");
  assert.deepEqual(result.matchedKeywords, ["authentication"]);
});

runCase("matchPattern tie-break: pattern with higher matchCount wins", () => {
  const patterns = {
    lowMatch: { keywords: ["rest"], minKeywordMatches: 1 },
    highMatch: { keywords: ["rest", "api", "service"], minKeywordMatches: 1 },
  };
  const result = matchPattern("rest api service", patterns);
  assert.ok(result !== null);
  assert.equal(result.patternName, "highMatch");
  assert.equal(result.matchCount, 3);
});

runCase("matchPattern tie-break: when matchCount equal, higher specificityScore wins", () => {
  // Both patterns match exactly 1 keyword. "authentication" (14 chars after
  // normalisation) beats "a" (1 char) by specificityScore.
  const patterns = {
    shortKeyword: { keywords: ["a"], minKeywordMatches: 1 },
    longKeyword: { keywords: ["authentication"], minKeywordMatches: 1 },
  };
  const result = matchPattern("a authentication", patterns);
  assert.ok(result !== null);
  assert.equal(result.patternName, "longKeyword");
});

runCase(
  "matchPattern tie-break: when matchCount AND specificityScore equal, patternName localeCompare wins (alphabetically first)",
  () => {
    // Both patterns match the same 1 keyword ("api") with the same
    // specificityScore. The sort falls through to patternName.localeCompare.
    const keyword = "api";
    const patterns = {
      zPattern: { keywords: [keyword], minKeywordMatches: 1 },
      aPattern: { keywords: [keyword], minKeywordMatches: 1 },
    };
    const result = matchPattern("api endpoint", patterns);
    assert.ok(result !== null);
    // "aPattern" < "zPattern" alphabetically — must come first.
    assert.equal(result.patternName, "aPattern");
  }
);

runCase("matchPattern negativeKeywords block a match when present in text", () => {
  const patterns = {
    authJwt: {
      keywords: ["authentication"],
      negativeKeywords: ["api-key"],
      minKeywordMatches: 1,
    },
  };

  // Without negative keyword: matches.
  const positive = matchPattern("authentication system", patterns);
  assert.ok(positive !== null);
  assert.equal(positive.patternName, "authJwt");

  // With negative keyword: blocked.
  const blocked = matchPattern("authentication system api-key auth", patterns);
  assert.equal(blocked, null);
});

runCase("matchPattern respects minKeywordMatches threshold", () => {
  const patterns = {
    strictPattern: {
      keywords: ["foo", "bar", "baz"],
      minKeywordMatches: 3,
    },
  };

  // Only 2 of 3 required keywords present — should not match.
  assert.equal(matchPattern("foo bar other", patterns), null);

  // All 3 present — should match.
  const result = matchPattern("foo bar baz", patterns);
  assert.ok(result !== null);
  assert.equal(result.patternName, "strictPattern");
});

// ---------------------------------------------------------------------------
// resolvePatternFiles
// ---------------------------------------------------------------------------

runCase("resolvePatternFiles returns [] for an unknown blueprint key", () => {
  const files = resolvePatternFiles(
    { files: { "nextjs-fullstack": ["src/app/page.tsx"] } },
    "unknown-blueprint"
  );
  assert.deepEqual(files, []);
});

runCase("resolvePatternFiles returns [] when pattern is null", () => {
  assert.deepEqual(resolvePatternFiles(null, "any-blueprint"), []);
});

runCase("resolvePatternFiles returns [] when pattern has no files key", () => {
  assert.deepEqual(resolvePatternFiles({}, "any-blueprint"), []);
});

runCase("resolvePatternFiles returns the file list for a matching blueprint key", () => {
  const files = resolvePatternFiles(
    { files: { "express-api": ["src/index.ts", "src/routes.ts"] } },
    "express-api"
  );
  assert.deepEqual(files, ["src/index.ts", "src/routes.ts"]);
});

// ---------------------------------------------------------------------------
// alignmentScore
// ---------------------------------------------------------------------------

runCase("alignmentScore returns 0 when actualFiles is empty", () => {
  assert.equal(alignmentScore([], ["src/a.ts"]), 0);
});

runCase("alignmentScore returns 0 when expectedFiles is empty", () => {
  assert.equal(alignmentScore(["src/a.ts"], []), 0);
});

runCase("alignmentScore returns 0 when both sets are empty", () => {
  assert.equal(alignmentScore([], []), 0);
});

runCase("alignmentScore returns 1 for identical single-file sets", () => {
  assert.equal(alignmentScore(["src/a.ts"], ["src/a.ts"]), 1);
});

runCase("alignmentScore computes partial overlap correctly", () => {
  // 1 overlap out of max(2, 2) = 0.5
  const score = alignmentScore(
    ["src/a.ts", "src/b.ts"],
    ["src/a.ts", "src/c.ts"]
  );
  assert.equal(score, 0.5);
});

runCase("alignmentScore uses extractFilePath so description suffixes are ignored", () => {
  const score = alignmentScore(
    ["src/a.ts — Controller file"],
    ["src/a.ts"]
  );
  assert.equal(score, 1);
});

console.log("\nAll pattern-matching tests passed.");
