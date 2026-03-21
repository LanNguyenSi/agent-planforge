# Task 011: Richer Task Generation

## Category

quality

## Priority

P1

## Wave

wave-2

## Delivery Phase

enhancement

## Depends On

- 001
- 002

## Blocks

- None

## Summary

Generated tasks are currently minimal (title, category, wave, one-line summary). Enrich them to match the task format that proved effective in real projects (Event Booking System: 13 tasks, 9.5/10 average).

## Implementation Notes

- Each generated task should include:
  - **Problem:** What's missing or broken (not just "implement X")
  - **Solution:** Approach, not just the goal
  - **Files to create/modify:** Predicted file paths based on architecture
  - **Implementation notes:** Patterns to follow, edge cases, dependencies
  - **Acceptance criteria:** How to verify the task is done
- Reference: The task format in `templates/task-template.md` should be the target.
- Consider using the architecture recommendation to predict file paths (e.g., modular monolith + Next.js → `app/api/`, `components/`, `lib/`).
- The current "keep scope small and independently reviewable" note is good but too generic. Add context-specific notes per task.
