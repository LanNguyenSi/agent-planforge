# Task 019: Post-Generate Lock File

## Priority

P0

## Summary

Generated projects missing `package-lock.json` cause `npm ci` failures in CI. Lock file should be generated as part of the planning output.

## Problem

First CI run of ai-dashboard failed because `npm ci` requires `package-lock.json` but planforge only generates `package.json`.

## Solution

After generating `package.json`, run `npm install --package-lock-only` (or full `npm install`) to create the lock file. This should be a post-generation step.

Options:
1. **Post-generate hook:** Run `npm install` in output dir after file generation
2. **CLI flag:** `--install` to run npm install after generation (default: true)
3. **Documentation:** At minimum, document that `npm install` must be run before first CI push

## Files to Modify

- `scripts/bootstrap-plan.js` — Add post-generate npm install step
- README.md — Document the behavior

## Acceptance Criteria

- [ ] `package-lock.json` exists in output directory after generation
- [ ] `npm ci` works in generated project without manual intervention
- [ ] Can be skipped with `--no-install` flag
