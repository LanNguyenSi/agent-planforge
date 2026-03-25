# Prompt: Architecture Analysis

You are working on `{{projectName}}`.

## Objective

Validate and refine the recommended architecture for this project.
Use a spec/context/eval lens:

- spec: check that the architecture matches the intended scope and constraints
- context: use the project domain, integrations, security posture, and operating assumptions directly
- eval: call out the evidence and checks needed to validate the recommendation later

## Context

- Summary: {{summary}}
- Planner profile: {{plannerProfile}}
- Phase: {{phase}}
- Path: {{path}}
- Recommended architecture: {{recommendedArchitecture}}

## Architecture Options

{{architectureOptions}}

## Applicable Playbooks

{{applicablePlaybooks}}

## Risks And Open Questions

Risks:
{{risks}}

Open questions:
{{openQuestions}}

## Expected Output

- Refined architecture recommendation
- Key module boundaries
- Biggest architectural risks
- ADR updates or new ADR proposals
