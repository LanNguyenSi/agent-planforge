# Task 012: Generate .ai/ Context Files

## Category

integration

## Priority

P0

## Wave

wave-1

## Delivery Phase

foundation

## Depends On

- None

## Blocks

- 010

## Summary

Generate `.ai/` context files as part of the planning output. These files allow AI agents to immediately understand and work on the project after planning.

## Implementation Notes

- Generate four files in `out/<project>/.ai/`:
  - `AGENTS.md` — Roles from planforge (who plans, who implements, who reviews). Map to team roles from input or defaults.
  - `ARCHITECTURE.md` — From architecture overview. Include tech stack, patterns, key decisions, deployment approach.
  - `TASKS.md` — From generated task backlog. Include priorities, waves, dependencies.
  - `DECISIONS.md` — From generated ADRs. Link to full ADR files.
- These should be ready to commit to a new repository as-is.
- Format should match the `.ai/` pattern from agent-engineering-playbook chapter 08.
