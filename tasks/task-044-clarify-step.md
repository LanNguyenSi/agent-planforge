# Task 044: feat: add clarify step before planning

## Category

feature

## Priority

p1

## Wave

2

## Delivery Phase

planning-enhancements

## Depends On

none

## Blocks

task-045

## Summary

Add a `--clarify` mode to `bootstrap-plan.js` that surfaces underspecified requirements before the technical plan is generated, inspired by spec-kit's `/speckit.clarify` command.

## Problem

planforge currently jumps from input → plan without a clarification pass. In testrun #2 (agent-ops-dashboard), several tasks generated files for wrong domains because the input was underspecified. This caused rework during implementation.

## Solution

Add a `--clarify` mode that:

1. Reads the planning input
2. Generates 5-10 targeted clarification questions based on underspecified areas
3. Writes questions to `specs/clarifications.md`
4. Waits for answers (or accepts `--auto-clarify` for defaults)
5. Uses answers to enrich the plan before task generation

## Files To Create Or Modify

- `scripts/bootstrap-plan.js` — add `--clarify` and `--auto-clarify` flags
- `specs/clarifications.md` — output file (generated per project)
- `prompts/clarify-prompt.md` — LLM prompt for question generation (new)

## Acceptance Criteria

- [ ] `node scripts/bootstrap-plan.js --input planforge-input.json --clarify` generates `specs/clarifications.md` with 5-10 questions
- [ ] `--auto-clarify` accepts defaults and proceeds without waiting
- [ ] Standard run (no flags) preserves current behavior
- [ ] Questions cover: auth strategy, data model, deployment target, integrations
- [ ] Answers are incorporated into the generated plan

## Implementation Notes

Reference: spec-kit `/speckit.clarify` — https://github.com/github/spec-kit

Example output (clarifications.md):
```markdown
# Clarifications needed before planning

## Auth Strategy
- [ ] Should registration be open, invite-only, or approval-based? (default: approval)
- [ ] Will there be social login (OAuth) or email/password only?

## Deployment
- [ ] Target platform: VPS, k8s, serverless? (default: VPS + Docker)
```
