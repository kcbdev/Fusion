# Milestone C: DAG dashboard surfacing plan

Related tasks: **FN-4487**, **FN-4471**, **FN-4490**, **FN-4491**, **FN-4492**.

## Constraints & Governance

> "Do not file, plan, or implement tasks that adjust button mobile-responsiveness, touch-target sizing, or mobile reflow of header/action button rows anywhere in the dashboard (TaskCard, SettingsModal, ChatView, MissionManager, AgentsView, FAB, etc.). **Keep buttons as they are.**"

> "Reliability mechanism changes are currently under freeze pending FN-4359 governance hardening; treat new reliability-layer behavior changes as blocked unless explicitly approved in task scope."

This document is planning-only. No runtime behavior, scheduler/executor/merger code, dashboard routes, API endpoints, or schema changes are made here.

## UX Progression (debug → operator)

### Stage 1 — Debug surface

**Audience:** Fusion developers debugging prototype orchestration.

**Ship:** Read-only structured-log view for `[dag-coordinator]` events, filterable by `runId`, mirroring `AgentLogViewer` / `ActivityFeed` interaction patterns.

**Operator questions answered:**
- Did this DAG run start and finish/abort?
- Which node was enqueued/completed/failed most recently?
- What failure reason code was emitted for the failing node/run?

**Events consumed from FN-4490 contract:**
- `dag:run:start`
- `dag:node:enqueue`
- `dag:node:complete`
- `dag:node:fail`
- `dag:run:complete`
- `dag:run:abort`

### Stage 2 — Run inspector

**Audience:** Power users monitoring multi-task DAG runs.

**Ship:** Per-run detail inspector with node table, dependency/blocked context, and task deep-links into `TaskDetailModal`; read-only.

**Operator questions answered:**
- Which DAG node failed and why?
- Which nodes are complete vs still pending/in-progress?
- Which Fusion task corresponds to each node and where do I inspect logs/details?

**Events consumed from FN-4490 contract:**
- `dag:run:start`
- `dag:node:enqueue`
- `dag:node:complete`
- `dag:node:fail`
- `dag:run:complete`
- `dag:run:abort`

### Stage 3 — Operator surface

**Audience:** End-users orchestrating DAG runs.

**Ship:** Top-level run list, per-run graph visualization (nodes + edges), run-state summary, and pause/resume/cancel controls.

**Operator questions answered:**
- Is this run still making progress or stalled?
- Which branch/path of the graph failed and what is downstream impact?
- Can I safely pause/resume/cancel without violating task ownership or merge safety?

**Events consumed from FN-4490 contract:**
- `dag:run:start`
- `dag:node:enqueue`
- `dag:node:complete`
- `dag:node:fail`
- `dag:run:complete`
- `dag:run:abort`

#### Events to add in FN-4490 follow-up

Stage 3 controls need explicit pause/resume observability. FN-4490 currently defines only `dag:run:abort` (not pause/resume), so add:
- `dag:run:pause`
- `dag:run:resume`

These are follow-up requirements and are not introduced as implemented behavior in this task.
