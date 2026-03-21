# Task 013: DevReview Configuration Export

## Category

integration

## Priority

P2

## Wave

wave-3

## Delivery Phase

enhancement

## Depends On

- 004
- 006

## Blocks

- None

## Summary

Generate a DevReview configuration file from planforge output. This configures automated PR review scoring to match the project's architecture and quality expectations.

## Implementation Notes

- Output `out/<project>/.devreview.json` with:
  - Scoring weights (adjust based on project profile: enterprise → higher architecture/security weight)
  - Ignore patterns (based on tech stack)
  - Minimum score threshold (based on phase: exploration=6, production=8)
  - Custom rules (e.g., "require tests for API routes", "require ADR for new dependencies")
- Map planforge profiles to review strictness:
  - startup → relaxed (min 6, testing weight lower)
  - product → balanced (min 7, standard weights)
  - enterprise → strict (min 8, security weight higher)
  - platform → strict + API stability checks
