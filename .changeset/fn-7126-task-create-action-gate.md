---
"@runfusion/fusion": patch
---

summary: Govern task creation and delegation with the task_agent_mutation permission policy.
category: fix
dev: fn_task_create and fn_delegate_task were action-gate exempt despite being task-board mutations; now classified task_agent_mutation in the action gate (permanent-agent gate none classification preserved).
