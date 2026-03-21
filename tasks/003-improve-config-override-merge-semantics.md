# Task 003: Improve Config Override Merge Semantics

## Category

config

## Priority

P1

## Wave

wave-2

## Delivery Phase

foundation

## Depends On

- 001
- 002

## Blocks

- None

## Summary

Replace the current coarse config override behavior with controlled merge semantics so teams can override small parts of the planner ruleset without copying whole sections.

## Implementation Notes

- Define merge rules for profile settings, guidance areas, artifacts, and governance defaults.
- Keep the override behavior deterministic and easy to explain.
- Validate merged results with the existing planner config schema.
- Document the merge semantics in the README with one concrete example.
