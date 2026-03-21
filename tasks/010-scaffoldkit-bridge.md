# Task 010: ScaffoldKit Bridge

## Category

integration

## Priority

P1

## Wave

wave-2

## Delivery Phase

enhancement

## Depends On

- 004

## Blocks

- None

## Summary

Generate a ScaffoldKit-compatible blueprint configuration from planforge output. After planning, the user should be able to pipe the result into ScaffoldKit to generate the actual code skeleton.

## Implementation Notes

- From planforge output (architecture shape, tech stack, features), generate a `scaffoldkit-input.json` that ScaffoldKit can consume.
- Map architecture recommendation to ScaffoldKit blueprint name (e.g., modular monolith + TypeScript + PostgreSQL → `nextjs-fullstack`).
- Include `.ai/` context files in the ScaffoldKit output (AGENTS.md, ARCHITECTURE.md from planforge-generated content).
- Output as `out/<project>/scaffoldkit-input.json`.
- This creates the pipeline: planforge (plan) → scaffoldkit (scaffold) → agent (implement).
