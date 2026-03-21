# Task 006: Refine Handoff Policies

## Category

orchestration

## Priority

P1

## Wave

wave-3

## Delivery Phase

hardening

## Depends On

- 002
- 004

## Blocks

- None

## Summary

Make handoff behavior more explicit by adding richer policies for parallelism, blockers, approval gates, and profile-specific coordination.

## Implementation Notes

- Separate hard blockers from soft dependencies.
- Support profile-specific coordination behavior for `startup`, `product`, `enterprise`, and `platform`.
- Add simple approval or review gates where steps should not auto-continue.
- Keep the manifest understandable without requiring a separate orchestrator implementation.
