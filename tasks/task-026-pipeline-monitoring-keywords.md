# Task 026: refactor: clean up pipeline-monitoring keywords

## Category

refactor

## Priority

low

## Wave

1

## Delivery Phase

technical-debt

## Depends On

none

## Blocks

none

## Summary

Remove overly generic keywords from the `pipeline-monitoring` pattern that cause false-positive matches, eliminating the need for the magic-number primary-keyword boost introduced in PR #25.

## Problem

PR #25 fixed an alert-system edge case by adding a Primary-Keyword-Boost (+10) to `keywords[0]`. This works but is fragile:

- Implicit convention: `keywords[0]` must be the "primary" keyword
- Magic number: `+10` boost is unexplained
- Generic keywords (`"fail"`, `"deployment"`, `"pass"`, `"build"`) match too broadly across domains

## Solution

Option A — Remove the generic keywords from `pipeline-monitoring` that cause false matches:

```json
// Before
"pipeline-monitoring": {
  "keywords": ["pipeline", "workflow", "ci-run", "run-history", "build-status", "trend", "fail", "deployment", "pass", "build"]
}

// After
"pipeline-monitoring": {
  "keywords": ["pipeline", "workflow", "ci-run", "run-history", "build-status", "trend"]
}
```

Remove: `"fail"`, `"deployment"`, `"pass"`, `"build"` (too generic)
Keep: `"pipeline"`, `"workflow"`, `"ci-run"`, `"run-history"`, `"build-status"`, `"trend"`

Then remove the `+10` boost and `keywords[0]` primary convention.

## Files To Create Or Modify

- Pattern config file containing `pipeline-monitoring` keywords
- Any code relying on `keywords[0]` primary convention or the `+10` boost

## Acceptance Criteria

- [ ] `pipeline-monitoring` no longer matches `alert-system` tasks
- [ ] No `+10` magic number boost in codebase
- [ ] No implicit `keywords[0]` primary convention
- [ ] Existing tests pass
- [ ] No regression for valid pipeline-monitoring matches

## Implementation Notes

Low priority — PR #25 handles current cases correctly. Tackle when the next false-positive match surfaces, or during a dedicated tech-debt sprint.
