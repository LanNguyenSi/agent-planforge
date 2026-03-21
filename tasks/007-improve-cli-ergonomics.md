# Task 007: Improve CLI Ergonomics

## Category

ux

## Priority

P2

## Wave

wave-4

## Delivery Phase

hardening

## Depends On

- 001
- 002

## Blocks

- None

## Summary

Improve the CLI surface so the planner is easier to use in day-to-day workflows and easier to automate in scripts.

## Implementation Notes

- Add `--help` and clearer usage output.
- Add consistent exit codes for validation failure versus runtime failure.
- Add a concise summary mode for quick inspection.
- Keep the CLI small and composable instead of turning it into an interactive tool.
