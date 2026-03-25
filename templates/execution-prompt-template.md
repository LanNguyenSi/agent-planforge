# Prompt: Delivery Execution

You are working on `{{projectName}}`.

## Objective

Turn the current plan into an implementation strategy for the next delivery wave.
Use a spec/context/eval lens:

- spec: keep the objective, scope, dependencies, and acceptance criteria explicit
- context: use the architecture, constraints, and applicable playbooks to guide decisions
- eval: define the tests, review points, and rollout checks needed before delivery is considered done

## Context

- Planner profile: {{plannerProfile}}
- Phase: {{phase}}
- Current wave: {{waveId}}
- Wave goal: {{waveGoal}}
- Critical path: {{criticalPath}}

## Tasks In Scope

{{tasks}}

## Applicable Playbooks

{{applicablePlaybooks}}

## Constraints And Questions

Constraints:
{{constraints}}

Open questions:
{{openQuestions}}

## Expected Output

- proposed execution order inside the wave
- risks or blockers
- test and verification approach
- whether any task should be split further
