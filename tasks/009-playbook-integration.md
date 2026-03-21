# Task 009: Agent Engineering Playbook Integration

## Category

integration

## Priority

P1

## Wave

wave-2

## Delivery Phase

enhancement

## Depends On

- 001

## Blocks

- None

## Summary

Connect planforge output to the agent-engineering-playbook. When planforge detects phase and path (core/enterprise), reference the specific playbook chapters that apply and include them in the generated project charter and prompt pack.

## Implementation Notes

- Map phase + path to playbook chapters using `models/adoption-model.json` from agent-engineering-playbook.
- In `project-charter.md` output, add a "Applicable Playbooks" section listing which chapters to follow.
- In prompt exports, include references to relevant playbook URLs.
- The handoff manifest already has `recommendedPlaybooks` — ensure it maps to real playbook file paths.
- Consider bundling a lightweight copy of adoption-model.json or fetching it from the playbook repo.
