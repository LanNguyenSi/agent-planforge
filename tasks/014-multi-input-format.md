# Task 014: Support Multiple Input Formats

## Category

ux

## Priority

P2

## Wave

wave-3

## Delivery Phase

enhancement

## Depends On

- 001
- 007

## Blocks

- None

## Summary

Accept planning input as plain text or markdown in addition to structured JSON. Many users will describe their project in natural language, not as a JSON schema.

## Implementation Notes

- Add `--format` flag: `json` (default), `text`, `markdown`.
- For text/markdown input, use heuristic parsing:
  - Extract project name from title/first heading
  - Extract features from bullet lists
  - Extract constraints from "must", "should", "cannot" patterns
  - Extract team size from numbers near "team" or "people"
  - Flag ambiguous extractions as `missingInformation`
- Alternatively, generate a prompt that an LLM can use to convert text → structured JSON.
- Output intermediate structured JSON for review before planning proceeds.
- This lowers the barrier: `echo "Build me an event booking platform for workshops" | agent-planforge --format text`
