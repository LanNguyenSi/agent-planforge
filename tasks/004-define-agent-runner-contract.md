# Task 004: Define Agent Runner Contract

## Category

orchestration

## Priority

P0

## Wave

wave-2

## Delivery Phase

implementation

## Depends On

- 002

## Blocks

- 005
- 006

## Summary

Define a standard contract for downstream agents so the handoff manifest points to a predictable execution model rather than loose prompts and conventions.

## Implementation Notes

- Specify required input files, expected output files, and status reporting per handoff step.
- Define how agents report blockers, partial completion, and final completion.
- Keep the contract machine-readable where possible.
- Align the contract with the existing `promptExports` and `handoffManifest` structure.
