"use strict";

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractFilePath(value) {
  return String(value || "")
    .split(" — ")[0]
    .trim();
}

function matchedKeywordsForText(text, keywords = []) {
  const normalizedText = normalizeMatchText(text);
  if (!normalizedText) {
    return [];
  }

  return keywords.filter((keyword) => {
    const normalizedKeyword = normalizeMatchText(keyword);
    return normalizedKeyword && normalizedText.includes(normalizedKeyword);
  });
}

function patternSpecificityScore(matchedKeywords) {
  return matchedKeywords.reduce((total, keyword) => total + normalizeMatchText(keyword).length, 0);
}

function matchPattern(text, patterns) {
  const normalizedText = normalizeMatchText(text);
  const matches = [];

  for (const [patternName, pattern] of Object.entries(patterns || {})) {
    const negativeKeywords = pattern.negativeKeywords || [];
    const hasNegativeKeyword = negativeKeywords.some((keyword) => {
      const normalizedKeyword = normalizeMatchText(keyword);
      return normalizedKeyword && normalizedText.includes(normalizedKeyword);
    });

    if (hasNegativeKeyword) {
      continue;
    }

    const matchedKeywords = matchedKeywordsForText(text, pattern.keywords || []);
    const minKeywordMatches = Number(pattern.minKeywordMatches || 1);
    if (matchedKeywords.length < minKeywordMatches) {
      continue;
    }

    matches.push({
      patternName,
      pattern,
      matchCount: matchedKeywords.length,
      matchedKeywords,
      specificityScore: patternSpecificityScore(matchedKeywords)
    });
  }

  if (!matches.length) {
    return null;
  }

  matches.sort((left, right) => {
    if (right.matchCount !== left.matchCount) {
      return right.matchCount - left.matchCount;
    }
    if (right.specificityScore !== left.specificityScore) {
      return right.specificityScore - left.specificityScore;
    }
    return left.patternName.localeCompare(right.patternName);
  });

  return matches[0];
}

function resolvePatternFiles(pattern, blueprint) {
  if (!pattern || !pattern.files) {
    return [];
  }

  const blueprintKey = String(blueprint || "").trim();
  if (blueprintKey && pattern.files[blueprintKey]) {
    return pattern.files[blueprintKey];
  }

  // No file set exists for the selected blueprint, so return nothing and let the
  // caller fall back to a language-aware generic layout. This deliberately drops
  // the old behavior, which keyed on the architecture *shape* (e.g. "modular
  // monolith"). A shape string never matched a blueprint key, so the function
  // always fell through to the first file set — nextjs-fullstack — leaking
  // Next.js/Prisma paths into every non-Next.js project.
  return [];
}

function alignmentScore(actualFiles = [], expectedFiles = []) {
  const actual = new Set(actualFiles.map(extractFilePath).filter(Boolean));
  const expected = new Set(expectedFiles.map(extractFilePath).filter(Boolean));

  if (!actual.size || !expected.size) {
    return 0;
  }

  let overlap = 0;
  actual.forEach((filePath) => {
    if (expected.has(filePath)) {
      overlap += 1;
    }
  });

  return overlap / Math.max(actual.size, expected.size);
}

module.exports = {
  alignmentScore,
  extractFilePath,
  matchPattern,
  matchedKeywordsForText,
  normalizeMatchText,
  resolvePatternFiles
};
