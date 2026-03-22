# Task 020: Stack-Aware Task Enrichment

## Priority

P1

## Summary

Generated tasks are too generic ("Design and implement the capability for: X"). They should include stack-specific file paths, patterns, and implementation guidance.

## Problem

Planforge tasks like "Implement user authentication with JWT" don't specify:
- Which files to create (`lib/auth/jwt.ts`, `app/api/auth/login/route.ts`)
- Which patterns to follow (middleware pattern, Prisma model)
- Which libraries to use (bcrypt, jsonwebtoken)
- What the API shape looks like

Developers (agents) have to guess, leading to inconsistency.

## Solution

Enrich task generation using architecture recommendation + stack info:

For `nextjs-fullstack` + `modular monolith`:
```markdown
## Files To Create Or Modify

- lib/auth/jwt.ts — Token generation + verification (jsonwebtoken)
- lib/auth/password.ts — bcrypt hashing + verification
- lib/auth/middleware.ts — withAuth() HOF for protected routes
- lib/auth/validation.ts — Zod schemas (RegisterInput, LoginInput)
- app/api/auth/register/route.ts — POST registration endpoint
- app/api/auth/login/route.ts — POST login endpoint
- app/api/auth/me/route.ts — GET current user (protected)
- prisma/schema.prisma — User model with email, password, name
- tests/auth/jwt.test.ts — Token tests
- tests/auth/password.test.ts — Hash tests
```

## Implementation Notes

- Map feature keywords to known patterns:
  - "authentication" + "JWT" → auth module pattern
  - "dashboard" + "widgets" → CRUD + grid layout pattern
  - "AI assistant" → OpenAI integration pattern
  - "settings" → preferences model + form pattern
- Use architecture shape to determine file structure:
  - modular monolith → `lib/<module>/` + `app/api/<module>/`
  - microservices → `services/<name>/src/`
- Reference ai-dashboard as template for Next.js patterns

## Files to Modify

- `scripts/bootstrap-plan.js` — Enhance `generateTasks()` function
- Possibly add `config/stack-patterns.json` for pattern mapping

## Acceptance Criteria

- [ ] Auth tasks include specific file paths for Next.js + Prisma
- [ ] CRUD tasks include API route + service + model files
- [ ] AI integration tasks include service + types + context files
- [ ] File paths match the architecture recommendation
