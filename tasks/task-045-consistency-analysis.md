# Task 045: feat: add cross-artifact consistency analysis

## Category

feature

## Priority

p2

## Wave

3

## Delivery Phase

planning-enhancements

## Depends On

task-044

## Blocks

none

## Summary

Add a `--analyze` mode that validates consistency between spec, plan, and tasks after generation — catching contradictions before implementation begins. Inspired by spec-kit's `/speckit.analyze` command.

## Problem

Currently there is no automated validation that generated artifacts are consistent with each other. In testrun #2, pattern-matching bugs caused tasks to reference wrong file domains. These had to be caught and fixed manually during implementation by Codex/Ice.

## Solution

Add a `scripts/analyze-artifacts.js` script that:

1. Reads spec, plan, and tasks together
2. Checks for:
   - Tasks referencing files not mentioned in the plan
   - Plan dependencies not reflected in task ordering
   - Wave structure violations (task in wave N depends on wave N+1)
   - Stack pattern mismatches (e.g., AI-chat files for a pipeline-monitoring task)
3. Outputs `outputs/consistency-report.md` with issues + confidence scores
4. Exits non-zero if critical issues found (CI-compatible)

## Files To Create Or Modify

- `scripts/analyze-artifacts.js` — new analysis script
- `outputs/consistency-report.md` — generated per project run
- `prompts/analyze-prompt.md` — LLM prompt for consistency checks (new)

## Acceptance Criteria

- [ ] `node scripts/analyze-artifacts.js --outdir ./my-project` produces `outputs/consistency-report.md`
- [ ] Report identifies wave ordering violations
- [ ] Report flags pattern mismatches with confidence score
- [ ] Exit code 1 on critical issues, 0 on clean
- [ ] Can be used as a CI gate after `bootstrap-plan.js`

## Implementation Notes

Reference: spec-kit `/speckit.analyze` — https://github.com/github/spec-kit

Example report:
```markdown
# Consistency Analysis

## ⚠️ Issues Found

### Task 003: Wrong pattern matched
- Task: GitHub health overview
- Generated files: lib/ai/types.ts, app/api/chat/route.ts
- Expected pattern: github-api (lib/github/, components/Repo*)
- Confidence: 0.3 (low)

## ✅ Passed
- Wave ordering: correct
- Dependency chain: valid
- 7/8 tasks have correct pattern matches
```

CLI usage:
```bash
node scripts/bootstrap-plan.js --input planforge-input.json
node scripts/analyze-artifacts.js --outdir ./my-project
```
