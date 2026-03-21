# Task 005: Add Rerun And Resume Flow

## Category

workflow

## Priority

P1

## Wave

wave-3

## Delivery Phase

implementation

## Depends On

- 002
- 004

## Blocks

- None

## Summary

Add a controlled rerun and resume workflow so planning can continue after intake clarification, architecture review, or partial delivery without regenerating everything blindly.

## Implementation Notes

- Define what gets regenerated versus preserved.
- Track changed assumptions and changed recommendations explicitly.
- Support resuming from updated planning input and previously generated artifacts.
- Keep the first implementation narrow and deterministic before adding complex diff behavior.
