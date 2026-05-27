---
"@runfusion/fusion": minor
---

Add optional `baseBranch` support to mission creation and task planning flows.

- `fn_mission_create` now accepts `baseBranch` to persist a mission-level default integration branch.
- Mission feature/slice triage inherits mission `baseBranch` when no explicit triage base branch is supplied.
- `fn_task_plan`/CLI planning paths now accept and forward `baseBranch` to created tasks.
