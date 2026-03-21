# Planning And Scoping

This playbook defines how an agent should turn rough requirements into an initial engineering plan without overcommitting too early.

## Goals

The planning phase should produce:

- a shared understanding of the problem
- a realistic first architecture
- visible assumptions and risks
- an actionable first backlog

## Planning Sequence

### 1. Normalize The Input

Extract and restate:

- product goal
- users
- core outcomes
- constraints
- known unknowns

If the input is vague, do not invent certainty. Preserve open questions.

### 2. Infer Delivery Context

Determine:

- likely project phase
- core path versus enterprise path
- whether production readiness is near
- whether sensitive data or enterprise triggers exist

### 3. Choose The Smallest Responsible Architecture

Default recommendation:

- modular monolith
- one primary database
- background jobs only when async work is clear
- explicit module boundaries instead of early service sprawl

Only recommend service separation early when:

- compliance demands hard isolation
- scale characteristics are materially different
- organizational ownership is already split

### 4. Surface Architecture Options

Produce at least:

- one default option
- one more conservative option
- one more scalable but more complex option

Then explain why one is the recommended starting point.

### 5. Generate ADR Candidates

Create ADR candidates only for decisions with real leverage:

- architecture shape
- database choice
- integration model
- auth model
- enterprise controls if relevant

### 6. Slice The Work

Break work into:

- foundation tasks
- feature tasks
- operational or quality tasks
- enterprise-only controls when required

Tasks should be independently understandable and reviewable.
Tasks should also express:

- what must happen first
- what can happen in parallel
- what blocks release readiness

Prefer small dependency chains over a single giant sequence.

### 7. Preserve Uncertainty

Every plan should include:

- open questions
- explicit risks
- assumptions that may invalidate the plan

## Anti-Patterns

- generating a perfect-looking backlog from poor input
- recommending microservices by default
- skipping quality and operational tasks in favor of features only
- hiding uncertainty to appear confident

## Exit Criteria

Planning is good enough when:

- the team can challenge the assumptions
- the first backlog is actionable
- the recommended architecture is defensible
- the next decisions are visible
