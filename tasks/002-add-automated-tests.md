# Task 002: Add Automated Tests

## Category

quality

## Priority

P0

## Wave

wave-1

## Delivery Phase

foundation

## Depends On

- 001

## Blocks

- 004
- 005
- 006

## Summary

Introduce an automated test suite for the planner so that core planning behavior, schema enforcement, and manifest generation can evolve without silent regressions.

## Implementation Notes

- Add golden-path tests for `sample`, `minimal`, and `platform` inputs.
- Add failure-path tests for invalid input and invalid config.
- Cover phase inference, path inference, dependency graph, and handoff manifest structure.
- Add a `test` script in `package.json`.
