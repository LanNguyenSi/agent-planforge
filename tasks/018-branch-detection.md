# Task 018: Default Branch Detection

## Priority

P1

## Summary

CI workflow generated with hardcoded `main` but repo used `master`. Planforge should detect or configure the default branch name.

## Problem

ai-dashboard CI targeted `main` but the repo's default branch was `master`. Required manual fix in Task 003.

## Solution

Two approaches (implement both):

1. **Config option:** Add `defaultBranch` to planning input schema (optional, default: "main")
2. **Detection:** When `--outdir` points to an existing git repo, read `git symbolic-ref HEAD` to detect

Generated CI workflows and docs should use the detected/configured branch name.

## Files to Modify

- `models/planning-input.schema.json` — Add optional `defaultBranch` field
- `scripts/bootstrap-plan.js` — Branch detection logic + template variable
- CI workflow template — Use variable instead of hardcoded "main"

## Acceptance Criteria

- [ ] Generated CI uses correct branch name
- [ ] Works with both "main" and "master" repos
- [ ] Configurable via input JSON
- [ ] Auto-detected when generating into existing git repo
