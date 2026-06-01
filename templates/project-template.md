# PROJECT: {{projectName}}

## Purpose

This file is the human-first operating index for the generated planning pack.
Use it to understand the current plan quickly and jump to the source artifacts that carry the detailed truth.

## Current Planning Snapshot

- Summary: {{summary}}
- Planner profile: {{plannerProfile}}
- Phase: {{phase}}
- Path: {{path}}
- Intake completeness: {{intakeCompleteness}}
- Data sensitivity: {{dataSensitivity}}
- Recommended architecture: {{recommendedArchitecture}}

## Source Artifacts

- [Project Charter](.planforge/docs/project-charter.md): scope, users, constraints, open questions
- [Architecture Overview](.planforge/docs/architecture-overview.md): starting architecture, tradeoffs, risks
- [Delivery Plan](.planforge/docs/delivery-plan.md): execution waves and dependency ordering
- [Task Backlog](tasks/): executable work packages with acceptance criteria
- [ADRs](adrs/): early high-leverage decisions
- [.ai/](.ai/): compact AI-facing execution context

## Recommended Working Order

1. Read `.planforge/docs/project-charter.md` for scope and unresolved questions.
2. Read `.planforge/docs/architecture-overview.md` to confirm the recommended starting shape still fits.
3. Read `.planforge/docs/delivery-plan.md` to understand wave sequencing and dependencies.
4. Execute or refine the current wave tasks under `tasks/`.
5. Update ADRs when architectural or governance assumptions move.

## Current Wave

### {{currentWaveId}}

{{currentWaveGoal}}

{{currentWaveTasks}}

## Wave Summary

{{waveSummary}}

## Architecture Guardrails

{{architectureReasons}}

## Key Risks

{{risks}}

## Open Questions

{{openQuestions}}

## Guidance Areas To Keep Visible

{{guidanceAreas}}

## Artifact Expectations

{{recommendedArtifacts}}

## Notes

- `PROJECT.md` is a generated index, not the detailed source of truth.
- When detailed plan artifacts disagree, prefer the task documents and ADRs over summary text here.
- If the plan changes materially, rerun the planner so this file stays aligned with the backlog.
