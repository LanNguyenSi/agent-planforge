# Task 015: Generate Makefile in Planning Output

## Priority

P0

## Summary

Add a Makefile to the generated project baseline. During dogfooding (ai-dashboard), missing `make ci` caused 3 preventable CI failures. Developers pushed without local validation.

## Problem

No standardized way to run all checks locally before pushing. Each project reinvents `npm run lint && npm run format:check && npm test && npm run build`.

## Solution

Generate a `Makefile` in the output directory with these targets:

```makefile
.PHONY: install dev build test lint ci clean

install:
	npm ci
	npx prisma generate

dev:
	npm run dev

build:
	npm run build

test:
	npm test

lint:
	npm run lint
	npm run format:check
	npm run type-check

ci: lint test build

clean:
	rm -rf node_modules .next dist
```

## Files to Modify

- `scripts/bootstrap-plan.js` — Add Makefile generation after artifact writing
- `templates/Makefile.template` — New template (or inline string)

## Acceptance Criteria

- [ ] `make ci` runs lint + test + build in sequence
- [ ] `make install` sets up dependencies + prisma
- [ ] Makefile generated for all profiles
- [ ] Works on Linux and macOS
