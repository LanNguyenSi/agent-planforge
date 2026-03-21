# Task 001: Add Schema Validation

## Category

hardening

## Priority

P0

## Wave

wave-1

## Delivery Phase

foundation

## Depends On

- None

## Blocks

- 002

## Summary

Validate planning input and generated output against the JSON schemas during CLI execution instead of treating the schemas as documentation only.

## Implementation Notes

- Validate `models/planning-input.schema.json` before planning starts.
- Validate `models/planning-output.schema.json` before artifacts are written.
- Fail with precise, field-level errors that make broken inputs or generator regressions obvious.
- Add a `--validate-only` mode only if it falls out naturally from the validation work.
