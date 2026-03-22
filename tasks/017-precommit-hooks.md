# Task 017: Generate Pre-Commit Hook Config

## Priority

P1

## Summary

Generate Husky + lint-staged configuration. During dogfooding, format and lint errors were caught in CI (60s delay) instead of locally before commit (0s).

## Problem

3 CI failures in ai-dashboard were format/lint issues that a pre-commit hook would have caught instantly.

## Solution

Generate in output directory:

**.husky/pre-commit:**
```bash
npx lint-staged
```

**package.json additions:**
```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

**Setup script in Makefile:**
```makefile
hooks:
	npx husky init
	echo "npx lint-staged" > .husky/pre-commit
```

## Files to Modify

- `scripts/bootstrap-plan.js` — Add hook config generation
- Generated package.json should include lint-staged config
- Generated Makefile should include `hooks` target

## Acceptance Criteria

- [ ] `git commit` triggers lint-staged automatically
- [ ] Format errors fixed before commit
- [ ] Setup documented in README
