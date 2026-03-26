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

function resolvePatternFiles(pattern, architectureShape) {
  if (!pattern || !pattern.files) {
    return [];
  }

  const shapeKey = String(architectureShape || "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  if (pattern.files[shapeKey]) {
    return pattern.files[shapeKey];
  }

  if (/next|fullstack/.test(shapeKey) && pattern.files["nextjs-fullstack"]) {
    return pattern.files["nextjs-fullstack"];
  }

  const firstShape = Object.keys(pattern.files)[0];
  return firstShape ? pattern.files[firstShape] : [];
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
